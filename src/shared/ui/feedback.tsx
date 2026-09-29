import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react';
import { Button } from './button';
export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={25} />
      </span>
      <h2>{title}</h2>
      <p>{description ?? 'Create a task to start a conversation.'}</p>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={16} />
      <div className="error-state-body">
        <span>{message}</span>
        {retry && (
          <Button size="sm" onClick={retry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <output className="loading">
      <LoaderCircle className="spin" size={18} />
      <span>{label}…</span>
    </output>
  );
}
export function SkeletonRows() {
  return (
    <output aria-label="Loading tasks">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ))}
    </output>
  );
}
