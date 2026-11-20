// @vitest-environment node
/**
 * The held bulk marker of a restore (`openHeldBulk`, `commitHeld`, `clearHeld`) over the real Node server process: the
 * marker with its label on the commit key before anything is built, a marker that may have landed cleared by the open
 * call itself, the commit under the held marker (always the staged path, one final write that installs `current` and
 * clears the marker), and the refusals that write nothing. A pass says nothing about a browser or the Tauri store.
 *
 * Labels: every test is a guard of a new contract (no pre-fix base: the committer had no held marker); each names the
 * scratch mutant it turns red on.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2BackendFailureError, Store2UnknownOutcomeError } from 'src/ts/storage/store2/backend'
import type { CommitRequest, CommitResult, HeldOpen } from 'src/ts/storage/store2/commit'
import { stagingPrefix, type CommitKey } from 'src/ts/storage/store2/format'
import {
    COMMIT_BACKENDS, committerOf, createClock, expectInvariant, hooked, parsedCommit, peerWrite, seedStore, testEnv, treeRequest,
    type BuildRecord, type Hooks, type OpenedBackend,
} from './commitFixtures'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const NODE = COMMIT_BACKENDS.filter(fixture => fixture.name === 'node')[0]
const opened: OpenedBackend[] = []
const OTHER_PREFIX = stagingPrefix('1'.repeat(16))

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

async function setup(hooks: Hooks = {}) {
    const entry = await NODE.open()
    opened.push(entry)
    const clock = createClock()
    const m0 = await seedStore(entry.backend, testEnv(clock, 1))
    const wrapped = hooked(entry.backend, hooks)
    return {
        raw: entry.backend,
        wrapped,
        m0,
        env: testEnv(clock, 300),
        /** The restoring page's committer, over the recording backend. */
        a: committerOf(wrapped.backend, clock, 100),
        /** Another page's committer over the same server. */
        b: committerOf(entry.backend, clock, 200),
    }
}

/** What the install asks of a held commit: a replacement of the base, forced, labelled as an import. */
function restoreRequest(extra: number, record?: BuildRecord[]): CommitRequest {
    return { ...treeRequest(extra, { label: 'import', record }), force: true }
}

function openedOf(result: HeldOpen | undefined): Extract<HeldOpen, { status: 'opened' }> {
    if (result === undefined || result.status !== 'opened') {
        throw new Error(`Expected opened, got ${result?.status}.`)
    }
    return result
}

function committedOf(result: CommitResult): Extract<CommitResult, { status: 'committed' }> {
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') {
        throw new Error(`Expected committed, got ${result.status}.`)
    }
    return result
}

const stagedKeys = async (backend: { listStore2(): Promise<string[]> }) => (await backend.listStore2()).filter(key => key.startsWith('store2/g-'))

describe('commitHeld lands under the marker openHeldBulk wrote', () => {
    test.each([[0], [49]])('T-R3: a restore of %i extra units lands on the staged path: the marker carries the restore label, the final write installs the manifest and clears it (guard; MR3 fails it)', async (extra) => {
        const { raw, wrapped, a, m0 } = await setup()
        const open = openedOf(await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' }))
        const marked = await parsedCommit(raw)
        expect(marked.staging).toEqual({ owner: a.owner, prefix: expect.stringMatching(/^store2\/g-[0-9a-v]{16}-$/), startedAt: expect.any(Number), label: 'restore' })
        expect(marked.current?.key).toBe(m0)
        const record: BuildRecord[] = []
        const result = committedOf(await (a.commitHeld as NonNullable<typeof a.commitHeld>)(open.held, open.read, restoreRequest(extra, record)))
        expect(result.mode).toBe('bulk')
        expect(wrapped.log).not.toContain('commitOrdinary')
        const prefix = marked.staging?.prefix as string
        expect(record[0].keys.every(key => key.startsWith(prefix))).toBe(true)
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.current?.key).toBe(result.manifestKey)
        expect(after.seq).toBe(marked.seq + 1)
        expect(after.retained.map(entry => entry.key)).toEqual([m0])
        await expectInvariant(raw)
    })
})

describe('openHeldBulk when the marker write does not stand', () => {
    test('T-R4: a commit between the caller\'s read and the open: the marker CAS conflicts and never lands, the clear finds nothing and no unit is written (guard)', async () => {
        const { raw, a, b } = await setup()
        const stale = await a.readCommit()
        committedOf(await b.commit(await b.readCommit(), treeRequest(0)))
        const result = await a.openHeldBulk?.(stale, { label: 'restore' })
        expect(result).toMatchObject({ status: 'conflict', cleared: { status: 'nothing' } })
        expect((await parsedCommit(raw)).staging).toBeNull()
        const units = await stagedKeys(raw)
        expect(units).toEqual([])
    })

    test('T-R4b: a peer commit lands inside the read-back after the marker CAS: the call clears its own marker and the peer\'s manifest stays current (guard; MR8 fails it)', async () => {
        let armed = false
        let injected = false
        let peerManifest = ''
        const hooks: Hooks = {}
        const { raw, a, b } = await setup(hooks)
        hooks.after = (name) => {
            if (name === 'casCommit') {
                armed = true
            }
        }
        hooks.before = async (name) => {
            if (name === 'readCommit' && armed && !injected) {
                injected = true
                peerManifest = committedOf(await b.commit(await b.readCommit(), treeRequest(0))).manifestKey
            }
        }
        const result = await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' })
        expect(injected).toBe(true)
        expect(result).toMatchObject({ status: 'conflict', cleared: { status: 'cleared' } })
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.current?.key).toBe(peerManifest)
    })

    test('T-R4c: the read-back after the marker CAS fails once although the marker landed: the call answers unknown and has cleared its own marker (guard; MR9 fails it)', async () => {
        let armed = false
        let failed = false
        const hooks: Hooks = {}
        const { raw, a } = await setup(hooks)
        hooks.after = (name) => {
            if (name === 'casCommit') {
                armed = true
            }
        }
        hooks.before = (name) => {
            if (name === 'readCommit' && armed && !failed) {
                failed = true
                throw new Store2BackendFailureError('The read-back failed.')
            }
        }
        const result = await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' })
        expect(failed).toBe(true)
        expect(result).toMatchObject({ status: 'unknown', cleared: { status: 'cleared' } })
        expect((await parsedCommit(raw)).staging).toBeNull()
    })

    test('a marker already standing is refused untouched: the refusal is marker-present and no marker write is sent (guard)', async () => {
        const { raw, wrapped, a, env } = await setup()
        await peerWrite(raw, env, { staging: { owner: 'p'.repeat(26), prefix: OTHER_PREFIX, startedAt: 5, label: 'bulk' } })
        wrapped.log.length = 0
        const result = await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' })
        expect(result).toMatchObject({ status: 'refused', reason: 'marker-present' })
        expect(wrapped.log).not.toContain('casCommit')
    })
})

describe('commitHeld refusals write nothing', () => {
    test('T-R7: a read without this committer\'s own marker, or with another owner\'s, is abandoned marker-lost with nothing written (guard; MR7 fails it)', async () => {
        const { raw, wrapped, a, env } = await setup()
        const open = openedOf(await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' }))
        const clear = a.clearHeld as NonNullable<typeof a.clearHeld>
        expect((await clear(open.held))?.status).toBe('cleared')
        const commit = a.commitHeld as NonNullable<typeof a.commitHeld>
        const writes = () => wrapped.count('putUnit') + wrapped.count('casCommit') + wrapped.count('commitOrdinary')

        const bare = await a.readCommit()
        const before = writes()
        expect(await commit(open.held, bare, restoreRequest(0))).toEqual({ status: 'abandoned', reason: 'marker-lost', cleared: null })
        expect(writes()).toBe(before)

        await peerWrite(raw, env, { staging: { owner: 'p'.repeat(26), prefix: OTHER_PREFIX, startedAt: 5, label: 'bulk' } })
        const foreign = await a.readCommit()
        const beforeForeign = writes()
        expect(await commit(open.held, foreign, restoreRequest(0))).toEqual({ status: 'abandoned', reason: 'marker-lost', cleared: null })
        expect(writes()).toBe(beforeForeign)
    })

    test('T-R7: a Carry throws a TypeError before anything is built or written, and the marker stands until the caller clears it (guard)', async () => {
        const { raw, wrapped, a, m0 } = await setup()
        const open = openedOf(await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' }))
        const before = wrapped.count('putUnit')
        const built = vi.fn(restoreRequest(0).build)
        await expect((a.commitHeld as NonNullable<typeof a.commitHeld>)(open.held, open.read, { ...restoreRequest(0), build: built, carry: { from: m0, units: 0 } })).rejects.toThrow(TypeError)
        expect(built).not.toHaveBeenCalled()
        expect(wrapped.count('putUnit')).toBe(before)
        expect((await parsedCommit(raw)).staging).not.toBeNull()
    })
})

describe('a held commit whose final write is not confirmed (E8)', () => {
    /** The commit key as the test reads it, plus the clear the install runs on an unconfirmed end. */
    async function unconfirmed(variant: 'lost-before' | 'lost-after') {
        let finalSeen = false
        let readFailed = false
        const hooks: Hooks = {}
        const { raw, a, m0 } = await setup(hooks)
        hooks.before = (name, count) => {
            if (name === 'casCommit' && count === 2 && variant === 'lost-before') {
                finalSeen = true
                throw new Store2UnknownOutcomeError('The final write timed out.')
            }
            // Only `finishBulk`'s re-read fails; the clear that follows reads again and succeeds.
            if (name === 'readCommit' && finalSeen && !readFailed) {
                readFailed = true
                throw new Store2BackendFailureError('The re-read failed.')
            }
        }
        hooks.after = (name, count) => {
            if (name === 'casCommit' && count === 2 && variant === 'lost-after') {
                finalSeen = true
                throw new Store2UnknownOutcomeError('The final write answered too late.')
            }
        }
        const open = openedOf(await a.openHeldBulk?.(await a.readCommit(), { label: 'restore' }))
        const result = await (a.commitHeld as NonNullable<typeof a.commitHeld>)(open.held, open.read, restoreRequest(0))
        expect(readFailed).toBe(true)
        return { raw, a, m0, open, result }
    }

    test('T-R10: the final write timed out without applying and its re-read fails: unknown, the marker still stands, and the clear removes it (guard)', async () => {
        const { raw, a, m0, open, result } = await unconfirmed('lost-before')
        expect(result.status).toBe('unknown')
        expect((await parsedCommit(raw)).staging).not.toBeNull()
        expect((await (a.clearHeld as NonNullable<typeof a.clearHeld>)(open.held))?.status).toBe('cleared')
        const after = await parsedCommit(raw)
        expect(after.staging).toBeNull()
        expect(after.current?.key).toBe(m0)
    })

    test('T-R10: the final write applied and its answer was lost and its re-read fails: unknown, the restore\'s manifest is current and the clear finds nothing (guard)', async () => {
        const { raw, a, m0, open, result } = await unconfirmed('lost-after')
        expect(result.status).toBe('unknown')
        const landed: CommitKey = await parsedCommit(raw)
        expect(landed.staging).toBeNull()
        expect(landed.current?.key).not.toBe(m0)
        expect((await (a.clearHeld as NonNullable<typeof a.clearHeld>)(open.held))?.status).toBe('nothing')
    })
})
