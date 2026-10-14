// @vitest-environment node
/**
 * The gate every deleter passes: one test per refusal of "every deleter refuses
 * on ...", the one state in which a fence leaves GC open, and the tokens a batch
 * carries into `removeBatch`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { crc32 } from 'src/ts/storage/blockFrame'
import {
    Store2BackendFailureError, Store2CommitConflictError, Store2FenceConflictError, createMemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { evaluateDeleterGate, openDeleterGate, runBootClear, classifyBoot, type DeleterKind, type GateRefusal, type GateResult } from 'src/ts/storage/store2/boot'
import { classifyCommitRead, firstCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, keyOfTail, newManifestKey, newShardKey, newStagingId, newUnitKey, refOfFrame, stagingPrefix, tailOfKey, UNIT_TYPE, type KeyEnv,
} from 'src/ts/storage/store2/format'
import { readTree, type TreeRead } from 'src/ts/storage/store2/tree'
import { buildTree, committerOf, COMMIT_BACKENDS, createClock, hooked, plantCommit, plantKey, seedStore, START_TIME, testEnv, type OpenedBackend } from './commitFixtures'
import { plantFence } from './fenceFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

const clock = createClock()
const env = testEnv(clock, 91)
const OWNER = 'a'.repeat(26)

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

function withCodec(bytes: Uint8Array, codec: number): Uint8Array {
    const out = new Uint8Array(bytes)
    out[6] = codec
    new DataView(out.buffer).setUint32(12, crc32(out.subarray(0, 12)), true)
    return out
}

function fenceOf(keys: readonly string[]): Uint8Array {
    return encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: START_TIME, priorCommits: [], keys: keys.map(tailOfKey) })
}

const GARBAGE = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 255, 254, 253, 252, 251, 250, 249])

function refusalOf(result: GateResult): GateRefusal | 'open' {
    return result.status === 'open' ? 'open' : result.reason
}

async function openAll(backend: Store2Backend, options: { idleReason?: string | null, closure?: readonly TreeRead[] } = {}): Promise<Record<DeleterKind, GateRefusal | 'open'>> {
    return {
        gc: refusalOf(await openDeleterGate(backend, 'gc', options)),
        sweep: refusalOf(await openDeleterGate(backend, 'sweep', options)),
        'inlay-cleanup': refusalOf(await openDeleterGate(backend, 'inlay-cleanup', options)),
        'manual-cleanup': refusalOf(await openDeleterGate(backend, 'manual-cleanup', options)),
    }
}

function everyDeleter(reason: GateRefusal | 'open'): Record<DeleterKind, GateRefusal | 'open'> {
    return { gc: reason, sweep: reason, 'inlay-cleanup': reason, 'manual-cleanup': reason }
}

describe.each(COMMIT_BACKENDS.map(fixture => [fixture.name, fixture] as const))('deleter gate on the %s backend', (_name, fixture) => {
    async function open(): Promise<Store2Backend> {
        const entry = await fixture.open()
        opened.push(entry)
        return entry.backend
    }

    test('a store in good order is open for every deleter, and GC treats nothing as fenced', async () => {
        const backend = await open()
        await seedStore(backend, env)

        expect(await openAll(backend)).toEqual(everyDeleter('open'))
        const gate = await openDeleterGate(backend, 'gc')
        expect(gate.status === 'open' && gate.liveKeys.size).toBe(0)
    })

    test('every deleter refuses an absent commit key', async () => {
        expect(await openAll(await open())).toEqual(everyDeleter('commit-absent'))
    })

    test('every deleter refuses an unparsable commit key', async () => {
        const backend = await open()
        await seedStore(backend, env)
        await plantCommit(backend, GARBAGE)

        expect(await openAll(backend)).toEqual(everyDeleter('commit-unparsable'))
    })

    test('every deleter refuses a too-new commit key', async () => {
        const backend = await open()
        await seedStore(backend, env)
        const stored = (await backend.readCommit()).bytes as Uint8Array
        await plantCommit(backend, withCodec(stored, 1))

        expect(await openAll(backend)).toEqual(everyDeleter('commit-too-new'))
    })

    test('every deleter refuses a commit key that names no current, GC included', async () => {
        const backend = await open()
        await seedStore(backend, env)
        await plantKey(backend, firstCommitKey({ current: null, staging: null }, env))

        expect(await openAll(backend)).toEqual(everyDeleter('no-current'))
    })

    test.each([
        ['an unparsable', GARBAGE, 'fence-unparsable'],
        ['a too-new', withCodec(fenceOf([]), 1), 'fence-too-new'],
    ] as const)('every deleter, GC included, refuses %s fence', async (_label, bytes, reason) => {
        const backend = await open()
        await seedStore(backend, env)
        await plantFence(backend, bytes)

        expect(await openAll(backend)).toEqual(everyDeleter(reason))
    })

    test('a parsable fence suspends the sweep, the inlay cleanup and manual cleanup and leaves GC open with the fence keys live', async () => {
        const backend = await open()
        await seedStore(backend, env)
        const fencedKey = newUnitKey(env)
        await plantFence(backend, fenceOf([fencedKey]))

        expect(await openAll(backend)).toEqual({ gc: 'open', sweep: 'fenced', 'inlay-cleanup': 'fenced', 'manual-cleanup': 'fenced' })
        const gate = await openDeleterGate(backend, 'gc')
        expect(gate.status === 'open' && [...gate.liveKeys]).toEqual([fencedKey])
        expect(gate.status === 'open' && gate.fence).toBe('fenced')
    })

    test.each(['sweep', 'inlay-cleanup', 'manual-cleanup'] as const)('a standing marker of any owner over a current suspends %s, and GC stays open carrying the marker\'s prefix', async (deleter) => {
        const backend = await open()
        await seedStore(backend, env)
        const parsed = classifyCommitRead(await backend.readCommit())
        if (parsed.status !== 'parsed') {
            throw new Error('The seeded commit key does not parse.')
        }
        const marker = { owner: 'b'.repeat(26), prefix: stagingPrefix(newStagingId(env)), startedAt: START_TIME, label: 'bulk' } as const
        await plantKey(backend, firstCommitKey({ current: parsed.value.current, staging: marker }, env))

        expect(refusalOf(await openDeleterGate(backend, deleter))).toBe('staging')
        const gc = await openDeleterGate(backend, 'gc')
        expect(gc.status === 'open' && gc.commit.staging?.prefix).toBe(marker.prefix)
    })

    test('a tree with a list above this build\'s version does not refuse the gate', async () => {
        const memory = createMemoryBackend()
        const manifestKey = await plantNewerListTree(memory, env)
        await plantKey(memory, firstCommitKey({ current: { key: manifestKey, at: START_TIME }, staging: null }, env))
        const tree = await readTree(memory, manifestKey)

        expect(tree.status).toBe('ok')
        expect(await openAll(memory, { closure: [tree] })).toEqual(everyDeleter('open'))
    })

    test('the gate hands back the tokens a batch carries, and a change after the gate fails the batch', async () => {
        const backend = await open()
        await seedStore(backend, env)
        const orphan = newUnitKey(env)
        await backend.putUnit(orphan, encodeUnit(UNIT_TYPE.preset, { v: 1 }))
        const gate = await openDeleterGate(backend, 'gc')
        if (gate.status !== 'open') {
            throw new Error('The gate is closed.')
        }

        await backend.removeBatch([orphan], gate.commitToken, gate.fenceToken)
        expect((await backend.readUnits([orphan])).get(orphan)).toBeNull()

        const second = newUnitKey(env)
        await backend.putUnit(second, encodeUnit(UNIT_TYPE.preset, { v: 1 }))
        await plantFence(backend, fenceOf([]))
        await expect(backend.removeBatch([second], gate.commitToken, gate.fenceToken)).rejects.toBeInstanceOf(Store2FenceConflictError)
        await plantKey(backend, firstCommitKey({ current: gate.commit.current, staging: null }, env))
        await expect(backend.removeBatch([second], gate.commitToken, gate.fenceToken)).rejects.toBeInstanceOf(Store2CommitConflictError)
        expect((await backend.readUnits([second])).get(second)).not.toBeNull()
    })
})

describe('deleter gate refusals that need an injected state', () => {
    test('every deleter refuses a commit key that cannot be read', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const failing = hooked(memory, { before: (name) => {
            if (name === 'readCommit') {
                throw new Store2BackendFailureError('Injected commit read failure.')
            }
        } })

        expect(await openAll(failing.backend)).toEqual(everyDeleter('commit-unreadable'))
    })

    test('every deleter, GC included, refuses a fence that cannot be read', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const failing = hooked(memory, { before: (name) => {
            if (name === 'readFence') {
                throw new Store2BackendFailureError('Injected fence read failure.')
            }
        } })

        expect(await openAll(failing.backend)).toEqual(everyDeleter('fence-unreadable'))
    })

    test.each(['missing', 'damaged', 'too-new', 'unreadable'] as const)('every deleter refuses when a closure node is %s', async (status) => {
        const memory = createMemoryBackend()
        const manifestKey = await seedStore(memory, env)
        const node: TreeRead = status === 'unreadable'
            ? { status, manifestKey, cause: new Store2BackendFailureError('down') }
            : status === 'missing'
                ? { status, manifestKey, keys: [manifestKey] }
                : status === 'damaged'
                    ? { status, manifestKey, keys: [manifestKey], missing: [], reason: 'bad' }
                    : { status, manifestKey, keys: [manifestKey], reason: 'newer' }

        expect(await openAll(memory, { closure: [node] })).toEqual(everyDeleter('closure-unreadable'))
    })

    test('a closure of ok trees leaves the gate open', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)
        const keys = (await memory.listStore2()).filter(key => key.startsWith('store2/m-'))
        const trees = await Promise.all(keys.map(key => readTree(memory, key)))

        expect(trees.map(tree => tree.status)).toEqual(['ok'])
        expect(await openAll(memory, { closure: trees })).toEqual(everyDeleter('open'))
    })

    test('a session flag keeps every deleter idle whatever the store holds', async () => {
        const memory = createMemoryBackend()
        await seedStore(memory, env)

        expect(await openAll(memory, { idleReason: 'not flushed' })).toEqual(everyDeleter('idle'))
    })

    test('after a start-up clear of a marker the commit key names no current and every deleter refuses', async () => {
        const memory = createMemoryBackend()
        const key = firstCommitKey({ current: null, staging: { owner: OWNER, prefix: stagingPrefix(newStagingId(env)), startedAt: START_TIME, label: 'seed' } }, env)
        await plantKey(memory, key)
        const decision = classifyBoot({
            commit: classifyCommitRead(await memory.readCommit()),
            fence: { state: 'absent', token: { kind: 'bytes', bytes: null } },
            presence: null,
            tree: null,
            upstreamMainFile: false,
            ownerId: OWNER,
            deviceOwner: true,
        })
        const cleared = await runBootClear(committerOf(memory, clock, 8, { owner: OWNER }), await memory.readCommit(), decision, OWNER)

        expect(cleared?.status).toBe('cleared')
        expect(await openAll(memory)).toEqual(everyDeleter('no-current'))
    })

    test('the pure gate reports the first refusal in a fixed order: idle, then the commit key, then the fence', () => {
        const absentFence = { state: 'blocked', reason: 'unparsable', detail: 'x', token: null } as const

        expect(refusalOf(evaluateDeleterGate({ deleter: 'gc', commit: null, fence: absentFence, idleReason: null }))).toBe('commit-unreadable')
        expect(refusalOf(evaluateDeleterGate({ deleter: 'gc', commit: null, fence: absentFence, idleReason: 'x' }))).toBe('idle')
    })
})
