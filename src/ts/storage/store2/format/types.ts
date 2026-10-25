import type { JsonObject, JsonValue } from '../../blockFrame'

/**
 * Body shapes of the store2 units. Every non-derived object may carry fields
 * this build does not know; the parsers keep them on the parsed object at
 * runtime (they are not part of these types) and `carryUnknownFields` copies
 * them into a rebuilt object, so an older writer never drops a newer field.
 */

/** `[tail, bytes, crc]`: `tail` the key without `store2/`, `bytes` the stored (framed) length, `crc` the stored payload CRC. A longer tuple is read by its prefix. */
export type Ref = [tail: string, bytes: number, crc: number, ...rest: JsonValue[]]
/** A Ref with the list version appended (asset and inlay lists). */
export type ListRef = [tail: string, bytes: number, crc: number, v: number, ...rest: JsonValue[]]
/** A Ref with the message count appended (chat chunks). */
export type ChunkRef = [tail: string, bytes: number, crc: number, count: number, ...rest: JsonValue[]]

export type StagingLabel = 'convert' | 'seed' | 'import' | 'restore' | 'recovery' | 'bulk'
export const STAGING_LABELS: readonly StagingLabel[] = ['convert', 'seed', 'import', 'restore', 'recovery', 'bulk']

/**
 * The conversion's snapshot of the old data: the store2 unit (type 24) that lists it, that unit's digest (`unitDigest`)
 * and the number of listed keys. The key is a unit key, never a manifest, so it is not a reference of the commit key
 * (`REFS_TABLE`); the reader accepts only a unit or staged-unit key, and the GC mark keeps the unit by its own rule.
 */
export interface SnapshotPointer {
    key: string
    digest: string
    count: number
}

/** Type 1. The manifests it names are named by full key, not by Ref. */
export interface CommitKey {
    fmt: 1
    req: string[]
    seq: number
    epoch: string
    current: null | { key: string, at: number }
    retained: { key: string, at: number }[]
    pins: { key: string, reason: string }[]
    staging: null | { owner: string, prefix: string, startedAt: number, label: StagingLabel }
    convertedFrom: null | string
    convertedAt: null | number
    /** Optional and omitted when absent; a malformed stored value reads as absent. */
    snapshot?: SnapshotPointer
}

export interface LegacyKeepFile {
    key: string
    status: 'ok' | 'unreadable' | 'gone'
}

/** Type 2, write-once. */
export interface Manifest {
    fmt: 1
    req: string[]
    seq: number
    createdAt: number
    shardCount: number
    shards: Ref[]
    fixed: {
        config: Ref
        configAl: ListRef
        il: ListRef
        statics: Ref
        order: Ref
        loadouts: Ref
        moduleIndex: Ref
        presets: Ref[]
        plugins: Ref[]
        pluginStorage: { buckets: number, refs: Ref[] }
        legacyKeep: null | { unit: Ref, v: number, files: LegacyKeepFile[] }
    }
}

export interface ChatEntry {
    cid: string
    core: Ref
    /** Required, oldest to newest, the last is the tail; an empty chat has one chunk with count 0. */
    chunks: ChunkRef[]
}

export interface ShardEntry {
    u: string
    type: 'character' | 'group'
    name: string
    image?: string
    chaId: string
    lastInteraction?: number
    trashTime?: number
    characters?: string[]
    creatorNotes: string
    chatPage: number
    firstMsgIndex: number
    tags?: string[]
    creator?: string
    core: Ref
    lore: Ref | null
    scripts: Ref | null
    al: ListRef
    il: ListRef | null
    dsp: boolean
    chats: ChatEntry[]
}

/** Type 3, entries sorted by `u`. */
export interface Shard {
    v: 1
    entries: ShardEntry[]
}

/** Type 7. */
export interface ChatCore {
    v: 1
    f: JsonObject
}

/** Type 8; `st` only in the last chunk of a chat. */
export interface ChatChunk {
    v: 1
    msgs: JsonObject[]
    st?: JsonObject
}

export interface ModuleEntry {
    id: string
    unit: Ref
    al: ListRef
    il: ListRef | null
    name: string
    description: string
    namespace?: string
    icon?: string
    hideIcon?: boolean
    lowLevelAccess?: boolean
    /** Present (true) only when the module carries an MCP configuration. */
    mcp?: boolean
    hasToggle: boolean
    dsp: boolean
}

/** Type 10. */
export interface ModuleIndex {
    v: 1
    entries: ModuleEntry[]
}

/** Type 15: `h` concatenated 43-character base64url hash stems (sorted), `l` sorted unique lower-cased literal basenames. */
export interface AssetList {
    v: number
    h: string
    l: string[]
}

/** Type 21 and the `i` of type 20: `x: true` marks the owner unknown (overflow). */
export interface InlayList {
    v: number
    u: string[]
    h: string
    o: string[]
    x?: true
}

/** Type 20. */
export interface LegacyList {
    v: number
    iv: number
    files: { key: string, status: 'ok' | 'unreadable' }[]
    h: string
    l: string[]
    i: InlayList
}

/** Type 22. */
export interface SweepRecord {
    v: 1
    at: number
    items: [basename: string, rev: number | null, ...rest: JsonValue[]][]
}

/** Type 23. Names keys inline; it has no Ref positions. */
export interface FenceRecord {
    v: 1
    at: number
    priorCommits: { at: number, bytes: string | null }[]
    keys: string[]
    priorFences?: { at: number, bytes: string }[]
}

/**
 * What kind of old data a deletion snapshot was planned over, decided from what the store held at planning time and
 * never from the code path that wrote it.
 *   fork-only:        no upstream main file and no numbered backup existed; every fork-format key may go.
 *   exclusion:        every upstream file that existed was read to its end, so `coldstorage/` keys outside their
 *                     references may go.
 *   fork-format-only: anything else; no `coldstorage/` key is listed.
 */
export type DeletionSnapshotKind = 'fork-only' | 'exclusion' | 'fork-format-only'

export const DELETION_SNAPSHOT_KINDS: readonly DeletionSnapshotKind[] = ['fork-only', 'exclusion', 'fork-format-only']

/**
 * Type 24, the list of old fork-format keys a later pass may delete. `upstream` records the upstream files the planner
 * observed (the main file's presence and the numbered backups' key names, sorted), so the pass can tell that the store
 * changed since planning. `keys` are store keys outside the store2 key space, each inside the deletion allowlist
 * (`isOldDataKey`), without duplicates. An upstream probe that answered unknown is recorded as `main: false` and
 * `backups: []`. Such a plan is always `fork-format-only` and lists no `coldstorage/` key, so `upstream` is a real
 * observation only on plans that list `coldstorage/` keys.
 */
export interface DeletionSnapshot {
    v: 1
    kind: DeletionSnapshotKind
    upstream: { main: boolean, backups: string[] }
    keys: string[]
}

/**
 * Type 19, a plugin-storage bucket. FORMAT CHOICE not stated by the plan: the
 * body lists its values by name, each as a Ref to a type 14 unit, sorted by `k`.
 */
export interface PluginBucket {
    v: 1
    entries: { k: string, ref: Ref }[]
}

/** Types 4, 5, 6, 9, 11, 12, 13, 14, 16, 17, 18: frame level only, the contents belong to the unit codec. */
export interface ContentBody {
    v: number
    [field: string]: JsonValue
}

export type UnitBody =
    | CommitKey | Manifest | Shard | ChatCore | ChatChunk | ModuleIndex | AssetList
    | LegacyList | InlayList | SweepRecord | FenceRecord | DeletionSnapshot | PluginBucket | ContentBody
