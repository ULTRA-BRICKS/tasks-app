import { Fragment, useId, useMemo, useState, type ReactNode } from 'react';
import { PersonChip } from '@/entities/workspace';
import type { Activity, ActivityChange } from '@tickets/contracts';
import { formatDate } from '@/shared/lib/date';
import { diffText, type DiffRow } from '@/shared/lib/text-diff';
import { entryLines, groupActivity, labelPhrases, type ActivityLine } from './activity-model';

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function DiffLine({ row }: { row: Exclude<DiffRow, { type: 'skip' }> }) {
  return (
    <div className={`diff-row diff-${row.type}`}>
      <span className="diff-sign" aria-hidden="true">
        {row.type === 'added' ? '+' : row.type === 'removed' ? '−' : ''}
      </span>
      <span className="diff-text">
        {row.type !== 'same' && (
          <span className="sr-only">{row.type === 'added' ? 'Added: ' : 'Removed: '}</span>
        )}
        {row.parts.map((part, at) =>
          part.type === 'added' ? (
            <ins key={at}>{part.text}</ins>
          ) : part.type === 'removed' ? (
            <del key={at}>{part.text}</del>
          ) : (
            <Fragment key={at}>{part.text}</Fragment>
          ),
        )}
      </span>
    </div>
  );
}

// Mounted only while open, so the diff is computed only when the reader asks for it.
function DescriptionDiff({
  id,
  label,
  from,
  to,
}: {
  id: string;
  label: string;
  from: string;
  to: string;
}) {
  const rows = useMemo(() => diffText(from, to), [from, to]);
  // Collapsed unchanged runs the reader expanded, by row index.
  const [shown, setShown] = useState<ReadonlySet<number>>(() => new Set());
  const removed = rows?.filter((row) => row.type === 'removed').length ?? 0,
    added = rows?.filter((row) => row.type === 'added').length ?? 0;
  return (
    <div className="activity-diff" id={id}>
      <div className="diff-header">
        <span>{label}</span>
        {rows && (
          <span className="diff-stats">
            <span className="diff-stat-removed" aria-hidden="true">
              −{removed}
            </span>
            <span className="diff-stat-added" aria-hidden="true">
              +{added}
            </span>
            <span className="sr-only">
              {plural(removed, 'line')} removed, {plural(added, 'line')} added
            </span>
          </span>
        )}
      </div>
      <div className="diff-body">
        {rows ? (
          rows.map((row, index) =>
            row.type !== 'skip' ? (
              <DiffLine row={row} key={index} />
            ) : shown.has(index) ? (
              <Fragment key={index}>
                {row.lines.map((text, at) => (
                  <DiffLine row={{ type: 'same', parts: [{ type: 'same', text }] }} key={at} />
                ))}
              </Fragment>
            ) : (
              <button
                type="button"
                className="diff-skip"
                key={index}
                onClick={() => setShown((current) => new Set(current).add(index))}
              >
                Show {plural(row.lines.length, 'unchanged line')}
              </button>
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
    </div>
  );
}

function Line({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  return (
    <div className="activity-line" data-testid="activity-line">
      {lead}
      {lead && ' '}
      {children}
    </div>
  );
}

// A description edit: one line with its disclosure; the diff opens below that line.
function DescriptionLine({
  lead,
  label,
  from,
  to,
}: {
  lead: ReactNode;
  label: string;
  from: string;
  to: string;
}) {
  const [open, setOpen] = useState(false),
    id = useId();
  return (
    <>
      <Line lead={lead}>
        edited the description{' '}
        <button
          type="button"
          className="activity-diff-toggle"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Hide changes' : 'View changes'}
        </button>
      </Line>
      {open && <DescriptionDiff id={id} label={label} from={from} to={to} />}
    </>
  );
}

function Value({ name, id, className }: { name: string; id?: string | null; className: string }) {
  return (
    <span className={`activity-value ${className}`}>
      {id ? <PersonChip id={id} name={name} display="name" /> : name}
    </span>
  );
}

function ChangeLine({ lead, change }: { lead: ReactNode; change: ActivityChange }) {
  if (change.kind === 'text')
    return change.from === null || change.to === null ? (
      <Line lead={lead}>
        edited the description{' '}
        <span className="activity-note">(Linear history does not include the text)</span>
      </Line>
    ) : (
      <DescriptionLine lead={lead} label={change.label} from={change.from} to={change.to} />
    );
  if (change.kind === 'labels')
    return (
      <Line lead={lead}>
        {labelPhrases(change).map((phrase, index) => (
          <Fragment key={index}>
            {index > 0 && ' '}
            {phrase.verb}
            {phrase.names.map((name, at) => (
              <Fragment key={at}>
                {' '}
                <span className="activity-label">{name}</span>
              </Fragment>
            ))}
          </Fragment>
        ))}
      </Line>
    );
  return (
    <Line lead={lead}>
      changed <span className="activity-field">{change.label}</span>{' '}
      <Value name={change.from} id={change.from_id} className="activity-from" />
      {/* The arrow stays with the old value when a narrow line wraps. */}
      <span className="activity-arrow">{'\u00a0→ '}</span>
      <Value name={change.to} id={change.to_id} className="activity-to" />
    </Line>
  );
}

function EntryLine({ lead, line }: { lead: ReactNode; line: ActivityLine }) {
  return line.kind === 'change' ? (
    <ChangeLine lead={lead} change={line.change} />
  ) : (
    <Line lead={lead}>{line.text}</Line>
  );
}

// Task activity (docs/TASK-ACTIVITY.md): one sentence per line — `Alex changed Status Todo →
// Backlog` — with the time at the end of the first line and viewable description edits.
export function ActivityFeed({ activity }: { activity: Activity[] }) {
  return groupActivity(activity).map((entry) => {
    // Imported history names the source person (none for Linear automation); native events name
    // the member, as the server resolves names. The group key (actor_id, actor_source_id,
    // actor_name) never mixes the two, since the server names automation 'Linear automation',
    // so the first event decides for the whole entry.
    const [first] = entry.events;
    const person =
      first.action === 'linear_imported_change' ? first.actor_source_id : first.actor_id;
    const actor = (
      <strong className="activity-actor">
        <PersonChip id={person} name={entry.actor_name} display="text" />
      </strong>
    );
    return (
      <div className="activity-event" key={entry.id} data-testid="activity-entry">
        <span className="activity-dot" />
        <div className="activity-lines">
          {/* Floats to the end of the first line; later lines and an open diff take full width. */}
          <time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time>
          {entryLines(entry).map((line, index) => (
            <EntryLine key={index} lead={index === 0 && actor} line={line} />
          ))}
        </div>
      </div>
    );
  });
}
