// @vitest-environment happy-dom

/**
 * The cross-site census for the block store: once a page runs on a block
 * profile, none of the sites it drives writes `database/database.bin` (the one
 * production writer of that key, the copy-back at store selection, runs before
 * the page's sites exist and is not one of them), and the sites share the page's one block-store owner without writing twice or into a
 * generation other than the one the head names.
 *
 * One page (one store spy, one owner) is driven through every site that can
 * reach the key: the boot archive pass's conversion and its later commits (the
 * production commit seam), the save loop's step, a character import (which
 * reaches the save only through the save loop's step and also writes `assets/`
 * keys directly), the manual clean-up,
 * the internal-backup load and the `.bin` restore. The `.bin` restore and the
 * internal-backup load each end the page they run on (they relaunch it); the
 * store and its record carry over to the second one, with the write lock
 * reopened as the relaunched page would have it.
 *
 * Production writers of `database/database.bin` the census was built from:
 * `grep` for the key, `MAIN_FILE_KEY`, `LEGACY_MAIN_FILE_KEY` and
 * `writeMainFile` over `src/**` without tests finds `appStore.ts` (read only),
 * `internalBackup.ts` (read), `blockStore.ts` (a presence check for the seed),
 * `bootBlockLoad.ts` (presence check), `mainFileRename.ts` (the rename finish:
 * a copy to a `pre-blocks` key, then a delete of the main file),
 * `manualCleanup.ts` (reads; a confirmed delete of an older copy) and
 * `opfsCopyBack.ts`, the one writer: it copies an OPFS main file into
 * IndexedDB at store selection, and when the IndexedDB `migrated` marker exists
 * it does so whether or not the profile holds a block head, so a block profile
 * can hold a `database.bin` it wrote. The manual clean-up treats every
 * `database.bin` on a block profile as a keep source for that reason.
 * The call graph of every other storage write and delete in production
 * (`store.write`, `store.delete`, `deleteMany`, `forageStorage.setItem`) was
 * read: they take `blocks/`, `assets/`, `coldstorage/`, `remotes/`,
 * `database/dbbackup-` or `database/database.pre-blocks` keys.
 *
 * Mocked: the platform (a desktop page), the alert surface, the app modules the
 * restores import, the IndexedDB block cache. The store is a stand-in: nothing
 * here says anything about a real backend. Tests titled `guard:` pass with or
 * without the change they follow (they pin behaviour that must be preserved);
 * the other test fails against the code before the manual clean-up moved onto
 * the block store.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { createFakeStore, type FakeStore } from './blockStoreHarness'
import { injectRestoreStore, committedTree } from 'src/ts/drive/tests/restoreSupport'

//#region shared observation state

const box = vi.hoisted(() => ({
    confirmCalls: [] as string[],
    /** Answers to the confirms, in order; any confirm beyond them is answered yes. */
    confirmAnswers: [] as boolean[],
    errors: [] as string[],
    relaunches: 0,
}))

const setDatabaseMock = vi.hoisted(() => vi.fn())
const requiresFullEncoderReloadMock = vi.hoisted(() => ({ state: false }))

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
        reset: (): void => { tail = Promise.resolve() },
    }
})

//#endregion

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

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

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
    presetFromWorkingSettings: (db: { mainPrompt?: string }, name: string, image: string) => ({ name, image, mainPrompt: db.mainPrompt }),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    LocalWriter: class { },
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }) },
    requiresFullEncoderReload: requiresFullEncoderReloadMock,
    noteAssetWrittenThisPage: vi.fn(),
    dbWriteLock: writeLock,
    acquireExclusiveStorageMigrationLock: vi.fn(async () => (async () => { })),
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
    describeBlockForPerson: (blockName: string) => `"${blockName}"`,
    getBasename: (path: string) => path.split('/').pop() ?? path,
    getUncleanablesSync: (db: { characters?: Array<{ image?: string }> }) => new Set((db.characters ?? []).map((c) => c.image ?? '').filter((name) => name !== '')),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async (message: string) => {
        box.confirmCalls.push(message)
        return box.confirmAnswers.shift() ?? true
    }),
    alertError: vi.fn((message: string) => { box.errors.push(message) }),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertMd: vi.fn(),
    alertWait: vi.fn(),
    alertSelect: vi.fn(async () => '1'),
    alertStore: { set: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    decryptBuffer: vi.fn(),
    encryptBuffer: vi.fn(),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    deleteColdStorageUnits: vi.fn(async () => []),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: vi.fn((name: string) => (name.startsWith('coldstorage_') ? name.slice('coldstorage_'.length, -'.json'.length) : null)),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], pluginCustomStorage: {} } as unknown as Database },
        frozenSaveKeysStore: writable([]),
        savingStoppedReason: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

//#endregion

import { LoadLocalBackup } from 'src/ts/drive/backuplocal'
import { loadInternalBackup } from 'src/ts/drive/internalBackup'
import { RisuSaveEncoder, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { getPageBlockOwner } from 'src/ts/storage/pageBlockOwner'
import { getPageStorageMode, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { fingerprintMainFile } from 'src/ts/storage/mainFileFingerprint'
import { performSaveStep } from 'src/ts/storage/saveStep'
import { treeToBlockSet } from 'src/ts/storage/treeToBlockSet'
import { createBootPassSeams } from 'src/ts/storage/bootPassSeams'
import { runManualCleanup } from 'src/ts/storage/manualCleanup'
import { recordLoadTimeListing, resetLoadTimeListingForTests } from 'src/ts/storage/loadTimeListing'
import { layoutFileBytes, loadBlockProfile, type BootLoadContext } from 'src/ts/storage/bootBlockLoad'
import type { BootArchiveSession } from 'src/ts/storage/bootArchivePass'

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

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function chunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    out.set(u32le(nameBuf.length), 0)
    out.set(nameBuf, 4)
    out.set(u32le(data.length), 4 + nameBuf.length)
    out.set(data, 8 + nameBuf.length)
    return out
}

async function blockFile(db: Database): Promise<Uint8Array> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false })
    return new Uint8Array(encoder.encode()!)
}

let store: FakeStore
let capturedInput: HTMLInputElement | null = null

function useStore(): FakeStore {
    store = createFakeStore({ versioned: false })
    injectRestoreStore(store, 'tauri')
    return store
}

async function runBinRestore(file: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [new File([file as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

/** Every key a write, delete or deleteMany of the store touched, with the kind of call. */
function touches(key: string): Array<'write' | 'delete' | 'deleteMany'> {
    return store.mutating()
        .filter((op) => (op.kind === 'deleteMany' ? op.keys.includes(key) : op.key === key))
        .map((op) => op.kind as 'write' | 'delete' | 'deleteMany')
}

function committedPrompt(): Promise<unknown> {
    return committedTree().then((value) => value?.mainPrompt)
}

//#endregion

beforeEach(() => {
    box.confirmCalls.length = 0
    box.confirmAnswers.length = 0
    box.errors.length = 0
    box.relaunches = 0
    setDatabaseMock.mockReset()
    requiresFullEncoderReloadMock.state = false
    writeLock.reset()
    resetLoadTimeListingForTests()
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
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('R57 invariant 1: a block-store page never writes database/database.bin', () => {
    test('one page through the pass conversion, saves, an import, the clean-up and both restores: the key is never written, and the only touch is the rename finish\'s delete', async () => {
        // The page boots on a legacy profile: the main file is the save.
        const main = encodeRisuSaveLegacy(tree([character('old-a', 'Old A')], { mainPrompt: 'old prompt' }), 'noCompression')
        store.plant(MAIN, main)
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(main) })
        const owner = (await getPageBlockOwner())!
        const seams = createBootPassSeams({ owner, store, readMainFile: async () => (await store.read(MAIN)).bytes })
        store.ops.length = 0

        // The boot archive pass's commit seam converts the profile (the pass's production commit path).
        await seams.commit(await treeToBlockSet(tree([character('old-a', 'Old A')], { mainPrompt: 'converted' })))
        expect(getPageStorageMode().kind).toBe('block')
        expect(store.peek(MAIN), 'the rename finish moved the main file aside').toBeNull()
        expect(store.keys('database/database.pre-blocks').length).toBe(1)

        // The save loop's step.
        const edited = tree([character('old-a', 'Old A')], { mainPrompt: 'edited' })
        expect(await performSaveStep({ owner, store }, { input: await treeToBlockSet(edited) })).toMatchObject({ kind: 'saved', wrote: true })

        // The pass commits again on a block page (a later archive run).
        await seams.commit(await treeToBlockSet(tree([character('old-a', 'Old A')], { mainPrompt: 'after the pass' })))

        // A character import changes the tree and reaches storage only through the save loop's step.
        const imported = tree([character('old-a', 'Old A'), character('imported-b', 'Imported B')], { mainPrompt: 'after the pass' })
        expect(await performSaveStep({ owner, store }, { input: await treeToBlockSet(imported) })).toMatchObject({ kind: 'saved', wrote: true })

        // The manual clean-up: the pre-conversion copy is offered and kept.
        await recordLoadTimeListing()
        box.confirmAnswers.push(false)
        await runManualCleanup()
        expect(box.errors).toEqual([])

        // The internal-backup load.
        store.plant(SNAPSHOT_KEY, await blockFile(tree([character('snap-a', 'Snap A')], { mainPrompt: 'from the snapshot' })))
        await loadInternalBackup()
        expect(await committedPrompt()).toBe('from the snapshot')

        // The `.bin` restore on the relaunched page.
        writeLock.reset()
        await runBinRestore(new Uint8Array([...chunk('database.risudat', await blockFile(tree([character('bin-a', 'Bin A')], { mainPrompt: 'from the .bin' })))]))
        expect(await committedPrompt()).toBe('from the .bin')

        expect(box.errors).toEqual([])
        expect(touches(MAIN).filter((kind) => kind === 'write'), 'writes of the main file').toEqual([])
        expect(touches(MAIN), 'every touch of the main file').toEqual(['delete'])
        expect(store.keys('database/').filter((key) => key === MAIN)).toEqual([])
    })

    test('guard: a block page that finds a stale database.bin next to its blocks leaves it untouched through a save, a restore and a clean-up that declines to delete it', async () => {
        const owner = (await getPageBlockOwner())!
        expect((await owner.replaceWholeState(await treeToBlockSet(tree([character('a', 'A')])), { requireAbsentHead: true })).kind).toBe('won')
        setPageStorageMode({ kind: 'block' })
        const stale = new TextEncoder().encode('a main file another program wrote')
        store.plant(MAIN, stale)
        store.ops.length = 0

        expect(await performSaveStep({ owner, store }, { input: await treeToBlockSet(tree([character('a', 'A')], { mainPrompt: 'edited' })) })).toMatchObject({ kind: 'saved', wrote: true })
        await recordLoadTimeListing()
        box.confirmAnswers.push(false)
        await runManualCleanup()
        store.plant(SNAPSHOT_KEY, await blockFile(tree([character('snap-a', 'Snap A')])))
        store.ops.length = 0
        await loadInternalBackup()

        expect(touches(MAIN)).toEqual([])
        expect(store.peek(MAIN)).toEqual(stale)
    })
})

describe('1c-1: one owner per page across sites', () => {
    test('guard: the pass commits, then the save loop\'s first iteration with unchanged state writes nothing', async () => {
        const owner = (await getPageBlockOwner())!
        expect((await owner.replaceWholeState(await treeToBlockSet(tree([character('a', 'A')])), { requireAbsentHead: true })).kind).toBe('won')
        setPageStorageMode({ kind: 'block' })
        const seams = createBootPassSeams({ owner, store, readMainFile: async () => (await store.read(MAIN)).bytes })
        const next = tree([character('a', 'A', { name: 'A after the pass' })])

        await seams.commit(await treeToBlockSet(next))
        store.ops.length = 0
        const step = await performSaveStep({ owner, store }, { input: await treeToBlockSet(next) })

        expect(step).toMatchObject({ kind: 'saved', wrote: false })
        expect(store.mutating(), 'writes of the first save iteration').toEqual([])
    })

    test('guard: a damage-path backup wins, then an edit in the same session commits into that generation', async () => {
        const owner = (await getPageBlockOwner())!
        const first = await owner.replaceWholeState(await treeToBlockSet(tree([character('good', 'Good'), character('bad', 'Bad')])), { requireAbsentHead: true })
        if (first.kind !== 'won') {
            throw new Error('the profile was not seeded')
        }
        const { ownBlockKey } = await import('src/ts/storage/blockKeys')
        const { frameBlock, BLOCK_TYPE_CHARACTER_WITH_CHAT } = await import('src/ts/storage/blockFrame')
        store.plant(ownBlockKey(first.generation, 'bad'), frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, 'bad', new TextEncoder().encode('{not json')))
        // A fresh page owner, as a restarted page has: the damaged profile is loaded through it.
        const { resetPageBlockOwnerForTests } = await import('src/ts/storage/pageBlockOwner')
        resetPageBlockOwnerForTests()
        const loader = (await getPageBlockOwner())!
        const backup = layoutFileBytes((await treeToBlockSet(tree([character('from-backup', 'From backup')]))).layout)
        const session: BootArchiveSession = {
            canArchive: true,
            run: async (input) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] }),
            release: async () => { },
            acquireReplaceHold: async () => ({ kind: 'held', release: async () => { } }),
        }
        const ctx: BootLoadContext = {
            owner: loader,
            store,
            session,
            ui: { notify: async () => { }, choose: async () => 0, confirm: async () => true },
            backups: { list: async () => [100], read: async () => backup },
            waitForReload: () => new Promise<never>(() => { }),
        }

        const loaded = await loadBlockProfile(ctx)
        expect(loaded).toMatchObject({ kind: 'loaded', how: 'backup' })
        setPageStorageMode({ kind: 'block' })
        const live = loader.committedState()!
        store.ops.length = 0

        const edited = tree([character('from-backup', 'From backup edited')])
        const step = await performSaveStep({ owner: loader, store }, { input: await treeToBlockSet(edited) })

        expect(step).toMatchObject({ kind: 'saved', wrote: true })
        expect(loader.committedState()?.generation, 'the edit committed into the backup\'s generation').toBe(live.generation)
        expect(store.mutating().filter((op) => op.kind === 'write').every((op) => op.key.startsWith(`blocks/${live.generation}/`)), 'every write of the edit is inside that generation').toBe(true)
        expect(store.peek(HEAD), 'a commit never writes the head').not.toBeNull()
        expect(touches(HEAD)).toEqual([])
    })
})
