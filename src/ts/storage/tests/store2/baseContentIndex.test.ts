// @vitest-environment node
/**
 * The base content index (`baseContent.ts`, NEW-import-dedup stage 1): which units of the stored tree an import may take
 * by content, and that no problem in the base makes the build refuse. Producer: the real `importLegacyTree` of a golden
 * `.bin` over a memory backend, so the stored tree is what an import writes. Every test asserts the new builder, which
 * does not exist before the change: they are guards of the new rule.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

/** `refsOf` of one unit type fails with the `TypeError` a stored body with a malformed reference raises. */
const refsFault = vi.hoisted(() => ({ type: null as number | null }))
vi.mock(import('src/ts/storage/store2/format/refsOf'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        refsOf: (type: Parameters<typeof original.refsOf>[0], body: object) => {
            if (refsFault.type === type) {
                throw new TypeError('malformed reference')
            }
            return original.refsOf(type, body)
        },
    }
})

import {
    createMemoryBackend, Store2BackendFailureError, Store2NotBinaryError, type MemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { readBaseContentIndex, type BaseContentIndex, type BaseContentOptions } from 'src/ts/storage/store2/baseContent'
import {
    decodeFrame, FRAME_OVERHEAD, keyOfTail, readUnit, refsOf, UNIT_TYPE, type Manifest, type RefTarget, type UnitType,
} from 'src/ts/storage/store2/format'
import { LegacyListBuilder } from 'src/ts/storage/store2/lists/legacyList'
import { importLegacyTree, type ImportOutcome, type ImportRequest } from 'src/ts/storage/store2/legacy/importTree'
import { TREE_READ_TYPES } from 'src/ts/storage/store2/tree'
import { committerOf, createClock, parsedCommit, plantKey, seedStore, testEnv } from './commitFixtures'
import { fakeLists } from './codecFixtures'
import { FULL_GOLDENS, loadGolden, readerOver } from './legacyFixtures'

const OPTIONS = { newId: () => 'placeholder-chat-id', now: () => 1_700_000_000_001 }
const accept = { async confirmIncomplete() { return true } }
const NOT_INDEXED: readonly UnitType[] = [UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.order, UNIT_TYPE.legacyList]
const PARENTS: readonly UnitType[] = [UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.moduleBucket, UNIT_TYPE.pluginStorageBucket]

afterEach(() => {
    refsFault.type = null
    vi.restoreAllMocks()
})

interface Base {
    memory: MemoryBackend
    /** The seed manifest the import replaced; its units are named by no manifest of the imported tree. */
    seed: string
    /** The manifest the import made current. */
    from: string
}

/** A store whose current tree is the import of `golden`, with a legacy keep list so that unit type is stored too. */
async function importedBase(name: string): Promise<Base> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const seed = await seedStore(memory, testEnv(clock, 1))
    const committer = committerOf(memory, clock, 100)
    clock.advance(1000)
    const golden = await loadGolden(name)
    const list = new LegacyListBuilder()
    list.addUnreadable('database/database.bin')
    const request: ImportRequest = {
        source: { tree: golden.tree },
        reader: readerOver(golden.units),
        committer,
        backend: memory,
        lists: fakeLists,
        env: testEnv(clock, 300),
        resolve: OPTIONS,
        legacyKeep: list.build(),
    }
    const outcome: ImportOutcome = await importLegacyTree(request, accept)
    expect(outcome.status).toBe('committed')
    const current = (await parsedCommit(memory)).current
    if (current === null) {
        throw new Error('The import left no current manifest.')
    }
    return { memory, seed, from: current.key }
}

function bodyOf(memory: MemoryBackend, key: string, type: UnitType): object {
    const parsed = readUnit(memory.snapshot().get(key) as Uint8Array, type)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error(`${key} does not read as ${type}.`)
    }
    return parsed.value.body
}

/** Every unit key the manifest and its parents name, with the position's parent type; the order unit and the legacy keep are left out as the index leaves them. */
function named(memory: MemoryBackend, manifestKey: string): { key: string, path: string, parent: UnitType | null, children: string[] }[] {
    const out: { key: string, path: string, parent: UnitType | null, children: string[] }[] = []
    const keyOf = (target: RefTarget): string => keyOfTail(target.tail)
    for (const target of refsOf(UNIT_TYPE.manifest, bodyOf(memory, manifestKey, UNIT_TYPE.manifest))) {
        if (target.path === 'fixed.order' || target.path === 'fixed.legacyKeep.unit') {
            continue
        }
        const type = TREE_READ_TYPES[target.path]
        const parent = type !== undefined && PARENTS.includes(type) ? type : null
        const children = parent === null ? [] : refsOf(parent, bodyOf(memory, keyOf(target), parent)).map(keyOf)
        out.push({ key: keyOf(target), path: target.path, parent, children })
    }
    return out
}

function expectedKeys(memory: MemoryBackend, manifestKey: string): string[] {
    const keys = new Set<string>()
    for (const position of named(memory, manifestKey)) {
        keys.add(position.key)
        position.children.forEach(child => keys.add(child))
    }
    return [...keys].filter((key) => {
        const frame = decodeFrame(memory.snapshot().get(key) as Uint8Array)
        return frame.status === 'ok' && !NOT_INDEXED.includes(frame.type)
    })
}

function indexed(index: BaseContentIndex): string[] {
    return [...index.units.values()].flatMap(list => list.map(unit => unit.key))
}

function walkOf(index: BaseContentIndex): [string, string[]][] {
    return [...index.units.entries()].map(([digest, list]) => [digest, list.map(unit => unit.key)])
}

function typeOfKey(memory: MemoryBackend, key: string): UnitType {
    const frame = decodeFrame(memory.snapshot().get(key) as Uint8Array)
    if (frame.status !== 'ok') {
        throw new Error(`${key} is not a frame.`)
    }
    return frame.type
}

async function indexOf(base: Base, backend: Store2Backend = base.memory, options: BaseContentOptions = {}): Promise<BaseContentIndex> {
    return readBaseContentIndex(backend, await base.memory.readCommit(), options)
}

describe.each(FULL_GOLDENS)('guard (new rule): the index of an imported tree (%s)', (name) => {
    test('holds exactly the units the current manifest names, once each, by the digest of the stored bytes, and never a manifest, shard, order or legacy list', async () => {
        const base = await importedBase(name)
        const index = await indexOf(base)
        const stored = base.memory.snapshot()

        expect(index.from).toBe(base.from)
        expect(index.stats.skipped).toBe(0)
        expect(index.stats.backendError).toBe(false)
        const keys = indexed(index)
        expect(new Set(keys).size).toBe(keys.length)
        expect([...keys].sort()).toEqual(expectedKeys(base.memory, base.from).sort())
        expect(index.stats.units).toBe(keys.length)
        expect(index.stats.bytes).toBe(keys.reduce((sum, key) => sum + (stored.get(key) as Uint8Array).length, 0))
        for (const [digest, list] of index.units) {
            for (const unit of list) {
                const bytes = stored.get(unit.key) as Uint8Array
                expect(unit.digest).toBe(digest)
                expect(digest).toBe(unitDigest(bytes))
                expect(unit.type).toBe(typeOfKey(base.memory, unit.key))
                expect(unit.ref).toEqual([unit.key.slice('store2/'.length), bytes.length, unit.ref[2]])
                expect(NOT_INDEXED).not.toContain(unit.type)
            }
        }

        // The exclusions bite only if the stored tree holds those units.
        const manifest = bodyOf(base.memory, base.from, UNIT_TYPE.manifest) as Manifest
        expect(manifest.shards.length).toBeGreaterThan(0)
        expect(manifest.fixed.legacyKeep).toBeDefined()
        expect(keys).not.toContain(keyOfTail(manifest.fixed.order[0]))
        expect(keys).not.toContain(keyOfTail(manifest.fixed.legacyKeep!.unit[0]))
        for (const shard of manifest.shards) {
            expect(keys).not.toContain(keyOfTail(shard[0]))
        }
        // The parents the walk reads are indexed as units of their own.
        expect(keys).toContain(keyOfTail(manifest.fixed.moduleIndex[0]))
    })

    test('the walk order is the same on every build and for every batch size', async () => {
        const base = await importedBase(name)
        const first = walkOf(await indexOf(base))
        expect(walkOf(await indexOf(base))).toEqual(first)
        expect(walkOf(await indexOf(base, base.memory, { batchKeys: 3 }))).toEqual(first)
        expect(walkOf(await indexOf(base, base.memory, { batchBytes: 1 }))).toEqual(first)
    })

    test('walks only `current`: a retained or pinned manifest\'s own units never enter the index', async () => {
        const base = await importedBase(name)
        const commit = await parsedCommit(base.memory)
        await plantKey(base.memory, {
            ...commit,
            retained: [{ key: base.seed, at: 1 }],
            pins: [{ key: base.seed, reason: 'pinned for the test' }],
        })
        // The import may share units with the seed by content; only the units the seed alone names can show the walk's scope.
        const named = new Set(expectedKeys(base.memory, base.from))
        const seedKeys = expectedKeys(base.memory, base.seed).filter(key => !named.has(key))
        expect(seedKeys.length).toBeGreaterThan(0)

        const index = await indexOf(base)

        expect(index.from).toBe(base.from)
        for (const key of indexed(index)) {
            expect(named.has(key), `${key} is named by the current tree`).toBe(true)
        }
        for (const key of seedKeys) {
            expect(indexed(index)).not.toContain(key)
        }
    })
})

describe('guard (new rule): a problem in the base removes candidates and nothing else (I6)', () => {
    const NAME = 'upstream-full.bin'

    async function damaged(change: (base: Base, expected: string[]) => string[]): Promise<{ index: BaseContentIndex, lost: string[], expected: string[], base: Base }> {
        const base = await importedBase(NAME)
        const expected = expectedKeys(base.memory, base.from)
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const lost = change(base, expected)
        return { index: await indexOf(base), lost, expected, base }
    }

    function keyOfType(base: Base, expected: string[], type: UnitType, skip = 0): string {
        const key = expected.filter(candidate => typeOfKey(base.memory, candidate) === type)[skip]
        if (key === undefined) {
            throw new Error(`The stored tree holds no ${type} unit.`)
        }
        return key
    }

    test('an absent leaf is skipped, counted, and every other unit is indexed', async () => {
        const { index, lost, expected } = await damaged((base, keys) => {
            const key = keyOfType(base, keys, UNIT_TYPE.characterCore)
            base.memory.poke(key, null)
            return [key]
        })
        expect(index.stats.skipped).toBe(1)
        expect(indexed(index).sort()).toEqual(expected.filter(key => !lost.includes(key)).sort())
    })

    test('a leaf that is another valid unit (its Ref length or CRC does not match) is skipped, not indexed under the wrong key', async () => {
        const { index, lost, expected } = await damaged((base, keys) => {
            const key = keyOfType(base, keys, UNIT_TYPE.characterCore)
            const other = keys.find(candidate => typeOfKey(base.memory, candidate) === UNIT_TYPE.chatChunk) as string
            base.memory.poke(key, base.memory.snapshot().get(other) as Uint8Array)
            return [key]
        })
        expect(index.stats.skipped).toBe(1)
        expect(indexed(index)).not.toContain(lost[0])
        expect(indexed(index).sort()).toEqual(expected.filter(key => !lost.includes(key)).sort())
    })

    test('a leaf with the right length and a damaged payload is skipped', async () => {
        const { index, lost, expected } = await damaged((base, keys) => {
            const key = keyOfType(base, keys, UNIT_TYPE.characterCore)
            const bytes = new Uint8Array(base.memory.snapshot().get(key) as Uint8Array)
            bytes[FRAME_OVERHEAD - 4] ^= 0xff
            base.memory.poke(key, bytes)
            return [key]
        })
        expect(index.stats.skipped).toBe(1)
        expect(indexed(index).sort()).toEqual(expected.filter(key => !lost.includes(key)).sort())
    })

    test('a shard that does not read is skipped with the units only it names', async () => {
        const { index, lost, expected, base } = await damaged((base, keys) => {
            const shards = named(base.memory, base.from).filter(position => position.parent === UNIT_TYPE.shard)
            expect(shards.length).toBeGreaterThan(0)
            // Most shards of a small profile hold nothing: take the fullest.
            const fullest = shards.reduce((best, position) => position.children.length > best.children.length ? position : best)
            const others = new Set(shards.filter(position => position !== fullest).flatMap(position => position.children))
            base.memory.poke(fullest.key, new Uint8Array([1, 2, 3]))
            return fullest.children.filter(child => !others.has(child) && keys.includes(child))
        })
        expect(lost.length).toBeGreaterThan(0)
        expect(index.stats.skipped).toBeGreaterThanOrEqual(1)
        expect(indexed(index).sort()).toEqual(expected.filter(key => !lost.includes(key)).sort())
        expect(base.from).toBe(index.from)
    })

    test('a module index that does not read is skipped and not indexed, and the rest is', async () => {
        const { index, expected, base } = await damaged((base) => {
            const root = named(base.memory, base.from).find(position => position.path === 'fixed.moduleIndex')
            expect(root).toBeDefined()
            base.memory.poke(root!.key, new Uint8Array([9, 9, 9, 9]))
            return [root!.key, ...root!.children]
        })
        expect(index.stats.skipped).toBeGreaterThanOrEqual(1)
        const keys = indexed(index)
        expect(keys.length).toBeGreaterThan(0)
        expect(keys.length).toBeLessThan(expected.length)
        expect(index.from).toBe(base.from)
    })

    test('a parent whose references are malformed (refsOf throws a TypeError) is skipped, counted, and does not throw', async () => {
        const base = await importedBase(NAME)
        const expected = expectedKeys(base.memory, base.from)
        const shards = named(base.memory, base.from).filter(position => position.parent === UNIT_TYPE.shard)
        const lost = new Set(shards.flatMap(position => position.children))
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        refsFault.type = UNIT_TYPE.shard

        const index = await indexOf(base)

        expect(index.stats.skipped).toBe(shards.length)
        expect(lost.size).toBeGreaterThan(0)
        expect(indexed(index).sort()).toEqual(expected.filter(key => !lost.has(key)).sort())
    })
})

describe('guard (new rule): no usable base is an empty index, never a throw (I6)', () => {
    test('an absent commit key, a damaged one and one that names no current give an empty index with no from', async () => {
        const absent = createMemoryBackend()
        const none = await readBaseContentIndex(absent, await absent.readCommit())
        expect([none.from, none.units.size, none.stats.units]).toEqual([null, 0, 0])

        const base = await importedBase('fork-full.bin')
        expect((await readBaseContentIndex(base.memory, { bytes: new Uint8Array([1, 2, 3]) })).from).toBeNull()

        const commit = await parsedCommit(base.memory)
        await plantKey(base.memory, { ...commit, current: null })
        const noCurrent = await indexOf(base)
        expect([noCurrent.from, noCurrent.units.size]).toEqual([null, 0])
    })

    test('an absent or damaged current manifest, or one whose references are malformed, gives an empty index', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const absent = await importedBase('fork-full.bin')
        absent.memory.poke(absent.from, null)
        expect(await indexOf(absent)).toMatchObject({ from: null, stats: { units: 0 } })

        const broken = await importedBase('fork-full.bin')
        broken.memory.poke(broken.from, new Uint8Array([5, 5, 5, 5]))
        expect(await indexOf(broken)).toMatchObject({ from: null, stats: { units: 0 } })

        const malformed = await importedBase('fork-full.bin')
        refsFault.type = UNIT_TYPE.manifest
        expect(await indexOf(malformed)).toMatchObject({ from: null, stats: { units: 0 } })
    })

    function reading(inner: MemoryBackend, onRead: (keys: readonly string[], call: number) => void): Store2Backend {
        let call = 0
        return {
            ...inner,
            readUnits: async (keys) => {
                onRead(keys, ++call)
                return inner.readUnits(keys)
            },
        }
    }

    test('a backend failure in a late read ends the walk and keeps what was indexed', async () => {
        const base = await importedBase('upstream-full.bin')
        const full = await indexOf(base)
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        let reads = 0
        await indexOf(base, reading(base.memory, () => { reads++ }), { batchKeys: 4 })
        // The shards come first and index nothing themselves, so the failure is the second read from the last.
        const failing = reading(base.memory, (_keys, call) => {
            if (call === reads - 1) {
                throw new Store2BackendFailureError('injected')
            }
        })

        const partial = await indexOf(base, failing, { batchKeys: 4 })

        expect(partial.from).toBe(base.from)
        expect(partial.stats.backendError).toBe(true)
        expect(partial.stats.units).toBeGreaterThan(0)
        expect(partial.stats.units).toBeLessThan(full.stats.units)
        // What it did index is a prefix of the full walk.
        const fullKeys = indexed(full)
        for (const key of indexed(partial)) {
            expect(fullKeys).toContain(key)
        }
    })

    test('a backend failure on the manifest read gives an empty index', async () => {
        const base = await importedBase('fork-full.bin')
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const failing = reading(base.memory, () => { throw new Store2BackendFailureError('injected') })
        expect(await indexOf(base, failing)).toMatchObject({ from: null, stats: { units: 0, backendError: true } })
    })

    test('an error that is not a backend error is a programming error and propagates', async () => {
        const base = await importedBase('fork-full.bin')
        const failing = reading(base.memory, (_keys, call) => {
            if (call === 2) {
                throw new TypeError('a bug')
            }
        })
        await expect(indexOf(base, failing)).rejects.toThrow(TypeError)
    })

    test('a batch with a non-binary entry is read again key by key, so only that entry is lost', async () => {
        const base = await importedBase('upstream-full.bin')
        const full = await indexOf(base)
        const bad = keyOfTypeIn(full, base.memory, UNIT_TYPE.chatChunk)
        vi.spyOn(console, 'warn').mockImplementation(() => { })
        const notBinary = reading(base.memory, (keys) => {
            if (keys.includes(bad)) {
                throw new Store2NotBinaryError(bad)
            }
        })

        const index = await indexOf(base, notBinary)

        expect(index.stats.backendError).toBe(false)
        expect(index.stats.skipped).toBe(1)
        expect(indexed(index).sort()).toEqual(indexed(full).filter(key => key !== bad).sort())
    })

    function keyOfTypeIn(index: BaseContentIndex, memory: MemoryBackend, type: UnitType): string {
        const key = indexed(index).find(candidate => typeOfKey(memory, candidate) === type)
        if (key === undefined) {
            throw new Error(`The index holds no ${type} unit.`)
        }
        return key
    }
})

describe('guard (new rule): the walk reads in bounded batches and yields between them', () => {
    test('a read holds at most the key count and, past one key, the summed length the options name; the index does not change', async () => {
        const base = await importedBase('upstream-full.bin')
        const stored = base.memory.snapshot()
        const reads: string[][] = []
        let yields = 0
        const watching: Store2Backend = {
            ...base.memory,
            readUnits: async (keys) => {
                reads.push([...keys])
                return base.memory.readUnits(keys)
            },
        }

        const bounded = await indexOf(base, watching, { batchKeys: 7, batchBytes: 1500, yieldFn: async () => { yields++ } })

        expect(walkOf(bounded)).toEqual(walkOf(await indexOf(base)))
        // The first read is the manifest.
        const batches = reads.slice(1)
        expect(batches.length).toBeGreaterThan(Math.ceil(bounded.stats.units / 7))
        for (const batch of batches) {
            expect(batch.length).toBeLessThanOrEqual(7)
            if (batch.length > 1) {
                expect(batch.reduce((sum, key) => sum + (stored.get(key) as Uint8Array).length, 0)).toBeLessThanOrEqual(1500)
            }
        }
        expect(yields).toBe(batches.length)
    })
})
