import { useEffect, useState, useSyncExternalStore } from 'react';
import type { IssueDetail } from '@tickets/contracts';
import { useIssueUpdate } from './model';
import { createDocumentController } from './document-controller';
import { mergeVersioned } from '@/shared/lib/versioned';
import { ApiError, errorMessage } from '@/shared/api/client';
import type { ServerDocument } from '@/shared/lib/draft';
function storagePort() {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch (failure) {
    return {
      getItem: () => {
        throw failure;
      },
      setItem: () => {
        throw failure;
      },
      removeItem: () => {
        throw failure;
      },
    };
  }
}
function conflictFrom(failure: unknown): ServerDocument | undefined {
  if (!(failure instanceof ApiError)) return undefined;
  const current: unknown = failure.details?.current;
  if (
    current &&
    typeof current === 'object' &&
    'title' in current &&
    'description' in current &&
    'version' in current &&
    typeof current.title === 'string' &&
    typeof current.description === 'string' &&
    typeof current.version === 'number' &&
    Number.isSafeInteger(current.version) &&
    current.version > 0
  ) {
    return { title: current.title, description: current.description, version: current.version };
  }
  return undefined;
}
export function useInlineDocument(issue: IssueDetail, storageKey: string) {
  const { mutateAsync } = useIssueUpdate();
  // The caller keys the editor by account/workspace/issue, so ownership changes
  // remount this initializer rather than mutating refs during React rendering.
  const [controller] = useState(() =>
    createDocumentController({
      initial: issue,
      storageKey,
      storage: storagePort(),
      conflictFrom,
      describeError: errorMessage,
      save: async (sent, latest) => {
        const result = await mutateAsync({
          issue: { ...latest, version: sent.version },
          patch: { title: sent.title, description: sent.description },
        });
        return mergeVersioned(latest, result);
      },
    }),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    controller.activate();
    return () => controller.deactivate();
  }, [controller]);
  useEffect(() => {
    controller.observe(issue);
  }, [controller, issue]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (controller.getSnapshot().dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [controller]);
  return {
    ...snapshot,
    beginEdit: controller.beginEdit,
    endEdit: controller.endEdit,
    change: controller.change,
    commit: () => {
      void controller.commit();
    },
    flush: controller.flush,
    resolveConflict: () => {
      void controller.resolveConflict();
    },
    retry: () => {
      void controller.retry();
    },
    discard: controller.discard,
  };
}
