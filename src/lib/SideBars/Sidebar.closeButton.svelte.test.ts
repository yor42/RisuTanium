// @vitest-environment happy-dom

/**
 * The close strip at the top of the character sidebar is a single button that
 * must show an X icon and carry an accessible name, and must start the close
 * once, ignoring clicks while the close is in progress.
 *
 * Mounts the REAL `Sidebar.svelte`. Module mocks follow
 * `src/lib/Others/charlistAvatarLookups.svelte.test.ts`: the rune/store module
 * is replaced with a `$state`-backed stand-in, and network, storage and
 * platform modules are inert stubs that these scenarios never exercise.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach } from 'vitest'
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
            isPlainHttpFileSrc: vi.fn(() => false),
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

import { DBState, sideBarClosing } from '../../ts/stores.svelte'
import { language } from '../../lang'
import Sidebar from './Sidebar.svelte'

function buildDb(): Database {
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
    } as unknown as Database
}

function mountSidebar(): { target: HTMLElement; app: Record<string, unknown> } {
    DBState.db = buildDb()
    sideBarClosing.set(false)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return { target, app }
}

function closeButton(root: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(root.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === language.closeSidebar,
    )
}

describe('character sidebar close strip', () => {
    let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

    afterEach(async () => {
        if (mounted) {
            await unmount(mounted.app as never)
            mounted.target.remove()
            mounted = null
        }
    })

    test('regression reproducer: the close button is found by its accessible name and contains an svg icon', () => {
        mounted = mountSidebar()
        const btn = closeButton(mounted.target)
        expect(btn).toBeDefined()
        expect(btn!.getAttribute('title')).toBe(language.closeSidebar)
        expect(btn!.querySelector('svg')).not.toBeNull()
        expect(btn!.querySelector('button')).toBeNull()
    })

    test('guard (post-fix, finds the button by its new name): clicking the close button starts the close', () => {
        mounted = mountSidebar()
        expect(get(sideBarClosing)).toBe(false)
        closeButton(mounted.target)!.click()
        expect(get(sideBarClosing)).toBe(true)
    })

    test('guard (post-fix, finds the button by its new name): a second click while closing leaves sideBarClosing true', () => {
        mounted = mountSidebar()
        const btn = closeButton(mounted.target)!
        btn.click()
        const writes: boolean[] = []
        const unsubscribe = sideBarClosing.subscribe((v) => writes.push(v))
        writes.length = 0
        btn.click()
        unsubscribe()
        expect(get(sideBarClosing)).toBe(true)
        expect(writes).toEqual([])
    })
})
