// A fake Web Locks table for the claim adapter's tests. Locks are exclusive and keyed by name, and they
// are NOT re-entrant: a second `ifAvailable` request for a name that is held, by the same page or by
// another, gets `null` (the specification's behaviour), which is what makes a service that caches
// results instead of one shared request per character fail. A request answers on a later microtask, so
// two requests made in one turn are answered in order. Pages of one origin share one world.

import type { ClaimLockManager } from '../studioClaimLocks'

export interface FakeTabLocks extends ClaimLockManager {
    // Every lock name requested by this tab, in order.
    readonly requests: string[]
    // Lock names this tab holds now.
    held(): string[]
    // The tab ends: its locks are released.
    closeTab(): void
}

export interface LocksWorld {
    createTab(): FakeTabLocks
    // The names held by any tab.
    heldNames(): string[]
}

export function createLocksWorld(): LocksWorld {
    const holders = new Map<string, FakeTabLocks>()
    return {
        heldNames: () => [...holders.keys()],
        createTab() {
            const requests: string[] = []
            const tab: FakeTabLocks = {
                requests,
                held: () => [...holders].filter(([, holder]) => holder === tab).map(([name]) => name),
                closeTab() {
                    for (const name of tab.held()) {
                        holders.delete(name)
                    }
                },
                async request(name, options, callback) {
                    requests.push(name)
                    await Promise.resolve()
                    if (options.mode !== 'exclusive' || options.ifAvailable !== true) {
                        throw new Error('the fake models only exclusive ifAvailable requests')
                    }
                    if (holders.has(name)) {
                        return callback(null)
                    }
                    holders.set(name, tab)
                    try {
                        return await callback({ name, mode: 'exclusive' })
                    } finally {
                        if (holders.get(name) === tab) {
                            holders.delete(name)
                        }
                    }
                },
            }
            return tab
        },
    }
}
