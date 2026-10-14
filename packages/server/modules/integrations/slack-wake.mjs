/** Request-local Slack job journal, reached by the exported HTTP assembly.
 * Only successful database commits merge job identities; nested MCP REST calls share the journal.
 * No HTTP body, response status, actor or unrelated backlog is used as publication authority.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
const requests = new AsyncLocalStorage();
const transactionJobs = Symbol('Slack transaction jobs');
export function noteSlackJob(tx, jobId) {
  tx[transactionJobs]?.add(jobId);
}
export function trackSlackTransactions(db) {
  return {
    ...db,
    async transaction(fn, options) {
      const request = requests.getStore();
      const jobs = new Set();
      const result = await db.transaction((tx) => fn({ ...tx, [transactionJobs]: jobs }), options);
      if (request) for (const jobId of jobs) request.jobs.add(jobId);
      return result;
    },
  };
}
export function withSlackRequest(execute) {
  const parent = requests.getStore();
  if (parent) return execute(parent, true);
  const scope = { jobs: new Set() };
  return requests.run(scope, () => execute(scope, false));
}
