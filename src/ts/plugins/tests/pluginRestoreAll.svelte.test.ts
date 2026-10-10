/**
 * `loadPlugins` (`plugins.svelte.ts`) and archived characters ("stubs":
 * placeholders whose full data lives in a cold-storage unit).
 *
 * A V2.1 plugin's code reads and writes the live database directly, so it must
 * never see a stub. Before any enabled V2.1 plugin's code runs, every stub in
 * `DBState.db.characters` is restored from its unit, on every call of
 * `loadPlugins` (boot, the plugin toggle, a plugin calling `loadPlugins`):
 * - one unit at a time, so only one archived character is in flight beyond
 *   those already installed;
 * - a restored character keeps the newer `lastInteraction` of stub and unit;
 * - a stub whose unit cannot be used stays a stub, the plugin still runs, and
 *   the user gets one notice naming exactly those characters;
 * - nothing is restored, and nothing is shown, when no enabled V2.1 plugin
 *   exists (V2.0 and V3 plugins and disabled V2.1 plugins do not trigger it)
 *   or when no stub is left.
 *
 * The crash-loop breaker of that restore keeps a count in `localStorage` under
 * `v21RestoreAllStrikes` (these tests read and write the raw key):
 * - the count goes up by one before the first unit is read and back to 0 when
 *   the restore loop ends, however it ends, so only a restore that never ends
 *   (a killed tab) leaves a strike behind;
 * - restores that overlap in one page share one start and one reset;
 * - a profile without an enabled V2.1 plugin, and a restore with no stub to
 *   read, never touch the count;
 * - storage that cannot be read or written, and a stored value that is not a
 *   count, let the restore run uncounted;
 * - the plugin toggle (`togglePluginEnabled`) clears the count when it turns a
 *   V2.1 plugin on, before `loadPlugins` reads it;
 * - the archive pass's own `archivePass*` records and this count are
 *   independent.
 *
 * Drives the REAL `loadPlugins` / `loadV2Plugin` (the plugin script really
 * runs), `coldRestoreAll.ts`, `coldCharacter.ts` and
 * `coldCharacterRestore.ts`. The cold-storage read is a mock
 * (`readColdStorageItem`); it says nothing about the native backends. The V3
 * plugin loader is a mock. `coldCharacterRestore.ts` is wrapped so a test can
 * replace `restoreColdCharacter`, to throw inside the restore loop or to hold
 * overlapping restores open; tests that do not replace it call the real
 * function.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const readColdStorageItemMock = vi.hoisted(() => vi.fn())
const loadV3PluginsMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
/**
 * Every text shown to the user, except progress notices, and the raw
 * `v21RestoreAllStrikes` value at the moment each of them was shown.
 */
const notices = vi.hoisted(() => ({ texts: [] as string[], progress: [] as string[], countAtNotice: [] as (string | null)[] }))
const restoreColdCharacterMock = vi.hoisted(() => vi.fn())
const realRestore = vi.hoisted(() => ({ fn: null as null | ((...args: unknown[]) => unknown) }))

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
    const show = (msg: string | Error) => {
        notices.texts.push(msg instanceof Error ? msg.message : String(msg))
        try {
            notices.countAtNotice.push(localStorage.getItem('v21RestoreAllStrikes'))
        } catch (error) {
            notices.countAtNotice.push('unreadable')
        }
    }
    return {
        alertConfirm: vi.fn(async () => true),
        alertPluginConfirm: vi.fn(async () => true),
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn((msg: string) => { notices.progress.push(String(msg)); return {} }),
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

vi.mock(import('../../process/coldCharacterRestore'), async (importOriginal) => {
    const actual = await importOriginal()
    realRestore.fn = actual.restoreColdCharacter as unknown as (...args: unknown[]) => unknown
    return { ...actual, restoreColdCharacter: restoreColdCharacterMock } as unknown as typeof import('../../process/coldCharacterRestore')
})

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

import { loadPlugins, togglePluginEnabled } from '../plugins.svelte'
import { DBState } from '../../stores.svelte'
import { buildColdStub } from '../../process/coldCharacter'
import { clearArchiveMemo } from '../../storage/bootArchiveMemo'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

interface Seen {
    chaId: string
    cold: boolean
}

const seenBy = globalThis as unknown as { __v21Seen?: Seen[], __v21Runs?: number }

function fullCharacter(chaId: string, name = `${chaId} name`): character {
    return {
        type: 'character',
        name,
        chaId,
        chatPage: 0,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: `${chaId} description`,
        globalLore: [],
        newGenData: true,
        chats: [{ id: `${chaId}-chat`, message: [{ role: 'user', data: 'Hi', time: 1 }], note: '', name: 'Chat 1', localLore: [] }],
    } as unknown as character
}

function stubOf(chaId: string, name = `${chaId} name`): CharacterFixture {
    return buildColdStub(fullCharacter(chaId, name), `unit-${chaId}`, []) as unknown as CharacterFixture
}

const units = new Map<string, unknown>()

/** Gives the stub's unit its full character. A stub without one has a missing unit. */
function putUnit(chaId: string, name = `${chaId} name`): void {
    units.set(`unit-${chaId}`, fullCharacter(chaId, name))
}

let inFlight = 0
let maxInFlight = 0

const STRIKES_KEY = 'v21RestoreAllStrikes'

/** The raw `v21RestoreAllStrikes` value at the start of each unit read. */
const countAtRead: (string | null)[] = []

/** The raw count; a storage that throws on the read answers `'unreadable'`. */
function rawCount(): string | null {
    try {
        return localStorage.getItem(STRIKES_KEY)
    } catch (error) {
        return 'unreadable'
    }
}

/** The count as a number; an absent key is 0. */
function strikes(): number {
    const raw = rawCount()
    return raw === null ? 0 : Number(raw)
}

function installUnitReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        countAtRead.push(rawCount())
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
            await new Promise((resolve) => setTimeout(resolve, 0))
            const stored = units.get(key)
            return stored ? { status: 'ok', value: { character: structuredClone(stored) } } : { status: 'missing' }
        } finally {
            inFlight--
        }
    })
}

const RECORDING_SCRIPT = `
globalThis.__v21Runs = (globalThis.__v21Runs || 0) + 1
globalThis.__v21Seen = Risuai.getDatabase().characters.map((c) => ({ chaId: c.chaId, cold: !!c.coldstorage }))
`

function plugin(name: string, version: RisuPlugin['version'], enabled = true, script = RECORDING_SCRIPT): RisuPlugin {
    return { name, script, version, enabled, arguments: {}, realArg: {}, customLink: [], argMeta: {} }
}

function installDb(characters: CharacterFixture[], plugins: RisuPlugin[]): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins,
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
    } as unknown as Database
}

function liveOf(chaId: string): ColdCharacter {
    return DBState.db.characters.find((c: CharacterFixture) => c.chaId === chaId) as unknown as ColdCharacter
}

function anyNotice(): boolean {
    return notices.texts.length > 0 || notices.progress.length > 0
}

interface Gate {
    promise: Promise<void>
    release: () => void
}

/** Every unit read a test gated and has not yet let through. */
const gatedReads: Gate[] = []
/** Every `loadPlugins` or toggle call a test left running while its reads were gated. */
const leftRunning: Promise<unknown>[] = []

/**
 * Makes every unit read wait until the test releases its gate, so a restore can
 * be observed while it is in progress (the state a killed tab would leave).
 */
function installGatedReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        countAtRead.push(rawCount())
        let release: () => void = () => {}
        const promise = new Promise<void>((resolve) => { release = resolve })
        gatedReads.push({ promise, release })
        await promise
        const stored = units.get(key)
        return stored ? { status: 'ok', value: { character: structuredClone(stored) } } : { status: 'missing' }
    })
}

/**
 * Makes every `restoreColdCharacter` call wait until the test releases its
 * gate. Two restore-all calls in one page can then be in flight at once; the real
 * function joins a second request for a stub that is already being restored.
 */
function installGatedRestore(): void {
    restoreColdCharacterMock.mockImplementation(async (holder: unknown) => {
        countAtRead.push(rawCount())
        let release: () => void = () => {}
        const promise = new Promise<void>((resolve) => { release = resolve })
        gatedReads.push({ promise, release })
        await promise
        return { status: 'restored', character: holder, installedHere: false }
    })
}

async function untilGatedReads(count: number): Promise<void> {
    await vi.waitFor(() => { expect(gatedReads.length).toBeGreaterThanOrEqual(count) }, { timeout: 1000, interval: 2 })
}

/** Watches reads, writes and removals of the raw count key on the `localStorage` instance. */
function watchStrikesKey() {
    const realGet = localStorage.getItem.bind(localStorage)
    const realSet = localStorage.setItem.bind(localStorage)
    const realRemove = localStorage.removeItem.bind(localStorage)
    const reads: string[] = []
    const writes: string[] = []
    const removals: string[] = []
    const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
        if (key === STRIKES_KEY) { reads.push(key) }
        return realGet(key)
    })
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
        if (key === STRIKES_KEY) { writes.push(value) }
        realSet(key, value)
    })
    const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
        if (key === STRIKES_KEY) { removals.push(key) }
        realRemove(key)
    })
    return {
        reads,
        writes,
        removals,
        // An instance spy outlives `vi.restoreAllMocks()`, so every test that installs one restores it here.
        stop() {
            getSpy.mockRestore()
            setSpy.mockRestore()
            removeSpy.mockRestore()
        },
    }
}

beforeEach(() => {
    units.clear()
    localStorage.clear()
    notices.texts.length = 0
    notices.progress.length = 0
    notices.countAtNotice.length = 0
    countAtRead.length = 0
    gatedReads.length = 0
    leftRunning.length = 0
    readColdStorageItemMock.mockReset()
    restoreColdCharacterMock.mockReset().mockImplementation((...args: unknown[]) => realRestore.fn?.(...args))
    loadV3PluginsMock.mockClear()
    inFlight = 0
    maxInFlight = 0
    installUnitReader()
    delete seenBy.__v21Seen
    delete seenBy.__v21Runs
    delete (globalThis as unknown as { __countAtRun?: string | null }).__countAtRun
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    // A restore a test left waiting must end before the next test, or its late
    // reset would write to the next test's storage.
    for (const gate of gatedReads) {
        gate.release()
    }
    await Promise.allSettled(leftRunning)
    vi.restoreAllMocks()
})

//#endregion

describe('loadPlugins with an enabled V2.1 plugin restores every archived character first', () => {
    test('the plugin sees no stub, every stub is full afterwards and each keeps the newer of stub and unit lastInteraction, one unit read at a time', async () => {
        putUnit('beta')
        putUnit('gamma')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta'), stubOf('gamma')], [plugin('legacy', '2.1')])

        await loadPlugins()

        expect(seenBy.__v21Runs).toBe(1)
        expect(seenBy.__v21Seen).toEqual([
            { chaId: 'alpha', cold: false },
            { chaId: 'beta', cold: false },
            { chaId: 'gamma', cold: false },
        ])
        expect(DBState.db.characters.filter((c: CharacterFixture) => (c as unknown as ColdCharacter).coldstorage)).toHaveLength(0)
        expect(liveOf('beta').desc).toBe('beta description')
        expect(liveOf('gamma').desc).toBe('gamma description')
        expect(liveOf('beta').lastInteraction).toBe(5000)
        expect(liveOf('gamma').lastInteraction).toBe(5000)
        expect(readColdStorageItemMock).toHaveBeenCalledTimes(2)
        expect(maxInFlight).toBe(1)
    })

    test('a stub whose unit is missing stays, the plugin still runs, and one notice names that character and no other', async () => {
        putUnit('beta', 'Beta Hero')
        putUnit('delta', 'Delta Hero')
        installDb([fullCharacter('alpha', 'Alpha Hero') as unknown as CharacterFixture, stubOf('beta', 'Beta Hero'), stubOf('gamma', 'Lost Soul'), stubOf('delta', 'Delta Hero')], [plugin('legacy', '2.1')])

        await loadPlugins()

        expect(seenBy.__v21Runs).toBe(1)
        expect(liveOf('gamma').coldstorage).toBe('unit-gamma')
        expect(liveOf('beta').coldstorage).toBeUndefined()
        expect(liveOf('delta').coldstorage).toBeUndefined()
        expect(notices.texts).toHaveLength(1)
        expect(notices.texts[0]).toContain('Lost Soul')
        expect(notices.texts[0]).not.toContain('Beta Hero')
        expect(notices.texts[0]).not.toContain('Delta Hero')
        expect(notices.texts[0]).not.toContain('Alpha Hero')
    })

    test('one notice names every character whose unit could not be restored', async () => {
        putUnit('beta')
        installDb([stubOf('alpha', 'Lost Alpha'), stubOf('beta', 'Beta Hero'), stubOf('gamma', 'Lost Gamma')], [plugin('legacy', '2.1')])

        await loadPlugins()

        expect(seenBy.__v21Runs).toBe(1)
        expect(notices.texts).toHaveLength(1)
        expect(notices.texts[0]).toContain('Lost Alpha')
        expect(notices.texts[0]).toContain('Lost Gamma')
        expect(notices.texts[0]).not.toContain('Beta Hero')
    })

    test('a later loadPlugins call restores a stub that appeared since, before the plugin runs again', async () => {
        installDb([fullCharacter('alpha') as unknown as CharacterFixture], [plugin('legacy', '2.1')])
        await loadPlugins()
        expect(seenBy.__v21Runs).toBe(1)
        putUnit('beta')
        DBState.db.characters.push(stubOf('beta'))

        await loadPlugins()

        expect(seenBy.__v21Runs).toBe(2)
        expect(seenBy.__v21Seen).toEqual([
            { chaId: 'alpha', cold: false },
            { chaId: 'beta', cold: false },
        ])
        expect(liveOf('beta').desc).toBe('beta description')
    })

    test('guard: with no stub in the list a V2.1 plugin runs, nothing is read from cold storage and nothing is shown, on every call', async () => {
        installDb([fullCharacter('alpha') as unknown as CharacterFixture], [plugin('legacy', '2.1')])

        await loadPlugins()
        await loadPlugins()

        expect(seenBy.__v21Runs).toBe(2)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(anyNotice()).toBe(false)
    })
})

describe('loadPlugins without an enabled V2.1 plugin leaves archived characters alone', () => {
    test('guard: an enabled V2.0 plugin and an enabled V3 plugin restore nothing and show nothing', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('removed-v2', 2), plugin('modern', '3.0', true, '')])

        await loadPlugins()

        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(liveOf('beta').coldstorage).toBe('unit-beta')
        expect(anyNotice()).toBe(false)
        expect(loadV3PluginsMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a disabled V2.1 plugin restores nothing and does not run', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1', false)])

        await loadPlugins()

        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(liveOf('beta').coldstorage).toBe('unit-beta')
        expect(seenBy.__v21Runs).toBeUndefined()
        expect(anyNotice()).toBe(false)
    })
})

describe('the restore-all count records a start before the first unit read and resets when the restore loop ends', () => {
    test('with the count absent, every unit read sees a count of 1 and the count is 0 once the plugin has loaded', async () => {
        putUnit('beta')
        putUnit('gamma')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta'), stubOf('gamma')], [plugin('legacy', '2.1')])

        await loadPlugins()

        expect(countAtRead).toEqual(['1', '1'])
        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
        expect(seenBy.__v21Runs).toBe(1)
        expect(DBState.db.plugins[0].enabled).toBe(true)
    })

    test('with a count of 1 from an earlier interruption, the restore runs, its reads see 2, and the count is 0 after', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        localStorage.setItem(STRIKES_KEY, '1')

        await loadPlugins()

        expect(countAtRead).toEqual(['2'])
        expect(strikes()).toBe(0)
        expect(seenBy.__v21Runs).toBe(1)
        expect(liveOf('beta').coldstorage).toBeUndefined()
        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(anyNotice()).toBe(false)
    })

    test('the count is already 0 when the plugin code runs', async () => {
        putUnit('beta')
        const script = `globalThis.__countAtRun = localStorage.getItem('${STRIKES_KEY}')`
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1', true, script)])

        await loadPlugins()

        expect((globalThis as unknown as { __countAtRun?: string | null }).__countAtRun).toBe('0')
    })

    test('the count stays 1 while a unit read is still waiting and is 0 once it returns', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        installGatedReader()

        const run = loadPlugins()
        leftRunning.push(run)
        await untilGatedReads(1)

        expect(localStorage.getItem(STRIKES_KEY)).toBe('1')
        expect(seenBy.__v21Runs).toBeUndefined()

        gatedReads[0].release()
        await run

        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
        expect(seenBy.__v21Runs).toBe(1)
    })

    test('two restores one after the other each record their own start from zero', async () => {
        putUnit('beta')
        putUnit('gamma')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        await loadPlugins()
        DBState.db.characters.push(stubOf('gamma'))

        await loadPlugins()

        expect(countAtRead).toEqual(['1', '1'])
        expect(strikes()).toBe(0)
        expect(seenBy.__v21Runs).toBe(2)
    })

    test.each([
        ['the first to start ends first', 0, 1],
        ['the second to start ends first', 1, 0],
    ] as const)('two overlapping restores share one start and the count returns to 0 only when the last one ends: %s', async (_label, endsFirst, endsLast) => {
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        installGatedRestore()

        const calls: Promise<void>[] = []
        calls.push(loadPlugins())
        await untilGatedReads(1)
        calls.push(loadPlugins())
        await untilGatedReads(2)
        leftRunning.push(...calls)

        expect(countAtRead).toEqual(['1', '1'])
        expect(strikes()).toBe(1)

        gatedReads[endsFirst].release()
        await calls[endsFirst]
        expect(strikes()).toBe(1)

        gatedReads[endsLast].release()
        await calls[endsLast]
        expect(strikes()).toBe(0)
    })
})

describe('a restore loop that throws', () => {
    test('records the start before the unit read that throws', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta', 'Beta Hero')], [plugin('legacy', '2.1')])
        let seenWhenThrown: string | null = 'not called'
        restoreColdCharacterMock.mockImplementationOnce(() => {
            seenWhenThrown = rawCount()
            throw new Error('restoring blew up')
        })

        await loadPlugins()

        expect(seenWhenThrown).toBe('1')
    })

    test('guard: the count is 0 when the catch-path notice appears and after, because a restore that throws and is caught is not a strike', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta', 'Beta Hero')], [plugin('legacy', '2.1')])
        restoreColdCharacterMock.mockImplementationOnce(() => { throw new Error('restoring blew up') })

        await loadPlugins()

        expect(notices.texts).toHaveLength(1)
        expect(notices.texts[0]).toContain('Beta Hero')
        expect(Number(notices.countAtNotice[0] ?? 0)).toBe(0)
        expect(strikes()).toBe(0)
        expect(seenBy.__v21Runs).toBe(1)
        expect(DBState.db.plugins[0].enabled).toBe(true)
    })
})

describe('loadPlugins never touches the restore-all count when there is nothing to count', () => {
    test('guard: with no stub in the list a V2.1 plugin stays on at a count of 2, with no notice and no change to the count', async () => {
        installDb([fullCharacter('alpha') as unknown as CharacterFixture], [plugin('legacy', '2.1')])
        localStorage.setItem(STRIKES_KEY, '2')
        const watch = watchStrikesKey()
        try {
            await loadPlugins()

            expect(watch.reads).toEqual([])
            expect(watch.writes).toEqual([])
            expect(watch.removals).toEqual([])
        } finally {
            watch.stop()
        }
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(seenBy.__v21Runs).toBe(1)
        expect(anyNotice()).toBe(false)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })

    test.each([
        ['only an enabled V2.0 plugin', () => [plugin('removed-v2', 2)]],
        ['only an enabled V3 plugin', () => [plugin('modern', '3.0', true, '')]],
        ['only a disabled V2.1 plugin', () => [plugin('legacy', '2.1', false)]],
        ['no plugin', () => []],
    ] as const)('guard: with %s and an archived character the count is neither read nor written, even at 2', async (_label, makePlugins) => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], makePlugins())
        localStorage.setItem(STRIKES_KEY, '2')
        const watch = watchStrikesKey()
        try {
            await loadPlugins()

            expect(watch.reads).toEqual([])
            expect(watch.writes).toEqual([])
            expect(watch.removals).toEqual([])
        } finally {
            watch.stop()
        }
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        expect(liveOf('beta').coldstorage).toBe('unit-beta')
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(anyNotice()).toBe(false)
    })
})

describe('the restore runs uncounted when the count cannot be used', () => {
    test('guard: a storage that throws when the count is read does not stop the restore, and the plugin stays on', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        const realGet = localStorage.getItem.bind(localStorage)
        const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
            if (key === STRIKES_KEY) { throw new Error('storage unreadable') }
            return realGet(key)
        })
        try {
            await loadPlugins()
        } finally {
            getSpy.mockRestore()
        }

        expect(seenBy.__v21Runs).toBe(1)
        expect(liveOf('beta').coldstorage).toBeUndefined()
        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(anyNotice()).toBe(false)
    })

    test('a storage that throws when the count is read logs a warning', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        const realGet = localStorage.getItem.bind(localStorage)
        const getSpy = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
            if (key === STRIKES_KEY) { throw new Error('storage unreadable') }
            return realGet(key)
        })
        try {
            await loadPlugins()
        } finally {
            getSpy.mockRestore()
        }

        expect(vi.mocked(console.warn)).toHaveBeenCalled()
    })

    test('guard: a storage that throws on the start write does not stop the restore, and the plugin stays on', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        const realSet = localStorage.setItem.bind(localStorage)
        const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
            if (key === STRIKES_KEY) { throw new Error('quota exceeded') }
            realSet(key, value)
        })
        try {
            await loadPlugins()
        } finally {
            setSpy.mockRestore()
        }

        expect(seenBy.__v21Runs).toBe(1)
        expect(liveOf('beta').coldstorage).toBeUndefined()
        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(anyNotice()).toBe(false)
    })

    test('a storage that throws on the start write logs a warning before the first unit is read', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        const realSet = localStorage.setItem.bind(localStorage)
        const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
            if (key === STRIKES_KEY) { throw new Error('quota exceeded') }
            realSet(key, value)
        })
        try {
            await loadPlugins()
        } finally {
            setSpy.mockRestore()
        }

        // The reset at the end of the restore fails the same way and warns too, so only a warning
        // that precedes the first unit read can come from the failed start write.
        const firstWarning = vi.mocked(console.warn).mock.invocationCallOrder[0]
        const firstUnitRead = readColdStorageItemMock.mock.invocationCallOrder[0]
        expect(firstWarning).toBeDefined()
        expect(firstUnitRead).toBeDefined()
        expect(firstWarning).toBeLessThan(firstUnitRead)
    })

    test.each(['abc', '-2', '2.5', 'NaN', 'two'])('a stored value of "%s" is not a count: it reads as 0, the restore runs and the plugin stays on', async (garbage) => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        localStorage.setItem(STRIKES_KEY, garbage)

        await loadPlugins()

        expect(countAtRead).toEqual(['1'])
        expect(strikes()).toBe(0)
        expect(seenBy.__v21Runs).toBe(1)
        expect(liveOf('beta').coldstorage).toBeUndefined()
        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(anyNotice()).toBe(false)
    })
})

describe('the restore-all count and the archive pass records are independent', () => {
    const PASS_KEYS = {
        archivePassStrikes: '1',
        archivePassSkipped: '["x"]',
        archivePassTooLarge: '1',
        archivePassPausedTold: '1',
    } as const

    function seedPassKeys(): void {
        for (const [key, value] of Object.entries(PASS_KEYS)) {
            localStorage.setItem(key, value)
        }
    }

    function passKeys(): Record<string, string | null> {
        return Object.fromEntries(Object.keys(PASS_KEYS).map((key) => [key, localStorage.getItem(key)]))
    }

    test.each([
        ['absent', null],
        ['1', '1'],
        ['2', '2'],
    ] as const)('guard: restore-all with the count %s leaves every archivePass key as it was', async (_label, stored) => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1')])
        seedPassKeys()
        if (stored !== null) {
            localStorage.setItem(STRIKES_KEY, stored)
        }

        await loadPlugins()

        expect(passKeys()).toEqual(PASS_KEYS)
    })

    test('guard: clearing the archive pass memo removes its keys and leaves the restore-all count', () => {
        seedPassKeys()
        localStorage.setItem(STRIKES_KEY, '2')

        clearArchiveMemo()

        expect(passKeys()).toEqual({ archivePassStrikes: null, archivePassSkipped: null, archivePassTooLarge: null, archivePassPausedTold: null })
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
    })
})

describe('togglePluginEnabled', () => {
    test.each(['1', '2'])('turning a V2.1 plugin on at a count of %s clears the count before loadPlugins reads it, so the restore runs and the plugin loads', async (stored) => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1', false)])
        localStorage.setItem(STRIKES_KEY, stored)

        await togglePluginEnabled(DBState.db.plugins[0])
        await vi.waitFor(() => { expect(seenBy.__v21Runs).toBe(1) })

        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(countAtRead).toEqual(['1'])
        expect(liveOf('beta').coldstorage).toBeUndefined()
        expect(strikes()).toBe(0)
        expect(anyNotice()).toBe(false)
    })

    test.each([
        ['absent', null],
        ['0', '0'],
    ] as const)('turning a V2.1 plugin on when the count is %s writes nothing to it', async (_label, stored) => {
        installDb([fullCharacter('alpha') as unknown as CharacterFixture], [plugin('legacy', '2.1', false)])
        if (stored !== null) {
            localStorage.setItem(STRIKES_KEY, stored)
        }
        const watch = watchStrikesKey()
        try {
            await togglePluginEnabled(DBState.db.plugins[0])
            await vi.waitFor(() => { expect(seenBy.__v21Runs).toBe(1) })

            expect(watch.writes).toEqual([])
            expect(watch.removals).toEqual([])
        } finally {
            watch.stop()
        }
        expect(localStorage.getItem(STRIKES_KEY)).toBe(stored)
    })

    test('guard: turning a V2.1 plugin off leaves the count, restores nothing and does not run the plugin', async () => {
        putUnit('beta')
        installDb([fullCharacter('alpha') as unknown as CharacterFixture, stubOf('beta')], [plugin('legacy', '2.1', true)])
        localStorage.setItem(STRIKES_KEY, '2')

        await togglePluginEnabled(DBState.db.plugins[0])
        await vi.waitFor(() => { expect(DBState.db.plugins[0].enabled).toBe(false) })
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
        expect(liveOf('beta').coldstorage).toBe('unit-beta')
        expect(seenBy.__v21Runs).toBeUndefined()
        expect(anyNotice()).toBe(false)
    })

    test.each([
        ['a V3 plugin', '3.0'],
        ['a V2.0 plugin', 2],
    ] as const)('guard: toggling %s on and off leaves the count', async (_label, version) => {
        installDb([fullCharacter('alpha') as unknown as CharacterFixture], [plugin('other', version, false, '')])
        localStorage.setItem(STRIKES_KEY, '2')

        await togglePluginEnabled(DBState.db.plugins[0])
        expect(DBState.db.plugins[0].enabled).toBe(true)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')

        await togglePluginEnabled(DBState.db.plugins[0])
        expect(DBState.db.plugins[0].enabled).toBe(false)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
    })
})
