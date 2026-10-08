// @vitest-environment happy-dom

/**
 * `loadInternalBackup` (`src/ts/drive/internalBackup.ts`) makes the character
 * list of the chosen numbered backup one the save can hold before it commits
 * it as a new generation: an id that cannot key a block is replaced with the
 * lists that named it following, an archived character takes back the id its
 * unit records, and a backup that cannot be saved is refused by name with the
 * stored profile left as it was.
 *
 * The harness is the one `restoreBlockStore.test.ts` documents (a real owner
 * over an in-memory store, mocked platform and dialogs); the snapshot is
 * composed block by block, because the encoder itself never writes a character
 * under an id that cannot key a block. A passing test says nothing about a
 * real backend.
 *
 * Title labels: (R) marks a reproducer that fails against a load that commits
 * the snapshot as it is; (G) marks a guard that passes with or without it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../storage/database.svelte'
import { createFakeStore, type FakeStore } from '../../storage/tests/blockStoreHarness'
import { injectRestoreStore, committedTree } from './restoreSupport'
import { withRemoteCharacters } from '../../storage/tests/remoteFileFixture'
import { removeBlock } from '../../storage/tests/risuSaveBlockFile'

//#region shared observation state

const box = vi.hoisted(() => ({
    confirmCalls: [] as string[],
    /** Answers to the confirms, in order; any confirm beyond them is answered yes. */
    confirmAnswers: [] as boolean[],
    selectCalls: 0,
    errors: [] as string[],
    normalWaits: [] as string[],
    waits: [] as string[],
    relaunches: 0,
    /** The block cache (risuSaveCache): a restore must read nothing from it and write nothing into it. */
    cache: new Map<string, unknown>(),
    cacheWrites: [] as string[],
    coldWrites: 0,
}))

const setDatabaseMock = vi.hoisted(() => vi.fn())
const unitReader = vi.hoisted(() => vi.fn(async (_key: string): Promise<unknown> => ({ status: 'missing' })))
const requiresFullEncoderReloadMock = vi.hoisted(() => ({ state: false }))

/** The page's write lock: an in-process mutex. A holder that never releases leaves every later acquirer waiting. */
const writeLock = vi.hoisted(() => {
    let tail: Promise<void> = Promise.resolve()
    return {
        acquire: async (): Promise<() => void> => {
            const previous = tail
            let release!: () => void
            tail = new Promise<void>((resolve) => { release = resolve })
            await previous
            return () => release()
        },
        /** A successful restore keeps the lock closed for the life of its page: every test starts a new page. */
        reset: (): void => { tail = Promise.resolve() },
    }
})

//#endregion

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => box.cache.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { box.cacheWrites.push(key); box.cache.set(key, value) }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('../../platform'))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { box.relaunches++ }),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => { }),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../storage/nodeBodyLimit'), () => ({
    NODE_BODY_LIMIT_BYTES: 4096,
}) as unknown as typeof import('../../storage/nodeBodyLimit'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
    presetFromWorkingSettings: (db: { mainPrompt?: string }, name: string, image: string) => ({ name, image, mainPrompt: db.mainPrompt }),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class { },
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }) },
    requiresFullEncoderReload: requiresFullEncoderReloadMock,
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: writeLock,
    acquireExclusiveStorageMigrationLock: vi.fn(async () => (async () => { })),
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
    describeBlockForPerson: (blockName: string) => `"${blockName}"`,
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async (message: string) => {
        box.confirmCalls.push(message)
        return box.confirmAnswers.shift() ?? true
    }),
    alertError: vi.fn((message: string) => { box.errors.push(message) }),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async (message: string) => { box.normalWaits.push(message) }),
    alertMd: vi.fn(),
    alertWait: vi.fn((message: string) => { box.waits.push(message) }),
    alertSelect: vi.fn(async () => { box.selectCalls++; return '1' }),
    alertStore: { set: vi.fn((state: { msg?: string }) => { if (typeof state.msg === 'string') { box.waits.push(state.msg) } }) },
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    decryptBuffer: vi.fn(),
    encryptBuffer: vi.fn(),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../characterCards'), () => ({
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: unitReader,
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: vi.fn((name: string) => (name.startsWith('coldstorage_') ? name.slice('coldstorage_'.length, -'.json'.length) : null)),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => { box.coldWrites++; return true }),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: { characters: [{ chaId: 'char-b', name: 'Bee, the current name' }] } as unknown as Database },
}) as unknown as typeof import('../../stores.svelte'))

//#endregion

import { LoadLocalBackup } from '../backuplocal'
import { loadInternalBackup } from '../internalBackup'
import { RisuSaveEncoder, decodeRisuSave, encodeRisuSaveLegacy } from '../../storage/risuSave'
import { getPageBlockOwner } from '../../storage/pageBlockOwner'
import { getPageStorageMode, setPageStorageMode } from '../../storage/pageStorageMode'
import { fingerprintMainFile } from '../../storage/mainFileFingerprint'
import { performSaveStep } from '../../storage/saveStep'
import { treeToBlockSet } from '../../storage/treeToBlockSet'
import { encodeHead, parseHead } from '../../storage/headSwap'
import { characterBlockKey, isGenerationId } from '../../storage/blockKeys'
import { beginBusy } from '../../process/memory/busyActions'
import { language } from 'src/lang'
import { BLOCK, composeSave } from '../../storage/tests/manualCleanupHarness'

//#region fixtures

const MAIN = 'database/database.bin'
const HEAD = 'blocks/head'
const SNAPSHOT_KEY = 'database/dbbackup-17000000000.bin'

function character(chaId: string, name: string, extra: Record<string, unknown> = {}): Database['characters'][number] {
    return { chaId, name, type: 'character', chatPage: 0, chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }], ...extra } as unknown as Database['characters'][number]
}

function tree(characters: Database['characters'], extra: Record<string, unknown> = {}): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'Preset one' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: 'a prompt',
        characters,
        ...extra,
    } as unknown as Database
}

const OLD = () => tree([character('old-a', 'Old A')], { mainPrompt: 'old prompt' })
const NEW = () => tree([character('new-a', 'New A'), character('new-b', 'New B')], { mainPrompt: 'new prompt' })

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` chunk, matching LoadLocalBackup's reader. */
function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    out.set(u32le(nameBuf.length), 0)
    out.set(nameBuf, 4)
    out.set(u32le(data.length), 4 + nameBuf.length)
    out.set(data, 8 + nameBuf.length)
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

async function blockFile(db: Database): Promise<Uint8Array> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

let store: FakeStore

function useStore(options: { versioned: boolean } = { versioned: false }): FakeStore {
    store = createFakeStore(options)
    injectRestoreStore(store, options.versioned ? 'node' : 'tauri')
    return store
}

/** A block profile of `db`, as an earlier boot or save left it, with the page's owner live on it. */
async function seedBlockProfile(db: Database): Promise<string> {
    const owner = await getPageBlockOwner()
    const won = await owner!.replaceWholeState(await treeToBlockSet(db), { requireAbsentHead: true })
    if (won.kind !== 'won') {
        throw new Error(`the profile could not be seeded: ${won.kind}`)
    }
    setPageStorageMode({ kind: 'block' })
    store.ops.length = 0
    return won.generation
}

function headOf(): { current: string, convertedFrom?: string, convertedAt?: number } | null {
    const bytes = store.peek(HEAD)
    if (bytes === null) {
        return null
    }
    const parsed = parseHead(bytes)
    return parsed.status === 'ok' ? parsed.record : null
}

let capturedInput: HTMLInputElement | null = null

/** Drives the real `LoadLocalBackup()` with `file` as the chosen file, and awaits its change handler. */
async function runBinRestore(file: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([file as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

/** A `.bin` whose database entry is the block-format file of `db`, after any other entries. */
async function binOf(db: Database, extraEntries: Uint8Array[] = []): Promise<Uint8Array> {
    return concat([...extraEntries, chunk('database.risudat', await blockFile(db))])
}

async function plantSnapshot(db: Database): Promise<void> {
    store.plant(SNAPSHOT_KEY, await blockFile(db))
    store.ops.length = 0
}

type Kind = 'bin' | 'internal'

/** Restores `db` the way `kind` does. */
async function restore(kind: Kind, db: Database): Promise<void> {
    if (kind === 'bin') {
        await runBinRestore(await binOf(db))
    } else {
        await plantSnapshot(db)
        await loadInternalBackup()
    }
}

function writtenKeys(): string[] {
    return store.mutating().flatMap((op) => (op.kind === 'deleteMany' ? op.keys : [op.key]))
}

function numberedBackups(): string[] {
    return store.keys('database/dbbackup-').filter((key) => key !== SNAPSHOT_KEY)
}

async function writeLockIsFree(): Promise<boolean> {
    let release: (() => void) | undefined
    const acquired = writeLock.acquire().then((r) => { release = r; return true })
    const free = await Promise.race([acquired, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 40))])
    release?.()
    return free
}

function idsOf(db: Database | Record<string, unknown> | null): string[] {
    return ((db as Database | null)?.characters ?? []).map((c) => String(c.chaId))
}

function expectNothingInstalled(): void {
    expect.soft(setDatabaseMock, 'setDatabase calls').not.toHaveBeenCalled()
    expect.soft(box.relaunches, 'relaunch calls').toBe(0)
}

//#endregion

beforeEach(() => {
    box.confirmCalls.length = 0
    box.confirmAnswers.length = 0
    box.selectCalls = 0
    box.errors.length = 0
    box.normalWaits.length = 0
    box.waits.length = 0
    box.relaunches = 0
    box.cache.clear()
    box.cacheWrites.length = 0
    box.coldWrites = 0
    setDatabaseMock.mockReset()
    unitReader.mockReset().mockImplementation(async () => ({ status: 'missing' }))
    requiresFullEncoderReloadMock.state = false
    writeLock.reset()
    useStore()

    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** A numbered backup file whose character blocks are named `blockName` but hold the characters given. */
async function snapshotHolding(characters: Array<{ blockName: string, value: object }>): Promise<Uint8Array> {
    const parts = [
        { name: 'root', type: BLOCK.ROOT, data: JSON.stringify({ formatversion: 5, botPresetsId: 0, mainPrompt: 'snapshot prompt', __directory: ['preset', 'modules', 'loadouts', 'plugins', ...characters.map((c) => c.blockName), 'config'] }) },
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify([{ name: 'Preset one' }]) },
        { name: 'modules', type: BLOCK.MODULES, data: '[]' },
        { name: 'loadouts', type: BLOCK.LOADOUTS, data: '[]' },
        { name: 'plugins', type: BLOCK.PLUGINS, data: '[]' },
        ...characters.map((c) => ({ name: c.blockName, type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(c.value) })),
        { name: 'config', type: BLOCK.CONFIG, data: '{"version":1}' },
    ]
    return (await composeSave(new RisuSaveEncoder(), parts)).bytes
}

async function loadSnapshot(bytes: Uint8Array): Promise<void> {
    store.plant(SNAPSHOT_KEY, bytes)
    store.ops.length = 0
    await loadInternalBackup()
}

describe('the numbered backup the internal load commits', () => {
    test('(R) an archived character with an id that cannot be saved takes back the id its unit records', async () => {
        await seedBlockProfile(OLD())
        unitReader.mockImplementation(async () => ({ status: 'ok', value: { character: { chaId: 'real-id' } } }))

        await loadSnapshot(await snapshotHolding([{ blockName: 'stub', value: character('config', 'Stub', { coldstorage: 'unit-1' }) }, { blockName: 'b', value: character('b', 'B') }]))

        expect(box.errors).toEqual([])
        expect(box.relaunches).toBe(1)
        expect(idsOf(await committedTree()).sort()).toEqual(['b', 'real-id'])
    })

    test.each([
        ['is missing', async () => ({ status: 'missing' })],
        ['cannot be read', async () => ({ status: 'error', error: new Error('unreadable') })],
        ['holds an id that cannot be saved either', async () => ({ status: 'ok', value: { character: { chaId: 'preset' } } })],
    ])('(R) the load is refused by name, nothing is committed and the stored profile stays when the unit %s', async (_label, reader) => {
        const oldGeneration = await seedBlockProfile(OLD())
        unitReader.mockImplementation(reader)

        await loadSnapshot(await snapshotHolding([{ blockName: 'stub', value: character('config', 'The Archived One', { coldstorage: 'unit-1' }) }]))

        expect(box.errors).toEqual([language.restoreRefusedArchivedId('The Archived One')])
        expect(box.relaunches).toBe(0)
        expect(headOf()?.current).toBe(oldGeneration)
        expect(writtenKeys()).toEqual([])
    })

    test('(R) a character whose id cannot key a block is committed under a new id', async () => {
        await seedBlockProfile(OLD())

        await loadSnapshot(await snapshotHolding([{ blockName: 'x', value: character('preset', 'Held') }, { blockName: 'b', value: character('b', 'B') }]))

        expect(box.errors).toEqual([])
        const ids = idsOf(await committedTree())
        expect(ids).toHaveLength(2)
        expect(ids).not.toContain('preset')
        expect(ids).toContain('b')
    })

    test('(R) a load that repaired the character list announces it once it has landed', async () => {
        await seedBlockProfile(OLD())
        unitReader.mockImplementation(async () => ({ status: 'ok', value: { character: { chaId: 'real-id' } } }))

        await loadSnapshot(await snapshotHolding([{ blockName: 'stub', value: character('config', 'Stub', { coldstorage: 'unit-1' }) }, { blockName: 'x', value: character('preset', 'Held') }]))

        expect(box.relaunches).toBe(1)
        expect(box.normalWaits).toEqual([language.restoreRepairedNotice(0, 1, 1)])
    })

    test('(G) a refused load shows only the refusal', async () => {
        await seedBlockProfile(OLD())

        await loadSnapshot(await snapshotHolding([{ blockName: 'stub', value: character('config', 'The Archived One', { coldstorage: 'unit-1' }) }, { blockName: 'x', value: character('preset', 'Held') }]))

        expect(box.errors).toEqual([language.restoreRefusedArchivedId('The Archived One')])
        expect(box.normalWaits).toEqual([])
    })

    test('(G) a well-formed snapshot is committed with its characters unchanged', async () => {
        await seedBlockProfile(OLD())

        await restore('internal', NEW())

        expect(box.errors).toEqual([])
        expect(box.normalWaits).toEqual([])
        expect(idsOf(await committedTree())).toEqual(['new-a', 'new-b'])
    })
})