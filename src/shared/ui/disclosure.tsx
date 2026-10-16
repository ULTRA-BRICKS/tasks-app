/**
 * Native `<details>` disclosure. Baseline keeps the browser-owned open flag.
 * The state-lib build registers it as a UI owner. Native toggle events publish
 * the resulting value; an unchanged value produces no feedback update.
 */
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { useLocalState } from '../lib/state/local';

type DisclosureProps = { summary: ReactNode; children: ReactNode; defaultOpen?: boolean };
const baseline = import.meta.env.VITE_STATE_BACKEND === 'baseline';

function BaselineDisclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  const [initialOpen] = useState(defaultOpen);
  return (
    <details {...(initialOpen ? { open: true } : {})}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
function OwnedDisclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  const [open, setOpen] = useLocalState(defaultOpen);
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open;
    setOpen((current) => (current === next ? current : next));
  };
  return (
    <details open={open} onToggle={onToggle}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
export const Disclosure: (props: DisclosureProps) => ReactNode = baseline
  ? BaselineDisclosure
  : OwnedDisclosure;
