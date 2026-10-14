// @vitest-environment node
/**
 * The recovery screen's exit protocol over the memory, IndexedDB (fake-indexeddb)
 * and Node (real server process) backends: the fence is written or extended
 * before the marker, the marker's basis and `seq` over each commit-key state,
 * the foreign-marker path and the conflict outcomes. Tauri is not run: the
 * `flushed` contract is exercised through a wrapper that overrides the reported
 * flush status, which is not evidence about the native commands.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    Store2BackendFailureError, Store2CommitConflictError, Store2UnknownOutcomeError, createMemoryBackend, type Store2Backend, type Store2Read,
} from 'src/ts/storage/store2/backend'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, isStagingPrefix, readUnit, tailOfKey, timeDigits, UNIT_TYPE, type CommitKey, type FenceRecord,
} from 'src/ts/storage/store2/format'
import { runExit, type ExitRequest, type ExitResult } from 'src/ts/storage/store2/recovery'
import { createClock, parsedCommit, plantKey, testEnv } from './commitFixtures'
import { FENCE_BACKENDS, plantCommit, plantFence, plantUnit, traced, type OpenedBackend } from './fenceFixtures'
import { GOLDEN_VECTORS, hexToBytes } from './goldenVectors'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
const ME = 'a'.repeat(26)
const PEER = 'b'.repeat(26)

function newerFence(): Uint8Array {
    const found = GOLDEN_VECTORS.find(entry => entry.id.startsWith('fence-F3-'))
    if (!found) {
        throw new Error('No golden vector fence-F3.')
    }
    return hexToBytes(found.hex)
}

const MANIFEST_OLD = `store2/m-${timeDigits(1000)}${'0'.repeat(19)}`
const MANIFEST_NEW = `store2/m-${timeDigits(2000)}${'0'.repeat(19)}`
const STAGED_MANIFEST = `store2/g-0123456789abcdef-m${timeDigits(1500)}${'0'.repeat(9)}`
const SOME_UNIT = `store2/u-${'0'.repeat(25)}1`

async function plantStore2Keys(backend: Store2Backend, keys: readonly string[] = [MANIFEST_OLD, STAGED_MANIFEST, SOME_UNIT]): Promise<void> {
    for (const key of keys) {
        await plantUnit(backend, key, Uint8Array.from([1, 2, 3]))
    }
}

async function openBackend(fixtureIndex: number): Promise<Store2Backend> {
    const entry = await FENCE_BACKENDS[fixtureIndex].open()
    opened.push(entry)
    return entry.backend
}

function commitBytes(key: CommitKey): Uint8Array {
    return encodeUnit(UNIT_TYPE.commit, key)
}

function marker(owner: string, label: 'recovery' | 'convert' | 'import' | 'seed' | 'bulk' | 'restore', seq = 1): CommitKey {
    const first = firstCommitKey({
        current: null,
        staging: { owner, prefix: `store2/g-${'1'.repeat(16)}-`, startedAt: 5, label },
    }, testEnv(createClock(), 90 + seq))
    return { ...first, seq }
}

async function storedFence(backend: Store2Backend): Promise<FenceRecord> {
    const read = await backend.readFence()
    if (read.bytes === null) {
        throw new Error('No fence is stored.')
    }
    const unit = readUnit(read.bytes, UNIT_TYPE.fenceRecord)
    if (unit.status !== 'ok') {
        throw new Error(`The stored fence is ${unit.status}.`)
    }
    return unit.value.body as FenceRecord
}

function expectMarked(result: ExitResult): Extract<ExitResult, { status: 'marked' }> {
    expect(result.status).toBe('marked')
    if (result.status !== 'marked') {
        throw new Error(`The exit ended ${result.status}.`)
    }
    return result
}

function exit(backend: Store2Backend, read: Store2Read, request: ExitRequest, options: Partial<Parameters<typeof runExit>[3]> = {}, seed = 7): Promise<ExitResult> {
    return runExit(backend, read, request, { owner: ME, env: testEnv(createClock(), seed), ...options })
}

describe.each(FENCE_BACKENDS.map((fixture, index) => [fixture.name, index] as const))('recovery exit on the %s backend', (_name, index) => {
    describe('order and the fence', () => {
        test.each([
            ['pick', { kind: 'pick', manifestSeq: 3 }, 'recovery'],
            ['convert', { kind: 'convert' }, 'convert'],
            ['import', { kind: 'import' }, 'import'],
            ['seed', { kind: 'seed' }, 'seed'],
        ] as const)('%s reads the fence, lists, writes the fence and only then the marker (label %s)', async (_kind, request, label) => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const recorded = traced(backend)
            const result = expectMarked(await exit(recorded.backend, await recorded.backend.readCommit(), request))
            const calls = recorded.log.filter(name => name !== 'readCommit')
            expect(calls.slice(0, 4)).toEqual(['readFence', 'listStore2', 'casFence', 'casCommit'])
            expect(recorded.log.filter(name => name === 'casFence')).toHaveLength(1)
            expect(recorded.log.indexOf('casFence')).toBeLessThan(recorded.log.indexOf('casCommit'))
            expect(recorded.log).not.toContain('removeBatch')
            expect(result.label).toBe(label)

            const stored = await parsedCommit(backend)
            expect(stored.current).toBeNull()
            expect(stored.retained).toEqual([])
            expect(stored.pins).toEqual([])
            expect(stored.staging).toMatchObject({ owner: ME, label })
            expect(stored.staging?.prefix).toBe(result.stagedPrefix)
            expect(isStagingPrefix(result.stagedPrefix)).toBe(true)
            expect(result.owner).toBe(ME)
            expect(result.markerRead.bytes).toEqual(commitBytes(stored))
        })

        test('the fence lists every pre-exit key and the damaged commit bytes verbatim; nothing is deleted', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const before = await backend.listStore2()
            expectMarked(await exit(backend, await backend.readCommit(), { kind: 'seed' }))
            const fence = await storedFence(backend)
            expect(fence.keys).toEqual(before.map(tailOfKey).sort())
            expect(fence.priorCommits).toHaveLength(1)
            expect(Buffer.from(fence.priorCommits[0].bytes ?? '', 'base64url')).toEqual(Buffer.from(DAMAGED_COMMIT))
            expect(await backend.listStore2()).toEqual(before)
        })

        test('an absent commit key is recorded as null in priorCommits', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            expectMarked(await exit(backend, await backend.readCommit(), { kind: 'import' }))
            expect((await storedFence(backend)).priorCommits.map(entry => entry.bytes)).toEqual([null])
        })

        test('a second exit writes a superset fence and never a smaller one', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            expectMarked(await exit(backend, await backend.readCommit(), { kind: 'seed' }))
            const first = await storedFence(backend)
            await plantUnit(backend, MANIFEST_NEW, Uint8Array.from([9]))
            const recorded = traced(backend)
            expectMarked(await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'import' }, {}, 8))
            const second = await storedFence(backend)
            expect(second.keys).toEqual(expect.arrayContaining(first.keys))
            expect(second.keys).toContain(tailOfKey(MANIFEST_NEW))
            expect(second.keys.length).toBeGreaterThan(first.keys.length)
            expect(second.at).toBe(first.at)
            expect(second.priorCommits).toHaveLength(2)
            expect(second.priorCommits[0]).toEqual(first.priorCommits[0])
            expect(recorded.log.filter(name => name === 'casFence')).toHaveLength(1)
        })

        test('the fence is never written after the marker', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            const recorded = traced(backend)
            expectMarked(await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' }))
            expect(recorded.log.slice(recorded.log.indexOf('casCommit') + 1)).not.toContain('casFence')
        })
    })

    describe('the marker basis and seq', () => {
        test('over an absent key with store2 keys the marker is first-life, seq 1, whatever was read', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            const result = expectMarked(await exit(backend, await backend.readCommit(), { kind: 'pick', manifestSeq: 9, highestSeqRead: 12 }))
            expect(result.marker.seq).toBe(1)
            expect((await parsedCommit(backend)).seq).toBe(1)
        })

        test('over a damaged key seq is one above the highest manifest seq read, the picked one included', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const pick = expectMarked(await exit(backend, await backend.readCommit(), { kind: 'pick', manifestSeq: 9, highestSeqRead: 4 }))
            expect(pick.marker.seq).toBe(10)
            expect((await parsedCommit(backend)).seq).toBe(10)
        })

        test('over a damaged key a pick that read fewer manifests than the pick itself still clears the picked seq', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const pick = expectMarked(await exit(backend, await backend.readCommit(), { kind: 'pick', manifestSeq: 9, highestSeqRead: 20 }))
            expect(pick.marker.seq).toBe(21)
        })

        test.each([
            ['convert', { kind: 'convert' }],
            ['import', { kind: 'import', highestSeqRead: 6 }],
            ['seed', { kind: 'seed' }],
        ] as const)('over a damaged key %s passes what it read, else 0', async (_kind, request) => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const result = expectMarked(await exit(backend, await backend.readCommit(), request))
            expect(result.marker.seq).toBe(('highestSeqRead' in request ? request.highestSeqRead : 0) + 1)
        })

        test('a key that parses is incremented by one with a fresh epoch, and a standing current is cleared (row 6)', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            const planted: CommitKey = { ...firstCommitKey({ current: { key: MANIFEST_OLD, at: 5 }, staging: null }, testEnv(createClock(), 4)), seq: 5 }
            await plantKey(backend, planted)
            const result = expectMarked(await exit(backend, await backend.readCommit(), { kind: 'pick', manifestSeq: 99 }))
            expect(result.marker.seq).toBe(6)
            expect(result.marker.epoch).not.toBe(planted.epoch)
            expect(result.marker.current).toBeNull()
            expect((await parsedCommit(backend)).current).toBeNull()
            const prior = (await storedFence(backend)).priorCommits
            expect(prior).toHaveLength(1)
            expect(Buffer.from(prior[0].bytes ?? '', 'base64url')).toEqual(Buffer.from(commitBytes(planted)))
        })

        test.each([
            ['row 7, no marker', { ...firstCommitKey({ current: null, staging: null }, testEnv(createClock(), 5)), seq: 3 }],
            ['row 8, own recovery marker', marker(ME, 'recovery', 3)],
            ['row 10, own convert marker', marker(ME, 'convert', 3)],
            ['row 11, own import marker', marker(ME, 'import', 3)],
        ] as const)('%s: the exit proceeds over the parsed key at its token', async (_name, planted) => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantKey(backend, planted)
            const result = expectMarked(await exit(backend, await backend.readCommit(), { kind: 'import' }))
            expect(result.marker.seq).toBe(4)
            expect((await parsedCommit(backend)).staging?.label).toBe('import')
            // Units staged under a standing marker's prefix must never mix with the new exit's staged re-write.
            expect(result.stagedPrefix).not.toBe(planted.staging?.prefix)
            expect(result.marker.staging?.prefix).not.toBe(planted.staging?.prefix)
        })
    })

    describe('a fence that does not end written', () => {
        test('not durable: no marker and the commit key is untouched; a re-run extends the fence and marks once flushed', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const unflushed = traced(backend, { fenceFlushed: false })
            const first = await exit(unflushed.backend, await unflushed.backend.readCommit(), { kind: 'seed' })
            expect(first).toMatchObject({ status: 'fence', fence: { status: 'not-durable' } })
            expect(unflushed.log).not.toContain('casCommit')
            expect(classifyCommitRead(await backend.readCommit()).status).toBe('damaged')

            const flushed = traced(backend, { fenceFlushed: true })
            const second = expectMarked(await exit(flushed.backend, await flushed.backend.readCommit(), { kind: 'seed' }))
            expect(second.fence.flushed).toBe(true)
            expect((await storedFence(backend)).priorCommits).toHaveLength(2)
        })

        test('contended: no marker', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            let planted = 0
            const recorded = traced(backend, {
                after: async (name) => {
                    if (name === 'readFence') {
                        planted++
                        await plantFence(backend, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: planted, priorCommits: [], keys: [] }))
                    }
                },
            })
            const result = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' })
            expect(result.status).toBe('fence')
            if (result.status === 'fence') {
                expect(result.fence.status).toBe('contended')
            }
            expect(recorded.log).not.toContain('casCommit')
        })

        test('failed fence write: no marker, the typed failure is passed through', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const recorded = traced(backend)
            const failing: Store2Backend = {
                ...recorded.backend,
                casFence: async () => { throw new Store2BackendFailureError('Injected fence failure.') },
            }
            const result = await exit(failing, await failing.readCommit(), { kind: 'seed' })
            expect(result).toMatchObject({ status: 'fence', fence: { status: 'failed' } })
            expect(recorded.log).not.toContain('casCommit')
        })

        test.each([
            ['the listing fails', { failList: true }, 'listing-failed'],
            ['the fence cannot be read', { failReadFence: true }, 'fence-unreadable'],
        ] as const)('not offered when %s: nothing is written', async (_name, fault, reason) => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const recorded = traced(backend, fault)
            const result = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' })
            expect(result).toMatchObject({ status: 'fence', fence: { status: 'not-offered', reason } })
            expect(recorded.log).not.toContain('casFence')
            expect(recorded.log).not.toContain('casCommit')
        })

        test('a too-new fence is never replaced and offers no exit', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            await plantFence(backend, newerFence())
            const recorded = traced(backend)
            const result = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' })
            expect(result).toMatchObject({ status: 'fence', fence: { status: 'not-offered', reason: 'fence-too-new' } })
            expect(recorded.log).not.toContain('casFence')
            expect(recorded.log).not.toContain('casCommit')
        })
    })

    describe('a too-new commit key', () => {
        test('the exit refuses before the fence is touched', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            const newer = GOLDEN_VECTORS.find(entry => entry.id === 'commit-05-fmt-2')
            expect(newer, 'a too-new commit vector exists').toBeDefined()
            await plantCommit(backend, hexToBytes((newer as { hex: string }).hex))
            const recorded = traced(backend)
            const result = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' })
            expect(result.status).toBe('refused')
            expect(recorded.log.filter(name => name !== 'readCommit')).toEqual([])
        })
    })

    describe('another owner\'s marker', () => {
        test.each([
            ['row 8, recovery', 'recovery'],
            ['row 11, import', 'import'],
            ['a standing convert', 'convert'],
            ['a standing bulk', 'bulk'],
        ] as const)('%s: refused without the hook, nothing written', async (_name, label) => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantKey(backend, marker(PEER, label, 4))
            const recorded = traced(backend)
            const result = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'import' })
            expect(result.status).toBe('foreign-marker')
            expect(recorded.log).not.toContain('casFence')
            expect(recorded.log).not.toContain('casCommit')
            expect((await backend.readFence()).bytes).toBeNull()
            expect((await parsedCommit(backend)).staging?.owner).toBe(PEER)
        })

        test('a declined hook refuses; the hook is asked with the standing marker', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantKey(backend, marker(PEER, 'recovery', 4))
            const asked: string[] = []
            const result = await exit(backend, await backend.readCommit(), { kind: 'import' }, {
                foreignClear: async (standing) => { asked.push(standing.owner); return false },
            })
            expect(result.status).toBe('foreign-marker')
            expect(asked).toEqual([PEER])
            expect((await backend.readFence()).bytes).toBeNull()
        })

        test('an agreeing hook lets the exit replace the marker after the fence', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantKey(backend, marker(PEER, 'recovery', 4))
            const recorded = traced(backend)
            const result = expectMarked(await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' }, {
                foreignClear: async () => true,
            }))
            expect(result.marker.seq).toBe(5)
            expect((await parsedCommit(backend)).staging?.owner).toBe(ME)
            expect(recorded.log.indexOf('casFence')).toBeLessThan(recorded.log.indexOf('casCommit'))
        })

        test('an own marker proceeds without asking', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantKey(backend, marker(ME, 'recovery', 4))
            let asked = 0
            expectMarked(await exit(backend, await backend.readCommit(), { kind: 'seed' }, { foreignClear: async () => { asked++; return false } }))
            expect(asked).toBe(0)
        })
    })

    describe('a conflict at the marker', () => {
        test('another tab installed a current: the exit is abandoned and nothing more is written', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            const peerKey: CommitKey = { ...firstCommitKey({ current: { key: MANIFEST_NEW, at: 9 }, staging: null }, testEnv(createClock(), 11)), seq: 40 }
            const recorded = traced(backend, {
                after: async (name) => {
                    if (name === 'casFence') {
                        await plantCommit(backend, commitBytes(peerKey))
                    }
                },
            })
            const result = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'pick', manifestSeq: 1 })
            expect(result.status).toBe('abandoned')
            if (result.status === 'abandoned') {
                expect(result.value.current?.key).toBe(MANIFEST_NEW)
            }
            expect((await parsedCommit(backend)).seq).toBe(40)
            expect(recorded.log.filter(name => name === 'casCommit')).toHaveLength(1)
        })

        test('a conflict without a current returns conflict; the re-run extends the fence and marks over the new read', async () => {
            const backend = await openBackend(index)
            await plantStore2Keys(backend)
            await plantCommit(backend, DAMAGED_COMMIT)
            let planted = false
            const recorded = traced(backend, {
                after: async (name) => {
                    if (name === 'casFence' && !planted) {
                        planted = true
                        await plantCommit(backend, commitBytes(marker(PEER, 'recovery', 2)))
                    }
                },
            })
            const first = await exit(recorded.backend, await recorded.backend.readCommit(), { kind: 'seed' })
            expect(first.status).toBe('conflict')
            if (first.status !== 'conflict') {
                return
            }
            // The peer's marker is foreign: the re-run with the agreeing hook replaces it, from step (1).
            const second = expectMarked(await exit(recorded.backend, first.current, { kind: 'seed' }, { foreignClear: async () => true }))
            expect(second.marker.seq).toBe(3)
            expect(recorded.log.filter(name => name === 'casFence')).toHaveLength(2)
            const fence = await storedFence(backend)
            expect(fence.priorCommits).toHaveLength(2)
            expect(Buffer.from(fence.priorCommits[1].bytes ?? '', 'base64url')).toEqual(Buffer.from(commitBytes(marker(PEER, 'recovery', 2))))
        })
    })
})

describe('marker write outcomes (memory backend)', () => {
    test('a definite failure at the marker is reported and leaves the commit key unchanged', async () => {
        const backend = createMemoryBackend()
        await plantStore2Keys(backend)
        await plantCommit(backend, DAMAGED_COMMIT)
        const failing: Store2Backend = {
            ...backend,
            casCommit: async () => { throw new Store2BackendFailureError('Injected marker failure.') },
        }
        const result = await exit(failing, await backend.readCommit(), { kind: 'seed' })
        expect(result.status).toBe('failed')
        expect(classifyCommitRead(await backend.readCommit()).status).toBe('damaged')
    })

    test('an unknown outcome whose write landed is marked at the stored marker\'s bytes and token', async () => {
        const backend = createMemoryBackend()
        await plantStore2Keys(backend)
        await plantCommit(backend, DAMAGED_COMMIT)
        const landing: Store2Backend = {
            ...backend,
            casCommit: async (token, bytes) => {
                await backend.casCommit(token, bytes)
                throw new Store2UnknownOutcomeError('Injected unknown outcome after the write landed.')
            },
        }
        const result = expectMarked(await exit(landing, await backend.readCommit(), { kind: 'seed' }))
        const stored = await backend.readCommit()
        expect(result.flushed).toBeUndefined()
        expect(result.markerRead.bytes).toEqual(stored.bytes)
        expect(result.markerRead.token).toEqual(stored.token)
        expect(stored.bytes).toEqual(commitBytes(result.marker))
    })

    test('an unknown outcome where a peer\'s key stands instead is a conflict, never marked', async () => {
        const backend = createMemoryBackend()
        await plantStore2Keys(backend)
        await plantCommit(backend, DAMAGED_COMMIT)
        const peerMarker = commitBytes(marker(PEER, 'import', 2))
        const missed: Store2Backend = {
            ...backend,
            casCommit: async () => {
                await plantCommit(backend, peerMarker)
                throw new Store2UnknownOutcomeError('Injected unknown outcome; the write did not land.')
            },
        }
        const result = await exit(missed, await backend.readCommit(), { kind: 'seed' })
        expect(result.status).toBe('conflict')
        expect((await backend.readCommit()).bytes).toEqual(peerMarker)
    })

    test('an unknown outcome where a peer installed a current is abandoned', async () => {
        const backend = createMemoryBackend()
        await plantStore2Keys(backend)
        await plantCommit(backend, DAMAGED_COMMIT)
        const peerKey: CommitKey = { ...firstCommitKey({ current: { key: MANIFEST_NEW, at: 9 }, staging: null }, testEnv(createClock(), 11)), seq: 40 }
        const missed: Store2Backend = {
            ...backend,
            casCommit: async () => {
                await plantCommit(backend, commitBytes(peerKey))
                throw new Store2UnknownOutcomeError('Injected unknown outcome; the write did not land.')
            },
        }
        const result = await exit(missed, await backend.readCommit(), { kind: 'seed' })
        expect(result.status).toBe('abandoned')
        if (result.status === 'abandoned') {
            expect(result.value.current?.key).toBe(MANIFEST_NEW)
        }
    })

    test('a peer write between the successful marker write and the read-back is a conflict, never marked at the peer\'s token', async () => {
        const backend = createMemoryBackend()
        await plantStore2Keys(backend)
        await plantCommit(backend, DAMAGED_COMMIT)
        const peerMarker = commitBytes(marker(PEER, 'import', 2))
        const raced: Store2Backend = {
            ...backend,
            casCommit: async (token, bytes) => {
                const written = await backend.casCommit(token, bytes)
                await plantCommit(backend, peerMarker)
                return written
            },
        }
        const result = await exit(raced, await backend.readCommit(), { kind: 'seed' })
        expect(result.status).toBe('conflict')
        expect((await backend.readCommit()).bytes).toEqual(peerMarker)
    })

    test('a conflict that the memory backend reports as the key it holds is re-read, not trusted', async () => {
        const backend = createMemoryBackend()
        await plantStore2Keys(backend)
        const stale = await backend.readCommit()
        await plantCommit(backend, commitBytes(marker(PEER, 'import', 2)))
        const result = await exit(backend, stale, { kind: 'seed' })
        expect(result.status).toBe('conflict')
        const direct = backend.casCommit(stale.token, DAMAGED_COMMIT)
        await expect(direct).rejects.toBeInstanceOf(Store2CommitConflictError)
    })
})
