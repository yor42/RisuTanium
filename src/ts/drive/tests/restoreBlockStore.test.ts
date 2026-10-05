// @vitest-environment happy-dom

/**
 * The two whole-state restores (`LoadLocalBackup` for a `.bin` file and
 * `loadInternalBackup` for a numbered backup) over the page's one block-store
 * owner and an in-memory store that records every call.
 *
 * What these show: a restore never writes `database/database.bin`; it commits
 * the restored tree as a new block generation behind one head switch; a page
 * with no head converts by restoring; every result of the replace maps to one
 * message and the right lock state; the undo copy of the internal-backup load is
 * never silent; a `.bin` file is decoded without the block cache; and a restored
 * database that names no preset keeps its working settings as a new one.
 *
 * Mocked: the platform (a desktop page, so no Web Locks are involved), the
 * alert surface, the language-independent app modules the restores import, the
 * IndexedDB block cache, and the Node request limit, which is made small so a
 * block can be over it. The store is a stand-in: nothing here says anything
 * about a real backend.
 *
 * Tests titled `guard:` pin behaviour that must be preserved and pass before
 * and after the restores moved onto the block store; every other test fails
 * against the restores that wrote the main file, except the one that checks the
 * text of the too-large message, which describes a new string.
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
    waits: [] as string[],
    relaunches: 0,
    /** The block cache (risuSaveCache): a restore must read nothing from it and write nothing into it. */
    cache: new Map<string, unknown>(),
    cacheWrites: [] as string[],
    coldWrites: 0,
}))

const setDatabaseMock = vi.hoisted(() => vi.fn())
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
    alertNormalWait: vi.fn(async () => { }),
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
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
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
    box.waits.length = 0
    box.relaunches = 0
    box.cache.clear()
    box.cacheWrites.length = 0
    box.coldWrites = 0
    setDatabaseMock.mockReset()
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

describe('a restore on a block profile commits a new generation and never writes the main file', () => {
    test.each(['bin', 'internal'] as const)('%s: the head names a new generation holding the restored tree, the old generation is gone, and database.bin is never touched', async (kind) => {
        const oldGeneration = await seedBlockProfile(OLD())
        // A main file on the same store (a stale upstream save) must not be touched either.
        store.plant(MAIN, new TextEncoder().encode('stale main file'))
        store.ops.length = 0

        await restore(kind, NEW())

        expect(headOf()?.current, 'the head names a new generation').not.toBe(oldGeneration)
        expect(isGenerationId(headOf()?.current ?? ''), 'the head names a generation').toBe(true)
        expect(idsOf(await committedTree()), 'characters in the profile the head names').toEqual(['new-a', 'new-b'])
        expect((await committedTree())?.mainPrompt).toBe('new prompt')
        expect(store.keys(`blocks/${oldGeneration}/`), 'the old generation is removed').toEqual([])
        expect(writtenKeys().filter((key) => key === MAIN), 'writes of the main file').toEqual([])
        expect(store.peek(MAIN), 'the main file').toEqual(new TextEncoder().encode('stale main file'))
        expect(box.errors).toEqual([])
        expect(box.relaunches, 'relaunch calls').toBe(1)
    })

    test('guard: bin: the restored tree reaches setDatabase once and the encoder is told to reload', async () => {
        await seedBlockProfile(OLD())

        await restore('bin', NEW())

        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect(idsOf(setDatabaseMock.mock.calls[0][0] as Database)).toEqual(['new-a', 'new-b'])
        expect(requiresFullEncoderReloadMock.state).toBe(true)
    })

    test('guard: a successful .bin restore keeps the write lock closed, so a save from the stale page never commits into the restored generation', async () => {
        await seedBlockProfile(OLD())

        await restore('bin', NEW())

        expect(box.relaunches, 'relaunch calls').toBe(1)
        expect(await writeLockIsFree(), 'the write lock is closed').toBe(false)
    })

    test('a save iteration holding the write lock commits its old layout first, and nothing of it reaches the restored generation', async () => {
        const oldGeneration = await seedBlockProfile(OLD())
        const owner = (await getPageBlockOwner())!
        const release = await writeLock.acquire()

        const restoring = restore('bin', NEW())
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(writtenKeys().filter((key) => key.startsWith('blocks/')), 'a restore write while the save held the lock').toEqual([])

        // The save iteration took its layout before the restore started and commits it under the lock.
        const edited = OLD()
        edited.characters[0].name = 'Old A, edited by the in-flight save'
        const committed = await owner.commitSave(await treeToBlockSet(edited))
        expect(committed.kind).toBe('committed')
        const putKeys = () => store.ops.filter((op) => op.kind === 'write').map((op) => op.key)
        const firstOldGenerationWrite = putKeys().findIndex((key) => key.startsWith(`blocks/${oldGeneration}/`))
        release()
        await restoring

        const keys = putKeys()
        const lastOldGenerationWrite = keys.map((key, index) => (key.startsWith(`blocks/${oldGeneration}/`) ? index : -1)).filter((index) => index >= 0).pop() ?? -1
        const firstRestoreWrite = keys.findIndex((key) => key.startsWith('blocks/') && !key.startsWith(`blocks/${oldGeneration}/`) && key !== HEAD)
        expect(firstOldGenerationWrite).toBeGreaterThanOrEqual(0)
        expect(firstRestoreWrite, 'the restore wrote after the save committed').toBeGreaterThan(lastOldGenerationWrite)
        expect(idsOf(await committedTree())).toEqual(['new-a', 'new-b'])
        expect(JSON.stringify(await committedTree())).not.toContain('edited by the in-flight save')
    })
})

describe('a page with no block head converts by restoring', () => {
    async function legacyPage(): Promise<Uint8Array> {
        const main = encodeRisuSaveLegacy(OLD(), 'noCompression')
        store.plant(MAIN, main)
        store.ops.length = 0
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(main) })
        return main
    }

    test.each(['bin', 'internal'] as const)('%s: the new head carries the boot fingerprint and a conversion time, the old main file is moved aside, and the next save is a plain commit', async (kind) => {
        const main = await legacyPage()

        await restore(kind, NEW())

        const head = headOf()
        expect(head?.convertedFrom, 'the head names the main file boot read').toBe(fingerprintMainFile(main))
        expect(typeof head?.convertedAt, 'the head carries the conversion time').toBe('number')
        expect(store.peek(MAIN), 'the main file was moved aside').toBeNull()
        const copies = store.keys('database/database.pre-blocks')
        expect(copies, 'the pre-conversion copy').toHaveLength(1)
        expect(store.peek(copies[0])).toEqual(main)
        expect(getPageStorageMode().kind, 'the page is a block page').toBe('block')

        const owner = (await getPageBlockOwner())!
        const next = await performSaveStep({ owner, store }, { input: await treeToBlockSet(await committedTree() as unknown as Database) })
        expect(next).toMatchObject({ kind: 'saved', converted: false })
    })
})

describe('the replace results map to one message each and the right lock state', () => {
    test.each(['bin', 'internal'] as const)('%s: a busy guard that registers work during the generation build aborts the replace: nothing live changes, the restore generation is removed, one message, both locks released', async (kind) => {
        const oldGeneration = await seedBlockProfile(OLD())
        let handle: ReturnType<typeof beginBusy> | null = null
        // Work registers while the new generation's root is written, which is the last write before the flip.
        const originalWrite = store.write.bind(store)
        store.write = async (key, bytes, condition) => {
            const result = await originalWrite(key, bytes, condition)
            if (handle === null && key.startsWith('blocks/') && key.endsWith('/root') && !key.includes(oldGeneration)) {
                handle = beginBusy('import')
            }
            return result
        }

        await restore(kind, NEW())
        handle?.end()

        expect(handle, 'work registered during the build').not.toBeNull()
        expect(headOf()?.current, 'the head still names the old generation').toBe(oldGeneration)
        expect(store.keys('blocks/').filter((key) => !key.startsWith(`blocks/${oldGeneration}/`) && key !== HEAD), 'blocks of the restore generation').toEqual([])
        expect(box.errors, 'every message shown').toEqual([language.backupLoadWorkInProgress])
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is released').toBe(true)
    })

    test.each(['bin', 'internal'] as const)('%s: another device switching the head first: the load did not happen, one message, nothing installed, the lock released', async (kind) => {
        await seedBlockProfile(OLD())
        let switched = false
        const originalWrite = store.write.bind(store)
        store.write = async (key, bytes, condition) => {
            const result = await originalWrite(key, bytes, condition)
            if (!switched && key.startsWith('blocks/') && key.endsWith('/root')) {
                switched = true
                store.plant(HEAD, encodeHead({ current: 'peer-generation' }))
            }
            return result
        }

        await restore(kind, NEW())

        expect(switched).toBe(true)
        expect(box.errors, 'every message shown').toEqual([language.restoreNotHappenedNotice])
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is released').toBe(true)
    })

    test.each([['bin', language.restoreWriteFailed], ['internal', language.internalBackupWriteFailed]] as const)('%s: a new generation whose root does not read back as written is removed, the write-failed message is shown, and the lock is released', async (kind, message) => {
        const oldGeneration = await seedBlockProfile(OLD())
        const originalWrite = store.write.bind(store)
        store.write = async (key, bytes, condition) => {
            const damaged = key.startsWith('blocks/') && key.endsWith('/root') && !key.includes(oldGeneration)
            return await originalWrite(key, damaged ? new Uint8Array([1, 2, 3]) : bytes, condition)
        }

        await restore(kind, NEW())

        expect(box.errors, 'every message shown').toEqual([message])
        expect(headOf()?.current, 'the head still names the old generation').toBe(oldGeneration)
        expect(store.keys('blocks/').filter((key) => !key.startsWith(`blocks/${oldGeneration}/`) && key !== HEAD), 'blocks of the failed generation').toEqual([])
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is released').toBe(true)
    })

    test.each(['bin', 'internal'] as const)('%s: a head switch whose outcome cannot be confirmed shows the reload message and keeps the write lock closed', async (kind) => {
        const oldGeneration = await seedBlockProfile(OLD())
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD, mode: 'before', times: 10 })

        await restore(kind, NEW())

        expect(box.errors, 'every error shown').toEqual([])
        expect(box.waits, 'the message left on screen').toContain(language.saveDamagedUnconfirmed)
        expect(headOf()?.current, 'the head was not switched').toBe(oldGeneration)
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is closed').toBe(false)
    })

    test.each(['bin', 'internal'] as const)('%s: a block over the Node request limit stops before anything is written and names the block', async (kind) => {
        useStore({ versioned: true })
        const oldGeneration = await seedBlockProfile(OLD())
        const big = tree([character('big-char', 'Big', { note: 'x'.repeat(6000) })])

        await restore(kind, big)

        expect(box.errors, 'every message shown').toEqual([language.restoreTooLargeBlock('"big-char"', 4096)])
        expect(box.errors[0], 'the full message for a quoted character name').toBe('This backup could not be loaded: the self-hosted server accepts at most 0.00390625 MiB in one request (less if a proxy in front of the server sets a lower limit), and this part of your data is over that: "big-char". Nothing was changed.')
        expect(headOf()?.current, 'the head still names the old generation').toBe(oldGeneration)
        expect(writtenKeys().filter((key) => key.startsWith('blocks/')), 'blocks written').toEqual([])
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is released').toBe(true)
    })
})

describe('the text of the too-large message (a new string): it reads as a sentence for every kind of label', () => {
    test('a plural label, a quoted name and no label all read grammatically', () => {
        const message = (what: string) => language.restoreTooLargeBlock(what, 100 * 1024 * 1024)
        expect(message('your bot presets')).toBe('This backup could not be loaded: the self-hosted server accepts at most 100 MiB in one request (less if a proxy in front of the server sets a lower limit), and this part of your data is over that: your bot presets. Nothing was changed.')
        expect(message('"Bee"')).toContain('this part of your data is over that: "Bee". Nothing was changed.')
        expect(message('')).toContain('and part of your data is over that. Nothing was changed.')
    })
})

describe('the internal-backup load keeps an undo copy or asks first', () => {
    test('a block page keeps its committed state as a numbered backup that decodes to the state before the load', async () => {
        await seedBlockProfile(OLD())

        await restore('internal', NEW())

        const copies = numberedBackups()
        expect(copies, 'backups other than the chosen snapshot').toHaveLength(1)
        const copy = await decodeRisuSave(store.peek(copies[0])!, { strict: true }) as Database
        expect(idsOf(copy)).toEqual(['old-a'])
        expect(copy.mainPrompt).toBe('old prompt')
        expect(box.confirmCalls, 'confirms asked').toEqual([])
    })

    test('guard: a page with no head keeps the legacy main file as the numbered backup', async () => {
        const main = encodeRisuSaveLegacy(OLD(), 'noCompression')
        store.plant(MAIN, main)
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(main) })

        await restore('internal', NEW())

        const copies = numberedBackups()
        expect(copies, 'backups other than the chosen snapshot').toHaveLength(1)
        expect(store.peek(copies[0])).toEqual(main)
        expect(box.confirmCalls, 'confirms asked').toEqual([])
    })

    test('damaged committed state: the load asks, and declining changes nothing', async () => {
        const oldGeneration = await seedBlockProfile(OLD())
        const characterKey = characterBlockKey(oldGeneration, 'old-a')
        const damaged = store.peek(characterKey)!
        damaged[damaged.length - 6] ^= 0xff
        store.plant(characterKey, damaged)
        await plantSnapshot(NEW())
        box.confirmAnswers.push(false)

        await loadInternalBackup()

        expect(box.confirmCalls).toEqual([language.restoreNoUndoCopyConfirm('damaged')])
        expect(writtenKeys(), 'writes after the question was declined').toEqual([])
        expect(headOf()?.current).toBe(oldGeneration)
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is released').toBe(true)
    })

    test('no committed state and no main file: the load asks, and accepting loads with no copy', async () => {
        await plantSnapshot(NEW())

        await loadInternalBackup()

        expect(box.confirmCalls).toEqual([language.restoreNoUndoCopyConfirm('absent')])
        expect(numberedBackups(), 'backups other than the chosen snapshot').toEqual([])
        expect(idsOf(await committedTree())).toEqual(['new-a', 'new-b'])
        expect(box.waits, 'the message on screen').toContain(language.internalBackupLoadedNoCopy)
    })

    test('a committed state over the Node request limit: the load asks, and declining changes nothing', async () => {
        useStore({ versioned: true })
        const crowded = tree(Array.from({ length: 5 }, (_, index) => character(`crowd-${index}`, `Crowd ${index}`, { note: 'y'.repeat(1500) })))
        const oldGeneration = await seedBlockProfile(crowded)
        await plantSnapshot(NEW())
        box.confirmAnswers.push(false)

        await loadInternalBackup()

        expect(box.confirmCalls).toEqual([language.restoreNoUndoCopyConfirm('too-large')])
        expect(writtenKeys(), 'writes after the question was declined').toEqual([])
        expect(headOf()?.current).toBe(oldGeneration)
        expectNothingInstalled()
    })
})

describe('the .bin restore decodes without the block cache and says what a damaged file leaves out', () => {
    async function fileMissingBlock(): Promise<Uint8Array> {
        const full = tree([character('char-a', 'Ay'), character('char-b', 'Bee')], { mainPrompt: 'restored prompt' })
        return removeBlock(await blockFile(full), 'char-b')
    }

    function plantCachedCopy(): void {
        box.cache.set('risuSaveBlock_char-b', { type: 2, name: 'char-b', data: JSON.stringify(character('char-b', 'Bee, from the block cache')) })
    }

    test('declining the left-out confirm changes nothing and the cached copy is never used', async () => {
        await seedBlockProfile(OLD())
        plantCachedCopy()
        box.confirmAnswers.push(false)

        await runBinRestore(concat([chunk('database.risudat', await fileMissingBlock())]))

        expect(box.confirmCalls, 'confirms asked').toHaveLength(1)
        expect(box.confirmCalls[0], 'the confirm names the left-out character by its current name').toContain('Bee, the current name')
        expect(writtenKeys(), 'writes after the question was declined').toEqual([])
        expectNothingInstalled()
        expect(await writeLockIsFree(), 'the write lock is released').toBe(true)
    })

    test('accepting restores everything else and the cached copy is neither loaded nor rewritten', async () => {
        await seedBlockProfile(OLD())
        plantCachedCopy()
        const cacheBefore = JSON.stringify(Array.from(box.cache.entries()))

        await runBinRestore(concat([chunk('database.risudat', await fileMissingBlock())]))

        const restored = await committedTree()
        expect(idsOf(restored), 'characters in the restored profile').toEqual(['char-a'])
        expect(JSON.stringify(restored)).not.toContain('from the block cache')
        expect(restored?.mainPrompt).toBe('restored prompt')
        expect(box.cacheWrites, 'block cache writes').toEqual([])
        expect(JSON.stringify(Array.from(box.cache.entries())), 'the block cache').toBe(cacheBefore)
    })

    test('a file that holds every block is restored without a left-out confirm', async () => {
        await seedBlockProfile(OLD())
        const full = tree([character('char-a', 'Ay'), character('char-b', 'Bee')])

        await runBinRestore(concat([chunk('database.risudat', await blockFile(full))]))

        expect(box.confirmCalls).toEqual([])
        expect(idsOf(await committedTree())).toEqual(['char-a', 'char-b'])
    })
})

describe('a restore refuses on the page that runs from OPFS this time, before it writes or streams anything', () => {
    test('guard: the .bin restore shows the read-only notice and writes no asset, unit or block', async () => {
        injectRestoreStore(store, 'opfs-transitional')
        const entries = [chunk('asset1.png', new Uint8Array([1, 2, 3])), chunk('coldstorage_11111111-1111-1111-1111-111111111111.json', new TextEncoder().encode('{"message":[]}'))]

        await runBinRestore(await binOf(NEW(), entries))

        expect(box.errors).toEqual([language.opfsReadOnlyNotice])
        expect(store.mutating(), 'store writes and deletes').toEqual([])
        expect(box.coldWrites, 'cold storage writes').toBe(0)
        expectNothingInstalled()
    })

    test('guard: the internal-backup load shows the read-only notice before it lists anything and writes nothing', async () => {
        await plantSnapshot(NEW())
        injectRestoreStore(store, 'opfs-transitional')

        await loadInternalBackup()

        expect(box.errors).toEqual([language.opfsReadOnlyNotice])
        expect(box.selectCalls, 'snapshot pickers shown').toBe(0)
        expect(store.mutating(), 'store writes and deletes').toEqual([])
        expectNothingInstalled()
    })
})

describe('a legacy snapshot whose characters are remote blocks', () => {
    test('still loads, and the restored generation holds those characters inline with no remotes/ write', async () => {
        const db = tree([character('remote-a', 'Remote A'), character('remote-b', 'Remote B')])
        const pointers = await withRemoteCharacters(await blockFile(db), ['remote-a', 'remote-b'], (key, bytes) => { store.plant(key, bytes) })
        store.plant(SNAPSHOT_KEY, pointers)
        await seedBlockProfile(OLD())
        store.ops.length = 0

        await loadInternalBackup()

        expect(box.confirmCalls, 'confirms asked').toEqual([])
        expect(idsOf(await committedTree())).toEqual(['remote-a', 'remote-b'])
        expect(writtenKeys().filter((key) => key.startsWith('remotes/')), 'remote writes').toEqual([])
    })
})

describe('a restored database that names no preset keeps its working settings as a new one', () => {
    test.each(['bin', 'internal'] as const)('%s: an id past the end of the list appends a preset holding the working settings, and the id points at it', async (kind) => {
        await seedBlockProfile(OLD())
        const skewed = tree([character('new-a', 'New A')], { botPresetsId: 5, botPresets: [{ name: 'Only preset', mainPrompt: 'stored prompt' }], mainPrompt: 'working prompt' })

        await restore(kind, skewed)

        const restored = await committedTree() as unknown as { botPresets: Array<{ name: string, mainPrompt?: string }>, botPresetsId: number }
        expect(restored.botPresets).toHaveLength(2)
        expect(restored.botPresets[0]).toMatchObject({ name: 'Only preset', mainPrompt: 'stored prompt' })
        expect(restored.botPresets[1]).toMatchObject({ name: 'New Preset', mainPrompt: 'working prompt' })
        expect(restored.botPresetsId).toBe(1)
    })

    test('guard: a restored database whose id names a preset is left as it is', async () => {
        await seedBlockProfile(OLD())

        await restore('bin', tree([character('new-a', 'New A')], { botPresetsId: 0, botPresets: [{ name: 'Only preset' }] }))

        const restored = await committedTree() as unknown as { botPresets: unknown[], botPresetsId: number }
        expect(restored.botPresets).toHaveLength(1)
        expect(restored.botPresetsId).toBe(0)
    })
})

describe('a .bin whose database entry is the compressed legacy format both exports write', () => {
    test('restores here, and decodeRisuSave (the decoder both sides use) reads the same entry back to the same database', async () => {
        const db = tree([character('exported-a', 'Exported A')], { mainPrompt: 'exported prompt' })
        const entry = encodeRisuSaveLegacy({ ...db, account: undefined }, 'compression')
        await seedBlockProfile(OLD())

        await runBinRestore(concat([chunk('database.risudat', entry)]))

        expect(idsOf(await committedTree())).toEqual(['exported-a'])
        const upstreamRead = await decodeRisuSave(entry) as Database
        expect(idsOf(upstreamRead)).toEqual(['exported-a'])
        expect(upstreamRead.mainPrompt).toBe('exported prompt')
    })
})
