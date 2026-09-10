export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export function assert(condition, status, code, message, details) {
  if (!condition) throw new AppError(status, code, message, details);
}
export const missing = (thing = 'Resource') => new AppError(404, 'NOT_FOUND', `${thing} not found`);
export function conflict(current) {
  throw new AppError(
    409,
    'VERSION_CONFLICT',
    'This item changed. Reload the current version before saving.',
    { current },
  );
}
export function requirePermission(actor, scope = 'read') {
  assert(actor, 401, 'UNAUTHENTICATED', 'Sign in to continue');
  assert(
    actor.scopes.includes(scope),
    403,
    'INSUFFICIENT_SCOPE',
    `Token requires the ${scope} scope`,
  );
  if (scope === 'write')
    assert(actor.role !== 'viewer', 403, 'READ_ONLY', 'Viewers cannot change workspace data');
  if (scope === 'admin')
    assert(
      ['owner', 'admin'].includes(actor.role),
      403,
      'FORBIDDEN',
      'Workspace administrator permission required',
    );
}
