import { StateError, assertSideEffectsAllowed } from './core.js';
function createTicket() {
    let revoke;
    const revoked = new Promise((resolve) => {
        revoke = resolve;
    });
    return { controller: new AbortController(), outcome: 'superseded', committing: false, revoked, revoke };
}
function invalidateTicket(ticket, outcome) {
    ticket.outcome = outcome;
    // Once commit starts, its actual publication/error must win over lifecycle callbacks.
    if (!ticket.committing)
        ticket.revoke(outcome);
    ticket.controller.abort(outcome);
}
/** Optional reference module: await externally, then atomically commit only the latest result.
 * Cancellation revokes commit authority even for non-cooperative loaders. It is not a
 * server-side reservation, a query cache, or a promise to undo external side effects. */
export function latestTask(runtime, load, commit) {
    let active;
    let disposed = false;
    const assertBoundary = () => {
        if (disposed)
            throw new StateError('STATE_TASK_DISPOSED', 'The task owner was disposed');
        if (runtime.inTransaction)
            throw new StateError('STATE_TASK_BOUNDARY', 'Start async work outside transactions');
        // Reuse kernel purity, notification and root-lifetime guards before any side effect.
        runtime.transaction(() => undefined);
    };
    assertBoundary();
    const invalidate = () => {
        const previous = active;
        active = undefined;
        if (previous) {
            invalidateTicket(previous, 'cancelled');
        }
    };
    const execute = async (ticket, input) => {
        try {
            if (active !== ticket)
                return ticket.outcome;
            let value;
            try {
                value = await load(input, ticket.controller.signal);
            }
            catch (error) {
                if (active !== ticket)
                    return ticket.outcome;
                throw error;
            }
            if (active !== ticket)
                return ticket.outcome;
            // NotificationError means publication happened; never catch it as a stale load error.
            ticket.committing = true;
            runtime.transaction(() => commit(value, input));
            return 'committed';
        }
        finally {
            if (active === ticket)
                active = undefined;
        }
    };
    return Object.freeze({
        run(input) {
            assertBoundary();
            const previous = active;
            const ticket = createTicket();
            active = ticket;
            if (previous) {
                invalidateTicket(previous, 'superseded');
            }
            // Abort handlers may synchronously start another request; execute rechecks ownership.
            return Promise.race([execute(ticket, input), ticket.revoked]);
        },
        cancel() {
            assertBoundary();
            invalidate();
        },
        dispose() {
            if (disposed)
                return;
            assertSideEffectsAllowed();
            if (runtime.inTransaction)
                throw new StateError('STATE_TASK_BOUNDARY', 'Dispose tasks outside transactions');
            disposed = true;
            invalidate();
        },
    });
}
