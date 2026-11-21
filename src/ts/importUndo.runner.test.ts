/**
 * The import Undo through the real character import path (`importCharacter` in `characterCards.ts`): what the caller gets
 * back after an Undo.
 *
 * REAL: `characterCards.ts`, `importBatch.ts`, `importUndo.ts`, `alertTask.svelte.ts`. MOCKED: the character trash writes
 * (`trashImportedCharacters` is a recorder: its real writes have their own tests in `importUndo.svelte.test.ts`), the
 * toast host and the store seams. The database root is
 * one stable object. A mocked store says nothing about native storage.
 *
 * Titles: "reproducer" fails on the code before the change for the named assertion.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    characters: [] as Array<Record<string, unknown>>,
    files: [] as File[],
    trashed: [] as unknown[][],
    toasts: [] as string[],
    db: null as null | Record<string, unknown>,
}))

vi.mock('uuid', () => {
    let n = 0
    return { v4: () => `uuid-${++n}` }
})
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))
vi.mock(import('src/ts/drive/backupWorkGuard'), () => ({ refuseImportWhileRestoring: () => false }) as unknown as typeof import('src/ts/drive/backupWorkGuard'))
vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertModuleSelect: vi.fn(),
    alertNormal: vi.fn(),
    alertNormalWait: vi.fn(async () => {}),
    alertSelect: vi.fn(async () => '0'),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/toast/toastHost.svelte'), () => ({
    postToast: vi.fn((init: { text: string }) => { h.toasts.push(init.text); return 1 }),
}) as unknown as typeof import('src/ts/toast/toastHost.svelte'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(async () => {}),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false, modules: [] })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/util'), () => ({
    Semaphore: class {
        async acquire() {}
        release() {}
    },
    asBuffer: (a: unknown) => a,
    checkNullish: (v: unknown) => v === null || v === undefined,
    checkPersonaBinded: vi.fn(),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: (uri: string) => uri.startsWith('http://') || uri.startsWith('https://'),
    selectFileByDom: vi.fn(async () => h.files),
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
    createBlankChar: vi.fn(() => ({ name: '', emotionImages: [], bias: [], globalLore: [], customscript: [], alternateGreetings: [], tags: [] })),
    trashImportedCharacters: vi.fn((slots: unknown[]) => { h.trashed.push(slots); return slots.length }),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        AssetSourceChangedError: class extends Error { },
        BlankWriter: class { },
        LocalWriter: class { },
        VirtualWriter: class { },
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => { }),
        forageStorage: {},
        loadAsset: vi.fn(),
        openURL: vi.fn(),
        pieceStoreOrNull: vi.fn(async () => null),
        readImage: vi.fn(),
        saveAsset: vi.fn(async () => 'saved'),
        saveAssetFromPieces: vi.fn(async () => 'saved'),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})
vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return h.db } },
    HideIconStore: { set: vi.fn() },
    ReloadGUIPointer: { set: vi.fn() },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: (run: (v: { type: string }) => void) => { run({ type: 'none' }); return () => {} }, update: vi.fn() },
    moduleBackgroundEmbedding: { set: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({ hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`) }) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/process/files/inlays'), () => ({ reencodeImage: vi.fn(async (d: unknown) => d) }) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/process/lorebook.svelte'), () => ({ convertExternalLorebook: vi.fn() }) as unknown as typeof import('src/ts/process/lorebook.svelte'))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { importCharacter } from 'src/ts/characterCards'
import { answerTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskClock } from 'src/lib/Nexus/pattern/taskProgress'

const OLD_CARD = JSON.stringify({ name: 'Synthetic', description: 'd', first_mes: 'hi' })

/** Runs the import and presses `press` on its first result card. */
async function importAndPress(press: { kind: 'ok' } | { kind: 'action', id: string }): Promise<{ added: unknown[], actions: string[] }> {
    const done = importCharacter()
    let ended = false
    void done.then(() => { ended = true }, () => { ended = true })
    let actions: string[] = []
    for (let i = 0; i < 5000 && !ended; i++) {
        if (taskResultShowing()) {
            actions = (taskHostView()?.result?.actions ?? taskHostView()?.failure?.actions ?? []).map((a) => a.id)
            answerTask(press)
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { added: await done, actions }
}

beforeEach(() => {
    h.characters = []
    h.files = [new File([OLD_CARD], 'old.json')]
    h.trashed = []
    h.toasts = []
    h.db = { get characters() { return h.characters }, modules: [], enabledModules: [] }
    vi.stubGlobal('safeStructuredClone', structuredClone)
    resetTaskHostForTests()
    let now = 0
    const clock: TaskClock = {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => {},
        hidden: () => false,
    }
    setTaskClockForTests(clock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    vi.restoreAllMocks()
})

describe('the import picker after an Undo', () => {
    test('T12 reproducer: an undone import resolves to an empty list, so no caller opens the trashed character', async () => {
        const { added, actions } = await importAndPress({ kind: 'action', id: 'undo' })
        expect(actions).toEqual(['undo'])
        expect(h.trashed).toHaveLength(1)
        expect(h.characters).toHaveLength(1)
        expect(added).toEqual([])
    })

    test('guard: without an Undo press the list still holds the added slot', async () => {
        const { added } = await importAndPress({ kind: 'ok' })
        expect(added).toHaveLength(1)
        expect(h.trashed).toEqual([])
    })
})
