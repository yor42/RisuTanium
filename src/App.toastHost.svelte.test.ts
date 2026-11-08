// @vitest-environment jsdom

/**
 * `App.svelte` mounts the one toast host after the second inert scope, so it is outside both scopes: a covering
 * alert suspends it through its own `covered` prop, and an undo toast posted while Settings is open survives
 * Settings closing.
 *
 * MOCKED: every child component of the app, as in `App.studioMount.svelte.test.ts`; the application's stores are
 * plain writables. The toast host and its module are real.
 */
import { flushSync, mount, unmount } from 'svelte'
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
vi.mock('./lib/Others/GridCatalog.svelte', () => countingStub('grid')())
vi.mock('./lib/Studio/StudioScreen.svelte', () => countingStub('studio')())
vi.mock('./ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('./lib/Others/AlertComp.svelte', stub)
vi.mock('./lib/UI/Realm/RealmPopUp.svelte', stub)
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

import { alertStore, settingsOpen } from './ts/stores.svelte'
import { studioOpen } from './ts/studio/studioOpen'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'
import { postUndoToast, resetToastHostForTests } from './ts/toast/toastHost.svelte'

type Writable<T> = { set(value: T): void }

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
    resetToastHostForTests()
})

afterEach(async () => {
    if (mountedApp !== null && target !== null) {
        await unmount(mountedApp as never)
        target.remove()
    }
    mountedApp = null
    target = null
    resetToastHostForTests()
    resetChatSurfaceForTests()
    resetTopLevelChangesForTests()
    changeLanguage('en')
    resetBootScreenForTests()
    ;(settingsOpen as unknown as Writable<boolean>).set(false)
    ;(alertStore as unknown as Writable<{ type: string, msg: string }>).set({ type: 'none', msg: '' })
    studioOpen.set(false)
    vi.useRealTimers()
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

function setSettingsOpen(open: boolean) {
    ;(settingsOpen as unknown as Writable<boolean>).set(open)
    flushSync()
}

/** Svelte sets `inert` as a property; jsdom keeps it as a plain property rather than an attribute. */
function insideInertScope(element: HTMLElement): boolean {
    for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
        if ((node as HTMLElement & { inert?: boolean }).inert === true) {
            return true
        }
    }
    return false
}

function addUndoToast() {
    return postUndoToast({
        text: 'Removed "X"',
        actionLabel: 'Undo',
        action: { id: 'x', run: () => ({ ok: true, text: 'Back' }), failedText: 'FAILED' },
    })
}

describe('App mounts the toast host', () => {
    test('TA1 exactly one host, outside both inert scopes, suspended by a covering alert', async () => {
        const root = await showApp()
        expect(document.querySelectorAll('[data-part="toast-host"]')).toHaveLength(1)
        const host = root.querySelector<HTMLElement>('[data-part="toast-host"]')!
        expect(host.hasAttribute('data-suspended')).toBe(false)
        expect(insideInertScope(host)).toBe(false)

        ;(alertStore as unknown as Writable<{ type: string, msg: string }>).set({ type: 'ask', msg: 'Sure?' })
        flushSync()
        expect(host.hasAttribute('data-suspended')).toBe(true)
        // The page content is inert under a covering alert; the host is not inside that scope.
        expect(insideInertScope(root.querySelector<HTMLElement>('[data-stub="sidebar"]')!)).toBe(true)
        expect(insideInertScope(host.parentElement!)).toBe(false)
    })

    test('TA2 an undo toast posted while Settings is open is still shown after Settings closes', async () => {
        await showApp()
        setSettingsOpen(true)
        addUndoToast()
        flushSync()
        expect(document.querySelector('[data-part="toast-action"]')).not.toBeNull()
        setSettingsOpen(false)
        expect(document.querySelector('[data-part="toast-action"]')).not.toBeNull()
    })
})
