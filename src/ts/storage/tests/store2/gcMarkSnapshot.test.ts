// @vitest-environment node
/**
 * The GC mark keeps the commit key's snapshot unit live by its own rule, never through `refsOf` (a unit key among the
 * manifests would make every mark refuse), and `gcPass` honours it: a pointed unit survives while its staging prefix
 * stands and after the final write clears the marker, and the same unit is garbage once no pointer names it. Each
 * test says what it is: new behaviour, guard (passes before and after any change that keeps the rule), or mutant (red
 * under the named in-memory mutant of the library, kept in the test name).
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, newStagedKey, newStagingId, newUnitKey, refsOf, REFS_TABLE, stagingPrefix, UNIT_TYPE,
    type CommitKey, type KeyEnv, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { committerOf, createClock, parsedCommit, peerWrite, plantKey, seedStore, testEnv } from './commitFixtures'

const ME = 'a'.repeat(26)

interface Fx {
    backend: Store2Backend
    env: KeyEnv
    clock: ReturnType<typeof createClock>
    /** A snapshot unit under a staging prefix of its own, and the pointer that names it. */
    prefix: string
    unitKey: string
    pointer: SnapshotPointer
}

/** A seeded store plus a stored unit under a staging prefix: the snapshot body, which no manifest names. */
async function newFx(seed: number): Promise<Fx> {
    const backend = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, seed)
    await seedStore(backend, env)
    const stagingId = newStagingId(env)
    const unitKey = newStagedKey(stagingId, 'u', env)
    await backend.putUnit(unitKey, encodeUnit(UNIT_TYPE.preset, { v: 1, snapshot: 'old-data-key-list' }))
    return {
        backend, env, clock, prefix: stagingPrefix(stagingId), unitKey,
        pointer: { key: unitKey, digest: '0123456789abcdef0123456789abcdef', count: 4 },
    }
}

async function exists(backend: Store2Backend, key: string): Promise<boolean> {
    return (await backend.readUnits([key])).get(key) !== null
}

const pass = (fx: Fx) => gcPass({ backend: fx.backend, kind: 'indexeddb', idleReason: () => null })

async function markOf(fx: Fx) {
    return markLiveKeys(fx.backend, await fx.backend.readCommit())
}

describe('the mark keeps the pointed unit', () => {
    test('new behaviour: with a pointer the unit is live and the mark succeeds; without one it is not live', async () => {
        const fx = await newFx(1)
        const without = await markOf(fx)
        expect(without.status).toBe('marked')
        expect(without.status === 'marked' && without.live.has(fx.unitKey)).toBe(false)

        await peerWrite(fx.backend, fx.env, { snapshot: fx.pointer })
        const withPointer = await markOf(fx)
        expect(withPointer.status).toBe('marked')
        expect(withPointer.status === 'marked' && withPointer.live.has(fx.unitKey)).toBe(true)
        // The unit is kept, not read as a manifest: the closure stays the manifests' own.
        if (withPointer.status === 'marked') {
            expect(withPointer.closure.map(read => read.manifestKey)).toEqual([withPointer.commit.current?.key])
        }
    })

    test('mutant "the mark adds the pointer through refsOf": refsOf over a commit key never names the pointer, so the mark does not refuse', async () => {
        const fx = await newFx(2)
        await peerWrite(fx.backend, fx.env, { snapshot: fx.pointer })
        const stored = await parsedCommit(fx.backend)
        expect(stored.snapshot).toBeDefined()
        const named = refsOf(UNIT_TYPE.commit, stored).map(target => `store2/${target.tail}`)
        expect(named).not.toContain(fx.unitKey)
        expect(REFS_TABLE.filter(row => row.type === UNIT_TYPE.commit).map(row => row.path)).toEqual(['current.key', 'retained[].key', 'pins[].key'])
        const mark = await markOf(fx)
        expect(mark.status).toBe('marked')
    })

    test('mutant "the mark ignores the pointer": the pointer is honoured from a key in every shape the mark reads', async () => {
        const fx = await newFx(3)
        const current = (await parsedCommit(fx.backend)).current?.key as string
        const shapes: Record<string, Partial<Parameters<typeof nextCommitKey>[1]>> = {
            'current only': {},
            'a pin': { pins: [{ key: current, reason: 'p' }] },
            'a retained entry': { retained: [{ key: current, at: 1 }] },
            'a standing marker': { staging: { owner: ME, prefix: fx.prefix, startedAt: 1, label: 'bulk' } },
        }
        for (const [name, change] of Object.entries(shapes)) {
            await peerWrite(fx.backend, fx.env, { ...change, snapshot: fx.pointer })
            const mark = await markOf(fx)
            expect(mark.status, name).toBe('marked')
            expect(mark.status === 'marked' && mark.live.has(fx.unitKey), name).toBe(true)
            await peerWrite(fx.backend, fx.env, { staging: null, retained: [], pins: [], dropSnapshot: true })
        }
    })

    test('new behaviour: a key with no current (a marker standing) still marks the pointed unit', async () => {
        const fx = await newFx(4)
        const stored = await parsedCommit(fx.backend)
        const marker: CommitKey = nextCommitKey(stored, {
            current: null, retained: [], pins: [], snapshot: fx.pointer,
            staging: { owner: ME, prefix: fx.prefix, startedAt: 1, label: 'convert' },
        }, fx.env)
        await plantKey(fx.backend, marker)
        const mark = await markOf(fx)
        expect(mark.status).toBe('marked')
        expect(mark.status === 'marked' && mark.live.has(fx.unitKey)).toBe(true)
    })

    test('new behaviour: a malformed pointer adds nothing and does not make the mark refuse', async () => {
        const fx = await newFx(5)
        const stored = await parsedCommit(fx.backend)
        const raw = { ...stored, snapshot: { ...fx.pointer, count: -1 } }
        await plantKey(fx.backend, raw as unknown as CommitKey)
        expect(classifyCommitRead(await fx.backend.readCommit()).status).toBe('parsed')
        const mark = await markOf(fx)
        expect(mark.status).toBe('marked')
        expect(mark.status === 'marked' && mark.live.has(fx.unitKey)).toBe(false)
    })

    test('guard: a pointer whose unit is absent keeps nothing and refuses nothing (a no-op)', async () => {
        const fx = await newFx(6)
        const gone = { ...fx.pointer, key: newStagedKey(newStagingId(fx.env), 'u', fx.env) }
        await peerWrite(fx.backend, fx.env, { snapshot: gone })
        const mark = await markOf(fx)
        expect(mark.status).toBe('marked')
        const listedBefore = await fx.backend.listStore2()
        const result = await pass(fx)
        expect(result.status).toBe('done')
        expect(await fx.backend.listStore2()).toEqual(listedBefore.filter(key => key !== fx.unitKey))
    })
})

describe('gcPass honours the pointer', () => {
    test('new behaviour: a pointed unit survives a pass while the same unit with no pointer is garbage', async () => {
        const fx = await newFx(7)
        const orphan = newUnitKey(fx.env)
        await fx.backend.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1, orphan }))

        await peerWrite(fx.backend, fx.env, { snapshot: fx.pointer })
        const kept = await pass(fx)
        expect(kept).toMatchObject({ status: 'done' })
        expect(await exists(fx.backend, fx.unitKey)).toBe(true)
        expect(await exists(fx.backend, orphan)).toBe(false)

        await peerWrite(fx.backend, fx.env, { dropSnapshot: true })
        const dropped = await pass(fx)
        expect(dropped).toMatchObject({ status: 'done' })
        expect(await exists(fx.backend, fx.unitKey)).toBe(false)
    })

    test('guard: the unit survives while its staging prefix stands and after the final write names the pointer, and is collected once the pointer is dropped', async () => {
        const fx = await newFx(8)
        const committer = committerOf(fx.backend, fx.clock, 31, { owner: ME })
        // The marker stands over the prefix the snapshot unit sits under, before the final write.
        await peerWrite(fx.backend, fx.env, { staging: { owner: ME, prefix: fx.prefix, startedAt: fx.clock.now, label: 'bulk' } })
        const standing = await pass(fx)
        expect(standing).toMatchObject({ status: 'done' })
        expect(await exists(fx.backend, fx.unitKey)).toBe(true)

        // The final write clears the marker and names the unit by the pointer: the prefix no longer stands.
        await peerWrite(fx.backend, fx.env, { staging: null, snapshot: fx.pointer })
        expect((await parsedCommit(fx.backend)).staging).toBeNull()
        const after = await pass(fx)
        expect(after).toMatchObject({ status: 'done' })
        expect(await exists(fx.backend, fx.unitKey)).toBe(true)

        // The completion write drops the pointer; only then is the unit garbage.
        expect((await committer.dropSnapshot(await committer.readCommit(), fx.pointer)).status).toBe('committed')
        const collected = await pass(fx)
        expect(collected).toMatchObject({ status: 'done' })
        expect(await exists(fx.backend, fx.unitKey)).toBe(false)
    })

    test('mutant "the mark ignores the pointer": without the rule the unit named only by the pointer is deleted after the marker clears', async () => {
        const fx = await newFx(9)
        await peerWrite(fx.backend, fx.env, { snapshot: fx.pointer })
        const stored = await parsedCommit(fx.backend)
        const mark = await markOf(fx)
        // The only thing keeping the unit is the rule: it is in no manifest and not under a standing prefix.
        expect(stored.staging).toBeNull()
        expect(mark.status === 'marked' && mark.live.has(fx.unitKey)).toBe(true)
        expect(await exists(fx.backend, fx.unitKey)).toBe(true)
        await pass(fx)
        expect(await exists(fx.backend, fx.unitKey)).toBe(true)
    })
})
