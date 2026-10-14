import { describe, expect, it } from 'vitest'
import { COMMIT_KEY, FENCE_KEY } from '../../store2/format'
import { planNodeRemoval, type RemoveBatch, type RemoveOutcome } from '../../store2/sweep'

function deletions(count: number): { name: string, ifVersion: number }[] {
    return Array.from({ length: count }, (_, i) => ({ name: `assets/a${i}`, ifVersion: i + 2 }))
}

/** A server that rejects a whole request on its first conflicting key, as the real one does. */
function server(conflicts: ReadonlySet<string>, log: RemoveBatch[]) {
    return async (batch: RemoveBatch): Promise<RemoveOutcome> => {
        log.push(batch)
        const hit = batch.items.find(item => conflicts.has(item.name))
        if (hit !== undefined) {
            return { status: 'conflict', conflictKey: hit.name }
        }
        return conflicts.has(COMMIT_KEY) ? { status: 'conflict', conflictKey: COMMIT_KEY }
            : conflicts.has(FENCE_KEY) ? { status: 'conflict', conflictKey: FENCE_KEY }
                : { status: 'removed' }
    }
}

describe('Node per-asset drop-and-retry', () => {
    it('deletes the other 24 of a batch of 25 in two requests when one asset was re-saved', async () => {
        const log: RemoveBatch[] = []
        const result = await planNodeRemoval({
            deletions: deletions(25), commitRevision: 7, fenceRevision: 3,
            removeChecked: server(new Set(['assets/a10']), log),
        })
        expect(result.status).toBe('done')
        expect(result.requests).toBe(2)
        expect(result.removed).toHaveLength(24)
        expect(result.removed).not.toContain('assets/a10')
        expect(result.dropped).toEqual(['assets/a10'])
        expect(log[1].items).toHaveLength(24)
    })

    it('sends batches of up to 25, each with its recorded revision and the commit and fence revisions', async () => {
        const log: RemoveBatch[] = []
        const result = await planNodeRemoval({
            deletions: deletions(60), commitRevision: 7, fenceRevision: 3, removeChecked: server(new Set(), log),
        })
        expect(log.map(batch => batch.items.length)).toEqual([25, 25, 10])
        expect(log.every(batch => batch.commitRevision === 7 && batch.fenceRevision === 3)).toBe(true)
        expect(log[0].items[3]).toEqual({ name: 'assets/a3', ifVersion: 5 })
        expect(result.removed).toHaveLength(60)
        expect(result.requests).toBe(3)
    })

    it('costs k + 1 requests for k re-saved assets in one batch', async () => {
        const log: RemoveBatch[] = []
        const result = await planNodeRemoval({
            deletions: deletions(25), commitRevision: 1, fenceRevision: 1,
            removeChecked: server(new Set(['assets/a1', 'assets/a2', 'assets/a3']), log),
        })
        expect(result.requests).toBe(4)
        expect(result.removed).toHaveLength(22)
        expect(result.dropped).toEqual(['assets/a1', 'assets/a2', 'assets/a3'])
    })

    it('stops for a rebuild when the conflict names the commit key, without dropping an asset', async () => {
        const log: RemoveBatch[] = []
        const result = await planNodeRemoval({
            deletions: deletions(30), commitRevision: 1, fenceRevision: 1, removeChecked: server(new Set([COMMIT_KEY]), log),
        })
        expect(result.status).toBe('rebuild')
        expect(result.dropped).toEqual([])
        expect(result.removed).toEqual([])
        expect(result.requests).toBe(1)
    })

    it('stops for a rebuild on a conflict naming a key it did not send', async () => {
        const result = await planNodeRemoval({
            deletions: deletions(3), commitRevision: 1, fenceRevision: 1,
            removeChecked: async () => ({ status: 'conflict', conflictKey: 'assets/other' }),
        })
        expect(result.status).toBe('rebuild')
        expect(result.removed).toEqual([])
    })

    it('refuses when the conflict names the fence, keeping what earlier batches removed', async () => {
        let calls = 0
        const result = await planNodeRemoval({
            deletions: deletions(30), commitRevision: 1, fenceRevision: 1,
            removeChecked: async () => (++calls === 1 ? { status: 'removed' } : { status: 'conflict', conflictKey: FENCE_KEY }),
        })
        expect(result.status).toBe('refuse')
        expect(result.removed).toHaveLength(25)
    })

    it('never sends a deletion without a revision', async () => {
        const log: RemoveBatch[] = []
        const result = await planNodeRemoval({
            deletions: [{ name: 'assets/x', ifVersion: null }, { name: 'assets/y', ifVersion: 4 }],
            commitRevision: 1, fenceRevision: 1, removeChecked: server(new Set(), log),
        })
        expect(result.skipped).toEqual(['assets/x'])
        expect(log.flatMap(batch => batch.items.map(item => item.name))).toEqual(['assets/y'])
    })

    it('sends nothing when there is nothing to delete', async () => {
        const result = await planNodeRemoval({ deletions: [], commitRevision: 1, fenceRevision: 1, removeChecked: async () => ({ status: 'removed' }) })
        expect(result).toEqual({ status: 'done', removed: [], dropped: [], skipped: [], requests: 0 })
    })
})
