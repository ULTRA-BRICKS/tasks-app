import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMe } from '@/entities/workspace';
import { Modal } from '@/shared/ui';
import { shortcutGuard } from '@/shared/lib/shortcuts';
import { useLatest, useScope, useStore } from '@/shared/lib/state/react';
import { createKeyboardController, type RowsPort } from './controller';
import { ShortcutReference } from './reference';

const ROW_SELECTOR = '.issue-list .issue-open';
function visibleRows() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR)).filter(
    (row) => row.getClientRects().length,
  );
}
function focusedRow() {
  return document.activeElement?.closest('.issue-row') ?? null;
}
/** DOM rows stay behind this port as opaque handles; only indices cross into state. */
const domRows: RowsPort = {
  count: () => visibleRows().length,
  activeIndex: () => {
    const active = focusedRow()?.querySelector<HTMLButtonElement>('.issue-open');
    return active ? visibleRows().indexOf(active) : -1;
  },
  focusAt(index) {
    const row = visibleRows()[index];
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  },
  toggleActive() {
    const box = focusedRow()?.querySelector<HTMLInputElement>('input[type=checkbox]');
    box?.click();
    return focusedRow() !== null;
  },
};
const overlayOpen = () =>
  Boolean(document.querySelector('dialog[open],[role="dialog"],[role="menu"],[role="listbox"]'));

export function WorkspaceKeyboard({ onSearch }: { onSearch: () => void }) {
  const { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation();
  const latest = useLatest({ me, navigate, location, onSearch });
  const [controller] = useState(() =>
    createKeyboardController<KeyboardEvent>({
      now: () => Date.now(),
      navigate: (path, options) => void latest().navigate(path, options),
      location: () => {
        const { pathname, search, state } = latest().location;
        return { pathname, search, from: state?.from };
      },
      role: () => latest().me?.role,
      openSearch: () => latest().onSearch(),
      guard: shortcutGuard,
      overlayOpen,
      rows: domRows,
    }),
  );
  useScope(() => controller.scope);
  const help = useStore(controller.help);
  useEffect(() => {
    controller.reset();
  }, [controller, location.pathname, location.search]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => controller.handle(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [controller]);
  return (
    <Modal open={help} onOpenChange={controller.setHelp} title="Keyboard shortcuts">
      <ShortcutReference />
    </Modal>
  );
}
