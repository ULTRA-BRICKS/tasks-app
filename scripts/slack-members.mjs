// Adds the humans of the connected Slack workspace as Tasks members, maps them and syncs Slack
// names and photos. Dry run unless --apply. Reads DATABASE_URL, SLACK_BOT_TOKEN, SLACK_TEAM_ID and
// INTEGRATIONS_WORKSPACE_ID from the environment (the tasks credentials file); prints no secret.
//   bun scripts/slack-members.mjs [--apply] [--role member|admin|viewer] [--include-guests]
import { createDatabase } from '../packages/db/index.mjs';
import { importSlackMembers } from '../packages/server/modules/integrations/slack-members.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const roleAt = args.indexOf('--role');
const role = roleAt === -1 ? 'member' : args[roleAt + 1];
if (!['member', 'admin', 'viewer'].includes(role)) throw new Error('--role: member|admin|viewer');
const db = await createDatabase({
  url: process.env.DATABASE_URL,
  sqlitePath: process.env.SQLITE_PATH,
  production: process.env.NODE_ENV === 'production',
});
try {
  const report = await importSlackMembers({
    db,
    env: process.env,
    apply,
    role,
    includeGuests: args.includes('--include-guests'),
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
  if (report.failed.length || report.sync?.error) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      error: error.code ?? 'ERROR',
      message: error.message,
      details: error.details,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
