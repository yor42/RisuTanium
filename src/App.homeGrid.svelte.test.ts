// @vitest-environment jsdom

/**
 * `App.svelte`: the App-level grid and the chat surface (which holds Home) are exclusive. While the
 * grid is open the chat surface, and so Home with its embedded library, is unmounted; closing the
 * grid mounts it again. At most one character library exists at a time.
 *
 * MOCKED: every child component of the app, as in `App.studioMount.svelte.test.ts`; `Sidebar`,
 * `ChatScreen`, `Settings`, `GridCatalog` and `StudioScreen` are counting stand-ins, and `Sidebar` and
 * `GridCatalog` hand their `openGrid` and `endGrid` props to the test.
 *
 * This is a compatibility guard: it passes before and after the Home shell.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const gridProps = vi.hoisted(() => ({ openGrid: null as (() => void) | null, endGrid: null as (() => void) | null }))
const countingStub = (kind: string) => async () => {
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
            gridProps.openGrid = props.openGrid ?? null
            return Counting(anchor, { kind: 'sidebar' })
        },
    }
})
vi.mock('./lib/Others/GridCatalog.svelte', async () => {
    const { default: Counting } = await import('./App.keepChatCountingStub.svelte')
    return {
        default: (anchor: Parameters<typeof Counting>[0], props: { endGrid?: () => void }) => {
            gridProps.endGrid = props.endGrid ?? null
            return Counting(anchor, { kind: 'grid' })
        },
    }
})
vi.mock('./lib/ChatScreens/ChatScreen.svelte', () => countingStub('chat')())
vi.mock('./lib/Setting/Settings.svelte', () => countingStub('settings')())
vi.mock('./lib/SettingsShell/SettingsShell.svelte', stub)
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

import { studioOpen } from './ts/studio/studioOpen'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
    gridProps.openGrid = null
    gridProps.endGrid = null
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

const shown = (root: HTMLElement, kind: string): number => root.querySelectorAll(`[data-stub="${kind}"]`).length

describe('App grid and chat surface exclusivity', () => {
    test('guard: opening the grid unmounts the chat surface, closing it mounts the chat surface again', async () => {
        const root = await showApp()
        expect(shown(root, 'chat')).toBe(1)
        expect(shown(root, 'grid')).toBe(0)
        expect(gridProps.openGrid).not.toBeNull()

        gridProps.openGrid!()
        flushSync()
        expect(shown(root, 'chat')).toBe(0)
        expect(root.querySelector('[data-chat-surface]')).toBeNull()
        expect(shown(root, 'grid')).toBe(1)
        expect(gridProps.endGrid).not.toBeNull()

        gridProps.endGrid!()
        flushSync()
        expect(shown(root, 'chat')).toBe(1)
        expect(shown(root, 'grid')).toBe(0)
    })
})
