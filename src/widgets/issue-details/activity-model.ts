import type { Activity } from '@tickets/contracts';

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
