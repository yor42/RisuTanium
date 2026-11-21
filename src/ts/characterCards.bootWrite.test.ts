// @vitest-environment happy-dom

/**
 * Every import in `src/ts/characterCards.ts` that adds a character, module or preset announces itself with
 * `markBootWrite` before it writes. On a store2 page the boot window has closed by the time a person imports, so the
 * announcement reaches the save loop through the window's `markUnsaved` hook: each import site must call it once, or the
 * import is unsaved work nothing asks to save.
 *
 * The real `characterCards.ts` and `bootWindow.ts` run on a page with a registered residency and a closed boot window;
 * the database, asset storage, alerts and the module reader are replaced by recorders. Every test in the first
 * describe is a compatibility guard (it passes before and after the legacy boot removal) that fails when its own call
 * site's `markBootWrite` is removed: the `markUnsaved` count stays at zero. The second describe (a cancelled bundle
 * preview) holds reproducers for the cancel paths of each import entry point and a settings-open guard; they are not
 * about `markBootWrite`.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({
    characters: [] as Array<Record<string, unknown>>,
    modules: [] as Array<Record<string, unknown>>,
    presets: [] as Array<{ name: string }>,
    /** What the mocked importPreset resolves with: undefined means imported, {cancelled: true} a cancelled bundle preview. */
    presetResult: undefined as undefined | { cancelled: true },
    tauriFiles: {} as Record<string, Uint8Array>,
    uuid: 0,
}))

vi.mock('uuid', () => ({
    v4: () => `uuid-${++h.uuid}`,
}))

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
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    defaultSdDataFunc: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    importPreset: vi.fn(async (f: { name: string }) => { h.presets.push(f); return h.presetResult }),
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
    selectFileByDom: vi.fn(async () => null),
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
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return { characters: h.characters, modules: h.modules } } },
    SettingsMenuIndex: { set: vi.fn() },
    ShowRealmFrameStore: { set: vi.fn() },
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
    selectedCharID: { set: vi.fn(), subscribe: (run: (index: number) => void) => { run(-1); return () => {} } },
    settingsOpen: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(async () => ({ name: 'synthetic module', lorebook: [], trigger: [], regex: [] })),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: vi.fn(async (path: string) => h.tauriFiles[path] ?? new Uint8Array()),
    open: vi.fn(async (path: string) => {
        const answer = h.tauriFiles[path] ?? new Uint8Array()
        let position = 0
        return {
            read: async (buffer: Uint8Array) => {
                if (position >= answer.length) return null
                const count = Math.min(buffer.byteLength, answer.length - position)
                buffer.set(answer.subarray(position, position + count), 0)
                position += count
                return count
            },
            seek: async (offset: number) => { position = offset; return position },
            stat: async () => ({ size: answer.length, mtime: null }),
            close: async () => {},
        }
    }),
}))

//#endregion

import { characterURLImport, importOpenedFiles } from 'src/ts/characterCards'
import { settingsOpen } from 'src/ts/stores.svelte'
import { openBootWindow, resetBootWindowForTest } from 'src/ts/bootWindow'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import type { Residency } from 'src/ts/storage/store2/residency'
import { resetTaskHostForTests } from 'src/ts/alertTask.svelte'
import { answerImportCard } from 'src/ts/process/tests/answerImportCard'

const enc = new TextEncoder()
const setUrl = (pathAndQuery: string) => window.history.replaceState(null, '', pathAndQuery)
const link = (kind: 'import_module' | 'import_preset', body: string) => `/#${kind}=` + encodeURIComponent(Buffer.from(body).toString('base64'))

let markUnsaved: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
    h.characters = []
    h.modules = []
    h.presets = []
    h.presetResult = undefined
    h.tauriFiles = {}
    h.uuid = 0
    resetBootWindowForTest()
    resetResidencyForTest()
    // A store2 page: the residency is registered and the boot window has closed, so a mark goes to the save loop.
    registerResidency({} as unknown as Residency)
    markUnsaved = vi.fn<() => void>()
    openBootWindow({ getCharacters: () => [], markUnsaved }).close()
    setUrl('/')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
    resetBootWindowForTest()
    resetResidencyForTest()
    setUrl('/')
})

describe('an import on a store2 page marks a boot write at each call site', () => {
    test('guard: a character added to the library (addImportedCharacter)', async () => {
        h.tauriFiles['/docs/card.yaml'] = enc.encode('name: Yaya\ncontext: d\ngreeting: hi\n')

        await answerImportCard(() => importOpenedFiles(['/docs/card.yaml']))

        expect(h.characters).toHaveLength(1)
        expect(markUnsaved).toHaveBeenCalledTimes(1)
    })

    test('guard: a preset file (importClassified, preset branch)', async () => {
        h.tauriFiles['/docs/a.risup'] = enc.encode('{"name":"p"}')

        await answerImportCard(() => importOpenedFiles(['/docs/a.risup']))

        expect(h.presets).toHaveLength(1)
        expect(markUnsaved).toHaveBeenCalledTimes(1)
    })

    test('guard: a module file (importClassified, module branch)', async () => {
        h.tauriFiles['/docs/a.risum'] = new Uint8Array([1, 2, 3])

        await answerImportCard(() => importOpenedFiles(['/docs/a.risum']))

        expect(h.modules).toHaveLength(1)
        expect(markUnsaved).toHaveBeenCalledTimes(1)
    })

    test('guard: a #import_module= link (characterURLImport)', async () => {
        setUrl(link('import_module', JSON.stringify({ name: 'inline module' })))

        await characterURLImport()

        expect(h.modules).toHaveLength(1)
        expect(markUnsaved).toHaveBeenCalledTimes(1)
    })

    test('guard: a #import_preset= link (characterURLImport)', async () => {
        setUrl(link('import_preset', '{"name":"inline"}'))

        await characterURLImport()

        expect(h.presets).toHaveLength(1)
        expect(markUnsaved).toHaveBeenCalledTimes(1)
    })
})

describe('a preset bundle preview the person cancelled', () => {
    // reproducer vs M17 (the cancelled result ignored): settings would open as after an import
    test('T-DECL: an opened file imports nothing further and leaves settings closed', async () => {
        h.tauriFiles['/docs/bundle.risup'] = enc.encode('{"name":"p"}')
        h.presetResult = { cancelled: true }
        vi.mocked(settingsOpen.set).mockClear()

        await answerImportCard(() => importOpenedFiles(['/docs/bundle.risup']))

        expect(h.presets).toHaveLength(1)
        expect(settingsOpen.set).not.toHaveBeenCalled()
    })

    test('T-DECL: a share link leaves settings closed', async () => {
        h.presetResult = { cancelled: true }
        vi.mocked(settingsOpen.set).mockClear()
        setUrl(link('import_preset', '{"name":"inline"}'))

        await characterURLImport()

        expect(settingsOpen.set).not.toHaveBeenCalled()
    })

    test('compatibility guard: an imported preset still opens settings', async () => {
        h.tauriFiles['/docs/a.risup'] = enc.encode('{"name":"p"}')
        vi.mocked(settingsOpen.set).mockClear()

        await answerImportCard(() => importOpenedFiles(['/docs/a.risup']))

        expect(settingsOpen.set).toHaveBeenCalledWith(true)
    })
})