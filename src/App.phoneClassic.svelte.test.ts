// @vitest-environment jsdom

/**
 * `App.svelte` renders one layout at every width and for every saved `betaMobileGUI` value: the
 * sidebar, the chat and, while Settings is open, the Settings screen with the chat kept mounted.
 * A phone-width window and a database that still holds `betaMobileGUI: true` take the same
 * branch as a desktop window, and so does a Lite build. A stale `MobileGUI` store that is true
 * changes nothing either.
 *
 * MOCKED: every child component of the app, as in `App.keepChat.svelte.test.ts`. `ChatScreen`,
 * `Sidebar` and `Settings` are counting stand-ins (`App.keepChatCountingStub.svelte`); the
 * application's stores are plain writables. `chatSurface.svelte.ts` is real and installed by
 * `App.svelte` itself.
 *
 * All three tests are guards: they pass with or without the removal of the Beta Mobile GUI.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const countingStub = (kind: string) => async () => {
    const { default: Counting } = await import('./App.keepChatCountingStub.svelte')
    return { default: (anchor: Parameters<typeof Counting>[0], props: object) => Counting(anchor, { ...props, kind }) }
}

vi.mock('@lucide/svelte', () => {
    const icon = () => { }
    return { ArrowUpIcon: icon, GlobeIcon: icon, PlusIcon: icon }
})
vi.mock('./lib/SideBars/Sidebar.svelte', () => countingStub('sidebar')())
vi.mock('./lib/ChatScreens/ChatScreen.svelte', () => countingStub('chat')())
vi.mock('./lib/Setting/Settings.svelte', () => countingStub('settings')())
vi.mock('./lib/SettingsShell/SettingsShell.svelte', stub)
vi.mock('./lib/Others/AlertComp.svelte', stub)
vi.mock('./lib/UI/Realm/RealmPopUp.svelte', stub)
vi.mock('./lib/Others/GridCatalog.svelte', stub)
vi.mock('./lib/Others/WelcomeRisu.svelte', stub)
vi.mock('./lib/Others/BookmarkList.svelte', stub)
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
    return {
        DynamicGUI: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
        selIdState: { selId: -1 },
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(false),
        openPresetList: writable(false),
        openPersonaList: writable(false),
        // The kept store: always false in production. It is listed so a test can force it true and
        // show that App no longer reads it.
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
        CustomGUISettingMenuStore: writable(false),
        loadedStore: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
        LoadingStatusState: { text: '' },
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

import { DBState, MobileGUI, settingsOpen } from './ts/stores.svelte'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts, stubCount } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { isLite } from './ts/lite'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.stubGlobal('innerWidth', 400)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    // No device switch is stored, so Settings opens as the legacy screen: the `settings` stand-in.
    localStorage.clear()
    resetStubCounts()
    DBState.db = { didFirstSetup: true, betaMobileGUI: true } as unknown as typeof DBState.db
})

afterEach(async () => {
    if (mountedApp !== null && target !== null) {
        await unmount(mountedApp as never)
        target.remove()
    }
    mountedApp = null
    target = null
    resetChatSurfaceForTests()
    resetTopLevelChangesForTests()
    changeLanguage('en')
    resetBootScreenForTests()
    ;(settingsOpen as unknown as { set(value: boolean): void }).set(false)
    ;(MobileGUI as unknown as { set(value: boolean): void }).set(false)
    isLite.set(false)
    DBState.db = { didFirstSetup: true } as unknown as typeof DBState.db
    localStorage.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

async function showApp() {
    const { default: App } = await import('./App.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedApp = mount(App, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return target
}

async function setSettingsOpen(open: boolean) {
    ;(settingsOpen as unknown as { set(value: boolean): void }).set(open)
    flushSync()
    await tick()
    flushSync()
}

describe('App renders one layout whatever the saved Beta Mobile GUI value and the width', () => {
    test('guard: at phone width with betaMobileGUI saved true, the sidebar and chat mount once and Settings replaces the sidebar with the chat kept', async () => {
        await showApp()
        expect(stubCount('sidebar')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('settings').mounts).toBe(0)

        await setSettingsOpen(true)
        expect(stubCount('settings').mounts).toBe(1)
        expect(stubCount('sidebar').destroys).toBe(1)
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
    })

    test('guard: a Lite build gets the same layout', async () => {
        isLite.set(true)
        await showApp()
        expect(stubCount('sidebar')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })

        await setSettingsOpen(true)
        expect(stubCount('settings').mounts).toBe(1)
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
    })

    test('guard: a MobileGUI store forced true does not change the layout', async () => {
        ;(MobileGUI as unknown as { set(value: boolean): void }).set(true)
        await showApp()
        expect(stubCount('sidebar')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })

        await setSettingsOpen(true)
        expect(stubCount('settings').mounts).toBe(1)
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
    })
})
