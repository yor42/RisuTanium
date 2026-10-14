// @vitest-environment node
/**
 * The read-only tree read over the memory, IndexedDB (fake-indexeddb) and Node
 * (real server process) backends: which units it reads, how it sorts what it
 * finds (ok, missing, damaged, too new, unreadable) and that it only reads.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { crc32 } from 'src/ts/storage/blockFrame'
import { Store2BackendFailureError, createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import {
    encodeUnit, keyOfTail, newManifestKey, newShardKey, newUnitKey, refOfFrame, UNIT_TYPE, type KeyEnv, type Manifest,
} from 'src/ts/storage/store2/format'
import { readTree, TREE_READ_TYPES } from 'src/ts/storage/store2/tree'
import { buildTree, COMMIT_BACKENDS, createClock, hooked, testEnv, type OpenedBackend } from './commitFixtures'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const opened: OpenedBackend[] = []

afterEach(async () => {
    await Promise.all(opened.splice(0).map(entry => entry.close()))
})

/** The frame with its `codec` byte set and the header checksum recomputed: a valid header of a newer writer. */
function withCodec(bytes: Uint8Array, codec: number): Uint8Array {
    const out = new Uint8Array(bytes)
    out[6] = codec
    new DataView(out.buffer).setUint32(12, crc32(out.subarray(0, 12)), true)
    return out
}

interface Planted {
    manifestKey: string
    manifest: Manifest
    /** The keys the read opens, by name. */
    keys: { shard: string, moduleIndex: string, bucket: string, configAl: string, il: string }
}

/** Plants a complete tree; `override` replaces the bytes of one unit key, and a null replacement leaves that key unwritten. */
async function plantTree(backend: Store2Backend, env: KeyEnv, override: (key: string, bytes: Uint8Array) => Uint8Array | null = (_key, bytes) => bytes): Promise<Planted> {
    const built = buildTree(0, {
        mint: { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) },
        seq: 1,
        now: env.now(),
    }, 'tree')
    const all = [...built.units, { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }]
    for (const unit of all) {
        const bytes = override(unit.key, unit.bytes)
        if (bytes !== null) {
            await backend.putUnit(unit.key, bytes)
        }
    }
    const fixed = built.manifest.body.fixed
    return {
        manifestKey: built.manifest.key,
        manifest: built.manifest.body,
        keys: {
            shard: keyOfTail(built.manifest.body.shards[0][0]),
            moduleIndex: keyOfTail(fixed.moduleIndex[0]),
            bucket: keyOfTail(fixed.pluginStorage.refs[0][0]),
            configAl: keyOfTail(fixed.configAl[0]),
            il: keyOfTail(fixed.il[0]),
        },
    }
}

function envOf(seed: number): KeyEnv {
    return testEnv(createClock(), seed)
}

describe.each(COMMIT_BACKENDS.map(fixture => [fixture.name, fixture] as const))('tree read on the %s backend', (_name, fixture) => {
    async function open(): Promise<Store2Backend> {
        const entry = await fixture.open()
        opened.push(entry)
        return entry.backend
    }

    test('a complete tree is ok and lists the manifest, the shard, the module index, the bucket and both lists', async () => {
        const backend = await open()
        const planted = await plantTree(backend, envOf(1))

        const result = await readTree(backend, planted.manifestKey)

        expect(result.status).toBe('ok')
        if (result.status !== 'ok') {
            return
        }
        expect(result.keys[0]).toBe(planted.manifestKey)
        expect([...result.keys].sort()).toEqual([planted.manifestKey, ...Object.values(planted.keys)].sort())
        expect(result.manifest.seq).toBe(1)
    })

    test('an absent manifest is missing', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(2))
        const planted = await plantTree(backend, envOf(2), (key, bytes) => key === probe.manifestKey ? null : bytes)

        const result = await readTree(backend, planted.manifestKey)

        expect(result).toEqual({ status: 'missing', manifestKey: planted.manifestKey, keys: [planted.manifestKey] })
    })

    test.each(['shard', 'moduleIndex', 'bucket', 'configAl', 'il'] as const)('an absent %s is missing and named', async (which) => {
        const backend = await open()
        const env = envOf(3)
        const probe = await plantTree(createMemoryBackend(), envOf(3))
        const absent = probe.keys[which]
        const planted = await plantTree(backend, env, (key, bytes) => key === absent ? null : bytes)

        const result = await readTree(backend, planted.manifestKey)

        expect(result).toEqual({ status: 'missing', manifestKey: planted.manifestKey, keys: [absent] })
    })

    test('a shard whose bytes are not the ones its referrer holds is damaged', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(4))
        const other = encodeUnit(UNIT_TYPE.shard, { v: 1, entries: [], extra: 'valid frame, other bytes' })
        const planted = await plantTree(backend, envOf(4), (key, bytes) => key === probe.keys.shard ? other : bytes)

        const result = await readTree(backend, planted.manifestKey)

        expect(result.status).toBe('damaged')
        expect(result.status === 'damaged' && result.keys).toEqual([planted.keys.shard])
    })

    test('a unit with a broken payload checksum is damaged, not too new', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(5))
        const planted = await plantTree(backend, envOf(5), (key, bytes) => {
            if (key !== probe.keys.moduleIndex) {
                return bytes
            }
            const broken = new Uint8Array(bytes)
            broken[17] ^= 0xFF
            return broken
        })

        const result = await readTree(backend, planted.manifestKey)

        expect(result.status).toBe('damaged')
        expect(result.status === 'damaged' && result.keys).toEqual([planted.keys.moduleIndex])
    })

    test('a damaged manifest is damaged and nothing else is read', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(6))
        const watched = hooked(backend)
        const planted = await plantTree(backend, envOf(6), (key, bytes) => key === probe.manifestKey ? bytes.slice(0, 10) : bytes)
        watched.log.length = 0

        const result = await readTree(watched.backend, planted.manifestKey)

        expect(result.status).toBe('damaged')
        expect(watched.log).toEqual(['readUnits'])
    })

    test('an unknown codec in a shard is too new, not damaged', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(7))
        const planted = await plantTree(backend, envOf(7), (key, bytes) => key === probe.keys.shard ? withCodec(bytes, 1) : bytes)

        const result = await readTree(backend, planted.manifestKey)

        expect(result.status).toBe('too-new')
        expect(result.status === 'too-new' && result.keys).toEqual([planted.keys.shard])
    })

    test('too new wins over a damaged or absent unit elsewhere in the tree', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(8))
        const planted = await plantTree(backend, envOf(8), (key, bytes) => {
            if (key === probe.keys.shard) {
                return withCodec(bytes, 1)
            }
            if (key === probe.keys.il) {
                return null
            }
            return key === probe.keys.moduleIndex ? bytes.slice(0, 12) : bytes
        })

        const result = await readTree(backend, planted.manifestKey)

        expect(result.status).toBe('too-new')
    })

    test('a manifest with an unknown req token is too new', async () => {
        const backend = await open()
        const probe = await plantTree(createMemoryBackend(), envOf(9))
        const newer = encodeUnit(UNIT_TYPE.manifest, { ...probe.manifest, req: ['x'] })
        const planted = await plantTree(backend, envOf(9), (key, bytes) => key === probe.manifestKey ? newer : bytes)

        const result = await readTree(backend, planted.manifestKey)

        expect(result.status).toBe('too-new')
        expect(result.status === 'too-new' && result.keys).toEqual([planted.manifestKey])
    })

    test('a key that is not a manifest key is damaged without a read', async () => {
        const backend = await open()
        const watched = hooked(backend)

        const result = await readTree(watched.backend, newUnitKey(envOf(10)))

        expect(result.status).toBe('damaged')
        expect(watched.log).toEqual([])
    })
})

describe('tree read behaviour that does not depend on the backend', () => {
    test('it reads in two batches and writes and lists nothing', async () => {
        const memory = createMemoryBackend()
        const planted = await plantTree(memory, envOf(11))
        const watched = hooked(memory)

        await readTree(watched.backend, planted.manifestKey)

        expect(watched.log).toEqual(['readUnits', 'readUnits'])
    })

    test('a backend failure is unreadable, never missing', async () => {
        const memory = createMemoryBackend()
        const planted = await plantTree(memory, envOf(12))
        const failing = hooked(memory, { before: (name, count) => {
            if (name === 'readUnits' && count === 2) {
                throw new Store2BackendFailureError('Injected read failure.')
            }
        } })

        const result = await readTree(failing.backend, planted.manifestKey)

        expect(result.status).toBe('unreadable')
    })

    test('a failure on the manifest read is unreadable', async () => {
        const memory = createMemoryBackend()
        const planted = await plantTree(memory, envOf(13))
        const failing = hooked(memory, { before: () => { throw new Store2BackendFailureError('Injected read failure.') } })

        expect((await readTree(failing.backend, planted.manifestKey)).status).toBe('unreadable')
    })

    test.each([
        ['configAl', UNIT_TYPE.assetList, { v: 99, h: '', l: [] }],
        ['il', UNIT_TYPE.inlayList, { v: 99, u: [], h: '', o: [] }],
    ] as const)('a %s list one version above this build\'s is a readable node, reported in newerLists, not too new', async (which, type, body) => {
        const memory = createMemoryBackend()
        const probe = await plantTree(createMemoryBackend(), envOf(14))
        // The newer writer's manifest names the newer list by its own size and checksum.
        const newer = encodeUnit(type, body)
        const ref = refOfFrame(probe.keys[which], newer)
        const fixed: Manifest['fixed'] = { ...probe.manifest.fixed, [which]: [ref[0], ref[1], ref[2], probe.manifest.fixed[which][3]] }
        const newerManifest = encodeUnit(UNIT_TYPE.manifest, { ...probe.manifest, fixed })
        const planted = await plantTree(memory, envOf(14), (key, bytes) => {
            if (key === probe.keys[which]) {
                return newer
            }
            return key === probe.manifestKey ? newerManifest : bytes
        })

        const result = await readTree(memory, planted.manifestKey)

        expect(result.status).toBe('ok')
        expect(result.status === 'ok' && result.newerLists).toEqual([planted.keys[which]])
    })

    test('a newer list that is not the bytes its referrer holds is damaged', async () => {
        const memory = createMemoryBackend()
        const probe = await plantTree(createMemoryBackend(), envOf(17))
        const planted = await plantTree(memory, envOf(17), (key, bytes) => key === probe.keys.configAl ? encodeUnit(UNIT_TYPE.assetList, { v: 99, h: '', l: [] }) : bytes)

        const result = await readTree(memory, planted.manifestKey)

        expect(result.status).toBe('damaged')
        expect(result.status === 'damaged' && result.keys).toEqual([planted.keys.configAl])
    })

    test('a list of this build\'s version leaves newerLists empty', async () => {
        const memory = createMemoryBackend()
        const planted = await plantTree(memory, envOf(15))

        const result = await readTree(memory, planted.manifestKey)

        expect(result.status === 'ok' && result.newerLists).toEqual([])
    })

    test('a list with an unknown codec is still too new', async () => {
        const memory = createMemoryBackend()
        const probe = await plantTree(createMemoryBackend(), envOf(16))
        const planted = await plantTree(memory, envOf(16), (key, bytes) => key === probe.keys.configAl ? withCodec(bytes, 1) : bytes)

        const result = await readTree(memory, planted.manifestKey)

        expect(result.status).toBe('too-new')
        expect(result.status === 'too-new' && result.keys).toEqual([planted.keys.configAl])
    })

    test('the positions it opens are positions the reference table names', () => {
        expect(Object.keys(TREE_READ_TYPES).sort()).toEqual(['fixed.configAl', 'fixed.il', 'fixed.moduleIndex', 'fixed.pluginStorage.refs[]', 'shards[]'])
    })
})
