export type ShortcutCommand = {
  id: string;
  label: string;
  group: string;
  keys: string[];
  scope?: 'list' | 'detail' | 'document';
  route?: string;
  writes?: boolean;
  inEditor?: boolean;
};
/** Shared by dispatch, help, preferences and command-menu keycaps. */
export const shortcutCommands: ShortcutCommand[] = [
  { id: 'search', label: 'Command menu', group: 'General', keys: ['Mod+k'], inEditor: true },
  { id: 'find', label: 'Search workspace', group: 'General', keys: ['/'] },
  { id: 'help', label: 'Keyboard shortcuts', group: 'General', keys: ['Shift+/'] },
  {
    id: 'newIssue',
    label: 'Create new issue',
    group: 'Create',
    keys: ['c', 'v'],
    route: '/issues/new',
    writes: true,
  },
  {
    id: 'newProject',
    label: 'Create new project',
    group: 'Create',
    keys: [],
    route: '/projects/new',
    writes: true,
  },
  {
    id: 'newDocument',
    label: 'Create new document',
    group: 'Create',
    keys: [],
    route: '/documents/new',
    writes: true,
  },
  {
    id: 'newInitiative',
    label: 'Create new initiative',
    group: 'Create',
    keys: [],
    route: '/initiatives/new',
    writes: true,
  },
  { id: 'issues', label: 'Go to all issues', group: 'Navigation', keys: ['g i'], route: '/issues' },
  { id: 'mine', label: 'Go to my issues', group: 'Navigation', keys: ['g m'], route: '/my-issues' },
  {
    id: 'projects',
    label: 'Go to projects',
    group: 'Navigation',
    keys: ['g p'],
    route: '/projects',
  },
  { id: 'cycles', label: 'Go to cycles', group: 'Navigation', keys: ['g c'], route: '/cycles' },
  { id: 'inbox', label: 'Go to inbox', group: 'Navigation', keys: ['g n'], route: '/inbox' },
  {
    id: 'documents',
    label: 'Go to documents',
    group: 'Navigation',
    keys: ['g d'],
    route: '/documents',
  },
  {
    id: 'initiatives',
    label: 'Go to initiatives',
    group: 'Navigation',
    keys: ['g t'],
    route: '/initiatives',
  },
  {
    id: 'settings',
    label: 'Open settings',
    group: 'Navigation',
    keys: ['g s'],
    route: '/settings',
  },
  {
    id: 'shortcutSettings',
    label: 'Customize keyboard shortcuts',
    group: 'Navigation',
    keys: ['g h'],
    route: '/settings#keyboard-shortcuts',
  },
  {
    id: 'next',
    label: 'Focus next issue',
    group: 'Issue list',
    keys: ['j', 'ArrowDown'],
    scope: 'list',
  },
  {
    id: 'previous',
    label: 'Focus previous issue',
    group: 'Issue list',
    keys: ['k', 'ArrowUp'],
    scope: 'list',
  },
  { id: 'open', label: 'Open focused issue', group: 'Issue list', keys: ['Enter'], scope: 'list' },
  {
    id: 'select',
    label: 'Toggle issue selection',
    group: 'Issue list',
    keys: ['x'],
    scope: 'list',
  },
  {
    id: 'selectAll',
    label: 'Select visible issues',
    group: 'Issue list',
    keys: ['Mod+a'],
    scope: 'list',
  },
  {
    id: 'clearSelection',
    label: 'Clear issue selection',
    group: 'Issue list',
    keys: ['Escape'],
    scope: 'list',
  },
  {
    id: 'back',
    label: 'Return to the issue list',
    group: 'Issue',
    keys: ['Escape'],
    scope: 'detail',
  },
  {
    id: 'status',
    label: 'Change status',
    group: 'Issue',
    keys: ['s'],
    scope: 'detail',
    writes: true,
  },
  {
    id: 'assignee',
    label: 'Change assignee',
    group: 'Issue',
    keys: ['a'],
    scope: 'detail',
    writes: true,
  },
  {
    id: 'priority',
    label: 'Change priority',
    group: 'Issue',
    keys: ['p'],
    scope: 'detail',
    writes: true,
  },
  {
    id: 'project',
    label: 'Change project',
    group: 'Issue',
    keys: ['Shift+p'],
    scope: 'detail',
    writes: true,
  },
  {
    id: 'cycle',
    label: 'Change cycle',
    group: 'Issue',
    keys: ['Shift+c'],
    scope: 'detail',
    writes: true,
  },
  {
    id: 'title',
    label: 'Edit issue title',
    group: 'Issue',
    keys: ['e'],
    scope: 'detail',
    writes: true,
  },
  {
    id: 'comment',
    label: 'Write a comment',
    group: 'Issue',
    keys: ['m'],
    scope: 'detail',
    writes: true,
  },
  { id: 'copyLink', label: 'Copy current page link', group: 'General', keys: ['Mod+Shift+c'] },
  {
    id: 'board',
    label: 'Toggle list / board',
    group: 'Issue list',
    keys: ['Mod+b'],
    scope: 'list',
  },
  {
    id: 'commit',
    label: 'Create the current draft',
    group: 'Create',
    keys: ['Mod+Enter'],
    scope: 'document',
    writes: true,
    inEditor: true,
  },
];
export const commandById = (id: string) => shortcutCommands.find((command) => command.id === id);
export type BindingMap = Record<string, string[]>;
export type KeyboardConfig = {
  version: 1;
  enabled: boolean;
  physical: boolean;
  overrides: BindingMap;
};
export const defaultKeyboardConfig: KeyboardConfig = {
  version: 1,
  enabled: true,
  physical: true,
  overrides: {},
};
export const bindingFor = (config: KeyboardConfig, id: string) =>
  config.overrides[id] ?? commandById(id)?.keys ?? [];
export function dispatchCommand(id: string) {
  window.dispatchEvent(new CustomEvent('tasks:command', { detail: id }));
}
