import { COMMIT_KEY, FENCE_KEY } from '../format'
import type { Deletion } from './ageRecord'
import { NODE_REMOVE_BATCH } from './params'

/**
 * The Node guarded-remove planner. The server rejects a whole request on its
 * first failed precondition, so one re-saved asset would otherwise stall every
 * batch it sits in. The planner sends batches of up to 25 assets, each carrying
 * its recorded revision, together with check-only entries for the commit key and
 * the fence; a conflict naming an asset drops that asset and retries the rest, a
 * conflict naming the commit key or the fence stops the pass. Nothing is sent
 * without a revision.
 */

export interface RemoveBatch {
    /** Assets to remove, each only at the revision it was recorded with. */
    items: { name: string, ifVersion: number }[]
    /** Check-only: the commit key's revision at pass start. */
    commitRevision: number
    /** Check-only: the fence's revision at pass start (an absent fence that once existed has one). */
    fenceRevision: number
}

/** The client's answer to one guarded remove: done, or the key whose precondition failed. */
export type RemoveOutcome =
    | { status: 'removed' }
    | { status: 'conflict', conflictKey: string }

export interface NodeRemoveInput {
    deletions: readonly Deletion[]
    commitRevision: number
    fenceRevision: number
    removeChecked(batch: RemoveBatch): Promise<RemoveOutcome>
    batchSize?: number
}

export interface NodeRemoveResult {
    /**
     * `done`: every sendable asset was removed or dropped. `rebuild`: the commit
     * key moved (or a conflict named an unknown key), the keep-set is stale.
     * `refuse`: the fence changed.
     */
    status: 'done' | 'rebuild' | 'refuse'
    removed: string[]
    /** Assets a conflict named: re-saved since they were recorded, so kept. */
    dropped: string[]
    /** Deletions without a revision: never sent. */
    skipped: string[]
    requests: number
}

export async function planNodeRemoval(input: NodeRemoveInput): Promise<NodeRemoveResult> {
    const size = input.batchSize ?? NODE_REMOVE_BATCH
    const result: NodeRemoveResult = { status: 'done', removed: [], dropped: [], skipped: [], requests: 0 }
    const queue: { name: string, ifVersion: number }[] = []
    const seen = new Set<string>()
    for (const deletion of input.deletions) {
        if (seen.has(deletion.name)) {
            continue
        }
        seen.add(deletion.name)
        if (deletion.ifVersion === null) {
            result.skipped.push(deletion.name)
        } else {
            queue.push({ name: deletion.name, ifVersion: deletion.ifVersion })
        }
    }

    while (queue.length > 0) {
        const items = queue.slice(0, size)
        const outcome = await input.removeChecked({
            items,
            commitRevision: input.commitRevision,
            fenceRevision: input.fenceRevision,
        })
        result.requests += 1
        if (outcome.status === 'removed') {
            queue.splice(0, items.length)
            result.removed.push(...items.map(item => item.name))
            continue
        }
        if (outcome.conflictKey === FENCE_KEY) {
            result.status = 'refuse'
            return result
        }
        const index = outcome.conflictKey === COMMIT_KEY ? -1 : items.findIndex(item => item.name === outcome.conflictKey)
        if (index < 0) {
            // The commit key, or a key the planner did not send: either way the keep-set cannot be trusted.
            result.status = 'rebuild'
            return result
        }
        queue.splice(index, 1)
        result.dropped.push(outcome.conflictKey)
    }
    return result
}
