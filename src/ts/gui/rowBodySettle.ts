/**
 * Which mounted rows of the legacy chat list are still waiting for their first rendered markup. A row's
 * ChatBody reports once through `noteRowBodyRendered`; a removed row is dropped through `forgetRows`. Nothing here
 * touches the document, so ChatBody can import it without adopting any sheet.
 */

interface RowWait {
    pending: Set<Element>
    settled: boolean
    onSettled: () => void
}

const waitOf = new WeakMap<Element, RowWait>()
let openWaits = 0

function close(wait: RowWait): void {
    wait.settled = true
    openWaits--
    for (const row of wait.pending) {
        if (waitOf.get(row) === wait) {
            waitOf.delete(row)
        }
    }
    wait.pending.clear()
}

function drop(row: Element): void {
    const wait = waitOf.get(row)
    if (!wait) {
        return
    }
    waitOf.delete(row)
    wait.pending.delete(row)
    if (wait.pending.size === 0) {
        close(wait)
        wait.onSettled()
    }
}

/**
 * Waits until every row has reported or been forgotten, then calls `onSettled` once. `cancel` ends the wait without
 * calling it. A row belongs to one wait at a time; a call without rows settles at once.
 */
export function waitForRows(rows: readonly Element[], onSettled: () => void): { cancel(): void } {
    const wait: RowWait = { pending: new Set(rows), settled: false, onSettled }
    if (wait.pending.size === 0) {
        wait.settled = true
        onSettled()
        return { cancel() {} }
    }
    openWaits++
    for (const row of wait.pending) {
        waitOf.set(row, wait)
    }
    return {
        cancel() {
            if (!wait.settled) {
                close(wait)
            }
        },
    }
}

/** Called by a ChatBody once markup is in its document. A body outside a waiting row changes nothing. */
export function noteRowBodyRendered(bodyRoot: Element): void {
    if (openWaits === 0) {
        return
    }
    const row = bodyRoot.closest('.chat-message-container')
    if (row) {
        drop(row)
    }
}

/** A removed row stops counting. */
export function forgetRows(rows: Iterable<Element>): void {
    if (openWaits === 0) {
        return
    }
    for (const row of rows) {
        drop(row)
    }
}
