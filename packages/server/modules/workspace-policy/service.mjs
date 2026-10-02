// Workspace invitation policy: an exact allowlist of normalized email domains.
// Enforced on invitation issue and re-checked atomically on acceptance, so a
// policy change invalidates outstanding invitations. It never gates logins of
// existing users. Writes require the admin scope plus an owner/admin role.
import { isIP } from 'node:net';
import { AppError, assert, conflict, requirePermission } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';

const MAX_DOMAINS = 50;
// One canonical ASCII (IDNA) lowercase form per domain; matching is exact,
// so a subdomain of an allowed domain is not automatically allowed.
export function normalizeDomain(input) {
  assert(typeof input === 'string', 422, 'INVALID_DOMAIN', 'Domain must be text');
  const raw = input.trim();
  assert(
    raw.length > 0 && raw.length <= 253,
    422,
    'INVALID_DOMAIN',
    'Domain length must be 1-253 characters',
  );
  assert(
    !/\s/.test(raw),
    422,
    'INVALID_DOMAIN',
    'Domains cannot contain whitespace; wildcards, URLs, users and IPs are rejected',
  );
  for (const c of raw)
    assert(
      /[a-zA-Z0-9.-]/.test(c) || c.charCodeAt(0) > 127,
      422,
      'INVALID_DOMAIN',
      `Unexpected character ${JSON.stringify(c)}; wildcards, URLs, users and IPs are rejected`,
    );
  let host;
  try {
    host = new URL('http://' + raw).hostname;
  } catch {
    throw new AppError(422, 'INVALID_DOMAIN', 'Not a valid domain name');
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  assert(
    !['[', ']', ':'].some((c) => host.includes(c)),
    422,
    'INVALID_DOMAIN',
    'IP addresses are not allowed',
  );
  assert(isIP(host) === 0, 422, 'INVALID_DOMAIN', 'IP addresses are not allowed');
  assert(host.length <= 253, 422, 'INVALID_DOMAIN', 'Domain length must be 1-253 characters');
  const labels = host.split('.');
  assert(labels.length >= 2, 422, 'INVALID_DOMAIN', 'Use a full domain such as example.com');
  for (const label of labels)
    assert(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label) && label.length <= 63,
      422,
      'INVALID_DOMAIN',
      `Invalid label ${JSON.stringify(label)} in ${host}`,
    );
  return host;
}

export async function getPolicy(tx, workspaceId) {
  const row = await tx.one(
    'SELECT allowed_email_domains, version FROM workspace_policy WHERE workspace_id=?',
    [workspaceId],
  );
  let domains = [];
  if (row?.allowed_email_domains) {
    try {
      domains = JSON.parse(row.allowed_email_domains);
    } catch {
      domains = [];
    }
  }
  return { allowed_email_domains: domains, version: row?.version ?? 1 };
}

export async function setPolicy(tx, actor, input) {
  requirePermission(actor, 'admin');
  const current = await getPolicy(tx, actor.workspace_id);
  if (input.version !== current.version) conflict(current);
  const domains = [];
  for (const entry of input.allowed_email_domains) {
    const domain = normalizeDomain(entry);
    if (!domains.includes(domain)) domains.push(domain);
  }
  assert(domains.length <= MAX_DOMAINS, 422, 'INVALID_DOMAIN', `At most ${MAX_DOMAINS} domains`);
  const version = current.version + 1;
  await tx.exec(
    `INSERT INTO workspace_policy(workspace_id,allowed_email_domains,version,updated_at)
     VALUES(?,?,?,?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       allowed_email_domains=excluded.allowed_email_domains,
       version=excluded.version,
       updated_at=excluded.updated_at`,
    [actor.workspace_id, JSON.stringify(domains), version, now()],
  );
  return { allowed_email_domains: domains, version };
}

export async function assertEmailAllowed(tx, workspaceId, email) {
  const { allowed_email_domains } = await getPolicy(tx, workspaceId);
  if (!allowed_email_domains.length) return;
  const raw = String(email).slice(String(email).lastIndexOf('@') + 1);
  let domain = null;
  try {
    domain = normalizeDomain(raw);
  } catch {
    // An email whose domain cannot be normalized can never match the allowlist.
  }
  assert(
    domain && allowed_email_domains.includes(domain),
    403,
    'DOMAIN_NOT_ALLOWED',
    `This workspace only accepts invitations for these email domains: ${allowed_email_domains.join(', ')}`,
    { allowed_email_domains },
  );
}
