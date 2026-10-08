import {
    BlockFrameError,
    FILE_HEADER_V1,
    bytesEqual,
    buildPack,
    checkSingleBlock,
    frameJsonBlock,
    parseJsonObjectBlock,
    readPack,
    refuseBlockBeforeWrite,
    type JsonObject,
} from './blockFrame'
import {
    BLOCKS_PREFIX,
    HEAD_KEY,
    LEGACY_MAIN_FILE_KEY,
    NUMBERED_BACKUP_PREFIX,
    PRE_BLOCKS_PREFIX,
    ROOT_BLOCK_NAME,
    defaultGenerationIdSource,
    fixedBlockKey,
    generationOfKey,
    generationPrefix,
    isFixedBlockName,
    keptKey,
    newGenerationId,
    ownBlockKey,
    rootKey,
    stubsKey,
    type GenerationIdSource,
} from './blockKeys'
import { encodeHead, parseHead, sameHeadBytes, sameHeadRead, type HeadParse, type HeadRead, type HeadRecord, type HeadSwap } from './headSwap'
import { NODE_BODY_LIMIT_BYTES } from './nodeBodyLimit'
import type { ByteStore, StoreCondition } from './store/contract'
import { StoreDeleteManyError, StoreInvalidKeyError, StoreNotBinaryError, StoreVersionConflictError } from './store/errors'

/**
 * The commit owner of the block store: the one writer of `blocks/` keys.
 *
 * It keeps, per key of the live generation, the bytes and (on the Node server)
 * the revision the store acknowledged, plus the acknowledged root's `__seq`. It
 * offers these operations:
 *
 * - `load()` reads the head and the live generation, validates every value,
 *   writes and deletes nothing, and makes a loaded generation the owner's live
 *   one. It runs once, on an owner that has not loaded.
 * - `readCommitted()` is the same read without installing anything, for a
 *   reader that compares the store with the owner's record.
 * - `commitSave()` writes the changed values of the live generation and then
 *   the root, the commit point of a save.
 * - `replaceWholeState()` builds a new generation and switches to it with a
 *   compare-and-swap of the head, the only write of that key.
 *
 * An owner's live state (generation, acknowledged record, sequence number,
 * stop) changes only through its own commit or its own replace.
 *
 * Lock order: the owner takes the cross-tab commit lock in `commitSave` and
 * nothing else. It never acquires the page's write lock or the storage tab
 * locks; its callers hold what they need.
 */

/** The Web Lock name of the cross-tab commit lock. */
export const COMMIT_LOCK_NAME = 'risu-block-commit'

/** The block names and bytes of a save, as the encoder holds them. Structurally the encoder's `SaveLayout`. */
export interface BlockLayout {
    /** Block names in file order, `root` included. */
    readonly keys: readonly string[]
    /** The framed bytes of each block, in the order of `keys`. */
    readonly blocks: readonly Uint8Array[]
}

export interface BlockSetInput {
    layout: BlockLayout
    /** Names of the archived characters whose block lives in the stubs pack. Never a fixed block name. */
    packed: ReadonlySet<string>
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A read kept failing after its retries. Nothing was installed or written. */
export class BlockStoreReadError extends Error {
    constructor(public readonly key: string, public readonly cause: unknown) {
        super(`Reading ${JSON.stringify(key)} failed: ${String((cause as { message?: unknown } | null)?.message ?? cause)}`)
        this.name = 'BlockStoreReadError'
    }
}

/** The block set handed in cannot be a save. */
export class BlockSetInvalidError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BlockSetInvalidError'
    }
}

/** A block about to be written would not load back; nothing was written. */
export class BlockSetGateError extends BlockSetInvalidError {
    constructor(public readonly blockName: string, public readonly reason: string) {
        super(`The block "${blockName}" would not load back: ${reason}`)
        this.name = 'BlockSetGateError'
    }
}

/** Header-level check of the values a write is about to put in the store; throws before the first write. */
function gateBlocksBeforeWrite(blocks: Iterable<readonly [string, Uint8Array]>): void {
    for (const [name, bytes] of blocks) {
        const reason = refuseBlockBeforeWrite(name, bytes)
        if (reason !== null) {
            throw new BlockSetGateError(name, reason)
        }
    }
}

/** A value is over the Node server's body limit; nothing was written. */
export class BlockTooLargeError extends Error {
    constructor(public readonly blockName: string, public readonly length: number, public readonly limit: number) {
        super(`The block "${blockName}" is ${length} bytes, over the ${limit} bytes the Node server accepts in one request.`)
        this.name = 'BlockTooLargeError'
    }
}

/** The owner cannot do this in its current state (not loaded, or closed after an unconfirmed switch). */
export class BlockOwnerStateError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'BlockOwnerStateError'
    }
}

/** The commit lock was not granted in time. `holderLive` is `true` while a live holder exists, `null` when that cannot be told. */
export class CommitLockTimeoutError extends Error {
    constructor(public readonly holderLive: boolean | null) {
        super('The commit lock was not granted in time.')
        this.name = 'CommitLockTimeoutError'
    }
}

// ---------------------------------------------------------------------------
// The commit lock
// ---------------------------------------------------------------------------

export interface CommitLock {
    /** Whether the lock excludes other tabs. `false` on a page without Web Locks. */
    readonly available: boolean
    run<T>(work: () => Promise<T>): Promise<T>
}

/** The part of `navigator.locks` the commit lock uses. */
export interface LockManagerLike {
    request<T>(name: string, options: { mode?: 'exclusive' | 'shared', signal?: AbortSignal }, callback: (lock: unknown) => Promise<T>): Promise<T>
    query?(): Promise<{ held?: ReadonlyArray<{ name?: string }> }>
}

export const DEFAULT_COMMIT_LOCK_TIMEOUT_MS = 30_000

const processLockChains = new WeakMap<object, Promise<void>>()

/**
 * The commit lock of a page that has no Web Locks to rely on but is the only
 * writer of its store: an in-process queue, one per store object, so two
 * acquisitions on one store run one after the other in the order they asked.
 * It is `available`, which lets the post-commit deletes and the pack trim run.
 * It is never correct where several pages share a store: it excludes nothing
 * outside this page, which is what the desktop app's single-instance rule
 * stands in for, as it does for the mutex head swap.
 *
 * A request that waits longer than `timeoutMs` rejects with
 * `CommitLockTimeoutError` (a live holder exists) and takes nothing from the
 * queue.
 */
export function createProcessCommitLock(store: object, options: { timeoutMs?: number } = {}): CommitLock {
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMIT_LOCK_TIMEOUT_MS
    return {
        available: true,
        async run<T>(work: () => Promise<T>): Promise<T> {
            const previous = processLockChains.get(store) ?? Promise.resolve()
            let release!: () => void
            const mine = new Promise<void>((resolve) => { release = resolve })
            processLockChains.set(store, previous.then(() => mine))
            let timer: ReturnType<typeof setTimeout> | undefined
            const granted = await Promise.race([
                previous.then(() => true),
                new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) }),
            ])
            clearTimeout(timer)
            if (!granted) {
                // The queue behind this request still waits for the holder; this slot passes straight through.
                release()
                throw new CommitLockTimeoutError(true)
            }
            try {
                return await work()
            } finally {
                release()
            }
        },
    }
}

/**
 * The exclusive cross-tab commit lock over Web Locks. A request that is not
 * granted within `timeoutMs` rejects with `CommitLockTimeoutError`. Without a
 * lock manager the lock is not available and `run` just runs the work.
 */
export function createWebCommitLock(
    locks: LockManagerLike | undefined,
    options: { timeoutMs?: number, name?: string } = {},
): CommitLock {
    const name = options.name ?? COMMIT_LOCK_NAME
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMIT_LOCK_TIMEOUT_MS
    if (locks === undefined) {
        return { available: false, run: (work) => work() }
    }
    return {
        available: true,
        async run<T>(work: () => Promise<T>): Promise<T> {
            const controller = new AbortController()
            let granted = false
            const timer = setTimeout(() => controller.abort(), timeoutMs)
            try {
                return await locks.request(name, { mode: 'exclusive', signal: controller.signal }, async () => {
                    granted = true
                    clearTimeout(timer)
                    return await work()
                })
            } catch (error) {
                if (!granted && (error as { name?: unknown } | null)?.name === 'AbortError') {
                    let holderLive: boolean | null = null
                    try {
                        const snapshot = await locks.query?.()
                        holderLive = snapshot === undefined ? null : (snapshot.held ?? []).some((held) => held.name === name)
                    } catch {
                        holderLive = null
                    }
                    throw new CommitLockTimeoutError(holderLive)
                }
                throw error
            } finally {
                clearTimeout(timer)
            }
        },
    }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type DamageKind =
    | 'absent' | 'empty' | 'framing' | 'crc' | 'wrong-name' | 'trailing-bytes' | 'bad-root' | 'bad-head'
    /** A block whose frame and checksum are valid but whose content does not decode. Only a validation hook reports it. */
    | 'unreadable-content'

export interface DamagedItem {
    /** What kind of value is damaged. */
    part: 'head' | 'root' | 'fixed' | 'character' | 'stub' | 'pack'
    /** The block name (the directory's name for it); the key for a head. */
    name: string
    key: string
    kind: DamageKind
    detail: string
}

export interface LoadedBlocks {
    generation: string
    seq: number
    /** The conversion fingerprint the head carries, if any. */
    convertedFrom: string | null
    /** The conversion time (milliseconds since the epoch) the head carries, if any. */
    convertedAt: number | null
    /** The root's directory: block names in order, `root` excluded. */
    directory: readonly string[]
    /** The directory names whose block lived in the stubs pack. */
    packed: readonly string[]
    /** The framed root block as stored (it carries the bookkeeping). */
    root: Uint8Array
    /** The root's JSON object as stored, bookkeeping included. */
    rootFields: JsonObject
    /** Every listed block's framed bytes by name; a packed name's stub is included. */
    blocks: ReadonlyMap<string, Uint8Array>
}

export interface DamagedResult {
    kind: 'damaged'
    /** The generation the head named, or `null` when the head itself is damaged. */
    generation: string | null
    damage: readonly DamagedItem[]
    /** The root's fields where the root was readable, for the wording of the prompt. */
    rootFields: JsonObject | null
    /** The directory names where the root was readable. */
    directory: readonly string[] | null
}

export type LoadResult =
    | { kind: 'no-head' }
    | { kind: 'loaded', loaded: LoadedBlocks }
    | DamagedResult

/**
 * What a validation hook returns: the decoded tree, or the damage it found. A
 * list is damage and must not be empty; anything else is the tree.
 */
export type ValidationVerdict<T> = T | readonly DamagedItem[]

export interface ValidateOptions<T> {
    /**
     * Runs once on a load that found nothing wrong with the blocks' frames,
     * checksums and bookkeeping, before the result is reported (and, for
     * `load()`, before anything is installed). It decodes the loaded blocks
     * the way the application will and returns either the decoded tree or the
     * damage it found, so a caller that needs the tree does not decode twice.
     */
    validate: (loaded: LoadedBlocks) => Promise<ValidationVerdict<T>>
}

/** A load that ran a validation hook: a clean result carries what the hook decoded. */
export type ValidatedLoadResult<T> =
    | { kind: 'no-head' }
    | { kind: 'loaded', loaded: LoadedBlocks, tree: T }
    | DamagedResult

export type StopReason =
    /** Another writer committed since this one's last acknowledged root. */
    | 'peer-commit'
    /** The generation's root is gone: the generation was replaced and retired. */
    | 'generation-gone'
    /** The head names another generation: a whole-state replace happened elsewhere. */
    | 'head-moved'

export interface CleanupReport {
    /** Post-commit deletes and the pack trim were not attempted (a page without Web Locks, off Node). */
    skipped: boolean
    deleted: number
    failed: number
}

export type CommitResult =
    | { kind: 'committed', wrote: boolean, seq: number, cleanup: CleanupReport | null }
    /** The commit did not happen, or (for `head-moved`) went into a retired generation. The caller takes the other-tab path. */
    | { kind: 'stopped', reason: StopReason, peerSeq: number | null }
    /** A Node write answered 409: another device changed `key`. The caller parks as `node-conflict`. */
    | { kind: 'conflict', key: string }

export interface CommitOptions {
    /** Off Node only: overwrite everything this tab's root lists, taking the peer's current `__seq` as the base. */
    saveMine?: { peerSeq: number }
}

export interface ReplaceOptions {
    /** The replace is a conversion or a seed: it only proceeds while there is no head (a head that is not binary data is a head). A conversion also records its fingerprint. */
    requireAbsentHead?: boolean
    /**
     * Set for a conversion: written into the new head with `convertedAt`.
     * Without it the new head carries the `convertedFrom` and `convertedAt` of
     * the head this replace read, when that head has them.
     */
    convertedFrom?: string
    /** The conversion time, milliseconds since the epoch. A conversion that passes none is stamped with the owner's clock. */
    convertedAt?: number
    /** The damaged generation a replace chosen at the damage prompt keeps: a `kept` marker is written into it first. */
    keepDamaged?: string
    /**
     * Only for a head that cannot be read (bytes that are not a head, or an
     * entry that is not binary data): before anything of the new generation is
     * written, every generation that has a root is marked kept, and the flip
     * is against exactly the unreadable value read. The new head carries
     * neither a fingerprint nor a conversion time unless the caller passes
     * them. Against a readable or absent head the replace loses and writes
     * nothing. A replace that ends without winning (other than `unconfirmed`)
     * deletes the markers it wrote on the generation the head then names.
     */
    keepAll?: true
    /**
     * Runs synchronously immediately before the flip, once the new generation
     * is written and its root reads back. Return `false` to refuse: the flip
     * does not happen, the new generation is deleted and the result is
     * `aborted`. The owner's live state is untouched either way until a flip
     * wins.
     */
    preFlip?: () => boolean
}

export type PreviousGeneration =
    | { state: 'none' }
    | { state: 'deleted', generation: string }
    | { state: 'kept', generation: string }
    | { state: 'failed', generation: string }

export type ReplaceResult =
    | { kind: 'won', generation: string, previous: PreviousGeneration }
    /**
     * The head does not name the new generation. `ownGenerationDeleted` is whether the new generation was removed.
     * A swap reported lost whose re-read names the new generation is `won`, not this.
     */
    | {
        kind: 'lost'
        reason: 'head-exists' | 'head-mismatch' | 'head-moved' | 'generation-damaged'
        generation: string | null
        ownGenerationDeleted: boolean
    }
    /** The `preFlip` check refused. The head did not move; `ownGenerationDeleted` is whether the new generation was removed. */
    | { kind: 'aborted', ownGenerationDeleted: boolean }
    /** The outcome could not be established. Nothing was deleted and the owner is closed: the page must reload. */
    | { kind: 'unconfirmed', reason: 'unchanged' | 'unreadable', generation: string }
    /** A value is over the Node server's body limit; nothing was written. */
    | { kind: 'refused', blockName: string, length: number, limit: number }

export interface SeedBlocker {
    kind: 'head' | 'main-file' | 'pre-blocks' | 'numbered-backup'
    keys: readonly string[]
}

export type SeedResult =
    | { kind: 'blocked', found: readonly SeedBlocker[] }
    | { kind: 'replaced', result: ReplaceResult, leftoverGenerations: readonly string[] }

export interface CommittedStateView {
    generation: string
    seq: number
    convertedFrom: string | null
    convertedAt: number | null
    directory: readonly string[]
    packed: readonly string[]
    /** The acknowledged bytes of `key`, or `null` when none are acknowledged. */
    bytesOf(key: string): Uint8Array | null
    /** The acknowledged revision of `key` (Node), or `null`. */
    versionOf(key: string): number | null
}

export interface GenerationInfo {
    id: string
    hasRoot: boolean
    /** Carries a `kept` marker and is not the live generation: the live one is only ever reported as `current`. */
    kept: boolean
    /** The generation the head names. */
    current: boolean
    keyCount: number
}

export interface GenerationInventory {
    generations: readonly GenerationInfo[]
    /** Neither the live generation nor kept: an interrupted build or deletion, or a losing replace. */
    leftover: readonly string[]
    /** Kept and not live. Never contains the live generation, whatever markers it carries. */
    kept: readonly string[]
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface KeyAck {
    /** The bytes the store acknowledged under the key, `null` after a write threw (the next commit rewrites). */
    bytes: Uint8Array | null
    version: number | null
}

interface LiveState {
    generation: string
    convertedFrom: string | null
    convertedAt: number | null
    seq: number
    rootBytes: Uint8Array
    rootVersion: number | null
    /** The encoder's root block the stored root was derived from, when known. Lets an unchanged root skip the rebuild. */
    rootInput: Uint8Array | null
    directory: string[]
    packed: string[]
    keys: Map<string, KeyAck>
    /** The pack's members as the store holds them, including members the root does not list. */
    stubMembers: Map<string, Uint8Array>
    headCheckPending: boolean
    /** Values were written for a save whose root is not yet durable: the next commit writes the root even if nothing else changed. */
    rootOwed: boolean
    stopped: StopReason | null
}

interface DescribedSet {
    names: string[]
    rootInput: Uint8Array
    blocks: Map<string, Uint8Array>
    packedOrdered: string[]
    packedSet: Set<string>
}

export interface BlockOwnerDeps {
    store: ByteStore
    headSwap: HeadSwap
    commitLock: CommitLock
    /** Defaults to the Node server's body limit; applies only to a store that enforces versions. */
    nodeBodyLimit?: number
    generationIds?: GenerationIdSource
    sleep?: (ms: number) => Promise<void>
    /** Waits before each retry of a failed read. */
    readRetryDelaysMs?: readonly number[]
    loadConcurrency?: number
}

const DEFAULT_READ_RETRY_DELAYS_MS: readonly number[] = [50, 150, 400]
const DEFAULT_LOAD_CONCURRENCY = 8
const MAX_LOAD_ATTEMPTS = 3

function describeBlockSet(input: BlockSetInput): DescribedSet {
    const { keys, blocks } = input.layout
    if (keys.length !== blocks.length) {
        throw new BlockSetInvalidError('The layout has a different number of names and blocks.')
    }
    const byName = new Map<string, Uint8Array>()
    let rootInput: Uint8Array | null = null
    const names: string[] = []
    for (let i = 0; i < keys.length; i++) {
        const name = keys[i]
        if (name === ROOT_BLOCK_NAME) {
            rootInput = blocks[i]
            continue
        }
        if (byName.has(name)) {
            throw new BlockSetInvalidError(`The block "${name}" appears twice.`)
        }
        byName.set(name, blocks[i])
        names.push(name)
    }
    if (rootInput === null) {
        throw new BlockSetInvalidError('The layout has no root block.')
    }
    if (!byName.has('config')) {
        throw new BlockSetInvalidError('The layout has no config block.')
    }
    for (const name of input.packed) {
        if (isFixedBlockName(name) || !byName.has(name)) {
            throw new BlockSetInvalidError(`The packed name "${name}" is not a character block of the layout.`)
        }
    }
    const packedOrdered = names.filter((name) => input.packed.has(name))
    return { names, rootInput, blocks: byName, packedOrdered, packedSet: new Set(packedOrdered) }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/** The framed root block: the encoder's root with the directory, the packed names and the sequence number set. */
function buildRoot(set: DescribedSet, seq: number): Uint8Array {
    const { type, fields } = parseJsonObjectBlock(set.rootInput, ROOT_BLOCK_NAME)
    fields.__directory = set.names
    fields.__packed = set.packedOrdered
    fields.__seq = seq
    return frameJsonBlock(type, ROOT_BLOCK_NAME, fields)
}

async function mapLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
    let next = 0
    const lanes: Promise<void>[] = []
    for (let lane = 0; lane < Math.min(limit, items.length); lane++) {
        lanes.push((async () => {
            for (;;) {
                const index = next++
                if (index >= items.length) {
                    return
                }
                await work(items[index])
            }
        })())
    }
    await Promise.all(lanes)
}

/** The file a legacy decoder reads: the block-format header, the root, then every listed block in directory order. */
export function assembleLegacyFile(loaded: LoadedBlocks): Uint8Array {
    const parts: Uint8Array[] = [FILE_HEADER_V1, loaded.root]
    for (const name of loaded.directory) {
        const block = loaded.blocks.get(name)
        if (block === undefined) {
            throw new BlockSetInvalidError(`The block "${name}" is not loaded.`)
        }
        parts.push(block)
    }
    return buildPack(parts)
}

/**
 * Lists the generations in the store without reading or writing any value.
 * `current` is the live generation (or `null`). The live generation is
 * reported only as current, whatever markers it carries: `kept` never contains
 * it. A marker that stays on it keeps the generation after a later replace
 * supersedes it, until clean-up deletes it. Every other generation that is not kept is
 * leftover.
 */
export async function inspectGenerations(store: ByteStore, current: string | null): Promise<GenerationInventory> {
    const keys = await store.list(BLOCKS_PREFIX)
    const byId = new Map<string, GenerationInfo>()
    for (const key of keys) {
        const id = generationOfKey(key)
        if (id === null) {
            continue
        }
        const info = byId.get(id) ?? { id, hasRoot: false, kept: false, current: id === current, keyCount: 0 }
        info.keyCount++
        if (key === rootKey(id)) {
            info.hasRoot = true
        }
        if (key === keptKey(id) && id !== current) {
            info.kept = true
        }
        byId.set(id, info)
    }
    const generations = Array.from(byId.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return {
        generations,
        leftover: generations.filter((info) => !info.current && !info.kept).map((info) => info.id),
        kept: generations.filter((info) => info.kept).map((info) => info.id),
    }
}

/**
 * Deletes every key of `generation`, its root first so a half-deleted
 * generation never looks whole, unless it carries a `kept` marker or is
 * `live`, the generation the head names, which is never touched. Returns what
 * became of it.
 */
export async function retireGeneration(store: ByteStore, generation: string, live: string | null = null): Promise<'deleted' | 'kept' | 'failed'> {
    if (generation === live) {
        return 'kept'
    }
    try {
        const keys = await store.list(generationPrefix(generation))
        if (keys.includes(keptKey(generation))) {
            return 'kept'
        }
        const root = rootKey(generation)
        if (keys.includes(root)) {
            await store.delete(root, 'unconditional')
        }
        const rest = keys.filter((key) => key !== root)
        if (rest.length > 0) {
            await store.deleteMany(rest.map((key) => ({ key, condition: 'unconditional' as const })))
        }
        return 'deleted'
    } catch {
        return 'failed'
    }
}

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

type OwnerState = 'unloaded' | 'live' | 'closed'

export class BlockStoreOwner {
    private readonly store: ByteStore
    private readonly headSwap: HeadSwap
    private readonly commitLock: CommitLock
    private readonly versioned: boolean
    private readonly nodeBodyLimit: number
    private readonly generationIds: GenerationIdSource
    private readonly sleep: (ms: number) => Promise<void>
    private readonly readRetryDelays: readonly number[]
    private readonly loadConcurrency: number
    private state: OwnerState = 'unloaded'
    private live: LiveState | null = null

    constructor(deps: BlockOwnerDeps) {
        this.store = deps.store
        this.headSwap = deps.headSwap
        this.commitLock = deps.commitLock
        this.versioned = deps.store.capabilities.conditionalWrites
        this.nodeBodyLimit = deps.nodeBodyLimit ?? NODE_BODY_LIMIT_BYTES
        this.generationIds = deps.generationIds ?? defaultGenerationIdSource
        this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
        this.readRetryDelays = deps.readRetryDelaysMs ?? DEFAULT_READ_RETRY_DELAYS_MS
        this.loadConcurrency = deps.loadConcurrency ?? DEFAULT_LOAD_CONCURRENCY
    }

    /** Whether the owner can commit saves: a generation is loaded or was switched to, and the owner is not closed. */
    isLive(): boolean {
        return this.state === 'live'
    }

    /** Whether the owner was closed by an unconfirmed switch: the page must reload. */
    isClosed(): boolean {
        return this.state === 'closed'
    }

    committedState(): CommittedStateView | null {
        const live = this.live
        if (this.state !== 'live' || live === null) {
            return null
        }
        return {
            generation: live.generation,
            seq: live.seq,
            convertedFrom: live.convertedFrom,
            convertedAt: live.convertedAt,
            directory: live.directory.slice(),
            packed: live.packed.slice(),
            bytesOf: (key) => live.keys.get(key)?.bytes ?? null,
            versionOf: (key) => live.keys.get(key)?.version ?? null,
        }
    }

    // -- guarded store access -------------------------------------------------

    /** Every write of a `blocks/` key goes through here. The head is written by the head swap only. */
    private async put(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<{ version: number | null }> {
        if (key === HEAD_KEY) {
            throw new BlockOwnerStateError('The head is written only by a whole-state replace\'s swap.')
        }
        return await this.store.write(key, bytes, condition)
    }

    private checkNodeSize(name: string, bytes: Uint8Array): void {
        if (this.versioned && bytes.length > this.nodeBodyLimit) {
            throw new BlockTooLargeError(name, bytes.length, this.nodeBodyLimit)
        }
    }

    private async readWithRetry(key: string): Promise<{ bytes: Uint8Array | null, version: number | null }> {
        for (let attempt = 0; ; attempt++) {
            try {
                const result = await this.store.read(key)
                return { bytes: result.bytes, version: result.version }
            } catch (error) {
                if (error instanceof StoreNotBinaryError || error instanceof StoreInvalidKeyError) {
                    throw error
                }
                if (attempt >= this.readRetryDelays.length) {
                    throw new BlockStoreReadError(key, error)
                }
                await this.sleep(this.readRetryDelays[attempt])
            }
        }
    }

    private async readHeadWithRetry(): Promise<HeadRead> {
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.headSwap.read()
            } catch (error) {
                if (attempt >= this.readRetryDelays.length) {
                    throw new BlockStoreReadError(HEAD_KEY, error)
                }
                await this.sleep(this.readRetryDelays[attempt])
            }
        }
    }

    // -- load ----------------------------------------------------------------

    /**
     * Reads the head and the live generation and, when they load, makes that
     * generation this owner's live one. Only an owner that has not loaded yet
     * may call it: an owner's live state changes through its own commit or its
     * own replace and nowhere else, so a second `load()` throws
     * `BlockOwnerStateError` instead of moving a live (or stopped) owner onto
     * whatever the store holds now. A `no-head` or `damaged` result installs
     * nothing, and the owner may load again.
     *
     * Writes nothing and deletes nothing. A read that keeps failing throws
     * `BlockStoreReadError`; damage is reported, never thrown. Before damage is
     * reported the head and root are read again, and a generation or root that
     * changed since starts the load over (at most three loads in all), so a
     * boot racing a writer does not report damage.
     *
     * With `validate`, a load that found the blocks sound runs the hook before
     * anything is installed. Damage from the hook is reported as `damaged` and
     * nothing is installed, so the owner stays unloaded and a later `load()` is
     * legal; the decoded tree comes back in the `loaded` result otherwise. The
     * owner is checked again after the hook: a replace of this owner that
     * landed while the hook ran makes the load throw `BlockOwnerStateError`
     * instead of installing over it.
     */
    async load(): Promise<LoadResult>
    async load<T>(options: ValidateOptions<T>): Promise<ValidatedLoadResult<T>>
    async load<T>(options?: ValidateOptions<T>): Promise<LoadResult | ValidatedLoadResult<T>> {
        this.requireUnloaded()
        const current = await this.readStable()
        // A replace on this owner that finished while the read ran has made the owner live already.
        this.requireUnloaded()
        if (current.result.kind !== 'loaded' || current.live === null) {
            return current.result
        }
        if (options === undefined) {
            this.live = current.live
            this.state = 'live'
            return current.result
        }
        const verdict = await this.validateLoaded(current.result.loaded, options)
        this.requireUnloaded()
        if (verdict.kind === 'damaged') {
            return verdict
        }
        this.live = current.live
        this.state = 'live'
        return { kind: 'loaded', loaded: current.result.loaded, tree: verdict.tree }
    }

    /**
     * The same read as `load()` that never installs anything and may be called
     * in any state: it reports what the store holds now, for a reader (the
     * clean-up's keep set) that compares it with `committedState()`. It does
     * not touch the owner's acknowledged record, sequence number or stop.
     * With `validate` it classifies damage exactly as `load()` does.
     */
    async readCommitted(): Promise<LoadResult>
    async readCommitted<T>(options: ValidateOptions<T>): Promise<ValidatedLoadResult<T>>
    async readCommitted<T>(options?: ValidateOptions<T>): Promise<LoadResult | ValidatedLoadResult<T>> {
        const current = await this.readStable()
        if (options === undefined || current.result.kind !== 'loaded') {
            return current.result
        }
        const verdict = await this.validateLoaded(current.result.loaded, options)
        return verdict.kind === 'damaged' ? verdict : { kind: 'loaded', loaded: current.result.loaded, tree: verdict.tree }
    }

    /** Runs the hook and sorts its answer into the tree or a damage result. */
    private async validateLoaded<T>(loaded: LoadedBlocks, options: ValidateOptions<T>): Promise<DamagedResult | { kind: 'tree', tree: T }> {
        const verdict = await options.validate(loaded)
        if (Array.isArray(verdict)) {
            const damage = verdict as readonly DamagedItem[]
            if (damage.length === 0) {
                throw new TypeError('A validation hook that reports damage must name at least one damaged item.')
            }
            return { kind: 'damaged', generation: loaded.generation, damage, rootFields: loaded.rootFields, directory: loaded.directory }
        }
        return { kind: 'tree', tree: verdict as T }
    }

    private requireUnloaded(): void {
        if (this.state === 'closed') {
            throw new BlockOwnerStateError('The owner is closed; reload the page.')
        }
        if (this.state === 'live') {
            throw new BlockOwnerStateError('The owner is already loaded; use readCommitted() to read the store without changing the owner.')
        }
    }

    private async readStable(): Promise<LoadAttempt> {
        let last: LoadAttempt | null = null
        for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
            const current = await this.loadOnce()
            last = current
            if (current.result.kind !== 'damaged') {
                return current
            }
            if (attempt === MAX_LOAD_ATTEMPTS || !(await this.changedSince(current))) {
                break
            }
        }
        return last
    }

    /** Whether the head or the root differs from what the attempt saw. A read that keeps failing throws `BlockStoreReadError`: it is never taken for a change or for no change. */
    private async changedSince(attempt: LoadAttempt): Promise<boolean> {
        if (!sameHeadRead(await this.readHeadWithRetry(), attempt.head)) {
            return true
        }
        if (attempt.generation === null) {
            return false
        }
        let rootBytes: Uint8Array | null = null
        try {
            rootBytes = (await this.readWithRetry(rootKey(attempt.generation))).bytes
        } catch (error) {
            if (!(error instanceof StoreNotBinaryError)) {
                throw error
            }
        }
        return !sameHeadBytes(rootBytes, attempt.rootBytes)
    }

    private async loadOnce(): Promise<LoadAttempt> {
        const head = await this.readHeadWithRetry()
        if (head.kind === 'absent') {
            return { result: { kind: 'no-head' }, live: null, head, generation: null, rootBytes: null }
        }
        if (head.kind === 'not-binary') {
            return {
                result: {
                    kind: 'damaged',
                    generation: null,
                    damage: [{ part: 'head', name: HEAD_KEY, key: HEAD_KEY, kind: 'bad-head', detail: 'The head is not binary data.' }],
                    rootFields: null,
                    directory: null,
                },
                live: null,
                head,
                generation: null,
                rootBytes: null,
            }
        }
        const parsed = parseHead(head.bytes)
        if (parsed.status !== 'ok') {
            return {
                result: {
                    kind: 'damaged',
                    generation: null,
                    damage: [{ part: 'head', name: HEAD_KEY, key: HEAD_KEY, kind: 'bad-head', detail: parsed.detail }],
                    rootFields: null,
                    directory: null,
                },
                live: null,
                head,
                generation: null,
                rootBytes: null,
            }
        }
        const generation = parsed.record.current
        const root = await this.readRoot(generation)
        if (root.status !== 'ok') {
            return {
                result: { kind: 'damaged', generation, damage: [root.damage], rootFields: null, directory: null },
                live: null,
                head,
                generation,
                rootBytes: root.bytes,
            }
        }
        const damage: DamagedItem[] = []
        const keys = new Map<string, KeyAck>()
        const blocks = new Map<string, Uint8Array>()
        const stubMembers = new Map<string, Uint8Array>()
        const packedSet = new Set(root.packed)

        const singles: Array<{ part: 'fixed' | 'character', name: string, key: string }> = []
        for (const name of root.directory) {
            if (packedSet.has(name)) {
                continue
            }
            singles.push(isFixedBlockName(name)
                ? { part: 'fixed', name, key: fixedBlockKey(generation, name) }
                : { part: 'character', name, key: ownBlockKey(generation, name) })
        }
        await mapLimit(singles, this.loadConcurrency, async (single) => {
            let read: { bytes: Uint8Array | null, version: number | null }
            try {
                read = await this.readWithRetry(single.key)
            } catch (error) {
                if (error instanceof StoreNotBinaryError) {
                    damage.push({ part: single.part, name: single.name, key: single.key, kind: 'framing', detail: 'The entry is not binary data.' })
                    return
                }
                throw error
            }
            if (read.bytes === null) {
                damage.push({ part: single.part, name: single.name, key: single.key, kind: 'absent', detail: 'The value is missing.' })
                return
            }
            keys.set(single.key, { bytes: read.bytes, version: read.version })
            const checked = checkSingleBlock(read.bytes, single.name)
            if (checked.status !== 'ok') {
                damage.push({ part: single.part, name: single.name, key: single.key, kind: checked.kind, detail: checked.detail })
                return
            }
            blocks.set(single.name, read.bytes)
        })

        if (root.packed.length > 0) {
            const key = stubsKey(generation)
            let read: { bytes: Uint8Array | null, version: number | null } = { bytes: null, version: null }
            let notBinary = false
            try {
                read = await this.readWithRetry(key)
            } catch (error) {
                if (!(error instanceof StoreNotBinaryError)) {
                    throw error
                }
                notBinary = true
            }
            if (read.bytes === null || read.bytes.length === 0 || notBinary) {
                const kind: DamageKind = notBinary ? 'framing' : read.bytes === null ? 'absent' : 'empty'
                for (const name of root.packed) {
                    damage.push({ part: 'stub', name, key, kind, detail: 'The stubs pack is unreadable.' })
                }
            } else {
                keys.set(key, { bytes: read.bytes, version: read.version })
                const pack = readPack(read.bytes)
                for (const [name, bytes] of pack.found) {
                    stubMembers.set(name, bytes)
                }
                for (const name of root.packed) {
                    const found = pack.found.get(name)
                    if (found !== undefined) {
                        blocks.set(name, found)
                    } else if (pack.corrupt.has(name)) {
                        damage.push({ part: 'stub', name, key, kind: 'crc', detail: 'The stub\'s payload checksum does not match.' })
                    } else {
                        damage.push({
                            part: 'stub',
                            name,
                            key,
                            kind: pack.broken ? 'framing' : 'absent',
                            detail: pack.broken ? 'The pack\'s framing is damaged before this stub.' : 'The stub is not in the pack.',
                        })
                    }
                }
            }
        }

        if (damage.length > 0) {
            return {
                result: { kind: 'damaged', generation, damage, rootFields: root.fields, directory: root.directory },
                live: null,
                head,
                generation,
                rootBytes: root.bytes,
            }
        }

        const live: LiveState = {
            generation,
            convertedFrom: parsed.record.convertedFrom ?? null,
            convertedAt: parsed.record.convertedAt ?? null,
            seq: root.seq,
            rootBytes: root.bytes,
            rootVersion: root.version,
            rootInput: null,
            directory: root.directory.slice(),
            packed: root.packed.slice(),
            keys,
            stubMembers,
            headCheckPending: false,
            rootOwed: false,
            stopped: null,
        }
        const loaded: LoadedBlocks = {
            generation,
            seq: root.seq,
            convertedFrom: live.convertedFrom,
            convertedAt: live.convertedAt,
            directory: root.directory,
            packed: root.packed,
            root: root.bytes,
            rootFields: root.fields,
            blocks,
        }
        return { result: { kind: 'loaded', loaded }, live, head, generation, rootBytes: root.bytes }
    }

    private async readRoot(generation: string): Promise<
        | { status: 'ok', bytes: Uint8Array, version: number | null, fields: JsonObject, seq: number, directory: string[], packed: string[] }
        | { status: 'damaged', bytes: Uint8Array | null, damage: DamagedItem }
    > {
        const key = rootKey(generation)
        const fail = (bytes: Uint8Array | null, kind: DamageKind, detail: string) => ({
            status: 'damaged' as const,
            bytes,
            damage: { part: 'root' as const, name: ROOT_BLOCK_NAME, key, kind, detail },
        })
        let read: { bytes: Uint8Array | null, version: number | null }
        try {
            read = await this.readWithRetry(key)
        } catch (error) {
            if (error instanceof StoreNotBinaryError) {
                return fail(null, 'framing', 'The root is not binary data.')
            }
            throw error
        }
        if (read.bytes === null) {
            return fail(null, 'absent', 'The root is missing.')
        }
        const checked = checkSingleBlock(read.bytes, ROOT_BLOCK_NAME)
        if (checked.status !== 'ok') {
            return fail(read.bytes, checked.kind, checked.detail)
        }
        let fields: JsonObject
        try {
            fields = parseJsonObjectBlock(read.bytes, ROOT_BLOCK_NAME).fields
        } catch (error) {
            if (error instanceof BlockFrameError) {
                return fail(read.bytes, 'bad-root', error.message)
            }
            throw error
        }
        const directory = fields.__directory
        const packed = fields.__packed
        const seq = fields.__seq
        if (!Array.isArray(directory) || !directory.every((name) => typeof name === 'string')) {
            return fail(read.bytes, 'bad-root', 'The root has no directory.')
        }
        if (!Array.isArray(packed) || !packed.every((name) => typeof name === 'string')) {
            return fail(read.bytes, 'bad-root', 'The root has no list of packed names.')
        }
        if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
            return fail(read.bytes, 'bad-root', 'The root has no sequence number.')
        }
        const names = directory as string[]
        const packedNames = packed as string[]
        if (new Set(names).size !== names.length) {
            return fail(read.bytes, 'bad-root', 'The directory lists a name twice.')
        }
        const listed = new Set(names)
        if (packedNames.some((name) => !listed.has(name) || isFixedBlockName(name))) {
            return fail(read.bytes, 'bad-root', 'The packed names are not all character blocks of the directory.')
        }
        return { status: 'ok', bytes: read.bytes, version: read.version, fields, seq, directory: names, packed: packedNames }
    }

    // -- commitSave ------------------------------------------------------------

    /**
     * Commits one save into the live generation: the values that differ from
     * the acknowledged ones, the stubs pack when a member changed or was added,
     * then the root with `__seq` incremented. The root is written whenever
     * anything else was, and nothing at all is written when nothing changed.
     *
     * The caller holds the page's write lock. This takes the commit lock and
     * never the page's write lock or a storage tab lock.
     */
    async commitSave(input: BlockSetInput, options: CommitOptions = {}): Promise<CommitResult> {
        const live = this.requireLive()
        if (live.stopped !== null) {
            return { kind: 'stopped', reason: live.stopped, peerSeq: null }
        }
        if (options.saveMine !== undefined && this.versioned) {
            throw new BlockOwnerStateError('Save mine is not offered on the Node server.')
        }
        const set = describeBlockSet(input)
        for (const listed of live.directory) {
            if (isFixedBlockName(listed) && !set.blocks.has(listed)) {
                throw new BlockSetInvalidError(`The fixed block "${listed}" is missing from the save.`)
            }
        }
        const force = options.saveMine !== undefined

        const wanted = new Map<string, { name: string, bytes: Uint8Array }>()
        for (const name of set.names) {
            if (!set.packedSet.has(name)) {
                wanted.set(ownBlockKey(live.generation, name), { name, bytes: set.blocks.get(name) })
            }
        }
        const writes: Array<{ key: string, name: string, bytes: Uint8Array }> = []
        for (const [key, value] of wanted) {
            const ack = live.keys.get(key)
            if (force || ack === undefined || ack.bytes === null || !bytesEqual(ack.bytes, value.bytes)) {
                this.checkNodeSize(value.name, value.bytes)
                writes.push({ key, name: value.name, bytes: value.bytes })
            } else if (ack.bytes !== value.bytes) {
                // Equal content held as another object: the caller's object becomes the acknowledged one, so
                // the next save of the unchanged block is settled by identity and compares no bytes.
                live.keys.set(key, { bytes: value.bytes, version: ack.version })
            }
        }

        const members = new Map(live.stubMembers)
        let membersChanged = false
        const gated: Array<readonly [string, Uint8Array]> = [[ROOT_BLOCK_NAME, set.rootInput]]
        for (const write of writes) {
            gated.push([write.name, write.bytes])
        }
        for (const name of set.packedOrdered) {
            const bytes = set.blocks.get(name)
            const old = members.get(name)
            if (old === undefined || !bytesEqual(old, bytes)) {
                members.set(name, bytes)
                membersChanged = true
                gated.push([name, bytes])
            } else if (old !== bytes) {
                members.set(name, bytes)
                live.stubMembers.set(name, bytes)
            } else if (force) {
                gated.push([name, bytes])
            }
        }
        // Before any value is put in the store: a value that could not be read back
        // is refused here and leaves the store as it was.
        gateBlocksBeforeWrite(gated)
        const stubsAck = live.keys.get(stubsKey(live.generation))
        const packNeedsWrite = force
            ? set.packedOrdered.length > 0 || members.size > 0
            : membersChanged || (members.size > 0 && (stubsAck === undefined || stubsAck.bytes === null))

        const rootUnchangedShortcut = live.rootInput !== null
            && bytesEqual(live.rootInput, set.rootInput)
            && sameList(live.directory, set.names)
            && sameList(live.packed, set.packedOrdered)
        const wroteSomething = writes.length > 0 || packNeedsWrite || live.rootOwed
        let rootEqual = rootUnchangedShortcut
        if (!force && !wroteSomething && !rootEqual) {
            rootEqual = bytesEqual(buildRoot(set, live.seq), live.rootBytes)
            if (rootEqual) {
                live.rootInput = set.rootInput
            }
        }
        const nothingToWrite = !force && !wroteSomething && rootEqual
        if (nothingToWrite && !live.headCheckPending) {
            return { kind: 'committed', wrote: false, seq: live.seq, cleanup: null }
        }

        return await this.commitLock.run(async () => {
            if (this.state !== 'live' || this.live !== live) {
                throw new BlockOwnerStateError('The owner changed state while the commit waited for the lock.')
            }
            if (live.stopped !== null) {
                return { kind: 'stopped', reason: live.stopped, peerSeq: null } as const
            }
            if (live.headCheckPending) {
                const moved = await this.checkHead(live)
                if (moved) {
                    return { kind: 'stopped', reason: 'head-moved', peerSeq: null } as const
                }
            }
            if (nothingToWrite) {
                return { kind: 'committed', wrote: false, seq: live.seq, cleanup: null } as const
            }
            let baseSeq = live.seq
            if (!this.versioned) {
                const stored = await this.readStoredSeq(live)
                if (stored === 'absent') {
                    return { kind: 'stopped', reason: 'generation-gone', peerSeq: null } as const
                }
                const expected = options.saveMine === undefined ? live.seq : options.saveMine.peerSeq
                if (stored !== expected) {
                    return { kind: 'stopped', reason: 'peer-commit', peerSeq: stored } as const
                }
                baseSeq = expected
            }

            const root = buildRoot(set, baseSeq + 1)
            this.checkNodeSize(ROOT_BLOCK_NAME, root)
            const rootCondition = this.conditionFor(live.rootVersion)

            let packBytes: Uint8Array | null = null
            if (packNeedsWrite) {
                if (force && !this.versioned) {
                    // The pack in the store may list members this tab never saw; keep them until the new root is durable.
                    const storedPack = await this.store.read(stubsKey(live.generation))
                    if (storedPack.bytes !== null) {
                        const union = new Map(readPack(storedPack.bytes).found)
                        for (const [name, bytes] of members) {
                            union.set(name, bytes)
                        }
                        members.clear()
                        for (const [name, bytes] of union) {
                            members.set(name, bytes)
                        }
                    }
                }
                packBytes = buildPack(members.values())
                this.checkNodeSize('stubs', packBytes)
            }

            for (const write of writes) {
                const outcome = await this.writeAcknowledged(live, write.key, write.bytes)
                if (outcome === 'conflict') {
                    return { kind: 'conflict', key: write.key } as const
                }
            }
            if (packBytes !== null) {
                const key = stubsKey(live.generation)
                const outcome = await this.writeAcknowledged(live, key, packBytes)
                if (outcome === 'conflict') {
                    return { kind: 'conflict', key } as const
                }
                live.stubMembers = new Map(members)
            }

            let rootResult: { version: number | null }
            try {
                rootResult = await this.put(rootKey(live.generation), root, rootCondition)
            } catch (error) {
                live.rootInput = null
                // A root write that threw may have landed: the stored root is then not
                // the acknowledged one, and a later save of exactly the acknowledged
                // state must not be taken for a save that has nothing to write.
                live.rootOwed = true
                if (error instanceof StoreVersionConflictError) {
                    return { kind: 'conflict', key: rootKey(live.generation) } as const
                }
                throw error
            }
            live.rootBytes = root
            live.rootVersion = rootResult.version
            live.seq = baseSeq + 1
            live.directory = set.names
            live.packed = set.packedOrdered
            live.rootInput = set.rootInput
            live.rootOwed = false

            if (await this.checkHead(live)) {
                return { kind: 'stopped', reason: 'head-moved', peerSeq: null } as const
            }

            const cleanup = await this.cleanupAfterCommit(live, wanted, set)
            return { kind: 'committed', wrote: true, seq: live.seq, cleanup } as const
        })
    }

    private requireLive(): LiveState {
        if (this.state !== 'live' || this.live === null) {
            throw new BlockOwnerStateError(this.state === 'closed' ? 'The owner is closed; reload the page.' : 'No generation is loaded.')
        }
        return this.live
    }

    private conditionFor(version: number | null): StoreCondition {
        if (!this.versioned) {
            return 'unconditional'
        }
        if (version === null) {
            throw new BlockOwnerStateError('A Node write has no revision to present.')
        }
        return { ifVersion: version }
    }

    /**
     * Writes `key` and records the acknowledgement when the write resolves. A
     * key with no recorded revision (a garbage key: an orphan, or one the owner
     * deleted) is read first and written on the revision that read reported; a
     * key the owner has a revision for presents that revision and is never
     * re-read to overwrite. A write that throws clears the acknowledged bytes and keeps the
     * recorded revision.
     */
    private async writeAcknowledged(live: LiveState, key: string, bytes: Uint8Array, owesRoot = true): Promise<'written' | 'conflict'> {
        const ack = live.keys.get(key)
        let version = ack?.version ?? null
        if (this.versioned && ack === undefined) {
            const current = await this.store.read(key)
            if (current.bytes !== null && bytesEqual(current.bytes, bytes)) {
                live.keys.set(key, { bytes, version: current.version })
                return 'written'
            }
            version = current.version
        }
        try {
            const result = await this.put(key, bytes, this.conditionFor(version))
            live.keys.set(key, { bytes, version: result.version })
            if (owesRoot) {
                live.rootOwed = true
            }
            return 'written'
        } catch (error) {
            if (ack !== undefined) {
                live.keys.set(key, { bytes: null, version: ack.version })
            }
            if (error instanceof StoreVersionConflictError) {
                return 'conflict'
            }
            throw error
        }
    }

    private async readStoredSeq(live: LiveState): Promise<number | 'absent'> {
        const key = rootKey(live.generation)
        const read = await this.readWithRetry(key)
        if (read.bytes === null) {
            return 'absent'
        }
        let seq: unknown
        try {
            seq = parseJsonObjectBlock(read.bytes, ROOT_BLOCK_NAME).fields.__seq
        } catch (error) {
            throw new BlockStoreReadError(key, error)
        }
        if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
            throw new BlockStoreReadError(key, new Error('The root has no sequence number.'))
        }
        return seq
    }

    /** Reads the head; `true` when it does not name this generation. A failed read leaves the check pending for the next commit. */
    private async checkHead(live: LiveState): Promise<boolean> {
        let head: HeadRead
        try {
            head = await this.readHeadWithRetry()
        } catch (error) {
            live.headCheckPending = true
            throw error
        }
        live.headCheckPending = false
        // An absent head, a head that is not bytes and one that is not a pointer name no generation.
        const parsed = head.kind === 'bytes' ? parseHead(head.bytes) : null
        if (parsed !== null && parsed.status === 'ok' && parsed.record.current === live.generation) {
            return false
        }
        live.stopped = 'head-moved'
        return true
    }

    private async cleanupAfterCommit(
        live: LiveState,
        wanted: ReadonlyMap<string, unknown>,
        set: DescribedSet,
    ): Promise<CleanupReport> {
        // Off Node the deletes are safe only while the commit lock excludes every other tab's root write.
        if (!this.versioned && !this.commitLock.available) {
            return { skipped: true, deleted: 0, failed: 0 }
        }
        let deleted = 0
        let failed = 0
        const packKey = stubsKey(live.generation)
        const packedNonEmpty = set.packedOrdered.length > 0

        if (packedNonEmpty && Array.from(live.stubMembers.keys()).some((name) => !set.packedSet.has(name))) {
            const trimmed = new Map<string, Uint8Array>()
            for (const name of set.packedOrdered) {
                trimmed.set(name, live.stubMembers.get(name))
            }
            try {
                const outcome = await this.writeAcknowledged(live, packKey, buildPack(trimmed.values()), false)
                if (outcome === 'written') {
                    live.stubMembers = trimmed
                } else {
                    failed++
                }
            } catch {
                failed++
            }
        }

        const doomed: Array<{ key: string, condition: StoreCondition }> = []
        for (const [key, ack] of live.keys) {
            if (wanted.has(key) || key === packKey && packedNonEmpty) {
                continue
            }
            if (key.startsWith(`${generationPrefix(live.generation)}f/`)) {
                continue
            }
            if (this.versioned && ack.version === null) {
                continue
            }
            doomed.push({ key, condition: this.versioned ? { ifVersion: ack.version } : 'unconditional' })
        }
        if (doomed.length > 0) {
            try {
                await this.store.deleteMany(doomed)
                for (const entry of doomed) {
                    live.keys.delete(entry.key)
                    deleted++
                }
                if (!packedNonEmpty) {
                    live.stubMembers = new Map()
                }
            } catch (error) {
                if (error instanceof StoreDeleteManyError) {
                    for (const entry of error.report) {
                        if (entry.outcome === 'removed') {
                            live.keys.delete(entry.key)
                            deleted++
                        } else {
                            failed++
                        }
                    }
                } else {
                    failed += doomed.length
                }
            }
        }
        return { skipped: false, deleted, failed }
    }

    // -- replaceWholeState --------------------------------------------------------

    /**
     * Replaces the whole state: builds a new generation (root last), checks
     * that its root reads back, and switches to it with a compare-and-swap of
     * the head against exactly what this call read first.
     *
     * - `won`: the head names the new generation. The previous generation is
     *   deleted afterwards, unless it carries a `kept` marker.
     * - `lost`: the head does not name the new generation. The own generation
     *   is deleted only when a re-read of the head names a third generation; a
     *   re-read that names the own generation makes the result `won`. A replace
     *   with `keepDamaged` only starts while the head still names that
     *   generation, so it never retires another one.
     * - `unconfirmed`: the swap's outcome could not be established. Nothing is
     *   deleted and the owner is closed; the page reloads.
     * - `aborted`: the `preFlip` check refused. The head did not move.
     *
     * With `keepAll` (an unreadable head) every generation that has a root is
     * marked kept before anything new is written; a replace of that kind that
     * ends without winning removes the markers it wrote on the generation the
     * head then names, whether it was lost, aborted or found its root damaged.
     * An `unconfirmed` one leaves them.
     *
     * Every head written here carries the `convertedFrom` and `convertedAt` of
     * the head that was read, unless the caller passes new ones; a commit never
     * writes the head.
     *
     * The caller holds whatever excludes other writers of its kind (the
     * exclusive storage hold for a restore); this takes no lock.
     */
    async replaceWholeState(input: BlockSetInput, options: ReplaceOptions = {}): Promise<ReplaceResult> {
        if (this.state === 'closed') {
            throw new BlockOwnerStateError('The owner is closed; reload the page.')
        }
        const set = describeBlockSet(input)
        // Before the root is built or any value is put in the store: a value that
        // could not be read back is refused here and the previous generation stays.
        gateBlocksBeforeWrite([
            [ROOT_BLOCK_NAME, set.rootInput],
            ...set.names.map((name): readonly [string, Uint8Array] => [name, set.blocks.get(name)]),
        ])

        // 1. What the head is now. A head that is not binary data is a present head that names no generation.
        const headRead = await this.readHeadWithRetry()
        const previousParsed: HeadParse | null = headRead.kind === 'bytes' ? parseHead(headRead.bytes) : null
        const previousRecord: HeadRecord | null = previousParsed !== null && previousParsed.status === 'ok' ? previousParsed.record : null
        const previousGeneration = previousRecord === null ? null : previousRecord.current
        if (options.requireAbsentHead === true && headRead.kind !== 'absent') {
            return { kind: 'lost', reason: 'head-exists', generation: null, ownGenerationDeleted: false }
        }
        // A replace that keeps a damaged generation only proceeds while the head still names it: step 6 retires
        // exactly the generation the head named here, and it must be the one the caller chose to keep.
        if (options.keepDamaged !== undefined && previousGeneration !== options.keepDamaged) {
            return { kind: 'lost', reason: 'head-moved', generation: null, ownGenerationDeleted: false }
        }
        // A keep-all replace only proceeds while the head is still the unreadable value the caller saw.
        if (options.keepAll === true && (headRead.kind === 'absent' || previousRecord !== null)) {
            return { kind: 'lost', reason: 'head-moved', generation: null, ownGenerationDeleted: false }
        }
        // Every head this replace writes carries the conversion fields of the head it read, unless the caller names new ones.
        const converted = options.convertedFrom !== undefined
            ? { convertedFrom: options.convertedFrom, convertedAt: options.convertedAt ?? this.generationIds.now() }
            : { convertedFrom: previousRecord?.convertedFrom, convertedAt: options.convertedAt ?? previousRecord?.convertedAt }

        // 2. Pre-flight: every value encoded and size-checked before anything is written.
        const generation = newGenerationId(this.generationIds)
        const root = buildRoot(set, 0)
        const values: Array<{ key: string, name: string, bytes: Uint8Array }> = []
        for (const name of set.names) {
            if (isFixedBlockName(name)) {
                values.push({ key: fixedBlockKey(generation, name), name, bytes: set.blocks.get(name) })
            }
        }
        for (const name of set.names) {
            if (!isFixedBlockName(name) && !set.packedSet.has(name)) {
                values.push({ key: ownBlockKey(generation, name), name, bytes: set.blocks.get(name) })
            }
        }
        const members = new Map<string, Uint8Array>()
        for (const name of set.packedOrdered) {
            members.set(name, set.blocks.get(name))
        }
        if (members.size > 0) {
            values.push({ key: stubsKey(generation), name: 'stubs', bytes: buildPack(members.values()) })
        }
        if (this.versioned) {
            for (const value of [...values, { key: rootKey(generation), name: ROOT_BLOCK_NAME, bytes: root }]) {
                if (value.bytes.length > this.nodeBodyLimit) {
                    return { kind: 'refused', blockName: value.name, length: value.bytes.length, limit: this.nodeBodyLimit }
                }
            }
        }

        // 3. Write the new generation, root last. The damage prompt's replace first marks the damaged generation
        // kept, or, over an unreadable head, every generation that has a root.
        if (options.keepDamaged !== undefined) {
            await this.writeKeptMarker(options.keepDamaged)
        }
        const markersWritten = new Set<string>()
        if (options.keepAll === true) {
            const inventory = await inspectGenerations(this.store, null)
            for (const info of inventory.generations) {
                if (info.hasRoot && await this.writeKeptMarker(info.id)) {
                    markersWritten.add(info.id)
                }
            }
        }
        const acknowledged = new Map<string, KeyAck>()
        for (const value of values) {
            const result = await this.put(value.key, value.bytes, 'unconditional')
            acknowledged.set(value.key, { bytes: value.bytes, version: result.version })
        }
        const rootResult = await this.put(rootKey(generation), root, 'unconditional')

        // 4. The new root must read back as written.
        const readBack = await this.readWithRetry(rootKey(generation))
        if (readBack.bytes === null || !bytesEqual(readBack.bytes, root)) {
            await this.removeMarkersAfterLoss(markersWritten)
            return { kind: 'lost', reason: 'generation-damaged', generation, ownGenerationDeleted: false }
        }

        // 5. The flip, unless the caller's last check refuses it.
        if (options.preFlip !== undefined) {
            let proceed: boolean
            try {
                proceed = options.preFlip()
            } catch (error) {
                await retireGeneration(this.store, generation)
                await this.removeMarkersAfterLoss(markersWritten)
                throw error
            }
            if (!proceed) {
                const deleted = (await retireGeneration(this.store, generation)) === 'deleted'
                await this.removeMarkersAfterLoss(markersWritten)
                return { kind: 'aborted', ownGenerationDeleted: deleted }
            }
        }
        const next = encodeHead({ current: generation, ...converted })
        let outcome = await this.flipHead(headRead, next)
        if (outcome === 'unknown') {
            let reread: HeadRead | null = null
            try {
                reread = await this.readHeadWithRetry()
            } catch {
                reread = null
            }
            if (reread === null) {
                this.state = 'closed'
                return { kind: 'unconfirmed', reason: 'unreadable', generation }
            }
            const rereadParsed = reread.kind === 'bytes' ? parseHead(reread.bytes) : null
            if (rereadParsed !== null && rereadParsed.status === 'ok' && rereadParsed.record.current === generation) {
                outcome = 'won'
            } else if (sameHeadRead(reread, headRead)) {
                this.state = 'closed'
                return { kind: 'unconfirmed', reason: 'unchanged', generation }
            } else {
                await this.removeMarkersOnWinner(markersWritten, rereadParsed)
                return { kind: 'lost', reason: 'head-moved', generation, ownGenerationDeleted: false }
            }
        }
        if (outcome === 'lost') {
            let deletedOwn = false
            try {
                const reread = await this.headSwap.read()
                const parsed = reread.kind === 'bytes' ? parseHead(reread.bytes) : null
                if (parsed !== null && parsed.status === 'ok' && parsed.record.current === generation) {
                    // The first copy of a replayed swap landed: the head names this replace's generation.
                    outcome = 'won'
                } else if (parsed !== null && parsed.status === 'ok' && parsed.record.current !== previousGeneration) {
                    deletedOwn = (await retireGeneration(this.store, generation, parsed.record.current)) === 'deleted'
                    await this.removeMarkersOnWinner(markersWritten, parsed)
                }
            } catch {
                deletedOwn = false
                await this.removeMarkersAfterLoss(markersWritten)
            }
            if (outcome === 'lost') {
                return { kind: 'lost', reason: 'head-mismatch', generation, ownGenerationDeleted: deletedOwn }
            }
        }

        // Won: this owner's live generation is the new one.
        const keys = acknowledged
        this.live = {
            generation,
            convertedFrom: converted.convertedFrom ?? null,
            convertedAt: converted.convertedAt ?? null,
            seq: 0,
            rootBytes: root,
            rootVersion: rootResult.version,
            rootInput: set.rootInput,
            directory: set.names,
            packed: set.packedOrdered,
            keys,
            stubMembers: members,
            headCheckPending: false,
            rootOwed: false,
            stopped: null,
        }
        this.state = 'live'

        // 6. The previous generation goes, root first, unless it is kept. No head write follows.
        let previous: PreviousGeneration = { state: 'none' }
        if (previousGeneration !== null && previousGeneration !== generation) {
            const retired = await retireGeneration(this.store, previousGeneration, generation)
            previous = { state: retired, generation: previousGeneration }
        }
        return { kind: 'won', generation, previous }
    }

    /**
     * The only call of the head swap, and so the only write of the head. A
     * rejection means the outcome is unknown, never that the swap was lost.
     */
    private async flipHead(expected: HeadRead, next: Uint8Array): Promise<'won' | 'lost' | 'unknown'> {
        try {
            return await this.headSwap.swap(expected, next)
        } catch {
            return 'unknown'
        }
    }

    /**
     * Writes the `kept` marker of `generation` unless one exists. Whether this
     * call wrote it. On the Node server a rival that writes the same marker
     * between this read and this write makes the write a version conflict: the
     * generation is marked either way, and the marker is not this call's.
     */
    private async writeKeptMarker(generation: string): Promise<boolean> {
        const key = keptKey(generation)
        const current = await this.readWithRetry(key)
        if (current.bytes !== null && current.bytes.length > 0) {
            return false
        }
        const marker = new TextEncoder().encode(JSON.stringify({ kept: true, at: this.generationIds.now() }))
        try {
            await this.put(key, marker, this.versioned ? this.conditionFor(current.version) : 'unconditional')
        } catch (error) {
            if (error instanceof StoreVersionConflictError) {
                return false
            }
            throw error
        }
        return true
    }

    /**
     * A replace that did not win removes the markers it wrote itself from the
     * generation the head now names, so a rival that won is not left marked
     * kept by it. Best effort. While that generation is live it is reported
     * only as current, marker or not; a marker that stays on it would keep the
     * generation once a later replace supersedes it, until clean-up deletes it.
     */
    private async removeMarkersOnWinner(written: ReadonlySet<string>, head: HeadParse | null): Promise<void> {
        if (head === null || head.status !== 'ok' || !written.has(head.record.current)) {
            return
        }
        try {
            await this.store.delete(keptKey(head.record.current), 'unconditional')
        } catch {
            // The marker stays; see above for what that costs.
        }
    }

    /** `removeMarkersOnWinner` for an exit that has not re-read the head: reads it once, best effort. */
    private async removeMarkersAfterLoss(written: ReadonlySet<string>): Promise<void> {
        if (written.size === 0) {
            return
        }
        try {
            const head = await this.headSwap.read()
            await this.removeMarkersOnWinner(written, head.kind === 'bytes' ? parseHead(head.bytes) : null)
        } catch {
            // The head cannot be read now; the markers stay.
        }
    }

    // -- seeding -------------------------------------------------------------------

    /**
     * What stands in the way of seeding an empty profile: a head, a main file,
     * a `pre-blocks` copy or a numbered backup. `blocks/` keys without a head
     * are garbage and do not count. Reads and lists only.
     */
    async findSeedBlockers(): Promise<SeedBlocker[]> {
        const found: SeedBlocker[] = []
        // A head that is not binary data is present: it is not an empty profile.
        if ((await this.readHeadWithRetry()).kind !== 'absent') {
            found.push({ kind: 'head', keys: [HEAD_KEY] })
        }
        if (await this.store.has(LEGACY_MAIN_FILE_KEY)) {
            found.push({ kind: 'main-file', keys: [LEGACY_MAIN_FILE_KEY] })
        }
        const preBlocks = await this.store.list(PRE_BLOCKS_PREFIX)
        if (preBlocks.length > 0) {
            found.push({ kind: 'pre-blocks', keys: preBlocks })
        }
        const backups = await this.store.list(NUMBERED_BACKUP_PREFIX)
        if (backups.length > 0) {
            found.push({ kind: 'numbered-backup', keys: backups })
        }
        return found
    }

    /**
     * Seeds an empty profile: a replace whose swap is against "no head", run
     * only when nothing at all is found. Nothing is seeded over data.
     */
    async seedEmptyProfile(input: BlockSetInput): Promise<SeedResult> {
        const found = await this.findSeedBlockers()
        if (found.length > 0) {
            return { kind: 'blocked', found }
        }
        const inventory = await inspectGenerations(this.store, null)
        const result = await this.replaceWholeState(input, { requireAbsentHead: true })
        return { kind: 'replaced', result, leftoverGenerations: inventory.generations.map((info) => info.id) }
    }

    /**
     * The generations in the store, with the live one told apart from leftovers
     * and kept ones. Reads only. An owner that holds no generation (not loaded,
     * or closed) takes the live one from the head, so a marked generation the
     * head names is not listed as kept there either; a head that cannot be read
     * names none.
     */
    async inventory(): Promise<GenerationInventory> {
        if (this.state === 'live' && this.live !== null) {
            return await inspectGenerations(this.store, this.live.generation)
        }
        const head = await this.readHeadWithRetry()
        const parsed = head.kind === 'bytes' ? parseHead(head.bytes) : null
        return await inspectGenerations(this.store, parsed !== null && parsed.status === 'ok' ? parsed.record.current : null)
    }
}

interface LoadAttempt {
    result: LoadResult
    live: LiveState | null
    /** The head as this attempt read it. */
    head: HeadRead
    generation: string | null
    rootBytes: Uint8Array | null
}
