export const REPOSITORY = 'alex-mextner/tickets-app';
export const TEAM_ID = 'team_uZF73oVZtW9ADjSLBDsAy5DW';

export function validateLink(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a Vercel project link. Run vercel link in the repository root.');
  if (typeof value.projectId !== 'string' || !/^prj_[A-Za-z0-9]+$/.test(value.projectId))
    throw new Error('Invalid Vercel project ID.');
  if (value.orgId !== TEAM_ID)
    throw new Error('The linked project belongs to a different Vercel team.');
  if (value.projectName !== undefined && value.projectName !== 'tickets-app')
    throw new Error('The linked project is not tickets-app.');
  return { VERCEL_ORG_ID: value.orgId, VERCEL_PROJECT_ID: value.projectId };
}

export function planConfiguration(link, variables = [], secrets = []) {
  const values = validateLink(link);
  if (!Array.isArray(variables) || !Array.isArray(secrets))
    throw new Error('Invalid GitHub metadata.');
  const commands = [];
  for (const [name, value] of Object.entries(values)) {
    // The existing workflow prefers secrets to vars. Do not create an ignored var
    // when an unreadable legacy secret could still target a different project.
    if (secrets.some((entry) => entry.name === name))
      throw new Error(
        `Legacy secret ${name} exists. Verify it manually before switching to variables.`,
      );
    const existing = variables.find((entry) => entry.name === name);
    if (existing && existing.value !== value)
      throw new Error(
        `${name} already targets a different project or team; refusing to overwrite it.`,
      );
    if (!existing)
      commands.push(['gh', 'variable', 'set', name, '--repo', REPOSITORY, '--body', value]);
  }
  if (!secrets.some((entry) => entry.name === 'VERCEL_TOKEN'))
    commands.push(['gh', 'secret', 'set', 'VERCEL_TOKEN', '--repo', REPOSITORY]);
  return commands;
}

export async function configure({ link, apply = false, tty = false, run }) {
  const values = validateLink(link);
  if (!apply) return { applied: false, values, commands: planConfiguration(link) };
  await run(['gh', 'auth', 'status']);
  const repository = await run([
    'gh',
    'repo',
    'view',
    REPOSITORY,
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ]);
  if (repository.trim() !== REPOSITORY) throw new Error('Unexpected GitHub repository.');
  const variables = JSON.parse(
    await run(['gh', 'variable', 'list', '--repo', REPOSITORY, '--json', 'name,value']),
  );
  const secrets = JSON.parse(
    await run(['gh', 'secret', 'list', '--repo', REPOSITORY, '--json', 'name']),
  );
  const commands = planConfiguration(link, variables, secrets);
  if (commands.some((args) => args[1] === 'secret') && !tty)
    throw new Error('A terminal is required for hidden token input. No configuration was changed.');
  const completed = [];
  for (const args of commands) {
    await run(args, { interactive: args[1] === 'secret' });
    completed.push(args[3]);
  }
  return { applied: true, values, completed };
}

if (import.meta.main) {
  console.error(
    'This GitHub publisher setup is retired. Use the existing Forgejo/Vercel configuration in docs/OPERATIONS.md. No configuration was changed.',
  );
  process.exitCode = 1;
}
