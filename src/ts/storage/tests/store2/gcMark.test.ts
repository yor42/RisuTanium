// @vitest-environment node
/**
 * The GC mark: the live set is every manifest the commit key names plus every
 * unit those manifests, shards, the module index and the plugin-storage buckets
 * name, from one validated read of each node; the closure it returns is the one
 * the deleter gate takes.
 */
import { describe, expect, test } from 'vitest'
import { crc32 } from 'src/ts/storage/blockFrame'
import { Store2BackendFailureError, createMemoryBackend, type Store2Backend, type Store2Read } from 'src/ts/storage/store2/backend'
import { evaluateDeleterGate } from 'src/ts/storage/store2/boot'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { readFenceVerdict } from 'src/ts/storage/store2/fence'
import {
    encodeUnit, keyOfTail, newManifestKey, newShardKey, newUnitKey, refOfFrame, REFS_TABLE, UNIT_TYPE,
    type KeyEnv, type ListRef, type Manifest, type Ref, type RefRow, type UnitType,
} from 'src/ts/storage/store2/format'
import { markLiveKeys, type MarkResult } from 'src/ts/storage/store2/gc/mark'
import { readTree } from 'src/ts/storage/store2/tree'
import { createClock, hooked, testEnv } from './commitFixtures'

interface Fx {
    backend: Store2Backend
    env: KeyEnv
}

function newFx(seed: number): Fx {
    return { backend: createMemoryBackend(), env: testEnv(createClock(), seed) }
}

async function leaf(fx: Fx, type: UnitType, body: object): Promise<{ key: string, ref: Ref }> {
    const key = newUnitKey(fx.env)
    const bytes = encodeUnit(type, body)
    await fx.backend.putUnit(key, bytes)
    return { key, ref: refOfFrame(key, bytes) }
}

const asList = (ref: Ref): ListRef => [ref[0], ref[1], ref[2], 1]

/** The structural nodes a later tree may reuse from an earlier one. */
interface Shared {
    shard: Ref
    moduleIndex: Ref
    bucket: Ref
}

interface BuiltTree {
    manifestKey: string
    shared: Shared
    /** The chat chunk and the preset only this tree names. */
    chunk: string
    preset: string
}

interface BuildOptions {
    tag: string
    shared?: Partial<Shared>
    configAlBody?: object
    /** Receives the key reachable only through the row `${type}:${path}`. */
    track?: (type: UnitType, path: string, key: string) => void
}

/** A complete tree whose every reference position holds a distinct unit. */
async function buildTree(fx: Fx, options: BuildOptions): Promise<BuiltTree> {
    const { tag } = options
    const note = options.track ?? (() => {})
    const put = async (type: UnitType, path: string, bodyType: UnitType, body: object = { v: 1, tag, path }): Promise<Ref> => {
        const made = await leaf(fx, bodyType, body)
        note(type, path, made.key)
        return made.ref
    }
    const M = UNIT_TYPE.manifest
    const S = UNIT_TYPE.shard
    const I = UNIT_TYPE.moduleIndex
    const B = UNIT_TYPE.pluginStorageBucket

    const shardKey = newShardKey(fx.env)
    let shardRef = options.shared?.shard
    let chunkKey = ''
    if (shardRef === undefined) {
        const entry = {
            u: `u-${tag}`, type: 'character', name: 'n', chaId: 'x', creatorNotes: '', chatPage: 0, firstMsgIndex: 0, dsp: false,
            core: await put(S, 'entries[].core', UNIT_TYPE.characterCore),
            lore: await put(S, 'entries[].lore', UNIT_TYPE.lore),
            scripts: await put(S, 'entries[].scripts', UNIT_TYPE.scripts),
            al: asList(await put(S, 'entries[].al', UNIT_TYPE.assetList, { v: 1, h: '', l: [] })),
            il: asList(await put(S, 'entries[].il', UNIT_TYPE.inlayList, { v: 1, u: [], h: '', o: [] })),
            chats: [{
                cid: 'c1',
                core: await put(S, 'entries[].chats[].core', UNIT_TYPE.chatCore),
                chunks: [[...await put(S, 'entries[].chats[].chunks[]', UNIT_TYPE.chatChunk, { v: 1, msgs: [], tag }), 0]],
                alt: [[...await put(S, 'entries[].chats[].alt[]', UNIT_TYPE.chatAlt, { v: 1, recs: [{ m: { role: 'char', data: tag }, p: null, a: 1 }], tag }), 1]],
            }],
        }
        chunkKey = keyOfTail(entry.chats[0].chunks[0][0] as string)
        const bytes = encodeUnit(UNIT_TYPE.shard, { v: 1, entries: [entry] })
        await fx.backend.putUnit(shardKey, bytes)
        shardRef = refOfFrame(shardKey, bytes)
    }

    let moduleRef = options.shared?.moduleIndex
    if (moduleRef === undefined) {
        const index = {
            v: 1,
            entries: [{
                id: `m-${tag}`,
                unit: await put(I, 'entries[].unit', UNIT_TYPE.module),
                al: asList(await put(I, 'entries[].al', UNIT_TYPE.assetList, { v: 1, h: '', l: [] })),
                il: asList(await put(I, 'entries[].il', UNIT_TYPE.inlayList, { v: 1, u: [], h: '', o: [] })),
                name: 'n', description: 'd', hasToggle: false, dsp: false,
            }],
        }
        moduleRef = (await leaf(fx, UNIT_TYPE.moduleIndex, index)).ref
    }

    let bucketRef = options.shared?.bucket
    if (bucketRef === undefined) {
        const value = await put(B, 'entries[].ref', UNIT_TYPE.pluginStorageValue)
        bucketRef = (await leaf(fx, UNIT_TYPE.pluginStorageBucket, { v: 1, entries: [{ k: 'a', ref: value }] })).ref
    }

    const preset = await put(M, 'fixed.presets[]', UNIT_TYPE.preset)
    const body: Manifest = {
        fmt: 1,
        req: [],
        seq: 1,
        createdAt: 1,
        shardCount: 1,
        shards: [shardRef],
        fixed: {
            config: await put(M, 'fixed.config', UNIT_TYPE.configRoot),
            configAl: asList(await put(M, 'fixed.configAl', UNIT_TYPE.assetList, options.configAlBody ?? { v: 1, h: '', l: [] })),
            il: asList(await put(M, 'fixed.il', UNIT_TYPE.inlayList, { v: 1, u: [], h: '', o: [] })),
            statics: await put(M, 'fixed.statics', UNIT_TYPE.statics),
            order: await put(M, 'fixed.order', UNIT_TYPE.order),
            loadouts: await put(M, 'fixed.loadouts', UNIT_TYPE.loadouts),
            moduleIndex: moduleRef,
            presets: [preset],
            plugins: [await put(M, 'fixed.plugins[]', UNIT_TYPE.plugin)],
            pluginStorage: { buckets: 1, refs: [bucketRef] },
            legacyKeep: {
                unit: await put(M, 'fixed.legacyKeep.unit', UNIT_TYPE.legacyList, {
                    v: 1, iv: 1, files: [], h: '', l: [], i: { v: 1, u: [], h: '', o: [] },
                }),
                v: 1,
                files: [{ key: 'database/database.bin', status: 'ok' }],
            },
        },
    }
    const manifestKey = newManifestKey(fx.env)
    await fx.backend.putUnit(manifestKey, encodeUnit(UNIT_TYPE.manifest, body))
    note(M, 'shards[]', keyOfTail(shardRef[0]))
    note(M, 'fixed.moduleIndex', keyOfTail(moduleRef[0]))
    note(M, 'fixed.pluginStorage.refs[]', keyOfTail(bucketRef[0]))
    return {
        manifestKey,
        shared: { shard: shardRef, moduleIndex: moduleRef, bucket: bucketRef },
        chunk: chunkKey,
        preset: keyOfTail(preset[0]),
    }
}

async function publish(fx: Fx, change: { current: string | null, retained?: string[], pins?: string[] }): Promise<Store2Read> {
    const key = firstCommitKey({
        current: change.current === null ? null : { key: change.current, at: 1 },
        retained: (change.retained ?? []).map(retained => ({ key: retained, at: 1 })),
        pins: (change.pins ?? []).map(pin => ({ key: pin, reason: 'test' })),
        staging: null,
    }, fx.env)
    await fx.backend.casCommit((await fx.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
    return fx.backend.readCommit()
}

interface World {
    fx: Fx
    read: Store2Read
    current: BuiltTree
    retained: BuiltTree
    pinned: BuiltTree
    /** The key reachable only through each reference row. */
    tracked: Map<string, string>
}

/** `current` is the full tree; `retained` and `pinned` each own a shard, chunk and preset, and share the other nodes with `current`. */
async function buildWorld(seed: number): Promise<World> {
    const fx = newFx(seed)
    const tracked = new Map<string, string>()
    const current = await buildTree(fx, { tag: 'current', track: (type, path, key) => tracked.set(`${type}:${path}`, key) })
    const retained = await buildTree(fx, { tag: 'retained', shared: { moduleIndex: current.shared.moduleIndex, bucket: current.shared.bucket } })
    const pinned = await buildTree(fx, { tag: 'pinned' })
    tracked.set(`${UNIT_TYPE.commit}:current.key`, current.manifestKey)
    tracked.set(`${UNIT_TYPE.commit}:retained[].key`, retained.manifestKey)
    tracked.set(`${UNIT_TYPE.commit}:pins[].key`, pinned.manifestKey)
    const read = await publish(fx, { current: current.manifestKey, retained: [retained.manifestKey], pins: [pinned.manifestKey] })
    return { fx, read, current, retained, pinned, tracked }
}

function marked(result: MarkResult): Extract<MarkResult, { status: 'marked' }> {
    if (result.status !== 'marked') {
        throw new Error(`The mark was refused: ${result.reason}: ${result.detail}`)
    }
    return result
}

/** Runs `body` with `rows` removed from (or added to) the one reference table the mark reads, and restores it. */
async function withTable<T>(change: (table: RefRow[]) => void, body: () => Promise<T>): Promise<T> {
    const table = REFS_TABLE as RefRow[]
    const saved = [...table]
    change(table)
    try {
        return await body()
    } finally {
        table.splice(0, table.length, ...saved)
    }
}

describe('live set', () => {
    test('every reference row has a unit reachable only through it', async () => {
        const world = await buildWorld(1)
        for (const row of REFS_TABLE) {
            expect(world.tracked.has(`${row.type}:${row.path}`), `${row.type}:${row.path}`).toBe(true)
        }
    })

    describe('one generated mutant per reference row', () => {
        test.each(REFS_TABLE.map((row, index) => [`${row.type}:${row.path}`, index] as const))('the unit reached only through %s is live, and not live when the row is dropped', async (id, index) => {
            const world = await buildWorld(2)
            const target = world.tracked.get(id) as string

            const whole = marked(await markLiveKeys(world.fx.backend, world.read))
            expect(whole.live.has(target)).toBe(true)

            const mutant = await withTable(table => { table.splice(index, 1) }, () => markLiveKeys(world.fx.backend, world.read))
            expect(mutant.status === 'marked' && mutant.live.has(target)).toBe(false)
        })
    })

    test('a unit named only by a retained manifest, and only by a pinned manifest, is live', async () => {
        const world = await buildWorld(3)

        const { live } = marked(await markLiveKeys(world.fx.backend, world.read))

        expect(live.has(world.retained.manifestKey)).toBe(true)
        expect(live.has(world.pinned.manifestKey)).toBe(true)
        expect(live.has(world.retained.preset)).toBe(true)
        expect(live.has(world.pinned.preset)).toBe(true)
    })

    test('a chat chunk named only through the shard of a retained and of a pinned manifest is live', async () => {
        const world = await buildWorld(4)

        const { live } = marked(await markLiveKeys(world.fx.backend, world.read))

        expect(world.retained.chunk).not.toBe('')
        expect(world.pinned.chunk).not.toBe('')
        expect(live.has(world.retained.chunk)).toBe(true)
        expect(live.has(world.pinned.chunk)).toBe(true)
    })

    test('the tree read keys are a strict subset of the live set, which also holds every leaf', async () => {
        const world = await buildWorld(5)

        const { live } = marked(await markLiveKeys(world.fx.backend, world.read))
        const readKeys = new Set<string>()
        for (const manifest of [world.current, world.retained, world.pinned]) {
            const tree = await readTree(world.fx.backend, manifest.manifestKey)
            expect(tree.status).toBe('ok')
            for (const key of tree.status === 'ok' ? tree.keys : []) {
                readKeys.add(key)
            }
        }

        for (const key of readKeys) {
            expect(live.has(key), key).toBe(true)
        }
        expect(live.size).toBeGreaterThan(readKeys.size)
        expect(readKeys.has(world.current.chunk)).toBe(false)
        expect(live.has(world.current.chunk)).toBe(true)
    })

    test('the live set is exactly the units the world stored', async () => {
        const world = await buildWorld(6)

        const { live } = marked(await markLiveKeys(world.fx.backend, world.read))

        expect([...live].sort()).toEqual((await world.fx.backend.listStore2()).sort())
    })

    test('a manifest named twice is read once, and a shared structural node is read once', async () => {
        const fx = newFx(7)
        const first = await buildTree(fx, { tag: 'a' })
        const second = await buildTree(fx, { tag: 'b', shared: first.shared })
        const read = await publish(fx, { current: first.manifestKey, retained: [second.manifestKey, first.manifestKey], pins: [second.manifestKey] })
        const requested: string[] = []
        const watched = hooked(fx.backend)
        const inner = watched.backend.readUnits
        watched.backend.readUnits = async (keys) => {
            requested.push(...keys)
            return inner(keys)
        }

        const result = marked(await markLiveKeys(watched.backend, read))

        expect(new Set(requested).size).toBe(requested.length)
        expect(watched.count('readUnits')).toBe(2)
        expect(result.closure.map(tree => tree.manifestKey)).toEqual([first.manifestKey, second.manifestKey])
    })

    test('a commit key with no current and no manifests marks nothing and reads nothing', async () => {
        const fx = newFx(8)
        const read = await publish(fx, { current: null })
        const watched = hooked(fx.backend)

        const result = marked(await markLiveKeys(watched.backend, read))

        expect(result.live.size).toBe(0)
        expect(result.closure).toEqual([])
        expect(watched.log).toEqual([])
    })

    test('the result carries the token of the commit-key read it marked from', async () => {
        const world = await buildWorld(9)

        const result = marked(await markLiveKeys(world.fx.backend, world.read))

        expect(result.commitToken).toBe(world.read.token)
        expect(result.commit.current?.key).toBe(world.current.manifestKey)
    })
})

describe('refusals', () => {
    function withCodec(bytes: Uint8Array, codec: number): Uint8Array {
        const out = new Uint8Array(bytes)
        out[6] = codec
        new DataView(out.buffer).setUint32(12, crc32(out.subarray(0, 12)), true)
        return out
    }

    /** Replaces the stored bytes of `key` (a unit is write-once through the API, so the memory backend is rebuilt around the change). */
    async function altered(world: World, key: string, change: (bytes: Uint8Array) => Uint8Array): Promise<Store2Backend> {
        const next = createMemoryBackend()
        for (const stored of await world.fx.backend.listStore2()) {
            const bytes = (await world.fx.backend.readUnits([stored])).get(stored) as Uint8Array
            await next.putUnit(stored, stored === key ? change(bytes) : bytes)
        }
        return next
    }

    test('an unreadable manifest read refuses and reports every manifest unreadable', async () => {
        const world = await buildWorld(10)
        const failing = hooked(world.fx.backend, { before: (name, count) => { if (name === 'readUnits' && count === 1) { throw new Store2BackendFailureError('Injected.') } } })

        const result = await markLiveKeys(failing.backend, world.read)

        expect(result.status === 'refused' && result.reason).toBe('closure-not-ok')
        expect(result.status === 'refused' && result.closure.map(tree => tree.status)).toEqual(['unreadable', 'unreadable', 'unreadable'])
    })

    test('an unreadable structural read refuses', async () => {
        const world = await buildWorld(11)
        const failing = hooked(world.fx.backend, { before: (name, count) => { if (name === 'readUnits' && count === 2) { throw new Store2BackendFailureError('Injected.') } } })

        const result = await markLiveKeys(failing.backend, world.read)

        expect(result.status === 'refused' && result.reason).toBe('closure-not-ok')
        expect(result.status === 'refused' && result.closure.every(tree => tree.status === 'unreadable')).toBe(true)
    })

    test('a missing manifest of a retained commit refuses', async () => {
        const world = await buildWorld(12)
        const backend = createMemoryBackend()
        for (const stored of await world.fx.backend.listStore2()) {
            if (stored !== world.retained.manifestKey) {
                await backend.putUnit(stored, (await world.fx.backend.readUnits([stored])).get(stored) as Uint8Array)
            }
        }

        const result = await markLiveKeys(backend, world.read)

        expect(result.status === 'refused' && result.closure.map(tree => tree.status)).toEqual(['ok', 'missing', 'ok'])
    })

    test.each(['shard', 'moduleIndex', 'bucket'] as const)('a CRC failure in a non-current manifest\'s %s refuses', async (which) => {
        const world = await buildWorld(13)
        const key = which === 'shard' ? keyOfTail(world.pinned.shared.shard[0]) : which === 'moduleIndex' ? keyOfTail(world.pinned.shared.moduleIndex[0]) : keyOfTail(world.pinned.shared.bucket[0])
        const backend = await altered(world, key, bytes => {
            const broken = new Uint8Array(bytes)
            broken[17] ^= 0xFF
            return broken
        })

        const result = await markLiveKeys(backend, world.read)

        expect(result.status === 'refused' && result.reason).toBe('closure-not-ok')
        expect(result.status === 'refused' && result.closure.some(tree => tree.status === 'damaged')).toBe(true)
    })

    test('a too-new shard refuses and the closure says too-new', async () => {
        const world = await buildWorld(14)
        const backend = await altered(world, keyOfTail(world.retained.shared.shard[0]), bytes => withCodec(bytes, 1))

        const result = await markLiveKeys(backend, world.read)

        expect(result.status === 'refused' && result.closure.some(tree => tree.status === 'too-new')).toBe(true)
    })

    test('a too-new manifest refuses', async () => {
        const world = await buildWorld(15)
        const backend = await altered(world, world.pinned.manifestKey, bytes => withCodec(bytes, 1))

        const result = await markLiveKeys(backend, world.read)

        expect(result.status === 'refused' && result.closure.map(tree => tree.status)).toEqual(['ok', 'ok', 'too-new'])
    })

    test('a newer list unit does not refuse and is live by name', async () => {
        const fx = newFx(16)
        const tree = await buildTree(fx, { tag: 'newer', configAlBody: { v: 99, h: '', l: [] } })
        const read = await publish(fx, { current: tree.manifestKey })

        const result = marked(await markLiveKeys(fx.backend, read))

        expect(result.closure.map(entry => entry.status === 'ok' && entry.newerLists.length)).toEqual([1])
        expect([...result.live].sort()).toEqual((await fx.backend.listStore2()).sort())
    })

    test('a body that fails its schema refuses and nothing is marked', async () => {
        const world = await buildWorld(17)
        const key = keyOfTail(world.pinned.shared.moduleIndex[0])
        const backend = await altered(world, key, () => encodeUnit(UNIT_TYPE.moduleIndex, { v: 1, entries: 'not a list' }))

        const result = await markLiveKeys(backend, world.read)

        expect(result.status).toBe('refused')
    })

    test('a reference the table cannot read in a shard body refuses as malformed', async () => {
        const world = await buildWorld(18)

        const result = await withTable(table => { table.push({ type: UNIT_TYPE.shard, path: 'entries[].name', mode: 'ref' }) }, () => markLiveKeys(world.fx.backend, world.read))

        expect(result.status === 'refused' && result.reason).toBe('malformed')
    })

    test('a reference the table cannot read in a manifest refuses as malformed', async () => {
        const world = await buildWorld(19)

        const result = await withTable(table => { table.push({ type: UNIT_TYPE.manifest, path: 'fixed', mode: 'ref' }) }, () => markLiveKeys(world.fx.backend, world.read))

        expect(result.status === 'refused' && result.reason).toBe('malformed')
    })

    test('an absent commit key and a damaged one are refused before any read', async () => {
        const fx = newFx(20)
        const watched = hooked(fx.backend)

        const absent = await markLiveKeys(watched.backend, await fx.backend.readCommit())
        const damaged = await markLiveKeys(watched.backend, { bytes: Uint8Array.from([1, 2, 3]), token: { kind: 'bytes', bytes: null } })

        expect(absent.status === 'refused' && absent.reason).toBe('commit-unusable')
        expect(damaged.status === 'refused' && damaged.reason).toBe('commit-unusable')
        expect(watched.log).toEqual([])
    })
})

describe('the closure is what the deleter gate takes', () => {
    test('an ok tree opens the gate, with the token of the read the mark walked', async () => {
        const world = await buildWorld(21)
        const result = marked(await markLiveKeys(world.fx.backend, world.read))

        const gate = evaluateDeleterGate({
            deleter: 'gc', commit: world.read, fence: await readFenceVerdict(world.fx.backend), idleReason: null, closure: result.closure,
        })

        expect(gate.status).toBe('open')
        expect(gate.status === 'open' && gate.commitToken).toBe(result.commitToken)
    })

    test('a not-ok tree makes the gate refuse with closure-unreadable', async () => {
        const world = await buildWorld(22)
        const backend = createMemoryBackend()
        for (const stored of await world.fx.backend.listStore2()) {
            if (stored !== keyOfTail(world.pinned.shared.shard[0])) {
                await backend.putUnit(stored, (await world.fx.backend.readUnits([stored])).get(stored) as Uint8Array)
            }
        }
        const result = await markLiveKeys(backend, world.read)
        expect(result.status).toBe('refused')

        const gate = evaluateDeleterGate({
            deleter: 'gc', commit: world.read, fence: await readFenceVerdict(backend), idleReason: null, closure: result.closure,
        })

        expect(gate.status === 'refused' && gate.reason).toBe('closure-unreadable')
    })
})
