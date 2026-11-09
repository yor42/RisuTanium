// @vitest-environment jsdom

/**
 * `App.svelte` shows the boot screen after the legal notice and before the April-fools page: a boot prompt that arrives on
 * 1 April is still shown. The screen is shown only while the database is not loaded. Labels: new behaviour (the branch
 * order is a regression guard for the April-fools page covering a prompt).
 *
 * MOCKED: every child component of the app (empty stand-ins), the application's stores (plain stores holding the values
 * the app starts with) and the modules `App.svelte` imports for behaviour this test does not touch. `AlertInertScope`,
 * `BootScreen` and the boot screen state are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const transport = vi.hoisted(() => ({ android: false }))

vi.mock('@lucide/svelte', () => {
    const icon = () => { }
    return { ArrowUpIcon: icon, GlobeIcon: icon, PlusIcon: icon }
})
vi.mock('./lib/SideBars/Sidebar.svelte', stub)
vi.mock('./lib/ChatScreens/ChatScreen.svelte', stub)
vi.mock('./lib/Others/AlertComp.svelte', stub)
vi.mock('./lib/UI/Realm/RealmPopUp.svelte', stub)
vi.mock('./lib/Others/GridCatalog.svelte', stub)
vi.mock('./lib/Others/WelcomeRisu.svelte', stub)
vi.mock('./lib/Others/BookmarkList.svelte', stub)
vi.mock('./lib/Setting/Settings.svelte', stub)
vi.mock('./lib/SettingsShell/SettingsShell.svelte', stub)
vi.mock('./lib/UI/Realm/RealmFrame.svelte', stub)
vi.mock('./lib/Others/SavePopupIcon.svelte', stub)
vi.mock('./lib/Setting/botpreset.svelte', stub)
vi.mock('./lib/Setting/listedPersona.svelte', stub)
vi.mock('./lib/Setting/Pages/CustomGUISettingMenu.svelte', stub)
vi.mock('./lib/Others/HypaV3Modal.svelte', stub)
vi.mock('./lib/Others/HypaV3Progress.svelte', stub)
vi.mock('./lib/UI/PopupList.svelte', stub)
vi.mock('./lib/Others/ProTools/EasyPanel.svelte', stub)
vi.mock('./lib/Others/PopupEditor.svelte', stub)
vi.mock('./lib/Others/LoadoutModal.svelte', stub)
vi.mock('./lib/Others/IrisModal.svelte', stub)
vi.mock('./lib/Others/Legal.svelte', stub)
vi.mock('./lib/Others/CustomSidebarConfig.svelte', stub)

vi.mock('./ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const LoadingStatusState = $state({ text: 'Checking Files...' })
    return {
        DynamicGUI: writable(false),
        settingsOpen: writable(false),
        selectedCharID: writable(-1),
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(false),
        openPresetList: writable(false),
        openPersonaList: writable(false),
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
        CustomGUISettingMenuStore: writable(false),
        loadedStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        LoadingStatusState,
        bookmarkListOpen: writable(false),
        popupStore: { children: null },
        easyPanelStore: { open: false },
        popUpEditorStore: { open: false },
        loadoutModalStore: { open: false },
        irisStore: { open: false },
        customSideBarConfigDialogStore: { open: false },
        hypaV3ModalOpen: writable(false),
        hypaV3ProgressStore: writable({ open: false }),
        DBState: { db: { didFirstSetup: true } },
    }
})
vi.mock('./ts/characterCards', async () => {
    const { writable } = await import('svelte/store')
    return { showRealmInfoStore: writable(null) }
})
vi.mock('./ts/storage/database.svelte', () => ({ getDatabase: () => ({}), setDatabase: () => { } }))
vi.mock('./ts/dropImport', () => ({ importDroppedFile: async () => { } }))
vi.mock('./ts/keepAliveAudio', () => ({ createKeepAliveAudio: () => ({}) }))
vi.mock('./ts/storage/tauriByteTransport', () => ({ isAndroidTransport: () => transport.android }))

import { loadedStore, LoadingStatusState } from './ts/stores.svelte'
import { askBootScreen, clearBootScreen, resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    LoadingStatusState.text = 'Checking Files...'
    transport.android = false
})

afterEach(async () => {
    if (mountedApp !== null && target !== null) {
        await unmount(mountedApp as never)
        target.remove()
    }
    mountedApp = null
    target = null
    resetBootScreenForTests()
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

async function showApp(options: { aprilFools?: boolean, bootScreen?: boolean, loaded?: boolean, legalConfigured?: boolean }) {
    if (options.legalConfigured === false) {
        vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', '')
    }
    if (options.aprilFools === true) {
        vi.setSystemTime(new Date(2026, 3, 1))
    }
    ;(loadedStore as unknown as { set(value: boolean): void }).set(options.loaded === true)
    if (options.bootScreen === true) {
        void askBootScreen({
            title: 'A boot question',
            paragraphs: [],
            lists: [],
            details: null,
            buttons: [{ key: 'no', label: 'No' }],
            focus: 'no',
        })
    }
    const { default: App } = await import('./App.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedApp = mount(App, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return target
}

describe('App shows the boot screen in the right place', () => {
    test('reproducer: on 1 April a boot prompt is still shown, not covered by the April-fools page', async () => {
        const root = await showApp({ aprilFools: true, bootScreen: true })
        expect(root.querySelector('h1')?.textContent).toBe('A boot question')
        expect(root.textContent).not.toContain('What can I help you?')
    })

    test('guard: on 1 April with no boot screen the April-fools page is shown', async () => {
        const root = await showApp({ aprilFools: true })
        expect(root.textContent).toContain('What can I help you?')
    })

    test('the boot screen is shown in place of the loading screen while the database is not loaded', async () => {
        const root = await showApp({ bootScreen: true })
        expect(root.querySelector('h1')?.textContent).toBe('A boot question')
        expect(root.querySelector('[role=progressbar]')).toBeNull()
    })

    test('with no boot screen the startup screen shows the step for the loading text', async () => {
        const root = await showApp({})
        const bar = root.querySelector('[role=progressbar]')
        expect(bar?.getAttribute('aria-valuetext')).toBe('Step 1 of 7: Opening storage')
        expect(root.textContent).toContain('1 / 7')
        expect(root.textContent).not.toContain('Loading...')
        expect(root.querySelector('h1')).toBeNull()
    })

    test('the step follows the loading text', async () => {
        const root = await showApp({})
        LoadingStatusState.text = 'Reading Save File...'
        flushSync()
        expect(root.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toBe('Step 2 of 7: Reading your save')
    })

    test('text the mapping does not know keeps the step before it', async () => {
        const root = await showApp({})
        LoadingStatusState.text = 'Decoding Save File...'
        flushSync()
        LoadingStatusState.text = 'Something new'
        flushSync()
        expect(root.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toBe('Step 3 of 7: Preparing your library')
    })

    test('a boot question replaces the bar, and the bar returns at the current step when it clears', async () => {
        const root = await showApp({ bootScreen: true })
        LoadingStatusState.text = 'Reading Save File...'
        clearBootScreen()
        flushSync()
        expect(root.querySelector('h1')).toBeNull()
        expect(root.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')).toBe('Step 2 of 7: Reading your save')
    })

    test('low power follows the Android transport', async () => {
        transport.android = true
        const android = await showApp({})
        expect(android.querySelector('.nexus-low-power')).not.toBeNull()
        expect(android.querySelector('[role=progressbar]')?.hasAttribute('data-low-power')).toBe(true)
        await unmount(mountedApp as never)
        android.remove()
        mountedApp = null
        transport.android = false
        const other = await showApp({})
        expect(other.querySelector('.nexus-low-power')).toBeNull()
        expect(other.querySelector('[role=progressbar]')?.hasAttribute('data-low-power')).toBe(false)
    })

    test('once the database is loaded a screen that is still set no longer covers the app', async () => {
        const root = await showApp({ bootScreen: true, loaded: true })
        expect(root.textContent).not.toContain('A boot question')
        expect(root.querySelector('[role=progressbar]')).toBeNull()
    })

    test('guard: once the database is loaded the startup screen is gone', async () => {
        const root = await showApp({ loaded: true })
        expect(root.querySelector('[role=progressbar]')).toBeNull()
    })

    test('the legal notice still comes first: with it unconfigured the boot screen is not shown over it', async () => {
        const root = await showApp({ bootScreen: true, legalConfigured: false })
        expect(root.textContent).not.toContain('A boot question')
    })
})
