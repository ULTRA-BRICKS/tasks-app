export type Command = {
  id: string;
  label: string;
  group: string;
  keys: string[];
  route?: string;
  scope?: 'list' | 'issue';
  editor?: boolean;
  write?: boolean;
};
export const commands: Command[] = [
  { id: 'search', label: 'Command menu', group: 'General', keys: ['Mod+k'], editor: true },
  {
    id: 'help',
    label: 'Keyboard shortcuts',
    group: 'General',
    keys: ['Mod+/', 'Shift+/'],
    editor: true,
  },
  { id: 'undo', label: 'Undo last change', group: 'General', keys: ['Mod+z'] },
  { id: 'redo', label: 'Redo last change', group: 'General', keys: ['Mod+Shift+z', 'Mod+y'] },
  {
    id: 'new',
    label: 'Create new issue',
    group: 'Create',
    keys: ['c', 'v'],
    route: '/issues/new',
    write: true,
  },
  {
    id: 'newProject',
    label: 'Create new project',
    group: 'Create',
    keys: [],
    route: '/projects/new',
    write: true,
  },
  {
    id: 'newDocument',
    label: 'Create new document',
    group: 'Create',
    keys: [],
    route: '/documents/new',
    write: true,
  },
  { id: 'issues', label: 'Go to all issues', group: 'Navigation', keys: ['g a'], route: '/issues' },
  { id: 'inbox', label: 'Go to inbox', group: 'Navigation', keys: ['g i', 'g n'], route: '/inbox' },
  { id: 'mine', label: 'Go to my issues', group: 'Navigation', keys: ['g m'], route: '/my-issues' },
  {
    id: 'projects',
    label: 'Go to projects',
    group: 'Navigation',
    keys: ['g p'],
    route: '/projects',
  },
  { id: 'cycles', label: 'Go to cycles', group: 'Navigation', keys: ['g c'], route: '/cycles' },
  {
    id: 'documents',
    label: 'Go to documents',
    group: 'Navigation',
    keys: ['g d'],
    route: '/documents',
  },
  {
    id: 'settings',
    label: 'Go to settings',
    group: 'Navigation',
    keys: ['g s'],
    route: '/settings',
  },
  { id: 'next', label: 'Next issue', group: 'Issue list', keys: ['j', 'ArrowDown'], scope: 'list' },
  {
    id: 'previous',
    label: 'Previous issue',
    group: 'Issue list',
    keys: ['k', 'ArrowUp'],
    scope: 'list',
  },
  {
    id: 'extendNext',
    label: 'Extend selection down',
    group: 'Issue list',
    keys: ['Shift+j', 'Shift+ArrowDown'],
    scope: 'list',
  },
  {
    id: 'extendPrevious',
    label: 'Extend selection up',
    group: 'Issue list',
    keys: ['Shift+k', 'Shift+ArrowUp'],
    scope: 'list',
  },
  { id: 'select', label: 'Toggle selection', group: 'Issue list', keys: ['x'], scope: 'list' },
  {
    id: 'extend',
    label: 'Select range to focused issue',
    group: 'Issue list',
    keys: ['Shift+x'],
    scope: 'list',
  },
  {
    id: 'selectAll',
    label: 'Select all visible issues',
    group: 'Issue list',
    keys: ['Mod+a'],
    scope: 'list',
  },
  {
    id: 'board',
    label: 'Switch list / board',
    group: 'Issue list',
    keys: ['Mod+b'],
    scope: 'list',
  },
  {
    id: 'status',
    label: 'Change status',
    group: 'Issue',
    keys: ['s'],
    scope: 'issue',
    write: true,
  },
  {
    id: 'priority',
    label: 'Change priority',
    group: 'Issue',
    keys: ['p'],
    scope: 'issue',
    write: true,
  },
  {
    id: 'assignee',
    label: 'Change assignee',
    group: 'Issue',
    keys: ['a'],
    scope: 'issue',
    write: true,
  },
  { id: 'title', label: 'Edit title', group: 'Issue', keys: ['e'], scope: 'issue', write: true },
  {
    id: 'comment',
    label: 'Write comment',
    group: 'Issue',
    keys: ['m'],
    scope: 'issue',
    write: true,
  },
  { id: 'copyLink', label: 'Copy link', group: 'Copy', keys: ['Mod+Shift+c'] },
  { id: 'copyId', label: 'Copy issue ID', group: 'Copy', keys: ['Mod+.'] },
  { id: 'copyMarkdown', label: 'Copy Markdown', group: 'Copy', keys: [] },
  { id: 'copyBranch', label: 'Copy branch name', group: 'Copy', keys: ['Mod+Shift+.'] },
  { id: 'copyPrompt', label: 'Copy prompt', group: 'Copy', keys: [] },
];
export function emitCommand(id: string) {
  window.dispatchEvent(new CustomEvent('tasks:command', { detail: id }));
}
export const byCommandId = (id: string) => commands.find((command) => command.id === id);
export const defaultBindings = () => Object.fromEntries(commands.map((c) => [c.id, [...c.keys]]));
