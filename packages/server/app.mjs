import { PRODUCT_NAME, PRODUCT_VERSION } from '../config/product.mjs';
import { requestPasswordReset, resetPassword } from './modules/identity/password-reset.mjs';
import {
  emailConfiguration,
  enqueueAccountEmail,
  deliverAccountEmails,
} from './modules/email/service.mjs';
import { inspectReadiness } from './readiness.mjs';
import { createIdempotently } from './core/idempotency.mjs';
import * as workspacePolicy from './modules/identity/policy.mjs';
import { applicationOrigin, isAllowedOrigin } from '../config/development.mjs';
import { AppError, assert, missing, conflict, requirePermission } from './core/errors.mjs';
import { id, now, secret, sha256, constantEqual } from './core/crypto.mjs';
import { schemas, filters as filterSchema } from '../contracts/schemas.mjs';
import { validate } from '../contracts/validate.mjs';
import { listModules, setModule, assertModule } from './core/modules.mjs';
import * as identity from './modules/identity/service.mjs';
import * as tickets from './modules/tickets/service.mjs';
import * as planning from './modules/planning/service.mjs';
import * as files from './modules/attachments/service.mjs';
import * as integrations from './modules/integrations/service.mjs';
import { readFile } from 'node:fs/promises';

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
const cookie = (request) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith('tickets_session='))
    ?.slice(16);
async function rawBody(request, max = 1024 * 1024) {
  assert(
    Number(request.headers.get('content-length') ?? 0) <= max,
    413,
    'BODY_TOO_LARGE',
    'Request exceeds the size limit',
  );
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts = [];
  let bytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      await reader.cancel();
      throw new AppError(413, 'BODY_TOO_LARGE', 'Request exceeds the size limit');
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}
async function body(request, schema) {
  assert(
    request.headers.get('content-type')?.startsWith('application/json'),
    415,
    'JSON_REQUIRED',
    'Use application/json',
  );
  let value;
  try {
    value = JSON.parse((await rawBody(request)).toString());
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(400, 'INVALID_JSON', 'Malformed JSON body');
  }
  return validate(value, schema);
}
export function createApp({
  db,
  env = process.env,
  storage,
  logger = console,
  mailTransport,
  defer,
} = {}) {
  assert(db, 500, 'CONFIG', 'Database is required');
  const production = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  assert(
    !production || env.AUTH_SECRET?.length >= 32,
    500,
    'CONFIG',
    'Production AUTH_SECRET must contain at least 32 characters',
  );
  const signingKey = env.AUTH_SECRET || secret();
  const origin = applicationOrigin(env);
  const store = () => (storage ??= files.createStorage(env));
  const dispatchMail = () => {
    if (defer)
      defer(
        deliverAccountEmails(db, env, { transport: mailTransport, limit: 1 }).catch(() =>
          logger.error?.({ code: 'ACCOUNT_MAIL_WORKER_FAILED' }),
        ),
      );
  };
  async function handle(request) {
    const requestId = id(),
      url = new URL(request.url),
      path = url.pathname.replace(/\/$/, '') || '/',
      method = request.method;
    let response;
    try {
      const bearerHeader = request.headers.get('authorization');
      const bearer = bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : undefined;
      const browserOrigin = request.headers.get('origin');
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(method) &&
        !path.startsWith('/api/webhooks/') &&
        path !== '/api/internal/jobs' &&
        !bearer
      ) {
        assert(
          !browserOrigin || isAllowedOrigin(browserOrigin, env),
          403,
          'ORIGIN_NOT_ALLOWED',
          'Origin is not allowed',
        );
        assert(
          request.headers.get('x-tickets-csrf') === '1',
          403,
          'CSRF_REQUIRED',
          'A same-origin CSRF header is required',
        );
      }
      const credentials = { bearer, cookie: cookie(request) };
      const run = (read, fn) =>
        db.transaction(
          async (tx) => {
            const actor = await identity.authenticate(tx, credentials);
            requirePermission(actor, 'read');
            if (!read) await tx.lock(actor.workspace_id);
            return fn(tx, actor);
          },
          { readOnly: read },
        );
      if (method === 'OPTIONS')
        response =
          browserOrigin === origin
            ? new Response(null, {
                status: 204,
                headers: {
                  'access-control-allow-origin': origin,
                  'access-control-allow-credentials': 'true',
                  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE',
                  'access-control-allow-headers':
                    'Content-Type,X-Tickets-CSRF,Authorization,Idempotency-Key',
                  vary: 'Origin',
                },
              })
            : json({ error: { code: 'ORIGIN_NOT_ALLOWED' } }, 403);
      else if (path === '/api/ready' && method === 'GET') {
        const state = await inspectReadiness(db);
        response = json(state, state.status === 'ready' ? 200 : 503);
      } else if (path === '/api/health' && method === 'GET')
        response = json({
          status: 'ok',
          service: PRODUCT_NAME,
          version: PRODUCT_VERSION,
          ...(env.DEV_INSTANCE_ID && !production ? { instance: env.DEV_INSTANCE_ID } : {}),
        });
      else if (path === '/api/openapi.json' && method === 'GET')
        response = new Response(
          await readFile(new URL('../../docs/openapi.json', import.meta.url)),
          { headers: { 'content-type': 'application/json' } },
        );
      else if (path === '/api/auth/options' && method === 'GET') {
        response = json({ passwordReset: emailConfiguration(env).configured });
      } else if (path === '/api/auth/forgot-password' && method === 'POST') {
        const input = await body(request, schemas.ForgotPassword);
        response = json(
          await requestPasswordReset(
            db,
            env,
            input,
            env.VERCEL ? (request.headers.get('x-vercel-forwarded-for') ?? 'unknown') : 'local',
          ),
          202,
        );
        dispatchMail();
      } else if (path === '/api/auth/reset-password' && method === 'POST') {
        const input = await body(request, schemas.ResetPassword);
        response = json(
          await resetPassword(
            db,
            env,
            input,
            env.VERCEL ? (request.headers.get('x-vercel-forwarded-for') ?? 'unknown') : 'local',
          ),
          200,
          {
            'set-cookie':
              'tickets_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' +
              (production ? '; Secure' : ''),
          },
        );
        dispatchMail();
      } else if (path === '/api/auth/login' && method === 'POST') {
        const input = await body(request, schemas.Login);
        // Only trust the provider's source-IP header on Vercel. Never trust arbitrary X-Forwarded-For locally.
        const source = env.VERCEL
          ? (request.headers.get('x-vercel-forwarded-for') ?? 'unknown')
          : 'local';
        const result = await identity.login(db, input, source);
        response = json({ user: result.user }, 200, {
          'set-cookie': `tickets_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${production ? '; Secure' : ''}`,
        });
      } else if (path === '/api/auth/accept-invite' && method === 'POST') {
        const input = await body(request, schemas.AcceptInvite);
        const allowed = await db.transaction(async (tx) => {
          await tx.lock('auth-rate-limit');
          return identity.rateLimit(tx, 'invite:' + sha256(input.token), 10);
        });
        assert(allowed, 429, 'RATE_LIMITED', 'Too many invitation attempts');
        response = json(await identity.acceptInvite(db, input), 201);
      } else if (path === '/api/auth/logout' && method === 'POST') {
        await run(false, (tx, actor) =>
          tx.exec('DELETE FROM sessions WHERE hash=?', [actor.token_hash]),
        );
        response = json({ ok: true }, 200, {
          'set-cookie':
            'tickets_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' +
            (production ? '; Secure' : ''),
        });
      } else if (path === '/api/v1/me' && method === 'GET')
        response = json(
          await run(true, async (tx, actor) => {
            const { token_hash, ...safe } = actor;
            return safe;
          }),
        );
      else if (path === '/api/v1/workspace/policy' && method === 'GET')
        response = json(await run(true, (tx, actor) => workspacePolicy.getPolicy(tx, actor)));
      else if (path === '/api/v1/workspace/policy' && method === 'PATCH') {
        const input = await body(request, schemas.WorkspacePolicyPatch);
        response = json(
          await run(false, (tx, actor) => workspacePolicy.updatePolicy(tx, actor, input)),
        );
      } else if (path === '/api/v1/catalog' && method === 'GET')
        response = json(
          await run(true, async (tx, actor) => ({
            workspace: await tx.one('SELECT * FROM workspaces WHERE id=?', [actor.workspace_id]),
            teams: await tx.all('SELECT * FROM teams WHERE workspace_id=? ORDER BY key', [
              actor.workspace_id,
            ]),
            statuses: await tx.all(
              'SELECT * FROM statuses WHERE workspace_id=? ORDER BY team_id,position',
              [actor.workspace_id],
            ),
            labels: await tx.all('SELECT * FROM labels WHERE workspace_id=? ORDER BY name', [
              actor.workspace_id,
            ]),
            people: await tx.all(
              'SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? ORDER BY u.name',
              [actor.workspace_id],
            ),
            modules: await listModules(tx, actor.workspace_id),
          })),
        );
      else if (path === '/api/v1/teams' && method === 'POST') {
        const input = await body(request, schemas.Team);
        response = json(await run(false, (tx, a) => identity.createTeam(tx, a, input)), 201);
      } else if (path === '/api/v1/statuses' && method === 'POST') {
        const input = await body(request, schemas.Status);
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'admin');
            assert(
              await tx.one('SELECT id FROM teams WHERE workspace_id=? AND id=?', [
                a.workspace_id,
                input.team_id,
              ]),
              422,
              'INVALID_TEAM',
              'Team not found',
            );
            const row = {
              id: id(),
              workspace_id: a.workspace_id,
              team_id: input.team_id,
              name: input.name.trim(),
              category: input.category,
              color: input.color,
              position: input.position ?? 100,
            };
            await tx.exec(
              'INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES(?,?,?,?,?,?,?)',
              Object.values(row),
            );
            return row;
          }),
          201,
        );
      } else if (path === '/api/v1/labels' && method === 'POST') {
        const input = await body(request, schemas.Label);
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'write');
            const row = {
              id: id(),
              workspace_id: a.workspace_id,
              name: input.name.trim(),
              color: input.color,
            };
            await tx.exec(
              'INSERT INTO labels(id,workspace_id,name,color) VALUES(?,?,?,?)',
              Object.values(row),
            );
            return row;
          }),
          201,
        );
      } else if (path === '/api/v1/invitations' && method === 'POST') {
        const input = await body(request, schemas.Invite);
        response = json(
          await run(false, async (tx, a) => {
            const invitation = await identity.invite(tx, a, input);
            const configured = emailConfiguration(env).configured;
            if (configured) {
              const link = new URL('/invite', origin);
              link.hash = new URLSearchParams({ token: invitation.token }).toString();
              await enqueueAccountEmail(tx, env, {
                kind: 'invitation',
                workspaceId: a.workspace_id,
                to: invitation.email,
                subject: 'You are invited to Tasks',
                expiresAt: new Date(Date.now() + 12 * 3600000).toISOString(),
                text: `You have been invited to a Tasks workspace.\n\nChoose your password and accept the invitation: ${link.href}\n\nThe invitation expires in seven days. Existing accounts must use their existing password.\n`,
              });
            }
            return { ...invitation, email_queued: configured };
          }),
          201,
        );
        dispatchMail();
      } else if (/^\/api\/v1\/members\/[^/]+$/.test(path) && method === 'PATCH') {
        const input = await body(request, schemas.MemberRole);
        response = json(
          await run(false, (tx, a) =>
            identity.changeRole(tx, a, path.split('/').at(-1), input.role),
          ),
        );
      } else if (path === '/api/v1/tokens' && method === 'POST') {
        const input = await body(request, schemas.Token);
        response = json(await run(false, (tx, a) => identity.issueToken(tx, a, input)), 201);
      } else if (path === '/api/v1/tokens' && method === 'GET')
        response = json(
          await run(true, (tx, a) =>
            tx.all(
              'SELECT id,name,scopes,expires_at,created_at FROM api_tokens WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC',
              [a.workspace_id, a.id],
            ),
          ),
        );
      else if (/^\/api\/v1\/tokens\/[^/]+$/.test(path) && method === 'DELETE') {
        response = json(
          await run(false, async (tx, a) => {
            await tx.exec('DELETE FROM api_tokens WHERE workspace_id=? AND user_id=? AND id=?', [
              a.workspace_id,
              a.id,
              path.split('/').at(-1),
            ]);
            return { ok: true };
          }),
        );
      } else if (path === '/api/v1/issues' && method === 'GET') {
        const filter = {};
        for (const [k, v] of url.searchParams) {
          if (['limit', 'cursor'].includes(k)) continue;
          filter[k] = ['archived', 'deleted'].includes(k)
            ? v === 'true'
              ? true
              : v === 'false'
                ? false
                : v
            : k === 'priority'
              ? Number(v)
              : v;
        }
        validate(filter, filterSchema);
        response = json(
          await run(true, (tx, a) =>
            tickets.listIssues(tx, a, filter, {
              limit: Number(url.searchParams.get('limit') ?? 100),
              cursor: url.searchParams.get('cursor'),
              secret: signingKey,
            }),
          ),
        );
      } else if (path === '/api/v1/issues' && method === 'POST') {
        const input = await body(request, schemas.IssueCreate);
        response = json(
          await run(false, (tx, a) =>
            tickets.createIssue(tx, a, input, {
              idempotencyKey: request.headers.get('idempotency-key'),
            }),
          ),
          201,
        );
      } else if (path === '/api/v1/issues/bulk' && method === 'PATCH') {
        const input = await body(request, schemas.IssueBulk);
        response = json(await run(false, (tx, a) => tickets.bulkUpdate(tx, a, input.updates)));
      } else if (/^\/api\/v1\/issues\/[^/]+$/.test(path)) {
        const key = decodeURIComponent(path.split('/').at(-1));
        if (method === 'GET')
          response = json(await run(true, (tx, a) => tickets.issueDetails(tx, a, key)));
        else if (method === 'PATCH') {
          const input = await body(request, schemas.IssuePatch);
          response = json(await run(false, (tx, a) => tickets.updateIssue(tx, a, key, input)));
        }
      } else if (/^\/api\/v1\/issues\/[^/]+\/comments$/.test(path) && method === 'POST') {
        const input = await body(request, schemas.Comment);
        response = json(
          await run(false, (tx, a) =>
            createIdempotently(
              tx,
              a,
              {
                key: request.headers.get('idempotency-key'),
                operation: 'comment:create',
                module: 'tickets',
                input: { issue: path.split('/')[4], ...input },
              },
              () => tickets.addComment(tx, a, path.split('/')[4], input.body),
            ),
          ),
          201,
        );
      } else if (/^\/api\/v1\/comments\/[^/]+$/.test(path) && method === 'PATCH') {
        const input = await body(request, schemas.CommentPatch);
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'write');
            const c = await tx.one('SELECT * FROM comments WHERE workspace_id=? AND id=?', [
              a.workspace_id,
              path.split('/').at(-1),
            ]);
            if (!c) throw missing('Comment');
            assert(
              c.author_id === a.id || ['owner', 'admin'].includes(a.role),
              403,
              'FORBIDDEN',
              'Only the author or an administrator can edit a comment',
            );
            if (c.version !== input.version) conflict(c);
            const issue = await tickets.getIssue(tx, a, c.issue_id);
            await tx.exec('UPDATE comments SET body=?,version=version+1,updated_at=? WHERE id=?', [
              input.body,
              now(),
              c.id,
            ]);
            await tickets.recordActivity(tx, a, issue, 'edited comment', { comment_id: c.id });
            return { ...c, body: input.body, version: c.version + 1 };
          }),
        );
      } else if (/^\/api\/v1\/issues\/[^/]+\/relations$/.test(path) && method === 'POST') {
        const input = await body(request, schemas.Relation);
        response = json(
          await run(false, (tx, a) => tickets.addRelation(tx, a, path.split('/')[4], input)),
          201,
        );
      } else if (/^\/api\/v1\/relations\/[^/]+$/.test(path) && method === 'DELETE')
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'write');
            const relation = await tx.one('SELECT * FROM relations WHERE workspace_id=? AND id=?', [
              a.workspace_id,
              path.split('/').at(-1),
            ]);
            if (!relation) throw missing('Relation');
            const issue = await tickets.getIssue(tx, a, relation.source_id);
            await tx.exec('DELETE FROM relations WHERE workspace_id=? AND id=?', [
              a.workspace_id,
              relation.id,
            ]);
            await tickets.recordActivity(tx, a, issue, 'unlinked', relation);
            return { ok: true };
          }),
        );
      else if (
        /^\/api\/v1\/issues\/[^/]+\/subscription$/.test(path) &&
        ['POST', 'DELETE'].includes(method)
      )
        response = json(
          await run(false, async (tx, a) => {
            const issue = await tickets.getIssue(tx, a, path.split('/')[4]);
            if (method === 'POST')
              await tx.exec(
                'INSERT INTO subscriptions(workspace_id,issue_id,user_id) VALUES(?,?,?) ON CONFLICT(issue_id,user_id) DO NOTHING',
                [a.workspace_id, issue.id, a.id],
              );
            else
              await tx.exec(
                'DELETE FROM subscriptions WHERE workspace_id=? AND issue_id=? AND user_id=?',
                [a.workspace_id, issue.id, a.id],
              );
            return { subscribed: method === 'POST' };
          }),
        );
      else if (path === '/api/v1/projects' && method === 'GET')
        response = json(await run(true, planning.listProjects));
      else if (path === '/api/v1/projects' && method === 'POST') {
        const input = await body(request, schemas.ProjectCreate);
        response = json(
          await run(false, (tx, a) =>
            createIdempotently(
              tx,
              a,
              {
                key: request.headers.get('idempotency-key'),
                operation: 'project:create',
                module: 'planning',
                input,
              },
              () => planning.createProject(tx, a, input),
            ),
          ),
          201,
        );
      } else if (/^\/api\/v1\/projects\/[^/]+$/.test(path) && method === 'PATCH') {
        const input = await body(request, schemas.ProjectPatch);
        response = json(
          await run(false, (tx, a) => planning.updateProject(tx, a, path.split('/').at(-1), input)),
        );
      } else if (path === '/api/v1/milestones' && method === 'GET')
        response = json(
          await run(true, async (tx, a) => {
            await assertModule(tx, a.workspace_id, 'planning');
            return tx.all('SELECT * FROM milestones WHERE workspace_id=? ORDER BY position', [
              a.workspace_id,
            ]);
          }),
        );
      else if (path === '/api/v1/milestones' && method === 'POST') {
        const input = await body(request, schemas.Milestone);
        response = json(await run(false, (tx, a) => planning.createMilestone(tx, a, input)), 201);
      } else if (path === '/api/v1/cycles' && method === 'GET')
        response = json(
          await run(true, async (tx, a) => {
            await assertModule(tx, a.workspace_id, 'cycles');
            return tx.all('SELECT * FROM cycles WHERE workspace_id=? ORDER BY start_date DESC', [
              a.workspace_id,
            ]);
          }),
        );
      else if (/^\/api\/v1\/cycles\/[^/]+$/.test(path) && method === 'PATCH') {
        const input = await body(request, schemas.CyclePatch);
        response = json(
          await run(false, (tx, actor) =>
            planning.updateCycle(tx, actor, decodeURIComponent(path.split('/').at(-1)), input),
          ),
        );
      } else if (path === '/api/v1/cycles' && method === 'POST') {
        const input = await body(request, schemas.Cycle);
        response = json(
          await run(false, (tx, a) =>
            createIdempotently(
              tx,
              a,
              {
                key: request.headers.get('idempotency-key'),
                operation: 'cycle:create',
                module: 'cycles',
                input,
              },
              () => planning.createCycle(tx, a, input),
            ),
          ),
          201,
        );
      } else if (path === '/api/v1/views' && method === 'GET')
        response = json(
          await run(true, async (tx, a) => {
            await assertModule(tx, a.workspace_id, 'views');
            return (
              await tx.all(
                'SELECT * FROM saved_views WHERE workspace_id=? AND (owner_id=? OR shared=1) ORDER BY name',
                [a.workspace_id, a.id],
              )
            ).map((v) => ({ ...v, filters: JSON.parse(v.filters) }));
          }),
        );
      else if (path === '/api/v1/views' && method === 'POST') {
        const input = await body(request, schemas.View);
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'write');
            await assertModule(tx, a.workspace_id, 'views');
            const row = {
              id: id(),
              workspace_id: a.workspace_id,
              owner_id: a.id,
              name: input.name.trim(),
              filters: JSON.stringify(input.filters),
              shared: input.shared ? 1 : 0,
              created_at: now(),
            };
            await tx.exec(
              'INSERT INTO saved_views(id,workspace_id,owner_id,name,filters,shared,created_at) VALUES(?,?,?,?,?,?,?)',
              Object.values(row),
            );
            return { ...row, filters: input.filters };
          }),
          201,
        );
      } else if (/^\/api\/v1\/views\/[^/]+$/.test(path) && method === 'DELETE')
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'write');
            await assertModule(tx, a.workspace_id, 'views');
            const view = await tx.one('SELECT * FROM saved_views WHERE workspace_id=? AND id=?', [
              a.workspace_id,
              path.split('/').at(-1),
            ]);
            if (!view) throw missing('View');
            assert(
              view.owner_id === a.id || ['owner', 'admin'].includes(a.role),
              403,
              'FORBIDDEN',
              'Only the owner or administrator may remove this view',
            );
            await tx.exec('DELETE FROM saved_views WHERE id=?', [view.id]);
            return { ok: true };
          }),
        );
      else if (path === '/api/v1/notifications' && method === 'GET')
        response = json(
          await run(true, async (tx, a) => {
            await assertModule(tx, a.workspace_id, 'notifications');
            return tx.all(
              'SELECT n.*,i.key,i.title FROM notifications n JOIN issues i ON i.id=n.issue_id WHERE n.workspace_id=? AND n.user_id=? ORDER BY n.created_at DESC LIMIT 200',
              [a.workspace_id, a.id],
            );
          }),
        );
      else if (/^\/api\/v1\/notifications\/[^/]+\/read$/.test(path) && method === 'POST')
        response = json(
          await run(false, async (tx, a) => {
            await assertModule(tx, a.workspace_id, 'notifications');
            await tx.exec(
              'UPDATE notifications SET read_at=? WHERE workspace_id=? AND user_id=? AND id=?',
              [now(), a.workspace_id, a.id, path.split('/')[4]],
            );
            return { ok: true };
          }),
        );
      else if (/^\/api\/v1\/modules\/[^/]+$/.test(path) && method === 'PATCH') {
        const input = await body(request, schemas.Module);
        response = json(
          await run(false, (tx, a) => setModule(tx, a, path.split('/').at(-1), input.enabled)),
        );
      } else if (/^\/api\/v1\/issues\/[^/]+\/attachments$/.test(path) && method === 'POST') {
        const input = await body(request, schemas.Attachment);
        response = json(
          await run(false, (tx, a) =>
            files.reserveAttachment(tx, a, path.split('/')[4], input, env),
          ),
          201,
        );
      } else if (/^\/api\/v1\/attachments\/[^/]+\/content$/.test(path) && method === 'PUT') {
        const bytes = await rawBody(request, files.MAX_UPLOAD);
        response = json(
          await run(false, (tx, a) =>
            files.uploadAttachment(tx, a, path.split('/')[4], bytes, store()),
          ),
          201,
        );
      } else if (/^\/api\/v1\/attachments\/[^/]+\/content$/.test(path) && method === 'GET') {
        const authorized = await run(true, (tx, a) =>
          files.authorizeDownload(tx, a, path.split('/')[4]),
        );
        const result = await files.downloadAttachment(authorized, store());
        response = result.url
          ? new Response(null, { status: 303, headers: { location: result.url } })
          : new Response(result.bytes, {
              headers: {
                'content-type': result.mime,
                'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
              },
            });
      } else if (/^\/api\/v1\/attachments\/[^/]+$/.test(path) && method === 'DELETE')
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'write');
            const file = await tx.one('SELECT * FROM attachments WHERE workspace_id=? AND id=?', [
              a.workspace_id,
              path.split('/').at(-1),
            ]);
            if (!file) throw missing('Attachment');
            assert(
              file.owner_id === a.id || ['owner', 'admin'].includes(a.role),
              403,
              'FORBIDDEN',
              'Only the uploader or administrator can remove this attachment',
            );
            await tx.exec("UPDATE attachments SET status='rejected' WHERE id=?", [file.id]);
            return { ok: true, object_retained_for_cleanup: true };
          }),
        );
      else if (path === '/api/v1/integrations' && method === 'GET')
        response = json(
          await run(true, async (tx, a) => {
            requirePermission(a, 'admin');
            const configs = await listModules(tx, a.workspace_id);
            return {
              github: {
                configured: Boolean(
                  env.INTEGRATIONS_WORKSPACE_ID === a.workspace_id &&
                  env.GITHUB_REPOSITORY &&
                  env.GITHUB_WEBHOOK_SECRET,
                ),
                outbound_configured: Boolean(env.GITHUB_TOKEN),
                repository: env.GITHUB_REPOSITORY || null,
                config: configs.find((m) => m.id === 'github')?.config,
              },
              slack: {
                configured: Boolean(
                  env.INTEGRATIONS_WORKSPACE_ID === a.workspace_id &&
                  env.SLACK_SIGNING_SECRET &&
                  env.SLACK_TEAM_ID &&
                  env.SLACK_CHANNEL_ID,
                ),
                outbound_configured: Boolean(env.SLACK_BOT_TOKEN),
                config: configs.find((m) => m.id === 'slack')?.config,
              },
              jobs: await tx.all(
                'SELECT provider,status,COUNT(*) AS count FROM webhook_deliveries WHERE workspace_id=? GROUP BY provider,status',
                [a.workspace_id],
              ),
              outbox: await tx.all(
                'SELECT provider,status,COUNT(*) AS count FROM outbox WHERE workspace_id=? GROUP BY provider,status',
                [a.workspace_id],
              ),
            };
          }),
        );
      else if (/^\/api\/v1\/integrations\/(github|slack)$/.test(path) && method === 'PATCH') {
        const provider = path.split('/').at(-1),
          input = await body(
            request,
            provider === 'github' ? schemas.GitHubConfig : schemas.SlackConfig,
          );
        response = json(
          await run(false, (tx, a) => integrations.setIntegrationConfig(tx, a, provider, input)),
        );
      } else if (/^\/api\/v1\/issues\/[^/]+\/export\/github$/.test(path) && method === 'POST')
        response = json(
          await run(false, async (tx, a) => {
            requirePermission(a, 'admin');
            await assertModule(tx, a.workspace_id, 'github');
            const issue = await tickets.getIssue(tx, a, path.split('/')[4]);
            const jobId = id();
            await tx.exec(
              "INSERT INTO outbox(id,workspace_id,provider,event,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,'github','export',?,'pending',0,?,?)",
              [
                jobId,
                a.workspace_id,
                JSON.stringify({
                  issue_id: issue.id,
                  key: issue.key,
                  title: issue.title,
                  description: issue.description,
                }),
                now(),
                now(),
              ],
            );
            return { job_id: jobId };
          }),
          202,
        );
      else if (/^\/api\/webhooks\/(github|slack)$/.test(path) && method === 'POST') {
        const raw = await rawBody(request),
          provider = path.split('/').at(-1);
        const result = await db.transaction((tx) =>
          integrations.receiveWebhook(tx, provider, request.headers, raw, env),
        );
        response =
          provider === 'slack'
            ? json({
                response_type: 'ephemeral',
                text: 'Request queued. A mapped member and a running worker are required.',
                ...result,
              })
            : json(result, 202);
      } else if (path === '/api/internal/account-email' && method === 'GET') {
        assert(
          env.CRON_SECRET && constantEqual(bearer ?? '', env.CRON_SECRET),
          401,
          'UNAUTHENTICATED',
          'Worker credential required',
        );
        response = json(
          await deliverAccountEmails(db, env, { transport: mailTransport, limit: 3 }),
        );
      } else if (path === '/api/internal/jobs' && method === 'POST') {
        assert(
          env.CRON_SECRET && constantEqual(bearer ?? '', env.CRON_SECRET),
          401,
          'UNAUTHENTICATED',
          'Worker credential required',
        );
        response = json({
          ...(await integrations.runWorker(db, env, { limit: 5 })),
          account_email: await deliverAccountEmails(db, env, {
            transport: mailTransport,
            limit: 3,
          }),
        });
      }
      if (!response) throw missing('Endpoint');
    } catch (error) {
      if (error instanceof AppError)
        response = json(
          {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
              request_id: requestId,
            },
          },
          error.status,
        );
      else if (
        ['23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code) ||
        /UNIQUE constraint failed/.test(error.message)
      )
        response = json(
          {
            error: {
              code: 'ALREADY_EXISTS',
              message: 'A record with this identifier already exists',
              request_id: requestId,
            },
          },
          409,
        );
      else {
        logger.error?.({ request_id: requestId, code: error.code ?? 'INTERNAL_ERROR' });
        response = json(
          {
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Request could not be completed',
              request_id: requestId,
            },
          },
          500,
        );
      }
    }
    response.headers.set('x-request-id', requestId);
    response.headers.set('cache-control', 'no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('referrer-policy', 'no-referrer');
    response.headers.set('x-frame-options', 'DENY');
    if (production)
      response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    return response;
  }
  return { fetch: handle };
}
