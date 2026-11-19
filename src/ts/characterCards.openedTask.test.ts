/**
 * Opened and shared files on the task card through `importOpenedSources` in `src/ts/characterCards.ts`: three entries run
 * on one card with their position shown, and Retry reopens the failed entry through `openDesktopImportSource`.
 *
 * The real `characterCards.ts`, `importBatch.ts`, `alertTask.svelte.ts` and `busyActions.ts` run on synthetic JSON cards.
 * `openDesktopImportSource` is a recorder that answers a byte source and notes the card it was called under; the native
 * file opener is never reached. Asset storage, alerts and the database are recorders.
 *
 * Labels: (RR-m) new behaviour pinned by mutants.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    errors: [] as string[],
    characters: [] as Array<Record<string, unknown>>,
    uuid: 0,
    /** Every call of the opener: the path and the card (id and file position) shown at that moment. */
    opened: [] as Array<{ path: string, cardId: number | null, file: { index: number, total: number, name?: string } | undefined }>,
    /** Paths whose next open throws once. */
    failOnce: new Set<string>(),
    /** The bytes each path answers. */
    bytes: new Map<string, Uint8Array>(),
}))

vi.mock('uuid', () => ({ v4: () => `uuid-${++h.uuid}` }))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/upstreamAgreement'), () => ({
    askUpstreamAgreement: vi.fn(async () => true),
    isUpstreamAccepted: vi.fn(() => true),
    publishUpstreamAccepted: vi.fn(),
}) as unknown as typeof import('src/ts/upstreamAgreement'))

vi.mock(import('src/ts/alert'), () => ({
    alertCardExport: vi.fn(),
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { h.errors.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(),
    setCurrentCharacter: vi.fn(),
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => ({ statics: { imports: 0 }, characters: h.characters, goCharacterOnImport: false })),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => []),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    changeChar: vi.fn(async () => {}),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        AssetSourceChangedError: class extends Error {},
        BlankWriter: class {},
        LocalWriter: class {},
        VirtualWriter: class {},
        checkCharOrder: vi.fn(),
        downloadFile: vi.fn(async () => {}),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        loadAsset: vi.fn(async () => new Uint8Array()),
        openURL: vi.fn(),
        readImage: vi.fn(async (d: unknown) => d),
        saveAsset: vi.fn(async () => 'asset'),
        saveAssetFromPieces: vi.fn(),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn() },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn(async (d: Uint8Array) => `len${d.length}`),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class {},
    CharXWriter: class {},
    assetByteLimit: () => 200 * 1024 * 1024,
}) as unknown as typeof import('src/ts/process/processzip'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/importSource'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        openDesktopImportSource: vi.fn(async (path: string) => {
            const view = taskHostViewNow()
            h.opened.push({ path, cardId: view?.id ?? null, file: view?.file })
            if (h.failOnce.delete(path)) {
                throw new Error('provider unavailable')
            }
            return original.importSourceOfBytes(path, h.bytes.get(path) ?? new Uint8Array())
        }),
    } as unknown as typeof import('src/ts/importSource')
})

vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: vi.fn(async () => new Uint8Array()) }))
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }))

import { importOpenedSources } from 'src/ts/characterCards'
import { answerTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskResultShowing } from 'src/ts/alertTask.svelte'
import type { TaskClock } from 'src/lib/Nexus/pattern/taskProgress'

const taskHostViewNow = () => taskHostView()

const cardJson = (name: string) => new TextEncoder().encode(JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name, description: 'd', first_mes: 'hi', character_version: '1', extensions: { risuai: {} } },
}))

const PATHS = ['content://provider/a.json', 'content://provider/b.json', 'content://provider/c.json']
const entries = PATHS.map((path) => ({ name: path.split('/').pop() as string, path, type: 'application/json' }))

beforeEach(() => {
    h.errors = []
    h.characters = []
    h.uuid = 0
    h.opened = []
    h.failOnce = new Set()
    h.bytes = new Map(PATHS.map((path, i) => [path, cardJson(`Card${i + 1}`)]))
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

describe('opened sources on the card', () => {
    //(RR-m) One card for the whole batch, showing which file is being read.
    test('R-b22: three entries run on one card that shows File i of 3 and ends in one result', async () => {
        const done = importOpenedSources(entries)
        let results = 0
        let ended = false
        void done.then(() => { ended = true })
        for (let i = 0; i < 400 && !ended; i++) {
            if (taskResultShowing()) {
                results++
                answerTask({ kind: 'ok' })
            }
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        await done

        expect(results).toBe(1)
        expect(h.opened.map((o) => o.path)).toEqual(PATHS)
        expect(new Set(h.opened.map((o) => o.cardId)).size).toBe(1)
        expect(h.opened[0].cardId).not.toBeNull()
        expect(h.opened.map((o) => o.file)).toEqual([
            { index: 0, total: 3, name: 'a.json' },
            { index: 1, total: 3, name: 'b.json' },
            { index: 2, total: 3, name: 'c.json' },
        ])
        expect(h.characters.map((c) => c.name)).toEqual(['Card1', 'Card2', 'Card3'])
        expect(h.errors).toEqual([])
    })

    //(RR-m) Retry runs the one entry that failed and reopens only its source.
    test('R-b22: Retry after one entry fails to open reopens that entry only and imports each card once', async () => {
        h.failOnce.add(PATHS[1])
        const done = importOpenedSources(entries)
        let ended = false
        let retried = false
        void done.then(() => { ended = true })
        for (let i = 0; i < 800 && !ended; i++) {
            if (taskResultShowing()) {
                const view = taskHostView()
                const actions = view?.result?.actions ?? view?.failure?.actions ?? []
                if (!retried && actions.some((a) => a.id === 'retry')) {
                    retried = true
                    answerTask({ kind: 'action', id: 'retry' })
                } else {
                    answerTask({ kind: 'ok' })
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 0))
        }
        await done

        expect(retried).toBe(true)
        expect(h.opened.map((o) => o.path)).toEqual([PATHS[0], PATHS[1], PATHS[2], PATHS[1]])
        expect(h.characters.map((c) => c.name).sort()).toEqual(['Card1', 'Card2', 'Card3'])
    })
})
