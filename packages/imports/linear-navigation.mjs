// Native navigation conversion: reject unsupported semantics instead of widening a view.
export function navigationRows(data, actor, { ref, id, sourceOwnerTargets = {} }) {
  const rows = [],
    warnings = [];
  const add = (table, row) =>
    rows.push({ table, row: { workspace_id: actor.workspace_id, ...row } });
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const date = (v) => {
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
      throw Error('Invalid navigation timestamp');
    return v;
  };
  const text = (v, max) => {
    if (typeof v !== 'string' || v.length > max) throw Error('Invalid navigation text');
    return v;
  };
  const filtersFor = (view) => {
    if (
      view.modelName !== 'Issue' ||
      view.projectFilterData ||
      view.initiativeFilterData ||
      view.feedItemFilterData
    )
      throw Error('Unsupported saved view model');
    const result = {};
    if (view.team) result.team_id = ref('teams', view.team);
    const merge = (field, values) => {
      const unique = [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      result[field] = result[field] ? result[field].filter((v) => unique.includes(v)) : unique;
    };
    const visit = (filter, depth = 0) => {
      if (!object(filter) || depth > 16)
        throw Error('Invalid or too deeply nested saved view filter');
      for (const [field, condition] of Object.entries(filter)) {
        if (field === 'and') {
          if (!Array.isArray(condition) || condition.length > 100)
            throw Error('Invalid saved view conjunction');
          for (const child of condition) visit(child, depth + 1);
          continue;
        }
        if (
          !['project', 'state'].includes(field) ||
          !object(condition) ||
          Object.keys(condition).length !== 1
        )
          throw Error('Unsupported saved view filter: ' + field);
        const [property, comparator] = Object.entries(condition)[0];
        if (
          !['id', 'name'].includes(property) ||
          !object(comparator) ||
          Object.keys(comparator).length !== 1
        )
          throw Error('Unsupported saved view comparison');
        const [operator, input] = Object.entries(comparator)[0];
        const values = operator === 'eq' ? [input] : operator === 'in' ? input : null;
        if (
          !Array.isArray(values) ||
          values.length > 100 ||
          values.some((v) => typeof v !== 'string')
        )
          throw Error('Unsupported saved view operator');
        const collection = field === 'project' ? 'projects' : 'workflowStates';
        const targets =
          property === 'id'
            ? values.map((v) => ref(collection, v))
            : data[collection]
                .filter((v) => values.includes(v.name))
                .map((v) => ref(collection, v));
        merge(field === 'project' ? 'project_ids' : 'status_ids', targets);
      }
    };
    visit(view.filterData);
    return result;
  };
  for (const view of data.customViews ?? []) {
    const sourceOwner = ref('users', view.owner);
    if (!sourceOwner || typeof view.shared !== 'boolean')
      throw Error('Missing saved view ownership');
    const owner = sourceOwnerTargets[view.owner.id];
    if (!view.shared && !owner)
      throw Error('Private saved view requires an existing matching target member');
    add('saved_views', {
      id: id('customViews', view),
      owner_id: owner ?? actor.id,
      owner_source_id: sourceOwner,
      name: text(view.name, 100),
      description: text(view.description ?? '', 10000),
      filters: JSON.stringify(filtersFor(view)),
      shared: view.shared ? 1 : 0,
      created_at: date(view.createdAt),
      updated_at: date(view.updatedAt),
      archived_at: view.archivedAt ? date(view.archivedAt) : null,
    });
    if (!owner)
      warnings.push(
        'A shared view is managed by the importer; its original owner remains recorded as source attribution.',
      );
  }
  const types = {
    issue: ['issues', 'issue'],
    project: ['projects', 'project'],
    document: ['documents', 'document'],
    initiative: ['initiatives', 'initiative'],
    cycle: ['cycles', 'cycle'],
    customView: ['customViews', 'customView'],
    label: ['issueLabels', 'label'],
    team: ['teams', 'team'],
  };
  for (const favorite of data.favorites ?? []) {
    const descriptor = types[favorite.type];
    if (!descriptor || favorite.parent)
      throw Error('Unsupported favorite type or folder hierarchy');
    const sourceOwner = ref('users', favorite.owner),
      target = ref(descriptor[0], favorite[descriptor[1]]);
    if (!sourceOwner || !target || !Number.isFinite(favorite.sortOrder))
      throw Error('Invalid favorite ownership, target or ordering');
    const owner = sourceOwnerTargets[favorite.owner.id] ?? null;
    add('favorites', {
      id: id('favorites', favorite),
      owner_id: owner,
      owner_source_id: sourceOwner,
      target_type: favorite.type,
      target_id: target,
      sort_order: favorite.sortOrder,
      created_at: date(favorite.createdAt),
      updated_at: date(favorite.updatedAt),
      archived_at: favorite.archivedAt ? date(favorite.archivedAt) : null,
    });
    if (!owner)
      warnings.push(
        'A personal favorite has no matching target member; preserved privately without granting account access.',
      );
  }
  return { rows, warnings: [...new Set(warnings)] };
}
