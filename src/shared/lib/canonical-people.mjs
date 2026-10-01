/** Presentation-only identity projection (docs/PEOPLE-IDENTITY.md). It never mutates accounts,
 * source IDs, historical authors or permissions; every original ID stays an alias.
 * @typedef {{id:string,name:string,email?:string|null,avatar_url?:string|null,provider?:string,source_id?:string,bot?:boolean|null}} Profile
 * @typedef {{name?:string|null,email?:string|null}} NameFields
 * @typedef {{member_id:string,source_person_id:string,via?:string}} Binding
 * @typedef {'same_provider_email'|'ambiguous_email'|'conflicting_binding'|'bot_binding'|'unresolved_binding'} ConflictKind
 * @typedef {{id:string,name:string,provider:string,email:string|null,avatar_url:string|null}} ConflictProfile
 * @typedef {{kind:ConflictKind,email:string|null,providers:string[],profiles:ConflictProfile[]}} IdentityConflict
 * @typedef {{id:string,name:string,email:string|null,avatar_url:string|null,aliases:string[],names:string[],providers:string[],bot:boolean,needs_review:boolean}} CanonicalPerson
 * @typedef {{people:CanonicalPerson[],conflicts:IdentityConflict[]}} IdentityResolution
 */
/** Trim and lower-case only: dots and `+tags` can be different mailboxes.
 * @param {string|null|undefined} email @returns {string|null} */
export const normalizeEmail = (email) => email?.trim().toLowerCase() || null;
/** Provider avatar URLs cross a trust boundary. Persist only canonical, bounded HTTPS URLs. */
export function safeAvatarUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const canonical = url.href;
    return url.protocol === 'https:' && !url.username && !url.password && canonical.length <= 2048
      ? canonical
      : null;
  } catch {
    return null;
  }
}
/** Linear gives OAuth applications (for example Codex, Cursor) and its own system user
 * addresses on these reserved domains; no human mailbox lives there. */
const LINEAR_APP_EMAIL = /@(?:oauthapp\.linear\.app|linear\.linear\.app)$/;
/** A provider-supplied flag, or an address that only provider automation can have.
 * Tasks members are accounts and always count as humans.
 * @param {Profile} profile @returns {boolean} */
export function isBotProfile(profile) {
  if (profile.provider === 'tasks') return false;
  if (profile.bot === true) return true;
  return (
    profile.provider === 'linear' && LINEAR_APP_EMAIL.test(normalizeEmail(profile.email) ?? '')
  );
}
/** `local@domain`: a stored name of this shape is an address, not a name (Linear stores the
 * address as the name of a user who never entered one). */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
/** @param {string|null|undefined} name @returns {string|null} */
const realName = (name) => {
  const trimmed = name?.trim();
  return trimmed && !EMAIL_SHAPE.test(trimmed) ? trimmed : null;
};
/** Last resort: the local part without `+tag`, split on `.`, `_`, `-`, each word capitalised.
 * @param {string|null|undefined} address @returns {string|null} */
function nameFromAddress(address) {
  const trimmed = address?.trim();
  if (!trimmed || !EMAIL_SHAPE.test(trimmed)) return null;
  const words = trimmed
    .split('@')[0]
    .split('+')[0]
    .split(/[._-]+/)
    .filter(Boolean);
  return words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ') || null;
}
/** The name chain of docs/PEOPLE-IDENTITY.md (UB-95): real names, then the identity email,
 * email-shaped names, and other profile emails. A raw email never fills a name slot.
 * @param {NameFields[]} names profiles in real-name precedence order
 * @param {NameFields[]} [addresses] identity first, then profiles in address precedence order
 * @returns {string} */
function presentedName(names, addresses = names) {
  for (const profile of names) {
    const name = realName(profile.name);
    if (name) return name;
  }
  const [identity, ...others] = addresses;
  const identityName = nameFromAddress(identity?.email);
  if (identityName) return identityName;
  for (const profile of addresses) {
    const name = nameFromAddress(profile.name);
    if (name) return name;
  }
  for (const profile of others) {
    const name = nameFromAddress(profile.email);
    if (name) return name;
  }
  return 'Unknown person';
}
/** The presented name of one stored record the projection does not know (a former member).
 * @param {string|null|undefined} name @param {string|null|undefined} [email] @returns {string} */
export const storedPersonName = (name, email) => presentedName([{ name, email }]);
const PROVIDER_RANK = ['tasks', 'slack', 'linear'];
/** Fixed order for "any other linked profile": Tasks, Slack, Linear, others; then by ID.
 * @param {Profile} a @param {Profile} b */
function byProviderRank(a, b) {
  const rank = (/** @type {Profile} */ p) => {
    const i = PROVIDER_RANK.indexOf(p.provider ?? '');
    return i < 0 ? PROVIDER_RANK.length : i;
  };
  const provider = rank(a) - rank(b);
  return provider || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
/** @param {Profile[]} members @param {Profile[]} sources @param {Binding[]} bindings
 * @returns {IdentityResolution} */
export function resolveIdentities(members = [], sources = [], bindings = []) {
  const all = [
    ...members.map((person) => ({ ...person, provider: 'tasks', bot: false })),
    ...sources.map((person) => {
      const provider = person.provider ?? 'source';
      return { ...person, provider, bot: isBotProfile({ ...person, provider }) };
    }),
  ];
  const index = new Map(all.map((person, i) => [person.id, i]));
  const parent = all.map((_, i) => i);
  /** @param {number} i @returns {number} */
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  /** @param {number} a @param {number} b */
  const union = (a, b) => {
    const [x, y] = [find(a), find(b)].sort((p, q) => p - q);
    parent[y] = x;
  };
  /** @type {IdentityConflict[]} */
  const conflicts = [];
  const flagged = new Set();
  /** @param {ConflictKind} kind @param {number[]} indices @param {string|null} email @param {string[]} providers */
  const report = (kind, indices, email = null, providers = []) => {
    for (const i of indices) flagged.add(i);
    conflicts.push({
      kind,
      email,
      providers,
      profiles: indices.map((i) => ({
        id: all[i].id,
        name: presentedName([all[i]]),
        provider: all[i].provider,
        email: all[i].email ?? null,
        avatar_url: all[i].avatar_url ?? null,
      })),
    });
  };
  /** Non-Tasks providers of the given profiles, sorted. @param {number[]} indices */
  const sourceProviders = (indices) =>
    [...new Set(indices.map((i) => all[i].provider).filter((p) => p !== 'tasks'))].sort((a, b) =>
      a.localeCompare(b),
    );
  // 1. Explicit verified bindings first; a source bound to two members binds to neither.
  /** @type {Map<number, Set<number>>} */
  const boundTo = new Map();
  for (const binding of bindings) {
    const member = index.get(binding.member_id),
      source = index.get(binding.source_person_id);
    const known = [member, source].filter((i) => i !== undefined);
    if (
      member === undefined ||
      source === undefined ||
      all[member].provider !== 'tasks' ||
      all[source].provider === 'tasks'
    )
      report('unresolved_binding', known, null, sourceProviders(known));
    else if (all[member].bot || all[source].bot)
      report('bot_binding', [member, source], null, sourceProviders([source]));
    else boundTo.set(source, (boundTo.get(source) ?? new Set()).add(member));
  }
  for (const [source, targets] of boundTo) {
    if (targets.size > 1)
      report('conflicting_binding', [...targets, source], null, sourceProviders([source]));
    else union(source, [...targets][0]);
  }
  // 2. Email groups are judged against binding-only identities, so input order never matters.
  const bound = all.map((_, i) => find(i));
  /** @type {Map<number, Set<string>>} */
  const identityProviders = new Map();
  all.forEach((person, i) =>
    identityProviders.set(
      bound[i],
      (identityProviders.get(bound[i]) ?? new Set()).add(person.provider),
    ),
  );
  /** @type {Map<string, number[]>} */
  const byEmail = new Map();
  all.forEach((person, i) => {
    const email = normalizeEmail(person.email);
    if (!email || person.bot) return;
    const group = byEmail.get(email);
    if (group) group.push(i);
    else byEmail.set(email, [i]);
  });
  /** @type {{email:string,members:number[],identities:number[]}[]} */
  const candidates = [];
  for (const [email, members] of [...byEmail].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const identities = [...new Set(members.map((i) => bound[i]))];
    if (identities.length < 2) continue;
    const overlap = overlapping(identities.map((root) => identityProviders.get(root) ?? new Set()));
    if (!overlap.length) candidates.push({ email, members, identities });
    else {
      /** Providers of this email's profiles, per identity. @type {Map<number, Set<string>>} */
      const emailProviders = new Map();
      for (const i of members) {
        const set = emailProviders.get(bound[i]);
        if (set) set.add(all[i].provider);
        else emailProviders.set(bound[i], new Set([all[i].provider]));
      }
      const withinGroup = overlapping([...emailProviders.values()]);
      report(
        withinGroup.length ? 'same_provider_email' : 'ambiguous_email',
        members,
        email,
        overlap,
      );
    }
  }
  // 3. Chained email matches may still give one person two profiles of a provider; then none apply.
  const tentative = new Map(
    candidates.flatMap(({ identities }) => identities.map((root) => [root, root])),
  );
  /** @param {number} root @returns {number} */
  const top = (root) =>
    tentative.get(root) === root ? root : top(/** @type {number} */ (tentative.get(root)));
  for (const { identities } of candidates)
    for (const root of identities.slice(1)) {
      const [x, y] = [top(identities[0]), top(root)].sort((p, q) => p - q);
      tentative.set(y, x);
    }
  /** @type {Map<number, number[]>} */
  const combined = new Map();
  for (const root of tentative.keys()) {
    const group = combined.get(top(root));
    if (group) group.push(root);
    else combined.set(top(root), [root]);
  }
  const rejected = new Set(
    [...combined]
      .filter(
        ([, roots]) =>
          overlapping(roots.map((root) => identityProviders.get(root) ?? new Set())).length,
      )
      .map(([group]) => group),
  );
  for (const { email, members, identities } of candidates) {
    if (!rejected.has(top(identities[0]))) {
      for (const root of identities.slice(1)) union(identities[0], root);
      continue;
    }
    const roots = /** @type {number[]} */ (combined.get(top(identities[0])));
    report(
      'ambiguous_email',
      members,
      email,
      overlapping(roots.map((root) => identityProviders.get(root) ?? new Set())),
    );
  }
  /** @type {Map<number, typeof all>} */
  const groups = new Map();
  /** @type {Map<number, boolean>} */
  const review = new Map();
  all.forEach((person, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(person);
    else groups.set(root, [person]);
    if (flagged.has(i)) review.set(root, true);
  });
  const people = [...groups]
    .map(([root, group]) => {
      const identity = group.find((person) => person.provider === 'tasks') ?? group[0];
      const slack = group.find((person) => person.provider === 'slack');
      const others = group.filter((person) => person !== identity).sort(byProviderRank);
      return {
        id: identity.id,
        name: presentedName(slack ? [slack, identity, ...others] : [identity, ...others], [
          identity,
          ...others,
        ]),
        email: identity.email ?? null,
        avatar_url:
          slack?.avatar_url ??
          identity.avatar_url ??
          others.find((person) => person.avatar_url)?.avatar_url ??
          null,
        aliases: group.map((person) => person.id),
        names: [...new Set(group.map((person) => presentedName([person])))],
        providers: [...new Set(group.map((person) => person.provider))],
        bot: identity.bot,
        needs_review: review.get(root) ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const order = (/** @type {IdentityConflict} */ c) =>
    [c.kind, c.email ?? '', ...c.profiles.map((p) => p.id).sort((a, b) => a.localeCompare(b))].join(
      '\u0000',
    );
  conflicts.sort((a, b) => (order(a) < order(b) ? -1 : 1));
  return { people, conflicts };
}
/** Providers present in more than one of the given sets, sorted.
 * @param {Set<string>[]} sets @returns {string[]} */
function overlapping(sets) {
  const seen = new Set(),
    repeated = new Set();
  for (const set of sets)
    for (const provider of set) (seen.has(provider) ? repeated : seen).add(provider);
  return [...repeated].sort((a, b) => a.localeCompare(b));
}
/** @param {Profile[]} members @param {Profile[]} sources @param {Binding[]} bindings */
export const canonicalPeople = (members = [], sources = [], bindings = []) =>
  resolveIdentities(members, sources, bindings).people;
