// @vitest-environment node
/**
 * First-life install (plan v3.4 amendment 7): the unfenced marker accepted only from boot row 1 or this page's own
 * row-9 clear, the staged install under the marker's prefix, and the one installer shared with a fenced exit's marker.
 * Each test says what it is: new behaviour, guard (passes before and after any change that keeps the protocol), or
 * mutant (red under the named in-memory mutant of the library, kept in the test name).
 * Memory, IndexedDB (fake-indexeddb) and Node (real server process) backends; Tauri is covered by the replay.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Store2BackendFailureError, Store2CommitConflictError, Store2UnknownOutcomeError, type Store2Backend, type Store2Read } from 'src/ts/storage/store2/backend'
import { classifyBoot, probeStore2Presence, runBootClear } from 'src/ts/storage/store2/boot'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    firstLifeGrant, firstLifeInstall, installBuilt, writeFirstLifeMarker, type FirstLifeFacts, type FirstLifeGrant, type FirstLifeResult,
} from 'src/ts/storage/store2/firstLife'
import { encodeUnit, newManifestKey, newShardKey, newUnitKey, UNIT_TYPE, type CommitKey } from 'src/ts/storage/store2/format'
import { runExit } from 'src/ts/storage/store2/recovery'
import { buildTree, committerOf, createClock, expectInvariant, hooked, parsedCommit, plantKey, seedStore, testEnv, treeRequest, treeUnitCount, type TestClock } from './commitFixtures'
import { FENCE_BACKENDS, plantCommit, type OpenedBackend } from './fenceFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

const ME = 'a'.repeat(26)
const PEER = 'b'.repeat(26)
const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])
const ABSENT_FENCE = { state: 'absent', token: { kind: 'bytes', bytes: null } } as const

async function openBackend(index: number): Promise<Store2Backend> {
    const entry = await FENCE_BACKENDS[index].open()
    opened.push(entry)
    return entry.backend
}

interface Facts extends FirstLifeFacts {
    read: Store2Read
}

/** What a page that boots now would hold: the commit key read, the listing's presence, the table row and the start-up clear of its own marker. */
async function factsOf(backend: Store2Backend, clock: TestClock, options: { owner?: string, deviceOwner?: boolean, upstreamMainFile?: boolean } = {}): Promise<Facts> {
    const owner = options.owner ?? ME
    const deviceOwner = options.deviceOwner ?? false
    let read = await backend.readCommit()
    const commit = classifyCommitRead(read)
    const decision = classifyBoot({
        commit,
        fence: ABSENT_FENCE,
        presence: commit.status === 'absent' ? await probeStore2Presence(backend) : null,
        tree: null,
        upstreamMainFile: options.upstreamMainFile ?? false,
        ownerId: owner,
        deviceOwner,
    })
    const startupClear = await runBootClear(committerOf(backend, clock, 41, { owner }), read, decision, owner)
    if (startupClear !== null) {
        read = await backend.readCommit()
    }
    return { decision, commitRead: read, startupClear, read }
}

function grantOf(facts: FirstLifeFacts): FirstLifeGrant {
    const result = firstLifeGrant(facts)
    expect(result.status).toBe('granted')
    if (result.status !== 'granted') {
        throw new Error(`The grant was refused: ${result.reason}.`)
    }
    return result.grant
}

function installed(result: FirstLifeResult): Extract<FirstLifeResult, { status: 'installed' }> {
    expect(result.status).toBe('installed')
    if (result.status !== 'installed') {
        throw new Error(`The install ended ${result.status}.`)
    }
    return result
}

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

function markerOf(owner: string, label: 'seed' | 'convert', seq = 1): CommitKey {
    const first = firstCommitKey({
        current: null,
        staging: { owner, prefix: `store2/g-${'1'.repeat(16)}-`, startedAt: 5, label },
    }, testEnv(createClock(), 90 + seq))
    return { ...first, seq }
}

describe.each(FENCE_BACKENDS.map((fixture, index) => [fixture.name, index] as const))('first life on the %s backend', (_name, index) => {
    describe('new behaviour', () => {
        test('seed: an empty tree installs on an absent key with a stamped, unfenced commit key', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const grant = grantOf(await factsOf(backend, clock))
            expect(grant.kind).toBe('seed')
            const result = installed(await firstLifeInstall(backend, grant, { ...treeRequest(0, { tag: 'seed' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))

            const stored = await parsedCommit(backend)
            expect(stored.current?.key).toBe(result.manifestKey)
            expect(stored.staging).toBeNull()
            expect(stored.retained).toEqual([])
            expect(stored.pins).toEqual([])
            expect(stored.convertedFrom).toBe('seed')
            expect(stored.convertedAt).toBe(clock.now)
            expect((await backend.readFence()).bytes).toBeNull()
            await expectInvariant(backend)
        })

        test('convert: a non-empty tree installs under the convert label and stamps the main file', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const recording = recordingCas(backend)
            const grant = grantOf(await factsOf(recording.backend, clock, { upstreamMainFile: true }))
            expect(grant.kind).toBe('convert')
            installed(await firstLifeInstall(recording.backend, grant, { ...treeRequest(5, { tag: 'convert' }), convertedFrom: 'database/database.bin' }, { owner: ME, env: testEnv(clock, 11) }))

            expect(recording.written).toHaveLength(2)
            expect(recording.written[0].staging?.label).toBe('convert')
            expect(recording.written[0].current).toBeNull()
            const stored = await parsedCommit(backend)
            expect(stored.convertedFrom).toBe('database/database.bin')
            expect(stored.staging).toBeNull()
            await expectInvariant(backend)
        })

        test('the cleared result of this page\'s own row-9 clear grants the marker, and the install lands', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            await plantKey(backend, markerOf(ME, 'seed'))
            const facts = await factsOf(backend, clock, { owner: ME, deviceOwner: true })
            expect(facts.decision).toMatchObject({ row: 9, clear: 'own' })
            expect(facts.startupClear?.status).toBe('cleared')
            const grant = grantOf(facts)
            expect(grant.source).toBe('own-row-9-clear')
            installed(await firstLifeInstall(backend, grant, { ...treeRequest(0, { tag: 'seed' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))

            const stored = await parsedCommit(backend)
            expect(stored.current).not.toBeNull()
            expect(stored.seq).toBe(4)
            expect(stored.convertedFrom).toBe('seed')
            await expectInvariant(backend)
        })

        test('the installer also runs after a fenced exit marker and leaves the fence as the exit wrote it', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            await plantCommit(backend, DAMAGED_COMMIT)
            const exit = await runExit(backend, await backend.readCommit(), { kind: 'import' }, { owner: ME, env: testEnv(clock, 7) })
            expect(exit.status).toBe('marked')
            if (exit.status !== 'marked') {
                return
            }
            const fenceBefore = (await backend.readFence()).bytes
            expect(fenceBefore).not.toBeNull()
            const result = installed(await installBuilt({ backend, env: testEnv(clock, 12), marked: exit }, { ...treeRequest(2, { tag: 'import' }), convertedFrom: 'seed' }))

            const stored = await parsedCommit(backend)
            expect(stored.current?.key).toBe(result.manifestKey)
            expect(stored.staging).toBeNull()
            expect(Array.from((await backend.readFence()).bytes as Uint8Array)).toEqual(Array.from(fenceBefore as Uint8Array))
            await expectInvariant(backend)
        })
    })

    describe('the grant accepts exactly two states', () => {
        test('mutant "unfenced marker accepted from a row-7 read": a cleared state with no marker is refused', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            await plantKey(backend, { ...markerOf(ME, 'seed'), staging: null })
            const facts = await factsOf(backend, clock, { deviceOwner: true })
            expect(facts.decision.row).toBe(7)
            expect(firstLifeGrant(facts)).toMatchObject({ status: 'refused', reason: 'not-first-life' })
        })

        test('mutant "unfenced marker accepted from a row-2 read": units without a commit key are refused', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            await backend.putUnit(`store2/u-${'0'.repeat(25)}1`, Uint8Array.from([1, 2, 3]))
            const facts = await factsOf(backend, clock)
            expect(facts.decision.row).toBe(2)
            expect(firstLifeGrant(facts)).toMatchObject({ status: 'refused', reason: 'not-first-life' })
        })

        test('guard: a healthy key, a foreign marker and a damaged key are refused', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            await seedStore(backend, testEnv(clock, 3))
            const healthy: FirstLifeFacts = { decision: { row: 5, mode: 'normal', fence: 'absent' }, commitRead: await backend.readCommit(), startupClear: null }
            expect(firstLifeGrant(healthy)).toMatchObject({ status: 'refused', reason: 'not-first-life' })

            await plantKey(backend, markerOf(PEER, 'seed'))
            const foreign = await factsOf(backend, clock, { owner: ME, deviceOwner: true })
            expect(foreign.decision).toMatchObject({ row: 9, clear: 'foreign-path' })
            expect(firstLifeGrant(foreign)).toMatchObject({ status: 'refused', reason: 'foreign-marker' })

            await plantCommit(backend, DAMAGED_COMMIT)
            const damaged = await factsOf(backend, clock)
            expect(damaged.decision.row).toBe(4)
            expect(firstLifeGrant(damaged)).toMatchObject({ status: 'refused', reason: 'not-first-life' })
        })

        test('guard: a row-1 decision over a key that is no longer absent, and an own row-9 clear whose key moved, are refused', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const row1 = await factsOf(backend, clock)
            await plantKey(backend, markerOf(PEER, 'seed'))
            const moved: FirstLifeFacts = { ...row1, commitRead: await backend.readCommit() }
            expect(firstLifeGrant(moved)).toMatchObject({ status: 'refused', reason: 'key-present' })
            expect(firstLifeGrant({ ...row1, commitRead: null })).toMatchObject({ status: 'refused', reason: 'read-missing' })

            const other = await openBackend(index)
            await plantKey(other, markerOf(ME, 'seed'))
            const own = await factsOf(other, clock, { owner: ME, deviceOwner: true })
            await plantKey(other, { ...markerOf(PEER, 'seed', 9), staging: null })
            expect(firstLifeGrant({ ...own, commitRead: await other.readCommit() })).toMatchObject({ status: 'refused', reason: 'key-changed' })
            expect(firstLifeGrant({ ...own, startupClear: null })).toMatchObject({ status: 'refused', reason: 'not-cleared' })
        })

        test('mutant "cleared bytes not decoded": a cleared result whose value is not what its bytes hold is refused', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            await plantKey(backend, markerOf(ME, 'seed'))
            const own = await factsOf(backend, clock, { owner: ME, deviceOwner: true })
            expect(own.startupClear?.status).toBe('cleared')
            if (own.startupClear?.status !== 'cleared') {
                return
            }
            const forged = { ...own, startupClear: { ...own.startupClear, value: { ...own.startupClear.value, seq: own.startupClear.value.seq + 40 } } }
            expect(firstLifeGrant(forged)).toMatchObject({ status: 'refused', reason: 'not-cleared' })
        })
    })

    describe('order of writes', () => {
        test('mutant "install without a marker": the commit key names the marker before the first unit is written', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            let markerSeenAtFirstUnit: CommitKey | null | undefined
            const spy = hooked(backend, {
                before: async (name, count) => {
                    if (name === 'putUnit' && count === 1) {
                        const read = classifyCommitRead(await backend.readCommit())
                        markerSeenAtFirstUnit = read.status === 'parsed' ? read.value : null
                    }
                },
            })
            const grant = grantOf(await factsOf(spy.backend, clock))
            installed(await firstLifeInstall(spy.backend, grant, { ...treeRequest(1, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))
            expect(markerSeenAtFirstUnit?.staging?.owner).toBe(ME)
            expect(markerSeenAtFirstUnit?.current).toBeNull()
            expect(spy.log.indexOf('casCommit')).toBeLessThan(spy.log.indexOf('putUnit'))
        })

        test('mutant "a fence written on row 1": no fence is read or written by a first-life install', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const spy = hooked(backend)
            const grant = grantOf(await factsOf(spy.backend, clock))
            installed(await firstLifeInstall(spy.backend, grant, { ...treeRequest(0, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))
            expect(spy.log).not.toContain('casFence')
            expect(spy.log).not.toContain('readFence')
            expect((await backend.readFence()).bytes).toBeNull()
        })

        test('mutant "units written outside the staging prefix": every unit before the final write is inside the marker\'s prefix, and a build under any other key is refused unwritten', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const unitKeys: string[] = []
            const spy = hooked({
                ...backend,
                putUnit(key, bytes) {
                    unitKeys.push(key)
                    return backend.putUnit(key, bytes)
                },
            })
            const grant = grantOf(await factsOf(spy.backend, clock))
            const result = installed(await firstLifeInstall(spy.backend, grant, { ...treeRequest(3, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))
            const prefix = (await parsedCommit(backend)).current?.key.slice(0, 'store2/g-0000000000000000-'.length)
            expect(result.manifestKey.startsWith(prefix as string)).toBe(true)
            expect(unitKeys.length).toBeGreaterThan(0)
            expect(unitKeys.every(key => key.startsWith(prefix as string))).toBe(true)

            // A build that mints its own ordinary keys never reaches the backend.
            const second = await openBackend(index)
            const written: string[] = []
            const watch: Store2Backend = { ...second, putUnit: (key, bytes) => { written.push(key); return second.putUnit(key, bytes) } }
            const secondGrant = grantOf(await factsOf(watch, clock))
            const marked = await writeFirstLifeMarker(watch, secondGrant, { owner: ME, env: testEnv(clock, 13) })
            expect(marked.status).toBe('marked')
            if (marked.status !== 'marked') {
                return
            }
            const request = treeRequest(0, { tag: 'x' })
            const strayMint = testEnv(clock, 99)
            await expect(installBuilt({ backend: watch, env: testEnv(clock, 14), marked }, {
                newUnits: request.newUnits,
                convertedFrom: 'seed',
                build: () => buildTree(0, { mint: { shard: () => newShardKey(strayMint), unit: () => newUnitKey(strayMint), manifest: () => newManifestKey(strayMint) }, seq: 2, now: clock.now }, 'x'),
            })).rejects.toThrow(TypeError)
            expect(written).toEqual([])
        })

        test('mutant "final write at a fresh read": a peer that moved the key between the marker and the final write wins; the install is abandoned', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            // The stand-in for a peer that cleared the marker (Q3) and installed its own tree; the write only has to move the key between
            // the marker and the final write.
            const peer = markerOf(PEER, 'seed', 50)
            const spy = hooked(backend, {
                after: async (name, count) => {
                    if (name === 'putUnit' && count === treeUnitCount(0)) {
                        await plantKey(backend, { ...peer, staging: null, current: { key: `store2/m-${'0'.repeat(40)}`, at: 1 } })
                    }
                },
            })
            const grant = grantOf(await factsOf(spy.backend, clock))
            const result = await firstLifeInstall(spy.backend, grant, { ...treeRequest(0, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) })
            expect(result.status).toBe('abandoned')
            const stored = await parsedCommit(backend)
            expect(stored.current?.key).toBe(`store2/m-${'0'.repeat(40)}`)
            expect(stored.convertedFrom).toBeNull()
        })
    })

    describe('outcomes the installer answers', () => {
        test.each([
            ['conflict', () => new Store2CommitConflictError({ bytes: null, token: { kind: 'bytes', bytes: null } })],
            ['unknown outcome', () => new Store2UnknownOutcomeError('reply lost')],
        ] as const)('new behaviour: a final write that ends in a %s followed by a failed read-back answers unknown, never a throw', async (_name, fault) => {
            const backend = await openBackend(index)
            const clock = createClock()
            let failReads = false
            const spy = hooked(backend, {
                before: (name, count) => {
                    if (name === 'casCommit' && count === 2) {
                        failReads = true
                        throw fault()
                    }
                    if (name === 'readCommit' && failReads) {
                        throw new Store2BackendFailureError('The read failed.')
                    }
                },
            })
            const grant = grantOf(await factsOf(spy.backend, clock))
            const result = await firstLifeInstall(spy.backend, grant, { ...treeRequest(0, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) })
            expect(result.status).toBe('unknown')
        })

        test('mutant "forged row-1 decision": a hand-built row-1 decision over a store that holds a unit is refused at the marker and writes nothing', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const orphan = `store2/u-${'0'.repeat(25)}1`
            await backend.putUnit(orphan, Uint8Array.from([1, 2, 3]))
            const forged: FirstLifeFacts = { decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await backend.readCommit(), startupClear: null }
            const grant = grantOf(forged)
            const result = await firstLifeInstall(backend, grant, { ...treeRequest(0, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) })
            expect(result).toMatchObject({ status: 'not-marked', marker: { status: 'refused', reason: 'store-not-empty' } })
            expect((await backend.readCommit()).bytes).toBeNull()
            expect(await backend.listStore2()).toEqual([orphan])
        })

        test('mutant "marker not confirmed by a read-back": a peer write between the marker write and its read-back stops the install before any unit is staged', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const spy = hooked(backend, {
                after: async (name, count) => {
                    if (name === 'casCommit' && count === 1) {
                        // A peer's write over the marker: the read-back no longer shows this page's marker bytes.
                        await plantKey(backend, { ...markerOf(PEER, 'seed', 60), staging: null })
                    }
                },
            })
            const grant = grantOf(await factsOf(spy.backend, clock))
            const result = await firstLifeInstall(spy.backend, grant, { ...treeRequest(0, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) })
            expect(result.status).toBe('not-marked')
            expect(spy.log).not.toContain('putUnit')
            expect(await backend.listStore2()).toEqual([])
        })
    })

    describe('two tabs on an absent key', () => {
        test('guard: exactly one install wins; the other is refused at the row-1 re-check or meets a conflict, writes nothing and classifies again', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const first = grantOf(await factsOf(backend, clock))
            const second = grantOf(await factsOf(backend, clock))
            const winner = installed(await firstLifeInstall(backend, first, { ...treeRequest(1, { tag: 'a' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))

            const listedBefore = await backend.listStore2()
            const loser = await firstLifeInstall(backend, second, { ...treeRequest(1, { tag: 'b' }), convertedFrom: 'seed' }, { owner: PEER, env: testEnv(clock, 12) })
            expect(loser.status).toBe('not-marked')
            // The winner's units are already stored, so the row-1 re-check refuses before the marker write is tried.
            expect(loser.status === 'not-marked' ? loser.marker.status : null).toBe('refused')
            expect(await backend.listStore2()).toEqual(listedBefore)
            expect((await parsedCommit(backend)).current?.key).toBe(winner.manifestKey)
            await expectInvariant(backend)
        })

        test('guard: a loser that meets the winner\'s standing marker gets a conflict and the key keeps the winner\'s marker', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const first = grantOf(await factsOf(backend, clock))
            const second = grantOf(await factsOf(backend, clock))
            const marked = await writeFirstLifeMarker(backend, first, { owner: ME, env: testEnv(clock, 11) })
            expect(marked.status).toBe('marked')
            const loser = await firstLifeInstall(backend, second, { ...treeRequest(0, { tag: 'b' }), convertedFrom: 'seed' }, { owner: PEER, env: testEnv(clock, 12) })
            expect(loser).toMatchObject({ status: 'not-marked', marker: { status: 'conflict' } })
            const stored = await parsedCommit(backend)
            expect(stored.staging?.owner).toBe(ME)
            expect(await backend.listStore2()).toEqual([])
        })
    })

    describe('crash at each write', () => {
        test('guard: after a crash at any write the boot classifies the state as it classifies any marker, and nothing stands outside the staging prefix', async () => {
            const writesOf = async (): Promise<number> => {
                const backend = await openBackend(index)
                const clock = createClock()
                const spy = hooked(backend)
                const grant = grantOf(await factsOf(spy.backend, clock))
                installed(await firstLifeInstall(spy.backend, grant, { ...treeRequest(2, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))
                return spy.log.filter(name => name === 'casCommit' || name === 'putUnit').length
            }
            const total = await writesOf()
            expect(total).toBeGreaterThan(3)

            for (let crashAt = 1; crashAt <= total; crashAt++) {
                const backend = await openBackend(index)
                const clock = createClock()
                let writes = 0
                const spy = hooked(backend, {
                    before: (name) => {
                        if ((name === 'casCommit' || name === 'putUnit') && ++writes === crashAt) {
                            throw new Error('crash')
                        }
                    },
                })
                const grant = grantOf(await factsOf(spy.backend, clock))
                await expect(firstLifeInstall(spy.backend, grant, { ...treeRequest(2, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }), `crash at write ${crashAt}`).rejects.toThrow('crash')

                const listed = await backend.listStore2()
                const web = await factsOf(backend, clock, { owner: PEER, deviceOwner: false })
                if (crashAt === 1) {
                    expect(listed).toEqual([])
                    expect(web.decision).toMatchObject({ row: 1, mode: 'first-life' })
                    continue
                }
                const stored = await parsedCommit(backend)
                expect(stored.current).toBeNull()
                expect(stored.staging?.owner).toBe(ME)
                expect(listed.every(key => key.startsWith((stored.staging as NonNullable<CommitKey['staging']>).prefix)), `crash at write ${crashAt}`).toBe(true)
                expect(web.decision).toMatchObject({ row: 9, operation: 'seed', clear: 'foreign-path' })
                expect(firstLifeGrant(web)).toMatchObject({ status: 'refused', reason: 'foreign-marker' })
                const device = await factsOf(backend, clock, { owner: ME, deviceOwner: true })
                expect(device.decision).toMatchObject({ row: 9, clear: 'own' })
                expect(device.startupClear?.status).toBe('cleared')
                expect(firstLifeGrant(device).status).toBe('granted')
            }
        })

        test('guard: a final write whose reply is lost after it landed is reported installed', async () => {
            const backend = await openBackend(index)
            const clock = createClock()
            const spy = hooked(backend, {
                after: (name, count) => {
                    if (name === 'casCommit' && count === 2) {
                        throw new Store2UnknownOutcomeError('The reply was lost.')
                    }
                },
            })
            const grant = grantOf(await factsOf(spy.backend, clock))
            const result = installed(await firstLifeInstall(spy.backend, grant, { ...treeRequest(0, { tag: 'x' }), convertedFrom: 'seed' }, { owner: ME, env: testEnv(clock, 11) }))
            expect((await parsedCommit(backend)).current?.key).toBe(result.manifestKey)
        })
    })
})

describe('the marker key', () => {
    test('new behaviour: over an absent key the marker is the first key, over a cleared key it is one above it', async () => {
        const backend = await openBackend(0)
        const clock = createClock()
        const first = await writeFirstLifeMarker(backend, grantOf(await factsOf(backend, clock)), { owner: ME, env: testEnv(clock, 11) })
        expect(first.status).toBe('marked')
        if (first.status !== 'marked') {
            return
        }
        expect(first.marker.seq).toBe(1)
        expect(first.fence).toBeUndefined()
        expect(Array.from((await backend.readCommit()).bytes as Uint8Array)).toEqual(Array.from(encodeUnit(UNIT_TYPE.commit, first.marker)))
    })
})
