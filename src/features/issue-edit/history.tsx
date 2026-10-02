/**
 * Domain undo/redo for saved task properties (docs/KEYBOARD-COMMANDS.md, B5). A step is planned
 * against a fresh server read and refused when that field changed since, and the PATCH carries
 * the read's version, so a write landing in between still gets the server's 409.
 */
import './history.css';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Issue } from '@tickets/contracts';
import { issueQuery } from '@/entities/issue';
import { useMe } from '@/entities/workspace';
import { ApiError, errorMessage } from '@/shared/api/client';
import {
  dropHistoryStep,
  planHistoryStep,
  settleHistoryStep,
  type HistoryDirection,
} from '@/shared/lib/domain-history';
import {
  isUndoable,
  serverValueText,
  undoable,
  useHistoryStore,
  type Notice,
} from './history-model';
import { useIssueUpdate } from './model';

const verbs: Record<HistoryDirection, string> = { undo: 'Undid', redo: 'Redid' };
/** A 409 carries the server's current task; anything else is not trusted as one. */
const isIssue = (value: unknown): value is Issue =>
  typeof value === 'object' && value !== null && 'id' in value && 'version' in value;
function conflictText(direction: HistoryDirection, fields: string[], current: unknown) {
  const [field = ''] = fields;
  const name = isUndoable(field) ? undoable[field] : 'This task';
  const value = isIssue(current) ? serverValueText(field, current) : null;
  return value === null
    ? `${name} changed on the server, so ${direction} was skipped.`
    : `${name} is now “${value}” on the server, so ${direction} was skipped.`;
}

/** Undo and redo for the workspace keyboard and the command menu. */
export function useIssueHistory() {
  const client = useQueryClient(),
    { data: me } = useMe(),
    update = useIssueUpdate();
  const canEdit = me !== undefined && me.role !== 'viewer';
  const notify = (text: string, tone: Notice['tone']) =>
    useHistoryStore.setState({ notice: { text, tone } });
  const step = async (direction: HistoryDirection) => {
    const { busy, history } = useHistoryStore.getState();
    if (busy || !canEdit) return;
    const change = history[direction].at(-1);
    if (!change) return notify(`Nothing to ${direction}.`, 'status');
    useHistoryStore.setState({ busy: true });
    const drop = () =>
      useHistoryStore.setState((s) => ({ history: dropHistoryStep(s.history, direction) }));
    try {
      const current = await client
        .fetchQuery({ ...issueQuery(change.entityId), staleTime: 0 })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return undefined;
          throw error;
        });
      if (!current) {
        drop();
        return notify(`That task no longer exists, so ${direction} was skipped.`, 'alert');
      }
      const plan = planHistoryStep(
        useHistoryStore.getState().history,
        direction,
        () => ({ ...current }),
        canEdit,
      );
      if (plan.ok) {
        await update.mutateAsync({ issue: current, patch: plan.patch, record: false });
        useHistoryStore.setState((s) => ({ history: settleHistoryStep(s.history, direction) }));
        notify(`${verbs[direction]} ${plan.change.label} change on ${current.key}.`, 'status');
      } else if (plan.reason === 'conflict') {
        drop();
        notify(conflictText(direction, plan.fields, current), 'alert');
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        drop();
        notify(
          conflictText(direction, Object.keys(change.before), error.details?.current),
          'alert',
        );
      } else notify(errorMessage(error), 'alert');
    } finally {
      useHistoryStore.setState({ busy: false });
    }
  };
  return { undo: () => void step('undo'), redo: () => void step('redo') };
}

/** Announces undo/redo results; a conflict is an alert that names the server's value. */
export function HistoryNotice() {
  const notice = useHistoryStore((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => useHistoryStore.setState((s) => (s.notice === notice ? { notice: null } : s)),
      notice.tone === 'alert' ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div className="history-notices">
      <output className="history-notice">{notice?.tone === 'status' ? notice.text : ''}</output>
      <p role="alert" className="history-notice history-notice-alert">
        {notice?.tone === 'alert' ? notice.text : ''}
      </p>
    </div>
  );
}
