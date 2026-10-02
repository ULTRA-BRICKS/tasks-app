import { resolveDevelopment } from '../../packages/config/development.mjs';
import { withLinear } from '../../packages/linear/handler.mjs';
import { createDatabase, migrate } from '../../packages/db/index.mjs';
import { bootstrap } from '../../packages/server/modules/identity/service.mjs';
import { createApp } from '../../packages/server/app.mjs';
/** `appOptions` reaches createApp, e.g. an injected `slackFetch` or a capturing `logger`. */
export async function fixture(
  extra = {},
  databaseOptions = { sqlitePath: ':memory:' },
  appOptions = {},
) {
  let cleanup = async () => {};
  if (process.env.TEST_DATABASE_URL && databaseOptions.sqlitePath === ':memory:') {
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
    const schema = 'tickets_test_' + crypto.randomUUID().replaceAll('-', '');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    databaseOptions = { url: url.toString() };
    cleanup = async () => {
      try {
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        await admin.end();
      }
    };
  }
  const db = await createDatabase(databaseOptions);
  await migrate(db);
  const init = await bootstrap(db, {
    email: 'owner@example.test',
    name: 'Owner',
    password: 'a-secure-test-password',
    workspaceName: 'Test workspace',
    slug: 'testing',
  });
  const objects = new Map();
  const storage = {
    put: async (k, b) => objects.set(k, Buffer.from(b)),
    download: async (k) => ({ bytes: objects.get(k) }),
  };
  const env = {
    APP_URL: 'http://localhost:5173',
    AUTH_SECRET: 'a'.repeat(48),
    NODE_ENV: 'test',
    ...extra,
  };
  const app = withLinear(
    createApp({ db, env, storage, logger: { error: () => {} }, ...appOptions }),
    { db, env },
  );
  let session;
  async function request(method, path, data, options = {}) {
    const headers = {
      'content-type': 'application/json',
      'x-tickets-csrf': '1',
      origin: env.APP_URL,
      ...(session && !options.anonymous ? { cookie: session } : {}),
      ...options.headers,
    };
    if (options.noCsrf) delete headers['x-tickets-csrf'];
    const response = await app.fetch(
      new Request(resolveDevelopment().apiTarget + path, {
        method,
        headers,
        ...(!['GET', 'HEAD'].includes(method) && data !== undefined
          ? { body: options.raw ? data : JSON.stringify(data) }
          : {}),
      }),
    );
    const text = await response.text();
    let value;
    try {
      value = text ? JSON.parse(text) : null;
    } catch {
      value = text;
    }
    return { status: response.status, data: value, headers: response.headers };
  }
  const login = await request('POST', '/api/auth/login', {
    email: 'owner@example.test',
    password: 'a-secure-test-password',
  });
  if (login.status !== 200) throw new Error(JSON.stringify(login));
  session = login.headers.get('set-cookie').split(';')[0];
  const catalog = (await request('GET', '/api/v1/catalog')).data;
  const create = (data = {}) =>
    request('POST', '/api/v1/issues', { team_id: init.team_id, title: 'A useful issue', ...data });
  return {
    db,
    init,
    app,
    env,
    request,
    create,
    catalog,
    storage,
    objects,
    get session() {
      return session;
    },
    setSession(value) {
      session = value;
    },
    close: async () => {
      try {
        await db.close();
      } finally {
        await cleanup();
      }
    },
  };
}
