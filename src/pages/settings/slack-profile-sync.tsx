import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
import { Button, ErrorState } from '@/shared/ui';

/** Counts one sync reports (docs/SLACK-PROFILES.md). */
export interface SlackProfileCounts {
  mapped: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  bots: number;
  cross_workspace: number;
  not_found: number;
}
/** The last attempt, as `GET /v1/integrations` returns it. */
export interface SlackProfileSyncRun {
  at: string;
  actor_name: string | null;
  outcome: string;
  counts?: SlackProfileCounts;
}
interface SyncResult {
  synced_at: string;
  counts: SlackProfileCounts;
  cross_workspace: string[];
  not_found: string[];
}

/** "Synced 3 of 3 mapped people · 1 new · 2 updated", with the exceptions that need attention. */
export function syncSummary(counts: SlackProfileCounts) {
  if (!counts.mapped)
    return 'No Slack users are mapped yet. Add them to user_map or source_person_map and save.';
  const synced = counts.created + counts.updated + counts.unchanged;
  return [
    `Synced ${synced} of ${counts.mapped} mapped ${counts.mapped === 1 ? 'person' : 'people'}`,
    ...(
      [
        [counts.created, 'new'],
        [counts.updated, 'updated'],
        [counts.deactivated, 'deactivated in Slack'],
        [counts.bots, counts.bots === 1 ? 'bot' : 'bots'],
        [counts.cross_workspace, 'from another Slack workspace, skipped'],
        [counts.not_found, 'not found in Slack'],
      ] as const
    )
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}`),
  ].join(' · ');
}

/**
 * The administrator's Slack profile sync on the Slack card: runs only on request, reports the
 * result, and explains which environment variable names are missing instead of failing.
 */
export function SlackProfileSync({
  configured,
  last,
}: {
  configured: boolean;
  last: SlackProfileSyncRun | null;
}) {
  const client = useQueryClient();
  const sync = useMutation({
    mutationFn: () =>
      api<SyncResult>('/v1/integrations/slack/profiles/sync', { method: 'POST', json: {} }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['integrations'] });
      void client.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
  return (
    <section className="slack-profile-sync" aria-labelledby="slack-profile-sync-title">
      <h4 id="slack-profile-sync-title">Slack profiles</h4>
      <p>
        Shows the Slack name and photo of every mapped person. Tasks reads them from Slack only when
        you sync, and never reads Slack email addresses.
      </p>
      {!configured && (
        <p className="slack-profile-sync-hint" id="slack-profile-sync-hint">
          Unavailable until the deployment sets <code>SLACK_BOT_TOKEN</code>,{' '}
          <code>SLACK_TEAM_ID</code> and <code>INTEGRATIONS_WORKSPACE_ID</code> for this workspace.
        </p>
      )}
      <Button
        variant="secondary"
        disabled={!configured || sync.isPending}
        aria-describedby={configured ? undefined : 'slack-profile-sync-hint'}
        onClick={() => sync.mutate()}
      >
        <RefreshCw size={14} />
        {sync.isPending ? 'Syncing…' : 'Sync Slack profiles'}
      </Button>
      <output className="slack-profile-sync-result">
        {sync.data ? syncSummary(sync.data.counts) : ''}
      </output>
      {sync.error && <ErrorState message={errorMessage(sync.error)} />}
      {last && !sync.data && !sync.error && (
        <p className="slack-profile-sync-last">
          Last sync {formatDate(last.at)}
          {last.actor_name ? ` by ${last.actor_name}` : ''}:{' '}
          {last.outcome === 'ok' && last.counts
            ? syncSummary(last.counts)
            : `failed (${last.outcome})`}
        </p>
      )}
    </section>
  );
}
