/**
 * `loadPlugins` at boot (`bootstrap.ts`) with an enabled V2.1 plugin and an
 * archived character ("stub") whose unit is missing.
 *
 * `loadPlugins` leaves that stub in the list and tells the user which
 * characters are still archived, because the V2.1 plugin then sees a
 * placeholder. The alert is a single slot that any later notice, progress text
 * or clear replaces, so the notice must be shown exactly once, must not be
 * replaced by any later call before the user has dismissed it, and the boot
 * must finish without waiting on an alert the user cannot dismiss. With a
 * single stub the restore shows no progress text.
 *
 * The alert module is a model of that single slot as `AlertComp.svelte`
 * presents it: a user who presses OK 20 ms after a notice of type 'error',
 * 'normal' or 'markdown' appears, and no on-screen control for a 'wait2'
 * (`alertErrorWait`) or 'wait' (`alertWait`) alert; only Escape closes those. It records every notice
 * that was replaced while still on screen. A boot that does not finish fails
 * with the alert that is on screen. `loadPlugins`, `loadV2Plugin`, `coldRestoreAll.ts`
 * and `coldCharacterRestore.ts` (reading through the page's byte store, backed
 * by an in-memory map) are real; the V3 plugin loader is a mock. This says
 * nothing about the real IndexedDB, Node or Tauri stores.
 *
 * The second half covers the crash-loop breaker of that restore (the raw
 * `localStorage` key `v21RestoreAllStrikes`): once the restore has been started
 * twice without ending, the next `loadPlugins` does not read a unit, switches
 * every enabled V2.1 plugin off in the live database, posts one notice that
 * names them and waits for the user, and only then loads the plugins that
 * remain. The count is reset before any notice the restore itself waits on.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, character } from '../../storage/database.svelte'
import type { RisuPlugin } from '../plugins.svelte'

//#region module mocks

const unitStore = vi.hoisted(() => new Map<string, Uint8Array>())

/**
 * The alert store as one slot, as `AlertComp.svelte` presents it. A notice of
 * type 'error', 'normal' or 'markdown' has an OK button, and a simulated user
 * presses it 20 ms after the notice appears. A 'wait2' notice (`alertErrorWait`)
 * and a 'wait' notice (`alertWait`) have no control the user can press, so
 * nothing ever dismisses them but a later alert call.
 */
const alertModel = vi.hoisted(() => {
    type Kind = 'none' | 'error' | 'normal' | 'markdown' | 'wait' | 'wait2'
    const model = {
        slot: { kind: 'none' as Kind, msg: '', id: 0 },
        nextId: 0,
        /** Every notice (any type but 'wait') that was shown. */
        shown: [] as string[],
        /** Notices replaced or cleared while still on screen, before the user dismissed them. */
        overwritten: [] as string[],
        waiters: [] as (() => void)[],
        /** Every alert call in order, with the raw `v21RestoreAllStrikes` value at the moment of the call. */
        events: [] as { kind: Kind | 'clear', msg: string, count: string | null }[],
        reset() {
            model.slot = { kind: 'none', msg: '', id: 0 }
            model.shown.length = 0
            model.overwritten.length = 0
            model.waiters.length = 0
            model.events.length = 0
        },
        release() {
            const waiters = model.waiters.splice(0)
            for (const resolve of waiters) {
                resolve()
            }
        },
        dismiss(id: number) {
            if (model.slot.id === id) {
                model.slot = { kind: 'none', msg: '', id: 0 }
                model.release()
            }
        },
        put(kind: Exclude<Kind, 'none'>, msg: string) {
            if (model.slot.kind !== 'none' && model.slot.kind !== 'wait') {
                model.overwritten.push(model.slot.msg)
            }
            const id = ++model.nextId
            model.events.push({ kind, msg, count: localStorage.getItem('v21RestoreAllStrikes') })
            model.slot = { kind, msg, id }
            if (kind !== 'wait') {
                model.shown.push(msg)
            }
            if (kind === 'error' || kind === 'normal' || kind === 'markdown') {
                setTimeout(() => model.dismiss(id), 20)
            }
        },
        clear() {
            model.events.push({ kind: 'clear', msg: '', count: localStorage.getItem('v21RestoreAllStrikes') })
            if (model.slot.kind !== 'none' && model.slot.kind !== 'wait') {
                model.overwritten.push(model.slot.msg)
            }
            model.slot = { kind: 'none', msg: '', id: 0 }
            model.release()
        },
        wait(): Promise<void> {
            if (model.slot.kind === 'none') {
                return Promise.resolve()
            }
            return new Promise<void>((resolve) => { model.waiters.push(resolve) })
        },
    }
    return model
})
const loadV3PluginsMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
/** The raw `v21RestoreAllStrikes` value at the start of each unit read. */
const unitReads = vi.hoisted(() => ({ countAtRead: [] as (string | null)[] }))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        selectedCharID: writable(-1),
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
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertPluginConfirm: vi.fn(async () => true),
    alertError: vi.fn((msg: string | Error) => { alertModel.put('error', msg instanceof Error ? msg.message : String(msg)) }),
    alertErrorWait: vi.fn(async (msg: string) => {
        alertModel.put('wait2', msg)
        await alertModel.wait()
    }),
    alertNormal: vi.fn((msg: string) => { alertModel.put('normal', msg) }),
    alertNormalWait: vi.fn(async (msg: string) => {
        alertModel.put('normal', msg)
        await alertModel.wait()
    }),
    alertMd: vi.fn((msg: string) => { alertModel.put('markdown', msg) }),
    alertToast: vi.fn(),
    alertWait: vi.fn((msg: string) => { alertModel.put('wait', msg); return {} }),
    alertClear: vi.fn(() => { alertModel.clear() }),
    waitAlert: vi.fn(() => alertModel.wait()),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    requiresFullEncoderReload: { state: false },
    forageStorage: {},
    isPlainHttpFileSrc: vi.fn(() => false),
}) as unknown as typeof import('../../globalApi.svelte'))

// The page's byte store, over the in-memory map; every read records the count.
vi.mock(import('../../storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('../../storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        setItem: async (key, value) => { unitStore.set(key, value) },
        getItem: async (key) => {
            unitReads.countAtRead.push(localStorage.getItem('v21RestoreAllStrikes'))
            return unitStore.get(key) ?? null
        },
        keys: async () => Array.from(unitStore.keys()),
        removeItem: async (key) => { unitStore.delete(key) },
    })
    return { getAppStore: async () => store } as unknown as typeof import('../../storage/store/appStore')
})

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

vi.mock(import('../../process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

//#endregion

import { loadPlugins } from '../plugins.svelte'
import { buildColdStub } from '../../process/coldCharacter'
import { DBState } from '../../stores.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

const seenBy = globalThis as unknown as {
    __v21Runs?: number
    __v21Ran?: string[]
    __v21ScreenAtRun?: string
    __alertScreen?: () => string
}

/** A plugin of any API version; a V2.1 one records its name in `__v21Ran` when its code runs. */
function pluginOf(name: string, version: RisuPlugin['version'], enabled = true): RisuPlugin {
    return {
        name,
        script: `globalThis.__v21Ran = [...(globalThis.__v21Ran || []), ${JSON.stringify(name)}]`,
        version,
        enabled,
        arguments: {},
        realArg: {},
        customLink: [],
        argMeta: {},
    }
}

/** An archived character whose unit does not exist. */
function stubWithMissingUnit(chaId: string, name: string): CharacterFixture {
    const source = { type: 'character', name, chaId, chatPage: 0, chats: [], lastInteraction: 5000 } as unknown as character
    return buildColdStub(source, `unit-${chaId}`, []) as unknown as CharacterFixture
}

const V21_PLUGIN: RisuPlugin = {
    name: 'legacy',
    script: `
globalThis.__v21Runs = (globalThis.__v21Runs || 0) + 1
globalThis.__v21ScreenAtRun = globalThis.__alertScreen()
`,
    version: '2.1',
    enabled: true,
    arguments: {},
    realArg: {},
    customLink: [],
    argMeta: {},
}

/** Fails with what is on screen when `work` has not finished, instead of letting the test time out silently. */
async function finishesWithin(work: Promise<unknown>, ms = 1000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'hung'>((resolve) => { timer = setTimeout(() => resolve('hung'), ms) })
    const result = await Promise.race([work.then(() => 'done' as const), timeout])
    clearTimeout(timer)
    expect(result, `boot did not finish: the alert on screen is of type "${alertModel.slot.kind}" (${alertModel.slot.msg}), which the user cannot dismiss`).toBe('done')
}

const STRIKES_KEY = 'v21RestoreAllStrikes'

/** What was on screen when each V3 plugin load started. */
const v3Loads: { names: string[], screen: string, noticesShown: number }[] = []

beforeEach(() => {
    unitStore.clear()
    localStorage.clear()
    alertModel.reset()
    unitReads.countAtRead.length = 0
    v3Loads.length = 0
    loadV3PluginsMock.mockReset().mockImplementation(async (...args: unknown[]) => {
        const plugins = (args[0] ?? []) as { name: string }[]
        v3Loads.push({ names: plugins.map((p) => p.name), screen: alertModel.slot.kind, noticesShown: alertModel.shown.length })
    })
    delete seenBy.__v21Runs
    delete seenBy.__v21Ran
    delete seenBy.__v21ScreenAtRun
    seenBy.__alertScreen = () => alertModel.slot.kind
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

//#endregion

describe('loadPlugins at boot with an archived character whose unit is missing', () => {
    test('guard: the notice naming that character is shown once and is not replaced before the user dismisses it', async () => {
        DBState.db = {
            characters: [stubWithMissingUnit('gamma', 'Lost Soul')],
            plugins: [V21_PLUGIN],
            pluginCustomStorage: {},
        } as unknown as Database

        await finishesWithin(loadPlugins())

        const notices = alertModel.shown.filter((text) => text.includes('Lost Soul'))
        expect(notices).toHaveLength(1)
        expect(alertModel.overwritten.filter((text) => text.includes('Lost Soul'))).toEqual([])
        expect((DBState.db.characters[0] as unknown as ColdCharacter).coldstorage).toBe('unit-gamma')
        expect(seenBy.__v21Runs).toBe(1)
        expect(seenBy.__v21ScreenAtRun).toBe('none')
    })
})

describe('loadPlugins when the restore of every archived character was started twice and never ended', () => {
    const SWITCHED_OFF = ['Quill Bridge', 'Ember Hook']

    function installProfile(): void {
        DBState.db = {
            characters: [stubWithMissingUnit('gamma', 'Lost Soul')],
            plugins: [
                pluginOf('Quill Bridge', '2.1'),
                pluginOf('Ember Hook', '2.1'),
                pluginOf('Idle Relay', '2.1', false),
                pluginOf('Modern Add-on', '3.0'),
                pluginOf('removed-v2', 2),
            ],
            pluginCustomStorage: {},
        } as unknown as Database
    }

    function installTrippedProfile(): void {
        installProfile()
        localStorage.setItem(STRIKES_KEY, '2')
    }

    function pluginState(name: string): boolean | undefined {
        return (DBState.db.plugins as RisuPlugin[]).find((p) => p.name === name)?.enabled
    }

    test('reads no unit, keeps the archived character archived and runs no V2.1 code', async () => {
        installTrippedProfile()

        await finishesWithin(loadPlugins())

        expect(unitReads.countAtRead).toEqual([])
        expect((DBState.db.characters[0] as unknown as ColdCharacter).coldstorage).toBe('unit-gamma')
        expect(seenBy.__v21Ran).toBeUndefined()
    })

    test('switches off every enabled V2.1 plugin in the live database and leaves every other plugin as it was', async () => {
        installTrippedProfile()

        await finishesWithin(loadPlugins())

        expect(pluginState('Quill Bridge')).toBe(false)
        expect(pluginState('Ember Hook')).toBe(false)
        expect(pluginState('Idle Relay')).toBe(false)
        expect(pluginState('Modern Add-on')).toBe(true)
        expect(pluginState('removed-v2')).toBe(true)
        expect(DBState.db.plugins).toHaveLength(5)
    })

    test('posts exactly one notice, naming the plugins that were switched off and no other plugin and no character', async () => {
        installTrippedProfile()

        await finishesWithin(loadPlugins())

        expect(alertModel.shown).toHaveLength(1)
        for (const name of SWITCHED_OFF) {
            expect(alertModel.shown[0]).toContain(name)
        }
        for (const other of ['Idle Relay', 'Modern Add-on', 'removed-v2', 'Lost Soul']) {
            expect(alertModel.shown[0]).not.toContain(other)
        }
        expect(alertModel.overwritten).toEqual([])
    })

    test('names a plugin that has a display name by that display name, and a plugin without one by its name', async () => {
        DBState.db = {
            characters: [stubWithMissingUnit('gamma', 'Lost Soul')],
            plugins: [
                { ...pluginOf('internal-id-7', '2.1'), displayName: 'Shown Label' },
                pluginOf('Plain Name', '2.1'),
            ],
            pluginCustomStorage: {},
        } as unknown as Database
        localStorage.setItem(STRIKES_KEY, '2')

        await finishesWithin(loadPlugins())

        expect(alertModel.shown).toHaveLength(1)
        expect(alertModel.shown[0]).toContain('Shown Label')
        expect(alertModel.shown[0]).toContain('Plain Name')
        expect(alertModel.shown[0]).not.toContain('internal-id-7')
    })

    test('loads the remaining plugins only after the user has dismissed the notice', async () => {
        installTrippedProfile()

        await finishesWithin(loadPlugins())

        expect(alertModel.shown).toHaveLength(1)
        expect(alertModel.shown[0]).toContain('Quill Bridge')
        expect(v3Loads).toHaveLength(1)
        expect(v3Loads[0].names).toEqual(['Modern Add-on'])
        expect(v3Loads[0].noticesShown).toBe(1)
        expect(v3Loads[0].screen).toBe('none')
    })

    test('guard: an enabled V2.0 entry still reaches the V2 loader after the switch-off', async () => {
        installTrippedProfile()

        await finishesWithin(loadPlugins())

        const warnings = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]))
        expect(warnings.some((text) => text.includes('removed-v2'))).toBe(true)
    })

    test('switching the plugins off leaves the count at 2 and the key unchanged', async () => {
        installTrippedProfile()

        await finishesWithin(loadPlugins())

        expect(pluginState('Quill Bridge')).toBe(false)
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
    })

    test('a switch-off that was never saved trips again at the next boot: the plugins are switched off again, the notice is posted again and no unit is read', async () => {
        installTrippedProfile()
        await finishesWithin(loadPlugins())
        expect(alertModel.shown).toHaveLength(1)

        // The next boot reads the saved file, which still holds the plugins enabled.
        alertModel.reset()
        installProfile()
        await finishesWithin(loadPlugins())

        expect(pluginState('Quill Bridge')).toBe(false)
        expect(pluginState('Ember Hook')).toBe(false)
        expect(alertModel.shown).toHaveLength(1)
        expect(alertModel.shown[0]).toContain('Quill Bridge')
        expect(unitReads.countAtRead).toEqual([])
        expect(seenBy.__v21Ran).toBeUndefined()
    })

    test('a count of 1 does not trip: the restore runs, the V2.1 plugins load and the count is 0 afterwards', async () => {
        installTrippedProfile()
        localStorage.setItem(STRIKES_KEY, '1')

        await finishesWithin(loadPlugins())

        expect(unitReads.countAtRead.length).toBeGreaterThan(0)
        expect(new Set(unitReads.countAtRead)).toEqual(new Set(['2']))
        expect(pluginState('Quill Bridge')).toBe(true)
        expect(pluginState('Ember Hook')).toBe(true)
        expect([...(seenBy.__v21Ran ?? [])].sort()).toEqual(['Ember Hook', 'Quill Bridge'])
        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
        expect(alertModel.shown.some((text) => text.includes('Quill Bridge'))).toBe(false)
    })
})

describe('the restore-all count is reset before any notice the restore waits on', () => {
    test('with an archived character whose unit is missing, the first unit read sees 1 and the count is 0 when the failed-names notice is shown', async () => {
        DBState.db = {
            characters: [stubWithMissingUnit('gamma', 'Lost Soul')],
            plugins: [pluginOf('Quill Bridge', '2.1')],
            pluginCustomStorage: {},
        } as unknown as Database

        await finishesWithin(loadPlugins())

        expect(unitReads.countAtRead.length).toBeGreaterThan(0)
        expect(new Set(unitReads.countAtRead)).toEqual(new Set(['1']))
        const notice = alertModel.events.find((event) => event.kind === 'error')
        expect(notice?.msg).toContain('Lost Soul')
        expect(notice?.count).toBe('0')
        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
    })

    test('with more archived characters than fit a quiet restore, the count is 0 when the progress notice is cleared and when the failed-names notice is shown', async () => {
        const names = ['Lost A', 'Lost B', 'Lost C', 'Lost D', 'Lost E', 'Lost F']
        DBState.db = {
            characters: names.map((name, index) => stubWithMissingUnit(`id-${index}`, name)),
            plugins: [pluginOf('Quill Bridge', '2.1')],
            pluginCustomStorage: {},
        } as unknown as Database

        await finishesWithin(loadPlugins())

        const kinds = alertModel.events.map((event) => event.kind)
        expect(kinds).toContain('wait')
        const cleared = alertModel.events.find((event) => event.kind === 'clear')
        const notice = alertModel.events.find((event) => event.kind === 'error')
        expect(cleared?.count).toBe('0')
        expect(notice?.count).toBe('0')
        for (const name of names) {
            expect(notice?.msg).toContain(name)
        }
    })
})
