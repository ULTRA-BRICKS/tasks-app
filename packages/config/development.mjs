// The only development port defaults. Server, Vite and setup import this module.
export const DEFAULT_API_PORT = 8888;
export const DEFAULT_WEB_PORT = 5173;
export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_SQLITE_PATH = '.data/tickets.sqlite';

export function port(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer from 1 to 65535`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65535)
    throw new Error(`${name} must be an integer from 1 to 65535`);
  return number;
}
export function resolveDevelopment(env = {}) {
  const apiPort = port(env.API_PORT, DEFAULT_API_PORT, 'API_PORT');
  const webPort = port(env.WEB_PORT, DEFAULT_WEB_PORT, 'WEB_PORT');
  if (apiPort === webPort) throw new Error('API_PORT and WEB_PORT must be different');
  const apiHost = env.API_HOST || DEFAULT_API_HOST;
  if (!['127.0.0.1', 'localhost', '::1', '0.0.0.0', '::'].includes(apiHost))
    throw new Error('API_HOST must be a loopback or wildcard bind address');
  const connectHost = apiHost === '0.0.0.0' ? DEFAULT_API_HOST : apiHost === '::' ? '::1' : apiHost;
  const apiTarget = `http://${connectHost.includes(':') ? `[${connectHost}]` : connectHost}:${apiPort}`;
  const appUrl = env.APP_URL || `http://localhost:${webPort}`;
  return {
    apiPort,
    webPort,
    apiHost,
    apiTarget,
    appUrl,
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
      'APP_URL must be an HTTP origin (HTTPS in production), without path or credentials',
    );
  return url.origin;
}

// Local host aliases only, same protocol/port. No wildcard CORS and no production relaxation.
export function isAllowedOrigin(candidate, env = {}) {
  const configured = new URL(applicationOrigin(env));
  if (candidate === configured.origin) return true;
  if (env.NODE_ENV === 'production' || env.VERCEL || !candidate) return false;
  try {
    const actual = new URL(candidate);
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
    return (
      actual.origin === candidate &&
      loopback.has(configured.hostname) &&
      loopback.has(actual.hostname) &&
      actual.port === configured.port &&
      actual.protocol === configured.protocol
    );
  } catch {
    return false;
  }
}
