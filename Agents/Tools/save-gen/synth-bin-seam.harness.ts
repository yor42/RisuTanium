/**
 * Profiling tooling: the app's own boot code run over the generated database (MC-471), with the verifier's whole-tree
 * comparison deciding. Companion of synth-bin.harness.ts, which holds the container, verifier and import checks.
 *
 * What runs for real (not parsed from source, not modelled):
 * - setDatabase (src/ts/storage/database.svelte.ts) after applyCharacterDefaults on every character slot and stub unit
 *   character. Mocks: derived from databaseSupaModelType.test.ts's set, with translator/presets and gui/colorscheme left real.
 * - updateLorebooks (src/ts/characters.ts) on every module lorebook and every character's global lore, and checkCharOrder
 *   (src/ts/globalApi.svelte.ts) on the database. Mocks: characters.trashCharacters.test.ts.
 * Each test requires the verifier's deepDiff between the logical tree before and after to be empty (a root key the app adds
 * is not a difference; the setDatabase test requires more than 20 of them, which proves the real setDatabase ran), and each
 * has a twin on a deliberately unnormalised copy that must differ, so an empty result cannot come from code that did not run.
 * The two mock sets conflict (the first mocks globalApi.svelte, the second database.svelte), so each test resets the module
 * registry and registers only its own set.
 * Mocks still in place in the setDatabase test: localforage, platform (web), util, globalApi.svelte, alert, process/memory/hypav3,
 * polyfill, plugin-fs, stores.svelte, model/modellist and rpack_js. translator/presets and gui/colorscheme are the real modules.
 * Mocks prove what the functions do to the tree, not what the native build does.
 *
 * Run (from the repo root) with ../vitest.harness.config.ts; the `*.harness.ts` suffix keeps it out of `pnpm test`.
 * SYNTH_BIN_SCRATCH, SYNTH_BIN_GEN_SCRIPT and SYNTH_BIN_VERIFY_SCRIPT work as in synth-bin.harness.ts.
 */
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HARNESS_DIR, '..', '..', '..')
const GEN_SCRIPT = process.env.SYNTH_BIN_GEN_SCRIPT ?? path.join(HARNESS_DIR, 'synth-bin-gen.mjs')
const VERIFY_SCRIPT = process.env.SYNTH_BIN_VERIFY_SCRIPT ?? path.join(HARNESS_DIR, 'synth-bin-verify.mjs')
const TIMEOUT_MS = 10 * 60 * 1000
// The verifier is a plain Node ES module, possibly a scratch copy outside the repository: Node's own require loads it, not
// the test runner's module graph (which does not serve files outside the repository).
const requireNative = createRequire(import.meta.url)

type Tree = Record<string, unknown>
interface TreeReport { differences: number, truncated: boolean, addedRootKeys: string[], sample: { path: string, kind: string }[] }
interface Verifier {
    inspectBin(binPath: string): { walk: { units: Map<string, unknown> }, db: Tree | null, tree: Tree | null, problems: string[] }
    resolveTree(db: Tree, units: Map<string, unknown>): { tree: Tree }
    deepDiff(expected: unknown, actual: unknown, show: number): TreeReport
}
interface BootCharacter { chaId: string, trashTime?: number, globalLore?: unknown[] }
interface BootDatabase extends Tree {
    characters: BootCharacter[]
    characterOrder: (string | { id: string, data: string[] })[]
    modules: { lorebook?: { bookVersion?: number }[] }[]
    botPresets: Record<string, unknown>[]
}

//#region module registrations
type Factory = () => unknown | Promise<unknown>
const asyncNoop = async () => {}

/** Every specifier either set mocks; one not in the set being applied is unregistered. */
const ALL_SPECIFIERS = [
    'localforage', 'src/ts/platform', 'src/ts/util', 'src/ts/globalApi.svelte', 'src/ts/alert', 'src/ts/gui/colorscheme',
    'src/ts/process/memory/hypav3', 'src/ts/translator/presets', 'src/ts/polyfill', '@tauri-apps/plugin-fs', 'src/ts/stores.svelte',
    'src/ts/model/modellist', 'src/ts/rpack/rpack_js.js', 'src/ts/storage/database.svelte', '@tauri-apps/api/core', '@tauri-apps/api/path',
    '@tauri-apps/plugin-shell', 'streamsaver', '@tauri-apps/api/webviewWindow', '@tauri-apps/plugin-http', '@tauri-apps/plugin-dialog',
    '@tauri-apps/api/event', 'src/ts/update', 'src/ts/plugins/plugins.svelte', 'src/ts/parser/parser.svelte', 'src/ts/characterCards',
    'src/ts/storage/dbChangeEffects.svelte', 'src/ts/storage/autoStorage', 'src/ts/gui/animation', 'src/ts/observer.svelte',
    'src/ts/gui/guisize', 'src/ts/hotkey', 'src/ts/process/modules', 'src/ts/process/coldstorage.svelte', 'src/ts/media',
    'src/ts/process/inlayScreen', 'src/ts/translator/translator', 'src/ts/process/index.svelte', 'src/ts/pngChunk', 'src/ts/media/avatarThumb',
]

const localforageMock: Factory = () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(asyncNoop), removeItem: vi.fn(asyncNoop) }) },
})

/** Derived from the mock set of src/ts/storage/tests/databaseSupaModelType.test.ts, which drives the real setDatabase, with translator/presets and gui/colorscheme left real. */
const SET_DATABASE_MOCKS: Record<string, Factory> = {
    'localforage': localforageMock,
    'src/ts/platform': () => ({ isTauri: false, isNodeServer: false }),
    'src/ts/util': () => ({
        checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
        decryptBuffer: vi.fn(async (d: unknown) => d),
        encryptBuffer: vi.fn(async (d: unknown) => d),
        selectSingleFile: vi.fn(async () => null),
    }),
    'src/ts/globalApi.svelte': () => ({
        downloadFile: vi.fn(asyncNoop),
        saveAsset: vi.fn(async () => ''),
        forageStorage: { getItem: vi.fn(async () => null), setItem: vi.fn(asyncNoop) },
    }),
    'src/ts/alert': () => ({ alertNormal: vi.fn() }),
    'src/ts/process/memory/hypav3': () => ({ createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })) }),
    'src/ts/polyfill': () => ({ safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))) }),
    '@tauri-apps/plugin-fs': () => ({
        writeFile: vi.fn(asyncNoop), exists: vi.fn(async () => false), mkdir: vi.fn(asyncNoop), readFile: vi.fn(async () => new Uint8Array()), BaseDirectory: { AppData: 0 },
    }),
    'src/ts/stores.svelte': () => ({ DBState: { db: {} as Tree }, selectedCharID: { subscribe: vi.fn(), set: vi.fn() } }),
    'src/ts/model/modellist': async () => {
        const types = await import('src/ts/model/types')
        return { LLMFlags: types.LLMFlags, LLMFormat: types.LLMFormat, LLMTokenizer: types.LLMTokenizer }
    },
    'src/ts/rpack/rpack_js.js': () => ({
        encodeRPack: vi.fn(async (data: Uint8Array) => data), decodeRPack: vi.fn(async (data: Uint8Array) => data),
    }),
}

/** The mock set of src/ts/characters.trashCharacters.test.ts, which runs the real characters.ts and globalApi.svelte.ts. */
const BOOT_RULES_MOCKS: Record<string, Factory> = {
    'localforage': localforageMock,
    'src/ts/platform': () => ({ isTauri: false, isNodeServer: false, isIOS: () => false }),
    'src/ts/storage/database.svelte': () => ({
        getDatabase: vi.fn(() => (globalThis as unknown as { __testDBState: unknown }).__testDBState),
        setDatabase: vi.fn(), presetTemplate: { name: 'test-preset' }, defaultSdDataFunc: vi.fn(() => ({})), saveImage: vi.fn(),
        getCharacterByIndex: vi.fn(), setCharacterByIndex: vi.fn(), appVer: 'test', appSubVer: 'test', getCurrentCharacter: vi.fn(),
    }),
    'src/ts/stores.svelte': async () => {
        const { writable } = await import('svelte/store')
        return {
            DBState: { db: {} as Tree }, selectedCharID: writable(-1), selIdState: { selId: -1 }, alertStore: writable({ type: 'none', msg: '' }),
            MobileGUI: writable(false), botMakerMode: writable(false), loadedStore: writable(false), LoadingStatusState: { text: '' },
            ReloadGUIPointer: writable(0), bodyIntercepterStore: writable(null), savingStoppedReason: writable(null), CharEmotion: writable({}),
            MobileGUIStack: writable([]), OpenRealmStore: writable(null),
        }
    },
    'src/ts/alert': async () => {
        const { writable } = await import('svelte/store')
        return {
            alertClear: vi.fn(), alertConfirm: vi.fn(async () => true), alertError: vi.fn(), alertWait: vi.fn(), alertMd: vi.fn(), alertNormal: vi.fn(),
            alertSelect: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(), alertNormalWait: vi.fn(), alertAddCharacter: vi.fn(),
            alertStore: writable({ type: 'none', msg: '' }), waitAlert: vi.fn(asyncNoop),
        }
    },
    'src/ts/util': () => ({
        changeFullscreen: vi.fn(), checkNullish: vi.fn((v: unknown) => v === null || v === undefined), sleep: vi.fn(asyncNoop), sleepForever: vi.fn(asyncNoop),
        findCharacterbyId: vi.fn(), findCharacterIndexbyId: vi.fn(() => -1), getUserName: vi.fn(() => 'User'), selectMultipleFile: vi.fn(), selectSingleFile: vi.fn(),
    }),
    '@tauri-apps/api/core': () => ({ convertFileSrc: vi.fn((p: string) => p), invoke: vi.fn(async () => undefined) }),
    '@tauri-apps/api/path': () => ({
        appDataDir: vi.fn(async () => '/appdata'), join: vi.fn(async (...p: string[]) => p.join('/')), basename: vi.fn(async (p: string) => p.split('/').pop()),
    }),
    '@tauri-apps/plugin-shell': () => ({ open: vi.fn(asyncNoop) }),
    'streamsaver': () => ({ default: {} }),
    '@tauri-apps/api/webviewWindow': () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }),
    '@tauri-apps/plugin-fs': () => ({
        BaseDirectory: { AppData: 0, Download: 1 }, writeFile: vi.fn(asyncNoop), readFile: vi.fn(async () => new Uint8Array()), exists: vi.fn(async () => false),
        mkdir: vi.fn(asyncNoop), readDir: vi.fn(async () => []), remove: vi.fn(asyncNoop),
    }),
    '@tauri-apps/plugin-http': () => ({ fetch: vi.fn(async () => new Response(null, { status: 404 })) }),
    '@tauri-apps/plugin-dialog': () => ({ save: vi.fn(async () => null) }),
    '@tauri-apps/api/event': () => ({ listen: vi.fn(async () => vi.fn()) }),
    'src/ts/update': () => ({ checkRisuUpdate: vi.fn(asyncNoop) }),
    'src/ts/plugins/plugins.svelte': () => ({ loadPlugins: vi.fn(asyncNoop) }),
    'src/ts/parser/parser.svelte': () => ({ hasher: vi.fn((s: string) => s), parseMarkdownSafe: vi.fn() }),
    'src/ts/characterCards': () => ({ characterURLImport: vi.fn(), importCharacter: vi.fn(), hubURL: 'https://example.invalid' }),
    'src/ts/storage/dbChangeEffects.svelte': () => ({ registerDbChangeEffects: vi.fn() }),
    'src/ts/storage/autoStorage': () => ({
        AutoStorage: class { getItem = vi.fn(async (_key: string) => null as unknown); setItem = vi.fn(async () => null); keys = vi.fn(async () => [] as string[]); removeItem = vi.fn(asyncNoop) },
    }),
    'src/ts/gui/animation': () => ({ updateAnimationSpeed: vi.fn() }),
    'src/ts/gui/colorscheme': () => ({ updateColorScheme: vi.fn(), updateTextThemeAndCSS: vi.fn() }),
    'src/ts/observer.svelte': () => ({ startObserveDom: vi.fn() }),
    'src/ts/gui/guisize': () => ({ updateGuisize: vi.fn() }),
    'src/ts/hotkey': () => ({ initMobileGesture: vi.fn() }),
    'src/ts/process/modules': () => ({ moduleUpdate: vi.fn(asyncNoop) }),
    'src/ts/process/coldstorage.svelte': () => ({ getColdStorageItem: vi.fn() }),
    'src/ts/media': () => ({ getImageType: vi.fn() }),
    'src/ts/process/inlayScreen': () => ({ updateInlayScreen: vi.fn() }),
    'src/ts/translator/translator': () => ({ translateHTML: vi.fn() }),
    'src/ts/process/index.svelte': async () => {
        const { writable } = await import('svelte/store')
        return { doingChat: writable(false) }
    },
    'src/ts/pngChunk': () => ({ PngChunk: class {} }),
    'src/ts/media/avatarThumb': () => ({ getAvatarThumbSrc: vi.fn(), isThumbEligible: vi.fn(() => false) }),
}

/** A fresh module registry holding exactly the mocks of `set`. */
function useMocks(set: Record<string, Factory>): void {
    vi.resetModules()
    for (const specifier of ALL_SPECIFIERS) {
        if (specifier in set) vi.doMock(specifier, set[specifier])
        else vi.doUnmock(specifier)
    }
}
//#endregion

let scratch = ''
let binA = ''
let verifier: Verifier

beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(process.env.SYNTH_BIN_SCRATCH ?? os.tmpdir(), 'risu-synth-seam-'))
    const rel = path.relative(REPO_ROOT, scratch)
    const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
    if (!outside) throw new Error(`scratch ${scratch} is inside the repository`)
    binA = path.join(scratch, 'a.bin')
    const result = spawnSync(process.execPath, ['--max-old-space-size=4096', GEN_SCRIPT, '--out', binA, '--seed', '1337', '--scale', 'small'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`generator failed (${result.status}): ${result.stderr}`)
    verifier = requireNative(VERIFY_SCRIPT) as Verifier
}, TIMEOUT_MS)

afterAll(() => {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true })
})

interface Loaded { db: BootDatabase, units: Map<string, unknown> }

/** The generated file decoded, optionally changed before the logical tree is taken (the twins use that). */
function load(prepare?: (loaded: Loaded) => void, bin = binA): { loaded: Loaded, expected: Tree } {
    const inspected = verifier.inspectBin(bin)
    expect(inspected.problems).toEqual([])
    const loaded: Loaded = { db: inspected.db as BootDatabase, units: inspected.walk.units }
    prepare?.(loaded)
    // the verifier's tree shares nested objects with the decoded database, which the app's code changes in place
    return { loaded, expected: structuredClone(verifier.resolveTree(loaded.db, loaded.units).tree) }
}

/** Every character the boot code reaches: the slots of the database and the characters in the stub units. */
function charactersOf({ db, units }: Loaded): BootCharacter[] {
    const held = [...units.values()].flatMap((unit) => ((unit as { character?: BootCharacter }).character ? [(unit as { character: BootCharacter }).character] : []))
    return [...db.characters, ...held]
}

describe('the app\'s boot code over the generated database', () => {
    test('setDatabase changes nothing the verifier compares, and adds only root defaults', async () => {
        useMocks(SET_DATABASE_MOCKS)
        const { setDatabase } = await import('src/ts/storage/database.svelte')
        const { applyCharacterDefaults } = await import('src/ts/storage/characterDefaults')
        type AppDatabase = Parameters<typeof setDatabase>[0]
        type AppCharacter = Parameters<typeof applyCharacterDefaults>[0]

        const run = (prepare?: (loaded: Loaded) => void) => {
            const { loaded, expected } = load(prepare)
            for (const character of charactersOf(loaded)) applyCharacterDefaults(character as unknown as AppCharacter)
            setDatabase(loaded.db as unknown as AppDatabase)
            return verifier.deepDiff(expected, verifier.resolveTree(loaded.db, loaded.units).tree, 20)
        }

        const diff = run()
        expect(diff.sample).toEqual([])
        expect(diff.differences).toBe(0)
        // setDatabase really ran: it filled root defaults the generator never wrote
        expect(diff.addedRootKeys.length).toBeGreaterThan(20)
        // and the real translator/presets and gui/colorscheme ran, since they are the modules that write these two keys
        expect(diff.addedRootKeys).toContain('translatorPresets')
        expect(diff.addedRootKeys).toContain('colorScheme')

        // twin: presets without the localNetwork fields are filled in by the real setDatabase, which the diff must see
        const twin = run(({ db }) => { for (const preset of db.botPresets) { delete preset.localNetworkMode; delete preset.localNetworkTimeoutSec } })
        expect(twin.sample.some((entry) => entry.path.startsWith('$.botPresets[0].localNetwork') && entry.kind === 'extra')).toBe(true)
    }, TIMEOUT_MS)

    test('setDatabase keeps the device scale\'s provider settings at the root and in the active preset, and its sub-task features off', async () => {
        const binDevice = path.join(scratch, 'device.bin')
        const generated = spawnSync(process.execPath, ['--max-old-space-size=4096', GEN_SCRIPT, '--out', binDevice, '--seed', '1337', '--scale', 'device'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
        if (generated.error) throw generated.error
        expect(generated.status, generated.stderr).toBe(0)

        useMocks(SET_DATABASE_MOCKS)
        const { setDatabase } = await import('src/ts/storage/database.svelte')
        const { applyCharacterDefaults } = await import('src/ts/storage/characterDefaults')
        type AppDatabase = Parameters<typeof setDatabase>[0]
        type AppCharacter = Parameters<typeof applyCharacterDefaults>[0]

        const run = (prepare?: (loaded: Loaded) => void) => {
            const { loaded, expected } = load(prepare, binDevice)
            for (const character of charactersOf(loaded)) applyCharacterDefaults(character as unknown as AppCharacter)
            setDatabase(loaded.db as unknown as AppDatabase)
            return { loaded, diff: verifier.deepDiff(expected, verifier.resolveTree(loaded.db, loaded.units).tree, 20) }
        }

        // what the app must still hold after setDatabase: the root settings, and the active preset's copies of the provider ones
        const providerFields = {
            aiModel: 'reverse_proxy', subModel: 'reverse_proxy', forceReplaceUrl: 'http://127.0.0.1:6250/v1/chat/completions',
            customProxyRequestModel: 'mock-model', customAPIFormat: 0, autofillRequestUrl: true, proxyKey: 'mock-key', useStreaming: false,
        }
        const rootOnlyFields = {
            usePlainFetch: false, dynamicModelRegistry: false,
            // sub-task features: auto-suggest, auto-translate, HypaV3, SupaMemory, embeddings (HypaMemory and the emotion embedding), image generation, TTS
            useAutoSuggestions: false, autoTranslate: false, useAutoTranslateInput: false, hypaV3: false, hypaMemory: false, supaModelType: 'none',
            emotionProcesser: 'submodel', hanuraiEnable: false, sdProvider: '', ttsAutoSpeech: false,
        }
        const { loaded, diff } = run()
        expect(diff.sample).toEqual([])
        expect(diff.differences).toBe(0)
        expect(diff.addedRootKeys.length).toBeGreaterThan(20)
        for (const [key, value] of Object.entries({ ...providerFields, ...rootOnlyFields })) expect(loaded.db[key], `root ${key}`).toBe(value)
        const preset = loaded.db.botPresets[loaded.db.botPresetsId as number]
        for (const [key, value] of Object.entries(providerFields)) expect(preset[key], `preset ${key}`).toBe(value)
        // the root-only fields are not mirrored into the preset
        for (const key of Object.keys(rootOnlyFields)) expect(Object.hasOwn(preset, key), `preset ${key}`).toBe(false)
        // the device profile has no stubs, groups, folders or trash
        expect(loaded.db.characters.some((character) => character.trashTime !== undefined)).toBe(false)
        expect(loaded.db.characterOrder.every((item) => typeof item === 'string')).toBe(true)

        // twin: without the request-model field the real setDatabase fills the empty default, so the value checks above can fail
        const twin = run(({ db }) => { delete db.customProxyRequestModel; delete db.aiModel })
        expect(twin.loaded.db.customProxyRequestModel).toBe('')
        expect(twin.loaded.db.aiModel).not.toBe('reverse_proxy')
    }, TIMEOUT_MS)

    test('updateLorebooks and checkCharOrder change nothing the verifier compares', async () => {
        useMocks(BOOT_RULES_MOCKS)
        const { updateLorebooks } = await import('src/ts/characters')
        const { checkCharOrder } = await import('src/ts/globalApi.svelte')
        type AppLore = Parameters<typeof updateLorebooks>[0]
        type AppDatabase = Parameters<typeof checkCharOrder>[0]

        const run = (prepare?: (loaded: Loaded) => void) => {
            const { loaded, expected } = load(prepare)
            for (const module of loaded.db.modules) if (Array.isArray(module.lorebook)) module.lorebook = updateLorebooks(module.lorebook as unknown as AppLore) as unknown as typeof module.lorebook
            for (const character of charactersOf(loaded)) if (Array.isArray(character.globalLore)) character.globalLore = updateLorebooks(character.globalLore as unknown as AppLore)
            checkCharOrder(loaded.db as unknown as AppDatabase)
            return verifier.deepDiff(expected, verifier.resolveTree(loaded.db, loaded.units).tree, 20)
        }

        const diff = run()
        expect(diff.sample).toEqual([])
        expect(diff.differences).toBe(0)

        // twin: a lorebook entry without bookVersion, and a trashed character put in the order
        const twin = run(({ db }) => {
            delete db.modules[0].lorebook![0].bookVersion
            db.characterOrder.push(db.characters.find((character) => character.trashTime !== undefined)!.chaId)
        })
        const paths = twin.sample.map((entry) => entry.path)
        expect(paths.some((p) => p.startsWith('$.modules[0].lorebook[0]'))).toBe(true)
        expect(paths.some((p) => p.startsWith('$.characterOrder'))).toBe(true)
    }, TIMEOUT_MS)
})
