// @vitest-environment happy-dom

/**
 * A `.bin` export (full and partial) leaves out the page's installed theme packs: neither `themePacks` nor
 * `activeThemePack` reaches the database entry, no `assets/tp-*` file is written, and no oversize prompt names a pack
 * file on the sized and the store listing. The Node server route lists the server again for the upstream warning and is
 * covered by `backupNodePackOversize.test.ts`. One prompt names the packs before the writer opens in both flows;
 * declining writes nothing; a page without packs gets no such prompt.
 *
 * `SaveLocalBackup` and `SavePartialLocalBackup` run for real on an Android page (the sized listing and the batch reader
 * are the page's own, over an `invoke` stand-in that follows the frame rules of the Rust command), so the asset keys and
 * the sized listing are the two index-aligned lists the export filters. A mocked command is not evidence about the native
 * backend. Titles: `reproducer` fails when the omission is absent; `guard` passes before and after.
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

/** The Android bridge stand-in: what it was asked, and the sizes its listing reports instead of the files' own. */
const bridge = vi.hoisted(() => ({
    calls: [] as { command: string, keys: string[] }[],
    listedSizes: new Map<string, number>(),
    sizedAnswers: true,
}))

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
            bridge.calls.push({ command, keys: [] })
            if (!bridge.sizedAnswers) {
                throw new Error('the sized listing does not answer')
            }
            return fakeFs.listing('assets').map((name) => {
                const key = `assets/${name}`
                return [key, bridge.listedSizes.get(key) ?? fakeFs.files.get(key)?.length ?? 0]
            })
        }
        if (command === 'get_assets_batch') {
            const keys = (args as { keys: string[] }).keys
            bridge.calls.push({ command, keys: [...keys] })
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
        listColdDataKeys: vi.fn(async () => []),
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

//#region helpers

const MIB = 1024 * 1024
const HEX_PACK = 'ab'.repeat(32)
const HEX_SECOND = '3c'.repeat(32)
const PACK_KEY = `assets/tp-${HEX_PACK}.risutheme`
const SECOND_KEY = `assets/tp-${HEX_SECOND}.risutheme`
const PACK_PROMPT = 'theme pack(s)'
const OVERSIZE_PROMPT = 'item(s)'

/**
 * A stored record's shape with a short archive string: msgpackr under Node refuses a string of 64 or more characters, so
 * a record carrying a full key would fail the encoder of the page's own database entry for a reason that is not under
 * test. The files the export lists are planted under the full keys.
 */
function record(archive: string, id: string, name: string): Record<string, unknown> {
    return {
        v: 1, id, name, version: '1.0.0', license: 'MIT', attribution: 'A. Author',
        modes: ['light', 'dark'], fonts: [], archive, bytes: 64, installedAt: 1_700_000_000_000,
    }
}

const PACKS = [record('assets/tp-one.risutheme', 'pack-1', 'Origin Navy'), record('assets/tp-two.risutheme', 'pack-2', 'Banana Cocoa')]

interface PageFields {
    themePacks?: unknown
    activeThemePack?: string
    userIcon?: string
}

/** The page's database: the profile image keeps one asset in a partial export. */
function page(fields: PageFields): Database {
    const db = { characters: [], personas: [], characterOrder: [], botPresets: [], ...fields } as unknown as Database
    vi.mocked(getDatabase).mockImplementation(() => db)
    return db
}

function patterned(size: number, seed: number): Uint8Array {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) {
        out[i] = (i * 13 + seed) % 251
    }
    return out
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

async function databaseText(): Promise<string> {
    const entry = exportedEntries().find((candidate) => candidate.name === 'database.risudat')
    expect(entry, 'the file holds a database entry').toBeDefined()
    return JSON.stringify(await decodeRisuSave(entry!.data))
}

const packPrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => text.includes(PACK_PROMPT))
const oversizePrompts = (): string[] => alertConfirmMock.mock.calls.map((call) => String(call[0])).filter((text) => text.includes(OVERSIZE_PROMPT))

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
    bridge.calls.length = 0
    bridge.listedSizes.clear()
    bridge.sizedAnswers = true
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
])('%s of a page that holds installed theme packs', (_name, run) => {
    test('T2-7 reproducer: one prompt names every pack before the writer opens, the file holds neither field, and the page keeps both', async () => {
        const db = page({ themePacks: PACKS, activeThemePack: 'pack-1' })
        let writesAtPrompt = -1
        alertConfirmMock.mockImplementation(async (message: string) => {
            if (message.includes(PACK_PROMPT)) {
                writesAtPrompt = backupSink.writes.length
            }
            return true
        })

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(packPrompts()).toHaveLength(1)
        expect(writesAtPrompt).toBe(0)
        expect(packPrompts()[0]).toContain('Origin Navy')
        expect(packPrompts()[0]).toContain('Banana Cocoa')
        const text = await databaseText()
        expect(text).not.toContain('themePacks')
        expect(text).not.toContain('activeThemePack')
        expect(text).not.toContain('tp-')
        expect((db as unknown as { themePacks: unknown[] }).themePacks).toHaveLength(2)
        expect(db.activeThemePack).toBe('pack-1')
    }, 120_000)

    test('T2-7 reproducer: an active id alone (a built-in theme) is not exported, and it needs no prompt', async () => {
        page({ activeThemePack: 'builtin:origin-navy' })

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(packPrompts()).toEqual([])
        expect(await databaseText()).not.toContain('activeThemePack')
    }, 120_000)

    test('T2-7 reproducer: a pack without a readable name is named by its position', async () => {
        page({ themePacks: [{ v: 7, future: true }, PACKS[0]] })

        await run()

        expect(packPrompts()).toHaveLength(1)
        expect(packPrompts()[0]).toContain('#1')
        expect(packPrompts()[0]).toContain('Origin Navy')
    }, 120_000)

    test('T2-7 reproducer: declining the prompt ends the export as declined, with nothing written', async () => {
        page({ themePacks: PACKS })
        alertConfirmMock.mockImplementation(async (message: string) => !message.includes(PACK_PROMPT))

        const outcome = await run()

        expect(packPrompts()).toHaveLength(1)
        expect(outcome).toEqual({ status: 'declined', cause: 'incomplete-data-declined' })
        expect(backupSink.writes).toEqual([])
        expect(alertErrorMock).not.toHaveBeenCalled()
    }, 120_000)

    test('T2-7 guard: a page without packs gets no such prompt and no such key in the file', async () => {
        page({})

        const outcome = await run()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(packPrompts()).toEqual([])
        const text = await databaseText()
        expect(text).not.toContain('themePacks')
        expect(text).not.toContain('activeThemePack')
    }, 120_000)
})

describe('a full export lists no pack file', () => {
    test('T2-7 reproducer: no assets/tp-* entry is written, the ordinary assets are, and the store keeps the pack file', async () => {
        const ordinary = patterned(700, 5)
        fakeFs.plant('assets/a-first.png', ordinary)
        fakeFs.plant(PACK_KEY, patterned(900, 6))
        page({ themePacks: PACKS })

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved' })
        const names = exportedEntries().filter((entry) => entry.name !== 'database.risudat').map((entry) => entry.name)
        expect(names).toEqual(['a-first.png'])
        expect(fakeFs.files.has(PACK_KEY)).toBe(true)
    }, 120_000)

    test('T2-7 aligned reproducer: on the sized listing every written entry holds its own key\'s bytes, with a pack key between two ordinary keys', async () => {
        const first = patterned(600, 1)
        const last = patterned(650, 2)
        fakeFs.plant('assets/a-first.png', first)
        fakeFs.plant(PACK_KEY, patterned(777, 3))
        fakeFs.plant('assets/z-last.png', last)
        page({ themePacks: PACKS })

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(bridge.calls.some((call) => call.command === 'list_assets_sized')).toBe(true)
        const written = new Map(exportedEntries().filter((entry) => entry.name !== 'database.risudat').map((entry) => [entry.name, entry.data]))
        expect([...written.keys()]).toEqual(['a-first.png', 'z-last.png'])
        expect(Buffer.compare(Buffer.from(written.get('a-first.png')!), Buffer.from(first))).toBe(0)
        expect(Buffer.compare(Buffer.from(written.get('z-last.png')!), Buffer.from(last))).toBe(0)
        expect(bridge.calls.filter((call) => call.command === 'get_assets_batch').flatMap((call) => call.keys)).toEqual(['assets/a-first.png', 'assets/z-last.png'])
    }, 120_000)

    test('T2-7 non-sized reproducer: on the store listing (no sized command) no assets/tp-* entry is written with a pack key between two ordinary keys, and the store keeps the pack file', async () => {
        bridge.sizedAnswers = false
        const first = patterned(600, 1)
        const last = patterned(650, 2)
        fakeFs.plant('assets/a-first.png', first)
        fakeFs.plant(PACK_KEY, patterned(777, 3))
        fakeFs.plant('assets/z-last.png', last)
        page({ themePacks: PACKS })

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(bridge.calls.some((call) => call.command === 'list_assets_sized')).toBe(true)
        const written = exportedEntries().filter((entry) => entry.name !== 'database.risudat')
        expect(written.map((entry) => entry.name)).toEqual(['a-first.png', 'z-last.png'])
        expect(written.some((entry) => entry.name.startsWith('tp-'))).toBe(false)
        expect(fakeFs.files.has(PACK_KEY)).toBe(true)
    }, 120_000)

    test('T2-7 oversize reproducer: a pack archive listed over the upstream Node limit is named by neither oversize prompt, an ordinary asset is', async () => {
        fakeFs.plant('assets/a-first.png', patterned(600, 1))
        fakeFs.plant(PACK_KEY, patterned(777, 3))
        fakeFs.plant('assets/z-big.bin', patterned(700, 4))
        bridge.listedSizes.set(PACK_KEY, 101 * MIB)
        bridge.listedSizes.set('assets/z-big.bin', 101 * MIB)
        page({ themePacks: PACKS })

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain('assets/z-big.bin')
        for (const prompt of alertConfirmMock.mock.calls.map((call) => String(call[0]))) {
            expect(prompt).not.toContain('tp-')
        }
    }, 120_000)

    test('T2-7 oversize reproducer: a pack archive at or over a lowered limit is not named by the leave-out prompt, an ordinary asset is', async () => {
        fakeFs.plant('assets/a-first.png', patterned(600, 1))
        fakeFs.plant(PACK_KEY, patterned(2500, 3))
        fakeFs.plant('assets/z-big.bin', patterned(2500, 4))
        page({ themePacks: PACKS })

        const outcome = await SaveLocalBackup({ limitBytes: 2000 })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(oversizePrompts()).toHaveLength(1)
        expect(oversizePrompts()[0]).toContain('assets/z-big.bin')
        for (const prompt of alertConfirmMock.mock.calls.map((call) => String(call[0]))) {
            expect(prompt).not.toContain('tp-')
        }
        expect(outcome.status === 'saved' && outcome.omitted.oversize.join('\n')).not.toContain('tp-')
    }, 120_000)

    test('T2-7 oversize guard: a pack archive alone over the limit raises no oversize prompt at all', async () => {
        fakeFs.plant(PACK_KEY, patterned(2500, 3))
        page({ themePacks: PACKS })

        const outcome = await SaveLocalBackup({ limitBytes: 2000 })

        expect(outcome).toMatchObject({ status: 'saved' })
        expect(oversizePrompts()).toEqual([])
    }, 120_000)
})

describe('the packs and the other prompts', () => {
    test('T2-7 guard: the pack prompt comes after the task preset prompt, and each prompt asks once', async () => {
        page({ themePacks: PACKS, taskPresets: [{ id: 't', name: 'Summarize', instructions: 'x', model: 'm' }] } as PageFields)

        const outcome = await SaveLocalBackup()

        expect(outcome).toMatchObject({ status: 'saved' })
        const order = alertConfirmMock.mock.calls.map((call) => String(call[0]))
        const preset = order.findIndex((text) => text.includes('task preset(s)'))
        const pack = order.findIndex((text) => text.includes(PACK_PROMPT))
        expect(preset).toBeGreaterThanOrEqual(0)
        expect(pack).toBeGreaterThan(preset)
    }, 120_000)
})
