// @vitest-environment jsdom

/**
 * `App.svelte` mounts Studio over the kept-mounted chat screen on the desktop layout: while the
 * Studio flag is set the sidebar and the grid are absent, the chat surface stays mounted but is
 * `display:none` and inert, and Settings wins when both flags are set.
 *
 * MOCKED: every child component of the app, as in `App.keepChat.svelte.test.ts`; `Sidebar`,
 * `ChatScreen`, `Settings`, `GridCatalog` and `StudioScreen` are counting stand-ins. The Studio
 * flag is the real leaf store; the application's other stores are plain writables.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const sidebarProps = vi.hoisted(() => ({ openGrid: null as (() => void) | null }))
const alertErrorSpy = vi.hoisted(() => vi.fn())
const countingStub =(kind: string) => async () => {
    const { default: Counting } = await import('./App.keepChatCountingStub.svelte')
    return { default: (anchor: Parameters<typeof Counting>[0], props: object) => Counting(anchor, { ...props, kind }) }
}

vi.mock('@lucide/svelte', () => {
    const icon = () => { }
    return { ArrowUpIcon: icon, GlobeIcon: icon, PlusIcon: icon }
})
vi.mock('./lib/SideBars/Sidebar.svelte', async () => {
    const { default: Counting } = await import('./App.keepChatCountingStub.svelte')
    return {
        default: (anchor: Parameters<typeof Counting>[0], props: { openGrid?: () => void }) => {
            sidebarProps.openGrid = props.openGrid ?? null
            return Counting(anchor, { kind: 'sidebar' })
        },
    }
})
vi.mock('./lib/ChatScreens/ChatScreen.svelte', () => countingStub('chat')())
vi.mock('./lib/Setting/Settings.svelte', () => countingStub('settings')())
vi.mock('./lib/SettingsShell/SettingsShell.svelte', stub)
vi.mock('./lib/Others/GridCatalog.svelte', () => countingStub('grid')())
vi.mock('./lib/Studio/StudioScreen.svelte', () => countingStub('studio')())
vi.mock('./ts/alert', () => ({ alertError: alertErrorSpy }))
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
import { studioOpen } from './ts/studio/studioOpen'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { chatSurface, resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts, stubCount } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
    sidebarProps.openGrid = null
    vi.doMock('./lib/Studio/StudioScreen.svelte', () => countingStub('studio')())
    vi.doUnmock('./ts/studio/studioScreen.svelte')
    alertErrorSpy.mockClear()
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

/** Svelte sets `inert` as a property; jsdom keeps it as a plain property rather than an attribute. */
function isInert(element: HTMLElement): boolean {
    return (element as HTMLElement & { inert?: boolean }).inert === true
}

function setSettingsOpen(open: boolean) {
    ;(settingsOpen as unknown as { set(value: boolean): void }).set(open)
    flushSync()
}

/** Studio is imported lazily; let the dynamic import settle and render. */
async function settleLazyImports() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await tick()
        flushSync()
    }
}

async function setStudioOpen(open: boolean) {
    studioOpen.set(open)
    flushSync()
    await settleLazyImports()
}

describe('App mounts Studio over the kept-mounted chat screen', () => {
    test('a Studio screen that fails to load closes Studio, shows the chat again and reports the error', async () => {
        vi.doMock('./lib/Studio/StudioScreen.svelte', () => { throw new Error('chunk failed to load') })
        // The failure handler must use only App's static flag; a lazy import of the Studio state module fails here.
        vi.doMock('./ts/studio/studioScreen.svelte', () => { throw new Error('the failure handler must not import the Studio state module') })
        const root = await showApp()
        const wrapper = root.querySelector<HTMLElement>('[data-chat-surface]')

        await setStudioOpen(true)
        await settleLazyImports()

        expect(get(studioOpen)).toBe(false)
        expect(stubCount('studio').mounts).toBe(0)
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(alertErrorSpy.mock.calls[0][0]).toBeInstanceOf(Error)
        expect(wrapper!.style.display).toBe('contents')
        expect(isInert(wrapper!)).toBe(false)
        expect(root.querySelector('[data-stub="sidebar"]')).not.toBeNull()
    }, 15000)

    test('Studio is shown, the sidebar is gone, and the chat surface is display:none and inert but still mounted', async () => {
        const root = await showApp()
        const wrapper = root.querySelector<HTMLElement>('[data-chat-surface]')
        expect(wrapper).not.toBeNull()
        expect(wrapper!.style.display).toBe('contents')
        expect(isInert(wrapper!)).toBe(false)
        expect(stubCount('studio').mounts).toBe(0)

        await setStudioOpen(true)

        expect(stubCount('studio').mounts).toBe(1)
        expect(root.querySelector('[data-stub="studio"]')).not.toBeNull()
        expect(root.querySelector('[data-stub="sidebar"]')).toBeNull()
        expect(stubCount('sidebar').destroys).toBe(1)
        expect(root.querySelector('[data-chat-surface]')).toBe(wrapper)
        expect(wrapper!.style.display).toBe('none')
        expect(isInert(wrapper!)).toBe(true)
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
        expect(chatSurface.hidden).toBe(true)

        await setStudioOpen(false)

        expect(root.querySelector('[data-stub="studio"]')).toBeNull()
        expect(stubCount('studio').destroys).toBe(1)
        expect(root.querySelector('[data-stub="sidebar"]')).not.toBeNull()
        expect(wrapper!.style.display).toBe('contents')
        expect(isInert(wrapper!)).toBe(false)
        expect(stubCount('chat')).toEqual({ mounts: 1, destroys: 0 })
        expect(chatSurface.hidden).toBe(false)
    })

    test('the grid is not shown while Studio is open', async () => {
        const root = await showApp()
        expect(sidebarProps.openGrid).not.toBeNull()
        sidebarProps.openGrid!()
        flushSync()
        expect(root.querySelector('[data-stub="grid"]')).not.toBeNull()

        await setStudioOpen(true)

        expect(root.querySelector('[data-stub="grid"]')).toBeNull()
        expect(root.querySelector('[data-stub="studio"]')).not.toBeNull()
        expect(root.querySelector('[data-stub="sidebar"]')).toBeNull()
    })

    test('Settings wins when both flags are set: Studio is not rendered with it', async () => {
        const root = await showApp()
        await setStudioOpen(true)
        expect(stubCount('studio').mounts).toBe(1)

        setSettingsOpen(true)
        await setStudioOpen(true)

        expect(root.querySelector('[data-stub="studio"]')).toBeNull()
        expect(stubCount('studio').destroys).toBe(1)
        expect(root.querySelector('[data-stub="settings"]')).not.toBeNull()
        const wrapper = root.querySelector<HTMLElement>('[data-chat-surface]')
        expect(wrapper!.style.display).toBe('none')
        expect(isInert(wrapper!)).toBe(true)
    })

    test('Settings and Studio both set from the start: only Settings renders', async () => {
        studioOpen.set(true)
        setSettingsOpen(true)
        const root = await showApp()
        await settleLazyImports()

        expect(root.querySelector('[data-stub="settings"]')).not.toBeNull()
        expect(stubCount('studio').mounts).toBe(0)
    })

    test('closing Settings while the Studio flag is still set shows Studio, and the chat stays hidden', async () => {
        const root = await showApp()
        setSettingsOpen(true)
        await setStudioOpen(true)
        expect(stubCount('studio').mounts).toBe(0)

        setSettingsOpen(false)
        await setStudioOpen(true)

        expect(root.querySelector('[data-stub="studio"]')).not.toBeNull()
        const wrapper = root.querySelector<HTMLElement>('[data-chat-surface]')
        expect(wrapper!.style.display).toBe('none')
        expect(isInert(wrapper!)).toBe(true)
    })

    test('guard: with Studio closed the layout is the plain chat layout', async () => {
        const root = await showApp()
        expect(root.querySelector('[data-stub="studio"]')).toBeNull()
        expect(root.querySelector('[data-stub="sidebar"]')).not.toBeNull()
        expect(root.querySelector<HTMLElement>('[data-chat-surface]')!.style.display).toBe('contents')
    })
})
