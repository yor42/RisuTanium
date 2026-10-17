// @vitest-environment node
import { beforeAll, describe, expect, test } from 'vitest'
import { crc32 } from 'src/ts/storage/blockFrame'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    createMemoryBackend, Store2BackendFailureError, Store2NotBinaryError,
    type MemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import {
    assembleDatabase, CodecAssembleError, IDENTITY, type EncodedTree, type EncodedUnit, type ListDerivation,
} from 'src/ts/storage/store2/codec'
import { classifyCommitRead, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    ASSET_REF_V, encodeUnit, FRAME_HEADER_BYTES, FRAME_OVERHEAD, IL_REF_V, keyOfRef, readUnit, UNIT_TYPE,
    type KeyEnv, type Manifest, type Ref, type Shard, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import { COMMIT_KEY } from 'src/ts/storage/store2/format/keys'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { CommitKeyRecheckError, readTreeBytes, type FlaggedLeaf } from 'src/ts/storage/store2/treeBytes'
import { createClock, seedTree, testEnv, type TestClock } from '../store2SaveKit'
import { buildSmall, chat, fakeLists, message, mulberry32, prosePool, type Obj } from './codecFixtures'

/**
 * The byte-keeping tree read of a boot (`store2/treeBytes.ts`). Labels: new behaviour (a property the read is built to
 * have), guard (passes before and after; this module is new, so only the shared-predicate cases against assembly are
 * guards). The damage cases keep the framed length and the stored payload checksum wherever the case is about a unit
 * that still matches its Ref, which a check of the Ref alone cannot see.
 */

interface World {
    memory: MemoryBackend
    db: Database
    tree: EncodedTree
    manifestKey: string
    env: KeyEnv
    clock: TestClock
}

/** Three characters; the first holds a chat of four chunks (the last with the state) and a chat that names an inlay. */
function richProfile(): Database {
    const db = buildSmall(3) as unknown as Obj
    const rng = mulberry32(77)
    const pool = prosePool(rng, 20, 100, 400)
    const long = chat(rng, 2, Array.from({ length: 4 }, (_, i) => message(rng, pool, i, 90_000)))
    long.scriptstate = { visits: 3 }
    const inlay = chat(rng, 3, [{ role: 'char', data: 'see {{inlay::0123abcd-0123-4123-a123-0123456789ab}}', time: 1 }])
    const first = (db.characters as Obj[])[0]
    first.chats = [...(first.chats as Obj[]), long, inlay]
    return db as unknown as Database
}

async function seedWorld(db: Database = richProfile(), lists: ListDerivation = fakeLists): Promise<World> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(db)) as Database, env, lists)
    return { memory, db, tree: seeded.tree, manifestKey: seeded.manifestKey, env, clock }
}

function bodyOfKey<T>(world: World, key: string, type: UnitType): T {
    const bytes = world.memory.snapshot().get(key)
    if (bytes === undefined) {
        throw new Error(`No unit ${key} in the store.`)
    }
    const parsed = readUnit(bytes, type)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error(`Unit ${key} does not parse.`)
    }
    return parsed.value.body as T
}

function entriesOf(world: World): ShardEntry[] {
    return world.tree.manifest.shards.flatMap(ref => bodyOfKey<Shard>(world, keyOfRef(ref), UNIT_TYPE.shard).entries)
}

function richEntry(world: World): ShardEntry {
    const chaId = String((world.db as unknown as { characters: Obj[] }).characters[0].chaId)
    const entry = entriesOf(world).find(candidate => candidate.chaId === chaId)
    if (entry === undefined) {
        throw new Error('The first character has no shard entry.')
    }
    return entry
}

function unitsWithIdentity(world: World, prefix: string): EncodedUnit[] {
    return world.tree.units.filter(unit => unit.identity.startsWith(prefix))
}

interface UnitCase {
    label: string
    key: string
}

interface LeafCase extends UnitCase {
    kind: 'character-part' | 'chat'
    part: 'core' | 'lore' | 'scripts' | 'al' | 'il' | 'chunk'
    chatId?: string
    /** Whether assembly reads the unit (the derived lists are never read by assembly). */
    readByAssembly: boolean
}

function leafCases(world: World): LeafCase[] {
    const entry = richEntry(world)
    const long = entry.chats[2]
    return [
        { label: 'character core', kind: 'character-part', part: 'core', key: keyOfRef(entry.core), readByAssembly: true },
        { label: 'lore', kind: 'character-part', part: 'lore', key: keyOfRef(entry.lore as Ref), readByAssembly: true },
        { label: 'scripts', kind: 'character-part', part: 'scripts', key: keyOfRef(entry.scripts as Ref), readByAssembly: true },
        { label: 'character asset list', kind: 'character-part', part: 'al', key: keyOfRef(entry.al), readByAssembly: false },
        { label: 'character inlay list', kind: 'character-part', part: 'il', key: keyOfRef(entry.il as Ref), readByAssembly: false },
        { label: 'chat core', kind: 'chat', part: 'core', chatId: entry.chats[0].cid, key: keyOfRef(entry.chats[0].core), readByAssembly: true },
        { label: 'non-tail chunk', kind: 'chat', part: 'chunk', chatId: long.cid, key: keyOfRef(long.chunks[0]), readByAssembly: true },
        { label: 'tail chunk', kind: 'chat', part: 'chunk', chatId: long.cid, key: keyOfRef(long.chunks[long.chunks.length - 1]), readByAssembly: true },
    ]
}

function fixedCases(world: World): (UnitCase & { readByAssembly: boolean })[] {
    const fixed = world.tree.manifest.fixed
    const bucket = fixed.pluginStorage.refs[0]
    const bucketBody = bodyOfKey<{ entries: { k: string, ref: Ref }[] }>(world, keyOfRef(bucket), UNIT_TYPE.pluginStorageBucket)
    return [
        { label: 'shard', key: keyOfRef(world.tree.manifest.shards[0]), readByAssembly: true },
        { label: 'config', key: keyOfRef(fixed.config), readByAssembly: true },
        { label: 'config asset list', key: keyOfRef(fixed.configAl), readByAssembly: false },
        { label: 'config inlay list', key: keyOfRef(fixed.il), readByAssembly: false },
        { label: 'statics', key: keyOfRef(fixed.statics), readByAssembly: true },
        { label: 'order', key: keyOfRef(fixed.order), readByAssembly: true },
        { label: 'loadouts', key: keyOfRef(fixed.loadouts), readByAssembly: true },
        { label: 'module index', key: keyOfRef(fixed.moduleIndex), readByAssembly: true },
        { label: 'preset', key: keyOfRef(fixed.presets[0]), readByAssembly: true },
        { label: 'plugin', key: keyOfRef(fixed.plugins[0]), readByAssembly: true },
        { label: 'plugin-storage bucket', key: keyOfRef(bucket), readByAssembly: true },
        { label: 'plugin-storage value', key: keyOfRef(bucketBody.entries[0].ref), readByAssembly: true },
        { label: 'module', key: unitsWithIdentity(world, IDENTITY.module)[0].key, readByAssembly: true },
        { label: 'module asset list', key: unitsWithIdentity(world, IDENTITY.alModule)[0].key, readByAssembly: false },
    ]
}

// ---- damage ----

function copy(bytes: Uint8Array): Uint8Array {
    return new Uint8Array(bytes)
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
    const out = copy(bytes)
    out[at] ^= 0xff
    return out
}

function withHeader(bytes: Uint8Array, edit: (header: Uint8Array) => void): Uint8Array {
    const out = copy(bytes)
    edit(out.subarray(0, 12))
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

function tooNewFrame(bytes: Uint8Array): Uint8Array {
    return withHeader(bytes, header => { header[4] = 9 })
}

interface Damage {
    name: string
    why: 'missing' | 'damaged'
    apply(bytes: Uint8Array, type: UnitType): Uint8Array | null
}

const DAMAGES: readonly Damage[] = [
    { name: 'missing', why: 'missing', apply: () => null },
    { name: 'a longer frame (the Ref length differs)', why: 'damaged', apply: bytes => new Uint8Array([...bytes, 0]) },
    { name: 'a changed stored checksum (the Ref checksum differs)', why: 'damaged', apply: bytes => flipped(bytes, bytes.length - 1) },
    { name: 'a short frame', why: 'damaged', apply: bytes => bytes.slice(0, FRAME_OVERHEAD - 13) },
    { name: 'a flipped payload byte', why: 'damaged', apply: bytes => flipped(bytes, FRAME_HEADER_BYTES + Math.floor((bytes.length - FRAME_OVERHEAD) / 2)) },
    { name: 'a flipped magic byte', why: 'damaged', apply: bytes => flipped(bytes, 0) },
    { name: 'a flipped type byte (the header checksum fails)', why: 'damaged', apply: bytes => flipped(bytes, 5) },
    { name: 'a flipped length field byte', why: 'damaged', apply: bytes => flipped(bytes, 8) },
    { name: 'a flipped header checksum byte', why: 'damaged', apply: bytes => flipped(bytes, 12) },
    { name: 'a valid frame of another unit type', why: 'damaged', apply: (bytes, type) => withHeader(bytes, header => { header[5] = type === UNIT_TYPE.lore ? UNIT_TYPE.scripts : UNIT_TYPE.lore }) },
]

function unitTypeOf(world: World, key: string): UnitType {
    const unit = world.tree.units.find(candidate => candidate.key === key)
    if (unit === undefined) {
        throw new Error(`No unit ${key} in the tree.`)
    }
    return unit.type as UnitType
}

/** Runs `run` with `key` damaged in the store, and puts the original back afterwards. */
async function withUnit<T>(world: World, key: string, bytes: Uint8Array | null, run: () => Promise<T>): Promise<T> {
    const original = world.memory.snapshot().get(key)
    world.memory.poke(key, bytes)
    try {
        return await run()
    } finally {
        world.memory.poke(key, original ?? null)
    }
}

function flaggedKeys(flagged: readonly FlaggedLeaf[]): string[] {
    return flagged.map(leaf => leaf.key)
}

// ---- a backend that can fail or move the commit key while it is read ----

interface Spy {
    backend: Store2Backend
    calls: { readUnits: number, readCommit: number }
}

function spied(memory: MemoryBackend, hooks: {
    beforeReadUnits?: (call: number, keys: readonly string[]) => void | Promise<void>
    afterReadUnits?: (call: number) => void | Promise<void>
    beforeReadCommit?: (call: number) => void | Promise<void>
} = {}): Spy {
    const calls = { readUnits: 0, readCommit: 0 }
    const backend: Store2Backend = {
        ...memory,
        async readUnits(keys) {
            calls.readUnits += 1
            await hooks.beforeReadUnits?.(calls.readUnits, keys)
            const out = await memory.readUnits(keys)
            await hooks.afterReadUnits?.(calls.readUnits)
            return out
        },
        async readCommit() {
            calls.readCommit += 1
            await hooks.beforeReadCommit?.(calls.readCommit)
            return memory.readCommit()
        },
    }
    return { backend, calls }
}

async function moveCommitKey(memory: MemoryBackend): Promise<void> {
    const read = classifyCommitRead(await memory.readCommit())
    if (read.status !== 'parsed') {
        throw new Error('The commit key does not parse.')
    }
    memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, nextCommitKey(read.value, { current: null })))
}

let world: World

beforeAll(async () => {
    world = await seedWorld()
})

describe('new behaviour: the intact tree is read whole and its bytes are kept', () => {
    test('status ok, nothing flagged, no newer list, and the manifest is the one named', async () => {
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        expect(read.flagged).toEqual([])
        expect(read.newerLists).toEqual([])
        expect(read.tree.manifestKey).toBe(world.manifestKey)
        expect(read.tree.manifest).toEqual(world.tree.manifest)
    })

    test('the source holds the framed bytes of every unit of the tree, byte for byte', async () => {
        const read = await readTreeBytes(world.memory, world.manifestKey)
        if (read.status !== 'ok') {
            throw new Error('The intact tree did not read ok.')
        }
        const stored = world.memory.snapshot()
        const missing = world.tree.units.filter(unit => {
            const held = read.tree.source.get(unit.key)
            const original = stored.get(unit.key)
            return held === undefined || original === undefined || held.length !== original.length || held.some((byte, at) => byte !== original[at])
        })
        expect(missing.map(unit => unit.identity)).toEqual([])
    })

    test('previousOfTree registers every unit of the tree with a digest, so a pass that changes nothing reuses all of them', async () => {
        const read = await readTreeBytes(world.memory, world.manifestKey)
        if (read.status !== 'ok') {
            throw new Error('The intact tree did not read ok.')
        }
        const previous = previousOfTree(read.tree)
        const withoutDigest = [...previous.units].filter(([, unit]) => unit.digest === undefined).map(([identity]) => identity)
        expect(withoutDigest).toEqual([])
        expect(previous.units.size).toBeGreaterThanOrEqual(world.tree.units.length)
    })

    test('an entry left out by the resident filter has none of its units read and none flagged; the fixed units are still read', async () => {
        const entry = richEntry(world)
        const residents = new Set(entriesOf(world).filter(candidate => candidate.u !== entry.u).map(candidate => candidate.u))
        const read = await readTreeBytes(world.memory, world.manifestKey, { resident: candidate => residents.has(candidate.u) })
        if (read.status !== 'ok') {
            throw new Error('The tree did not read ok.')
        }
        expect(read.tree.source.get(keyOfRef(entry.core))).toBeUndefined()
        expect(read.tree.source.get(keyOfRef(entry.chats[2].chunks[0]))).toBeUndefined()
        expect(read.tree.source.get(keyOfRef(world.tree.manifest.fixed.config))).toBeDefined()
        expect(read.flagged).toEqual([])
    })

    test('a read that spans several batches hands the thread back between them', async () => {
        const big = await seedWorld(buildSmall(120))
        let yielded = 0
        const read = await readTreeBytes(big.memory, big.manifestKey, { yield: async () => { yielded += 1 } })
        expect(read.status).toBe('ok')
        expect(yielded).toBeGreaterThanOrEqual(1)
    })

    test('a stored entry that is not binary data is a damaged leaf, and the rest of its batch is still read', async () => {
        const entry = richEntry(world)
        const key = keyOfRef(entry.chats[0].core)
        const spy = spied(world.memory, {
            beforeReadUnits: (_call, keys) => {
                if (keys.includes(key)) {
                    throw new Store2NotBinaryError(key)
                }
            },
        })
        const read = await readTreeBytes(spy.backend, world.manifestKey)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        expect(read.flagged).toEqual([expect.objectContaining({ kind: 'chat', part: 'core', key, why: 'damaged' })])
        // The rest of the batch the refusal hit was read again without the entry.
        expect(read.tree.source.get(keyOfRef(entry.core))).toBeDefined()
        expect(read.tree.source.get(key)).toBeUndefined()
    })
})

describe('new behaviour: a leaf that fails the unit check is flagged, not a failure', () => {
    describe.each(DAMAGES)('$name', (damage) => {
        let cases: LeafCase[]
        beforeAll(() => { cases = leafCases(world) })

        test.each([0, 1, 2, 3, 4, 5, 6, 7])('leaf case %i', async (index) => {
            const leaf = cases[index]
            const type = unitTypeOf(world, leaf.key)
            const damaged = damage.apply(world.memory.snapshot().get(leaf.key) as Uint8Array, type)
            const read = await withUnit(world, leaf.key, damaged, () => readTreeBytes(world.memory, world.manifestKey))
            expect(read.status, `${leaf.label}`).toBe('ok')
            if (read.status !== 'ok') {
                return
            }
            expect(read.newerLists).toEqual([])
            expect(read.flagged).toHaveLength(1)
            const entry = richEntry(world)
            const flagged = read.flagged[0]
            expect(flagged.key).toBe(leaf.key)
            expect(flagged.why).toBe(damage.why)
            expect(flagged.kind).toBe(leaf.kind)
            expect(flagged.chaId).toBe(entry.chaId)
            if (flagged.kind === 'chat') {
                expect(flagged.chatId).toBe(leaf.chatId)
                expect(flagged.part).toBe(leaf.part === 'chunk' ? 'chunk' : 'core')
            } else {
                expect(flagged.part).toBe(leaf.part)
            }
            // The flagged unit's bytes are withheld, so it is registered without a digest and rewritten by the first pass.
            expect(read.tree.source.get(leaf.key)).toBeUndefined()
            const previous = previousOfTree(read.tree)
            const registered = [...previous.units.values()].find(unit => unit.key === leaf.key)
            expect(registered).toBeDefined()
            expect(registered?.digest).toBeUndefined()
            // Every other unit keeps its bytes and its digest.
            const others = [...previous.units.values()].filter(unit => unit.key !== leaf.key && unit.digest === undefined)
            expect(others).toEqual([])
        })
    })

    test('a chunk whose message count differs from the count its Ref holds is flagged damaged', async () => {
        const entry = richEntry(world)
        const shardRef = world.tree.manifest.shards.find(ref => bodyOfKey<Shard>(world, keyOfRef(ref), UNIT_TYPE.shard).entries.some(candidate => candidate.u === entry.u))
        if (shardRef === undefined) {
            throw new Error('No shard holds the rich entry.')
        }
        const shardKey = keyOfRef(shardRef)
        const body = structuredClone(bodyOfKey<Shard>(world, shardKey, UNIT_TYPE.shard))
        const target = body.entries.find(candidate => candidate.u === entry.u)?.chats[2].chunks[1]
        if (target === undefined) {
            throw new Error('The rich entry has no second chunk.')
        }
        target[3] = target[3] + 1
        const rewritten = encodeUnit(UNIT_TYPE.shard, body)
        const manifest = structuredClone(world.tree.manifest)
        manifest.shards = manifest.shards.map(ref => keyOfRef(ref) === shardKey ? [ref[0], rewritten.length, new DataView(rewritten.buffer, rewritten.byteOffset + rewritten.length - 4, 4).getUint32(0, true)] : ref)
        const manifestBytes = encodeUnit(UNIT_TYPE.manifest, manifest)
        const original = world.memory.snapshot()
        world.memory.poke(shardKey, rewritten)
        world.memory.poke(world.manifestKey, manifestBytes)
        try {
            const read = await readTreeBytes(world.memory, world.manifestKey)
            expect(read.status).toBe('ok')
            if (read.status !== 'ok') {
                return
            }
            expect(flaggedKeys(read.flagged)).toEqual([keyOfRef(target)])
            expect(read.flagged[0]).toMatchObject({ kind: 'chat', part: 'chunk', why: 'damaged' })
        } finally {
            world.memory.poke(shardKey, original.get(shardKey) ?? null)
            world.memory.poke(world.manifestKey, original.get(world.manifestKey) ?? null)
        }
    })

    test('two damaged leaves are both flagged, each under its own key', async () => {
        const entry = richEntry(world)
        const a = keyOfRef(entry.core)
        const b = keyOfRef(entry.chats[2].chunks[1])
        const read = await withUnit(world, a, null, () => withUnit(world, b, flipped(world.memory.snapshot().get(b) as Uint8Array, FRAME_HEADER_BYTES + 3), () => readTreeBytes(world.memory, world.manifestKey)))
        if (read.status !== 'ok') {
            throw new Error('The tree did not read ok.')
        }
        expect(flaggedKeys(read.flagged).sort()).toEqual([a, b].sort())
    })
})

describe('new behaviour: a fixed unit that fails the unit check is a structure failure', () => {
    describe.each(DAMAGES)('$name', (damage) => {
        let cases: (UnitCase & { readByAssembly: boolean })[]
        beforeAll(() => { cases = fixedCases(world) })

        test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])('fixed case %i', async (index) => {
            const fixed = cases[index]
            const type = unitTypeOf(world, fixed.key)
            const damaged = damage.apply(world.memory.snapshot().get(fixed.key) as Uint8Array, type)
            const read = await withUnit(world, fixed.key, damaged, () => readTreeBytes(world.memory, world.manifestKey))
            expect(read.status, `${fixed.label}`).toBe('structure')
            if (read.status !== 'structure') {
                return
            }
            expect(read.keys).toContain(fixed.key)
            expect(read.tree).toBe(damage.why)
            expect(read.manifestKey).toBe(world.manifestKey)
        })
    })

    test('a manifest that is absent is a structure failure of an absent tree; a damaged one, of a damaged tree', async () => {
        const absent = await withUnit(world, world.manifestKey, null, () => readTreeBytes(world.memory, world.manifestKey))
        expect(absent).toMatchObject({ status: 'structure', keys: [world.manifestKey], tree: 'missing' })
        const bytes = world.memory.snapshot().get(world.manifestKey) as Uint8Array
        const damaged = await withUnit(world, world.manifestKey, flipped(bytes, FRAME_HEADER_BYTES + 5), () => readTreeBytes(world.memory, world.manifestKey))
        expect(damaged).toMatchObject({ status: 'structure', keys: [world.manifestKey], tree: 'damaged' })
    })

    test('a key that is not a manifest key is a structure failure and reads nothing', async () => {
        const spy = spied(world.memory)
        const read = await readTreeBytes(spy.backend, 'store2/not-a-manifest-key')
        expect(read.status).toBe('structure')
        expect(spy.calls.readUnits).toBe(0)
    })

    test('a missing fixed unit and a damaged one together are a damaged tree', async () => {
        const cases = fixedCases(world)
        const a = cases[1].key
        const b = cases[5].key
        const read = await withUnit(world, a, null, () => withUnit(world, b, flipped(world.memory.snapshot().get(b) as Uint8Array, FRAME_HEADER_BYTES + 1), () => readTreeBytes(world.memory, world.manifestKey)))
        expect(read).toMatchObject({ status: 'structure', tree: 'damaged' })
        if (read.status === 'structure') {
            expect([...read.keys].sort()).toEqual([a, b].sort())
        }
    })
})

describe('new behaviour: a unit a newer build wrote is too-new, never flagged and never a structure failure', () => {
    test.each([0, 1, 2, 5, 6, 7])('a too-new leaf (case %i) is too-new', async (index) => {
        const leaf = leafCases(world)[index]
        const bytes = tooNewFrame(world.memory.snapshot().get(leaf.key) as Uint8Array)
        const read = await withUnit(world, leaf.key, bytes, () => readTreeBytes(world.memory, world.manifestKey))
        expect(read).toMatchObject({ status: 'too-new', keys: [leaf.key] })
    })

    test.each([0, 1, 3, 7, 9, 12])('a too-new fixed unit (case %i) is too-new', async (index) => {
        const fixed = fixedCases(world)[index]
        const bytes = tooNewFrame(world.memory.snapshot().get(fixed.key) as Uint8Array)
        const read = await withUnit(world, fixed.key, bytes, () => readTreeBytes(world.memory, world.manifestKey))
        expect(read).toMatchObject({ status: 'too-new', keys: [fixed.key] })
    })

    test('a too-new manifest is too-new', async () => {
        const bytes = tooNewFrame(world.memory.snapshot().get(world.manifestKey) as Uint8Array)
        const read = await withUnit(world, world.manifestKey, bytes, () => readTreeBytes(world.memory, world.manifestKey))
        expect(read.status).toBe('too-new')
    })

    test('too-new wins over a damaged leaf and a damaged fixed unit found in the same read', async () => {
        const leaf = leafCases(world)
        const fixed = fixedCases(world)
        const newer = leaf[0].key
        const damagedLeaf = leaf[5].key
        const damagedFixed = fixed[1].key
        const original = (key: string) => world.memory.snapshot().get(key) as Uint8Array
        const read = await withUnit(world, newer, tooNewFrame(original(newer)), () =>
            withUnit(world, damagedLeaf, null, () =>
                withUnit(world, damagedFixed, flipped(original(damagedFixed), FRAME_HEADER_BYTES + 1), () => readTreeBytes(world.memory, world.manifestKey))))
        expect(read).toMatchObject({ status: 'too-new', keys: [newer] })
    })
})

describe('new behaviour: a derived list above this build\'s version is readable data', () => {
    const newerAssets = (extra: Partial<ListDerivation> = {}): ListDerivation => ({ ...fakeLists, ...extra })

    async function newerWorld(kind: 'character-al' | 'character-il' | 'config-al'): Promise<World> {
        const lists: ListDerivation = kind === 'character-al'
            ? newerAssets({ characterAssets: owner => ({ ...fakeLists.characterAssets(owner), v: ASSET_REF_V + 1 }) })
            : kind === 'character-il'
                ? newerAssets({ characterInlays: owner => {
                    const list = fakeLists.characterInlays(owner)
                    return list === null ? null : { ...list, v: IL_REF_V + 1 }
                } })
                : newerAssets({ configAssets: owner => ({ ...fakeLists.configAssets(owner), v: ASSET_REF_V + 1 }) })
        return seedWorld(richProfile(), lists)
    }

    function keyOf(kind: 'character-al' | 'character-il' | 'config-al', held: World): string {
        const entry = richEntry(held)
        return kind === 'character-al' ? keyOfRef(entry.al) : kind === 'character-il' ? keyOfRef(entry.il as Ref) : keyOfRef(held.tree.manifest.fixed.configAl)
    }

    test.each(['character-al', 'character-il', 'config-al'] as const)('a newer %s reads ok, is recorded in newerLists, is never flagged, and keeps its bytes', async (kind) => {
        const held = await newerWorld(kind)
        const read = await readTreeBytes(held.memory, held.manifestKey)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const key = keyOf(kind, held)
        expect(read.flagged).toEqual([])
        expect(read.newerLists).toContain(key)
        expect(read.tree.source.get(key)).toBeDefined()
        expect(previousOfTree(read.tree).units.size).toBeGreaterThan(0)
    })

    test.each([
        ['character-al', 'a truncated newer entity list', 'flagged'],
        ['character-il', 'a truncated newer entity list', 'flagged'],
        ['config-al', 'a truncated newer fixed list', 'structure'],
    ] as const)('%s: %s is damaged (%s), never a newer list', async (kind, _label, expected) => {
        const held = await newerWorld(kind)
        const key = keyOf(kind, held)
        const bytes = held.memory.snapshot().get(key) as Uint8Array
        const read = await withUnit(held, key, bytes.slice(0, bytes.length - 1), () => readTreeBytes(held.memory, held.manifestKey))
        if (expected === 'flagged') {
            expect(read.status).toBe('ok')
            if (read.status === 'ok') {
                expect(flaggedKeys(read.flagged)).toEqual([key])
                expect(read.newerLists).not.toContain(key)
            }
        } else {
            expect(read).toMatchObject({ status: 'structure', keys: [key] })
        }
    })
})

describe('new behaviour: a backend failure is unreadable, never damage and never absence', () => {
    test.each([1, 2, 3])('a failure of read %i', async (call) => {
        const spy = spied(world.memory, {
            beforeReadUnits: (number) => {
                if (number === call) {
                    throw new Store2BackendFailureError('the disk went away')
                }
            },
        })
        const read = await readTreeBytes(spy.backend, world.manifestKey)
        expect(read.status).toBe('unreadable')
        if (read.status === 'unreadable') {
            expect(read.cause.message).toBe('the disk went away')
        }
    })
})

describe('new behaviour: a finding is acted on only while the commit key still names the tree', () => {
    test('a flagged leaf, with the commit key unchanged since the read, is returned flagged', async () => {
        const leaf = leafCases(world)[0]
        const spy = spied(world.memory)
        const read = await withUnit(world, leaf.key, null, () => readTreeBytes(spy.backend, world.manifestKey))
        expect(read.status).toBe('ok')
        expect(spy.calls.readCommit).toBe(1)
    })

    test.each([
        ['a flagged leaf', () => leafCases(world)[0].key, null],
        ['a structure failure', () => fixedCases(world)[1].key, null],
        ['a too-new unit', () => leafCases(world)[0].key, 'newer'],
    ] as const)('%s with the commit key moved after the unit reads is moved', async (_label, keyOf, mode) => {
        const key = keyOf()
        const bytes = world.memory.snapshot().get(key) as Uint8Array
        const spy = spied(world.memory, { afterReadUnits: async (call) => { if (call === 3) { await moveCommitKey(world.memory) } } })
        const held = classifyCommitRead(await world.memory.readCommit())
        try {
            const read = await withUnit(world, key, mode === 'newer' ? tooNewFrame(bytes) : null, () => readTreeBytes(spy.backend, world.manifestKey))
            expect(read).toEqual({ status: 'moved' })
        } finally {
            if (held.status === 'parsed') {
                world.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, held.value))
            }
        }
    })

    test('a commit key that is gone after the reads is moved too, not damage', async () => {
        const leaf = leafCases(world)[0]
        const held = await world.memory.readCommit()
        const spy = spied(world.memory, { afterReadUnits: (call) => { if (call === 3) { world.memory.poke(COMMIT_KEY, null) } } })
        try {
            const read = await withUnit(world, leaf.key, null, () => readTreeBytes(spy.backend, world.manifestKey))
            expect(read).toEqual({ status: 'moved' })
        } finally {
            world.memory.poke(COMMIT_KEY, held.bytes)
        }
    })

    test('guard: a tree with no finding is returned ok without a second look at the commit key, even if the key moved', async () => {
        const held = await world.memory.readCommit()
        const spy = spied(world.memory, { afterReadUnits: async (call) => { if (call === 3) { await moveCommitKey(world.memory) } } })
        try {
            const read = await readTreeBytes(spy.backend, world.manifestKey)
            expect(read.status).toBe('ok')
            expect(spy.calls.readCommit).toBe(0)
        } finally {
            world.memory.poke(COMMIT_KEY, held.bytes)
        }
    })

    test('a commit key that cannot be read again rejects with CommitKeyRecheckError: never moved, never damage', async () => {
        const leaf = leafCases(world)[0]
        const spy = spied(world.memory, { beforeReadCommit: () => { throw new Store2BackendFailureError('the commit key is unreadable') } })
        await expect(withUnit(world, leaf.key, null, () => readTreeBytes(spy.backend, world.manifestKey))).rejects.toBeInstanceOf(CommitKeyRecheckError)
    })

    test('the same unreadable commit key does not matter when there is nothing to act on', async () => {
        const spy = spied(world.memory, { beforeReadCommit: () => { throw new Store2BackendFailureError('the commit key is unreadable') } })
        expect((await readTreeBytes(spy.backend, world.manifestKey)).status).toBe('ok')
    })
})

describe('guard: detection and assembly share one predicate', () => {
    function rawSource(memory: MemoryBackend) {
        const stored = memory.snapshot()
        return { get: (key: string) => stored.get(key) }
    }

    function assembles(): boolean {
        try {
            assembleDatabase(world.tree.manifest, rawSource(world.memory))
            return true
        } catch (error) {
            if (error instanceof CodecAssembleError) {
                return false
            }
            throw error
        }
    }

    const all = (): (UnitCase & { readByAssembly: boolean })[] => [...leafCases(world), ...fixedCases(world)]

    test.each(DAMAGES.map(damage => [damage.name, damage] as const))('%s: assembly throws exactly when detection reports the unit', async (_name, damage) => {
        const disagreements: string[] = []
        for (const unit of all()) {
            const type = unitTypeOf(world, unit.key)
            const damaged = damage.apply(world.memory.snapshot().get(unit.key) as Uint8Array, type)
            await withUnit(world, unit.key, damaged, async () => {
                const read = await readTreeBytes(world.memory, world.manifestKey)
                const detected = read.status !== 'ok' || read.flagged.length > 0
                const threw = !assembles()
                if (!detected) {
                    disagreements.push(`${unit.label}: not detected`)
                }
                if (unit.readByAssembly && !threw) {
                    disagreements.push(`${unit.label}: detected but assembly read it as usable`)
                }
                if (!unit.readByAssembly && threw) {
                    disagreements.push(`${unit.label}: a list unit stopped assembly`)
                }
            })
        }
        expect(disagreements).toEqual([])
    })

    test('a too-new unit is reported too-new by detection and stops assembly', async () => {
        const unit = leafCases(world)[0]
        const bytes = tooNewFrame(world.memory.snapshot().get(unit.key) as Uint8Array)
        await withUnit(world, unit.key, bytes, async () => {
            expect((await readTreeBytes(world.memory, world.manifestKey)).status).toBe('too-new')
            expect(assembles()).toBe(false)
        })
    })
})
