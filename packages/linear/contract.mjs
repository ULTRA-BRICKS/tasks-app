import { parse, print, Kind, buildASTSchema } from 'graphql';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const words = (s) => s.split(' ');
// This is an allow-list, NOT an invented alternative schema. Definitions are sliced from the pinned upstream AST.
export const fields = {
  Node: words('id'),
  ArchivePayload: words('success'),
  Query: words(
    'viewer organization issue issues issueSearch team teams user users workflowState workflowStates issueLabel issueLabels project projects projectMilestone projectMilestones comment comments issueRelation issueRelations issuePriorityValues',
  ),
  Mutation: words(
    'issueCreate issueUpdate issueArchive issueUnarchive issueDelete issueAddLabel issueRemoveLabel commentCreate issueRelationCreate issueRelationDelete projectCreate projectUpdate projectMilestoneCreate',
  ),
  Issue: words(
    'id identifier number title description priority priorityLabel createdAt updatedAt archivedAt dueDate estimate sortOrder url assignee creator team state project projectMilestone parent children labels labelIds comments relations inverseRelations',
  ),
  Team: words('id key name displayName issues states organization'),
  User: words(
    'id name displayName email createdAt avatarUrl isMe admin owner active assignedIssues createdIssues organization',
  ),
  Organization: words('id name urlKey createdAt'),
  WorkflowState: words('id name color type position team issues'),
  IssueLabel: words('id name color isGroup organization issues'),
  Project: words(
    'id name description createdAt updatedAt archivedAt startDate targetDate lead issues teams projectMilestones url',
  ),
  ProjectMilestone: words('id name targetDate project'),
  Comment: words('id body createdAt updatedAt user issue url'),
  IssueRelation: words('id type issue relatedIssue'),
  IssuePriorityValue: words('priority label'),
  IssuePayload: words('success issue'),
  IssueArchivePayload: words('success entity'),
  ProjectPayload: words('success project'),
  ProjectMilestonePayload: words('success projectMilestone'),
  CommentPayload: words('success comment'),
  IssueRelationPayload: words('success issueRelation'),
  DeletePayload: words('success'),
  IssueCreateInput: words(
    'teamId title description priority assigneeId stateId labelIds projectId projectMilestoneId parentId dueDate estimate',
  ),
  IssueUpdateInput: words(
    'title description priority assigneeId stateId labelIds addedLabelIds removedLabelIds projectId projectMilestoneId parentId dueDate estimate sortOrder',
  ),
  ProjectCreateInput: words('name description teamIds leadId startDate targetDate'),
  ProjectUpdateInput: words('name description leadId startDate targetDate'),
  ProjectMilestoneCreateInput: words('name projectId targetDate'),
  CommentCreateInput: words('body issueId'),
  IssueRelationCreateInput: words('issueId relatedIssueId type'),
  IssueFilter: words(
    'and or id number title description priority team state assignee creator project labels',
  ),
  TeamFilter: words('and or id key name'),
  UserFilter: words('and or id name email isMe'),
  NullableUserFilter: words('and or null id name email isMe'),
  WorkflowStateFilter: words('and or id name type'),
  ProjectFilter: words('and or id name'),
  NullableProjectFilter: words('and or null id name'),
  IssueLabelFilter: words('and or id name'),
  IssueLabelCollectionFilter: words('and or id name null some every'),
  CommentFilter: words('and or id body'),
  ProjectMilestoneFilter: words('and or id name'),
  IDComparator: words('eq neq in nin'),
  IssueIDComparator: words('eq neq in nin'),
  EntityIdentifierIDComparator: words('eq neq in nin'),
  StringComparator: words('eq neq in nin contains containsIgnoreCase eqIgnoreCase neqIgnoreCase'),
  NullableStringComparator: words(
    'eq neq in nin contains containsIgnoreCase eqIgnoreCase neqIgnoreCase null',
  ),
  NumberComparator: words('eq neq in nin gt gte lt lte'),
  NullableNumberComparator: words('eq neq in nin gt gte lt lte null'),
  BooleanComparator: words('eq neq'),
};
const pagination = new Set(words('first last after before includeArchived filter'));
const rootArguments = {
  'Query.issueSearch': new Set([...pagination, 'orderBy', 'query']),
  'Query.issues': new Set([...pagination, 'orderBy']),
  'Query.projects': new Set([...pagination, 'orderBy']),
  'Query.comments': new Set([...pagination, 'orderBy']),
  'Query.comment': new Set(['id']),
  'Mutation.issueArchive': new Set(['id']),
  'Mutation.issueDelete': new Set(['id']),
  'Mutation.projectCreate': new Set(['input']),
  'Mutation.issueRelationCreate': new Set(['input']),
};
const named = (t) => (t.kind === Kind.NAMED_TYPE ? t.name.value : named(t.type));
export function generateLinearSchema() {
  const bytes = readFileSync(new URL('../../vendor/linear/schema.graphql', import.meta.url));
  const provenance = JSON.parse(
    readFileSync(new URL('../../vendor/linear/provenance.json', import.meta.url), 'utf8'),
  );
  const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (digest !== provenance.gitBlobSha)
    throw new Error('Pinned Linear schema does not match its provenance');
  const upstream = parse(bytes.toString());
  const byName = new Map(upstream.definitions.filter((d) => d.name).map((d) => [d.name.value, d]));
  const needed = new Set(['Query', 'Mutation']);
  const definitions = [];
  for (const name of needed) {
    if (['String', 'Int', 'Float', 'Boolean', 'ID'].includes(name)) continue;
    const original = byName.get(name);
    if (!original) throw new Error(`Missing upstream type ${name}`);
    let selected = original;
    for (const i of original.interfaces ?? []) needed.add(i.name.value);
    if (original.fields) {
      const allowed = fields[name];
      if (!allowed && !(/(Connection|Edge)$/.test(name) || name === 'PageInfo'))
        throw new Error(`Missing allow-list for ${name}`);
      if (allowed)
        for (const field of allowed)
          if (!original.fields.some((f) => f.name.value === field))
            throw new Error(`Unknown upstream field ${name}.${field}`);
      selected = {
        ...original,
        fields: original.fields
          .filter((f) => !allowed || allowed.includes(f.name.value))
          .map((f) => {
            let args = f.arguments;
            if (args?.length) {
              const key = `${name}.${f.name.value}`;
              const allow =
                rootArguments[key] ??
                (named(f.type).endsWith('Connection')
                  ? new Set([
                      ...pagination,
                      ...(['Issue', 'Project', 'Comment'].some(
                        (x) => named(f.type) === x + 'Connection',
                      )
                        ? ['orderBy']
                        : []),
                    ])
                  : null);
              if (allow) args = args.filter((a) => allow.has(a.name.value));
            }
            const field = { ...f, arguments: args };
            needed.add(named(field.type));
            for (const a of args ?? []) needed.add(named(a.type));
            return field;
          }),
      };
    }
    if (name === 'IssueRelationType')
      selected = { ...original, values: original.values.filter((v) => v.name.value !== 'similar') };
    definitions.push(selected);
  }
  const doc = { kind: Kind.DOCUMENT, definitions };
  buildASTSchema(doc);
  return '# Generated from vendor/linear/schema.graphql. Do not edit.\n' + print(doc) + '\n';
}
