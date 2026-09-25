/** @typedef {{id:string,name:string,email?:string|null,avatar_url?:string|null,provider?:string,source_id?:string}} Profile */
/** Presentation aliases only: never mutate accounts, source IDs, historical authors or permissions.
 * @param {Profile[]} members @param {Profile[]} sources
 */
export function canonicalPeople(members = [], sources = []) {
  const all = [
    ...members.map((person) => ({ ...person, provider: 'tasks' })),
    ...sources.map((person) => ({ ...person, provider: person.provider ?? 'source' })),
  ];
  /** @type {Map<string,typeof all>} */
  const buckets = new Map();
  for (const person of all) {
    const email = person.email?.trim().toLowerCase();
    const key = email ? 'email:' + email : 'id:' + person.id;
    const bucket = buckets.get(key) ?? [];
    bucket.push(person);
    buckets.set(key, bucket);
  }
  const groups = [...buckets.values()].flatMap((bucket) =>
    new Set(bucket.map((person) => person.provider)).size === bucket.length
      ? [bucket]
      : bucket.map((person) => [person]),
  );
  return groups
    .map((group) => {
      const identity = group.find((person) => person.provider === 'tasks') ?? group[0];
      const slack = group.find((person) => person.provider === 'slack');
      const name = slack?.name?.trim() || identity.name;
      return {
        id: identity.id,
        name,
        email: identity.email ?? null,
        avatar_url:
          slack?.avatar_url ??
          identity.avatar_url ??
          group.find((person) => person.avatar_url)?.avatar_url ??
          null,
        aliases: group.map((person) => person.id),
        names: [...new Set(group.map((person) => person.name))],
        providers: [...new Set(group.map((person) => person.provider))],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
