// The Web Locks adapter of the single-writer claim: one exclusive lock per character, named by its
// chaId, taken with `ifAvailable` and held until the page ends. The adapter never rejects, never steals
// a lock and keeps no cache: the service shares one request per chaId. A page without Web Locks gets
// `unsupported`; the service decides what that means (a plain-HTTP page is memory-only, Tauri is the
// one live page).

import type { ClaimResult, StudioClaimPort } from './studioHistoryStore'

export const CLAIM_LOCK_PREFIX = 'risuStudio.history:'

// The part of `LockManager.request` this adapter uses.
export interface ClaimLockManager {
    request(
        name: string,
        options: { mode: 'exclusive'; ifAvailable: true },
        callback: (lock: unknown) => Promise<unknown>,
    ): Promise<unknown>
}

function pageLocks(): ClaimLockManager | undefined {
    return (navigator as Navigator & { locks?: ClaimLockManager }).locks
}

// `getLocks` is read at every request, so a lock manager installed later governs the next claim.
export function createStudioClaimLocks(getLocks: () => ClaimLockManager | undefined = pageLocks): StudioClaimPort {
    return {
        tryClaim(chaId): Promise<ClaimResult> {
            return new Promise<ClaimResult>((resolve) => {
                try {
                    const locks = getLocks()
                    if (!locks) {
                        resolve('unsupported')
                        return
                    }
                    const request = locks.request(CLAIM_LOCK_PREFIX + chaId, { mode: 'exclusive', ifAvailable: true }, (lock) => {
                        if (lock === null) {
                            resolve('held')
                            return Promise.resolve()
                        }
                        resolve('granted')
                        // Settles only when the page ends, so the lock is held until then.
                        return new Promise<void>(() => undefined)
                    })
                    // A rejection before the callback ran (for instance a SecurityError on a storage-blocked
                    // origin) is a failed claim; after the callback it changes nothing.
                    Promise.resolve(request).catch(() => resolve('failed'))
                } catch {
                    resolve('failed')
                }
            })
        },
    }
}
