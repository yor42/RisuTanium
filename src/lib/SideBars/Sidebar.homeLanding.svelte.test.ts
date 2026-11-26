// @vitest-environment happy-dom

/**
 * The three Home buttons of `Sidebar.svelte` (the rail's Home button, and the Home entry of the
 * hamburger menu at the top and at the bottom) land on Home's landing and drop a pending Studio-return
 * focus request, so a request left over cannot reach a later reveal. The order of the `selectedCharID`,
 * `PlaygroundStore` and `OpenRealmStore` writes is unchanged.
 *
 * Mounts the REAL `Sidebar.svelte`; the module mocks follow `Sidebar.closeButton.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
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
        sideBarStore: writable(false),
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

// The chat panel's list is not under test; a selected character would otherwise mount its full toggle tree.
vi.mock('./SideChatList.svelte', () => ({ default: () => {} }))

import { DBState, DynamicGUI, OpenRealmStore, PlaygroundStore, selectedCharID, sideBarClosing, sideBarStore } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { homeChrome } from '../UI/Home/homeChrome.svelte'
import { requestHomeReturnFocus, showHomeLanding, takeHomeReturnFocus } from '../UI/Home/homeView.svelte'
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

function mountSidebar(dbExtra: Record<string, unknown>, hidden = false): HTMLElement {
    DBState.db = buildDb(dbExtra)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: { hidden } }) as unknown as Record<string, unknown>
    flushSync()
    mounted = { target, app }
    return target
}

/** Sets the three stores to values the Home button changes, then logs each write. */
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
                writes.push(`${name}=${String(value)}`)
            }),
        )
    }
    watch('selectedCharID', selectedCharID)
    watch('PlaygroundStore', PlaygroundStore as unknown as { subscribe(run: (value: number) => void): () => void })
    watch('OpenRealmStore', OpenRealmStore)
}

const EXPECTED_WRITES = [
    'selectedCharID=-1',
    'PlaygroundStore=0',
    'OpenRealmStore=false',
]

beforeEach(() => {
    resetRailMemory()
    DynamicGUI.set(false)
    sideBarStore.set(false)
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

describe('Sidebar Home buttons land on Home and drop a pending return focus', () => {
    test('(F) the rail Home button, after the selection writes', () => {
        const target = mountSidebar({ menuSideBar: true })
        armLog()
        requestHomeReturnFocus('pending')
        const home = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.includes(language.home))!
        home.click()
        flushSync()
        expect(writes).toEqual(EXPECTED_WRITES)
        expect(takeHomeReturnFocus()).toBeNull()
    })

    test('(F) the hamburger menu Home entry at the top, after the selection writes', () => {
        const target = mountSidebar({})
        const toggle = target.querySelector<HTMLButtonElement>('button.min-w-14')!
        toggle.click()
        flushSync()
        armLog()
        requestHomeReturnFocus('pending')
        const entries = target.querySelectorAll<HTMLButtonElement>('div.absolute.w-20 button.ico')
        entries[1].click()
        flushSync()
        expect(writes).toEqual(EXPECTED_WRITES)
        expect(takeHomeReturnFocus()).toBeNull()
    })

    test('(F) the hamburger menu Home entry at the bottom, after the selection writes', () => {
        const target = mountSidebar({ hamburgerButtonBottom: true })
        const toggle = target.querySelector<HTMLButtonElement>('button.min-w-14')!
        toggle.click()
        flushSync()
        armLog()
        requestHomeReturnFocus('pending')
        const entries = target.querySelectorAll<HTMLButtonElement>('div.absolute.w-20 button.ico')
        entries[1].click()
        flushSync()
        expect(writes).toEqual(EXPECTED_WRITES)
        expect(takeHomeReturnFocus()).toBeNull()
    })
})

describe('Sidebar Home look', () => {
    const classTokens = (el: Element | null): string[] =>
        Array.from(el?.classList ?? []).filter((token) => !token.startsWith('svelte-')).sort()
    const tokensOf = (literal: string): string[] => literal.split(/\s+/).filter(Boolean).sort()
    const panelOf = (target: HTMLElement) => target.querySelector<HTMLElement>('.setting-area')
    const rootOf = (target: HTMLElement) => target.querySelector<HTMLElement>('[data-rail-root]')

    const BASE_ROOT = 'h-full w-20 min-w-20 flex-col items-center bg-bgcolor text-textcolor shadow-lg relative rs-sidebar flex'
    const BASE_TOGGLE_TOP = 'flex h-8 min-h-8 w-14 min-w-14 cursor-pointer text-white mt-2 items-center justify-center rounded-md bg-textcolor2 transition-colors hover:bg-borderc'
    const BASE_TOGGLE_BOTTOM = 'flex h-8 min-h-8 w-14 min-w-14 cursor-pointer text-white mb-2 mt-2 items-center justify-center rounded-md bg-textcolor2 transition-colors hover:bg-borderc'
    const BASE_WRAP_TOP = 'mt-2 border-b border-b-selected w-full relative text-white'
    const BASE_WRAP_BOTTOM = 'border-t border-t-selected w-full relative text-white'
    const BASE_POPOVER_TOP = 'absolute w-20 min-w-20 flex border-b-selected border-b bg-bgcolor flex-col items-center pt-2 rounded-b-md z-20 pb-2'
    const BASE_POPOVER_BOTTOM = 'absolute bottom-full w-20 min-w-20 flex border-t-selected border-t bg-bgcolor flex-col items-center pt-2 rounded-t-md z-20 pb-2'
    const BASE_MENU_BUTTON = 'flex items-center justify-center py-2 flex-col gap-1 w-full'

    beforeEach(() => {
        homeChrome.landing = false
        selectedCharID.set(-1)
        PlaygroundStore.set(0)
    })

    afterEach(() => {
        homeChrome.landing = false
        selectedCharID.set(-1)
        PlaygroundStore.set(0)
    })

    test.each([false, true])('Home shows only the docked rail even when the sidebar was closed (menuSideBar %s)', (menuSideBar) => {
        homeChrome.landing = true
        const target = mountSidebar({ menuSideBar }, true)
        expect(rootOf(target)?.classList.contains('home-landing-rail')).toBe(true)
        expect(rootOf(target)?.classList.contains('flex')).toBe(true)
        expect(panelOf(target)).toBeNull()
        expect(get(sideBarStore)).toBe(false)
    })

    test('entering Home hides the docked panel and opening a chat restores it', () => {
        sideBarStore.set(true)
        const target = mountSidebar({
            characters: [{ chaId: 'c1', name: 'Synthetic', chats: [{ name: 'Chat 1', message: [], id: 'chat-1' }], chatPage: 0, image: '' }],
        })
        expect(panelOf(target)).not.toBeNull()

        homeChrome.landing = true
        flushSync()
        expect(panelOf(target)).toBeNull()
        expect(get(sideBarStore)).toBe(true)

        selectedCharID.set(0)
        homeChrome.landing = false
        flushSync()
        expect(panelOf(target)?.classList.contains('flex')).toBe(true)
        expect(rootOf(target)?.classList.contains('home-landing-rail')).toBe(false)
    })

    test('entering Home completes a pending close without an animation event', () => {
        sideBarStore.set(true)
        const target = mountSidebar({})
        sideBarClosing.set(true)
        flushSync()
        expect(panelOf(target)?.classList.contains('risu-sidebar-close')).toBe(true)

        homeChrome.landing = true
        flushSync()
        expect(panelOf(target)).toBeNull()
        expect(rootOf(target)?.classList.contains('risu-sub-sidebar-close')).toBe(false)
        expect(get(sideBarClosing)).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    test('an open Home rail overlay keeps a backdrop that closes without an animation event', () => {
        DynamicGUI.set(true)
        sideBarStore.set(true)
        homeChrome.landing = true
        const target = mountSidebar({})
        expect(panelOf(target)).toBeNull()
        expect(rootOf(target)?.classList.contains('home-landing-rail')).toBe(true)

        const backdrop = target.querySelector<HTMLElement>('[role="button"][data-panel-surface]')
        expect(backdrop).not.toBeNull()
        backdrop!.click()
        flushSync()
        expect(get(sideBarClosing)).toBe(false)
        expect(get(sideBarStore)).toBe(false)
    })

    for (const bottom of [false, true]) {
        test(`S5-R2: the open menu popover is inside the Home rail (hamburgerButtonBottom ${bottom})`, () => {
            homeChrome.landing = true
            const target = mountSidebar({ hamburgerButtonBottom: bottom })
            target.querySelector<HTMLButtonElement>('button.min-w-14')!.click()
            flushSync()
            const popover = target.querySelector('[data-rail-menu]')
            expect(popover).not.toBeNull()
            expect(rootOf(target)!.classList.contains('home-landing-rail')).toBe(true)
            expect(rootOf(target)!.contains(popover)).toBe(true)
            expect(popover!.closest('[data-rail-menu-wrap]')).not.toBeNull()
        })
    }

    test('S5-G1: with the flag off the chat path keeps the base class lists and neither Home class appears', () => {
        selectedCharID.set(0)
        const target = mountSidebar({
            characters: [{ chaId: 'c1', name: 'Synthetic', chats: [{ name: 'Chat 1', message: [], id: 'chat-1' }], chatPage: 0, image: '' }],
        })
        expect(classTokens(rootOf(target))).toEqual(tokensOf(BASE_ROOT))
        expect(classTokens(target.querySelector('button.min-w-14'))).toEqual(tokensOf(BASE_TOGGLE_TOP))
        target.querySelector<HTMLButtonElement>('button.min-w-14')!.click()
        flushSync()
        expect(classTokens(target.querySelector('[data-rail-menu-wrap]'))).toEqual(tokensOf(BASE_WRAP_TOP))
        expect(classTokens(target.querySelector('[data-rail-menu]'))).toEqual(tokensOf(BASE_POPOVER_TOP))
        expect(target.querySelector('.home-landing-rail')).toBeNull()
        expect(panelOf(target)).not.toBeNull()
    })

    test('S5-G1: with the flag off the bottom menu keeps the base class lists', () => {
        selectedCharID.set(0)
        const target = mountSidebar({
            hamburgerButtonBottom: true,
            characters: [{ chaId: 'c1', name: 'Synthetic', chats: [{ name: 'Chat 1', message: [], id: 'chat-1' }], chatPage: 0, image: '' }],
        })
        const toggle = target.querySelector('button.min-w-14')!
        expect(classTokens(toggle)).toEqual(tokensOf(BASE_TOGGLE_BOTTOM))
        ;(toggle as HTMLButtonElement).click()
        flushSync()
        expect(classTokens(target.querySelector('[data-rail-menu-wrap]'))).toEqual(tokensOf(BASE_WRAP_BOTTOM))
        expect(classTokens(target.querySelector('[data-rail-menu]'))).toEqual(tokensOf(BASE_POPOVER_BOTTOM))
        expect(classTokens(rootOf(target))).toEqual(tokensOf(BASE_ROOT))
    })

    test('S5-G1: with the flag off the menu-bar variant keeps its base buttons', () => {
        selectedCharID.set(0)
        const target = mountSidebar({
            menuSideBar: true,
            characters: [{ chaId: 'c1', name: 'Synthetic', chats: [{ name: 'Chat 1', message: [], id: 'chat-1' }], chatPage: 0, image: '' }],
        })
        expect(classTokens(rootOf(target))).toEqual(tokensOf(BASE_ROOT))
        const buttons = Array.from(rootOf(target)!.querySelectorAll(':scope > button'))
        expect(buttons.length).toBe(4)
        const allowed = new Set([...tokensOf(BASE_MENU_BUTTON), 'mt-4', 'text-textcolor2'])
        for (const button of buttons) {
            expect(classTokens(button).filter((token) => !allowed.has(token))).toEqual([])
        }
    })

    test('S5-G1: the Playground keeps the welcome heading and hint with the flag off', () => {
        PlaygroundStore.set(1)
        const target = mountSidebar({})
        const panel = panelOf(target)!
        expect(panel.querySelector('h1')?.textContent).toBe(language.sidebarWelcome)
        expect(panel.textContent).toContain(language.sidebarWelcomeHint)
    })
})
