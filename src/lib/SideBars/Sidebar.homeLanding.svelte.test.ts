// @vitest-environment happy-dom

/**
 * The three Home buttons of `Sidebar.svelte` (the rail's Home button, and the Home entry of the
 * hamburger menu at the top and at the bottom) return Home to its landing view, so a library left
 * open does not hide the landing the button promises. The view is reset after the selection writes,
 * never before: the order of the `selectedCharID`, `PlaygroundStore` and `OpenRealmStore` writes is
 * unchanged, and the Home view still reads `library` while each of them is written.
 *
 * Mounts the REAL `Sidebar.svelte`; the module mocks follow `Sidebar.closeButton.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
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
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
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
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable(0),
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

import { DBState, OpenRealmStore, PlaygroundStore, selectedCharID } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { homeView, openHomeLibrary, showHomeLanding } from '../UI/Home/homeView.svelte'
import Sidebar from './Sidebar.svelte'
import { resetRailMemory } from './sidebarDnd.testKit'

function buildDb(extra: Record<string, unknown>): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: [],
        characters: [],
        hideAllImages: false,
        ...extra,
    } as unknown as Database
}

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null
let writes: string[] = []
let unsubscribers: Array<() => void> = []

function mountSidebar(dbExtra: Record<string, unknown>): HTMLElement {
    DBState.db = buildDb(dbExtra)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    mounted = { target, app }
    return target
}

/** Sets the three stores to values the Home button changes, then logs each write with the Home view at that moment. */
function armLog(): void {
    selectedCharID.set(3)
    PlaygroundStore.set(1)
    OpenRealmStore.set(true)
    const watch = <T>(name: string, store: { subscribe(run: (value: T) => void): () => void }) => {
        let first = true
        unsubscribers.push(
            store.subscribe((value) => {
                if (first) {
                    first = false
                    return
                }
                writes.push(`${name}=${String(value)} view=${homeView.view}`)
            }),
        )
    }
    watch('selectedCharID', selectedCharID)
    watch('PlaygroundStore', PlaygroundStore as unknown as { subscribe(run: (value: number) => void): () => void })
    watch('OpenRealmStore', OpenRealmStore)
}

const EXPECTED_WRITES = [
    'selectedCharID=-1 view=library',
    'PlaygroundStore=0 view=library',
    'OpenRealmStore=false view=library',
]

beforeEach(() => {
    resetRailMemory()
    writes = []
    unsubscribers = []
    showHomeLanding()
})

afterEach(async () => {
    for (const stop of unsubscribers) {
        stop()
    }
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
        mounted = null
    }
    showHomeLanding()
})

describe('Sidebar Home buttons return Home to the landing', () => {
    test('(F) the rail Home button, after the selection writes', () => {
        const target = mountSidebar({ menuSideBar: true })
        armLog()
        openHomeLibrary()
        const home = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(language.home))!
        home.click()
        flushSync()
        expect(writes).toEqual(EXPECTED_WRITES)
        expect(homeView.view).toBe('landing')
    })

    test('(F) the hamburger menu Home entry at the top, after the selection writes', () => {
        const target = mountSidebar({})
        const toggle = target.querySelector<HTMLButtonElement>('button.min-w-14')!
        toggle.click()
        flushSync()
        armLog()
        openHomeLibrary()
        const entries = target.querySelectorAll<HTMLButtonElement>('div.absolute.w-20 button.ico')
        entries[1].click()
        flushSync()
        expect(writes).toEqual(EXPECTED_WRITES)
        expect(homeView.view).toBe('landing')
    })

    test('(F) the hamburger menu Home entry at the bottom, after the selection writes', () => {
        const target = mountSidebar({ hamburgerButtonBottom: true })
        const toggle = target.querySelector<HTMLButtonElement>('button.min-w-14')!
        toggle.click()
        flushSync()
        armLog()
        openHomeLibrary()
        const entries = target.querySelectorAll<HTMLButtonElement>('div.absolute.w-20 button.ico')
        entries[1].click()
        flushSync()
        expect(writes).toEqual(EXPECTED_WRITES)
        expect(homeView.view).toBe('landing')
    })
})
