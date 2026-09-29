export type Id = string;
export type DateOnly = string;
export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type StatusCategory =
  | 'triage'
  | 'backlog'
  | 'unstarted'
  | 'started'
  | 'completed'
  | 'canceled';
export interface Person {
  avatar_url?: string | null;
  id: Id;
  name: string;
  email: string;
  role: Role;
}
export interface Actor extends Person {
  workspace_id: Id;
  scopes: string[];
  auth_type: 'session' | 'token';
}
export interface Team {
  id: Id;
  workspace_id: Id;
  key: string;
  name: string;
}
export interface Status {
  id: Id;
  team_id: Id;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}
export interface Label {
  id: Id;
  name: string;
  color: string;
}
export interface Module {
  id: string;
  name: string;
  description: string;
  required?: boolean;
  enabled: boolean;
  depends: string[];
  config: Record<string, unknown>;
}
export interface SourcePerson {
  id: Id;
  name: string;
  email: string | null;
  provider: string;
  source_id: string;
  avatar_url: string | null;
  /** Supplied by a provider profile sync; absent means not known to be a bot. */
  bot?: boolean;
}
/** Administrator-verified member ↔ source profile link (docs/PEOPLE-IDENTITY.md). */
export interface IdentityBinding {
  member_id: Id;
  source_person_id: Id;
  via: 'slack_user_map';
}
export interface Catalog {
  counts?: Record<
    'issues' | 'epics' | 'mine' | 'projects' | 'cycles' | 'documents' | 'initiatives' | 'archive',
    number
  >;
  workspace: { id: Id; name: string; slug: string };
  teams: Team[];
  statuses: Status[];
  labels: Label[];
  people: Person[];
  source_people?: SourcePerson[];
  identity_bindings?: IdentityBinding[];
  imported_files?: {
    id: Id;
    source_url: string;
    status: 'ready' | 'source_unavailable';
    source_status: number | null;
  }[];
  modules: Module[];
}
export interface Issue {
  id: Id;
  workspace_id: Id;
  team_id: Id;
  key: string;
  number: number;
  title: string;
  description: string;
  kind: 'issue' | 'epic';
  status_id: Id;
  status_name: string;
  status_category: StatusCategory;
  status_color: string;
  priority: number;
  assignee_id: Id | null;
  assignee_name: string | null;
  creator_id: Id;
  project_id: Id | null;
  project_name: string | null;
  cycle_id: Id | null;
  milestone_id: Id | null;
  parent_id: Id | null;
  estimate: number | null;
  start_date: DateOnly | null;
  due_date: DateOnly | null;
  position: number;
  version: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  labels: Label[];
  label_ids: Id[];
}
export interface Comment {
  id: Id;
  author_id: Id;
  // Imported source person, when the comment came from another tracker (author_id is the importer).
  author_source_id?: Id | null;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface Relation {
  id: Id;
  source_id: Id;
  target_id: Id;
  type: 'blocks' | 'related' | 'duplicates';
  source_key: string;
  target_key: string;
  source_title: string;
  target_title: string;
}
export interface Attachment {
  id: Id;
  filename: string;
  mime: string;
  bytes: number;
  created_at: string;
}
// Display-ready field changes (docs/TASK-ACTIVITY.md). Text `from`/`to` are null when the
// source history recorded only that the description changed.
export type ActivityChange =
  | { kind: 'value'; field: string; label: string; from: string; to: string }
  | { kind: 'labels'; field: 'labels'; label: string; added: string[]; removed: string[] }
  | { kind: 'text'; field: 'description'; label: string; from: string | null; to: string | null };
export interface Activity {
  summary?: string;
  details?: string[];
  changes?: ActivityChange[];
  id: Id;
  actor_id: Id;
  // Imported source person, when the event came from another tracker's history.
  actor_source_id?: Id | null;
  actor_name: string;
  action: string;
  data: Record<string, unknown>;
  created_at: string;
}
export interface IssueDetail extends Issue {
  comments: Comment[];
  relations: Relation[];
  children: Pick<Issue, 'id' | 'key' | 'title' | 'status_id' | 'kind'>[];
  attachments: Attachment[];
  activity: Activity[];
  links: { id: Id; url: string; title: string; provider: string }[];
  subscribed: boolean;
}
/** GET /v1/issues/pre-canonical/{code}: every task that held a code before canonical renumbering. */
export interface PreCanonicalCodeHistory {
  code: string;
  origin: 'pre-canonical';
  ambiguous: boolean;
  /** The task that holds the bare code today; context only, never a substitute for a match. */
  current: Pick<Issue, 'id' | 'key' | 'title'> | null;
  matches: {
    /** Null when the task was deleted; its code chain stays visible. */
    task: Pick<
      Issue,
      'id' | 'key' | 'title' | 'status_name' | 'status_category' | 'status_color'
    > | null;
    steps: { migration_id: Id; at: string; from: string; to: string }[];
  }[];
}
export interface IssueFilters {
  q?: string;
  team_id?: Id;
  status_id?: Id;
  category?: StatusCategory;
  assignee_id?: string;
  project_id?: Id;
  cycle_id?: Id;
  label_id?: Id;
  parent_id?: Id;
  kind?: 'issue' | 'epic';
  priority?: number;
  archived?: boolean;
  deleted?: boolean;
  due_before?: DateOnly;
}
export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}
export interface Project {
  id: Id;
  name: string;
  description: string;
  status: 'planned' | 'in_progress' | 'paused' | 'completed' | 'canceled';
  health: 'on_track' | 'at_risk' | 'off_track';
  lead_id: Id | null;
  start_date: DateOnly | null;
  target_date: DateOnly | null;
  version: number;
  total: number;
  completed: number;
  team_ids: Id[];
}
export interface Cycle {
  id: Id;
  team_id: Id;
  name: string;
  start_date: DateOnly;
  end_date: DateOnly;
  version: number;
}
export interface Milestone {
  id: Id;
  project_id: Id;
  name: string;
  target_date: DateOnly | null;
}
export interface SavedView {
  id: Id;
  name: string;
  filters: IssueFilters;
  shared: number;
  owner_id: Id;
}
export interface Notification {
  id: Id;
  issue_id: Id;
  key: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}
export type { IssueCreate, IssuePatch, ProjectCreate, ProjectPatch } from './request-types';

export interface WorkspacePolicy {
  allowed_email_domains: string[];
  version: number;
  updated_at: string | null;
}
