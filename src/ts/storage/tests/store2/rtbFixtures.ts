import { crc32 } from 'src/ts/storage/blockFrame'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { assembleDatabase, encodeDatabase, type EncodedTree } from 'src/ts/storage/store2/codec'
import type { AssembleOptions } from 'src/ts/storage/store2/codec/assemble'
import { IMPORT_REPLACES_BASE, type BuildContext, type BuiltCommit } from 'src/ts/storage/store2/commit'
import { exportClosure, type OmittedUnit } from 'src/ts/storage/store2/rtb/exportClosure'
import { MODULE_INDEX_PARAMS } from 'src/ts/storage/store2/codec/moduleIndexParams'
import { firstCommitKey, nextCommitKey } from 'src/ts/storage/store2/commitKey'
import {
    encodeFrame, encodeUnit, keyOfTail, newUnitKey, readUnit, refOfFrame, refsOfWith, REFS_TABLE, UNIT_TYPE,
    type ChunkRef, type CommitKey, type KeyEnv, type ListRef, type Manifest, type Ref, type RefRow, type Shard, type UnitType,
} from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { buildSmall, bytesOf, type Obj } from './codecFixtures'
import { committerOf, createClock, parsedCommit, seedStore, testEnv } from './commitFixtures'

/**
 * The world of the `.rtb` export and restore tests (CHORE-128 S3 and S4): a store written by the real producer
 * (`encodeDatabase` with the real list derivation) and published under a commit key, optionally with frames laid out the
 * way another writer could lay them out (non-canonical JSON under the same keys) and with an old-file keep list.
 *
 * A test file that uses it declares the hoisted `moduleIndexParams` mock itself (`vi.mock` applies per test file); the
 * `layout` option then sets the module index layout the producer writes.
 */

/** The rows no walk visits: the commit key's three and the old-file keep list. Spelled out here so the fixture is independent of `rtb/rows`. */
const NOT_WALKED = ['1:current.key', '1:retained[].key', '1:pins[].key', '2:fixed.legacyKeep.unit']

const rowIdOf = (row: { type: number, path: string }): string => `${row.type}:${row.path}`

/** The 28 rows a walk visits, from the one schema table. */
export const FIXTURE_WALK_TABLE: readonly RefRow[] = REFS_TABLE.filter(row => !NOT_WALKED.includes(rowIdOf(row)))
export const FIXTURE_WALK_ROW_IDS: readonly string[] = FIXTURE_WALK_TABLE.map(rowIdOf)

export const CURRENT_AT = 1_700_000_000_123

export interface RtbWorldOptions {
    layout: 1 | 2
    seed?: number
    /** The database to encode in place of the enriched small profile (generated databases of the property test). */
    database?: Obj
    /** Re-frame a preset, a chat chunk, the shard and the manifest with non-canonical JSON, and replace one asset list by a version 2 list. */
    nonCanonical?: boolean
    /** Name an old-file keep list (type 20) from the manifest. */
    keep?: boolean
}

export interface Planted {
    presetKey: string
    chunkKey: string
    listKey: string
    shardKey: string
}

export interface RtbWorld {
    /** Every store2 unit key and its stored frame (the producer's, with any plant applied). */
    store: Map<string, Uint8Array>
    manifestKey: string
    tree: EncodedTree
    env: KeyEnv
    /** The tails named at each walk row, from an independent walk over the 28 rows; rows that name nothing are absent. */
    refsByRow: Map<string, string[]>
    /** The keep list's tail when `keep` was planted. */
    keepTail: string | null
    planted: Planted | null
    /** The unit keys of one type, in store order. */
    keysOfType(type: UnitType): string[]
    /** A memory backend holding the store, with `replace` applied (null deletes a key, bytes replace it), and the commit key naming the manifest. */
    open(replace?: ReadonlyMap<string, Uint8Array | null>): Promise<MemoryBackend>
}

type Parsed = ReturnType<typeof readUnit>

function parse(bytes: Uint8Array, type: UnitType): { body: object } {
    const parsed: Parsed = readUnit(bytes, type)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error(`The unit does not parse: ${parsed.reason}`)
    }
    return { body: JSON.parse(JSON.stringify(parsed.value.body)) as object }
}

function reversed(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(reversed)
    }
    if (typeof value === 'object' && value !== null) {
        const record = value as Record<string, unknown>
        return Object.fromEntries(Object.keys(record).reverse().map(key => [key, reversed(record[key])]))
    }
    return value
}

/** A frame of `body` that is valid but not the canonical encoding: keys in reverse order, indented. */
export function nonCanonicalFrame(type: UnitType, body: object): Uint8Array {
    return encodeFrame(type, new TextEncoder().encode(JSON.stringify(reversed(body), null, 1)))
}

function enriched(): Obj {
    const db = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    ;(((db.characters as Obj[])[0].chats as Obj[])[0]).alt = [{ m: { role: 'char', data: 'alternative', time: 1 }, p: null, a: 1 }]
    db.taskPresets = [{ name: 'tp1', x: 1 }, { name: 'tp2', y: 2 }]
    db.loadouts = [{ name: 'lo1' }]
    db.statics = { s: 1 }
    db.pluginCustomStorage = { a: 'value-a', b: 'value-b' }
    return db
}

/** Walks the final store from the manifest with `refsOfWith` over the 28 rows and files each tail under the row that names it. */
function refsByRowOf(store: ReadonlyMap<string, Uint8Array>, manifestKey: string): Map<string, string[]> {
    const byRow = new Map<string, Set<string>>()
    const queue = [manifestKey]
    const visited = new Set<string>(queue)
    while (queue.length > 0) {
        const bytes = store.get(queue.shift() as string)
        if (bytes === undefined) {
            continue
        }
        const parsed = readUnit(bytes)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            continue
        }
        for (const target of refsOfWith(FIXTURE_WALK_TABLE, parsed.value.type, parsed.value.body)) {
            const id = `${parsed.value.type}:${target.path}`
            byRow.set(id, (byRow.get(id) ?? new Set<string>()).add(target.tail))
            const key = keyOfTail(target.tail)
            if (!visited.has(key)) {
                visited.add(key)
                queue.push(key)
            }
        }
    }
    return new Map([...byRow].map(([id, tails]) => [id, [...tails].sort()]))
}

export function setLayout(layout: 1 | 2): void {
    ;(MODULE_INDEX_PARAMS as { MODULE_INDEX_LAYOUT: number }).MODULE_INDEX_LAYOUT = layout
}

export async function publishCommit(backend: MemoryBackend, manifestKey: string, env: KeyEnv, at = CURRENT_AT): Promise<void> {
    const key = firstCommitKey({ current: { key: manifestKey, at }, staging: null }, env)
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
}

/** Moves `current` to `manifestKey`, as a peer commit does. */
export async function moveCurrent(backend: MemoryBackend, manifestKey: string, env: KeyEnv): Promise<void> {
    const read = await backend.readCommit()
    const base = firstCommitKeyOf(read.bytes)
    await backend.casCommit(read.token, encodeUnit(UNIT_TYPE.commit, nextCommitKey(base, { current: { key: manifestKey, at: CURRENT_AT + 1 } }, env)))
}

function firstCommitKeyOf(bytes: Uint8Array | null): CommitKey {
    const parsed = bytes === null ? null : readUnit(bytes, UNIT_TYPE.commit)
    if (parsed === null || (parsed.status !== 'ok' && parsed.status !== 'stale')) {
        throw new Error('The commit key does not parse.')
    }
    return parsed.value.body as CommitKey
}

export async function rtbWorld(options: RtbWorldOptions): Promise<RtbWorld> {
    setLayout(options.layout)
    const env = testEnv(createClock(), options.seed ?? 3)
    const tree = encodeDatabase((options.database ?? enriched()) as never, { env, lists: createListDerivation(), seq: 1, createdAt: 1 })
    const store = new Map<string, Uint8Array>()
    for (const unit of tree.units) {
        store.set(unit.key, bytesOf(unit))
    }
    const manifestKey = tree.manifestKey
    const manifest = parse(store.get(manifestKey) as Uint8Array, UNIT_TYPE.manifest).body as Manifest
    let planted: Planted | null = null
    let keepTail: string | null = null

    if (options.nonCanonical === true) {
        const presetKey = keyOfTail(manifest.fixed.presets[0][0])
        const presetBytes = nonCanonicalFrame(UNIT_TYPE.preset, parse(store.get(presetKey) as Uint8Array, UNIT_TYPE.preset).body)
        store.set(presetKey, presetBytes)
        manifest.fixed.presets[0] = refOfFrame(presetKey, presetBytes)

        let shardKey = ''
        let chunkKey = ''
        let listKey = ''
        for (const [position, shardRef] of manifest.shards.entries()) {
            const key = keyOfTail(shardRef[0])
            const shard = parse(store.get(key) as Uint8Array, UNIT_TYPE.shard).body as Shard
            const entry = shard.entries.find(candidate => candidate.chats.length > 0 && candidate.chats[0].chunks.length > 0)
            if (entry === undefined) {
                continue
            }
            const chunkRef = entry.chats[0].chunks[0]
            chunkKey = keyOfTail(chunkRef[0])
            const chunkBytes = nonCanonicalFrame(UNIT_TYPE.chatChunk, parse(store.get(chunkKey) as Uint8Array, UNIT_TYPE.chatChunk).body)
            store.set(chunkKey, chunkBytes)
            const reframedChunk = refOfFrame(chunkKey, chunkBytes)
            entry.chats[0].chunks[0] = [reframedChunk[0], reframedChunk[1], reframedChunk[2], chunkRef[3]] satisfies ChunkRef

            listKey = keyOfTail(entry.al[0])
            const listBytes = encodeUnit(UNIT_TYPE.assetList, { v: 2, h: '', l: [] })
            store.set(listKey, listBytes)
            const reframedList = refOfFrame(listKey, listBytes)
            entry.al = [reframedList[0], reframedList[1], reframedList[2], 2] satisfies ListRef

            shardKey = key
            const shardBytes = nonCanonicalFrame(UNIT_TYPE.shard, shard)
            store.set(key, shardBytes)
            manifest.shards[position] = refOfFrame(key, shardBytes)
            break
        }
        planted = { presetKey, chunkKey, listKey, shardKey }
    }

    if (options.keep === true) {
        const key = newUnitKey(env)
        const bytes = encodeUnit(UNIT_TYPE.legacyList, { v: 1, iv: 1, files: [], h: '', l: [], i: { v: 1, u: [], h: '', o: [] } })
        store.set(key, bytes)
        manifest.fixed.legacyKeep = { unit: refOfFrame(key, bytes) as Ref, v: 1, files: [{ key: 'database/database.bin', status: 'ok' }] }
        keepTail = refOfFrame(key, bytes)[0]
    }

    if (options.nonCanonical === true || options.keep === true) {
        store.set(manifestKey, options.nonCanonical === true ? nonCanonicalFrame(UNIT_TYPE.manifest, manifest) : encodeUnit(UNIT_TYPE.manifest, manifest))
    }

    return {
        store,
        manifestKey,
        tree,
        env,
        refsByRow: refsByRowOf(store, manifestKey),
        keepTail,
        planted,
        keysOfType(type) {
            return [...store].filter(([, bytes]) => bytes[5] === type).map(([key]) => key)
        },
        async open(replace) {
            const backend = createMemoryBackend()
            for (const [key, bytes] of store) {
                const replacement = replace?.get(key)
                if (replacement === null) {
                    continue
                }
                await backend.putUnit(key, replacement ?? bytes)
            }
            for (const [key, bytes] of replace ?? []) {
                if (bytes !== null && !store.has(key)) {
                    await backend.putUnit(key, bytes)
                }
            }
            await publishCommit(backend, manifestKey, env)
            return backend
        },
    }
}

/** `bytes` with one payload byte flipped: the frame header holds, the payload checksum does not. */
export function damagedFrame(bytes: Uint8Array): Uint8Array {
    const flipped = new Uint8Array(bytes)
    flipped[20] ^= 0xff
    return flipped
}

/** The frame with its type byte set to a type this build does not know and the header checksum repaired: length and payload checksum are unchanged, so its Ref still matches. */
export function newerTypeFrame(bytes: Uint8Array): Uint8Array {
    const newer = new Uint8Array(bytes)
    newer[5] = 99
    new DataView(newer.buffer).setUint32(12, crc32(newer.subarray(0, 12)), true)
    return newer
}

/** The ids of the rows that name at least one unit in `world`. */
export function rowsOf(world: RtbWorld): Set<string> {
    return new Set(world.refsByRow.keys())
}

/** What a restore consumes of a file: the closure's frames by tail, the exported root and the omitted entries, as the real export walk hands them over. */
export interface Captured {
    frames: Map<string, Uint8Array>
    root: Ref
    omitted: OmittedUnit[]
}

export async function captureExport(backend: Store2Backend): Promise<Captured> {
    const frames = new Map<string, Uint8Array>()
    const closure = await exportClosure(backend, {
        onUnits: async (batch) => {
            for (const unit of batch) {
                frames.set(unit.tail, unit.bytes)
            }
        },
    })
    return { frames, root: closure.root, omitted: closure.omitted }
}

export interface Restored {
    backend: MemoryBackend
    manifestKey: string
    /** Every store2 unit of the restored store by full key. */
    units: Map<string, Uint8Array>
}

/** Commits a restore request over a seeded store the way an import does (bulk, replacing its base), and reads the result back. */
export async function commitRestore(request: { newUnits: number, build(context: BuildContext): BuiltCommit | Promise<BuiltCommit> }, seed = 77): Promise<Restored> {
    const backend = createMemoryBackend()
    const clock = createClock()
    await seedStore(backend, testEnv(clock, seed))
    const committer = committerOf(backend, clock, seed + 1)
    const result = await committer.commit(await committer.readCommit(), {
        newUnits: request.newUnits, build: request.build, label: 'import', force: true, carry: IMPORT_REPLACES_BASE,
    })
    if (result.status !== 'committed') {
        throw new Error(`The restore commit ended ${result.status}.`)
    }
    const commit = await parsedCommit(backend)
    const keys = await backend.listStore2()
    const units = new Map<string, Uint8Array>()
    for (let start = 0; start < keys.length; start += 100) {
        for (const [key, bytes] of await backend.readUnits(keys.slice(start, start + 100))) {
            if (bytes !== null) {
                units.set(key, bytes)
            }
        }
    }
    return { backend, manifestKey: (commit.current as { key: string }).key, units }
}

/** The database the manifest under `manifestKey` and the units of `store` (by full key) assemble to. */
export function assembleStore(store: ReadonlyMap<string, Uint8Array>, manifestKey: string, options: AssembleOptions = {}): unknown {
    const manifest = parse(store.get(manifestKey) as Uint8Array, UNIT_TYPE.manifest).body as Manifest
    return assembleDatabase(manifest, { get: key => store.get(key) }, options)
}

/** Every walk-row Ref in the given frames, found with the fixture's own 28-row table, whatever the unit's type. */
export function walkRefsOf(units: Iterable<{ bytes: Uint8Array }>): { row: string, tail: string }[] {
    const found: { row: string, tail: string }[] = []
    for (const { bytes } of units) {
        const parsed = readUnit(bytes)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            continue
        }
        for (const target of refsOfWith(FIXTURE_WALK_TABLE, parsed.value.type, parsed.value.body)) {
            found.push({ row: `${parsed.value.type}:${target.path}`, tail: target.tail })
        }
    }
    return found
}

/** Every tail the independent walk reaches, the manifest's own included. */
export function reachedTails(world: RtbWorld): Set<string> {
    const tails = new Set<string>([world.manifestKey.slice('store2/'.length)])
    for (const list of world.refsByRow.values()) {
        for (const tail of list) {
            tails.add(tail)
        }
    }
    return tails
}
