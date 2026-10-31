import type { JsonObject, JsonValue } from '../../blockFrame'
import { isStore2Key, STORE2_PREFIX } from '../../store/keyRules'
import { isHashStemRun } from './assetRefKey'
import { decodeFrame, encodeFrame } from './frame'
import { isOldDataKey, isSnapshotUnitKey, isStagingPrefix } from './keys'
import { encodeCanonicalJson } from './canonicalJson'
import {
    DELETION_SNAPSHOT_KINDS, STAGING_LABELS,
    type AltRecord, type AssetList, type ChatAltUnit, type ChatChunk, type ChatCore, type ChatEntry, type ChunkRef, type CommitKey, type ContentBody,
    type DeletionSnapshot, type DeletionSnapshotKind, type FenceRecord, type InlayList, type LegacyKeepFile, type LegacyList, type ListRef, type Manifest, type ModuleEntry,
    type ModuleIndex, type PluginBucket, type Ref, type Shard, type SnapshotPointer, type ShardEntry, type StagingLabel, type SweepRecord,
    type UnitBody,
} from './types'
import { ASSET_REF_V, BODY_V, FRAME_FMT, IL_REF_V, KNOWN_REQ, UNIT_TYPE, type UnitType } from './versions'

/**
 * Parsers of the unit bodies. Each returns `ok` with a typed value, `damaged`
 * (bad JSON shape), `too-new` (a version or `req` token this build does not
 * know) or, for the derived lists only, `stale` (version below this build's)
 * and `unreadable` (version above it: the list cannot be trusted, so a pass
 * that needs it reports incomplete and deletes nothing).
 *
 * Unknown fields are kept at every level on the parsed object, so a writer that
 * rebuilds an object from a parsed one carries them (`carryUnknownFields`).
 */

export type Parsed<T> =
    | { status: 'ok', value: T }
    | { status: 'stale', value: T, reason: string }
    | { status: 'damaged', reason: string }
    | { status: 'too-new', reason: string }
    | { status: 'unreadable', reason: string }

type Failure = 'damaged' | 'too-new' | 'unreadable'

class SchemaError extends Error {
    constructor(public readonly kind: Failure, message: string) {
        super(message)
        this.name = 'SchemaError'
    }
}

function bad(message: string): never {
    throw new SchemaError('damaged', message)
}

function guarded<T>(build: () => { value: T, stale?: string }): Parsed<T> {
    try {
        const built = build()
        return built.stale === undefined
            ? { status: 'ok', value: built.value }
            : { status: 'stale', value: built.value, reason: built.stale }
    } catch (error) {
        if (error instanceof SchemaError) {
            return { status: error.kind, reason: error.message }
        }
        throw error
    }
}

function plain<T>(build: () => T): Parsed<T> {
    return guarded(() => ({ value: build() }))
}

/** Field names each level of a non-derived object defines; everything else is an unknown field to keep. */
export const KNOWN_FIELDS = {
    commitKey: ['fmt', 'req', 'seq', 'epoch', 'current', 'retained', 'pins', 'staging', 'convertedFrom', 'convertedAt', 'snapshot'],
    commitSnapshot: ['key', 'digest', 'count'],
    commitCurrent: ['key', 'at'],
    commitPin: ['key', 'reason'],
    commitStaging: ['owner', 'prefix', 'startedAt', 'label'],
    manifest: ['fmt', 'req', 'seq', 'createdAt', 'shardCount', 'shards', 'fixed'],
    manifestFixed: ['config', 'configAl', 'il', 'statics', 'order', 'loadouts', 'moduleIndex', 'presets', 'plugins', 'pluginStorage', 'legacyKeep'],
    manifestPluginStorage: ['buckets', 'refs'],
    manifestLegacyKeep: ['unit', 'v', 'files'],
    manifestLegacyKeepFile: ['key', 'status'],
    shard: ['v', 'entries'],
    shardEntry: [
        'u', 'type', 'name', 'image', 'chaId', 'lastInteraction', 'trashTime', 'characters', 'creatorNotes', 'chatPage',
        'firstMsgIndex', 'tags', 'creator', 'core', 'lore', 'scripts', 'al', 'il', 'dsp', 'chats',
    ],
    chatEntry: ['cid', 'core', 'chunks', 'alt'],
    moduleIndex: ['v', 'entries'],
    moduleEntry: ['id', 'unit', 'al', 'il', 'name', 'description', 'namespace', 'icon', 'hideIcon', 'lowLevelAccess', 'mcp', 'hasToggle', 'dsp'],
    fenceRecord: ['v', 'at', 'priorCommits', 'keys', 'priorFences'],
    deletionSnapshot: ['v', 'kind', 'upstream', 'keys'],
    deletionUpstream: ['main', 'backups'],
    fencePriorCommit: ['at', 'bytes'],
    fencePriorFence: ['at', 'bytes'],
} as const

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function obj(value: JsonValue | undefined, where: string): JsonObject {
    if (!isPlainObject(value)) {
        bad(`${where} is not an object.`)
    }
    return value
}

function arr(value: JsonValue | undefined, where: string): JsonValue[] {
    if (!Array.isArray(value)) {
        bad(`${where} is not a list.`)
    }
    return value
}

function str(value: JsonValue | undefined, where: string): string {
    if (typeof value !== 'string') {
        bad(`${where} is not a string.`)
    }
    return value
}

function bool(value: JsonValue | undefined, where: string): boolean {
    if (typeof value !== 'boolean') {
        bad(`${where} is not a boolean.`)
    }
    return value
}

function int(value: JsonValue | undefined, where: string, min = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
        bad(`${where} is not a whole number of at least ${min}.`)
    }
    return value
}

function num(value: JsonValue | undefined, where: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        bad(`${where} is not a number.`)
    }
    return value
}

function strList(value: JsonValue | undefined, where: string): string[] {
    return arr(value, where).map((item, index) => str(item, `${where}[${index}]`))
}

function nullable<T>(value: JsonValue | undefined, read: (present: JsonValue) => T): T | null {
    return value === null ? null : read(value as JsonValue)
}

/** An own data property even for the key `__proto__`, which plain assignment would turn into a prototype change and lose. */
function setOwn(target: object, key: string, value: JsonValue): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** The fields of `raw` outside `known`, to be kept on the parsed object. */
function extras(raw: JsonObject, known: readonly string[]): JsonObject {
    const out: JsonObject = Object.create(null)
    for (const key of Object.keys(raw)) {
        if (!known.includes(key)) {
            setOwn(out, key, raw[key])
        }
    }
    return out
}

/**
 * Writer side of the unknown-field rule: returns `next` with every field of
 * `prev` that is neither in `known` nor already set on `next`. Use it at each
 * level of a rebuilt non-derived object (the parsers already keep the unknown
 * fields of nested objects on the parsed objects they return).
 */
export function carryUnknownFields<T extends object>(prev: object, next: T, known: readonly string[]): T {
    const source = prev as Record<string, JsonValue>
    const target = next as Record<string, JsonValue>
    for (const key of Object.keys(source)) {
        if (!known.includes(key) && !Object.hasOwn(target, key)) {
            setOwn(target, key, source[key])
        }
    }
    return next
}

function readRefValue(value: JsonValue | undefined, where: string): Ref {
    const tuple = arr(value, where)
    if (tuple.length < 3) {
        bad(`${where} is a tuple of fewer than three elements.`)
    }
    const tail = str(tuple[0], `${where}[0]`)
    if (!isStore2Key(STORE2_PREFIX + tail)) {
        bad(`${where}[0] is not a store2 key tail.`)
    }
    const bytes = int(tuple[1], `${where}[1]`)
    const crc = int(tuple[2], `${where}[2]`)
    if (crc > 0xFFFFFFFF) {
        bad(`${where}[2] is not a CRC32.`)
    }
    return [tail, bytes, crc, ...tuple.slice(3)]
}

function readTailedRef(value: JsonValue | undefined, where: string): Ref {
    return readRefValue(value, where)
}

function readListRef(value: JsonValue | undefined, where: string): ListRef {
    const ref = readRefValue(value, where)
    const v = int(ref[3], `${where}[3]`)
    return [ref[0], ref[1], ref[2], v, ...ref.slice(4)]
}

function readChunkRef(value: JsonValue | undefined, where: string): ChunkRef {
    const ref = readRefValue(value, where)
    const count = int(ref[3], `${where}[3]`)
    return [ref[0], ref[1], ref[2], count, ...ref.slice(4)]
}

function readKey(value: JsonValue | undefined, where: string): string {
    const key = str(value, where)
    if (!isStore2Key(key)) {
        bad(`${where} is not a store2 key.`)
    }
    return key
}

/** `fmt` above this build's is too-new before anything else is read; below 1 or not a whole number is damaged. */
function gateFmt(raw: JsonObject): void {
    const fmt = int(raw.fmt, 'fmt', 1)
    if (fmt > FRAME_FMT) {
        throw new SchemaError('too-new', `Format ${fmt} is newer than this build.`)
    }
}

function readReq(value: JsonValue | undefined): string[] {
    const req = strList(value, 'req')
    for (const token of req) {
        if (!KNOWN_REQ.has(token)) {
            throw new SchemaError('too-new', `The required feature "${token}" is unknown to this build.`)
        }
    }
    return req
}

/** `v` of a plain body: above this build's is too-new, below 1 is damaged. */
function gateV(raw: JsonObject, where: string): void {
    const v = int(raw.v, `${where}.v`, 1)
    if (v > BODY_V) {
        throw new SchemaError('too-new', `${where} version ${v} is newer than this build.`)
    }
}

function readStems(value: JsonValue | undefined, where: string): string {
    const stems = str(value, where)
    if (!isHashStemRun(stems)) {
        bad(`${where} is not a run of 43-character base64url stems.`)
    }
    return stems
}

function readStagingPrefix(value: JsonValue | undefined): string {
    const prefix = str(value, 'staging.prefix')
    if (!isStagingPrefix(prefix)) {
        bad('staging.prefix is not store2/g-<16 digits>-.')
    }
    return prefix
}

// ---- Type 1: commit key ----

const SNAPSHOT_DIGEST = /^[0-9a-f]{32}$/

/**
 * The snapshot pointer of a commit key, or `undefined` for an absent or malformed one. A pointer is a helper and never
 * a reason to refuse the key, so nothing here throws: a malformed pointer reads as absent, nothing carries its bytes,
 * and the next writer drops it. Members this build does not know stay on the parsed pointer.
 */
function readSnapshotPointer(value: JsonValue | undefined): SnapshotPointer | undefined {
    if (!isPlainObject(value)) {
        return undefined
    }
    const { key, digest, count } = value
    if (typeof key !== 'string' || !isSnapshotUnitKey(key)
        || typeof digest !== 'string' || !SNAPSHOT_DIGEST.test(digest)
        || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        return undefined
    }
    return { ...extras(value, KNOWN_FIELDS.commitSnapshot), key, digest, count }
}

function readCommitKey(raw: JsonObject): CommitKey {
    gateFmt(raw)
    const req = readReq(raw.req)
    const epoch = str(raw.epoch, 'epoch')
    if (!/^[0-9a-v]{26}$/.test(epoch)) {
        bad('epoch is not 26 digits of 0-9a-v.')
    }
    const current = nullable(raw.current, (value) => {
        const o = obj(value, 'current')
        return { ...extras(o, KNOWN_FIELDS.commitCurrent), key: readKey(o.key, 'current.key'), at: num(o.at, 'current.at') }
    })
    const retained = arr(raw.retained, 'retained').map((value, index) => {
        const o = obj(value, `retained[${index}]`)
        return { ...extras(o, KNOWN_FIELDS.commitCurrent), key: readKey(o.key, `retained[${index}].key`), at: num(o.at, `retained[${index}].at`) }
    })
    const pins = arr(raw.pins, 'pins').map((value, index) => {
        const o = obj(value, `pins[${index}]`)
        return { ...extras(o, KNOWN_FIELDS.commitPin), key: readKey(o.key, `pins[${index}].key`), reason: str(o.reason, `pins[${index}].reason`) }
    })
    const staging = nullable(raw.staging, (value) => {
        const o = obj(value, 'staging')
        const label = str(o.label, 'staging.label')
        if (!(STAGING_LABELS as readonly string[]).includes(label)) {
            bad('staging.label is not a known label.')
        }
        return {
            ...extras(o, KNOWN_FIELDS.commitStaging),
            owner: str(o.owner, 'staging.owner'),
            prefix: readStagingPrefix(o.prefix),
            startedAt: num(o.startedAt, 'staging.startedAt'),
            label: label as StagingLabel,
        }
    })
    const key: CommitKey = {
        ...extras(raw, KNOWN_FIELDS.commitKey),
        fmt: 1,
        req,
        seq: int(raw.seq, 'seq'),
        epoch,
        current,
        retained,
        pins,
        staging,
        convertedFrom: nullable(raw.convertedFrom, (value) => str(value, 'convertedFrom')),
        convertedAt: nullable(raw.convertedAt, (value) => num(value, 'convertedAt')),
    }
    const snapshot = readSnapshotPointer(raw.snapshot)
    if (snapshot !== undefined) {
        key.snapshot = snapshot
    }
    return key
}

export function parseCommitKey(value: JsonValue): Parsed<CommitKey> {
    return plain(() => readCommitKey(obj(value, 'commit key')))
}

// ---- Type 2: manifest ----

function readManifest(raw: JsonObject): Manifest {
    gateFmt(raw)
    const req = readReq(raw.req)
    const shardCount = int(raw.shardCount, 'shardCount', 1)
    const shards = arr(raw.shards, 'shards').map((value, index) => readTailedRef(value, `shards[${index}]`))
    if (shards.length !== shardCount) {
        bad('shards does not hold shardCount refs.')
    }
    const fixedRaw = obj(raw.fixed, 'fixed')
    const storageRaw = obj(fixedRaw.pluginStorage, 'fixed.pluginStorage')
    const buckets = int(storageRaw.buckets, 'fixed.pluginStorage.buckets')
    const bucketRefs = arr(storageRaw.refs, 'fixed.pluginStorage.refs').map((value, index) => readTailedRef(value, `fixed.pluginStorage.refs[${index}]`))
    if (bucketRefs.length !== buckets) {
        bad('fixed.pluginStorage.refs does not hold buckets refs.')
    }
    const legacyKeep = nullable(fixedRaw.legacyKeep, (value) => {
        const o = obj(value, 'fixed.legacyKeep')
        const files: LegacyKeepFile[] = arr(o.files, 'fixed.legacyKeep.files').map((entry, index) => {
            const f = obj(entry, `fixed.legacyKeep.files[${index}]`)
            const status = str(f.status, `fixed.legacyKeep.files[${index}].status`)
            if (status !== 'ok' && status !== 'unreadable' && status !== 'gone') {
                bad('A legacyKeep file status is ok, unreadable or gone.')
            }
            return { ...extras(f, KNOWN_FIELDS.manifestLegacyKeepFile), key: str(f.key, `fixed.legacyKeep.files[${index}].key`), status }
        })
        return {
            ...extras(o, KNOWN_FIELDS.manifestLegacyKeep),
            unit: readTailedRef(o.unit, 'fixed.legacyKeep.unit'),
            v: int(o.v, 'fixed.legacyKeep.v'),
            files,
        }
    })
    const fixed: Manifest['fixed'] = {
        ...extras(fixedRaw, KNOWN_FIELDS.manifestFixed),
        config: readTailedRef(fixedRaw.config, 'fixed.config'),
        configAl: readListRef(fixedRaw.configAl, 'fixed.configAl'),
        il: readListRef(fixedRaw.il, 'fixed.il'),
        statics: readTailedRef(fixedRaw.statics, 'fixed.statics'),
        order: readTailedRef(fixedRaw.order, 'fixed.order'),
        loadouts: readTailedRef(fixedRaw.loadouts, 'fixed.loadouts'),
        moduleIndex: readTailedRef(fixedRaw.moduleIndex, 'fixed.moduleIndex'),
        presets: arr(fixedRaw.presets, 'fixed.presets').map((value, index) => readTailedRef(value, `fixed.presets[${index}]`)),
        plugins: arr(fixedRaw.plugins, 'fixed.plugins').map((value, index) => readTailedRef(value, `fixed.plugins[${index}]`)),
        pluginStorage: { ...extras(storageRaw, KNOWN_FIELDS.manifestPluginStorage), buckets, refs: bucketRefs },
        legacyKeep,
    }
    return {
        ...extras(raw, KNOWN_FIELDS.manifest),
        fmt: 1,
        req,
        seq: int(raw.seq, 'seq'),
        createdAt: num(raw.createdAt, 'createdAt'),
        shardCount,
        shards,
        fixed,
    }
}

export function parseManifest(value: JsonValue): Parsed<Manifest> {
    return plain(() => readManifest(obj(value, 'manifest')))
}

// ---- Type 3: shard ----

function readChatEntry(value: JsonValue, where: string): ChatEntry {
    const o = obj(value, where)
    if (o.chunks === undefined) {
        bad(`${where}.chunks is required.`)
    }
    const chunks = arr(o.chunks, `${where}.chunks`).map((chunk, index) => readChunkRef(chunk, `${where}.chunks[${index}]`))
    if (chunks.length === 0) {
        bad(`${where}.chunks is empty: every chat has at least one chunk.`)
    }
    const entry: ChatEntry = { ...extras(o, KNOWN_FIELDS.chatEntry), cid: str(o.cid, `${where}.cid`), core: readTailedRef(o.core, `${where}.core`), chunks }
    // An empty list reads as none: the writer never emits one, and a hand-written shard that does means no alternatives.
    if (o.alt !== undefined) {
        const alt = arr(o.alt, `${where}.alt`).map((unit, index) => readChunkRef(unit, `${where}.alt[${index}]`))
        if (alt.length > 0) {
            entry.alt = alt
        }
    }
    return entry
}

function readShardEntry(value: JsonValue, where: string): ShardEntry {
    const o = obj(value, where)
    const type = str(o.type, `${where}.type`)
    if (type !== 'character' && type !== 'group') {
        bad(`${where}.type is character or group.`)
    }
    const entry: ShardEntry = {
        ...extras(o, KNOWN_FIELDS.shardEntry),
        u: str(o.u, `${where}.u`),
        type,
        name: str(o.name, `${where}.name`),
        chaId: str(o.chaId, `${where}.chaId`),
        creatorNotes: str(o.creatorNotes, `${where}.creatorNotes`),
        chatPage: int(o.chatPage, `${where}.chatPage`),
        firstMsgIndex: int(o.firstMsgIndex, `${where}.firstMsgIndex`, -1),
        core: readTailedRef(o.core, `${where}.core`),
        lore: nullable(o.lore, (v) => readTailedRef(v, `${where}.lore`)),
        scripts: nullable(o.scripts, (v) => readTailedRef(v, `${where}.scripts`)),
        al: readListRef(o.al, `${where}.al`),
        il: nullable(o.il, (v) => readListRef(v, `${where}.il`)),
        dsp: bool(o.dsp, `${where}.dsp`),
        chats: arr(o.chats, `${where}.chats`).map((chat, index) => readChatEntry(chat, `${where}.chats[${index}]`)),
    }
    if (o.image !== undefined) {
        entry.image = str(o.image, `${where}.image`)
    }
    if (o.lastInteraction !== undefined) {
        entry.lastInteraction = num(o.lastInteraction, `${where}.lastInteraction`)
    }
    if (o.trashTime !== undefined) {
        entry.trashTime = num(o.trashTime, `${where}.trashTime`)
    }
    if (o.characters !== undefined) {
        entry.characters = strList(o.characters, `${where}.characters`)
    }
    if (o.tags !== undefined) {
        entry.tags = strList(o.tags, `${where}.tags`)
    }
    if (o.creator !== undefined) {
        entry.creator = str(o.creator, `${where}.creator`)
    }
    return entry
}

export function parseShard(value: JsonValue): Parsed<Shard> {
    return plain(() => {
        const raw = obj(value, 'shard')
        gateV(raw, 'shard')
        return {
            ...extras(raw, KNOWN_FIELDS.shard),
            v: 1,
            entries: arr(raw.entries, 'entries').map((entry, index) => readShardEntry(entry, `entries[${index}]`)),
        }
    })
}

// ---- Types 7 and 8: chat core and chunk ----

export function parseChatCore(value: JsonValue): Parsed<ChatCore> {
    return plain(() => {
        const raw = obj(value, 'chat core')
        gateV(raw, 'chat core')
        return { ...extras(raw, ['v', 'f']), v: 1, f: obj(raw.f, 'f') }
    })
}

export function parseChatChunk(value: JsonValue): Parsed<ChatChunk> {
    return plain(() => {
        const raw = obj(value, 'chat chunk')
        gateV(raw, 'chat chunk')
        const chunk: ChatChunk = {
            ...extras(raw, ['v', 'msgs', 'st']),
            v: 1,
            msgs: arr(raw.msgs, 'msgs').map((msg, index) => obj(msg, `msgs[${index}]`)),
        }
        if (raw.st !== undefined) {
            chunk.st = obj(raw.st, 'st')
        }
        return chunk
    })
}

/**
 * Whether `value` is an alternative record: `m` an object, `p` a string or null, `a` a finite number. Any other key is
 * allowed and travels untouched, so a later build can add record fields without a format step.
 */
export function isAltRecord(value: JsonValue | undefined): value is AltRecord {
    if (!isPlainObject(value)) {
        return false
    }
    return isPlainObject(value.m) && (value.p === null || typeof value.p === 'string') && typeof value.a === 'number' && Number.isFinite(value.a)
}

/** Type 25: a non-empty list of alternative records; every record is checked and keeps its unknown keys. */
export function parseChatAlt(value: JsonValue): Parsed<ChatAltUnit> {
    return plain(() => {
        const raw = obj(value, 'chat alternatives')
        gateV(raw, 'chat alternatives')
        const recs = arr(raw.recs, 'recs')
        if (recs.length === 0) {
            bad('recs is empty: an alternatives unit holds at least one record.')
        }
        recs.forEach((rec, index) => {
            if (!isAltRecord(rec)) {
                bad(`recs[${index}] is not an alternative record.`)
            }
        })
        return { ...extras(raw, ['v', 'recs']), v: 1, recs: recs as AltRecord[] }
    })
}

/** The body of the one chunk an empty chat has; its Ref tuple carries count 0. */
export function emptyChatChunk(): ChatChunk {
    return { v: 1, msgs: [] }
}

// ---- Type 10: module index ----

function readModuleEntry(value: JsonValue, where: string): ModuleEntry {
    const o = obj(value, where)
    const entry: ModuleEntry = {
        ...extras(o, KNOWN_FIELDS.moduleEntry),
        id: str(o.id, `${where}.id`),
        unit: readTailedRef(o.unit, `${where}.unit`),
        al: readListRef(o.al, `${where}.al`),
        il: nullable(o.il, (v) => readListRef(v, `${where}.il`)),
        name: str(o.name, `${where}.name`),
        description: str(o.description, `${where}.description`),
        hasToggle: bool(o.hasToggle, `${where}.hasToggle`),
        dsp: bool(o.dsp, `${where}.dsp`),
    }
    if (o.namespace !== undefined) {
        entry.namespace = str(o.namespace, `${where}.namespace`)
    }
    if (o.icon !== undefined) {
        entry.icon = str(o.icon, `${where}.icon`)
    }
    if (o.hideIcon !== undefined) {
        entry.hideIcon = bool(o.hideIcon, `${where}.hideIcon`)
    }
    if (o.lowLevelAccess !== undefined) {
        entry.lowLevelAccess = bool(o.lowLevelAccess, `${where}.lowLevelAccess`)
    }
    // Derived field: a value of the wrong type reads as absent, since the module unit stays authoritative.
    if (typeof o.mcp === 'boolean') {
        entry.mcp = o.mcp
    }
    return entry
}

export function parseModuleIndex(value: JsonValue): Parsed<ModuleIndex> {
    return plain(() => {
        const raw = obj(value, 'module index')
        gateV(raw, 'module index')
        return {
            ...extras(raw, KNOWN_FIELDS.moduleIndex),
            v: 1,
            entries: arr(raw.entries, 'entries').map((entry, index) => readModuleEntry(entry, `entries[${index}]`)),
        }
    })
}

// ---- Types 15, 20, 21: derived lists. A version above this build's is unreadable, below is stale. ----

function listVersion(raw: JsonObject, field: string, known: number, where: string): number {
    const v = int(raw[field], `${where}.${field}`, 0)
    if (v > known) {
        throw new SchemaError('unreadable', `${where}.${field} ${v} is above this build's ${known}.`)
    }
    return v
}

function readInlayBody(raw: JsonObject, where: string): InlayList {
    const body: InlayList = {
        ...extras(raw, ['v', 'u', 'h', 'o', 'x']),
        v: int(raw.v, `${where}.v`, 0),
        u: strList(raw.u, `${where}.u`),
        h: readStems(raw.h, `${where}.h`),
        o: strList(raw.o, `${where}.o`),
    }
    if (raw.x !== undefined) {
        if (raw.x !== true) {
            bad(`${where}.x is true when present.`)
        }
        body.x = true
    }
    return body
}

export function parseAssetList(value: JsonValue): Parsed<AssetList> {
    return guarded(() => {
        const raw = obj(value, 'asset list')
        const v = listVersion(raw, 'v', ASSET_REF_V, 'asset list')
        const list: AssetList = {
            ...extras(raw, ['v', 'h', 'l']),
            v,
            h: readStems(raw.h, 'h'),
            l: strList(raw.l, 'l'),
        }
        return v < ASSET_REF_V ? { value: list, stale: `Asset list version ${v} is below ${ASSET_REF_V}.` } : { value: list }
    })
}

export function parseInlayList(value: JsonValue): Parsed<InlayList> {
    return guarded(() => {
        const raw = obj(value, 'inlay list')
        const v = listVersion(raw, 'v', IL_REF_V, 'inlay list')
        const list = readInlayBody(raw, 'inlay list')
        return v < IL_REF_V ? { value: list, stale: `Inlay list version ${v} is below ${IL_REF_V}.` } : { value: list }
    })
}

export function parseLegacyList(value: JsonValue): Parsed<LegacyList> {
    return guarded(() => {
        const raw = obj(value, 'legacy list')
        const v = listVersion(raw, 'v', ASSET_REF_V, 'legacy list')
        const iv = listVersion(raw, 'iv', IL_REF_V, 'legacy list')
        const inner = obj(raw.i, 'legacy list i')
        const innerV = listVersion(inner, 'v', IL_REF_V, 'legacy list i')
        const files: LegacyList['files'] = arr(raw.files, 'files').map((entry, index) => {
            const f = obj(entry, `files[${index}]`)
            const status = str(f.status, `files[${index}].status`)
            if (status !== 'ok' && status !== 'unreadable') {
                bad('A legacy list file status is ok or unreadable.')
            }
            return { ...extras(f, KNOWN_FIELDS.manifestLegacyKeepFile), key: str(f.key, `files[${index}].key`), status }
        })
        const list: LegacyList = {
            ...extras(raw, ['v', 'iv', 'files', 'h', 'l', 'i']),
            v,
            iv,
            files,
            h: readStems(raw.h, 'h'),
            l: strList(raw.l, 'l'),
            i: readInlayBody(inner, 'legacy list i'),
        }
        const stale = v < ASSET_REF_V || iv < IL_REF_V || innerV < IL_REF_V
        return stale ? { value: list, stale: 'The legacy list was derived by an older version.' } : { value: list }
    })
}

// ---- Types 22, 23, 19 ----

export function parseSweepRecord(value: JsonValue): Parsed<SweepRecord> {
    return plain(() => {
        const raw = obj(value, 'sweep record')
        gateV(raw, 'sweep record')
        const items = arr(raw.items, 'items').map((entry, index) => {
            const tuple = arr(entry, `items[${index}]`)
            if (tuple.length < 2) {
                bad(`items[${index}] is a tuple of fewer than two elements.`)
            }
            const rev = nullable(tuple[1], (r) => int(r, `items[${index}][1]`))
            return [str(tuple[0], `items[${index}][0]`), rev, ...tuple.slice(2)] as SweepRecord['items'][number]
        })
        return { ...extras(raw, ['v', 'at', 'items']), v: 1, at: num(raw.at, 'at'), items }
    })
}

const BASE64URL = /^[A-Za-z0-9_-]*$/

export function parseFenceRecord(value: JsonValue): Parsed<FenceRecord> {
    return plain(() => {
        const raw = obj(value, 'fence record')
        gateV(raw, 'fence record')
        const priorCommits = arr(raw.priorCommits, 'priorCommits').map((entry, index) => {
            const o = obj(entry, `priorCommits[${index}]`)
            const bytes = nullable(o.bytes, (b) => str(b, `priorCommits[${index}].bytes`))
            if (bytes !== null && !BASE64URL.test(bytes)) {
                bad(`priorCommits[${index}].bytes is not base64url.`)
            }
            return { ...extras(o, KNOWN_FIELDS.fencePriorCommit), at: num(o.at, `priorCommits[${index}].at`), bytes }
        })
        const record: FenceRecord = {
            ...extras(raw, KNOWN_FIELDS.fenceRecord),
            v: 1,
            at: num(raw.at, 'at'),
            priorCommits,
            keys: strList(raw.keys, 'keys'),
        }
        if (raw.priorFences !== undefined) {
            record.priorFences = arr(raw.priorFences, 'priorFences').map((entry, index) => {
                const o = obj(entry, `priorFences[${index}]`)
                const bytes = str(o.bytes, `priorFences[${index}].bytes`)
                if (!BASE64URL.test(bytes)) {
                    bad(`priorFences[${index}].bytes is not base64url.`)
                }
                return { ...extras(o, KNOWN_FIELDS.fencePriorFence), at: num(o.at, `priorFences[${index}].at`), bytes }
            })
        }
        return record
    })
}

/**
 * Type 24. Anything that would make a deletion unsafe reads as damaged, so the pass that needs the list deletes nothing:
 * an unknown kind, a repeated key, or a key outside the deletion allowlist. A newer `v` is too-new.
 */
export function parseDeletionSnapshot(value: JsonValue): Parsed<DeletionSnapshot> {
    return plain(() => {
        const raw = obj(value, 'deletion snapshot')
        gateV(raw, 'deletion snapshot')
        const kind = str(raw.kind, 'kind')
        if (!(DELETION_SNAPSHOT_KINDS as readonly string[]).includes(kind)) {
            bad('kind is not a known deletion kind.')
        }
        const upstreamRaw = obj(raw.upstream, 'upstream')
        const backups = strList(upstreamRaw.backups, 'upstream.backups')
        const keys = strList(raw.keys, 'keys')
        const seen = new Set<string>()
        for (const key of keys) {
            if (seen.has(key)) {
                bad(`keys lists ${JSON.stringify(key)} twice.`)
            }
            seen.add(key)
            if (!isOldDataKey(key)) {
                bad(`keys holds ${JSON.stringify(key)}, which is outside the deletion allowlist.`)
            }
        }
        return {
            ...extras(raw, KNOWN_FIELDS.deletionSnapshot),
            v: 1,
            kind: kind as DeletionSnapshotKind,
            upstream: { ...extras(upstreamRaw, KNOWN_FIELDS.deletionUpstream), main: bool(upstreamRaw.main, 'upstream.main'), backups },
            keys,
        }
    })
}

/** Whether a commit key's pointer count is the number of keys the snapshot lists (the pass deletes nothing otherwise). */
export function snapshotCountMatches(pointer: SnapshotPointer, snapshot: DeletionSnapshot): boolean {
    return pointer.count === snapshot.keys.length
}

/** Type 19. The shape is a format choice of this build (see `PluginBucket`). */
export function parsePluginBucket(value: JsonValue): Parsed<PluginBucket> {
    return plain(() => {
        const raw = obj(value, 'plugin-storage bucket')
        gateV(raw, 'plugin-storage bucket')
        const entries = arr(raw.entries, 'entries').map((entry, index) => {
            const o = obj(entry, `entries[${index}]`)
            return { ...extras(o, ['k', 'ref']), k: str(o.k, `entries[${index}].k`), ref: readTailedRef(o.ref, `entries[${index}].ref`) }
        })
        return { ...extras(raw, ['v', 'entries']), v: 1, entries }
    })
}

/** Types 4, 5, 6, 9, 11 to 14, 16 to 18: a plain object with a numeric `v` this build knows. */
export function parseContentBody(value: JsonValue): Parsed<ContentBody> {
    return plain(() => {
        const raw = obj(value, 'unit body')
        gateV(raw, 'unit body')
        return { ...raw, v: raw.v as number }
    })
}

/** Parses the body of a unit of `type`. */
export function parseUnitBody(type: UnitType, value: JsonValue): Parsed<UnitBody> {
    switch (type) {
        case UNIT_TYPE.commit: return parseCommitKey(value)
        case UNIT_TYPE.manifest: return parseManifest(value)
        case UNIT_TYPE.shard: return parseShard(value)
        case UNIT_TYPE.chatCore: return parseChatCore(value)
        case UNIT_TYPE.chatChunk: return parseChatChunk(value)
        case UNIT_TYPE.chatAlt: return parseChatAlt(value)
        case UNIT_TYPE.moduleIndex: return parseModuleIndex(value)
        case UNIT_TYPE.assetList: return parseAssetList(value)
        case UNIT_TYPE.legacyList: return parseLegacyList(value)
        case UNIT_TYPE.inlayList: return parseInlayList(value)
        case UNIT_TYPE.sweepRecord: return parseSweepRecord(value)
        case UNIT_TYPE.fenceRecord: return parseFenceRecord(value)
        case UNIT_TYPE.deletionSnapshot: return parseDeletionSnapshot(value)
        case UNIT_TYPE.pluginStorageBucket: return parsePluginBucket(value)
        default: return parseContentBody(value)
    }
}

// ---- Unit read and write ----

/** The frame and JSON of a stored unit, then its body by the type in the frame. */
export function readUnit(bytes: Uint8Array, expectedType?: UnitType): Parsed<{ type: UnitType, body: UnitBody }> {
    const frame = decodeFrame(bytes)
    if (frame.status !== 'ok') {
        return frame
    }
    if (expectedType !== undefined && frame.type !== expectedType) {
        return { status: 'damaged', reason: `The unit has type ${frame.type}, not ${expectedType}.` }
    }
    let json: JsonValue
    try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(frame.payload)) as JsonValue
    } catch {
        return { status: 'damaged', reason: 'The payload is not UTF-8 JSON.' }
    }
    const parsed = parseUnitBody(frame.type, json)
    if (parsed.status === 'ok' || parsed.status === 'stale') {
        return { ...parsed, value: { type: frame.type, body: parsed.value } }
    }
    return parsed
}

/** Frames `body` as a unit of `type` with the deterministic payload; fields the build does not know travel with it. */
export function encodeUnit(type: UnitType, body: object): Uint8Array {
    return encodeFrame(type, encodeCanonicalJson(body))
}

// ---- req ----

/** The sorted union of `req` lists. A writer copies the union and never removes a token. */
export function unionReq(...lists: readonly (readonly string[])[]): string[] {
    return Array.from(new Set(lists.flat())).sort()
}

/** Whether `outer` holds every token of `inner`. */
export function reqIsSuperset(outer: readonly string[], inner: readonly string[]): boolean {
    return inner.every(token => outer.includes(token))
}

/** The `req` of a commit key: its writer's own needs plus the `req` of every manifest it names. */
export function commitKeyReq(own: readonly string[], manifests: readonly { req: readonly string[] }[]): string[] {
    return unionReq(own, ...manifests.map(manifest => manifest.req))
}
