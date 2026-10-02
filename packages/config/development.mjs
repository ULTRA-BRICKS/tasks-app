// Single source of development defaults. Transport and UI configs import these.
export const DEFAULT_API_PORT = 8888;
export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_SQLITE_PATH = '.data/tickets.sqlite';
export function parsePort(value, fallback, name = 'port') {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer from 1 to 65535`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65535)
    throw new Error(`${name} must be an integer from 1 to 65535`);
  return parsed;
}
export function resolveDevelopment(env = {}) {
  const apiPort = parsePort(env.API_PORT, DEFAULT_API_PORT, 'API_PORT');
  const webPort = parsePort(env.WEB_PORT, DEFAULT_WEB_PORT, 'WEB_PORT');
  if (apiPort === webPort) throw new Error('API_PORT and WEB_PORT must differ');
  const apiHost = env.API_HOST || '127.0.0.1';
  if (!['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'].includes(apiHost))
    throw new Error('API_HOST must be a local or wildcard bind address');
  const host = apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost === '::' ? '::1' : apiHost;
  return {
    apiPort,
    webPort,
    apiHost,
    apiTarget: `http://${host.includes(':') ? `[${host}]` : host}:${apiPort}`,
    appUrl: env.APP_URL || `http://localhost:${webPort}`,
    sqlitePath: env.SQLITE_PATH || DEFAULT_SQLITE_PATH,
  };
}
export function applicationOrigin(env = {}) {
  const production = env.NODE_ENV === 'production' || Boolean(env.VERCEL);
  if (production && !env.APP_URL) throw new Error('APP_URL is required in production');
  const url = new URL(env.APP_URL || resolveDevelopment(env).appUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (production && url.protocol !== 'https:')
  )
    throw new Error(
      'APP_URL must be an origin without path or credentials; production requires HTTPS',
    );
  return url.origin;
}
export function isAllowedOrigin(candidate, env = {}) {
  const configured = new URL(applicationOrigin(env));
  if (candidate === configured.origin) return true;
  if (env.NODE_ENV === 'production' || env.VERCEL || !candidate) return false;
  try {
    const actual = new URL(candidate);
    const local = new Set(['localhost', '127.0.0.1', '[::1]']);
    return (
      actual.origin === candidate &&
      local.has(actual.hostname) &&
      local.has(configured.hostname) &&
      actual.protocol === configured.protocol &&
      actual.port === configured.port
    );
  } catch {
    return false;
  }
}
