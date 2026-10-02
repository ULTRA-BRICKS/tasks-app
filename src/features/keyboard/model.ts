import { useEffect, useRef } from 'react';

export type CommandHandler = () => void;
/** Handlers keyed by command id (src/shared/lib/command-catalog.ts), attached at dispatch. */
export type CommandHandlers = Partial<Record<string, CommandHandler>>;
export type PageCommands = {
  handlers: CommandHandlers;
  /** Escape clears a non-empty selection before it leaves the page context. */
  selection?: { count: number; clear: () => void };
};

// Mounted pages, oldest first; the newest registration wins.
const pages: Array<{ current: PageCommands }> = [];

/** Registers a page's handlers and selection layer while it is mounted. */
export function usePageCommands(commands: PageCommands) {
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  useEffect(() => {
    const entry = latest;
    pages.push(entry);
    return () => {
      pages.splice(pages.indexOf(entry), 1);
    };
  }, []);
}

export function pageHandler(commandId: string): CommandHandler | undefined {
  for (const page of [...pages].reverse()) {
    const handler = page.current.handlers[commandId];
    if (handler) return handler;
  }
  return undefined;
}

/** The newest mounted page that has a selection layer, like `pageHandler`. */
export const pageSelection = () =>
  [...pages].reverse().find((page) => page.current.selection)?.current.selection;
