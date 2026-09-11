import { randomBytes } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { resolveDevelopment, applicationOrigin, port } from '../packages/config/development.mjs';

export function setupOptions(args) {
  const { values } = parseArgs({
    args: args.filter((s) => s !== '--'),
    strict: true,
    allowPositionals: false,
    options: {
      demo: { type: 'boolean' },
      port: { type: 'string' },
      'web-port': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  // Validate before touching files or installing dependencies.
  if (values.port !== undefined) port(values.port, undefined, 'API_PORT');
  if (values['web-port'] !== undefined) port(values['web-port'], undefined, 'WEB_PORT');
  return values;
}
function replaceKey(text, key, value) {
  const pattern = new RegExp(`^[ \t]*(?:export[ \t]+)?${key}[ \t]*=.*$`, 'gm');
  if ((text.match(pattern) ?? []).length > 1)
    throw new Error(`Duplicate ${key} in .env.local; resolve it before setup`);
  const line = `${key}=${JSON.stringify(value)}`;
  return pattern.test(text)
    ? text.replace(pattern, () => line)
    : text.trimEnd() + '\n' + line + '\n';
}
export function buildLocalEnvironment(text, options = {}, shell = {}) {
  const previous = parseEnv(text);
  const env = { ...previous, ...shell };
  if (
    options.demo &&
    (env.NODE_ENV === 'production' ||
      env.VERCEL ||
      env.DATABASE_URL?.trim() ||
      env.DATABASE_URL_UNPOOLED?.trim())
  )
    throw new Error(
      '--demo refuses cloud/production configuration. Existing files and databases were not changed.',
    );
  const config = resolveDevelopment({
    ...env,
    API_PORT: options.port ?? env.API_PORT,
    WEB_PORT: options['web-port'] ?? env.WEB_PORT,
  });
  let appUrl = env.APP_URL || config.appUrl;
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
  for (const [key, value] of Object.entries(updates)) output = replaceKey(output, key, value);
  return { text: output, env: { ...env, ...parseEnv(output) }, config: { ...config, appUrl } };
}
export async function writeLocalEnvironment(file, text) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Refusing to replace a non-regular environment file');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
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
