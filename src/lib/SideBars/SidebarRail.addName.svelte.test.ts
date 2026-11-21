// @vitest-environment happy-dom

/**
 * The "+" add-character button at the end of the REAL `SidebarRail.svelte` (mounted through the real
 * `Sidebar.svelte`) is named "Add Character" and its glyph is hidden from assistive technology.
 * The mock set is that of `SidebarRail.hidden.svelte.test.ts`.
 */
import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
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
            saveAsset: vi.fn(async () => 'asset-1'),
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

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { controlName, exposedIcons } from 'src/lib/a11yNames.test-helpers'
import Sidebar from './Sidebar.svelte'
import { defaultSettle, installGeometry, resetRailMemory } from './sidebarDnd.testKit'

let mounted: { target: HTMLElement; app: Record<string, unknown> } | null = null

async function settle(): Promise<void> {
    await defaultSettle()
    await tick()
    await defaultSettle()
}

async function mountRail(): Promise<HTMLElement> {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['a', 'b'],
        characters: ['a', 'b'].map((chaId) => ({ chaId, name: chaId, image: '', type: 'character', chats: [], chatPage: 0 })),
        hideAllImages: false,
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Sidebar, { target, props: {} }) as unknown as Record<string, unknown>
    mounted = { target, app }
    await settle()
    installGeometry(target, 2000)
    await settle()
    return target
}

beforeEach(() => {
    resetRailMemory()
    selectedCharID.set(-1)
})

afterEach(async () => {
    try {
        if (mounted) {
            await unmount(mounted.app as never)
            mounted.target.remove()
            mounted = null
        }
    } catch {
        // a sidebar that failed half way through mounting is torn down best effort
    }
    document.body.innerHTML = ''
})

describe('rail add-character button', () => {
    test('regression reproducer: the plus button is named "Add Character" and its glyph is hidden', async () => {
        const root = await mountRail()
        const plus = root.querySelector<HTMLElement>('[role="listitem"]:last-of-type button')
        expect(plus, 'plus button').not.toBeNull()
        expect(controlName(plus!)).toBe(language.addCharacter)
        expect(plus!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
        expect(exposedIcons(plus!, { extra: ['svg'] })).toEqual([])
    })
})
