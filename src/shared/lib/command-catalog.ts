/**
 * Workspace commands and their default bindings. Order is significant: help, the palette and
 * the remap UI list commands in this order, and conflict resolution keeps the earlier one.
 */
import type { CommandDefinition, Platform } from './commands';

const everywhere = (...keys: string[]): Record<Platform, readonly string[]> => ({
  mac: keys,
  other: keys,
});

export const workspaceCommands: readonly CommandDefinition[] = [
  {
    id: 'palette.open',
    title: 'Open command menu',
    group: 'General',
    keys: everywhere('Mod+K'),
    allowInTextEntry: true,
  },
  {
    id: 'help.open',
    title: 'Show keyboard shortcuts',
    group: 'General',
    keys: everywhere('Mod+/', '?'),
    allowInTextEntry: true,
  },
  {
    id: 'layer.dismiss',
    title: 'Close, cancel or clear the selection',
    group: 'General',
    keys: everywhere('Escape'),
    fixed: true,
  },
  {
    id: 'task.create',
    title: 'Create task',
    group: 'Tasks',
    keys: everywhere('C', 'V'),
    requires: 'edit',
  },
  { id: 'nav.tasks', title: 'Go to tasks', group: 'Navigation', keys: everywhere('G I') },
  { id: 'nav.my-tasks', title: 'Go to my tasks', group: 'Navigation', keys: everywhere('G M') },
  { id: 'nav.projects', title: 'Go to projects', group: 'Navigation', keys: everywhere('G P') },
  { id: 'nav.cycles', title: 'Go to cycles', group: 'Navigation', keys: everywhere('G C') },
  { id: 'nav.inbox', title: 'Go to inbox', group: 'Navigation', keys: everywhere('G N') },
  { id: 'nav.settings', title: 'Go to settings', group: 'Navigation', keys: everywhere('G S') },
  {
    id: 'list.next',
    title: 'Focus next task',
    group: 'Task list',
    keys: everywhere('J', 'ArrowDown'),
  },
  {
    id: 'list.previous',
    title: 'Focus previous task',
    group: 'Task list',
    keys: everywhere('K', 'ArrowUp'),
  },
  {
    id: 'list.extend-next',
    title: 'Extend selection down',
    group: 'Task list',
    keys: everywhere('Shift+J', 'Shift+ArrowDown'),
  },
  {
    id: 'list.extend-previous',
    title: 'Extend selection up',
    group: 'Task list',
    keys: everywhere('Shift+K', 'Shift+ArrowUp'),
  },
  {
    id: 'selection.toggle',
    title: 'Select focused task',
    group: 'Task list',
    keys: everywhere('X'),
  },
  {
    id: 'edit.undo',
    title: 'Undo last saved change',
    group: 'Editing',
    keys: everywhere('Mod+Z'),
    requires: 'edit',
  },
  {
    id: 'edit.redo',
    title: 'Redo',
    group: 'Editing',
    keys: { mac: ['Mod+Shift+Z'], other: ['Mod+Y', 'Mod+Shift+Z'] },
    requires: 'edit',
  },
];
