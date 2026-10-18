// @vitest-environment node
/**
 * `Committer.dropSnapshot(read, expected)`: the old-data deletion's completion write drops the pointer only when the
 * key still holds exactly the pointer the pass worked from and no marker stands. Each test says what it is: reproducer
 * (red on the base, where `dropSnapshot(read)` ignored what the key held) or guard (passes before and after).
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { newStagingId, stagingPrefix, type CommitKey, type SnapshotPointer } from 'src/ts/storage/store2/format'
import { committerOf, createClock, parsedCommit, peerWrite, seedStore, testEnv } from './commitFixtures'

const ME = 'a'.repeat(26)

const POINTER: SnapshotPointer = {
    key: 'store2/g-abcdefghijklmnop-u0123456789abcdef',
    digest: '0123456789abcdef0123456789abcdef',
    count: 3,
}

async function world(seed: number) {
    const backend = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, seed)
    await seedStore(backend, env)
    await peerWrite(backend, env, { snapshot: POINTER })
    return { backend, clock, env }
}

/** Every commit-key value the backend was asked to write. */
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

describe('dropSnapshot with the expected pointer', () => {
    test.each([
        ['key', { ...POINTER, key: 'store2/g-ponmlkjihgfedcba-u0123456789abcdef' }],
        ['digest', { ...POINTER, digest: 'fedcba9876543210fedcba9876543210' }],
        ['count', { ...POINTER, count: 4 }],
    ])('reproducer: a pointer that differs by %s is refused as snapshot-mismatch and nothing is written', async (_name, expected) => {
        const w = await world(1)
        const recording = recordingCas(w.backend)
        const committer = committerOf(recording.backend, w.clock, 11, { owner: ME })
        const before = (await w.backend.readCommit()).bytes
        const result = await committer.dropSnapshot(await committer.readCommit(), expected)
        expect(result).toMatchObject({ status: 'refused', reason: 'snapshot-mismatch' })
        expect(recording.written).toEqual([])
        expect((await w.backend.readCommit()).bytes).toEqual(before)
        expect((await parsedCommit(w.backend)).snapshot).toEqual(POINTER)
    })

    test('reproducer: a retry on a fresh read never drops a newer conversion\'s pointer', async () => {
        const w = await world(2)
        const committer = committerOf(w.backend, w.clock, 12, { owner: ME })
        const newer: SnapshotPointer = { key: 'store2/g-ponmlkjihgfedcba-u0123456789abcdef', digest: 'fedcba9876543210fedcba9876543210', count: 9 }
        await peerWrite(w.backend, w.env, { snapshot: newer })
        const result = await committer.dropSnapshot(await committer.readCommit(), POINTER)
        expect(result).toMatchObject({ status: 'refused', reason: 'snapshot-mismatch' })
        expect((await parsedCommit(w.backend)).snapshot).toEqual(newer)
    })

    test('reproducer: a standing marker refuses the drop as staging and nothing is written', async () => {
        const w = await world(3)
        const prefix = stagingPrefix(newStagingId(w.env))
        await peerWrite(w.backend, w.env, { staging: { owner: 'b'.repeat(26), prefix, startedAt: w.clock.now, label: 'bulk' } })
        const recording = recordingCas(w.backend)
        const committer = committerOf(recording.backend, w.clock, 13, { owner: ME })
        const result = await committer.dropSnapshot(await committer.readCommit(), POINTER)
        expect(result).toMatchObject({ status: 'refused', reason: 'staging' })
        expect(recording.written).toEqual([])
        expect((await parsedCommit(w.backend)).snapshot).toEqual(POINTER)
    })

    test('guard (passes before and after): a key with no pointer refuses as no-snapshot and writes nothing', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await seedStore(backend, testEnv(clock, 4))
        const recording = recordingCas(backend)
        const committer = committerOf(recording.backend, clock, 14, { owner: ME })
        const result = await committer.dropSnapshot(await committer.readCommit(), POINTER)
        expect(result).toMatchObject({ status: 'refused', reason: 'no-snapshot' })
        expect(recording.written).toEqual([])
    })

    test('guard (passes before and after): the expected pointer drops it in one write that changes nothing else, and the members this build does not know do not matter', async () => {
        const w = await world(5)
        const before = await parsedCommit(w.backend)
        const committer = committerOf(w.backend, w.clock, 15, { owner: ME })
        const result = await committer.dropSnapshot(await committer.readCommit(), { ...POINTER, extra: 1 } as SnapshotPointer)
        expect(result.status).toBe('committed')
        const after = await parsedCommit(w.backend)
        expect(Object.hasOwn(after, 'snapshot')).toBe(false)
        expect(after.seq).toBe(before.seq + 1)
        expect({ ...after, snapshot: undefined, seq: 0, epoch: '' }).toEqual({ ...before, snapshot: undefined, seq: 0, epoch: '' })
    })
})
