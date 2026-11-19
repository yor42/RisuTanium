/** What the page knows when the reconcile asks whether it may read and change the databases now. */
export interface ReconcileGateFacts {
    /** The page's storage is read-only: nothing may be placed, parked or consumed. */
    readOnly: boolean
    /** The first-run setup finished: before it the database is not the person's. */
    didFirstSetup: boolean
    /** The page is visible: a hidden page can neither list a large reply nor show a dialog. */
    visible: boolean
}

/** The reconcile runs only on a writable, set-up, visible page. */
export function reconcileGateOpen(facts: ReconcileGateFacts): boolean {
    return !facts.readOnly && facts.didFirstSetup && facts.visible
}
