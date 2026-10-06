/**
 * The crash-loop breaker of the V2.1 restore of every archived character,
 * across page lives: a count kept in `localStorage` under
 * `v21RestoreAllStrikes` survives a killed tab, and nothing else does.
 *
 * A page life is a fresh module graph (`vi.resetModules()` and a fresh import
 * of `plugins.svelte.ts`) over the same `localStorage` and a "saved file" held
 * by the test. A killed tab is a restore whose unit read never returns: the page
 * is abandoned with the count it recorded, and its pending read is let go only
 * when the test ends. Saving is modelled by copying the live plugin list into the
 * saved file.
 *
 * - Tripped (a count of 2) and turned off by the breaker, a user who turns the
 *   plugin back on starts again from a zero count: it takes two more
 *   interruptions, not one, for the breaker to trip again.
 * - A restore that ends after the user turned the plugin back on leaves a zero
 *   count, so one later interruption does not trip.
 *
 * `loadPlugins`, `togglePluginEnabled`, `loadV2Plugin`, `coldRestoreAll.ts` and
 * `coldCharacterRestore.ts` are real (the plugin script really runs); the cold
 * storage read, the alert module and the V3 plugin loader are mocks, so this
 * says nothing about native storage.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'
import { buildColdStub } from '../../process/coldCharacter'

//#region module mocks

const readColdStorageItemMock = vi.hoisted(() => vi.fn())
const loadV3PluginsMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
const notices = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        selectedCharID: writable(-1),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(null),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/database.svelte'), async () => {
    const { DBState: liveDBState } = await import('../../stores.svelte')
    return {
        getCurrentCharacter: vi.fn(),
        getDatabase: vi.fn(() => liveDBState.db),
        setDatabase: vi.fn((db: Database) => { liveDBState.db = db }),
        setDatabaseLite: vi.fn(),
        presetTemplate: { name: 'test-preset' },
        saveImage: vi.fn(),
        defaultSdDataFunc: vi.fn(() => ({})),
        getCharacterByIndex: vi.fn((index: number) => liveDBState.db.characters?.[index]),
        setCharacterByIndex: vi.fn((index: number, char: unknown) => {
            liveDBState.db.characters[index] = char as never
        }),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../alert'), () => {
    const show = (msg: string | Error) => { notices.texts.push(msg instanceof Error ? msg.message : String(msg)) }
    return {
        alertConfirm: vi.fn(async () => true),
        alertPluginConfirm: vi.fn(async () => true),
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
        waitAlert: vi.fn(async () => {}),
        alertAddCharacter: vi.fn(),
        alertSelect: vi.fn(),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../alert')
})

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    selectMultipleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    findCharacterbyId: vi.fn(),
    findCharacterIndexbyId: vi.fn(() => -1),
    getUserName: vi.fn(() => 'User'),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    changeChatTo: vi.fn(),
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    getFileSrc: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    requiresFullEncoderReload: { state: false },
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async (code: string) => ({ modifiedCode: code })),
}) as unknown as typeof import('../pluginSafety'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../apiV3/v3.svelte'), () => ({
    loadV3Plugins: loadV3PluginsMock,
}) as unknown as typeof import('../apiV3/v3.svelte'))

vi.mock(import('../apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../apiV3/transpiler'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../media'), () => ({
    getImageType: vi.fn(),
}) as unknown as typeof import('../../media'))

vi.mock(import('../../media/avatarThumb'), () => ({
    getAvatarThumbSrc: vi.fn(),
    isThumbEligible: vi.fn(() => false),
}) as unknown as typeof import('../../media/avatarThumb'))

vi.mock(import('../../process/inlayScreen'), () => ({
    updateInlayScreen: vi.fn((cha: unknown) => cha),
}) as unknown as typeof import('../../process/inlayScreen'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    parseMarkdownSafe: vi.fn(),
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    translateHTML: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../characterCards'), () => ({
    importCharacter: vi.fn(),
}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../pngChunk'), () => ({
    PngChunk: class {},
}) as unknown as typeof import('../../pngChunk'))

//#endregion

//#region fixtures

const STRIKES_KEY = 'v21RestoreAllStrikes'

type CharacterFixture = Database['characters'][number]

interface SavedFile {
    plugins: RisuPlugin[]
    characters: CharacterFixture[]
}

interface Page {
    loadPlugins: typeof import('../plugins.svelte').loadPlugins
    togglePluginEnabled: typeof import('../plugins.svelte').togglePluginEnabled
    live: { plugins: RisuPlugin[] }
}

const seenBy = globalThis as unknown as { __v21Runs?: number }

function fullCharacter(chaId: string, name: string): character {
    return { type: 'character', name, chaId, chatPage: 0, chats: [], lastInteraction: 5000 } as unknown as character
}

function stubOf(chaId: string, name: string): CharacterFixture {
    return buildColdStub(fullCharacter(chaId, name), `unit-${chaId}`, []) as unknown as CharacterFixture
}

function v21Plugin(name: string, enabled = true): RisuPlugin {
    return {
        name,
        script: 'globalThis.__v21Runs = (globalThis.__v21Runs || 0) + 1',
        version: '2.1',
        enabled,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

let saved: SavedFile = { plugins: [], characters: [] }

/** A new page life over the saved file: a fresh module graph, the same `localStorage`. */
async function openPage(): Promise<Page> {
    vi.resetModules()
    const stores = await import('../../stores.svelte')
    const pluginsModule = await import('../plugins.svelte')
    stores.DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: structuredClone(saved.plugins),
        pluginCustomStorage: {},
        characterOrder: saved.characters.map((c) => c.chaId),
        characters: structuredClone(saved.characters),
    } as unknown as Database
    return {
        loadPlugins: pluginsModule.loadPlugins,
        togglePluginEnabled: pluginsModule.togglePluginEnabled,
        live: stores.DBState.db as unknown as { plugins: RisuPlugin[] },
    }
}

/** The live plugin list reaches the saved file, as the next save would write it. */
function save(page: Page): void {
    saved.plugins = JSON.parse(JSON.stringify(page.live.plugins)) as RisuPlugin[]
}

interface Gate {
    release: () => void
}

/** Unit reads that are still waiting, across every page life of a test. */
const gates: Gate[] = []
/** The raw count at the start of each unit read. */
const countAtRead: (string | null)[] = []
/** Every call a test left running; they end when the gates are released. */
const leftRunning: Promise<unknown>[] = []

/** Every unit read waits for the test to release it, which only the end of the test does. */
function installHangingReader(): void {
    readColdStorageItemMock.mockImplementation(async () => {
        countAtRead.push(localStorage.getItem(STRIKES_KEY))
        await new Promise<void>((resolve) => { gates.push({ release: resolve }) })
        return { status: 'missing' }
    })
}

/** Unit reads that return at once with a character, so a restore ends. */
function installReturningReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        countAtRead.push(localStorage.getItem(STRIKES_KEY))
        const chaId = key.replace(/^unit-/, '')
        return { status: 'ok', value: { character: fullCharacter(chaId, `${chaId} name`) } }
    })
}

/** A call that has to end without a unit read fails with the reads that are waiting, instead of timing out silently. */
async function endsWithoutReading(work: Promise<unknown>, ms = 1000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'waiting'>((resolve) => { timer = setTimeout(() => resolve('waiting'), ms) })
    const result = await Promise.race([work.then(() => 'done' as const), timeout])
    clearTimeout(timer)
    expect(result, `the call did not end: ${gates.length} unit read(s) are waiting, so the restore ran instead of being skipped`).toBe('done')
}

async function untilReads(count: number): Promise<void> {
    await vi.waitFor(() => { expect(countAtRead.length).toBeGreaterThanOrEqual(count) }, { timeout: 1000, interval: 2 })
}

beforeEach(() => {
    localStorage.clear()
    notices.texts.length = 0
    countAtRead.length = 0
    gates.length = 0
    leftRunning.length = 0
    readColdStorageItemMock.mockReset()
    loadV3PluginsMock.mockClear()
    delete seenBy.__v21Runs
    saved = {
        plugins: [v21Plugin('Quill Bridge')],
        characters: [fullCharacter('alpha', 'Alpha Hero') as unknown as CharacterFixture, stubOf('beta', 'Beta Hero')],
    }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    // An abandoned page's restore must end before the next test, or its late
    // reset would write to the next test's storage.
    for (const gate of gates) {
        gate.release()
    }
    await Promise.allSettled(leftRunning)
    vi.restoreAllMocks()
})

//#endregion

describe('the restore-all breaker across page lives', () => {
    test('after the breaker trips and the user turns the plugin back on, two more interruptions trip it again', async () => {
        installHangingReader()
        localStorage.setItem(STRIKES_KEY, '2')

        // Life 1: the count is 2, so the plugin is switched off and nothing is read.
        let page = await openPage()
        await endsWithoutReading(page.loadPlugins())
        expect(page.live.plugins[0].enabled).toBe(false)
        expect(notices.texts).toHaveLength(1)
        expect(notices.texts[0]).toContain('Quill Bridge')
        expect(countAtRead).toEqual([])
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        save(page)

        // The user turns the plugin on; its restore starts from a zero count and the page dies at the first unit read.
        leftRunning.push(page.togglePluginEnabled(page.live.plugins[0]))
        await untilReads(1)
        expect(countAtRead).toEqual(['1'])
        expect(page.live.plugins[0].enabled).toBe(true)
        save(page)

        // Life 2: the count is 1, so the restore runs, records its start and the page dies again.
        page = await openPage()
        leftRunning.push(page.loadPlugins())
        await untilReads(2)
        expect(countAtRead).toEqual(['1', '2'])
        expect(page.live.plugins[0].enabled).toBe(true)
        expect(notices.texts).toHaveLength(1)

        // Life 3: the count is 2 again, so the breaker trips again.
        page = await openPage()
        await endsWithoutReading(page.loadPlugins())
        expect(countAtRead).toEqual(['1', '2'])
        expect(page.live.plugins[0].enabled).toBe(false)
        expect(notices.texts).toHaveLength(2)
        expect(notices.texts[1]).toContain('Quill Bridge')
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        expect(seenBy.__v21Runs).toBeUndefined()
    })

    test('a restore that ends after the user turned the plugin back on leaves a zero count, so one later interruption does not trip', async () => {
        localStorage.setItem(STRIKES_KEY, '2')

        // Life 1 trips and its switch-off is saved.
        installReturningReader()
        let page = await openPage()
        await endsWithoutReading(page.loadPlugins())
        expect(page.live.plugins[0].enabled).toBe(false)
        save(page)

        // The user turns the plugin on and its restore ends.
        await page.togglePluginEnabled(page.live.plugins[0])
        await vi.waitFor(() => { expect(seenBy.__v21Runs).toBe(1) })
        expect(page.live.plugins[0].enabled).toBe(true)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
        save(page)

        // Life 2 is interrupted once.
        installHangingReader()
        page = await openPage()
        leftRunning.push(page.loadPlugins())
        await vi.waitFor(() => { expect(gates.length).toBe(1) })
        expect(localStorage.getItem(STRIKES_KEY)).toBe('1')

        // Life 3 is not tripped: the count is 1.
        installReturningReader()
        const readsBefore = countAtRead.length
        page = await openPage()
        await page.loadPlugins()
        expect(countAtRead.slice(readsBefore)).toEqual(['2'])
        expect(page.live.plugins[0].enabled).toBe(true)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
    })
})
