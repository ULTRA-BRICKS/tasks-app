/** Messages for the `?slack_signin=<code>` redirect of /api/auth/slack/callback. */
const MESSAGES = new Map([
  [
    'not_a_member',
    'This Slack account is not a member of this workspace. Ask your workspace owner for an invitation.',
  ],
  ['slack_wrong_team', 'Sign in with the Slack workspace connected to Tasks.'],
  ['slack_denied', 'Slack sign-in was cancelled.'],
  ['rate_limited', 'Too many attempts. Try again in 15 minutes.'],
  ['slack_unreachable', 'Slack could not be reached. Try again.'],
]);
/** The query value is attacker-controlled: unknown codes (including `__proto__`) get the generic text. */
export function slackSigninMessage(code: string | null): string | null {
  if (!code) return null;
  return MESSAGES.get(code) ?? 'Sign in with Slack failed. Try again.';
}
