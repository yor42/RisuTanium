// @vitest-environment jsdom

/**
 * `App.svelte` keeps the chat screen mounted while Settings is open and rebuilds nothing else
 * about the chat. The sidebar and the Settings page still come and go.
 *
 * MOCKED: every child component of the app, as in `App.bootScreen.svelte.test.ts`. `ChatScreen`,
 * `Sidebar` and `Settings` are counting stand-ins (`App.keepChatCountingStub.svelte`) that record
 * how often each is mounted and destroyed; the application's stores are plain writables.
 * `chatSurface.svelte.ts` is real and installed by `App.svelte` itself.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
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
        selectedCharID: writable(-1),
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

import { settingsOpen } from './ts/stores.svelte'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { chatSurface, resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts, stubCount } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { noteTopLevelChange, resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
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

/** Svelte sets `inert` as a property; jsdom keeps it as a plain property rather than an attribute. */
function isInert(element: HTMLElement): boolean {
    return (element as HTMLElement & { inert?: boolean }).inert === true
}

function setSettingsOpen(open: boolean) {
    ;(settingsOpen as unknown as { set(value: boolean): void }).set(open)
    flushSync()
}

describe('App keeps the chat screen mounted while Settings is open', () => {
    test('the chat screen mounts once across open and close; the sidebar is destroyed and recreated', async () => {
        await showApp()
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('sidebar')).toEqual({ mounts: 1, destroys: 0 })

        setSettingsOpen(true)
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('sidebar').destroys).toBe(1)
        expect(stubCount('settings').mounts).toBe(1)
        expect(chatSurface.hidden).toBe(true)

        setSettingsOpen(false)
        await tick()
        flushSync()
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
        expect(stubCount('sidebar').mounts).toBe(2)
        expect(stubCount('settings').destroys).toBe(1)
        expect(chatSurface.hidden).toBe(false)
    })

    test('the chat wrapper is display:none and inert while Settings is open, and neither after', async () => {
        const root = await showApp()
        const wrapper = root.querySelector<HTMLElement>('[data-chat-surface]')
        expect(wrapper).not.toBeNull()
        expect(wrapper!.style.display).toBe('contents')
        expect(isInert(wrapper!)).toBe(false)

        setSettingsOpen(true)
        expect(root.querySelector('[data-chat-surface]')).toBe(wrapper)
        expect(wrapper!.style.display).toBe('none')
        expect(isInert(wrapper!)).toBe(true)

        setSettingsOpen(false)
        expect(wrapper!.style.display).toBe('contents')
        expect(isInert(wrapper!)).toBe(false)
    })

    test('a UI language change during the visit remounts the chat once; an idle visit and a non-language change keep it', async () => {
        await showApp()
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })

        setSettingsOpen(true)
        setSettingsOpen(false)
        await tick()
        flushSync()
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })

        setSettingsOpen(true)
        noteTopLevelChange()
        setSettingsOpen(false)
        await tick()
        flushSync()
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })

        setSettingsOpen(true)
        changeLanguage('ko')
        setSettingsOpen(false)
        await tick()
        flushSync()
        expect(stubCount('chat')).toEqual({ mounts: 2, destroys: 1 })
        expect(chatSurface.hidden).toBe(false)

        setSettingsOpen(true)
        setSettingsOpen(false)
        await tick()
        flushSync()
        expect(stubCount('chat')).toEqual({ mounts: 2, destroys: 1 })
    })
})
