import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Issue, IssueCreate } from '@tickets/contracts';
// Compatibility bridge for all existing create actions: never renders a modal.
export function CreateIssue({
  open,
  onOpenChange,
  defaults = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (issue: Issue) => void;
  defaults?: Partial<IssueCreate>;
}) {
  const navigate = useNavigate(),
    location = useLocation();
  useEffect(() => {
    if (open) {
      onOpenChange(false);
      void navigate('/tasks/new', {
        state: { defaults, from: location.pathname + location.search },
      });
    }
  }, [open, onOpenChange, navigate, defaults, location.pathname, location.search]);
  return null;
}
