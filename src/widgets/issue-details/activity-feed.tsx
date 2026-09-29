import { useMemo, useState } from 'react';
import type { Activity, ActivityChange } from '@tickets/contracts';
import { formatDate } from '@/shared/lib/date';
import { diffText } from '@/shared/lib/text-diff';
import { groupActivity } from './activity-model';

// Native disclosure: keyboard, focus and expanded state come from <details>/<summary>.
function DescriptionDiff({ from, to }: { from: string; to: string }) {
  const [open, setOpen] = useState(false);
  // Computed only once the reader asks for it, not on every detail refetch.
  const rows = useMemo(() => (open ? diffText(from, to) : null), [open, from, to]);
  return (
    <details className="activity-diff-details" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="activity-diff-toggle">{open ? 'Hide changes' : 'View changes'}</summary>
      {open && (
        <div className="activity-diff">
          {rows ? (
            rows.map((row, index) =>
              row.type === 'skip' ? (
                <div className="diff-skip" key={index}>
                  {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
                </div>
              ) : (
                <div className={`diff-row diff-${row.type}`} key={index}>
                  <span className="diff-sign" aria-hidden="true">
                    {row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ' '}
                  </span>
                  <span className="diff-text">
                    {row.type !== 'same' && (
                      <span className="sr-only">
                        {row.type === 'added' ? 'Added: ' : 'Removed: '}
                      </span>
                    )}
                    {row.parts.map((part, at) =>
                      part.type === 'added' ? (
                        <ins key={at}>{part.text}</ins>
                      ) : part.type === 'removed' ? (
                        <del key={at}>{part.text}</del>
                      ) : (
                        <span key={at}>{part.text}</span>
                      ),
                    )}
                  </span>
                </div>
              ),
            )
          ) : (
            // Too large to compare line by line: show both complete versions.
            <>
              <div className="diff-version">
                <strong>Before</strong>
                <del>{from}</del>
              </div>
              <div className="diff-version">
                <strong>After</strong>
                <ins>{to}</ins>
              </div>
            </>
          )}
        </div>
      )}
    </details>
  );
}

function ChangeValue({ change }: { change: ActivityChange }) {
  if (change.kind === 'labels')
    return (
      <>
        {[
          change.added.length ? 'added ' + change.added.join(', ') : '',
          change.removed.length ? 'removed ' + change.removed.join(', ') : '',
        ]
          .filter(Boolean)
          .join('; ')}
      </>
    );
  if (change.kind === 'text')
    return change.from === null || change.to === null ? (
      <span className="activity-note">edited (Linear history does not include the text)</span>
    ) : (
      <DescriptionDiff from={change.from} to={change.to} />
    );
  return (
    <>
      <span className="activity-from">{change.from}</span> →{' '}
      <span className="activity-to">{change.to}</span>
    </>
  );
}

// Task activity: who changed what, with old → new values and viewable description edits.
export function ActivityFeed({ activity }: { activity: Activity[] }) {
  return groupActivity(activity).map((entry) => {
    const changes = entry.events.flatMap((event) => event.changes ?? []);
    const details = entry.events.flatMap((event) => event.details ?? []);
    return (
      <div className="activity-event" key={entry.id} data-testid="activity-entry">
        <span className="activity-dot" />
        <div className="activity-message">
          <div>
            <strong>{entry.actor_name}</strong> {entry.summary}
          </div>
          {changes.length > 0 && (
            <dl className="activity-changes">
              {changes.map((change, index) => (
                <div className="activity-change" key={index}>
                  <dt>{change.label}</dt>
                  <dd>
                    <ChangeValue change={change} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {details.map((detail, index) => (
            <div className="activity-detail" key={index}>
              {detail}
            </div>
          ))}
        </div>
        <time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time>
      </div>
    );
  });
}
