/**
 * `loadPlugins` (`plugins.svelte.ts`) when restoring the archived characters
 * before an enabled V2.1 plugin runs cannot be done at all.
 *
 * The V2.1 plugin still loads (its code is not withheld), but the user is
 * told before that code runs which characters are still archived, in one
 * notice that no later alert replaces before the user has dismissed it.
 *
 * The restore-all module (`coldRestoreAll.ts`) is a mock whose run throws,
 * standing in for a failure of that step; `loadPlugins` and `loadV2Plugin` are
 * real, and the plugin script really runs. The alert module is a model of the
 * single alert slot as `AlertComp.svelte` presents it: a user who presses OK
 * 20 ms after a notice of type 'error', 'normal' or 'markdown' appears, and no
 * on-screen control for a 'wait2' (`alertErrorWait`) or 'wait' (`alertWait`)
 * alert; only Escape closes those.
 * A load that does not finish fails with the alert that is on screen. The V3
 * plugin loader is a mock.
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
        reset() {
            model.slot = { kind: 'none', msg: '', id: 0 }
            model.shown.length = 0
            model.overwritten.length = 0
            model.waiters.length = 0
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
            model.slot = { kind, msg, id }
            if (kind !== 'wait') {
                model.shown.push(msg)
            }
            if (kind === 'error' || kind === 'normal' || kind === 'markdown') {
                setTimeout(() => model.dismiss(id), 20)
            }
        },
        clear() {
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
    forageStorage: {
        realStorage: {
            setItem: async (key: string, value: Uint8Array) => { unitStore.set(key, value) },
            getItem: async (key: string) => unitStore.get(key) ?? null,
            keys: async () => Array.from(unitStore.keys()),
        },
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

vi.mock(import('../../process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('../../process/index.svelte'))

vi.mock(import('../../process/coldRestoreAll'), () => ({
    restoreAllColdCharacters: vi.fn(async () => {
        throw new Error('restoring the archived characters failed')
    }),
}) as unknown as typeof import('../../process/coldRestoreAll'))

//#endregion

import { loadPlugins } from '../plugins.svelte'
import { buildColdStub } from '../../process/coldCharacter'
import { DBState } from '../../stores.svelte'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

const seenBy = globalThis as unknown as {
    __v21Runs?: number
    __v21NoticesAtRun?: number
    __v21ScreenAtRun?: string
    __alertScreen?: () => string
    __alertShown?: string[]
}

function fullCharacter(chaId: string, name: string): CharacterFixture {
    return { type: 'character', name, chaId, chatPage: 0, chats: [], lastInteraction: 5000 } as unknown as CharacterFixture
}

function stubOf(chaId: string, name: string): CharacterFixture {
    return buildColdStub(fullCharacter(chaId, name) as unknown as character, `unit-${chaId}`, []) as unknown as CharacterFixture
}

/** Records how many notices had been shown when its code ran. */
const V21_PLUGIN: RisuPlugin = {
    name: 'legacy',
    script: `
globalThis.__v21Runs = (globalThis.__v21Runs || 0) + 1
globalThis.__v21NoticesAtRun = globalThis.__alertShown.length
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

beforeEach(() => {
    alertModel.reset()
    loadV3PluginsMock.mockClear()
    delete seenBy.__v21Runs
    delete seenBy.__v21NoticesAtRun
    delete seenBy.__v21ScreenAtRun
    seenBy.__alertScreen = () => alertModel.slot.kind
    seenBy.__alertShown = alertModel.shown
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

//#endregion

describe('loadPlugins when the restore of archived characters fails as a whole', () => {
    test('the user is told which characters are still archived before the V2.1 plugin code runs', async () => {
        DBState.db = {
            characters: [fullCharacter('alpha', 'Alpha Hero'), stubOf('beta', 'Beta Hero'), stubOf('gamma', 'Lost Soul')],
            plugins: [V21_PLUGIN],
            pluginCustomStorage: {},
        } as unknown as Database

        await finishesWithin(loadPlugins())

        expect(seenBy.__v21Runs).toBe(1)
        expect(seenBy.__v21NoticesAtRun).toBe(1)
        expect(alertModel.shown).toHaveLength(1)
        expect(alertModel.shown[0]).toContain('Beta Hero')
        expect(alertModel.shown[0]).toContain('Lost Soul')
        expect(alertModel.shown[0]).not.toContain('Alpha Hero')
        expect(alertModel.overwritten).toEqual([])
        expect((DBState.db.characters[1] as unknown as ColdCharacter).coldstorage).toBe('unit-beta')
    })

    test('the V2.1 plugin code runs only after the user has dismissed the notice', async () => {
        DBState.db = {
            characters: [fullCharacter('alpha', 'Alpha Hero'), stubOf('beta', 'Beta Hero')],
            plugins: [V21_PLUGIN],
            pluginCustomStorage: {},
        } as unknown as Database

        await finishesWithin(loadPlugins())

        expect(alertModel.shown).toHaveLength(1)
        expect(seenBy.__v21Runs).toBe(1)
        expect(seenBy.__v21ScreenAtRun).toBe('none')
    })

    test('guard: with no archived character the failed restore step shows no notice and the plugin still runs', async () => {
        DBState.db = {
            characters: [fullCharacter('alpha', 'Alpha Hero')],
            plugins: [V21_PLUGIN],
            pluginCustomStorage: {},
        } as unknown as Database

        await loadPlugins()

        expect(seenBy.__v21Runs).toBe(1)
        expect(alertModel.shown).toEqual([])
    })
})
