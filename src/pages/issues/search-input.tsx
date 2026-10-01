import { Input } from '@/shared/ui';
import { useSyncedText } from '@/shared/lib/use-synced-text';
/**
 * Own component so keystrokes re-render this input only, never the task list; keep `value` a
 * primitive and do not lift the hook into the page. See docs/TASK-LIST-SEARCH.md.
 */
export function TaskSearchInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (text: string) => void;
}) {
  return (
    <Input
      aria-label="Search tasks"
      placeholder="Search tasks…"
      {...useSyncedText(value, onCommit)}
    />
  );
}
