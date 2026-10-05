/**
 * Test-only builders for the boot archive pass suites: character and tree
 * fixtures, save-file builders that use the real `RisuSaveEncoder`, a block
 * lister, an in-memory OPFS directory, a unit store with fault injection, and
 * a "world" that wires every `BootArchiveDeps` effect over a block store and
 * its owner: the real Node HTTP store over the Node-server stand-in
 * (`FakeNodeServer` behind the real `NodeStorage`), or an in-memory unversioned
 * store with an in-memory OPFS directory for the units.
 *
 * A world starts as a legacy profile (the main file at `database/database.bin`,
 * no head) or, with `blockWorldFor`, as a block profile. `bootOnce` is one page
 * load: a fresh owner, the owner's `load()`, then the pass over the tree it
 * decoded. The pass's commit lands in the store through the production seams
 * (`bootPassSeams.ts`), so a conversion or a save is what the store holds
 * afterwards; `mainWrites` records the file image of each commit that landed.
 *
 * Nothing here imports application modules that the code under test may have
 * mocked at load time: the encoder class, the decoder, the storage client and
 * the module under test are passed in by the caller (`WorldKit`), and the
 * block-store modules are imported when a world is set up, so they come from
 * the same module graph as the code under test. Nothing here says anything
 * about Tauri or about the native backends; every effect is an in-memory
 * model.
 */
import { vi } from 'vitest'
import { BLOCK, FakeNodeServer, composeSave } from './manualCleanupHarness'
import { FakeAsyncMutex, FakeLockManagerCore, FakeTabLockManagerView } from './fakeWebLocks'
import { createFakeStore, makeOwner, passthroughLock, type FakeStore } from './blockStoreHarness'
import { createStorageTabLocks, type StorageTabLocks } from '../storageTabLocks'
import type { BlockSetInput, BlockStoreOwner } from '../blockStore'
import type {
    BootArchiveDeps,
    BootArchiveEnvironment,
    BootArchiveHoldRelease,
    BootArchiveHost,
    BootArchiveOutcome,
    BootArchiveSession,
    BootReread,
} from '../bootArchivePass'
import type { BootPassSeams } from '../bootPassSeams'
import type { RisuSaveEncoder } from '../risuSave'
import type { Database } from '../database.svelte'
import type { ByteStore } from '../store/contract'

export { BLOCK }

export const MAIN_KEY = 'database/database.bin'

/** A `uuid` v4. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const COLD_POINTER_HEADER = 'COLDSTORAGE'

export type Json = Record<string, unknown>
export type EncoderClass = new () => RisuSaveEncoder

//#region fixtures

let uidCounter = 0

/** A value no other test in the file used, for names that module-level encoder state remembers (remote file names). */
export function uid(prefix: string): string {
    uidCounter++
    return `${prefix}-${Date.now().toString(36)}-${uidCounter}`
}

export function fullCharacter(chaId: string, name: string, extra: Json = {}): Json {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `chat-${chaId}`, message: [{ time: 1, data: `hello from ${name}`, role: 'char' }], note: '', name: '', localLore: [] }],
        desc: `${name} description`,
        creatorNotes: `${name} notes`,
        ...extra,
    }
}

/** A stub as the fork writes it (`coldVersion` 2). */
export function currentStub(chaId: string, name: string, unitKey: string, extra: Json = {}): Json {
    return {
        type: 'character',
        name,
        chaId,
        creatorNotes: '',
        coldstorage: unitKey,
        coldStoragedChats: [],
        chats: [{ id: `stub-chat-${chaId}`, message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldVersion: 2,
        coldChatCount: 3,
        ...extra,
    }
}

/** A stub as the upstream application writes it: no `coldVersion`, a placeholder chat without an id. */
export function upstreamStub(chaId: string, name: string, unitKey: string): Json {
    return {
        type: 'character',
        image: '',
        name,
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        chaId,
        firstMsgIndex: 0,
        coldstorage: unitKey,
        coldStoragedChats: [],
    }
}

/** A group as a unit holds it: the real `type`, a member list, two chats and a description. */
export function groupCharacter(chaId: string, name: string, members: string[], extra: Json = {}): Json {
    return {
        chaId,
        name,
        type: 'group',
        image: '',
        characters: members,
        chatPage: 0,
        chats: [
            { id: `chat-${chaId}-1`, message: [{ time: 1, data: `first chat of ${name}`, role: 'user' }], note: '', name: '', localLore: [] },
            { id: `chat-${chaId}-2`, message: [{ time: 2, data: `second chat of ${name}`, role: 'user' }], note: '', name: '', localLore: [] },
        ],
        creatorNotes: `${name} group notes`,
        lastInteraction: 1_700_000_000_500,
        ...extra,
    }
}

/** The value a unit file holds: one `character` property, as the upstream application and the pass both write it. */
export function unitValue(character: unknown): { character: unknown } {
    return { character }
}

/** A decoded main-file tree holding the container fields `setDatabase` would default. */
export function baseTree(characters: unknown[], extra: Json = {}): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'preset' }],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        ...extra,
    } as unknown as Database
}

export function plugin(version: unknown, enabled: boolean, name = 'plugin'): Json {
    return { name, version, enabled, script: '', arguments: {}, realArg: {}, customLink: [] }
}

export function charactersOf(tree: Database): Json[] {
    return tree.characters as unknown as Json[]
}

export function chaIdsOf(tree: Database): string[] {
    return charactersOf(tree).map((c) => c.chaId as string)
}

/** The content a character list holds, compared through JSON as the encoder would write it. */
export function jsonOf(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value))
}

//#endregion

//#region save-file builders

/** The file `saveDb` writes for `tree`: fresh encoder, `init` (compression off), `set` with an empty to-save, `encode`. */
export async function encodeAsSaveDb(Encoder: EncoderClass, tree: Database): Promise<Uint8Array> {
    const encoder = new Encoder()
    await encoder.init(tree, { compression: false })
    await encoder.set(tree, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode() as ArrayBuffer)
}

/**
 * A file in the shape an upstream build wrote from upstream `31e6eb33`
 * (2025-08-05) until `6470e1c4` (2026-03-30), the commit that added the
 * loadouts, plugins and plugin-storage blocks: `formatversion` 5 and no
 * `loadouts` or `pluginStorage` block. Such a file also has a MODULES block and
 * keeps `plugins` inside the root block. This fixture differs in two ways: it
 * writes a PLUGINS block and no MODULES block, so a strict decode of it yields
 * a tree with no `modules` and no `loadouts`.
 */
export async function encodeUpstreamEraFile(Encoder: EncoderClass, tree: Database): Promise<Uint8Array> {
    const encoder = new Encoder()
    const characters = charactersOf(tree)
    const root: Json = {}
    for (const [key, value] of Object.entries(tree)) {
        if (key !== 'characters' && key !== 'botPresets' && key !== 'modules' && key !== 'loadouts' && key !== 'plugins' && key !== 'pluginCustomStorage') {
            root[key] = value
        }
    }
    root.__directory = ['preset', 'plugins', ...characters.map((c) => String(c.chaId)), 'config']
    const parts = [
        { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify(tree.botPresets) },
        { name: 'plugins', type: BLOCK.PLUGINS, data: JSON.stringify(tree.plugins ?? []) },
        ...characters.map((c) => ({ name: String(c.chaId), type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(c) })),
        { name: 'config', type: BLOCK.CONFIG, data: JSON.stringify({ version: 1 }) },
    ]
    return (await composeSave(encoder, parts)).bytes
}

export interface ListedBlock {
    name: string
    type: number
    data: Uint8Array
}

/** Walks a block-format save (header version 1, with checksums) without decoding any payload. */
export function listBlocks(bytes: Uint8Array): ListedBlock[] {
    const blocks: ListedBlock[] = []
    let offset = 9
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    while (offset < bytes.length) {
        const type = bytes[offset]
        const nameLength = bytes[offset + 2]
        offset += 3
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const length = view.getUint32(offset, true)
        offset += 4 + 4
        blocks.push({ name, type, data: bytes.subarray(offset, offset + length) })
        offset += length + 4
    }
    return blocks
}

export function blockJson(block: ListedBlock): Json {
    return JSON.parse(new TextDecoder().decode(block.data)) as Json
}

const CHARACTER_BLOCK_TYPES: number[] = [BLOCK.CHARACTER_WITH_CHAT, BLOCK.REMOTE, 7]

/** The character blocks (inline or remote pointer) of a block-format save, in file order. */
export function characterBlocks(bytes: Uint8Array): ListedBlock[] {
    return listBlocks(bytes).filter((b) => CHARACTER_BLOCK_TYPES.includes(b.type))
}

export function bytesEqual(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
    if (!a || !b || a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

//#endregion

//#region remote files, in-memory OPFS and the unit store

/** The part of `forageStorage` the encoder and the decoder use for remote character files. */
export interface RemoteLike {
    getItem(key: string): Promise<unknown>
    setItem(key: string, value: Uint8Array): Promise<void>
    keys(): Promise<string[]>
}

export function memoryRemote(): RemoteLike & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>()
    return {
        files,
        async getItem(key) { return files.get(key) ?? null },
        async setItem(key, value) { files.set(key, value) },
        async keys() { return Array.from(files.keys()) },
    }
}

class FakeNotFoundError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'NotFoundError'
    }
}

/** An in-memory OPFS directory: `getFileHandle`, `createWritable`, `getFile`. */
export class FakeOpfsDirectory {
    files = new Map<string, Uint8Array>()

    async getFileHandle(name: string, options?: { create?: boolean }) {
        const files = this.files
        if (options?.create) {
            return {
                async createWritable() {
                    return {
                        async write(data: Uint8Array) { files.set(name, data.slice()) },
                        async close() { },
                    }
                },
            }
        }
        if (!files.has(name)) {
            throw new FakeNotFoundError(`not found: ${name}`)
        }
        return {
            async getFile() {
                return { async arrayBuffer() { return (files.get(name) as Uint8Array).slice().buffer } }
            },
        }
    }

    names(): string[] {
        return Array.from(this.files.keys())
    }
}

interface UnitBackend {
    put(key: string, bytes: Uint8Array): Promise<void>
    get(key: string): Promise<Uint8Array | null>
    keys(): Promise<string[]>
}

export type UnitFault = 'false' | 'throw'
export type UnitReadResult = { status: 'ok', value: unknown } | { status: 'missing' } | { status: 'error', error: unknown }

/**
 * The unit effects of one world. Records every write (the JSON of the value as
 * it was passed), can fail the n-th write attempt (1-based) as the real writer
 * does (`false`) or by throwing, and can answer a read-back differently.
 */
export class UnitStore {
    writes: { key: string, json: string }[] = []
    reads: string[] = []
    attempts = 0
    failWrite?: (attempt: number, key: string) => UnitFault | undefined
    readOverride?: (key: string, real: () => Promise<UnitReadResult>) => Promise<UnitReadResult>

    constructor(private backend: UnitBackend) { }

    async writeUnit(key: string, value: unknown): Promise<boolean> {
        this.attempts++
        const fault = this.failWrite?.(this.attempts, key)
        if (fault === 'throw') {
            throw new Error(`injected unit write failure for ${key}`)
        }
        if (fault === 'false') {
            return false
        }
        const json = JSON.stringify(value)
        this.writes.push({ key, json })
        await this.backend.put(key, new TextEncoder().encode(json))
        return true
    }

    async readUnit(key: string): Promise<UnitReadResult> {
        this.reads.push(key)
        const real = async (): Promise<UnitReadResult> => {
            const bytes = await this.backend.get(key)
            if (!bytes) {
                return { status: 'missing' }
            }
            return { status: 'ok', value: JSON.parse(new TextDecoder().decode(bytes)) }
        }
        return this.readOverride ? this.readOverride(key, real) : real()
    }

    /** The unit keys currently stored. */
    async keys(): Promise<string[]> {
        return this.backend.keys()
    }

    /**
     * Stores `value` as a unit with no write record and no attempt count: a unit
     * the upstream application or an earlier boot left in the storage.
     */
    async seed(key: string, value: unknown): Promise<void> {
        await this.backend.put(key, new TextEncoder().encode(JSON.stringify(value)))
    }

    /** The stored value of a unit, parsed. */
    async valueOf(key: string): Promise<Json> {
        const bytes = await this.backend.get(key)
        if (!bytes) {
            throw new Error(`no unit ${key}`)
        }
        return JSON.parse(new TextDecoder().decode(bytes)) as Json
    }

    /** The character each recorded write carried, in write order. */
    writtenCharacters(): Json[] {
        return this.writes.map((w) => (JSON.parse(w.json) as { character: Json }).character)
    }
}

function opfsUnitBackend(dir: FakeOpfsDirectory): UnitBackend {
    const fileName = (key: string) => `coldstorage_${key}.json`
    return {
        async put(key, bytes) {
            const handle = await dir.getFileHandle(fileName(key), { create: true })
            const writable = await (handle as { createWritable(): Promise<{ write(d: Uint8Array): Promise<void>, close(): Promise<void> }> }).createWritable()
            await writable.write(bytes)
            await writable.close()
        },
        async get(key) {
            try {
                const handle = await dir.getFileHandle(fileName(key))
                const file = await (handle as { getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> }).getFile()
                return new Uint8Array(await file.arrayBuffer())
            } catch (error) {
                if ((error as Error).name === 'NotFoundError') {
                    return null
                }
                throw error
            }
        },
        async keys() {
            return dir.names().map((n) => n.replace(/^coldstorage_/, '').replace(/\.json$/, ''))
        },
    }
}

/** The part of the real `NodeStorage` the node world uses. */
export interface NodeStorageLike extends RemoteLike {
    getItem(key: string): Promise<Uint8Array | null>
    authHeader(): Promise<string>
}

function nodeUnitBackend(storage: NodeStorageLike, server: FakeNodeServer): UnitBackend {
    return {
        async put(key, bytes) { await storage.setItem('coldstorage/' + key, bytes) },
        async get(key) {
            const bytes = await storage.getItem('coldstorage/' + key)
            return bytes ? new Uint8Array(bytes) : null
        },
        async keys() { return server.keysWithPrefix('coldstorage/').map((k) => k.slice('coldstorage/'.length)) },
    }
}

//#endregion

//#region simulated tab

export interface LockTab {
    locks: StorageTabLocks
    mutex: FakeAsyncMutex
}

/** One simulated tab on `core`, built like the page's own lock object: its write mutex is the one `saveDb` would take. */
export function makeTab(core: FakeLockManagerCore, tabId: string, options: { reload?: () => void } = {}): LockTab {
    const mutex = new FakeAsyncMutex()
    const locks = createStorageTabLocks(new FakeTabLockManagerView(core, tabId) as unknown as LockManager, mutex, { reload: options.reload })
    return { locks, mutex }
}

/** True when this tab's write lock can be taken promptly (a `saveDb` write would not wait). */
export async function writeLockIsFree(tab: LockTab, withinMs = 400): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
        tab.mutex.acquire().then((release) => { release(); return true }),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), withinMs) }),
    ])
    clearTimeout(timer)
    return outcome
}

//#endregion

//#region world

export type WorldHost = 'node' | 'opfs' | 'tauri'

/** What a test file supplies: the application modules from its own module graph. */
export interface WorldKit {
    Encoder: EncoderClass
    decodeRisuSave: (bytes: Uint8Array, options?: { strict?: boolean }) => Promise<Database>
    openBootArchiveSession: (host: BootArchiveHost, deps?: BootArchiveDeps) => Promise<BootArchiveSession>
    NodeStorage: new () => NodeStorageLike
    /** Points the mocked `forageStorage` (remote character files) at `remote`. */
    setRemote: (remote: RemoteLike) => void
}

export interface WorldOptions {
    /** Overrides for the environment the gates read. */
    env?: Partial<BootArchiveEnvironment>
    /** Cap on the grant wait so a refused hold settles quickly under test. */
    holdCapMs?: number
    createEncoder?: () => RisuSaveEncoder
    core?: FakeLockManagerCore
    /**
     * The limit the pass is told (`BootArchiveDeps.nodeBodyLimit`) and the owner
     * enforces on a store that enforces versions. On the Node world the fake
     * server also refuses a larger write body with a 413, as the real server
     * does; on the other worlds it is only told to the pass.
     */
    nodeBodyLimit?: number
    /**
     * The owner's commit lock: `process` (the desktop app's in-process lock, the
     * default on the Tauri world), `web` (a lock that is available, the default
     * elsewhere) or `none` (a page without Web Locks, off Node).
     */
    commitLock?: 'process' | 'web' | 'none'
}

/**
 * The notice memo the pass reads (`BootArchiveDeps.readArchiveMemo`). The pass
 * never writes it; bootstrap does, after it has posted the notice that carries
 * it (see `applyNoticeMemo`).
 */
export interface WorldMemo {
    skipped: Set<string>
    tooLarge: boolean
    /** The paused notice was posted on this device. */
    pausedTold: boolean
}

/**
 * The strike record of the crash-loop breaker as the pass sees it through its
 * deps. Unlike the notice memo, the pass itself writes it: a start record
 * before it writes anything and a reset when it succeeds.
 */
export interface WorldBreaker {
    /** The count the record holds, or `'unreadable'` when the storage cannot be read. */
    strikes: number | 'unreadable'
    /** Makes the count read throw instead of answering. */
    readThrows: boolean
    /** Makes the start record answer `false`: nothing is written. */
    startFails: boolean
    /** Makes the start record throw. */
    startThrows: boolean
    /** Makes the success reset throw. */
    resetThrows: boolean
    /** Every call the pass made to the record, in order. */
    calls: ('read' | 'start' | 'reset')[]
}

/**
 * The count that bounds stub enrichment on a profile with archiving off, as the
 * pass sees it through its deps. `stored` is the text under the count's key (the
 * absent key is `null`); the three dep functions read and write it as the
 * device record does: a start takes none to `'1'` and one to `'2'`, a clear
 * removes the key, and a stored value that is not a whole number reads as paused.
 */
export interface WorldEnrichStrikes {
    stored: string | null
    /** Makes the count read throw instead of answering. */
    readThrows: boolean
    /** Makes the count read answer `unreadable`. */
    unreadable: boolean
    /** Makes the start record answer `false`: nothing is written. */
    startFails: boolean
    /** Makes the start record throw. */
    startThrows: boolean
    /** Every call the pass made to the count, in order. */
    calls: ('read' | 'start' | 'clear')[]
}

export interface World {
    host: WorldHost
    kit: WorldKit
    deps: BootArchiveDeps
    units: UnitStore
    /** Absent on Tauri (no Web Lock). */
    tab: LockTab | null
    server: FakeNodeServer | null
    nodeStorage: NodeStorageLike | null
    core: FakeLockManagerCore
    /** The `timeoutMs` each hold request carried. */
    holdRequests: number[]
    /** The argument of each release call, in order (`undefined` for no argument). */
    releaseArgs: (boolean | undefined)[]
    /** Every read and commit, in order: the boot's read of the legacy main file, a re-read by the pass, a commit by the pass. */
    mainLog: ('boot-read' | 'reread' | 'write')[]
    /** The file image (header plus blocks) of each commit the pass made that landed. */
    mainWrites: Uint8Array[]
    /** What the pass handed to each commit, whether or not it landed. */
    commitCalls: BlockSetInput[]
    /** Answers the next re-reads from this queue (as legacy main-file bytes) before reading for real. */
    readQueue: (() => Promise<Uint8Array | null | undefined>)[]
    /** What `isReloading()` answers: true models a refused hold on a page that is reloading. */
    reloading: boolean
    /** Makes the next commit fail with this error before anything is written. */
    failNextMainWrite?: unknown
    /** The page's byte store the owner works on. */
    store: ByteStore
    /** The in-memory store behind the owner on the worlds that are not the Node server's; `null` on the Node world. */
    fake: FakeStore | null
    /** The page's owner: a new one for every `bootOnce`, as a reload makes. */
    owner: BlockStoreOwner
    /** The commit and re-read the pass uses, bound to the current owner. */
    seams: BootPassSeams
    /** Starts a new page: a new owner and seams over the same store. */
    newPage(): void
    /** Replaces the block profile in the store by `tree` (a restore from another page), leaving the old generation retired. */
    replaceProfile(tree: Database): Promise<void>
    /** An owner of another page or device over the same store, for a peer that saves while the pass runs. */
    anotherOwner(): BlockStoreOwner
    /** The body limit the owners made from now on enforce (a store that enforces versions only); `undefined` for the server's own. */
    setOwnerBodyLimit(limit: number | undefined): void
    progressTexts: string[]
    /** What `readArchiveMemo` answers. Tests set it to model a memo that bootstrap wrote on an earlier boot. */
    memo: WorldMemo
    /** What the strike record answers and every call the pass made to it. */
    breaker: WorldBreaker
    /** What the stub-enrichment count answers and every call the pass made to it. */
    enrich: WorldEnrichStrikes
    /**
     * The effects that matter for ordering, interleaved as they happened:
     * `start` and `reset` (the archive strike record), `enrich-start` and
     * `enrich-clear` (the stub-enrichment count), `unit-write`, `unit-read`,
     * `encoder` (an encoder was created) and `main-write` (a commit was attempted).
     */
    order: ('start' | 'reset' | 'enrich-start' | 'enrich-clear' | 'unit-write' | 'unit-read' | 'encoder' | 'main-write')[]
    /** How many encoders the pass created: one per commit it encodes. */
    encoderCalls: number
    opfs: FakeOpfsDirectory | null
    /** The legacy main file's current bytes (`database/database.bin`), or `null` once it is absent: a conversion that won renames it away. */
    currentMain(): Uint8Array | null
    /** The block profile the store holds now, as one file image (the root carries its bookkeeping), or `null` with no head. */
    committedFile(): Promise<Uint8Array | null>
    /** The legacy read the boot makes before the pass runs. */
    bootRead(): Promise<Uint8Array | null>
    /** Places `bytes` as the main file, as another writer's save would. */
    seedMain(bytes: Uint8Array): void
    /** Places a unit in the unit storage with no write record: a unit a previous build left. */
    seedUnit(key: string, value: unknown): Promise<void>
}

export function hostEnvironment(host: WorldHost, overrides: Partial<BootArchiveEnvironment> = {}): BootArchiveEnvironment {
    return {
        host: host === 'tauri' ? 'tauri' : 'web',
        isNodeServer: host === 'node',
        tauriDesktop: host === 'tauri',
        locksSupported: host !== 'tauri',
        indexedDbStore: host === 'opfs',
        staleAccountProfile: false,
        ...overrides,
    }
}

export function bootHost(host: WorldHost): BootArchiveHost {
    return host === 'tauri' ? 'tauri' : 'web'
}

/** The file image of a layout: the block-format header followed by every block, as `encode()` writes it. */
export function layoutFile(layout: { readonly blocks: readonly Uint8Array[] }): Uint8Array {
    const header = new TextEncoder().encode('RISUSAVE\x01')
    const out = new Uint8Array(header.length + layout.blocks.reduce((sum, block) => sum + block.length, 0))
    out.set(header, 0)
    let offset = header.length
    for (const block of layout.blocks) {
        out.set(block, offset)
        offset += block.length
    }
    return out
}

/** Wires every `BootArchiveDeps` effect for `host` over a legacy main file that starts as `main` (no head). */
export async function setupWorld(kit: WorldKit, host: WorldHost, main: Uint8Array | null, options: WorldOptions = {}): Promise<World> {
    const mainLog: World['mainLog'] = []
    const mainWrites: Uint8Array[] = []
    const core = options.core ?? new FakeLockManagerCore()
    const opfs = host === 'node' ? null : new FakeOpfsDirectory()
    const { createBootPassSeams } = await import('../bootPassSeams')
    const { createNodeHttpStore } = await import('../store/nodeHttpStore')
    const { createProcessCommitLock } = await import('../blockStore')

    let server: FakeNodeServer | null = null
    let nodeStorage: NodeStorageLike | null = null
    let units: UnitStore
    let store: ByteStore
    let fake: FakeStore | null = null
    if (host === 'node') {
        server = new FakeNodeServer()
        vi.stubGlobal('fetch', server.fetch)
        const storage = new kit.NodeStorage()
        nodeStorage = storage
        if (options.nodeBodyLimit !== undefined) {
            server.bodyLimit = options.nodeBodyLimit
        }
        kit.setRemote(storage)
        if (main) {
            server.seed(MAIN_KEY, main)
        }
        units = new UnitStore(nodeUnitBackend(storage, server))
        store = createNodeHttpStore({ authHeader: () => storage.authHeader() })
    } else {
        kit.setRemote(memoryRemote())
        units = new UnitStore(opfsUnitBackend(opfs as FakeOpfsDirectory))
        fake = createFakeStore({ versioned: false })
        if (main) {
            fake.plant(MAIN_KEY, main)
        }
        store = fake
    }

    const tab = host === 'tauri' ? null : makeTab(core, 'A')
    if (tab) {
        await tab.locks.tabPresenceLockAcquired
        tab.locks.recordStorageEpoch()
    }

    const lockKind = options.commitLock ?? (host === 'tauri' ? 'process' : 'web')
    let ownerBodyLimit = options.nodeBodyLimit
    const newOwner = (): BlockStoreOwner => makeOwner(store, {
        commitLock: lockKind === 'process' ? createProcessCommitLock(store) : passthroughLock(lockKind === 'web'),
        ...(ownerBodyLimit !== undefined ? { nodeBodyLimit: ownerBodyLimit } : {}),
    }).owner
    const readLegacyMain = async (): Promise<Uint8Array | null> => (await store.read(MAIN_KEY)).bytes

    const world: World = {
        host,
        kit,
        deps: undefined as unknown as BootArchiveDeps,
        units,
        tab,
        server,
        nodeStorage,
        core,
        holdRequests: [],
        releaseArgs: [],
        mainLog,
        mainWrites,
        commitCalls: [],
        readQueue: [],
        reloading: false,
        progressTexts: [],
        memo: { skipped: new Set<string>(), tooLarge: false, pausedTold: false },
        breaker: { strikes: 0, readThrows: false, startFails: false, startThrows: false, resetThrows: false, calls: [] },
        enrich: { stored: null, readThrows: false, unreadable: false, startFails: false, startThrows: false, calls: [] },
        order: [],
        encoderCalls: 0,
        opfs,
        store,
        fake,
        owner: undefined as unknown as BlockStoreOwner,
        seams: undefined as unknown as BootPassSeams,
        newPage: () => {
            world.owner = newOwner()
            world.seams = createBootPassSeams({ owner: world.owner, store, readMainFile: readLegacyMain, nodeBodyLimit: options.nodeBodyLimit })
        },
        anotherOwner: newOwner,
        setOwnerBodyLimit: (limit) => { ownerBodyLimit = limit },
        replaceProfile: async (tree) => {
            const { treeToBlockSet } = await import('../treeToBlockSet')
            const owner = newOwner()
            const loaded = await owner.load()
            if (loaded.kind !== 'loaded') {
                throw new Error(`there is no block profile to replace: ${loaded.kind}`)
            }
            const result = await owner.replaceWholeState(await treeToBlockSet(tree))
            if (result.kind !== 'won') {
                throw new Error(`the profile could not be replaced: ${result.kind}`)
            }
        },
        currentMain: () => {
            if (server) {
                const file = server.files.get(MAIN_KEY)
                return file ? file.bytes : null
            }
            return (fake as FakeStore).peek(MAIN_KEY)
        },
        committedFile: async () => {
            const { assembleLegacyFile } = await import('../blockStore')
            const read = await newOwner().readCommitted()
            return read.kind === 'loaded' ? assembleLegacyFile(read.loaded) : null
        },
        bootRead: async () => {
            mainLog.push('boot-read')
            return readLegacyMain()
        },
        seedMain: (bytes) => {
            if (server) {
                server.seed(MAIN_KEY, bytes)
            } else {
                (fake as FakeStore).plant(MAIN_KEY, bytes)
            }
        },
        seedUnit: (key, value) => units.seed(key, value),
    }
    world.newPage()

    world.deps = {
        env: () => hostEnvironment(host, options.env),
        acquireHold: async (timeoutMs: number): Promise<BootArchiveHoldRelease | null> => {
            world.holdRequests.push(timeoutMs)
            const release = await (tab as LockTab).locks.acquireExclusiveStorageMigrationLock(Math.min(timeoutMs, options.holdCapMs ?? 50))
            if (!release) {
                return null
            }
            return (keepWriteLock?: boolean) => {
                world.releaseArgs.push(keepWriteLock)
                return release(keepWriteLock)
            }
        },
        isReloading: () => world.reloading,
        reread: async (): Promise<BootReread> => {
            mainLog.push('reread')
            const queued = world.readQueue.shift()
            if (queued) {
                return { kind: 'bytes', bytes: await queued() }
            }
            return world.seams.reread()
        },
        commit: async (input) => {
            world.commitCalls.push(input)
            mainLog.push('write')
            world.order.push('main-write')
            if (world.failNextMainWrite !== undefined) {
                const error = world.failNextMainWrite
                world.failNextMainWrite = undefined
                throw error
            }
            await world.seams.commit(input)
            mainWrites.push(layoutFile(input.layout))
        },
        writeUnit: (key, value) => {
            world.order.push('unit-write')
            return units.writeUnit(key, value)
        },
        readUnit: (key) => {
            world.order.push('unit-read')
            return units.readUnit(key) as ReturnType<BootArchiveDeps['readUnit']>
        },
        setProgress: (text) => { world.progressTexts.push(text) },
        createEncoder: () => {
            world.encoderCalls++
            world.order.push('encoder')
            return options.createEncoder ? options.createEncoder() : new kit.Encoder()
        },
        readArchiveMemo: () => ({ skipped: new Set(world.memo.skipped), tooLarge: world.memo.tooLarge, pausedTold: world.memo.pausedTold }),
        readArchiveStrikes: () => {
            world.breaker.calls.push('read')
            if (world.breaker.readThrows) {
                throw new Error('injected strike read failure')
            }
            const strikes = world.breaker.strikes
            if (strikes === 'unreadable') {
                return 'unreadable'
            }
            return strikes === 0 ? 'none' : strikes === 1 ? 'one' : 'paused'
        },
        recordArchiveStart: () => {
            world.breaker.calls.push('start')
            world.order.push('start')
            if (world.breaker.startThrows) {
                throw new Error('injected start record failure')
            }
            if (world.breaker.startFails || world.breaker.strikes === 'unreadable') {
                return false
            }
            world.breaker.strikes += 1
            return true
        },
        resetArchiveStrikes: () => {
            world.breaker.calls.push('reset')
            world.order.push('reset')
            if (world.breaker.resetThrows) {
                throw new Error('injected strike reset failure')
            }
            world.breaker.strikes = 0
        },
        readStubEnrichStrikes: () => {
            world.enrich.calls.push('read')
            if (world.enrich.readThrows) {
                throw new Error('injected enrichment count read failure')
            }
            if (world.enrich.unreadable) {
                return 'unreadable'
            }
            const stored = world.enrich.stored
            if (stored === null) {
                return 'none'
            }
            if (!/^[0-9]+$/.test(stored)) {
                return 'paused'
            }
            const count = Number(stored)
            return count === 0 ? 'none' : count === 1 ? 'one' : 'paused'
        },
        recordStubEnrichStart: () => {
            world.enrich.calls.push('start')
            world.order.push('enrich-start')
            if (world.enrich.startThrows) {
                throw new Error('injected enrichment start record failure')
            }
            if (world.enrich.startFails || world.enrich.unreadable) {
                return false
            }
            const stored = world.enrich.stored
            if (stored === null || stored === '0') {
                world.enrich.stored = '1'
                return true
            }
            if (stored === '1') {
                world.enrich.stored = '2'
                return true
            }
            return false
        },
        clearStubEnrichStrikes: () => {
            world.enrich.calls.push('clear')
            world.order.push('enrich-clear')
            world.enrich.stored = null
        },
        nodeBodyLimit: options.nodeBodyLimit,
    }
    return world
}

/**
 * A world whose main file is a small valid save, for a test that hands the
 * pass a tree directly (`runDirect`): a re-read after a failed pass then has
 * something real to read, and nothing in the file is the tree under test.
 */
export async function directWorld(kit: WorldKit, host: WorldHost, options: WorldOptions = {}): Promise<World> {
    const world = await setupWorld(kit, host, null, options)
    world.seedMain(await encodeAsSaveDb(kit.Encoder, baseTree([fullCharacter('seed', 'Seed')])))
    return world
}

/**
 * Opens a session and runs the pass over `tree` as given, with no encode or
 * decode of it first. The page is a legacy page over the world's main file.
 */
export async function runDirect(world: World, tree: Database): Promise<BootArchiveOutcome> {
    const { setPageStorageMode } = await import('../pageStorageMode')
    const { fingerprintMainFile } = await import('../mainFileFingerprint')
    world.newPage()
    const main = world.currentMain()
    setPageStorageMode({ kind: 'legacy', convertedFrom: main === null ? null : fingerprintMainFile(main) })
    const session = await world.kit.openBootArchiveSession(bootHost(world.host), world.deps)
    return session.run({ tree })
}

/** A notice as bootstrap sees it, whatever kinds the pass defines. */
interface MemoNotice {
    kind: string
    characters?: { chaId: string, name: string }[]
}

/**
 * What bootstrap does once it has posted an install outcome's notices: a skip
 * notice memoises the characters it names, a too-large notice memoises the
 * device, and a paused notice records that the user was told. The pass never
 * does this itself, so a test models the next boot's memo by calling this on
 * the previous boot's outcome.
 */
export function applyNoticeMemo(world: World, outcome: BootArchiveOutcome): void {
    if (outcome.kind !== 'install') {
        return
    }
    for (const notice of outcome.notices as unknown as MemoNotice[]) {
        if (notice.kind === 'archive-skipped') {
            for (const character of notice.characters ?? []) {
                world.memo.skipped.add(character.chaId)
            }
        }
        if (notice.kind === 'archive-too-large') {
            world.memo.tooLarge = true
        }
        if (notice.kind === 'archive-paused') {
            world.memo.pausedTold = true
        }
    }
}

/**
 * What turning the setting off, or a boot that reads it off, does to the
 * device records: the notice memo, the strike count and the told record all go.
 */
export function clearDeviceRecords(world: World): void {
    world.memo.skipped.clear()
    world.memo.tooLarge = false
    world.memo.pausedTold = false
    world.breaker.strikes = 0
}

/**
 * The `localStorage` keys of the archive memo that hold a value. The real lock
 * code writes its own storage-epoch key whenever it grants the hold, so a test
 * that asserts the pass left no memo reads these keys only.
 */
export function archiveMemoKeysWritten(): string[] {
    return ['archivePassSkipped', 'archivePassTooLarge'].filter((key) => localStorage.getItem(key) !== null)
}

/** The kinds of an install outcome's notices, in order. */
export function noticeKinds(outcome: BootArchiveOutcome): string[] {
    return outcome.kind === 'install' ? outcome.notices.map((n) => n.kind) : []
}

/**
 * A world whose main file is `encode(tree)`. The file is encoded after the
 * world's remote storage exists, so remote character blocks land there.
 */
export async function worldFor(
    kit: WorldKit,
    host: WorldHost,
    tree: Database,
    options: WorldOptions = {},
    encode: (Encoder: EncoderClass, tree: Database) => Promise<Uint8Array> = encodeAsSaveDb,
): Promise<World> {
    const world = await setupWorld(kit, host, null, options)
    world.seedMain(await encode(kit.Encoder, tree))
    return world
}

/**
 * A world that is a block profile: the store holds `tree` as the live
 * generation of a head, as a conversion or a restore leaves it, and no main
 * file. `bootOnce` loads it.
 */
export async function blockWorldFor(
    kit: WorldKit,
    host: WorldHost,
    tree: Database,
    options: WorldOptions = {},
): Promise<World> {
    const world = await setupWorld(kit, host, null, options)
    const { treeToBlockSet } = await import('../treeToBlockSet')
    const result = await world.owner.replaceWholeState(await treeToBlockSet(tree), { requireAbsentHead: true })
    if (result.kind !== 'won') {
        throw new Error(`the block profile could not be seeded: ${result.kind}`)
    }
    world.newPage()
    return world
}

export interface BootResult {
    session: BootArchiveSession
    /** The legacy main file's bytes the boot read, or the committed state as one file image on a block profile. */
    bytes: Uint8Array
    /** The strictly decoded tree handed to the pass. */
    tree: Database
    outcome: BootArchiveOutcome
}

export interface BootStart {
    session: BootArchiveSession
    bytes: Uint8Array
    tree: Database
}

/**
 * A boot up to the point where the pass would run, on a new page: open the
 * session, load the profile (the block store's `load()` and its strict decode,
 * or the legacy main file when there is no head).
 */
export async function startBoot(world: World): Promise<BootStart> {
    const { validateLoadedBlocks } = await import('../blockProfileValidate')
    const { setPageStorageMode } = await import('../pageStorageMode')
    const { fingerprintMainFile } = await import('../mainFileFingerprint')
    const { assembleLegacyFile } = await import('../blockStore')
    world.newPage()
    const session = await world.kit.openBootArchiveSession(bootHost(world.host), world.deps)
    const loaded = await world.owner.load({ validate: validateLoadedBlocks })
    let bytes: Uint8Array
    let tree: Database
    if (loaded.kind === 'loaded') {
        setPageStorageMode({ kind: 'block' })
        bytes = assembleLegacyFile(loaded.loaded)
        tree = loaded.tree
    } else if (loaded.kind === 'no-head') {
        bytes = (await world.bootRead()) as Uint8Array
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(bytes) })
        tree = await world.kit.decodeRisuSave(bytes, { strict: true })
    } else {
        throw new Error(`the profile is damaged: ${loaded.damage.map((item) => `${item.name} ${item.kind}`).join(', ')}`)
    }
    return { session, bytes, tree }
}

/**
 * Another page or device saves `tree` into the block profile: a peer commit
 * that moves the root, so an owner holding the older root meets a conflict (on
 * the Node server) or a stop (elsewhere) at its own next commit.
 */
export async function peerCommits(world: World, tree: Database): Promise<void> {
    const { treeToBlockSet } = await import('../treeToBlockSet')
    const peer = world.anotherOwner()
    const loaded = await peer.load()
    if (loaded.kind !== 'loaded') {
        throw new Error(`the peer found no block profile: ${loaded.kind}`)
    }
    const result = await peer.commitSave(await treeToBlockSet(tree))
    if (result.kind !== 'committed') {
        throw new Error(`the peer's commit did not happen: ${result.kind}`)
    }
}

/** One boot as `loadData` makes it, on a new page: `startBoot`, then the pass. */
export async function bootOnce(world: World): Promise<BootResult> {
    const { session, bytes, tree } = await startBoot(world)
    const outcome = await session.run({ tree })
    return { session, bytes, tree, outcome }
}

/** The reads and writes the Node server saw for the main file, in order. */
export function mainFileRequests(server: FakeNodeServer): ('read' | 'write')[] {
    return server.requests
        .filter((r) => (r.path === '/api/read' || r.path === '/api/write')
            && Buffer.from(r.headers['file-path'] ?? '', 'hex').toString('utf-8') === MAIN_KEY)
        .map((r) => (r.path === '/api/read' ? 'read' : 'write'))
}

/** How many writes under `blocks/` the store saw (values, roots, pack, markers and the head). */
export function blockWriteRequests(world: World): number {
    if (world.server) {
        return world.server.requestsTo('/api/write')
            .filter((request) => Buffer.from(request.headers['file-path'] ?? '', 'hex').toString('utf-8').startsWith('blocks/')).length
    }
    return (world.fake as FakeStore).ops.filter((op) => op.kind === 'write' && op.key.startsWith('blocks/')).length
}

/** The size of the biggest value the store holds under a generation of `blocks/` (the head excluded). */
export function largestStoredBlock(world: World): number {
    const sizes: number[] = []
    if (world.server) {
        for (const [key, file] of world.server.files) {
            if (key.startsWith('blocks/') && key !== 'blocks/head') {
                sizes.push(file.bytes.length)
            }
        }
    } else {
        const fake = world.fake as FakeStore
        for (const key of fake.keys('blocks/')) {
            if (key !== 'blocks/head') {
                sizes.push((fake.peek(key) as Uint8Array).length)
            }
        }
    }
    return Math.max(0, ...sizes)
}

/** The tree an `install` outcome carries; fails the test with the outcome kind otherwise. */

export function installedTree(outcome: BootArchiveOutcome): Database {
    if (outcome.kind !== 'install') {
        throw new Error(`expected an install outcome, got ${outcome.kind}`)
    }
    return outcome.tree
}

//#endregion
