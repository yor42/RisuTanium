// @vitest-environment node
/**
 * The restore-point list and the restore core over the memory backend: the commit key is a plain value, so the list
 * and the outcome mapping do not depend on a backend kind (the restore operation itself is covered per backend in
 * `commit.test.ts`). Each test says whether it is new behaviour or a guard that also passes on the library alone.
 */
import { describe, expect, test } from 'vitest'
import {
    createMemoryBackend, sameBytes, Store2BackendFailureError, Store2StalePageError, Store2UnknownOutcomeError,
} from 'src/ts/storage/store2/backend'
import { ADMISSION_INTERVAL_MS, type Committer } from 'src/ts/storage/store2/commit'
import { RETAINED_MAX } from 'src/ts/storage/store2/commitKey'
import type { CommitKey, SnapshotPointer } from 'src/ts/storage/store2/format'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { listRestorePoints, restorePoint, type RestorePointList, type RestorePointRow } from 'src/ts/storage/store2/restorePoints'
import {
    committerOf, createClock, hooked, parsedCommit, peerWrite, seedStore, START_TIME, testEnv, treeRequest, type BuildRecord, type Hooks,
} from './commitFixtures'

const MINUTE = 60_000
const FOREIGN_MARKER = { owner: 'q'.repeat(26), prefix: 'store2/g-0000000000000000-', startedAt: 5, label: 'bulk' } as const
const POINTER: SnapshotPointer = {
    key: 'store2/g-abcdefghijklmnop-u0123456789abcdef',
    digest: '0123456789abcdef0123456789abcdef',
    count: 3,
}

async function setup(hooks: Hooks = {}) {
    const raw = createMemoryBackend()
    const clock = createClock()
    const m0 = await seedStore(raw, testEnv(clock, 1))
    const wrapped = hooked(raw, hooks)
    const a = committerOf(wrapped.backend, clock, 100)
    const env = testEnv(clock, 300)

    async function commitNext(tag: string, extra = 0, record?: BuildRecord[]): Promise<string> {
        const result = await a.commit(await a.readCommit(), treeRequest(extra, { tag, record }))
        if (result.status !== 'committed') {
            throw new Error(`Expected committed, got ${result.status}.`)
        }
        return result.manifestKey
    }

    /** Commits three more manifests past the admission window: retained ends as [m2, m1, m0], current m3. */
    async function threeAdmitted() {
        const m1 = await commitNext('one')
        clock.advance(ADMISSION_INTERVAL_MS + 1)
        const m2 = await commitNext('two')
        clock.advance(ADMISSION_INTERVAL_MS + 1)
        const m3 = await commitNext('three')
        return { m1, m2, m3 }
    }

    async function list(): Promise<Extract<RestorePointList, { status: 'ok' }>> {
        const result = await listRestorePoints(wrapped.backend, await raw.readCommit())
        if (result.status !== 'ok') {
            throw new Error(`Expected a list, got ${result.status}.`)
        }
        return result
    }

    const bytesOfCommit = async () => (await raw.readCommit()).bytes
    return { raw, wrapped, clock, m0, a, env, commitNext, threeAdmitted, list, bytesOfCommit }
}

const keysOf = (rows: readonly RestorePointRow[]) => rows.map(row => row.key)

describe('listRestorePoints', () => {
    // New behaviour: the order is the stored admission order, newest admitted first.
    test('lists the retained manifests in admission order, newest admitted first', async () => {
        const { list, threeAdmitted, m0 } = await setup()
        const { m1, m2, m3 } = await threeAdmitted()
        const result = await list()
        expect(keysOf(result.rows)).toEqual([m2, m1, m0])
        expect(result.current.key).toBe(m3)
    })

    // New behaviour: the label is the manifest's own time, and it is not re-sorted.
    test('labels a row with the manifest createdAt and keeps admission order when a re-admitted point carries an older date', async () => {
        const { clock, a, list, threeAdmitted, m0 } = await setup()
        const { m1, m2, m3 } = await threeAdmitted()
        const before = await list()
        expect(before.rows.map(row => row.labelSource)).toEqual(['manifest', 'manifest', 'manifest'])
        expect(before.rows.map(row => row.label)).toEqual([START_TIME + ADMISSION_INTERVAL_MS + 1, START_TIME, START_TIME])
        // Restore m0, the oldest content, then commit past the window so it is admitted again: its createdAt stays the oldest.
        expect((await a.restore(await a.readCommit(), m0)).status).toBe('committed')
        clock.advance(ADMISSION_INTERVAL_MS + 1)
        expect((await a.commit(await a.readCommit(), treeRequest(0, { tag: 'four' }))).status).toBe('committed')
        const after = await list()
        expect(keysOf(after.rows)).toEqual([m0, m3, m2, m1])
        expect(after.rows[0].label).toBeLessThan(after.rows[1].label as number)
    })

    // New behaviour: the entry time is the fallback and a damaged manifest still gets a row.
    test('a damaged manifest is a damaged row labelled by its entry time, and the other rows are listed', async () => {
        const { raw, list, threeAdmitted, m0 } = await setup()
        const { m1, m2 } = await threeAdmitted()
        await raw.removeBatch([m1], (await raw.readCommit()).token, (await raw.readFence()).token)
        const result = await list()
        expect(keysOf(result.rows)).toEqual([m2, m1, m0])
        expect(result.rows.map(row => row.damaged)).toEqual([false, true, false])
        const entry = (await parsedCommit(raw)).retained.find(candidate => candidate.key === m1) as { at: number }
        expect(result.rows[1].labelSource).toBe('entry')
        expect(result.rows[1].label).toBe(entry.at)
    })

    // New behaviour.
    test('a pinned manifest that is also retained is one row marked pinned, and a pinned-only manifest follows the retained rows', async () => {
        const { raw, a, env, list, threeAdmitted, m0 } = await setup()
        const { m1, m2 } = await threeAdmitted()
        expect((await a.pin(await a.readCommit(), m1, 'keep one')).status).toBe('committed')
        let result = await list()
        expect(keysOf(result.rows)).toEqual([m2, m1, m0])
        expect(result.rows.map(row => row.pinReason)).toEqual([null, 'keep one', null])
        // Drop m0 from `retained` and pin it: only the pin names it.
        await peerWrite(raw, env, { retained: (await parsedCommit(raw)).retained.filter(entry => entry.key !== m0), pins: [...(await parsedCommit(raw)).pins, { key: m0, reason: 'keep zero' }] })
        result = await list()
        expect(keysOf(result.rows)).toEqual([m2, m1, m0])
        expect(result.rows[2].pinReason).toBe('keep zero')
        expect(result.rows[2].damaged).toBe(false)
        expect(result.rows[2].labelSource).toBe('manifest')
    })

    // New behaviour: `current` is returned apart and is never a row, even when pinned.
    test('current is never a row, even when it is pinned', async () => {
        const { a, list, threeAdmitted } = await setup()
        const { m3 } = await threeAdmitted()
        expect((await a.pin(await a.readCommit(), m3, 'now')).status).toBe('committed')
        const result = await list()
        expect(keysOf(result.rows)).not.toContain(m3)
        expect(result.current.key).toBe(m3)
        expect(result.rows).toHaveLength(3)
    })

    // Guard: an empty list is not an error; it also passes on any list that skips the manifest read.
    test('a store with nothing retained lists no rows', async () => {
        const { list, m0 } = await setup()
        const result = await list()
        expect(result.rows).toEqual([])
        expect(result.current.key).toBe(m0)
    })

    // New behaviour: a failed batch read is a typed failure, never a throw and never a partial list.
    test('a failed manifest batch read is a failed result', async () => {
        const failing = { on: false }
        const { raw, wrapped, threeAdmitted } = await setup({
            before: (name) => {
                if (failing.on && name === 'readUnits') {
                    throw new Store2BackendFailureError('the read failed')
                }
            },
        })
        await threeAdmitted()
        failing.on = true
        const result = await listRestorePoints(wrapped.backend, await raw.readCommit())
        expect(result.status).toBe('failed')
    })

    // New behaviour: a commit key that cannot be a base is a typed result.
    test('an absent commit key is an unusable result', async () => {
        const result = await listRestorePoints(createMemoryBackend(), await createMemoryBackend().readCommit())
        expect(result.status === 'unusable' && result.reason).toBe('absent')
    })
})

describe('restorePoint outcomes', () => {
    // New behaviour: the outcome carries the key the restore wrote.
    test('restores a retained point and pushes the previous current', async () => {
        const { raw, a, wrapped, threeAdmitted, m0 } = await setup()
        const { m3 } = await threeAdmitted()
        const outcome = await restorePoint(a, wrapped.backend, m0)
        expect(outcome.status).toBe('restored')
        const key = await parsedCommit(raw)
        expect(key.current?.key).toBe(m0)
        expect(key.retained[0].key).toBe(m3)
        expect(outcome.status === 'restored' && outcome.value).toEqual(key)
    })

    // Guard of the restore operation's forced push: it also passes on any build whose restore pushes the previous current.
    test('guard: the previous current is listed after a restore inside the admission window', async () => {
        const { raw, a, wrapped, clock, env, commitNext, list, m0 } = await setup()
        const m1 = await commitNext('one')
        clock.advance(MINUTE)
        const m2 = await commitNext('two')
        // Other retained entries keep the window closed: without a forced push, m2 would not be admitted.
        await peerWrite(raw, env, { retained: [{ key: m0, at: clock.now }, { key: m1, at: clock.now - MINUTE }] })
        expect((await restorePoint(a, wrapped.backend, m1)).status).toBe('restored')
        expect(keysOf((await list()).rows)).toEqual([m2, m0])
    })

    // New behaviour: the outcome mapping of the library refusal.
    test('the current manifest is already current and nothing is written', async () => {
        const { a, wrapped, threeAdmitted, bytesOfCommit } = await setup()
        const { m3 } = await threeAdmitted()
        const before = await bytesOfCommit()
        expect((await restorePoint(a, wrapped.backend, m3)).status).toBe('already-current')
        expect(sameBytes(before as Uint8Array, (await bytesOfCommit()) as Uint8Array)).toBe(true)
    })

    // New behaviour: the outcome mapping of the library refusal.
    test('a dropped manifest with a complete tree is not named and nothing is written', async () => {
        const { a, wrapped, commitNext, clock, bytesOfCommit, m0 } = await setup()
        const m1 = await commitNext('one')
        clock.advance(MINUTE)
        await commitNext('two')
        const before = await bytesOfCommit()
        expect(m1).not.toBe(m0)
        expect((await restorePoint(a, wrapped.backend, m1)).status).toBe('not-named')
        expect(wrapped.log).not.toContain('casCommit')
        expect(sameBytes(before as Uint8Array, (await bytesOfCommit()) as Uint8Array)).toBe(true)
    })

    // New behaviour: the outcome mapping of the library refusal, with its missing keys.
    test('a point with a missing unit is tree-incomplete, carries the missing key and writes nothing', async () => {
        const { raw, a, wrapped, commitNext, clock, bytesOfCommit } = await setup()
        const record: BuildRecord[] = []
        const m1 = await commitNext('one', 1, record)
        clock.advance(ADMISSION_INTERVAL_MS + 1)
        await commitNext('two')
        const missing = `store2/${record[0].preset as string}`
        await raw.removeBatch([missing], (await raw.readCommit()).token, (await raw.readFence()).token)
        const before = await bytesOfCommit()
        const outcome = await restorePoint(a, wrapped.backend, m1)
        expect(outcome.status).toBe('tree-incomplete')
        expect(outcome.status === 'tree-incomplete' && outcome.missing).toContain(missing)
        expect(sameBytes(before as Uint8Array, (await bytesOfCommit()) as Uint8Array)).toBe(true)
    })

    // New behaviour: the library's restore would carry the marker, so this module refuses first.
    test('a standing bulk marker refuses the restore and writes nothing', async () => {
        const { raw, a, wrapped, env, threeAdmitted, bytesOfCommit, m0 } = await setup()
        await threeAdmitted()
        await peerWrite(raw, env, { staging: FOREIGN_MARKER })
        const before = await bytesOfCommit()
        const outcome = await restorePoint(a, wrapped.backend, m0)
        expect(outcome.status).toBe('bulk-marker')
        expect(wrapped.log).not.toContain('casCommit')
        expect(sameBytes(before as Uint8Array, (await bytesOfCommit()) as Uint8Array)).toBe(true)
    })

    // New behaviour: the judgement uses the commit key as it is now.
    test('the decision is made on a fresh read, not on the list shown', async () => {
        const { raw, a, wrapped, env, list, threeAdmitted, m0 } = await setup()
        await threeAdmitted()
        const shown = await list()
        expect(keysOf(shown.rows)).toContain(m0)
        // A peer drops m0 after the list was shown.
        await peerWrite(raw, env, { retained: (await parsedCommit(raw)).retained.filter(entry => entry.key !== m0) })
        expect((await restorePoint(a, wrapped.backend, m0)).status).toBe('not-named')
        expect(wrapped.log).not.toContain('casCommit')
    })

    // New behaviour: one re-judged retry.
    test('a conflict is re-read once and retried once while the point is still named', async () => {
        let landed = 0
        const ctx = await setup({
            before: async (name, count) => {
                if (name === 'casCommit' && count === 1) {
                    landed += 1
                    await peerWrite(ctx.raw, ctx.env, { pins: [{ key: ctx.m0, reason: 'peer pin' }] })
                }
            },
        })
        await ctx.threeAdmitted()
        landed = 0
        const outcome = await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)
        expect(outcome.status).toBe('restored')
        expect(ctx.wrapped.count('casCommit')).toBeGreaterThanOrEqual(2)
        expect((await parsedCommit(ctx.raw)).current?.key).toBe(ctx.m0)
        expect((await parsedCommit(ctx.raw)).pins).toEqual([{ key: ctx.m0, reason: 'peer pin' }])
    })

    // New behaviour: no third attempt.
    test('a second conflict is reported and the restore is not attempted a third time', async () => {
        const state = { armed: false, restoreCas: 0 }
        const ctx = await setup({
            before: async (name) => {
                if (state.armed && name === 'casCommit') {
                    state.restoreCas += 1
                    await peerWrite(ctx.raw, ctx.env, { pins: [{ key: `store2/m-peer${state.restoreCas}`, reason: 'peer' }] })
                }
            },
        })
        await ctx.threeAdmitted()
        state.armed = true
        const outcome = await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)
        expect(outcome.status).toBe('conflict')
        expect(state.restoreCas).toBe(2)
        expect((await parsedCommit(ctx.raw)).current?.key).not.toBe(ctx.m0)
    })

    // New behaviour: the retry is judged like the first attempt.
    test('after a conflict the retry judges the fresh read again: a marker that landed refuses it', async () => {
        const state = { armed: false, casCalls: 0 }
        const ctx = await setup({
            before: async (name) => {
                if (state.armed && name === 'casCommit') {
                    state.casCalls += 1
                    if (state.casCalls === 1) {
                        await peerWrite(ctx.raw, ctx.env, { staging: FOREIGN_MARKER })
                    }
                }
            },
        })
        await ctx.threeAdmitted()
        state.armed = true
        const outcome = await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)
        expect(outcome.status).toBe('bulk-marker')
        expect(state.casCalls).toBe(1)
        expect((await parsedCommit(ctx.raw)).current?.key).not.toBe(ctx.m0)
    })

    // New behaviour: the retry refuses a point that was dropped meanwhile.
    test('after a conflict the retry is refused when the point is no longer named', async () => {
        const state = { armed: false }
        const ctx = await setup({
            before: async (name) => {
                if (state.armed && name === 'casCommit') {
                    state.armed = false
                    await peerWrite(ctx.raw, ctx.env, { retained: (await parsedCommit(ctx.raw)).retained.filter(entry => entry.key !== ctx.m0) })
                }
            },
        })
        await ctx.threeAdmitted()
        state.armed = true
        expect((await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)).status).toBe('not-named')
    })

    // New behaviour: the outcome mapping of the library's unknown result.
    test('a lost response that cannot be read back is unknown', async () => {
        const state = { readBackAt: -1 }
        const ctx = await setup({
            before: (name, count) => {
                if (state.readBackAt < 0) {
                    return
                }
                if (name === 'casCommit') {
                    throw new Store2UnknownOutcomeError('the response was lost')
                }
                if (name === 'readCommit' && count === state.readBackAt) {
                    throw new Store2BackendFailureError('the read-back failed')
                }
            },
        })
        await ctx.threeAdmitted()
        // The restore reads the commit key once, then the write is lost, then the settle reads it back.
        state.readBackAt = ctx.wrapped.count('readCommit') + 2
        const outcome = await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)
        expect(outcome.status).toBe('unknown')
    })

    // New behaviour: failure and replaced-page mapping.
    test('a definite backend failure of the write is failed, and a replaced page is stale-page', async () => {
        const mode = { error: null as Error | null }
        const ctx = await setup({
            before: (name) => {
                if (mode.error !== null && name === 'casCommit') {
                    throw mode.error
                }
            },
        })
        await ctx.threeAdmitted()
        mode.error = new Store2BackendFailureError('refused')
        expect((await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)).status).toBe('failed')
        mode.error = new Store2StalePageError('a newer page owns the store')
        expect((await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)).status).toBe('stale-page')
    })

    // New behaviour: failure mapping of the fresh read, and refusal of an unusable key.
    test('an unreadable commit key is a failed outcome and a damaged one is refused', async () => {
        const ctx = await setup({
            before: (name) => {
                if (name === 'readCommit') {
                    throw new Store2StalePageError('a newer page owns the store')
                }
            },
        })
        expect((await restorePoint(ctx.a, ctx.wrapped.backend, ctx.m0)).status).toBe('stale-page')
        const empty = createMemoryBackend()
        const committer: Committer = committerOf(empty, createClock(), 5)
        const outcome = await restorePoint(committer, empty, `store2/m-${'0'.repeat(26)}`)
        expect(outcome.status === 'refused' && outcome.reason).toBe('absent')
    })

    // Guard: the library's restore carries these onto the restored key; the module must not disturb them.
    test('guard: the restored key carries the pins, the conversion record and the snapshot pointer', async () => {
        const { raw, a, wrapped, env, threeAdmitted, m0 } = await setup()
        const { m1 } = await threeAdmitted()
        await peerWrite(raw, env, { pins: [{ key: m1, reason: 'keep' }], convertedFrom: 'old', convertedAt: 77, snapshot: POINTER })
        const planted: CommitKey = await parsedCommit(raw)
        expect((await restorePoint(a, wrapped.backend, m0)).status).toBe('restored')
        const key = await parsedCommit(raw)
        expect(key.pins).toEqual(planted.pins)
        expect(key.convertedFrom).toBe('old')
        expect(key.convertedAt).toBe(77)
        expect(key.snapshot).toEqual(POINTER)
        expect(key.staging).toBeNull()
    })
})

describe('restore points after garbage collection', () => {
    // Integration: the keep-set of the mark is exactly what the list offers.
    test('the oldest retained point and a pinned point both restore after a collection pass', async () => {
        const { raw, a, wrapped, clock, commitNext, env } = await setup()
        const pinned = await commitNext('pinned')
        expect((await a.pin(await a.readCommit(), pinned, 'keep')).status).toBe('committed')
        for (let i = 0; i < RETAINED_MAX + 4; i++) {
            clock.advance(ADMISSION_INTERVAL_MS + 1)
            await commitNext(`n${i}`)
        }
        // Only the pin names the pinned manifest from here on.
        await peerWrite(raw, env, { retained: (await parsedCommit(raw)).retained.filter(entry => entry.key !== pinned) })
        const before = await listRestorePoints(wrapped.backend, await raw.readCommit())
        const rows = before.status === 'ok' ? before.rows : []
        expect(before.status).toBe('ok')
        expect(rows).toHaveLength(RETAINED_MAX)
        expect(rows.at(-1)?.key).toBe(pinned)
        const oldestRetained = (await parsedCommit(raw)).retained.at(-1)?.key as string

        const swept = await gcPass({ backend: raw, kind: 'indexeddb', idleReason: () => null })
        expect(swept.status).toBe('done')

        const first = await restorePoint(a, wrapped.backend, oldestRetained)
        expect(first.status).toBe('restored')
        const second = await restorePoint(a, wrapped.backend, pinned)
        expect(second.status).toBe('restored')
        expect((await parsedCommit(raw)).current?.key).toBe(pinned)
    })
})
