/**
 * `saveDb()` on Tauri commits its blocks and writes its numbered backups
 * atomically: a block write that fails part-way leaves the committed state
 * byte-identical to what it was (and the save is retried, not recorded as
 * committed), a backup write the durable command rejects leaves the committed
 * state complete and the earlier backup untouched, a save never removes a temp
 * file that is not a numbered backup, and the legacy main file is never
 * written. That a rejected durable write leaves no partial file is owned by the
 * Rust tests in `src-tauri/src/durable_write.rs`; the test double here rejects
 * without storing anything.
 *
 * This file drives the REAL, unmocked `saveDb()` loop, `RisuSaveEncoder`, the
 * page's block-store owner and the Tauri files store against the in-memory
 * Tauri file system in `storage/tests/tauriFsFake.ts`. One save loop runs for
 * the whole file (it never returns), and it is parked when the file ends. The
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

vi.mock('@tauri-apps/api/core', async () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: (await fakeFsPromise).invoke,
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
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

import { afterNextSaveCommit, getDbBackups, isSaveClean, saveDb } from 'src/ts/globalApi.svelte'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import { getPageBlockOwner } from 'src/ts/storage/pageBlockOwner'
import { setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { ATOMIC_TEMP_NAME_PATTERN } from 'src/ts/storage/tauriAtomicWrite'
import { treeToBlockSet } from 'src/ts/storage/treeToBlockSet'
import { validateLoadedBlocks } from 'src/ts/storage/blockProfileValidate'
import { makeDb } from 'src/ts/storage/tests/saveLoopSupport'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BlockStoreOwner } from 'src/ts/storage/blockStore'
import type { FakeTauriFs } from 'src/ts/storage/tests/tauriFsFake'

let fakeFs: FakeTauriFs
let owner: BlockStoreOwner

const CHA_ID = 'saved-cha'
const MAIN = 'database/database.bin'

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

function backupNames(): string[] {
    return fakeFs.listing('database').filter((name) => name.startsWith('dbbackup-'))
}

function tempFiles(): string[] {
    return [...fakeFs.files.keys()].filter((path) => ATOMIC_TEMP_NAME_PATTERN.test(path.slice(path.lastIndexOf('/') + 1)))
}

/** The committed state as the store holds it, strictly decoded. */
async function committedPrompt(): Promise<unknown> {
    const read = await owner.readCommitted({ validate: validateLoadedBlocks })
    if (read.kind !== 'loaded') {
        throw new Error(`the committed state did not read: ${read.kind}`)
    }
    return (read.tree as unknown as Record<string, unknown>).mainPrompt
}

/** The key of the live generation's root, which is the last write of a commit. */
const rootPath = () => `blocks/${owner.committedState()!.generation}/root`

/** Marks the character changed with a new prompt, so the loop encodes and commits it; resolves when the commit lands. */
function requestSave(prompt: string): Promise<void> {
    return new Promise((resolve) => {
        afterNextSaveCommit(resolve)
        h.db!.mainPrompt = prompt
        markCharacterForSave(CHA_ID)
    })
}

beforeAll(async () => {
    fakeFs = await fakeFsPromise
    h.db = makeDb('first', [CHA_ID])
    const page = await getPageBlockOwner()
    owner = page!
    const seeded = await owner.replaceWholeState(await treeToBlockSet(structuredClone(h.db) as unknown as Database), { requireAbsentHead: true })
    expect(seeded.kind).toBe('won')
    setPageStorageMode({ kind: 'block' })
    // The save loop never returns; it is only awaited far enough to be running.
    void saveDb()
    await settle(100)
})

afterAll(() => {
    h.parked = true
})

describe('saveDb on Tauri: the numbered backup is written atomically', () => {
    test('a backup write the durable command rejects leaves the committed state complete and the earlier backup untouched', async () => {
        fakeFs.files.set('database/dbbackup-1.bin', new Uint8Array([1, 2, 3]))
        // The blocks and the backup both go through the durable command; only the backup's write fails here.
        const fault = fakeFs.failDurableWrites('There is not enough space on the disk. (os error 112)', (key) => key.startsWith('database/dbbackup-'), 1)

        await requestSave('second')
        await vi.waitFor(() => { expect(fault.fired).toBe(1) }, { timeout: 8000, interval: 10 })
        await settle()
        fakeFs.clearFaults()

        expect(await committedPrompt()).toBe('second')
        expect(backupNames()).toEqual(['dbbackup-1.bin'])
        expect(hex(fakeFs.files.get('database/dbbackup-1.bin'))).toBe(hex(new Uint8Array([1, 2, 3])))
        expect(tempFiles()).toEqual([])
    })

    test('a successful save leaves the new committed state and a complete backup, no temp file; blocks and the backup go through the durable command and nothing else writes into the block store', async () => {
        fakeFs.writeLog.length = 0
        fakeFs.durableLog.length = 0

        await requestSave('third')
        await vi.waitFor(() => { expect(backupNames().length).toBe(2) }, { timeout: 8000, interval: 10 })
        await settle()

        expect(await committedPrompt()).toBe('third')
        const newBackup = backupNames().find((name) => name !== 'dbbackup-1.bin')!
        expect(newBackup).toMatch(/^dbbackup-\d+\.bin$/)
        const decoded = await decodeRisuSave(fakeFs.files.get(`database/${newBackup}`)!, { strict: true }) as unknown as Record<string, unknown>
        expect(decoded.mainPrompt).toBe('third')
        expect(tempFiles()).toEqual([])
        expect(fakeFs.durableLog).toEqual([rootPath(), `database/${newBackup}`])
        // What the plugin's atomic write still carries is the backup fingerprint record, to temp names.
        for (const write of fakeFs.writeLog) {
            const path = bare(write.path)
            const slash = path.lastIndexOf('/')
            expect(path.slice(0, slash), path).toBe('database')
            expect(path.slice(slash + 1)).toMatch(ATOMIC_TEMP_NAME_PATTERN)
        }
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
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

        await requestSave('fourth')
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
        try {
            await requestSave('with a backup')
            await vi.waitFor(() => { expect(backupNames().length).toBe(20) }, { timeout: 8000, interval: 10 })
        } finally {
            vi.useRealTimers()
        }
        await settle()

        expect(backupNames()).toHaveLength(20)
    })
})

describe('saveDb on Tauri: the committed state is replaced atomically', () => {
    test('a write that fails part-way leaves the committed root byte-identical while the fault is active, is retried and is not recorded; the save lands once the fault clears', async () => {
        await vi.waitFor(() => { expect(isSaveClean()).toBe(true) }, { timeout: 8000, interval: 10 })
        const before = hex(fakeFs.files.get(rootPath()))
        const seqBefore = owner.committedState()!.seq
        const fault = fakeFs.failDurableWrites('There is not enough space on the disk. (os error 112)', (key) => key.startsWith('blocks/'))

        const landed = requestSave('fifth')
        // Two firings: the loop has retried, and the second attempt has also failed, with the fault still active.
        await vi.waitFor(() => { expect(fault.fired).toBeGreaterThanOrEqual(2) }, { timeout: 8000, interval: 5 })
        expect(hex(fakeFs.files.get(rootPath()))).toBe(before)
        expect(owner.committedState()!.seq).toBe(seqBefore)

        fakeFs.clearFaults()
        await landed
        await settle()

        expect(owner.committedState()!.seq).toBe(seqBefore + 1)
        expect(hex(fakeFs.files.get(rootPath()))).not.toBe(before)
        expect(await committedPrompt()).toBe('fifth')
        expect(tempFiles()).toEqual([])
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
        expect(fakeFs.files.has(MAIN)).toBe(false)
    })
})
