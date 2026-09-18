/** The editor and preferences use the same explicitly selected backend. */
export const documentBackend =
  import.meta.env.VITE_STATE_BACKEND === 'baseline' ? 'baseline' : 'state-lib';
const implementation =
  documentBackend === 'baseline'
    ? await import('./document-baseline')
    : await import('./document-state-lib');
export const useInlineDocument = implementation.useInlineDocument;
if (typeof document !== 'undefined')
  document.documentElement.dataset.documentBackend = documentBackend;
