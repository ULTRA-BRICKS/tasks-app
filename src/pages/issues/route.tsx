import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { taskReference } from '@/shared/lib/task-reference';
import { IssuesPage } from './ui';
/** Old shared URLs stay functional; never reuse a legacy display code as a different identity. */
export function LegacyTaskRoute() {
  const location = useLocation();
  const pathname = location.pathname
    .replace(/^\/my-issues(?=\/|$)/, '/my-tasks')
    .replace(/^\/issues(?=\/|$)/, '/tasks');
  return (
    <Navigate replace to={pathname + location.search + location.hash} state={location.state} />
  );
}
export function TaskDetailRoute() {
  const { issueId = '' } = useParams(),
    reference = taskReference(issueId);
  if (!reference)
    return (
      <section className="empty-state">
        <h1>Task not found</h1>
        <p>This address does not contain a valid task UUID or code.</p>
        <Link className="button button-secondary" to="/tasks">
          Back to tasks
        </Link>
      </section>
    );
  return <IssuesPage reference={reference} />;
}
