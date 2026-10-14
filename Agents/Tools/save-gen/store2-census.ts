/**
 * Counts-only store2 census over a decoded database (plan 8.3), run by
 * real-size-report.harness.ts on the maintainer's real `.bin` before the format
 * freeze. It drives the real unit codec (`encodeDatabase`, `assembleCharacter`,
 * `assembleDatabase`) and the real list derivation (`createListDerivation`,
 * `deriveInlayList`); nothing here re-implements a split or a list rule.
 *
 * Privacy: the section holds sizes, counts and ordinals only. No name, id, uuid,
 * message text, asset or inlay file name, plugin name, plugin storage key, field
 * name outside the codec's own schema, or hash of any of these is ever emitted.
 * Ordinals are `character#N` (0-based position in the decoded `characters`),
 * `module#N`, `bucket#N`, `pluginStorageKey#N` (position in the resolved plugin
 * storage) and fixed unit names. Errors are reported by class and code, never by
 * message, because codec messages name characters and keys.
 *
 * Memory: the decoded database and the retained cold bodies are held by the
 * caller. Each owner (one character with its chats re-attached from the cold
 * units, or the fixed part of the database) is encoded, measured and dropped
 * before the next; only sizes, shard entries (refs only) and counters are kept.
 */
import type { JsonObject } from 'src/ts/storage/blockFrame'
import type { Database, character, groupChat } from 'src/ts/storage/database.svelte'
import { applyStubStateOnRestore } from 'src/ts/process/coldCharacter'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import {
    assembleCharacter, assembleDatabase, buildManifest, CodecError, CONFIG_PARTITIONED_FIELDS, DERIVED_COLD_FIELDS,
    encodeDatabase, ENTRY_MOVED_FIELDS, groupIntoShards, LORE_FIELDS, SCRIPT_FIELDS, SHARD_COUNT,
    TAIL_STATE_FIELDS, toPlainJson, unitMapSource, UnitSink, utf8Length, VOLATILE_CHARACTER_FIELDS, VOLATILE_CHAT_FIELDS,
    type CharacterCoreBody, type EncodedTree, type EncodedUnit, type ListDerivation, type OrderBody,
} from 'src/ts/storage/store2/codec'
import {
    canonicalJson, defaultKeyEnv, HASH_STEM_CHARS, readUnit, splitHashStems, UNIT_TYPE,
    type AssetList, type ChatChunk, type ChatCore, type InlayList, type ModuleIndex, type PluginBucket,
    type Ref, type Shard, type ShardEntry, type UnitType,
} from 'src/ts/storage/store2/format'
import { createListDerivation, deriveInlayList } from 'src/ts/storage/store2/lists'

type Slot = character | groupChat
type Rec = Record<string, unknown>

const MIB = 1024 * 1024
/** Unit size flags of the plan: a unit above these needs a decision before the freeze. */
const FLAG_8_MIB = 8 * MIB
const FLAG_64_MIB = 64 * MIB
/** The boot-time inlay collector's per-owner id cap (`MAX_UNIT_IDS`); the codec copies none. */
const OLD_COLLECTOR_ID_CAP = 4096
/**
 * Candidate chunk-entry counts for a chat. The format has no limit: `chunks` is a
 * list inside the shard entry. 2060 is the plan's own example of a 50,000-message
 * chat (about 120 KB of refs in one entry), so it is the primary threshold; the
 * others show how the population falls off around it.
 */
const CHUNK_COUNT_THRESHOLDS = [256, 1024, 2060, 4096, 16384] as const
/** A chat entry's `chunks` list above this many serialised bytes would make the shard entry itself large. */
const CHUNK_LIST_BYTES_THRESHOLD = MIB
const FLAG_LIST_LIMIT = 100

//#region input contract
export type ColdUnavailable = 'missing' | 'over-parse-limit' | 'parse-failed' | 'not-retained'

export type ColdRead =
    | { status: 'ok', value: unknown }
    | { status: 'unavailable', reason: ColdUnavailable }

/** Where the census reads cold units from: the bodies the single container pass retained. */
export interface ColdBodies {
    read(key: string): ColdRead
}

export interface CensusOptions {
    /** The decoded database; never mutated. */
    decoded: Rec
    cold: ColdBodies
    /** Called with the process RSS at stage boundaries. */
    sample?: (stage: string) => void
    /** Progress text for stderr. */
    progress?: (text: string) => void
}
//#endregion

//#region statistics
function percentile(sortedAscending: readonly number[], p: number): number {
    if (sortedAscending.length === 0) {
        return 0
    }
    const rank = Math.max(Math.ceil(p * sortedAscending.length) - 1, 0)
    return sortedAscending[Math.min(rank, sortedAscending.length - 1)]
}

export interface DistSummary {
    count: number
    max: number
    p50: number
    p95: number
    p99: number
    top10: { ordinal: string, value: number }[]
}

class Dist {
    private readonly values: number[] = []
    private readonly ordinals: string[] = []

    add(ordinal: string, value: number): void {
        this.ordinals.push(ordinal)
        this.values.push(value)
    }

    summary(): DistSummary {
        const sorted = [...this.values].sort((a, b) => a - b)
        const order = this.values.map((_, i) => i).sort((a, b) => this.values[b] - this.values[a])
        return {
            count: sorted.length,
            max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
            p50: percentile(sorted, 0.5),
            p95: percentile(sorted, 0.95),
            p99: percentile(sorted, 0.99),
            top10: order.slice(0, 10).map(i => ({ ordinal: this.ordinals[i], value: this.values[i] })),
        }
    }
}

function distOf(map: Map<string, Dist>, name: string): Dist {
    let dist = map.get(name)
    if (dist === undefined) {
        dist = new Dist()
        map.set(name, dist)
    }
    return dist
}

function summaries(map: Map<string, Dist>): Record<string, DistSummary> {
    return Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, dist]) => [name, dist.summary()]))
}

function bump(counts: Map<string, number>, key: string, by = 1): void {
    counts.set(key, (counts.get(key) ?? 0) + by)
}

function countsOut(counts: Map<string, number>): Record<string, number> {
    return Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}
//#endregion

//#region plain-data helpers
function asRec(value: unknown): Rec | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null
}

function asArr(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

/** Error class and code only: a codec message names characters and keys. */
function reasonOf(error: unknown): string {
    if (error instanceof CodecError) {
        return `${error.name}:${error.code}`
    }
    return error instanceof Error ? error.name : 'non-error-thrown'
}

function bodyOf<T>(unit: EncodedUnit, type: UnitType): T | null {
    const parsed = readUnit(unit.bytes, type)
    return parsed.status === 'ok' || parsed.status === 'stale' ? (parsed.value.body as unknown as T) : null
}

const UNIT_KIND_NAMES: Record<number, string> = Object.fromEntries(Object.entries(UNIT_TYPE).map(([name, id]) => [id, name]))
//#endregion

//#region residual normalisations
/**
 * Field names the codec's own schema knows (the partitions, the moved, derived,
 * volatile and tail fields, and the container fields of a character and chat).
 * A residual difference is reported by path only when every field segment is in
 * this set; any other path is `unknown-field`.
 */
const KNOWN_FIELD_NAMES: ReadonlySet<string> = new Set<string>([
    ...CONFIG_PARTITIONED_FIELDS, ...LORE_FIELDS, ...SCRIPT_FIELDS, ...DERIVED_COLD_FIELDS, ...VOLATILE_CHARACTER_FIELDS,
    ...ENTRY_MOVED_FIELDS, ...TAIL_STATE_FIELDS, ...VOLATILE_CHAT_FIELDS, 'chats', 'message',
])

type DiffKind = 'removed' | 'added' | 'changed' | 'array-length'

function isContainer(value: unknown): value is object {
    return typeof value === 'object' && value !== null
}

/**
 * Differences between the input and what the codec returns, counted into
 * `into` under `<kind>:<path>` or `<kind>:unknown-field`. Array positions are
 * written `[]`. Primitives are compared with `Object.is`, so NaN, -0 and
 * `undefined` against a stored value show up as the normalisations they are.
 */
function diffInto(into: Map<string, number>, input: unknown, output: unknown, path: string[], known: boolean): number {
    let found = 0
    const record = (kind: DiffKind, segments: string[], isKnown: boolean) => {
        bump(into, `${kind}:${isKnown ? segments.join('.') || '(root)' : 'unknown-field'}`)
        found++
    }
    if (!isContainer(input) || !isContainer(output)) {
        if (!Object.is(input, output)) {
            record('changed', path, known)
        }
        return found
    }
    if (Array.isArray(input) !== Array.isArray(output)) {
        record('changed', path, known)
        return found
    }
    if (Array.isArray(input) && Array.isArray(output)) {
        if (input.length !== output.length) {
            record('array-length', path, known)
        }
        const shared = Math.min(input.length, output.length)
        for (let i = 0; i < shared; i++) {
            found += diffInto(into, input[i], output[i], [...path, '[]'], known)
        }
        return found
    }
    const a = input as Rec
    const b = output as Rec
    for (const key of Object.keys(a)) {
        const isKnown = known && KNOWN_FIELD_NAMES.has(key)
        if (!Object.hasOwn(b, key)) {
            record('removed', [...path, key], isKnown)
        } else {
            found += diffInto(into, a[key], b[key], [...path, key], isKnown)
        }
    }
    for (const key of Object.keys(b)) {
        if (!Object.hasOwn(a, key)) {
            record('added', [...path, key], known && KNOWN_FIELD_NAMES.has(key))
        }
    }
    return found
}

class ResidualStats {
    private readonly byKind = new Map<string, { owners: number, ownersWithDifferences: number, differences: number, paths: Map<string, number> }>()
    readonly assembleFailures = new Map<string, number>()

    compare(kind: string, input: unknown, output: unknown): void {
        let stats = this.byKind.get(kind)
        if (stats === undefined) {
            stats = { owners: 0, ownersWithDifferences: 0, differences: 0, paths: new Map() }
            this.byKind.set(kind, stats)
        }
        stats.owners++
        const found = diffInto(stats.paths, input, output, [], true)
        stats.differences += found
        if (found > 0) {
            stats.ownersWithDifferences++
        }
    }

    out(): Rec {
        return {
            byUnitKind: Object.fromEntries([...this.byKind.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([kind, s]) => [kind, {
                owners: s.owners,
                ownersWithDifferences: s.ownersWithDifferences,
                differences: s.differences,
                paths: countsOut(s.paths),
            }])),
            assembleFailuresByReason: countsOut(this.assembleFailures),
            note: 'input is the value handed to the encoder (cold chats re-attached); output is what assemble returns; a path is shown only when every field segment is in the codec schema, else unknown-field',
        }
    }
}
//#endregion

//#region list recording
type OwnerKind = 'character' | 'module' | 'config'

class InlayKindStats {
    owners = 0
    ownersWithAny = 0
    ownersOverCap = 0
    ownersOverflowed = 0
    ids = new Dist()
    uuidIds = 0
    assetShapedIds = 0
    otherIds = 0
    uuidPerOwner = new Dist()
    assetShapedPerOwner = new Dist()
    otherPerOwner = new Dist()

    add(ordinal: string, full: InlayList, written: InlayList | null): void {
        const uuid = full.u.length
        const asset = splitHashStems(full.h).length
        const other = full.o.length
        const total = uuid + asset + other
        this.owners++
        if (total > 0) {
            this.ownersWithAny++
        }
        if (total > OLD_COLLECTOR_ID_CAP) {
            this.ownersOverCap++
        }
        if (written !== null && written.x === true) {
            this.ownersOverflowed++
        }
        this.ids.add(ordinal, total)
        this.uuidIds += uuid
        this.assetShapedIds += asset
        this.otherIds += other
        this.uuidPerOwner.add(ordinal, uuid)
        this.assetShapedPerOwner.add(ordinal, asset)
        this.otherPerOwner.add(ordinal, other)
    }

    out(): Rec {
        return {
            owners: this.owners,
            ownersWithAnyInlayId: this.ownersWithAny,
            idsPerOwner: this.ids.summary(),
            ownersAbove4096Ids: this.ownersOverCap,
            ownersWrittenAsOverflow: this.ownersOverflowed,
            idShapes: {
                uuid: { total: this.uuidIds, perOwner: this.uuidPerOwner.summary() },
                assetShaped: { total: this.assetShapedIds, perOwner: this.assetShapedPerOwner.summary() },
                other: { total: this.otherIds, perOwner: this.otherPerOwner.summary() },
            },
        }
    }
}

class AssetKindStats {
    owners = 0
    l = new Dist()
    h = new Dist()

    add(ordinal: string, list: AssetList): void {
        this.owners++
        this.l.add(ordinal, list.l.length)
        this.h.add(ordinal, list.h.length / HASH_STEM_CHARS)
    }

    out(): Rec {
        return { owners: this.owners, literalNames: this.l.summary(), hashStems: this.h.summary() }
    }
}

/**
 * The real list derivation, wrapped to record what each owner's lists hold. The
 * inlay body the codec writes comes from the real derivation with the default
 * size parameter; a second derivation of the same owner without a size limit
 * gives the full id counts even when the written body is the overflow marker.
 */
class RecordingLists implements ListDerivation {
    private readonly written = createListDerivation()
    private readonly unlimited = createListDerivation({ maxInlayBodyBytes: Number.MAX_SAFE_INTEGER })
    /** Ordinal of the character being encoded; modules are numbered in encode order. */
    characterOrdinal = ''
    /** Config and module lists are recorded only while the fixed part is encoded: every per-owner encode derives a throwaway config list too. */
    recordFixed = false
    private moduleSeq = 0

    readonly inlays: Record<OwnerKind, InlayKindStats> = { character: new InlayKindStats(), module: new InlayKindStats(), config: new InlayKindStats() }
    readonly assets: Record<OwnerKind, AssetKindStats> = { character: new AssetKindStats(), module: new AssetKindStats(), config: new AssetKindStats() }

    configAssets: ListDerivation['configAssets'] = (owner) => {
        const list = this.written.configAssets(owner)
        if (this.recordFixed) {
            this.assets.config.add('config', list)
        }
        return list
    }

    configInlays: ListDerivation['configInlays'] = (owner) => {
        const list = this.written.configInlays(owner)
        if (this.recordFixed) {
            this.inlays.config.add('config', this.unlimited.configInlays(owner), list)
        }
        return list
    }

    characterAssets: ListDerivation['characterAssets'] = (owner) => {
        const list = this.written.characterAssets(owner)
        this.assets.character.add(this.characterOrdinal, list)
        return list
    }

    characterInlays: ListDerivation['characterInlays'] = (owner) => {
        const list = this.written.characterInlays(owner)
        const full = this.unlimited.characterInlays(owner)
        if (full !== null) {
            this.inlays.character.add(this.characterOrdinal, full, list)
        }
        return list
    }

    moduleAssets: ListDerivation['moduleAssets'] = (owner) => {
        const list = this.written.moduleAssets(owner)
        this.assets.module.add(`module#${this.moduleSeq}`, list)
        return list
    }

    moduleInlays: ListDerivation['moduleInlays'] = (owner) => {
        const list = this.written.moduleInlays(owner)
        const full = this.unlimited.moduleInlays(owner)
        if (full !== null) {
            this.inlays.module.add(`module#${this.moduleSeq}`, full, list)
        }
        this.moduleSeq++
        return list
    }
}
//#endregion

//#region re-attaching cold storage
type Reattached = { status: 'attached', character: Rec, stubRestored: boolean, chatsRestored: number } | { status: 'refused', reason: string }

function isStub(slot: Rec): slot is Rec & { coldstorage: string } {
    return typeof slot.coldstorage === 'string' && slot.coldstorage.length > 0
}

/**
 * The character as the app holds it once its archived data is loaded: a stub is
 * replaced by its unit's character with the stub's trash and interaction state,
 * and every chat whose first message is a cold pointer gets its messages and
 * side fields from its chat unit (the same rule `preLoadChat` applies). A unit
 * that is not available or not shaped like its kind refuses the character, with
 * the reason; the codec would refuse a stub or pointer chat anyway.
 */
function reattach(slot: Rec, cold: ColdBodies): Reattached {
    let base: Rec = slot
    let stubRestored = false
    if (isStub(slot)) {
        const read = cold.read(slot.coldstorage)
        if (read.status !== 'ok') {
            return { status: 'refused', reason: `character-unit-${read.reason}` }
        }
        const unit = asRec(read.value)
        const body = asRec(unit?.character)
        if (body === null) {
            return { status: 'refused', reason: 'character-unit-malformed' }
        }
        base = applyStubStateOnRestore(slot as unknown as Slot, { ...body } as unknown as Slot) as unknown as Rec
        stubRestored = true
    }
    let chatsRestored = 0
    const chats: unknown[] = []
    for (const chat of asArr(base.chats)) {
        const holder = asRec(chat)
        const messages = asArr(holder?.message)
        const first = asRec(messages[0])
        const data = first?.data
        if (holder === null || typeof data !== 'string' || !data.startsWith(coldStorageHeader)) {
            chats.push(chat)
            continue
        }
        const read = cold.read(data.slice(coldStorageHeader.length))
        if (read.status !== 'ok') {
            return { status: 'refused', reason: `chat-unit-${read.reason}` }
        }
        const tail = messages.slice(1)
        const value = read.value
        if (Array.isArray(value)) {
            chats.push({ ...holder, message: [...value, ...tail] })
        } else {
            const blob = asRec(value)
            if (blob === null || !Array.isArray(blob.message)) {
                return { status: 'refused', reason: 'chat-unit-malformed' }
            }
            const restored: Rec = { ...holder, message: [...blob.message, ...tail] }
            for (const name of ['hypaV2Data', 'hypaV3Data', 'scriptstate', 'localLore']) {
                if (blob[name] !== undefined) {
                    restored[name] = blob[name]
                }
            }
            chats.push(restored)
        }
        chatsRestored++
    }
    return { status: 'attached', character: { ...base, chats }, stubRestored, chatsRestored }
}
//#endregion

//#region census
interface Flag { kind: string, ordinal: string, bytes: number }

class Census {
    readonly unitSizes = new Map<string, Dist>()
    readonly above8MiB: Flag[] = []
    readonly above64MiB: Flag[] = []
    above8MiBCount = 0
    above64MiBCount = 0
    readonly residuals = new ResidualStats()
    readonly lists = new RecordingLists()

    // chats
    readonly chunksPerChat = new Dist()
    readonly chatCoreBytes = new Dist()
    readonly largestMessage = new Dist()
    readonly messagesPerChat = new Dist()
    readonly chunkListBytes = new Dist()
    readonly chatsAboveChunkCount = new Map<number, number>(CHUNK_COUNT_THRESHOLDS.map(t => [t, 0]))
    chatsAboveChunkListBytes = 0
    chats = 0

    // cores
    readonly characterCoreF = new Dist()
    readonly chatCoreF = new Dist()
    readonly shardEntryBytes = new Dist()

    // owners
    ownersSeen = 0
    ownersEncoded = 0
    stubsRestored = 0
    chatsRestored = 0
    readonly skipped = new Map<string, number>()
    readonly entries: ShardEntry[] = []

    unit(kind: string, ordinal: string, bytes: number): void {
        distOf(this.unitSizes, kind).add(ordinal, bytes)
        if (bytes > FLAG_8_MIB) {
            this.above8MiBCount++
            if (this.above8MiB.length < FLAG_LIST_LIMIT) {
                this.above8MiB.push({ kind, ordinal, bytes })
            }
        }
        if (bytes > FLAG_64_MIB) {
            this.above64MiBCount++
            if (this.above64MiB.length < FLAG_LIST_LIMIT) {
                this.above64MiB.push({ kind, ordinal, bytes })
            }
        }
    }

    /** Encodes one re-attached character on its own and measures its units; the units are dropped on return. */
    measureCharacter(character: Rec, position: number): void {
        const ordinal = `character#${position}`
        this.lists.characterOrdinal = ordinal
        const shell = { characters: [character], botPresets: [] } as unknown as Database
        const tree = encodeDatabase(shell, { env: defaultKeyEnv, lists: this.lists, seq: 1, createdAt: Date.now(), previous: null })
        const shards = tree.index.objects?.shards ?? []
        const entry = shards.flatMap(shard => shard.entries)[0]
        if (entry === undefined) {
            throw new Error('the encode produced no shard entry')
        }
        const byTail = new Map<string, EncodedUnit>(tree.units.map(unit => [unit.ref[0], unit]))
        const sized = (kind: string, name: string, ref: Ref | null): EncodedUnit | null => {
            if (ref === null) {
                return null
            }
            const unit = byTail.get(ref[0])
            if (unit === undefined) {
                return null
            }
            this.unit(kind, name, unit.bytes.length)
            return unit
        }

        const core = sized('characterCore', ordinal, entry.core)
        sized('lore', ordinal, entry.lore)
        sized('scripts', ordinal, entry.scripts)
        sized('assetList', ordinal, entry.al)
        sized('inlayList', ordinal, entry.il)
        if (core !== null) {
            const body = bodyOf<CharacterCoreBody>(core, UNIT_TYPE.characterCore)
            if (body !== null) {
                this.characterCoreF.add(ordinal, utf8Length(canonicalJson(body.f)))
            }
        }

        entry.chats.forEach((chat, index) => {
            const chatOrdinal = `${ordinal}/chat#${index}`
            this.chats++
            this.chunksPerChat.add(chatOrdinal, chat.chunks.length)
            for (const threshold of CHUNK_COUNT_THRESHOLDS) {
                if (chat.chunks.length > threshold) {
                    this.chatsAboveChunkCount.set(threshold, (this.chatsAboveChunkCount.get(threshold) ?? 0) + 1)
                }
            }
            const listBytes = utf8Length(JSON.stringify(chat.chunks))
            this.chunkListBytes.add(chatOrdinal, listBytes)
            if (listBytes > CHUNK_LIST_BYTES_THRESHOLD) {
                this.chatsAboveChunkListBytes++
            }
            const chatCore = sized('chatCore', chatOrdinal, chat.core)
            if (chatCore !== null) {
                this.chatCoreBytes.add(chatOrdinal, chatCore.bytes.length)
                const body = bodyOf<ChatCore>(chatCore, UNIT_TYPE.chatCore)
                if (body !== null) {
                    this.chatCoreF.add(chatOrdinal, utf8Length(canonicalJson(body.f)))
                }
            }
            let messages = 0
            let largest = 0
            chat.chunks.forEach((ref, k) => {
                const unit = sized('chatChunk', `${chatOrdinal}/chunk#${k}`, ref)
                const body = unit === null ? null : bodyOf<ChatChunk>(unit, UNIT_TYPE.chatChunk)
                if (body !== null) {
                    messages += body.msgs.length
                    for (const message of body.msgs) {
                        largest = Math.max(largest, utf8Length(canonicalJson(message)))
                    }
                }
            })
            this.messagesPerChat.add(chatOrdinal, messages)
            this.largestMessage.add(chatOrdinal, largest)
        })
        this.shardEntryBytes.add(ordinal, utf8Length(JSON.stringify(entry)))

        try {
            const assembled = assembleCharacter(entry, unitMapSource(tree.units))
            this.compareCharacter(character, assembled)
        } catch (error) {
            bump(this.residuals.assembleFailures, `character:${reasonOf(error)}`)
        }
        this.entries.push(entry)
    }

    /** The character's residual differences, split by the unit kind the path belongs to. */
    private compareCharacter(input: Rec, output: JsonObject): void {
        const partition = (source: Rec, pick: (key: string) => boolean): Rec => Object.fromEntries(Object.keys(source).filter(pick).map(key => [key, source[key]]))
        const out = output as Rec
        const kindOfField = (key: string): string => key === 'chats' ? 'chat'
            : (LORE_FIELDS as readonly string[]).includes(key) ? 'lore'
                : (SCRIPT_FIELDS as readonly string[]).includes(key) ? 'scripts' : 'characterCore'
        for (const kind of ['characterCore', 'lore', 'scripts', 'chat']) {
            this.residuals.compare(kind, partition(input, key => kindOfField(key) === kind), partition(out, key => kindOfField(key) === kind))
        }
    }
}

function tailMap(tree: EncodedTree): Map<string, EncodedUnit> {
    return new Map(tree.units.map(unit => [unit.ref[0], unit]))
}

function resolvePluginStorage(decoded: Rec, cold: ColdBodies): { stored: Rec, resolved: Rec, coldMappingKeys: number, coldResolved: number, coldUnavailable: Map<string, number>, shadowed: number } {
    const stored = asRec(decoded.pluginCustomStorage) ?? {}
    const mapping = asRec(stored._coldplugin)
    const resolved: Rec = { ...stored }
    const unavailable = new Map<string, number>()
    let resolvedCount = 0
    let shadowed = 0
    for (const key of Object.keys(mapping ?? {})) {
        const coldId = mapping?.[key]
        if (typeof coldId !== 'string') {
            bump(unavailable, 'mapping-value-not-a-string')
            continue
        }
        const read = cold.read(coldId)
        if (read.status !== 'ok') {
            bump(unavailable, read.reason)
            continue
        }
        if (Object.hasOwn(stored, key)) {
            shadowed++
            continue
        }
        resolved[key] = read.value ?? null
        resolvedCount++
    }
    return { stored, resolved, coldMappingKeys: Object.keys(mapping ?? {}).length, coldResolved: resolvedCount, coldUnavailable: unavailable, shadowed }
}

function measureFixed(census: Census, decoded: Rec, resolved: Rec): { tree: EncodedTree, pluginStorage: Rec, pluginValueInlays: InlayKindStats } {
    const fixedDb = { ...decoded, characters: [], pluginCustomStorage: resolved } as unknown as Database
    census.lists.recordFixed = true
    const tree = encodeDatabase(fixedDb, { env: defaultKeyEnv, lists: census.lists, seq: 1, createdAt: Date.now(), previous: null })
    census.lists.recordFixed = false
    const byTail = tailMap(tree)
    const fixed = tree.manifest.fixed
    const sized = (kind: string, ordinal: string, ref: Ref): EncodedUnit | null => {
        const unit = byTail.get(ref[0])
        if (unit === undefined) {
            return null
        }
        census.unit(kind, ordinal, unit.bytes.length)
        return unit
    }
    sized('configRoot', 'config', fixed.config)
    sized('assetList', 'config', fixed.configAl)
    sized('inlayList', 'config', fixed.il)
    sized('statics', 'statics', fixed.statics)
    sized('loadouts', 'loadouts', fixed.loadouts)
    sized('moduleIndex', 'moduleIndex', fixed.moduleIndex)
    fixed.presets.forEach((ref, i) => sized('preset', `preset#${i}`, ref))
    fixed.plugins.forEach((ref, i) => sized('plugin', `plugin#${i}`, ref))
    const index: ModuleIndex | undefined = tree.index.objects?.moduleIndex
    index?.entries.forEach((entry, i) => {
        sized('module', `module#${i}`, entry.unit)
        sized('assetList', `module#${i}`, entry.al)
        if (entry.il !== null) {
            sized('inlayList', `module#${i}`, entry.il)
        }
    })

    const keyIndex = new Map(Object.keys(resolved).map((key, i) => [key, i]))
    const buckets: { keys: number, bucketBytes: number, valueBytes: number }[] = []
    const valueSizes = new Dist()
    fixed.pluginStorage.refs.forEach((ref, b) => {
        const bucketUnit = sized('pluginStorageBucket', `bucket#${b}`, ref)
        const body = bucketUnit === null ? null : bodyOf<PluginBucket>(bucketUnit, UNIT_TYPE.pluginStorageBucket)
        let valueBytes = 0
        for (const entry of body?.entries ?? []) {
            const ordinal = `pluginStorageKey#${keyIndex.get(entry.k) ?? -1}`
            const value = sized('pluginStorageValue', ordinal, entry.ref)
            if (value !== null) {
                valueBytes += value.bytes.length
                valueSizes.add(ordinal, value.bytes.length)
            }
        }
        buckets.push({ keys: body?.entries.length ?? 0, bucketBytes: bucketUnit?.bytes.length ?? 0, valueBytes })
    })

    const bucketKeys = new Dist()
    const bucketValueBytes = new Dist()
    buckets.forEach((bucket, b) => {
        bucketKeys.add(`bucket#${b}`, bucket.keys)
        bucketValueBytes.add(`bucket#${b}`, bucket.valueBytes)
    })

    // Residual differences of the fixed part, by the unit kind each top-level field lives in.
    try {
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as Rec
        const kindOfField = (key: string): string => key === 'botPresets' ? 'preset'
            : key === 'plugins' || key === 'pluginV2' ? 'plugin'
                : key === 'pluginCustomStorage' ? 'pluginStorage'
                    : key === 'modules' ? 'module'
                        : key === 'loadouts' ? 'loadouts'
                            : key === 'statics' ? 'statics'
                                : key === 'characterOrder' ? 'order' : 'configRoot'
        const kinds = new Set<string>()
        for (const key of new Set([...Object.keys(fixedDb as unknown as Rec), ...Object.keys(assembled)])) {
            if (key !== 'characters') {
                kinds.add(kindOfField(key))
            }
        }
        const input = fixedDb as unknown as Rec
        for (const kind of kinds) {
            const pick = (source: Rec): Rec => Object.fromEntries(Object.keys(source).filter(key => key !== 'characters' && kindOfField(key) === kind).map(key => [key, source[key]]))
            census.residuals.compare(kind, pick(input), pick(assembled))
        }
    } catch (error) {
        bump(census.residuals.assembleFailures, `fixed:${reasonOf(error)}`)
    }

    const pluginValueInlays = new InlayKindStats()
    Object.keys(resolved).forEach((key, i) => {
        pluginValueInlays.add(`pluginStorageKey#${i}`, deriveInlayList([resolved[key]], { maxInlayBodyBytes: Number.MAX_SAFE_INTEGER }), null)
    })

    return {
        tree,
        pluginStorage: {
            bucketCount: buckets.length,
            keysPerBucket: bucketKeys.summary(),
            valueBytesPerBucket: bucketValueBytes.summary(),
            perBucket: buckets.map((bucket, b) => ({ ordinal: `bucket#${b}`, ...bucket })),
            valueUnitBytes: valueSizes.summary(),
            largestValueUnitBytes: valueSizes.summary().max,
        },
        pluginValueInlays,
    }
}

/** Shards, the order unit and the manifest, built from every encoded owner's entry with the real shard grouping and manifest builder. */
function measureTail(census: Census, fixed: EncodedTree, decoded: Rec): Rec {
    const sink = new UnitSink(defaultKeyEnv, null)
    const shardBodies: Shard[] = groupIntoShards(census.entries, SHARD_COUNT)
    const shardUnits = shardBodies.map((body, i) => sink.put(`shard:${i}`, UNIT_TYPE.shard, body, 'shard'))
    const shardBytes = new Dist()
    const entriesPerShard = new Dist()
    shardUnits.forEach((unit, i) => {
        census.unit('shard', `shard#${i}`, unit.bytes.length)
        shardBytes.add(`shard#${i}`, unit.bytes.length)
        entriesPerShard.add(`shard#${i}`, shardBodies[i].entries.length)
    })
    const characterOrder = toPlainJson(decoded.characterOrder)
    const orderBody: OrderBody = { v: 1, chars: census.entries.map(entry => entry.u) }
    if (characterOrder !== undefined) {
        orderBody.characterOrder = characterOrder
    }
    const order = sink.put('order', UNIT_TYPE.order, orderBody)
    census.unit('order', 'order', order.bytes.length)
    const f = fixed.manifest.fixed
    const manifest = buildManifest({
        seq: 1,
        createdAt: Date.now(),
        shards: shardUnits.map(unit => unit.ref),
        config: f.config,
        configAl: f.configAl,
        il: f.il,
        statics: f.statics,
        order: order.ref,
        loadouts: f.loadouts,
        moduleIndex: f.moduleIndex,
        presets: f.presets,
        plugins: f.plugins,
        pluginStorageRefs: f.pluginStorage.refs,
    })
    const manifestUnit = sink.putFresh('manifest', UNIT_TYPE.manifest, manifest, 'manifest')
    census.unit('manifest', 'manifest', manifestUnit.bytes.length)
    return {
        shardCount: shardBodies.length,
        shardEntriesTotal: census.entries.length,
        shardBytes: shardBytes.summary(),
        entriesPerShard: entriesPerShard.summary(),
        shardEntryJsonBytes: census.shardEntryBytes.summary(),
        orderUnitBytes: order.bytes.length,
        manifestBytes: manifestUnit.bytes.length,
        note: 'shards, order and manifest are built from the per-owner entries and the fixed encode with the real grouping and manifest builder; owners that could not be encoded are absent',
    }
}

export async function runStore2Census(options: CensusOptions): Promise<Rec> {
    const startedAt = Date.now()
    const census = new Census()
    const rssSamples: number[] = []
    const sampleRss = () => rssSamples.push(process.memoryUsage().rss)
    const decoded = options.decoded
    const timing = { fixedMs: 0, ownersMs: 0, tailMs: 0 }

    const plugin = resolvePluginStorage(decoded, options.cold)
    let fixedSection: Rec = {}
    let pluginSection: Rec = {}
    let pluginValueInlays = new InlayKindStats()
    let fixedTree: EncodedTree | null = null
    let fixedFailure: string | null = null
    const fixedStart = Date.now()
    try {
        const fixed = measureFixed(census, decoded, plugin.resolved)
        fixedTree = fixed.tree
        pluginSection = fixed.pluginStorage
        pluginValueInlays = fixed.pluginValueInlays
        fixedSection = { modules: asArr(decoded.modules).length, presets: asArr(decoded.botPresets).length, plugins: asArr(decoded.plugins).length + asArr(decoded.pluginV2).length }
    } catch (error) {
        fixedFailure = reasonOf(error)
    }
    timing.fixedMs = Date.now() - fixedStart
    sampleRss()
    options.sample?.('store2 fixed part encoded')

    const ownersStart = Date.now()
    let lastProgress = Date.now()
    const characters = asArr(decoded.characters)
    for (let position = 0; position < characters.length; position++) {
        census.ownersSeen++
        const slot = asRec(characters[position])
        if (slot === null) {
            bump(census.skipped, 'encode:CodecInputError:input')
            continue
        }
        const attached = reattach(slot, options.cold)
        if (attached.status === 'refused') {
            bump(census.skipped, attached.reason)
            continue
        }
        try {
            census.measureCharacter(attached.character, position)
            census.ownersEncoded++
            if (attached.stubRestored) {
                census.stubsRestored++
            }
            census.chatsRestored += attached.chatsRestored
        } catch (error) {
            bump(census.skipped, `encode:${reasonOf(error)}`)
        }
        if (position % 25 === 0) {
            sampleRss()
        }
        if (options.progress !== undefined && Date.now() - lastProgress > 10_000) {
            options.progress(`store2 census: owner ${position + 1} / ${characters.length}`)
            lastProgress = Date.now()
        }
    }
    timing.ownersMs = Date.now() - ownersStart
    sampleRss()
    options.sample?.('store2 owners encoded')

    const tailStart = Date.now()
    let tailSection: Rec = {}
    let tailFailure: string | null = null
    if (fixedTree !== null) {
        try {
            tailSection = measureTail(census, fixedTree, decoded)
        } catch (error) {
            tailFailure = reasonOf(error)
        }
    }
    timing.tailMs = Date.now() - tailStart
    sampleRss()
    options.sample?.('store2 shards and manifest built')

    const unitKinds = summaries(census.unitSizes)
    const chunkThresholds = Object.fromEntries(CHUNK_COUNT_THRESHOLDS.map(t => [String(t), census.chatsAboveChunkCount.get(t) ?? 0]))
    return {
        scope: {
            charactersInDatabase: characters.length,
            ownersAttempted: census.ownersSeen,
            ownersEncoded: census.ownersEncoded,
            ownersSkippedByReason: countsOut(census.skipped),
            stubCharactersReattached: census.stubsRestored,
            coldChatsReattached: census.chatsRestored,
            fixedPartEncoded: fixedTree !== null,
            fixedPartFailure: fixedFailure,
            tailFailure,
            parts: fixedSection,
            note: 'an owner whose cold unit cannot be re-attached (missing, over the parse limit, unparsed, not retained or malformed) is counted by reason and skipped; one owner never fails the run',
        },
        unitFrameBytes: {
            measure: 'framed unit bytes (header, JSON payload, checksums); kinds are the codec unit type names',
            byKind: unitKinds,
            flags: {
                above8MiB: { count: census.above8MiBCount, listed: census.above8MiB.length, units: census.above8MiB },
                above64MiB: { count: census.above64MiBCount, listed: census.above64MiB.length, units: census.above64MiB },
                note: 'strictly above; the list is capped at 100 units',
            },
        },
        chats: {
            chats: census.chats,
            chunksPerChat: census.chunksPerChat.summary(),
            chatCoreFrameBytes: census.chatCoreBytes.summary(),
            messagesPerChat: census.messagesPerChat.summary(),
            largestMessageBytesPerChat: census.largestMessage.summary(),
            chunkListJsonBytesPerChat: census.chunkListBytes.summary(),
            chunkEntryThreshold: {
                rule: 'The format has no limit on chunk entries: the list is inside the shard entry. Thresholds are candidates; 2060 is the plan example (50,000 messages, about 120 KB of refs). A cx unit would be needed only if chats exist above the threshold chosen.',
                chatsWithMoreChunksThan: chunkThresholds,
                chatsWithChunkListAboveBytes: { threshold: CHUNK_LIST_BYTES_THRESHOLD, count: census.chatsAboveChunkListBytes },
            },
        },
        coreF: {
            characterCoreFJsonBytes: census.characterCoreF.summary(),
            chatCoreFJsonBytes: census.chatCoreF.summary(),
            note: 'JSON bytes of the f field of the core body (canonical JSON)',
        },
        shardsAndManifest: tailSection,
        pluginStorage: {
            storedKeys: Object.keys(plugin.stored).length,
            coldPluginMappingKeys: plugin.coldMappingKeys,
            coldPluginValuesResolved: plugin.coldResolved,
            coldPluginUnavailableByReason: countsOut(plugin.coldUnavailable),
            coldPluginKeysAlsoStored: plugin.shadowed,
            resolvedKeys: Object.keys(plugin.resolved).length,
            encodedWith: 'stored keys plus each cold plugin value brought in under its key; the _coldplugin mapping itself stays a stored value',
            ...pluginSection,
        },
        inlays: {
            scope: {
                characters: census.lists.inlays.character.out(),
                modules: census.lists.inlays.module.out(),
                config: census.lists.inlays.config.out(),
                pluginValues: pluginValueInlays.out(),
            },
            collectorCap: OLD_COLLECTOR_ID_CAP,
            note: 'id counts come from an unlimited derivation of the same owner; owners written as overflow are those the codec marks x:true under the default size parameter; pluginValues is a per-value view, the codec lists those ids under the config owner',
        },
        assetLists: {
            characters: census.lists.assets.character.out(),
            modules: census.lists.assets.module.out(),
            config: census.lists.assets.config.out(),
        },
        residualNormalisations: census.residuals.out(),
        timing: { ...timing, totalMs: Date.now() - startedAt },
        memory: { peakRssSampledBytes: Math.max(0, ...rssSamples), samples: rssSamples.length },
    }
}
//#endregion
