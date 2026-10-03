/**
 * `saveDb()` on Tauri replaces `database/database.bin` and writes its numbered
 * backups atomically: a write that fails part-way leaves the main file
 * byte-identical to what it was (and the save is retried, not recorded as
 * committed), a backup write that fails part-way leaves no partial backup, and
 * a save never removes a temp file that is not a numbered backup.
 *
 * This file drives the REAL, unmocked `saveDb()` loop and `RisuSaveEncoder`
 * against the in-memory Tauri file system in `storage/tests/tauriFsFake.ts`;
 * `noteMainFileBytes` is the observed boundary. One save loop runs for the
 * whole file (it never returns), and it is parked when the file ends. The
 * stand-in `sleep` is a short real timer. Tests run in file order: the first
 * successful backup write starts the minimum interval before the next one. A
 * passing test here is not evidence about the native Tauri plugin.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const fakeFsPromise = vi.hoisted(() => import('src/ts/storage/tests/tauriFsFake').then((module) => module.createFakeTauriFs({ strict: true })))

const h = vi.hoisted(() => ({
    parked: false,
    db: undefined as undefined | Record<string, unknown>,
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn((ms: number) => h.parked
        ? new Promise<void>(() => {})
        : new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 5)))),
    sleepForever: vi.fn(() => new Promise<void>(() => {})),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('streamsaver', () => ({
    default: {},
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', async () => (await fakeFsPromise).module)

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        async getItem(_key: string) { return null }
        async setItem(_key: string, _value: Uint8Array) {}
        async keys() { return [] as string[] }
        async removeItem(_key: string) {}
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

// The observed boundary: what the save loop tells the main-file record.
vi.mock(import('src/ts/storage/mainFileRecord'), () => ({
    noteMainFileBytes: vi.fn(),
    resetMainFileRecordForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

import { getDbBackups, saveDb } from 'src/ts/globalApi.svelte'
import { noteMainFileBytes } from 'src/ts/storage/mainFileRecord'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { ATOMIC_TEMP_NAME_PATTERN } from 'src/ts/storage/tauriAtomicWrite'
import type { FakeTauriFs } from 'src/ts/storage/tests/tauriFsFake'

let fakeFs: FakeTauriFs

const CHA_ID = 'saved-cha'
const MAIN = 'database/database.bin'
const OLD_MAIN = new TextEncoder().encode('old-main-file-bytes')

function makeDb(prompt: string): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: prompt,
        characters: [{
            chaId: CHA_ID,
            name: 'Saved',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'saved-chat', message: [], note: '', name: '', localLore: [] }],
        }],
    }
}

/** A path as the file system holds it: the store addresses AppData with a leading `./`, the plugin calls elsewhere do not. */
function bare(path: string): string {
    return path.replace(/^\.\//, '')
}

function hex(bytes: Uint8Array | undefined): string | undefined {
    return bytes ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') : undefined
}

function settle(ms = 80): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function noted(): Uint8Array[] {
    return vi.mocked(noteMainFileBytes).mock.calls.map((call) => call[0])
}

function backupNames(): string[] {
    return fakeFs.listing('database').filter((name) => name.startsWith('dbbackup-'))
}

/** Marks the character changed with a new prompt, so the loop encodes and writes the main file. */
function requestSave(prompt: string): void {
    h.db!.mainPrompt = prompt
    markCharacterForSave(CHA_ID)
}

beforeAll(async () => {
    fakeFs = await fakeFsPromise
    h.db = makeDb('first')
    fakeFs.files.set(MAIN, OLD_MAIN.slice())
    // The save loop never returns; it is only awaited far enough to be running.
    void saveDb()
    await settle(100)
})

afterAll(() => {
    h.parked = true
})

describe('saveDb on Tauri: the numbered backup is written atomically', () => {
    test('a backup write that fails part-way leaves no partial backup and the committed main file complete', async () => {
        fakeFs.files.set('database/dbbackup-1.bin', new Uint8Array([1, 2, 3]))
        // The first write of the cycle is the main file; the second is the backup.
        const fault = fakeFs.failWritesOf(() => true, 1, 1)

        requestSave('second')
        await vi.waitFor(() => { expect(fault.fired).toBe(1) }, { timeout: 8000, interval: 10 })
        await settle()
        fakeFs.clearFaults()

        expect(noted()).toHaveLength(1)
        expect(hex(fakeFs.files.get(MAIN))).toBe(hex(noted()[0]))
        expect(backupNames()).toEqual(['dbbackup-1.bin'])
        expect(hex(fakeFs.files.get('database/dbbackup-1.bin'))).toBe(hex(new Uint8Array([1, 2, 3])))
        expect(fakeFs.listing('database').filter((name) => ATOMIC_TEMP_NAME_PATTERN.test(name))).toEqual([])
    })

    test('a successful save leaves the new main file and a complete backup, no temp file, and writes only to temp names', async () => {
        fakeFs.writeLog.length = 0
        const notedBefore = noted().length

        requestSave('third')
        await vi.waitFor(() => { expect(noted().length).toBeGreaterThan(notedBefore) }, { timeout: 8000, interval: 10 })
        await vi.waitFor(() => { expect(backupNames().length).toBe(2) }, { timeout: 8000, interval: 10 })
        await settle()

        const mainBytes = noted()[notedBefore]
        expect(hex(fakeFs.files.get(MAIN))).toBe(hex(mainBytes))
        const newBackup = backupNames().find((name) => name !== 'dbbackup-1.bin')!
        expect(newBackup).toMatch(/^dbbackup-\d+\.bin$/)
        expect(hex(fakeFs.files.get(`database/${newBackup}`))).toBe(hex(mainBytes))
        expect(fakeFs.listing('database').filter((name) => ATOMIC_TEMP_NAME_PATTERN.test(name))).toEqual([])
        expect(fakeFs.writeLog.length).toBeGreaterThanOrEqual(2)
        for (const write of fakeFs.writeLog) {
            const path = bare(write.path)
            const slash = path.lastIndexOf('/')
            expect(path.slice(0, slash)).toBe('database')
            expect(path.slice(slash + 1)).toMatch(ATOMIC_TEMP_NAME_PATTERN)
        }
    })
})

describe('saveDb on Tauri: the numbered backups are pruned after a backup write, not after every save', () => {
    const LEFTOVER = 'database/risu-write-0123456789abcdef.tmp'

    function plantBackups(count: number): void {
        for (let n = 1; n <= count; n++) {
            fakeFs.files.set(`database/dbbackup-${n}.bin`, new Uint8Array([n]))
        }
    }

    test('a save that writes no backup neither lists nor removes any backup', async () => {
        plantBackups(22)
        const backupsBefore = backupNames()
        fakeFs.removeLog.length = 0
        fakeFs.readDirLog.length = 0
        const notedBefore = noted().length

        requestSave('fourth')
        await vi.waitFor(() => { expect(noted().length).toBeGreaterThan(notedBefore) }, { timeout: 8000, interval: 10 })
        await settle()

        expect(fakeFs.readDirLog).toEqual([])
        expect(fakeFs.removeLog).toEqual([])
        expect(backupNames()).toEqual(backupsBefore)
    })

    test('guard: with more than 20 backups and a leftover temp file, listing the backups removes only the oldest numbered backups and keeps the temp file', async () => {
        plantBackups(22)
        fakeFs.files.set(LEFTOVER, new Uint8Array([9, 9]))
        fakeFs.removeLog.length = 0

        const listed = await getDbBackups()

        expect(listed).toHaveLength(20)
        expect(backupNames()).toHaveLength(20)
        expect(fakeFs.files.has(LEFTOVER)).toBe(true)
        expect(fakeFs.removeLog.length).toBeGreaterThan(0)
        for (const removed of fakeFs.removeLog) {
            expect(bare(removed)).toMatch(/^database\/dbbackup-\d+\.bin$/)
        }
        fakeFs.files.delete(LEFTOVER)
    })

    test('guard: a save that writes a backup prunes the backups beyond 20', async () => {
        plantBackups(22)
        // The minimum interval between backups has passed.
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.now() + 6 * 60 * 1000)
        const notedBefore = noted().length
        try {
            requestSave('with a backup')
            await vi.waitFor(() => { expect(noted().length).toBeGreaterThan(notedBefore) }, { timeout: 8000, interval: 10 })
            await vi.waitFor(() => { expect(backupNames().length).toBe(20) }, { timeout: 8000, interval: 10 })
        } finally {
            vi.useRealTimers()
        }
        await settle()

        expect(backupNames()).toHaveLength(20)
    })
})

describe('saveDb on Tauri: the main file is replaced atomically', () => {
    test('a write that fails part-way leaves the main file byte-identical while the fault is active, is retried and is not recorded; the save lands once the fault clears', async () => {
        const before = hex(fakeFs.files.get(MAIN))
        const notedBefore = noted().length
        const fault = fakeFs.failWritesOf(() => true)

        requestSave('fifth')
        // Two firings: the loop has retried, and the second attempt has also failed, with the fault still active.
        await vi.waitFor(() => { expect(fault.fired).toBeGreaterThanOrEqual(2) }, { timeout: 8000, interval: 5 })
        expect(hex(fakeFs.files.get(MAIN))).toBe(before)
        expect(noted().length).toBe(notedBefore)

        fakeFs.clearFaults()
        await vi.waitFor(() => { expect(noted().length).toBe(notedBefore + 1) }, { timeout: 8000, interval: 10 })
        await settle()

        expect(hex(fakeFs.files.get(MAIN))).toBe(hex(noted()[notedBefore]))
        expect(hex(fakeFs.files.get(MAIN))).not.toBe(before)
        expect(fakeFs.listing('database').filter((name) => ATOMIC_TEMP_NAME_PATTERN.test(name))).toEqual([])
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
    })
})
