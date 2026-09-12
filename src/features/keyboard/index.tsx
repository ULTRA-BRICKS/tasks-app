import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMe } from '@/entities/workspace';
import { Modal } from '@/shared/ui';
import { shortcutGuard, navigationChords } from '@/shared/lib/shortcuts';
export function WorkspaceKeyboard({ onSearch }: { onSearch: () => void }) {
  const { data: me } = useMe(),
    navigate = useNavigate(),
    location = useLocation();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let chordUntil = 0;
    const listener = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Deliberate exception: command search works inside editors; ordinary keys do not.
      // Covered by the editor-command-menu browser regression.
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        if (
          e.defaultPrevented ||
          e.isComposing ||
          document.querySelector('[role="dialog"],[role="menu"],[role="listbox"]')
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        onSearch();
        return;
      }
      if (shortcutGuard(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (chordUntil > Date.now() && navigationChords[key]) {
        e.preventDefault();
        chordUntil = 0;
        void navigate(navigationChords[key]);
        return;
      }
      chordUntil = 0;
      if (key === 'g') {
        chordUntil = Date.now() + 1000;
        return;
      }
      if ((key === 'c' || key === 'v') && !e.repeat && me?.role !== 'viewer') {
        e.preventDefault();
        void navigate('/issues/new', { state: { from: location.pathname + location.search } });
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelp(true);
        return;
      }
      if (e.key === 'Escape' && location.pathname.startsWith('/issues/')) {
        e.preventDefault();
        void navigate(location.state?.from ?? '/issues');
        return;
      }
      if (!['j', 'k', 'arrowdown', 'arrowup', 'x'].includes(key)) return;
      const rows = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.issue-list .issue-open'),
      ).filter((row) => row.getClientRects().length);
      const active = document.activeElement
        ?.closest('.issue-row')
        ?.querySelector<HTMLButtonElement>('.issue-open');
      const index = active ? rows.indexOf(active) : -1;
      if (rows.length && ['j', 'k', 'arrowdown', 'arrowup'].includes(key)) {
        e.preventDefault();
        const forward = key === 'j' || key === 'arrowdown';
        const next =
          index < 0
            ? forward
              ? 0
              : rows.length - 1
            : Math.min(rows.length - 1, Math.max(0, index + (forward ? 1 : -1)));
        rows[next].focus();
        rows[next].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (key === 'x' && active) {
        e.preventDefault();
        active
          .closest('.issue-row')
          ?.querySelector<HTMLInputElement>('input[type=checkbox]')
          ?.click();
      }
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [me?.role, navigate, location, onSearch]);
  return (
    <Modal open={help} onOpenChange={setHelp} title="Keyboard shortcuts">
      <dl className="shortcut-reference">
        <dt>J / K or ↓ / ↑</dt>
        <dd>Move through visible issues</dd>
        <dt>Enter</dt>
        <dd>Open the focused issue</dd>
        <dt>X</dt>
        <dd>Select the focused issue</dd>
        <dt>C / V</dt>
        <dd>New issue page</dd>
        <dt>⌘ / Ctrl K</dt>
        <dd>Command menu</dd>
        <dt>G then I / M / P / C</dt>
        <dd>Issues / My issues / Projects / Cycles</dd>
        <dt>Escape</dt>
        <dd>Cancel the active edit or return to the list</dd>
        <dt>?</dt>
        <dd>This help</dd>
      </dl>
    </Modal>
  );
}
