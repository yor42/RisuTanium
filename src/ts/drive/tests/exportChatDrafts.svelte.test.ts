// @vitest-environment happy-dom

/**
 * A `.bin` export (full and partial) leaves out the page's unsent message edits and long-chat hint flags (`chatDrafts`,
 * store2 kind 30): the key never reaches the database entry, and the leave-out summary names it (`kind: 'chatDrafts'`, with
 * the draft and flagged-chat counts) before the writer opens. The per-kind fallback asks its own confirm when the sheet is
 * unanswered; declining writes nothing; the page's own value is never changed. An entry this build cannot key is not named.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real on an Android page over the file-system and command
 * stand-ins `exportChroMemory.svelte.test.ts` uses. A mocked command is not evidence about the native backend.
 * Titles: `reproducer` fails when the leave-out is absent; `guard` passes before and after.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})
const BACKUP_PATH = vi.hoisted(() => 'backup-output.bin')
const backupSink = vi.hoisted(() => ({ writes: [] as Uint8Array[] }))

/** The file-system and desktop-command stand-ins, built once on first use (a `.svelte.test.ts` file has no top-level await). */
const kit = vi.hoisted(() => {
    interface Kit {
        fakeFs: ReturnType<typeof import('src/ts/storage/tests/tauriFsFake').createFakeTauriFs>
        desktop: ReturnType<typeof import('src/ts/storage/tests/tauriDesktopFake').createDesktopInvoke>
    }
    let built: Promise<Kit> | undefined
    return {
        get(): Promise<Kit> {
            built ??= (async () => {
                const fakeFs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
                const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs, { cap: 8 * 1024 * 1024 })
                return { fakeFs, desktop }
            })()
            return built
        },
    }
})

const RUST_RESPONSE_MAX = 4 * 1024 * 1024

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { },
    isAppInitiatedReload: () => false,
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

vi.mock('@tauri-apps/plugin-fs', async () => {
    const { fakeFs } = await kit.get()
    return {
        ...fakeFs.module,
        writeFile: async (path: string, data: Uint8Array, options?: { createNew?: boolean, baseDir?: number }) => {
            if (path === BACKUP_PATH) {
                backupSink.writes.push(data.slice())
                return
            }
            await fakeFs.module.writeFile(path, data, options)
        },
    }
})

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => BACKUP_PATH),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] })),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
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
}) as unknown as typeof import('src/ts/stores.svelte'))

const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string) => true))
const alertMdMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

/** Answers one `get_assets_batch` call with the frame rules of the Rust command. */
function batchReply(fakeFs: Awaited<ReturnType<typeof kit.get>>['fakeFs'], keys: readonly string[]): ArrayBuffer {
    const frames: Uint8Array[] = []
    let served = 0
    let exhausted = false
    const push = (status: number, body: Uint8Array) => {
        const frame = new Uint8Array(5 + body.length)
        frame[0] = status
        new DataView(frame.buffer).setUint32(1, body.length, true)
        frame.set(body, 5)
        frames.push(frame)
    }
    for (const key of keys) {
        const file = fakeFs.files.get(key)
        if (exhausted) {
            push(5, new Uint8Array(0))
        } else if (file === undefined) {
            push(1, new Uint8Array(0))
        } else if (file.length > RUST_RESPONSE_MAX) {
            push(4, new Uint8Array(0))
        } else if (served > 0 && served + file.length > RUST_RESPONSE_MAX) {
            exhausted = true
            push(5, new Uint8Array(0))
        } else {
            served += file.length
            push(0, file)
        }
    }
    const out = new Uint8Array(frames.reduce((n, frame) => n + frame.length, 0))
    let offset = 0
    for (const frame of frames) {
        out.set(frame, offset)
        offset += frame.length
    }
    return out.buffer
}

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) => {
        const { fakeFs, desktop } = await kit.get()
        if (command === 'list_assets_sized') {
            return fakeFs.listing('assets').map((name) => {
                const key = `assets/${name}`
                return [key, fakeFs.files.get(key)?.length ?? 0]
            })
        }
        if (command === 'get_assets_batch') {
            const keys = (args as { keys: string[] }).keys
            await Promise.resolve()
            return batchReply(fakeFs, keys)
        }
        return (desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options)
    },
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
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
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
        removeItem = vi.fn(async () => { })
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
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { SaveLocalBackup, SavePartialLocalBackup, type BackupExportOptions, type ExportOutcome } from 'src/ts/drive/backuplocal'
import { getDatabase } from 'src/ts/storage/database.svelte'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { decodeRisuSave } from 'src/ts/storage/risuSave'
import type { BinLeaveOutEntry } from 'src/ts/drive/binLeaveOut'

//#region helpers

interface PageFields {
    chatDrafts?: unknown
    ltmEngine?: boolean
    ltmSettings?: unknown
}

/** One chat's entry as the writer produces it: `cha`, `chat`, an optional flag and drafts keyed by message. */
const DRAFTS = [
    { cha: 'char-a', chat: 'chat-1', shown: true, drafts: [
        { m: 'id:msg-1', text: 'unsent one', bh: '00112233445566778899aabbccddeeff', at: 1_700_000_000_000 },
        { m: 'idx:4', text: 'unsent two', bh: 'ffeeddccbbaa99887766554433221100', at: 1_700_000_000_500 },
    ] },
    { cha: 'char-b', chat: 'chat-9', drafts: [
        { m: 'id:msg-7', text: 'unsent three', bh: '0123456789abcdef0123456789abcdef', at: 1_700_000_001_000 },
    ] },
]

/** The page's database. */
function page(fields: PageFields): Database {
    const db = { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
    vi.mocked(getDatabase).mockImplementation(() => db)
    return db
}

function exportedEntries(): { name: string, data: Uint8Array }[] {
    const total = backupSink.writes.reduce((n, part) => n + part.length, 0)
    const bytes = new Uint8Array(total)
    let at = 0
    for (const part of backupSink.writes) {
        bytes.set(part, at)
        at += part.length
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const out: { name: string, data: Uint8Array }[] = []
    let offset = 0
    while (offset + 4 <= bytes.length) {
        const nameLength = view.getUint32(offset, true)
        offset += 4
        const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength))
        offset += nameLength
        const dataLength = view.getUint32(offset, true)
        offset += 4
        out.push({ name, data: bytes.subarray(offset, offset + dataLength) })
        offset += dataLength
    }
    return out
}

async function decodedDatabase(): Promise<Record<string, unknown>> {
    const entry = exportedEntries().find((candidate) => candidate.name === 'database.risudat')
    expect(entry, 'the file holds a database entry').toBeDefined()
    return await decodeRisuSave(entry!.data) as unknown as Record<string, unknown>
}

/** The confirms that name the unsent edits; the sheet is not shown here, so only the per-kind fallback can ask. */
const draftPrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => text.includes('unsent message edit'))

type Runner = (options?: BackupExportOptions) => Promise<ExportOutcome>

//#endregion

let dbWriteLockSpy: ReturnType<typeof vi.spyOn>
let fakeFs: Awaited<ReturnType<typeof kit.get>>['fakeFs']
let desktop: Awaited<ReturnType<typeof kit.get>>['desktop']

beforeEach(async () => {
    ;({ fakeFs, desktop } = await kit.get())
    platformBox.isTauri = true
    backupSink.writes.length = 0
    desktop.reset()
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    fakeFs.reset()
    fakeFs.directories.add('assets')
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    alertMdMock.mockClear()
    alertErrorMock.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetBusyActionsForTest()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe.each([
    ['SaveLocalBackup', SaveLocalBackup as Runner],
    ['SavePartialLocalBackup', SavePartialLocalBackup as Runner],
])('%s of a page holding unsent message edits and hint flags', (_name, run) => {
    test('T2.1 reproducer: the file holds no chatDrafts, equals the export of the same page without them, and the page keeps its value', async () => {
        const db = page({ chatDrafts: DRAFTS })

        const outcome = await run()
        expect(outcome).toMatchObject({ status: 'saved' })
        const withDrafts = await decodedDatabase()

        backupSink.writes.length = 0
        page({})
        await run()
        const without = await decodedDatabase()

        expect(Object.hasOwn(withDrafts, 'chatDrafts')).toBe(false)
        expect(withDrafts).toEqual(without)
        expect(db.chatDrafts).toEqual(DRAFTS)
    }, 120_000)

    test('T2.2 reproducer: the summary names the drafts and the flagged chats, and no per-kind prompt is asked', async () => {
        page({ chatDrafts: DRAFTS })
        let summary: readonly BinLeaveOutEntry[] = []
        const askLeaveOut = vi.fn(async (given: readonly BinLeaveOutEntry[]) => {
            summary = given
            return true
        })

        const outcome = await run({ askLeaveOut })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(summary).toEqual([{ kind: 'chatDrafts', drafts: 3, hintChats: 1 }])
        expect(draftPrompts()).toEqual([])
    }, 120_000)

    test('T2.2 reproducer: hint flags alone are named, with no draft counted', async () => {
        page({ chatDrafts: [{ cha: 'char-a', chat: 'chat-1', shown: true }, { cha: 'char-a', chat: 'chat-2', shown: true }] })
        let summary: readonly BinLeaveOutEntry[] = []

        await run({ askLeaveOut: async (given) => { summary = given; return true } })

        expect(summary).toEqual([{ kind: 'chatDrafts', drafts: 0, hintChats: 2 }])
    }, 120_000)

    test('T2.2 guard (passes before and after): a page with no drafts, an empty list or entries no reader can key asks nothing', async () => {
        for (const chatDrafts of [undefined, [], [{ nothing: 1 }, { cha: 'char-a' }, { cha: 'char-a', chat: 'chat-1' }]]) {
            backupSink.writes.length = 0
            page({ chatDrafts })
            const askLeaveOut = vi.fn(async () => true)

            const outcome = await run({ askLeaveOut })

            expect(outcome).toMatchObject({ status: 'saved' })
            expect(askLeaveOut).not.toHaveBeenCalled()
        }
        expect(draftPrompts()).toEqual([])
    }, 120_000)

    test('T2.4 reproducer: an unanswered sheet falls back to one prompt that names the drafts, and the file holds none', async () => {
        page({ chatDrafts: DRAFTS })
        const askLeaveOut = vi.fn(async () => null)

        const outcome = await run({ askLeaveOut })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(askLeaveOut).toHaveBeenCalledTimes(1)
        expect(draftPrompts()).toHaveLength(1)
        const written = await decodedDatabase()
        expect(Object.hasOwn(written, 'chatDrafts')).toBe(false)
    }, 120_000)

    test('T2.4 reproducer: without the sheet the per-kind prompt is asked after the ChroMemory prompt, and declining writes nothing', async () => {
        page({ ltmEngine: true, chatDrafts: DRAFTS })
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes('unsent message edit'))

        const outcome = await run()

        expect(draftPrompts()).toHaveLength(1)
        const order = alertConfirmMock.mock.calls.map((call) => String(call[0]))
        expect(order.findIndex((text) => text.includes('unsent message edit'))).toBeGreaterThan(order.findIndex((text) => text.includes('ChroMemory')))
        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(backupSink.writes).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('T2.4 reproducer: declining the sheet writes nothing', async () => {
        page({ chatDrafts: DRAFTS })

        const outcome = await run({ askLeaveOut: async () => false })

        expect(outcome).toMatchObject({ status: 'declined' })
        expect(backupSink.writes).toEqual([])
    }, 120_000)

    test('T3.18: the export start writes a draft typed in the last idle window, so the summary counts it', async () => {
        const db = page({})
        const stores = await import('src/ts/stores.svelte')
        ;(stores.DBState as { db: unknown }).db = db
        // The store loads with the first message editor and installs its sink; the export reaches it through the gate.
        await import('src/ts/chatDraftStore')
        const { draftContentOrphanGate } = await import('src/ts/draftContentOrphanGate')
        draftContentOrphanGate.set({ kind: 'msg', chatKey: 'window', chatId: 'msg-1', index: 0, persist: { chaId: 'char-a', chatId: 'chat-1' } }, 'typed just now', 'the saved text')
        let summary: readonly BinLeaveOutEntry[] = []

        try {
            const outcome = await run({ askLeaveOut: async (given) => { summary = given; return true } })

            expect(outcome).toMatchObject({ status: 'saved' })
            expect(summary).toEqual([{ kind: 'chatDrafts', drafts: 1, hintChats: 0 }])
            const written = await decodedDatabase()
            expect(Object.hasOwn(written, 'chatDrafts')).toBe(false)
        } finally {
            ;(stores.DBState as { db: unknown }).db = {}
            draftContentOrphanGate.clear()
        }
    }, 120_000)
})
