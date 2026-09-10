import { id, now, secret, sha256, hashPassword, verifyPassword } from '../../core/crypto.mjs';
import { assert, requirePermission, missing } from '../../core/errors.mjs';
import { MODULES } from '../../core/modules.mjs';

const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
export const sessionScopes = (role) =>
  role === 'viewer'
    ? ['read']
    : ['owner', 'admin'].includes(role)
      ? ['read', 'write', 'admin']
      : ['read', 'write'];
export async function createTeam(tx, actor, data) {
  requirePermission(actor, 'admin');
  const team = {
    id: id(),
    workspace_id: actor.workspace_id,
    key: data.key,
    name: data.name.trim(),
  };
  assert(
    !(await tx.one('SELECT id FROM teams WHERE workspace_id=? AND key=?', [
      actor.workspace_id,
      data.key,
    ])),
    409,
    'DUPLICATE_KEY',
    'Team identifier already exists',
  );
  await tx.exec(
    'INSERT INTO teams(id,workspace_id,key,name,next_number) VALUES(?,?,?,?,1)',
    Object.values(team),
  );
  const states = [
    ['Triage', 'triage', '#8b8b95'],
    ['Backlog', 'backlog', '#787885'],
    ['Todo', 'unstarted', '#c1c1ca'],
    ['In progress', 'started', '#e2b74a'],
    ['In review', 'started', '#ad91f2'],
    ['Done', 'completed', '#7790ee'],
    ['Canceled', 'canceled', '#868691'],
  ];
  for (const [position, [name, category, color]] of states.entries()) {
    await tx.exec(
      'INSERT INTO statuses(id,workspace_id,team_id,name,category,color,position) VALUES(?,?,?,?,?,?,?)',
      [id(), actor.workspace_id, team.id, name, category, color, position],
    );
  }
  return team;
}
export async function bootstrap(
  db,
  { email, name, password, workspaceName = 'My workspace', slug = 'my-workspace' },
) {
  assert(
    email && name && password?.length >= 12,
    422,
    'BOOTSTRAP_CONFIG',
    'Provide email, name and a password of at least 12 characters',
  );
  assert(
    /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug),
    422,
    'INVALID_SLUG',
    'Use a lowercase workspace slug',
  );
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    await tx.lock('tickets-app:bootstrap');
    assert(
      !(await tx.one('SELECT id FROM users LIMIT 1')),
      409,
      'ALREADY_INITIALIZED',
      'Bootstrap only works on an empty database',
    );
    const userId = id(),
      workspaceId = id(),
      created = now();
    await tx.exec('INSERT INTO workspaces(id,name,slug,created_at) VALUES(?,?,?,?)', [
      workspaceId,
      workspaceName,
      slug,
      created,
    ]);
    await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
      userId,
      email.trim().toLowerCase(),
      name.trim(),
      passwordHash,
      created,
    ]);
    await tx.exec('INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?)', [
      workspaceId,
      userId,
      'owner',
    ]);
    const actor = {
      id: userId,
      workspace_id: workspaceId,
      role: 'owner',
      scopes: sessionScopes('owner'),
      name,
      email,
    };
    const team = await createTeam(tx, actor, { key: 'TKT', name: 'Engineering' });
    for (const module of MODULES)
      await tx.exec(
        'INSERT INTO module_settings(workspace_id,module,enabled,config) VALUES(?,?,?,?)',
        [workspaceId, module.id, 1, '{}'],
      );
    for (const [label, color] of [
      ['Bug', '#dc7373'],
      ['Feature', '#ad91f2'],
      ['Improvement', '#7790ee'],
      ['Documentation', '#70bba0'],
    ]) {
      await tx.exec('INSERT INTO labels(id,workspace_id,name,color) VALUES(?,?,?,?)', [
        id(),
        workspaceId,
        label,
        color,
      ]);
    }
    return { workspace_id: workspaceId, user_id: userId, team_id: team.id, slug };
  });
}
export async function rateLimit(tx, key, limit = 12, seconds = 900) {
  // A separate, committed transaction must call this BEFORE the potentially failing login transaction.
  const start = new Date(Date.now() - seconds * 1000).toISOString();
  const row = await tx.one('SELECT attempts,window_start FROM auth_attempts WHERE key=?', [key]);
  if (!row || row.window_start < start) {
    await tx.exec(
      'INSERT INTO auth_attempts(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=1,window_start=excluded.window_start',
      [key, now()],
    );
    return true;
  }
  if (row.attempts >= limit) return false;
  await tx.exec('UPDATE auth_attempts SET attempts=attempts+1 WHERE key=?', [key]);
  return true;
}
export async function login(db, input, clientKey) {
  const normalized = input.email.trim().toLowerCase();
  const allowed = await db.transaction(async (tx) => {
    await tx.lock('auth-rate-limit');
    return rateLimit(tx, 'login:' + sha256(normalized + '|' + clientKey));
  });
  assert(allowed, 429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.');
  // Expensive password hashing is outside the database transaction.
  const user = await db.transaction((tx) =>
    tx.one('SELECT * FROM users WHERE email=?', [normalized]),
  );
  const valid = user
    ? await verifyPassword(input.password, user.password_hash)
    : await verifyPassword(input.password, await hashPassword(secret()));
  assert(valid && user, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  return db.transaction(async (tx) => {
    const membership = await tx.one(
      `SELECT m.*,w.slug FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=? ${input.workspace_slug ? 'AND w.slug=?' : ''} ORDER BY w.created_at LIMIT 1`,
      input.workspace_slug ? [user.id, input.workspace_slug] : [user.id],
    );
    assert(membership, 401, 'INVALID_CREDENTIALS', 'Invalid email or workspace');
    const token = secret();
    await tx.exec(
      'INSERT INTO sessions(hash,user_id,workspace_id,expires_at,created_at) VALUES(?,?,?,?,?)',
      [sha256(token), user.id, membership.workspace_id, days(7), now()],
    );
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: membership.role,
        workspace_id: membership.workspace_id,
      },
    };
  });
}
export async function authenticate(tx, { bearer, cookie }) {
  const token = bearer || cookie;
  if (!token) return null;
  const isPat = Boolean(bearer);
  const row = await tx.one(
    `SELECT t.*,u.id AS user_id,u.name,u.email,m.role FROM ${isPat ? 'api_tokens' : 'sessions'} t JOIN users u ON u.id=t.user_id JOIN memberships m ON m.user_id=t.user_id AND m.workspace_id=t.workspace_id WHERE t.hash=? AND t.expires_at>?`,
    [sha256(token), now()],
  );
  if (!row) return null;
  const allowed = sessionScopes(row.role);
  return {
    id: row.user_id,
    name: row.name,
    email: row.email,
    workspace_id: row.workspace_id,
    role: row.role,
    scopes: isPat ? JSON.parse(row.scopes).filter((s) => allowed.includes(s)) : allowed,
    auth_type: isPat ? 'token' : 'session',
    token_hash: sha256(token),
  };
}
export async function invite(tx, actor, input) {
  requirePermission(actor, 'admin');
  const email = input.email.trim().toLowerCase();
  assert(
    !(await tx.one(
      'SELECT u.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?',
      [actor.workspace_id, email],
    )),
    409,
    'ALREADY_MEMBER',
    'This person is already a workspace member',
  );
  const token = secret(),
    invitation = { id: id(), email, role: input.role, expires_at: days(7) };
  await tx.exec(
    'INSERT INTO invitations(id,hash,workspace_id,email,role,expires_at,created_at) VALUES(?,?,?,?,?,?,?)',
    [
      invitation.id,
      sha256(token),
      actor.workspace_id,
      email,
      input.role,
      invitation.expires_at,
      now(),
    ],
  );
  return { ...invitation, token }; // returned once; never logged, never stored as plaintext
}
export async function acceptInvite(db, input) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.lock('tickets-app:accept-invite');
    const invitation = await tx.one(
      'SELECT * FROM invitations WHERE hash=? AND used_at IS NULL AND expires_at>?',
      [sha256(input.token), now()],
    );
    assert(invitation, 410, 'INVITE_EXPIRED', 'Invitation is invalid, expired, or already used');
    const existing = await tx.one('SELECT * FROM users WHERE email=?', [invitation.email]);
    // An invitation is never allowed to reset an existing account password.
    assert(
      !existing || (await verifyPassword(input.password, existing.password_hash)),
      409,
      'EXISTING_ACCOUNT',
      'Use the existing account password to accept this invitation',
    );
    const userId = existing?.id || id();
    if (!existing)
      await tx.exec('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)', [
        userId,
        invitation.email,
        input.name.trim(),
        passwordHash,
        now(),
      ]);
    await tx.exec(
      'INSERT INTO memberships(workspace_id,user_id,role) VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO NOTHING',
      [invitation.workspace_id, userId, invitation.role],
    );
    await tx.exec('UPDATE invitations SET used_at=? WHERE id=?', [now(), invitation.id]);
    return { email: invitation.email, workspace_id: invitation.workspace_id };
  });
}
export async function issueToken(tx, actor, input) {
  requirePermission(actor, 'read');
  for (const scope of input.scopes)
    assert(
      actor.scopes.includes(scope),
      403,
      'SCOPE_ESCALATION',
      'Cannot grant permissions you do not have',
    );
  assert(
    input.scopes.includes('read'),
    422,
    'READ_SCOPE_REQUIRED',
    'Tokens require read permission; add write/admin only when necessary',
  );
  const token = 'tkt_' + secret(),
    result = {
      id: id(),
      name: input.name,
      scopes: input.scopes,
      expires_at: days(input.days ?? 90),
    };
  await tx.exec(
    'INSERT INTO api_tokens(id,hash,name,user_id,workspace_id,scopes,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
    [
      result.id,
      sha256(token),
      result.name,
      actor.id,
      actor.workspace_id,
      JSON.stringify(result.scopes),
      result.expires_at,
      now(),
    ],
  );
  return { ...result, token };
}
export async function changeRole(tx, actor, userId, role) {
  requirePermission(actor, 'admin');
  const member = await tx.one('SELECT * FROM memberships WHERE workspace_id=? AND user_id=?', [
    actor.workspace_id,
    userId,
  ]);
  if (!member) throw missing('Member');
  if (role === 'owner' || member.role === 'owner')
    assert(
      actor.role === 'owner',
      403,
      'OWNER_REQUIRED',
      'Only an owner can grant or change ownership',
    );
  if (member.role === 'owner' && role !== 'owner') {
    const { count } = await tx.one(
      "SELECT COUNT(*) AS count FROM memberships WHERE workspace_id=? AND role='owner'",
      [actor.workspace_id],
    );
    assert(Number(count) > 1, 409, 'LAST_OWNER', 'A workspace must have at least one owner');
  }
  await tx.exec('UPDATE memberships SET role=? WHERE workspace_id=? AND user_id=?', [
    role,
    actor.workspace_id,
    userId,
  ]);
  return { user_id: userId, role };
}
