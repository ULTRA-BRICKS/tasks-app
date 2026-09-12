import { randomBytes } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';
import { open, lstat, rename, unlink } from 'node:fs/promises';
import {
  resolveDevelopment,
  applicationOrigin,
  parsePort,
} from '../packages/config/development.mjs';
export function setupOptions(args) {
  const { values } = parseArgs({
    args: args.filter((x) => x !== '--'),
    allowPositionals: false,
    strict: true,
    options: {
      demo: { type: 'boolean' },
      port: { type: 'string' },
      'web-port': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  for (const key of ['port', 'web-port'])
    if (values[key] !== undefined) {
      if (!values[key]) throw new Error(`--${key} requires a nonempty port`);
      parsePort(values[key], undefined, key);
    }
  return values;
}
function dotenvValue(value) {
  // dotenv quoting is not JSON escaping: keep literal backslashes intact.
  if (/[\r\n\0]/.test(value)) throw new Error('Setup values must fit on one line');
  if (!value.includes("'")) return "'" + value + "'";
  if (!value.includes('"')) return '"' + value + '"';
  throw new Error('Setup cannot safely quote a value containing both quote characters');
}
function setKey(text, key, value) {
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, 'gm');
  if ((text.match(pattern) ?? []).length > 1)
    throw new Error(`Duplicate ${key}; resolve before setup`);
  const line = `${key}=${dotenvValue(value)}`;
  return pattern.test(text)
    ? text.replace(pattern, () => line)
    : text.trimEnd() + '\n' + line + '\n';
}
export function buildLocalEnvironment(text, options = {}, shell = {}) {
  const previous = parseEnv(text),
    env = { ...previous, ...shell };
  if (
    options.demo &&
    (env.NODE_ENV === 'production' ||
      env.VERCEL ||
      env.DATABASE_URL?.trim() ||
      env.DATABASE_URL_UNPOOLED?.trim())
  )
    throw new Error('--demo is local-only; cloud configuration and data were not changed');
  const config = resolveDevelopment({
    ...env,
    API_PORT: options.port ?? env.API_PORT,
    WEB_PORT: options['web-port'] ?? env.WEB_PORT,
  });
  let appUrl = config.appUrl;
  if (options['web-port'] && env.APP_URL) {
    const url = new URL(env.APP_URL);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      url.port = String(config.webPort);
      appUrl = url.origin;
    }
  }
  applicationOrigin({ ...env, APP_URL: appUrl });
  const updates = {
    API_PORT: String(config.apiPort),
    WEB_PORT: String(config.webPort),
    APP_URL: appUrl,
    SQLITE_PATH: config.sqlitePath,
  };
  for (const key of ['AUTH_SECRET', 'CRON_SECRET'])
    if (!previous[key]) updates[key] = env[key] || randomBytes(32).toString('base64url');
  let output = text;
  for (const [key, value] of Object.entries(updates)) output = setKey(output, key, value);
  return { text: output, env: { ...env, ...parseEnv(output) }, config: { ...config, appUrl } };
}
export async function writeLocalEnvironment(file, text) {
  const existing = await lstat(file).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink()))
    throw new Error('Environment must be a regular file');
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = await open(temp, 'wx', 0o600);
  try {
    await fd.writeFile(text, 'utf8');
    await fd.sync();
    await fd.close();
    await rename(temp, file);
  } catch (error) {
    await fd.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}
