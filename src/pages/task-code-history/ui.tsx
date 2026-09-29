import { Link, useParams } from 'react-router-dom';
import { History, PanelLeft } from 'lucide-react';
import type { PreCanonicalCodeHistory } from '@tickets/contracts';
import { StatusIcon, usePreCanonicalCode } from '@/entities/issue';
import { usePreferences } from '@/features/preferences';
import { Button, ErrorState, Loading } from '@/shared/ui';
import { ApiError, errorMessage } from '@/shared/api/client';
import { formatDate } from '@/shared/lib/date';
import { preCanonicalCode } from '@/shared/lib/task-reference';
/**
 * Origin-qualified historical lookup (docs/TASK-URLS-AND-NAMING.md): lists every task that held a code
 * before canonical renumbering with its code chain. It never redirects, so the provenance stays visible.
 */
export function PreCanonicalCodePage() {
  const { code: segment = '' } = useParams(),
    code = preCanonicalCode(segment),
    query = usePreCanonicalCode(code),
    prefs = usePreferences();
  const unknown = !code || (query.error instanceof ApiError && query.error.status === 404);
  return (
    <>
      <header className="page-toolbar" data-page-header>
        <Button
          className="mobile-only"
          size="icon"
          variant="ghost"
          aria-label="Open navigation"
          onClick={() => prefs.setSidebarOpen(true)}
        >
          <PanelLeft size={17} />
        </Button>
        <div className="page-heading">
          <History size={17} />
          <h1>Pre-canonical {code ? <Code>{code}</Code> : 'code'}</h1>
        </div>
        <span className="muted">Task codes before canonical renumbering</span>
      </header>
      <div className="code-history">
        {unknown ? (
          <section className="empty-state">
            <h2>
              {code ? (
                <>
                  No task had <Code>{code}</Code> before canonical renumbering
                </>
              ) : (
                'This address does not contain a valid task code'
              )}
            </h2>
            <p>Only codes recorded by a canonical renumbering of this workspace are listed here.</p>
            <div className="code-history-actions">
              {code && (
                <Link className="button button-secondary" to={'/tasks/' + code}>
                  Open current {code}
                </Link>
              )}
              <Link className="button button-ghost" to="/tasks">
                Back to tasks
              </Link>
            </div>
          </section>
        ) : query.isPending ? (
          <Loading label="Looking up code" />
        ) : query.error ? (
          <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} />
        ) : (
          <CodeHistory history={query.data} />
        )}
      </div>
    </>
  );
}
/** Codes contain a hyphen; never let a narrow line split one across two lines. */
function Code({ children }: { children: string }) {
  return <span className="code-history-code">{children}</span>;
}
function CodeHistory({ history }: { history: PreCanonicalCodeHistory }) {
  const { code, matches, current } = history;
  return (
    <>
      <p className="code-history-summary">
        {history.ambiguous ? (
          <>
            <Code>{code}</Code> referred to {matches.length} tasks before canonical renumbering.
            Newest renumbering first; choose the task you meant.
          </>
        ) : (
          <>
            Before canonical renumbering, <Code>{code}</Code> was this task.
          </>
        )}
      </p>
      <ul className="code-history-list" aria-label={'Tasks that had ' + code}>
        {matches.map((match) => (
          <li className="code-history-match" key={match.task?.id ?? match.steps[0].migration_id}>
            {match.task ? (
              <Link className="code-history-task" to={'/tasks/' + match.task.id}>
                <StatusIcon
                  category={match.task.status_category}
                  color={match.task.status_color}
                  label={match.task.status_name}
                />
                <span className="issue-key">{match.task.key}</span>
                <span className="code-history-title">{match.task.title}</span>
              </Link>
            ) : (
              <span className="code-history-task muted">Deleted task</span>
            )}
            <ol className="code-history-steps" aria-label="Code changes">
              {match.steps.map((step) => (
                <li key={step.migration_id}>
                  <span>
                    {step.from === step.to ? (
                      <>
                        kept <span className="issue-key">{step.to}</span>
                      </>
                    ) : (
                      <>
                        <span className="issue-key">{step.from}</span> →{' '}
                        <span className="issue-key">{step.to}</span>
                      </>
                    )}
                  </span>
                  <time dateTime={step.at}>{formatDate(step.at, true)}</time>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
      {current && (
        <p className="code-history-current">
          Today <Code>{code}</Code> opens <Link to={'/tasks/' + current.id}>{current.title}</Link>.
        </p>
      )}
    </>
  );
}
