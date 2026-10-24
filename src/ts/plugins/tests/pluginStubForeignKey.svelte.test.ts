/**
 * Plugins and the archived-character placeholders ("stubs") of a store2 page.
 *
 * Invariants exercised here:
 * - A plugin setter refuses a placeholder whose `coldstorage` is not the one the live stub of its `chaId` holds: a stub
 *   names its own units, and another entity's `u` in its place would make the next save carry the wrong ones. The
 *   rule is `stubRefusal` (`other-unit`); `stubDowngrade.ts` applies it to the single-character setter and to the
 *   array setters, and the live list is left as it was.
 *
 * Titles starting `guard:` pin behaviour that holds before and after the change. The store2 pages are in-memory
 * backends booted through the real dispatch; the V3 loader, the alert queue and the sandbox are mocks, so a pass says
 * nothing about the native stores.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'

//#region module mocks

const alerts = vi.hoisted(() => ({ shown: [] as string[] }))
const loadV3PluginsMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => { }))

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
    alertError: vi.fn((msg: string | Error) => { alerts.shown.push(msg instanceof Error ? msg.message : String(msg)) }),
    alertErrorWait: vi.fn(async (msg: string) => { alerts.shown.push(msg) }),
    alertNormal: vi.fn((msg: string) => { alerts.shown.push(msg) }),
    alertNormalWait: vi.fn(async (msg: string) => { alerts.shown.push(msg) }),
    alertMd: vi.fn((msg: string) => { alerts.shown.push(msg) }),
    alertToast: vi.fn(),
    alertWait: vi.fn(() => ({})),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    requiresFullEncoderReload: { state: false },
    forageStorage: {},
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('../../storage/store/appStore'))

vi.mock(import('../../storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('../../storage/dbChangeEffects.svelte'))

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async (code: string) => ({ modifiedCode: code })),
}) as unknown as typeof import('../pluginSafety'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeDocument: class { },
    SafeIdbFactory: class { },
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

import { incomingCharacterRefusal, withoutStubDowngrades } from '../stubDowngrade'
import { DBState } from '../../stores.svelte'
import { resetPageBlockOwnerForTests } from '../../storage/pageBlockOwner'
import { resetPageStorageModeForTests } from '../../storage/pageStorageMode'
import { resetStore2BootForTest } from '../../storage/store2/bootActive'
import { resetResidencyForTest } from '../../storage/store2/residencyActive'
import { resetStore2SaveForTest } from '../../storage/store2/saveActive'
import { resetRetainedForTest } from '../../process/coldRetained'

type Slot = Parameters<typeof incomingCharacterRefusal>[0]

function stubOf(chaId: string, coldstorage: string): Slot {
    return { type: 'character', name: `Stub ${chaId}`, chaId, coldstorage, coldStoragedChats: [], chats: [] } as unknown as Slot
}

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

beforeEach(() => {
    alerts.shown.length = 0
    localStorage.clear()
    loadV3PluginsMock.mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetPage()
    vi.restoreAllMocks()
})

describe('a plugin setter and a placeholder that names another entity\'s units', () => {
    beforeEach(() => {
        DBState.db = { characters: [stubOf('a', 'unit-a'), { chaId: 'b', name: 'B', type: 'character', chats: [] }] } as unknown as Database
    })

    test('the single-character setter refuses a placeholder with a foreign coldstorage and the list is unchanged', () => {
        const live = DBState.db.characters[0]

        const refusal = incomingCharacterRefusal(stubOf('a', 'unit-of-another-entity'), 'Spy')

        expect(refusal).toContain('cannot replace')
        expect(DBState.db.characters[0]).toBe(live)
        expect(vi.mocked(console.warn).mock.calls.some((call) => String(call[0]).includes('points at another unit'))).toBe(true)
    })

    test('the array setter swaps a foreign placeholder for the live stub of its id', () => {
        const live = [...DBState.db.characters]

        const next = withoutStubDowngrades(live, { characters: [stubOf('a', 'unit-of-another-entity'), live[1]] }, 'Spy')

        expect(next.characters?.[0]).toBe(live[0])
        expect(next.characters?.[1]).toBe(live[1])
    })

    test('guard: a placeholder with the very coldstorage the live stub holds is accepted as it is', () => {
        expect(incomingCharacterRefusal(stubOf('a', 'unit-a'), 'Spy')).toBeNull()
    })
})
