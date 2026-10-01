import { assert } from './errors.mjs';
import {
  isBotProfile,
  normalizeEmail,
  resolveIdentities,
} from '../../../src/shared/lib/canonical-people.mjs';
/** Imported people are attribution rows. This function never inserts accounts/memberships. */
export async function resolvePerson(tx, actor, value) {
  if (value == null) return { member: null, source: null };
  if (
    await tx.one('SELECT user_id FROM memberships WHERE workspace_id=? AND user_id=?', [
      actor.workspace_id,
      value,
    ])
  )
    return { member: value, source: null };
  const found = await tx.one('SELECT id FROM source_people WHERE workspace_id=? AND id=?', [
    actor.workspace_id,
    value,
  ]);
  assert(found, 422, 'INVALID_PERSON', 'Person is not part of this workspace');
  return { member: null, source: value };
}
/** Private settings row the Slack profile sync owns (docs/SLACK-PROFILES.md): per-profile flags,
 * the audit trail and a rate-limit pause. It is not a module and is never listed or toggled. */
export const SLACK_PROFILE_STATE = 'slack-profiles';
/** @returns {Promise<{profiles:Record<string,{bot?:true,deactivated?:true}>,runs:object[],paused_until?:string}>} */
export async function slackProfileState(tx, workspace) {
  const row = await tx.one('SELECT config FROM module_settings WHERE workspace_id=? AND module=?', [
    workspace,
    SLACK_PROFILE_STATE,
  ]);
  const state = JSON.parse(row?.config ?? '{}');
  return { ...state, profiles: state.profiles ?? {}, runs: state.runs ?? [] };
}
async function listSourcePeople(tx, workspace) {
  const rows = await tx.all(
    'SELECT id,name,email,avatar_url,provider,source_id FROM source_people WHERE workspace_id=? ORDER BY name,id',
    [workspace],
  );
  const { profiles } = await slackProfileState(tx, workspace);
  return rows.map((row) => ({
    ...row,
    bot: isBotProfile({
      ...row,
      bot: row.provider === 'slack' ? profiles[row.source_id]?.bot : undefined,
    }),
  }));
}
/** Rows for the identity projection and inventory, read with SELECT statements only. */
export async function loadIdentityInputs(tx, workspace) {
  const slack = await tx.one(
    "SELECT enabled,config FROM module_settings WHERE workspace_id=? AND module='slack'",
    [workspace],
  );
  const config = JSON.parse(slack?.config ?? '{}');
  const map = (value) => (value && typeof value === 'object' ? value : {});
  return {
    workspace_id: workspace,
    members: await tx.all(
      'SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.workspace_id=? ORDER BY u.name',
      [workspace],
    ),
    sources: await listSourcePeople(tx, workspace),
    slack: {
      enabled: slack?.enabled !== 0,
      userMap: map(config.user_map),
      sourceMap: map(config.source_person_map),
    },
  };
}
/** Each administrator-saved Slack mapping (Slack user ID → member, or → imported person) with the
 * reason it is, or is not, identity evidence. Slack source profiles use `<team>:<user>` source
 * IDs; a user ID found under more than one team is ambiguous and never binds. */
function slackMappingEntries({ enabled, userMap, sourceMap }, members, sources) {
  const memberIds = new Set(members.map((member) => member.id));
  const importedIds = new Set(
    sources.filter((source) => source.provider !== 'slack').map((source) => source.id),
  );
  /** @type {Map<string, string[]>} */
  const profiles = new Map();
  for (const source of sources)
    if (source.provider === 'slack') {
      const user = String(source.source_id).split(':').at(-1);
      const known = profiles.get(user);
      if (known) known.push(source.id);
      else profiles.set(user, [source.id]);
    }
  const entries = [
    ...Object.entries(userMap ?? {}).map(([slackUserId, memberId]) => ({
      via: 'slack_user_map',
      slackUserId,
      target: { member_id: memberId },
      unknown: !memberIds.has(memberId) && 'unknown_member',
    })),
    ...Object.entries(sourceMap ?? {}).map(([slackUserId, personId]) => ({
      via: 'slack_source_person_map',
      slackUserId,
      target: { person_id: personId },
      unknown: !importedIds.has(personId) && 'unknown_person',
    })),
  ];
  return entries
    .sort((a, b) =>
      a.slackUserId === b.slackUserId
        ? a.via.localeCompare(b.via)
        : a.slackUserId < b.slackUserId
          ? -1
          : 1,
    )
    .map(({ via, slackUserId, target, unknown }) => {
      const matches = profiles.get(slackUserId) ?? [];
      return {
        via,
        slack_user_id: slackUserId,
        ...target,
        source_person_id: matches.length === 1 ? matches[0] : null,
        status: !enabled
          ? 'module_disabled'
          : unknown
            ? unknown
            : matches.length === 0
              ? 'no_source_profile'
              : matches.length > 1
                ? 'ambiguous_source_profile'
                : 'applied',
      };
    });
}
/** Verified member or imported person ↔ Slack profile pairs, the only ones the projection may
 * apply; each carries exactly one of `member_id` and `person_id`.
 * @param {ReturnType<typeof slackMappingEntries>} entries */
const appliedBindings = (entries) =>
  entries
    .filter((entry) => entry.status === 'applied')
    .map(({ member_id, person_id, source_person_id, via }) =>
      member_id === undefined
        ? { person_id, source_person_id, via }
        : { member_id, source_person_id, via },
    );
/** tx → workspace → Promise<directory> */
const directories = new WeakMap();
/** The projection the client builds from the catalog, for server-rendered names and alias
 * filters: `byAlias` maps every stored person ID, `bySource` maps `<provider>:<source_id>`;
 * `inputs` and `bindings` are the rows the catalog returns. Loaded once per transaction; IDs
 * added later in the same transaction fall back to their stored names. */
export function identityDirectory(tx, workspace) {
  const cache = directories.get(tx) ?? new Map();
  directories.set(tx, cache);
  if (!cache.has(workspace))
    cache.set(
      workspace,
      loadIdentityInputs(tx, workspace).then((inputs) => {
        const bindings = appliedBindings(
          slackMappingEntries(inputs.slack, inputs.members, inputs.sources),
        );
        const { people } = resolveIdentities(inputs.members, inputs.sources, bindings);
        const byAlias = new Map(
          people.flatMap((person) => person.aliases.map((id) => [id, person])),
        );
        return {
          inputs,
          bindings,
          byAlias,
          bySource: new Map(
            inputs.sources.map((source) => [
              source.provider + ':' + source.source_id,
              byAlias.get(source.id),
            ]),
          ),
        };
      }),
    );
  return cache.get(workspace);
}
/** Every stored ID of the person behind `id`; an unknown ID stays itself (former members). */
export async function personAliases(tx, workspace, id) {
  return (await identityDirectory(tx, workspace)).byAlias.get(id)?.aliases ?? [id];
}
/** Pure read-only report of IDs, normalized emails, Slack mappings and conflicts. It performs
 * no writes; run it before any durable identity change and keep its output outside Git. */
export function identityInventory({ workspace_id, members = [], sources = [], slack = {} }) {
  const bindings = slackMappingEntries(slack, members, sources);
  const { people, conflicts } = resolveIdentities(members, sources, appliedBindings(bindings));
  const canonical = new Map(
    people.flatMap((person) => person.aliases.map((id) => [id, person.id])),
  );
  const profiles = [
    ...members.map((member) => ({
      id: member.id,
      provider: 'tasks',
      source_id: null,
      role: member.role ?? null,
      email: normalizeEmail(member.email),
      bot: false,
    })),
    ...sources.map((source) => ({
      id: source.id,
      provider: source.provider,
      source_id: source.source_id,
      role: null,
      email: normalizeEmail(source.email),
      bot: isBotProfile(source),
    })),
  ].map((profile) => ({ ...profile, canonical_id: canonical.get(profile.id) }));
  const conflicted = new Set(conflicts.map((conflict) => conflict.email).filter(Boolean));
  /** @type {Map<string, typeof profiles>} */
  const byEmail = new Map();
  for (const profile of profiles) {
    if (!profile.email) continue;
    const group = byEmail.get(profile.email);
    if (group) group.push(profile);
    else byEmail.set(profile.email, [profile]);
  }
  const emails = [...byEmail]
    .filter(([, group]) => group.length > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([email, group]) => ({
      email,
      ids: group.map((profile) => profile.id).sort((a, b) => a.localeCompare(b)),
      providers: [...new Set(group.map((profile) => profile.provider))].sort((a, b) =>
        a.localeCompare(b),
      ),
      status: conflicted.has(email)
        ? 'conflict'
        : new Set(group.map((profile) => profile.canonical_id)).size === 1
          ? 'merged'
          : 'separate',
    }));
  /** @type {Record<string, number>} */
  const providers = {};
  for (const profile of profiles)
    providers[profile.provider] = (providers[profile.provider] ?? 0) + 1;
  return {
    workspace_id,
    counts: {
      members: members.length,
      sources: sources.length,
      providers,
      applied_bindings: bindings.filter((entry) => entry.status === 'applied').length,
      canonical_people: people.length,
      conflicts: conflicts.length,
    },
    profiles,
    bindings,
    emails,
    conflicts,
  };
}
