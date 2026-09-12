import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import { assert, requirePermission, conflict } from '../../core/errors.mjs';
import { now } from '../../core/crypto.mjs';

export function normalizeDomains(value) {
  assert(
    Array.isArray(value) && value.length <= 50,
    422,
    'INVALID_DOMAINS',
    'Provide at most 50 email domains',
  );
  const result = [];
  for (const item of value) {
    assert(
      typeof item === 'string' && item.length <= 253 && !/[\s/@:*\\?#%]/.test(item.trim()),
      422,
      'INVALID_DOMAINS',
      'Use domain names, without @, wildcards, URL or path',
    );
    const domain = domainToASCII(item.trim().toLowerCase());
    const labels = domain.split('.');
    assert(
      !isIP(domain) &&
        domain.length <= 253 &&
        labels.length >= 2 &&
        labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)),
      422,
      'INVALID_DOMAINS',
      'Use valid email domain names',
    );
    result.push(domain);
  }
  return [...new Set(result)].sort();
}
export async function readPolicy(tx, workspaceId) {
  const row = await tx.one('SELECT * FROM workspace_policies WHERE workspace_id=?', [workspaceId]);
  return row
    ? {
        allowed_email_domains: JSON.parse(row.allowed_email_domains),
        version: row.version,
        updated_at: row.updated_at,
      }
    : { allowed_email_domains: [], version: 0, updated_at: null };
}
export async function getPolicy(tx, actor) {
  requirePermission(actor, 'admin');
  return readPolicy(tx, actor.workspace_id);
}
export async function updatePolicy(tx, actor, input) {
  requirePermission(actor, 'admin');
  await tx.lock(actor.workspace_id);
  const domains = normalizeDomains(input.allowed_email_domains);
  const current = await readPolicy(tx, actor.workspace_id);
  assert(
    Number.isInteger(input.version) && input.version >= 0,
    422,
    'VERSION_REQUIRED',
    'Provide the policy version',
  );
  if (input.version !== current.version) throw conflict(current);
  const result = {
    allowed_email_domains: domains,
    version: current.version + 1,
    updated_at: now(),
  };
  await tx.exec(
    'INSERT INTO workspace_policies(workspace_id,allowed_email_domains,version,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET allowed_email_domains=excluded.allowed_email_domains,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
    [actor.workspace_id, JSON.stringify(domains), result.version, actor.id, result.updated_at],
  );
  return result;
}
export async function assertEmailAllowed(tx, workspaceId, email) {
  const policy = await readPolicy(tx, workspaceId);
  if (!policy.allowed_email_domains.length) return;
  const pieces = typeof email === 'string' ? email.trim().split('@') : [];
  let domain = '';
  try {
    if (pieces.length === 2) domain = normalizeDomains([pieces[1]])[0];
  } catch {
    // A URL-like suffix must never be silently truncated into an allowed domain.
  }
  assert(
    domain && policy.allowed_email_domains.includes(domain),
    403,
    'EMAIL_DOMAIN_NOT_ALLOWED',
    'This email domain is not allowed by the workspace invitation policy',
  );
}
