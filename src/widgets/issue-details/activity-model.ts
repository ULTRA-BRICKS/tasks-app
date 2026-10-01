import type { Activity, ActivityChange } from '@tickets/contracts';

// Consecutive edits by one person within this gap read as one entry (docs/TASK-ACTIVITY.md).
export const GROUP_WINDOW_MS = 10 * 60 * 1000;
const UPDATE = 'updated the task';

export interface ActivityEntry {
  id: string;
  actor_name: string;
  summary: string;
  created_at: string;
  // Every grouped event stays in chronological order so each field change remains inspectable.
  events: Activity[];
}

// `activity` arrives newest first; entries are returned oldest first, newest `limit` kept.
export function groupActivity(activity: Activity[], limit = 8): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  const actor = (event: Activity) =>
    `${event.actor_id}\u0000${event.actor_source_id ?? ''}\u0000${event.actor_name}`;
  for (const event of [...activity].reverse()) {
    const summary = event.summary ?? UPDATE,
      last = entries.at(-1),
      previous = last?.events.at(-1);
    if (
      last &&
      previous &&
      summary === UPDATE &&
      last.summary === UPDATE &&
      actor(previous) === actor(event) &&
      Date.parse(event.created_at) - Date.parse(previous.created_at) <= GROUP_WINDOW_MS
    ) {
      last.events.push(event);
      last.created_at = event.created_at;
    } else
      entries.push({
        id: event.id,
        actor_name: event.actor_name,
        summary,
        created_at: event.created_at,
        events: [event],
      });
  }
  return entries.slice(-limit);
}

// One sentence per line (UB-100): a change, or a verb such as `created the task`.
export type ActivityLine =
  | { kind: 'change'; change: ActivityChange }
  | { kind: 'note'; text: string };

// The lines of an entry, first line first. `updated the task` is never a line of its own while
// the entry names what changed: the changes are the sentence. Any other verb leads its changes.
export function entryLines(entry: ActivityEntry): ActivityLine[] {
  const lines: ActivityLine[] = [];
  if (entry.summary !== UPDATE) lines.push({ kind: 'note', text: entry.summary });
  // Every change line comes before every detail line.
  const details: ActivityLine[] = [];
  for (const event of entry.events) {
    for (const change of event.changes ?? []) lines.push({ kind: 'change', change });
    for (const text of event.details ?? []) details.push({ kind: 'note', text });
  }
  lines.push(...details);
  return lines.length ? lines : [{ kind: 'note', text: entry.summary }];
}

// Inline wording of a label change: `added label Bug`, `added labels A B and removed C`.
export function labelPhrases(change: Extract<ActivityChange, { kind: 'labels' }>) {
  const labelNoun = (names: string[]) => (names.length === 1 ? 'label' : 'labels');
  const phrases: { verb: string; names: string[] }[] = [];
  if (change.added.length)
    phrases.push({ verb: 'added ' + labelNoun(change.added), names: change.added });
  if (change.removed.length)
    phrases.push({
      verb: phrases.length ? 'and removed' : 'removed ' + labelNoun(change.removed),
      names: change.removed,
    });
  return phrases;
}
