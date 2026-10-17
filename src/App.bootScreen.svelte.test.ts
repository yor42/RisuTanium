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
vi.mock('./lib/UI/Realm/RealmFrame.svelte', stub)
vi.mock('./lib/Others/SavePopupIcon.svelte', stub)
vi.mock('./lib/Setting/botpreset.svelte', stub)
vi.mock('./lib/Setting/listedPersona.svelte', stub)
vi.mock('./lib/Mobile/MobileHeader.svelte', stub)
vi.mock('./lib/Mobile/MobileBody.svelte', stub)
vi.mock('./lib/Mobile/MobileFooter.svelte', stub)
vi.mock('./lib/Setting/Pages/CustomGUISettingMenu.svelte', stub)
vi.mock('./lib/Others/HypaV3Modal.svelte', stub)
vi.mock('./lib/Others/HypaV3Progress.svelte', stub)
vi.mock('./lib/Others/PluginAlertModal.svelte', stub)
vi.mock('./lib/UI/PopupList.svelte', stub)
vi.mock('./lib/Others/ProTools/EasyPanel.svelte', stub)
vi.mock('./lib/Others/PopupEditor.svelte', stub)
vi.mock('./lib/Others/LoadoutModal.svelte', stub)
vi.mock('./lib/Others/IrisModal.svelte', stub)
vi.mock('./lib/Others/Legal.svelte', stub)
vi.mock('./lib/Others/CustomSidebarConfig.svelte', stub)

vi.mock('./ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DynamicGUI: writable(false),
        settingsOpen: writable(false),
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(false),
        openPresetList: writable(false),
        openPersonaList: writable(false),
        MobileGUI: writable(false),
        CustomGUISettingMenuStore: writable(false),
        loadedStore: writable(false),
        alertStore: writable({ type: 'none', msg: '' }),
        LoadingStatusState: { text: 'Checking Files...' },
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
vi.mock('./ts/storage/tauriByteTransport', () => ({ isAndroidTransport: () => false }))

import { loadedStore } from './ts/stores.svelte'
import { askBootScreen, resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
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
        expect(root.textContent).not.toContain('Loading...')
    })

    test('guard: with no boot screen the loading screen is shown', async () => {
        const root = await showApp({})
        expect(root.textContent).toContain('Loading...')
        expect(root.querySelector('h1')).toBeNull()
    })

    test('once the database is loaded a screen that is still set no longer covers the app', async () => {
        const root = await showApp({ bootScreen: true, loaded: true })
        expect(root.textContent).not.toContain('A boot question')
    })

    test('the legal notice still comes first: with it unconfigured the boot screen is not shown over it', async () => {
        const root = await showApp({ bootScreen: true, legalConfigured: false })
        expect(root.textContent).not.toContain('A boot question')
    })
})
