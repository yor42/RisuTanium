// @vitest-environment node
/**
 * Boot classification, rows 1 to 11 of the boot table, over values built from
 * real commit keys and tree reads, the presence probe over a fault-injecting
 * wrapper of the memory backend, and the row 9 start-up clear.
 */
import { describe, expect, test } from 'vitest'
import { Store2BackendFailureError, createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyBoot, probeStore2Presence, runBootClear, type BootInput } from 'src/ts/storage/store2/boot'
import { classifyCommitRead, firstCommitKey, type CommitRead } from 'src/ts/storage/store2/commitKey'
import type { FenceVerdict } from 'src/ts/storage/store2/fence'
import {
    encodeUnit, keyOfTail, newManifestKey, newShardKey, newStagingId, newUnitKey, refOfFrame, stagingPrefix, UNIT_TYPE,
    type CommitKey, type KeyEnv, type StagingLabel,
} from 'src/ts/storage/store2/format'
import type { Staging } from 'src/ts/storage/store2/owner'
import { readTree, type TreeRead } from 'src/ts/storage/store2/tree'
import { buildTree, committerOf, createClock, hooked, parsedCommit, plantKey, seedStore, START_TIME, testEnv } from './commitFixtures'

const clock = createClock()
const env = testEnv(clock, 41)
const OWNER = 'a'.repeat(26)
const OTHER = 'b'.repeat(26)

function staging(label: StagingLabel, owner: string = OWNER): Staging {
    return { owner, prefix: stagingPrefix(newStagingId(env)), startedAt: START_TIME, label }
}

function keyOf(change: { current?: CommitKey['current'], staging?: Staging | null }): CommitKey {
    return firstCommitKey({ current: change.current ?? null, staging: change.staging ?? null }, env)
}

function parsed(key: CommitKey): CommitRead {
    return { status: 'parsed', value: key }
}

const ABSENT_FENCE: FenceVerdict = { state: 'absent', token: { kind: 'bytes', bytes: null } }
const NO_PRESENCE = null
const MANIFEST = { key: newManifestKey(env), at: START_TIME }

function inputOf(overrides: Partial<BootInput>): BootInput {
    return {
        commit: { status: 'absent' },
        fence: ABSENT_FENCE,
        presence: NO_PRESENCE,
        tree: null,
        upstreamMainFile: false,
        ownerId: OWNER,
        deviceOwner: false,
        ...overrides,
    }
}

async function okTree(): Promise<TreeRead> {
    const backend = createMemoryBackend()
    const manifestKey = await seedStore(backend, testEnv(createClock(), 7))
    return readTree(backend, manifestKey)
}

/** Plants a complete tree whose asset list is one version above this build's, named by the manifest under its own size and checksum. Returns the manifest key. */
async function plantNewerListTree(backend: Store2Backend, treeEnv: KeyEnv): Promise<string> {
    const built = buildTree(0, {
        mint: { shard: () => newShardKey(treeEnv), unit: () => newUnitKey(treeEnv), manifest: () => newManifestKey(treeEnv) },
        seq: 1,
        now: treeEnv.now(),
    }, 'tree')
    const listKey = keyOfTail(built.manifest.body.fixed.configAl[0])
    const newer = encodeUnit(UNIT_TYPE.assetList, { v: 99, h: '', l: [] })
    const ref = refOfFrame(listKey, newer)
    built.manifest.body.fixed.configAl = [ref[0], ref[1], ref[2], built.manifest.body.fixed.configAl[3]]
    for (const unit of built.units) {
        await backend.putUnit(unit.key, unit.key === listKey ? newer : unit.bytes)
    }
    await backend.putUnit(built.manifest.key, encodeUnit(UNIT_TYPE.manifest, built.manifest.body))
    return built.manifest.key
}

const missingTree: TreeRead = { status: 'missing', manifestKey: MANIFEST.key, keys: ['store2/x'] }
const damagedTree: TreeRead = { status: 'damaged', manifestKey: MANIFEST.key, keys: ['store2/x'], missing: [], reason: 'bad' }

describe('boot table', () => {
    describe('row 1: no commit key and no unit', () => {
        const none = { status: 'none' } as const

        test('an upstream main file converts', () => {
            expect(classifyBoot(inputOf({ presence: none, upstreamMainFile: true }))).toEqual({ row: 1, mode: 'first-life', action: 'convert' })
        })

        test('no upstream main file seeds', () => {
            expect(classifyBoot(inputOf({ presence: none, upstreamMainFile: false }))).toEqual({ row: 1, mode: 'first-life', action: 'seed' })
        })

        test('an upstream main file that could not be checked blocks the choice', () => {
            expect(classifyBoot(inputOf({ presence: none, upstreamMainFile: null }))).toMatchObject({ row: 1, mode: 'blocked', reason: 'main-file-unknown' })
        })

        test('an unknown presence blocks conversion and seeding and is never read as none', () => {
            const decision = classifyBoot(inputOf({ presence: { status: 'unknown', reason: 'list failed' }, upstreamMainFile: true }))

            expect(decision).toMatchObject({ row: 1, mode: 'blocked', reason: 'presence-unknown' })
        })

        test('an absent commit key is not classified without a presence answer', () => {
            expect(() => classifyBoot(inputOf({ presence: null }))).toThrow(TypeError)
        })
    })

    test('row 2: an absent commit key with a unit goes to recovery, never conversion or seeding', () => {
        for (const upstreamMainFile of [true, false]) {
            expect(classifyBoot(inputOf({ presence: { status: 'some', via: 'list' }, upstreamMainFile }))).toEqual({ row: 2, mode: 'recovery' })
        }
    })

    describe('row 3: too new is read-only', () => {
        test('a commit key from a newer writer', () => {
            const decision = classifyBoot(inputOf({ commit: { status: 'too-new', reason: 'fmt 2' } }))

            expect(decision).toEqual({ row: 3, mode: 'read-only', source: 'commit-key', detail: 'fmt 2' })
        })

        test('a too-new fence, whatever the commit key holds', async () => {
            const fence: FenceVerdict = { state: 'blocked', reason: 'too-new', detail: 'codec', token: null }
            for (const input of [
                inputOf({ presence: { status: 'none' }, fence }),
                inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree: await okTree(), fence }),
                inputOf({ commit: { status: 'damaged', reason: 'x' }, fence }),
            ]) {
                expect(classifyBoot(input)).toEqual({ row: 3, mode: 'read-only', source: 'fence', detail: 'codec' })
            }
        })

        test('a manifest or unit of the tree', () => {
            const tree: TreeRead = { status: 'too-new', manifestKey: MANIFEST.key, keys: ['store2/x'], reason: 'codec' }

            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree }))).toEqual({ row: 3, mode: 'read-only', source: 'tree', detail: 'codec' })
        })
    })

    test('row 4: a damaged commit key goes to recovery', () => {
        expect(classifyBoot(inputOf({ commit: { status: 'damaged', reason: 'crc' }, presence: { status: 'some', via: 'count' } }))).toEqual({ row: 4, mode: 'recovery', detail: 'crc' })
    })

    test('an asset list above this build\'s version is a normal boot, not row 3', async () => {
        const backend = createMemoryBackend()
        const tree = await readTree(backend, await plantNewerListTree(backend, testEnv(createClock(), 8)))

        expect(tree.status).toBe('ok')
        expect(classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree }))).toEqual({ row: 5, mode: 'normal', fence: 'absent' })
    })

    describe('row 5: normal boot', () => {
        test('a parsed key whose tree loads, with no fence', async () => {
            const decision = classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree: await okTree() }))

            expect(decision).toEqual({ row: 5, mode: 'normal', fence: 'absent' })
        })

        test('a marker of another owner over a current is still a normal boot', async () => {
            const key = keyOf({ current: MANIFEST, staging: staging('bulk', OTHER) })

            expect(classifyBoot(inputOf({ commit: parsed(key), tree: await okTree() })).row).toBe(5)
        })

        test('a parsable fence is a normal boot that carries the fence state', async () => {
            const fence: FenceVerdict = { state: 'fenced', keys: new Set(['store2/u-x']), token: { kind: 'bytes', bytes: null } }

            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree: await okTree(), fence }))).toEqual({ row: 5, mode: 'normal', fence: 'fenced' })
        })

        test('an unparsable fence does not stop the boot; the deleters refuse it', async () => {
            const fence: FenceVerdict = { state: 'blocked', reason: 'unparsable', detail: 'crc', token: { kind: 'bytes', bytes: null } }

            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree: await okTree(), fence }))).toMatchObject({ row: 5, fence: 'blocked' })
        })

        test('a current without its tree read is not classified', () => {
            expect(() => classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })) }))).toThrow(TypeError)
        })
    })

    describe('row 6: parsed with a current whose tree does not load', () => {
        test.each([['missing', missingTree], ['damaged', damagedTree]] as const)('a %s tree goes to recovery', (_name, tree) => {
            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree }))).toMatchObject({ row: 6, mode: 'recovery', tree: tree.status, keys: ['store2/x'] })
        })

        test('a backend failure reading the tree is blocked, not recovery', () => {
            const tree: TreeRead = { status: 'unreadable', manifestKey: MANIFEST.key, cause: new Store2BackendFailureError('down') }

            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ current: MANIFEST })), tree }))).toMatchObject({ row: null, mode: 'blocked', reason: 'tree-unreadable' })
        })
    })

    test('row 7: a null current with no marker is recovery, not an empty profile', () => {
        expect(classifyBoot(inputOf({ commit: parsed(keyOf({})) }))).toEqual({ row: 7, mode: 'recovery' })
    })

    test('row 8: a recovery marker is recovery', () => {
        expect(classifyBoot(inputOf({ commit: parsed(keyOf({ staging: staging('recovery') })) }))).toEqual({ row: 8, mode: 'recovery' })
    })

    describe('row 9: re-run', () => {
        test.each([true, false])('a seed marker always re-runs (upstream main file: %s)', (upstreamMainFile) => {
            const decision = classifyBoot(inputOf({ commit: parsed(keyOf({ staging: staging('seed') })), upstreamMainFile }))

            expect(decision).toMatchObject({ row: 9, mode: 'rerun', operation: 'seed' })
        })

        test('a seed marker re-runs even when the main file could not be checked', () => {
            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ staging: staging('seed') })), upstreamMainFile: null }))).toMatchObject({ row: 9 })
        })

        test('a convert marker re-runs only while the old file exists', () => {
            const commit = parsed(keyOf({ staging: staging('convert') }))

            expect(classifyBoot(inputOf({ commit, upstreamMainFile: true }))).toMatchObject({ row: 9, operation: 'convert' })
            expect(classifyBoot(inputOf({ commit, upstreamMainFile: false }))).toEqual({ row: 10, mode: 'recovery' })
        })

        test('a convert marker whose main file could not be checked is blocked', () => {
            expect(classifyBoot(inputOf({ commit: parsed(keyOf({ staging: staging('convert') })), upstreamMainFile: null }))).toMatchObject({ row: null, mode: 'blocked', reason: 'main-file-unknown' })
        })

        test('the device\'s own marker is cleared first, a foreign marker only through the foreign-clear path', () => {
            const own = parsed(keyOf({ staging: staging('seed', OWNER) }))
            const foreign = parsed(keyOf({ staging: staging('seed', OTHER) }))

            expect(classifyBoot(inputOf({ commit: own, deviceOwner: true }))).toMatchObject({ row: 9, clear: 'own' })
            expect(classifyBoot(inputOf({ commit: foreign, deviceOwner: true }))).toMatchObject({ row: 9, clear: 'foreign-path' })
        })

        test('on the web no marker is cleared at start-up, even one carrying this page\'s id', () => {
            const own = parsed(keyOf({ staging: staging('seed', OWNER) }))

            expect(classifyBoot(inputOf({ commit: own, deviceOwner: false }))).toMatchObject({ row: 9, clear: 'foreign-path' })
        })
    })

    test.each(['import', 'restore', 'bulk'] as const)('row 11: a %s marker is recovery', (label) => {
        expect(classifyBoot(inputOf({ commit: parsed(keyOf({ staging: staging(label) })) }))).toEqual({ row: 11, mode: 'recovery', label })
    })

    test('a failed read of the commit key is blocked, never absent or damaged', () => {
        expect(classifyBoot(inputOf({ commit: { status: 'unreadable', reason: 'down' } }))).toEqual({ row: null, mode: 'blocked', reason: 'commit-unreadable', detail: 'down' })
    })
})

describe('store2 presence probe', () => {
    /** A memory backend with one unit, wrapped so the count and the listing can be forced. */
    async function withUnit(faults: { count?: 'zero' | 'fail', list?: 'empty' | 'fail' }): Promise<Store2Backend> {
        const memory = createMemoryBackend()
        await memory.putUnit(newManifestKey(env), encodeUnit(UNIT_TYPE.manifest, {}))
        return {
            ...hooked(memory).backend,
            countPrefix: async (prefix) => {
                if (faults.count === 'fail') {
                    throw new Store2BackendFailureError('count unsupported')
                }
                return faults.count === 'zero' ? 0 : memory.countPrefix(prefix)
            },
            listStore2: async () => {
                if (faults.list === 'fail') {
                    throw new Store2BackendFailureError('list failed')
                }
                return faults.list === 'empty' ? [] : memory.listStore2()
            },
        }
    }

    test('a zero count is confirmed by the listing: a count of 0 with listed keys is some, so no seed', async () => {
        const probe = await probeStore2Presence(await withUnit({ count: 'zero' }))

        expect(probe).toEqual({ status: 'some', via: 'list' })
        expect(classifyBoot(inputOf({ presence: probe }))).toEqual({ row: 2, mode: 'recovery' })
    })

    test('a count above zero is some without a listing', async () => {
        const base = await withUnit({ list: 'fail' })

        expect(await probeStore2Presence(base)).toEqual({ status: 'some', via: 'count' })
    })

    test('an empty store is none, a zero count confirmed by an empty listing', async () => {
        expect(await probeStore2Presence(createMemoryBackend())).toEqual({ status: 'none' })
    })

    test('a count that fails leaves the listing to decide', async () => {
        expect(await probeStore2Presence(await withUnit({ count: 'fail' }))).toEqual({ status: 'some', via: 'list' })
        expect(await probeStore2Presence(await withUnit({ count: 'fail', list: 'empty' }))).toEqual({ status: 'none' })
    })

    test('a failed listing after a zero or failed count is unknown, never none', async () => {
        for (const faults of [{ count: 'zero', list: 'fail' }, { count: 'fail', list: 'fail' }] as const) {
            const probe = await probeStore2Presence(await withUnit(faults))

            expect(probe.status).toBe('unknown')
            expect(classifyBoot(inputOf({ presence: probe, upstreamMainFile: true }))).toMatchObject({ row: 1, mode: 'blocked' })
        }
    })
})

describe('row 9 start-up clear', () => {
    async function plantMarker(backend: Store2Backend, label: StagingLabel, owner: string): Promise<CommitKey> {
        const key = keyOf({ staging: staging(label, owner) })
        await plantKey(backend, key)
        return key
    }

    async function classifyStored(backend: Store2Backend, deviceOwner: boolean): Promise<ReturnType<typeof classifyBoot>> {
        const commit = classifyCommitRead(await backend.readCommit())
        return classifyBoot(inputOf({ commit, deviceOwner, upstreamMainFile: false }))
    }

    test('the device\'s own marker is cleared back to exactly what was read minus staging, and a crash after that lands in row 7', async () => {
        const backend = createMemoryBackend()
        const before = await plantMarker(backend, 'seed', OWNER)
        const decision = await classifyStored(backend, true)
        const committer = committerOf(backend, clock, 3, { owner: OWNER })

        const cleared = await runBootClear(committer, await backend.readCommit(), decision, OWNER)

        expect(cleared?.status).toBe('cleared')
        const after = await parsedCommit(backend)
        expect(after.staging).toBeNull()
        expect(after.current).toBeNull()
        expect({ ...after, seq: 0, epoch: '' }).toEqual({ ...before, staging: null, seq: 0, epoch: '' })
        expect(after.seq).toBe(before.seq + 1)
        // The re-run did not happen yet: a reload now finds no marker and no current.
        expect(await classifyStored(backend, true)).toEqual({ row: 7, mode: 'recovery' })
    })

    test('a seed marker re-runs again after the clear, with no upstream file', async () => {
        const backend = createMemoryBackend()
        await plantMarker(backend, 'seed', OWNER)

        expect(await classifyStored(backend, true)).toMatchObject({ row: 9, operation: 'seed', clear: 'own' })
    })

    test('a foreign marker and a web page\'s marker are left standing', async () => {
        const backend = createMemoryBackend()
        const before = await plantMarker(backend, 'seed', OTHER)
        const committer = committerOf(backend, clock, 4, { owner: OWNER })

        for (const deviceOwner of [true, false]) {
            const decision = await classifyStored(backend, deviceOwner)
            expect(await runBootClear(committer, await backend.readCommit(), decision, OWNER)).toBeNull()
        }
        expect(await parsedCommit(backend)).toEqual(before)
    })

    test('a read whose marker is another owner\'s is never cleared, even under an own-clear decision', async () => {
        const backend = createMemoryBackend()
        const own = await plantMarker(backend, 'seed', OWNER)
        const ownDecision = await classifyStored(backend, true)
        const before = await plantMarker(backend, 'seed', OTHER)
        const committer = committerOf(backend, clock, 6, { owner: OWNER })

        expect(ownDecision).toMatchObject({ row: 9, clear: 'own' })
        expect(own.staging?.owner).toBe(OWNER)
        expect(await runBootClear(committer, await backend.readCommit(), ownDecision, OWNER)).toBeNull()
        expect(await parsedCommit(backend)).toEqual(before)
    })

    test('a decision other than row 9 clears nothing', async () => {
        const backend = createMemoryBackend()
        const before = await plantMarker(backend, 'import', OWNER)
        const committer = committerOf(backend, clock, 5, { owner: OWNER })

        const result = await runBootClear(committer, await backend.readCommit(), await classifyStored(backend, true), OWNER)

        expect(result).toBeNull()
        expect(await parsedCommit(backend)).toEqual(before)
    })
})
