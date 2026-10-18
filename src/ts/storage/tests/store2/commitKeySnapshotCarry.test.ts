// @vitest-environment node
/**
 * The snapshot pointer survives every writer of a parsed commit key, byte-equal, and only the explicit drop member
 * removes it. One guard per writer: ordinary commit and save-mine, bulk marker and final write, restore, pin, unpin,
 * abandon-clear and clear-marker, the recovery marker over a parsed key, the installer's final write, the pick install,
 * and the first-life marker over this page's own cleared key. Memory backend: the carry is a property of the key
 * values, not of a backend. Each test says what it is: guard (passes before and after any change that keeps the
 * carry; red under the named mutant) or new behaviour.
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, type Store2Backend, type Store2Read } from 'src/ts/storage/store2/backend'
import { classifyBoot, probeStore2Presence, runBootClear } from 'src/ts/storage/store2/boot'
import { classifyCommitRead, firstCommitKey, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    firstLifeGrant, firstLifeInstall, installBuilt, type FirstLifeFacts,
} from 'src/ts/storage/store2/firstLife'
import {
    newStagingId, stagingPrefix, type CommitKey, type KeyEnv, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import { runExit } from 'src/ts/storage/store2/recovery'
import { installPick, pickCandidate } from 'src/ts/storage/store2/recoveryPick'
import {
    committerOf, createClock, parsedCommit, peerWrite, plantKey, seedStore, testEnv, treeRequest, type TestClock,
} from './commitFixtures'
import { plantTree } from './recoveryFixtures'

const ME = 'a'.repeat(26)

/** A pointer with an unknown member, so "copied whole" is observable. */
const POINTER = {
    key: 'store2/g-abcdefghijklmnop-u0123456789abcdef',
    digest: '0123456789abcdef0123456789abcdef',
    count: 3,
    extra: { nested: [1, 'x'] },
} as SnapshotPointer

const HOUR = 3_600_000

interface World {
    backend: Store2Backend
    clock: TestClock
    env: KeyEnv
    /** The pointer as the stored key holds it after the first plant, serialised. */
    planted: string
}

/** A seeded store whose commit key carries the pointer. */
async function world(seed: number): Promise<World> {
    const backend = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, seed)
    await seedStore(backend, env)
    await peerWrite(backend, env, { snapshot: POINTER })
    const planted = JSON.stringify((await parsedCommit(backend)).snapshot)
    expect(planted, 'the pointer was planted').toContain(POINTER.digest)
    return { backend, clock, env, planted }
}

const serialised = (key: CommitKey): string | undefined => key.snapshot === undefined ? undefined : JSON.stringify(key.snapshot)

/** Every commit-key value the backend was asked to write, in order. */
function recordingCas(inner: Store2Backend): { backend: Store2Backend, written: CommitKey[] } {
    const written: CommitKey[] = []
    return {
        written,
        backend: {
            ...inner,
            casCommit(expected, next) {
                const parsed = classifyCommitRead({ bytes: next })
                if (parsed.status === 'parsed') {
                    written.push(parsed.value)
                }
                return inner.casCommit(expected, next)
            },
        },
    }
}

/** A second commit later, so the first manifest is retained and can be restored. */
async function withRetained(w: World): Promise<string> {
    const retained = (await parsedCommit(w.backend)).current?.key as string
    w.clock.advance(HOUR)
    const committer = committerOf(w.backend, w.clock, 301, { owner: ME })
    const result = await committer.commit(await committer.readCommit(), treeRequest(1, { tag: 'second' }))
    expect(result.status).toBe('committed')
    expect((await parsedCommit(w.backend)).retained.map(entry => entry.key)).toContain(retained)
    return retained
}

describe('the pointer survives every writer over a parsed key', () => {
    test('guard: an ordinary commit and a save-mine commit', async () => {
        const w = await world(1)
        const committer = committerOf(w.backend, w.clock, 11, { owner: ME })
        expect((await committer.commit(await committer.readCommit(), treeRequest(1, { tag: 'a' }))).status).toBe('committed')
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
        w.clock.advance(HOUR)
        expect((await committer.saveMine(await committer.readCommit(), treeRequest(1, { tag: 'b' }))).status).toBe('committed')
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
    })

    test('guard: the bulk marker and the bulk final write both carry it', async () => {
        const w = await world(2)
        const recording = recordingCas(w.backend)
        const committer = committerOf(recording.backend, w.clock, 12, { owner: ME })
        const result = await committer.commit(await committer.readCommit(), treeRequest(70, { tag: 'bulk' }))
        expect(result).toMatchObject({ status: 'committed', mode: 'bulk' })
        expect(recording.written).toHaveLength(2)
        expect(recording.written[0].staging).not.toBeNull()
        expect(recording.written.map(serialised)).toEqual([w.planted, w.planted])
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
    })

    test('guard: restore', async () => {
        const w = await world(3)
        const retained = await withRetained(w)
        const committer = committerOf(w.backend, w.clock, 13, { owner: ME })
        expect((await committer.restore(await committer.readCommit(), retained)).status).toBe('committed')
        const stored = await parsedCommit(w.backend)
        expect(stored.current?.key).toBe(retained)
        expect(serialised(stored)).toBe(w.planted)
    })

    test('guard: pin and unpin', async () => {
        const w = await world(4)
        const current = (await parsedCommit(w.backend)).current?.key as string
        const committer = committerOf(w.backend, w.clock, 14, { owner: ME })
        expect((await committer.pin(await committer.readCommit(), current, 'keep')).status).toBe('committed')
        const pinned = await parsedCommit(w.backend)
        expect(pinned.pins).toHaveLength(1)
        expect(serialised(pinned)).toBe(w.planted)
        expect((await committer.unpin(await committer.readCommit(), current)).status).toBe('committed')
        const unpinned = await parsedCommit(w.backend)
        expect(unpinned.pins).toHaveLength(0)
        expect(serialised(unpinned)).toBe(w.planted)
    })

    test('guard: abandon-clear and clear-marker over a standing marker', async () => {
        const w = await world(5)
        const prefix = stagingPrefix(newStagingId(w.env))
        const marker = { owner: ME, prefix, startedAt: w.clock.now, label: 'bulk' as const }
        await peerWrite(w.backend, w.env, { staging: marker })
        const committer = committerOf(w.backend, w.clock, 15, { owner: ME })
        const cleared = await committer.abandonClear(await committer.readCommit(), ME, prefix)
        expect(cleared.status).toBe('cleared')
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)

        await peerWrite(w.backend, w.env, { staging: marker })
        const viaClear = await committer.clearMarker(await committer.readCommit())
        expect(viaClear.cleared?.status).toBe('cleared')
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
    })

    test('guard: the recovery marker over a parsed key and the installer\'s final write', async () => {
        const w = await world(6)
        const exit = await runExit(w.backend, await w.backend.readCommit(), { kind: 'import' }, { owner: ME, env: testEnv(w.clock, 16) })
        expect(exit.status).toBe('marked')
        if (exit.status !== 'marked') {
            return
        }
        expect(exit.marker.current).toBeNull()
        expect(serialised(exit.marker)).toBe(w.planted)
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
        const result = await installBuilt({ backend: w.backend, env: testEnv(w.clock, 17), marked: exit }, { ...treeRequest(1, { tag: 'import' }), convertedFrom: 'seed' })
        expect(result.status).toBe('installed')
        const stored = await parsedCommit(w.backend)
        expect(stored.current).not.toBeNull()
        expect(serialised(stored)).toBe(w.planted)
    })

    test('guard: the pick install (marker and final write)', async () => {
        const w = await world(7)
        const planted = await plantTree(w.backend, testEnv(w.clock, 18), {})
        await peerWrite(w.backend, w.env, { current: { key: planted.manifestKey, at: w.clock.now }, manifests: [planted.body] })
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
        const ready = await pickCandidate(w.backend, await w.backend.readCommit(), planted.manifestKey, {
            owner: ME,
            env: testEnv(w.clock, 19),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(ready.status).toBe('ready')
        if (ready.status !== 'ready') {
            return
        }
        expect(serialised(ready.marked.marker)).toBe(w.planted)
        const result = await installPick(ready, { confirm: true })
        expect(result.status).toBe('installed')
        expect(serialised(await parsedCommit(w.backend))).toBe(w.planted)
    })

    test('guard: the first-life marker over this page\'s own cleared key, and its install', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        const env = testEnv(clock, 8)
        const staging = { owner: ME, prefix: `store2/g-${'1'.repeat(16)}-`, startedAt: 5, label: 'seed' as const }
        const own = { ...firstCommitKey({ current: null, staging, snapshot: POINTER }, env), seq: 1 }
        await plantKey(backend, own)
        const planted = JSON.stringify((await parsedCommit(backend)).snapshot)
        expect(planted, 'the pointer was planted').toContain(POINTER.digest)

        let read: Store2Read = await backend.readCommit()
        const commit = classifyCommitRead(read)
        const decision = classifyBoot({
            commit,
            fence: { state: 'absent', token: { kind: 'bytes', bytes: null } },
            presence: null,
            tree: null,
            upstreamMainFile: false,
            ownerId: ME,
            deviceOwner: true,
        })
        const startupClear = await runBootClear(committerOf(backend, clock, 41, { owner: ME }), read, decision, ME)
        expect(startupClear?.status).toBe('cleared')
        read = await backend.readCommit()
        expect(serialised(await parsedCommit(backend))).toBe(planted)

        const facts: FirstLifeFacts = { decision, commitRead: read, startupClear }
        const granted = firstLifeGrant(facts)
        expect(granted.status).toBe('granted')
        if (granted.status !== 'granted') {
            return
        }
        const result = await firstLifeInstall(backend, granted.grant, { ...treeRequest(0, { tag: 'seed' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) })
        expect(result.status).toBe('installed')
        expect(serialised(await parsedCommit(backend))).toBe(planted)
        expect(await probeStore2Presence(backend)).toMatchObject({ status: 'some' })
    })
})

describe('setting a pointer over an existing one', () => {
    const NEWER: SnapshotPointer = { key: 'store2/g-ponmlkjihgfedcba-u0123456789abcdef', digest: 'fedcba9876543210fedcba9876543210', count: 9 }

    test('guard (passes before and after; red under the mutant "the old pointer wins", L4 R10): a change that sets a pointer replaces the base\'s pointer, and the stored key holds only the new one', async () => {
        const w = await world(11)
        const base = await parsedCommit(w.backend)
        expect(base.snapshot?.key).toBe(POINTER.key)
        const next = nextCommitKey(base, { snapshot: NEWER }, w.env)
        expect(next.snapshot).toEqual(NEWER)
        expect(next.snapshot).not.toBe(NEWER)
        await plantKey(w.backend, next)
        const stored = await parsedCommit(w.backend)
        expect(stored.snapshot).toEqual(NEWER)
        expect(JSON.stringify(stored.snapshot)).not.toContain('extra')
    })

    test('new behaviour: firstCommitKey takes the given pointer', () => {
        const first = firstCommitKey({ current: null, staging: null, snapshot: NEWER }, testEnv(createClock(), 12))
        expect(first.snapshot).toEqual(NEWER)
    })
})
describe('the drop member', () => {
    test('new behaviour: dropSnapshot removes the property in one write and changes nothing else', async () => {
        const w = await world(9)
        const before = await parsedCommit(w.backend)
        const committer = committerOf(w.backend, w.clock, 21, { owner: ME })
        const result = await committer.dropSnapshot(await committer.readCommit(), POINTER)
        expect(result.status).toBe('committed')
        const after = await parsedCommit(w.backend)
        expect(Object.hasOwn(after, 'snapshot')).toBe(false)
        expect(after.seq).toBe(before.seq + 1)
        expect({ ...after, snapshot: undefined, seq: 0, epoch: '' }).toEqual({ ...before, snapshot: undefined, seq: 0, epoch: '' })
    })

    test('new behaviour: dropSnapshot over a key with no pointer refuses and writes nothing', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await seedStore(backend, testEnv(clock, 10))
        const recording = recordingCas(backend)
        const committer = committerOf(recording.backend, clock, 22, { owner: ME })
        const result = await committer.dropSnapshot(await committer.readCommit(), POINTER)
        expect(result).toMatchObject({ status: 'refused', reason: 'no-snapshot' })
        expect(recording.written).toEqual([])
    })
})
