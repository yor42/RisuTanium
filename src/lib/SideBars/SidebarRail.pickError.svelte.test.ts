// @vitest-environment happy-dom

/**
 * A character row of the rail opens its character through `changeChar`, driven through the REAL
 * `Sidebar.svelte` (and so the real `SidebarRail.svelte`). A `changeChar` that throws or rejects
 * shows the translated could-not-load alert once and records the error under `rail.pick`, for an
 * ordinary row and for a folder member, by click and by Enter; the tap never raises an unhandled
 * rejection. Every resolved outcome stays as it was: no alert, no record.
 *
 * Invariants exercised here:
 * - T2: an ordinary row, by click and by Enter, shows one alert, writes a `rail.pick` record and
 *   leaves no unhandled rejection.
 * - T3: a folder member does the same.
 * - T4 (guard): `selected`, `superseded`, `gone`, a refused restore and a spy that returns nothing
 *   add neither an alert nor a record.
 * - T7 (guard): `changeChar` runs synchronously from the tap with the row's index and the rail's
 *   `reseter`.
 *
 * MOCKED: `checkCharOrder` (a spy), `alertSelect` / `alertInput` (spies that answer "cancel"),
 * `alertError` and the caught-error record (spies), `changeChar` (a spy), `saveAsset`, and the
 * storage and platform modules. The generation counter is the real one.
 *
 * Tests whose title starts with `guard:` pass with or without a defect (compatibility).
 */
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import type { ChangeCharOutcome } from '../../ts/characters'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

const { checkCharOrderSpy, changeCharSpy, alertErrorSpy, recordErrorSpy } = vi.hoisted(() => ({
    checkCharOrderSpy: vi.fn(),
    changeCharSpy: vi.fn(),
    alertErrorSpy: vi.fn(),
    recordErrorSpy: vi.fn(),
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: checkCharOrderSpy,
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(async () => 'asset-1'),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            usingSw: false,
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('../../ts/stores.svelte')
})

// The chat list of a selected character is not under test here.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

vi.mock(import('../../ts/characters'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeChar: changeCharSpy,
}))

vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertSelect: vi.fn(async () => '5'),
    alertInput: vi.fn(async () => ''),
    alertError: alertErrorSpy,
}))

vi.mock(import('../../ts/caughtErrors'), async (importOriginal) => ({
    ...(await importOriginal()),
    recordCaughtError: recordErrorSpy,
}))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { language } from '../../lang'
import Sidebar from './Sidebar.svelte'
import { charKey, memberKey } from './railTestKit'
import { defaultSettle, folderAvatars, installGeometry, resetRailMemory } from './sidebarDnd.testKit'

interface FolderFixture {
    id: string
    name: string
    color: string
    data: string[]
}
type OrderFixture = Array<string | FolderFixture>

const folderOf = (id: string, data: string[]): FolderFixture => ({ id, name: `Name ${id}`, color: '', data })

const LETTERS = ['A', 'B', 'C', 'X', 'Y']

function setDb(order: OrderFixture): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: order,
        characters: LETTERS.map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let root: HTMLElement

async function settle(): Promise<void> {
    await defaultSettle()
    await tick()
    await defaultSettle()
}

async function mountSidebar(order: OrderFixture, openFolders = 0): Promise<HTMLElement> {
    setDb(order)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    installGeometry(target, 2000)
    root = target
    for (let i = 0; i < openFolders; i++) {
        folderAvatars(root)[i].click()
    }
    await settle()
    return target
}

// Node reports an unhandled rejection after the microtask queue drains, so a check needs a macrotask first.
const nextMacrotask = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }

beforeEach(() => {
    resetRailMemory()
    checkCharOrderSpy.mockClear()
    changeCharSpy.mockReset()
    alertErrorSpy.mockReset()
    recordErrorSpy.mockReset()
    selectedCharID.set(-1)
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    if (mounted) {
        try {
            await unmount(mounted.app as never)
        } catch {
            // a sidebar that failed half way through mounting is torn down best effort
        }
        mounted.target.remove()
        mounted = null
    }
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

const entries = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-rail-entry]'))
const entryOf = (key: string): HTMLElement | null => entries().find((el) => el.getAttribute('data-rail-entry') === key) ?? null

async function pressEnter(el: HTMLElement): Promise<void> {
    el.focus()
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
}

async function clickAvatar(id: string): Promise<void> {
    root.querySelector<HTMLElement>(`[data-char-id="${id}"]`)!.click()
    await settle()
}

describe('a rail row whose changeChar throws', () => {
    test('T2: an ordinary row tapped by click shows one alert, writes a rail.pick record and leaves no unhandled rejection', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const error = new Error('boom')
        changeCharSpy.mockRejectedValueOnce(error)

        await clickAvatar('B')

        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(recordErrorSpy).toHaveBeenCalledWith('rail.pick', error)
        await nextMacrotask()
        expect(unhandled).toEqual([])
    })

    test('T2: an ordinary row activated by Enter does the same', async () => {
        await mountSidebar(['A', 'B', 'C'])
        const error = new Error('boom')
        changeCharSpy.mockRejectedValueOnce(error)

        await pressEnter(entryOf(charKey('B'))!)

        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(recordErrorSpy).toHaveBeenCalledWith('rail.pick', error)
        await nextMacrotask()
        expect(unhandled).toEqual([])
    })

    test('T3: a folder member tapped by click shows one alert and writes a rail.pick record', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'B'], 1)
        const error = new Error('boom')
        changeCharSpy.mockRejectedValueOnce(error)

        await clickAvatar('X')

        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(changeCharSpy.mock.calls[0][0]).toBe(LETTERS.indexOf('X'))
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).toHaveBeenCalledWith(language.errors.coldStorageRestoreUnreadable)
        expect(recordErrorSpy).toHaveBeenCalledWith('rail.pick', error)
        await nextMacrotask()
        expect(unhandled).toEqual([])
    })

    test('T3: a folder member activated by Enter does the same', async () => {
        await mountSidebar([folderOf('F', ['X', 'Y']), 'B'], 1)
        const error = new Error('boom')
        changeCharSpy.mockRejectedValueOnce(error)

        await pressEnter(entryOf(memberKey('F', 'Y'))!)

        expect(changeCharSpy.mock.calls[0][0]).toBe(LETTERS.indexOf('Y'))
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(recordErrorSpy).toHaveBeenCalledWith('rail.pick', error)
        await nextMacrotask()
        expect(unhandled).toEqual([])
    })

    test.each<[string, ChangeCharOutcome | undefined]>([
        ['selected', 'selected'],
        ['superseded', 'superseded'],
        ['gone', 'gone'],
        ['a refused restore', { failed: 'unreadable' }],
        ['nothing', undefined],
    ])('guard: T4 a row tap that resolves %s adds no alert and no record', async (_label, outcome) => {
        await mountSidebar(['A', 'B', 'C'])
        changeCharSpy.mockResolvedValueOnce(outcome)

        await clickAvatar('B')

        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy).not.toHaveBeenCalled()
        expect(recordErrorSpy).not.toHaveBeenCalled()
    })

    test('guard: T7 changeChar runs synchronously from the tap with the row index and the rail reseter', async () => {
        await mountSidebar(['A', 'B', 'C'])
        changeCharSpy.mockResolvedValue('selected')

        root.querySelector<HTMLElement>('[data-char-id="C"]')!.click()

        expect(changeCharSpy).toHaveBeenCalledTimes(1)
        expect(changeCharSpy.mock.calls[0][0]).toBe(LETTERS.indexOf('C'))
        expect(Object.keys(changeCharSpy.mock.calls[0][1] as object)).toEqual(['reseter'])
        expect(typeof (changeCharSpy.mock.calls[0][1] as { reseter: unknown }).reseter).toBe('function')
    })
})
