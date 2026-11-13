// @vitest-environment jsdom

/**
 * App state table of the theme-pack surface gate (T3G-2), all GUARD: the gate is new code, so no base fails for a reason
 * other than a missing module. A registered chat sheet is on exactly while the chat surface is declared and App's cover
 * is off (rows 17 and 18), and off in every other state.
 *
 * REAL: App.svelte, surfaceGate.svelte.ts (installed by App itself), chatSurface.svelte.ts. MOCKED: every child component
 * of the app, as in `App.keepChat.svelte.test.ts`. ChatScreen is `App.themeGateChatStub.svelte`, which declares the chat
 * surface only while the test's shell flag is set; the stores are plain writables, the Studio flag is the real leaf store.
 * Rows 2 and 3 of the table (the store2 boot screen and the April-fools page) precede the loaded branch, so ChatScreen
 * cannot mount there and no case is built for them.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const shell = vi.hoisted(() => ({ declares: true }))
const sidebarProps = vi.hoisted(() => ({ openGrid: null as (() => void) | null }))
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
            sidebarProps.openGrid = props.openGrid ?? null
            return Counting(anchor, { kind: 'sidebar' })
        },
    }
})
vi.mock('./lib/ChatScreens/ChatScreen.svelte', async () => {
    const { default: ChatStub } = await import('./App.themeGateChatStub.svelte')
    return { default: (anchor: Parameters<typeof ChatStub>[0]) => ChatStub(anchor, { declares: shell.declares }) }
})
vi.mock('./lib/SettingsShell/SettingsSurface.svelte', () => countingStub('settings')())
vi.mock('./lib/Others/GridCatalog.svelte', () => countingStub('grid')())
vi.mock('./lib/Others/WelcomeRisu.svelte', () => countingStub('welcome')())
vi.mock('./lib/Others/Legal.svelte', () => countingStub('legal')())
vi.mock('./lib/Nexus/boot/NexusBootScreen.svelte', () => countingStub('nexus-boot')())
vi.mock('./lib/Setting/Pages/CustomGUISettingMenu.svelte', () => countingStub('custom-gui')())
vi.mock('./lib/Others/AlertComp.svelte', () => countingStub('alert')())
vi.mock('./lib/Others/BootScreen.svelte', stub)
vi.mock('./lib/UI/Realm/RealmPopUp.svelte', stub)
vi.mock('./lib/Others/BookmarkList.svelte', stub)
vi.mock('./lib/UI/Realm/RealmFrame.svelte', stub)
vi.mock('./lib/Others/SavePopupIcon.svelte', stub)
vi.mock('./lib/Setting/botpreset.svelte', stub)
vi.mock('./lib/Setting/listedPersona.svelte', stub)
vi.mock('./lib/Others/HypaV3Modal.svelte', stub)
vi.mock('./lib/Others/HypaV3Progress.svelte', stub)
vi.mock('./lib/UI/PopupList.svelte', stub)
vi.mock('./lib/Others/ProTools/EasyPanel.svelte', stub)
vi.mock('./lib/Others/PopupEditor.svelte', stub)
vi.mock('./lib/Others/LoadoutModal.svelte', stub)
vi.mock('./lib/Others/IrisModal.svelte', stub)
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

import type { Writable } from 'svelte/store'
import { alertStore, CustomGUISettingMenuStore, DBState, loadedStore, settingsOpen } from './ts/stores.svelte'
import { studioOpen } from './ts/studio/studioOpen'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts, stubCount } from './App.keepChatCountingStub.svelte'
import { changeLanguage } from './lang'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'
import { registerThemePackElement, resetThemePackGateForTests, shownSurface, syncThemePackMedia } from './ts/themePack/surfaceGate.svelte'

const flag = <T,>(store: unknown) => store as Writable<T>

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null
// Whether the StudioScreen chunk of the next mounted app never resolves; applied by `showApp`, which registers the chunk
// mock once per test.
let studioChunkPending = false

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
    shell.declares = true
    sidebarProps.openGrid = null
    studioChunkPending = false
    ;(DBState.db as { didFirstSetup: boolean }).didFirstSetup = true
})

afterEach(async () => {
    // The gate is dropped first: it reads App's `covered`, which an unmounted App no longer owns.
    resetThemePackGateForTests()
    if (mountedApp !== null && target !== null) {
        await unmount(mountedApp as never)
        target.remove()
    }
    mountedApp = null
    target = null
    document.head.innerHTML = ''
    resetChatSurfaceForTests()
    resetTopLevelChangesForTests()
    changeLanguage('en')
    resetBootScreenForTests()
    flag<boolean>(settingsOpen).set(false)
    flag<boolean>(loadedStore).set(true)
    flag<boolean>(CustomGUISettingMenuStore).set(false)
    flag<{ type: string, msg: string }>(alertStore).set({ type: 'none', msg: '' })
    studioOpen.set(false)
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

async function showApp() {
    vi.doMock('./lib/Studio/StudioScreen.svelte', studioChunkPending
        ? () => new Promise(() => { })
        : () => countingStub('studio')())
    const { default: App } = await import('./App.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedApp = mount(App, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return target
}

/** A chat sheet element as the apply code leaves it: registered, created off. */
function sheet(area = 'chat'): HTMLStyleElement {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', area)
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    registerThemePackElement(element, area)
    // The apply step ends with a sync; the gate effect alone only follows later changes.
    syncThemePackMedia()
    return element
}

/** Reads the sheet after the flush the way the browser would, once the apply seam has asked for a sync. */
function media(element: HTMLElement): string | null {
    flushSync()
    return element.getAttribute('media')
}

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

function setSettingsOpen(open: boolean) {
    flag<boolean>(settingsOpen).set(open)
    flushSync()
}

describe('the chat sheet is off wherever no shell is shown', () => {
    test('row 1: legal not configured', async () => {
        vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', '')
        const root = await showApp()
        const element = sheet()
        expect(stubCount('legal').mounts).toBe(1)
        expect(root.querySelector('[data-stub="chat"]')).toBeNull()
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('row 4: Nexus boot (store not loaded)', async () => {
        flag<boolean>(loadedStore).set(false)
        await showApp()
        const element = sheet()
        expect(stubCount('nexus-boot').mounts).toBe(1)
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('row 5: custom GUI menu', async () => {
        flag<boolean>(CustomGUISettingMenuStore).set(true)
        await showApp()
        const element = sheet()
        expect(stubCount('custom-gui').mounts).toBe(1)
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('row 6: Welcome (first setup not done)', async () => {
        ;(DBState.db as { didFirstSetup: boolean }).didFirstSetup = false
        await showApp()
        const element = sheet()
        expect(stubCount('welcome').mounts).toBe(1)
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('row 7: Settings over the shell', async () => {
        await showApp()
        const element = sheet()
        expect(media(element)).toBe('all')
        setSettingsOpen(true)
        expect(stubCount('settings').mounts).toBe(1)
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('row 9: Studio', async () => {
        await showApp()
        const element = sheet()
        expect(media(element)).toBe('all')
        await setStudioOpen(true)
        expect(stubCount('studio').mounts).toBe(1)
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('row 10: the character grid (the chat surface is unmounted)', async () => {
        const root = await showApp()
        const element = sheet()
        expect(media(element)).toBe('all')
        sidebarProps.openGrid!()
        flushSync()
        expect(root.querySelector('[data-stub="grid"]')).not.toBeNull()
        expect(root.querySelector('[data-stub="chat"]')).toBeNull()
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('rows 11 to 16: a chat surface without a declaration (Home, classic chat, group) shows nothing', async () => {
        shell.declares = false
        const root = await showApp()
        const element = sheet()
        expect(root.querySelector('[data-stub="chat"]')).not.toBeNull()
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })

    test('a registered studio or unknown sheet is off even in row 17', async () => {
        await showApp()
        const studio = sheet('studio')
        const unknown = sheet('home')
        const chat = sheet()
        expect(media(chat)).toBe('all')
        expect(media(studio)).toBe('not all')
        expect(media(unknown)).toBe('not all')
    })
})

describe('the chat sheet is on only in rows 17 to 19', () => {
    test('row 17: the shell is declared and not covered', async () => {
        await showApp()
        const element = sheet()
        expect(shownSurface()).toBe('chat')
        expect(media(element)).toBe('all')
    })

    test('row 18: an App-level alert over the shell leaves the sheet on', async () => {
        await showApp()
        const element = sheet()
        flag<{ type: string, msg: string }>(alertStore).set({ type: 'normal', msg: 'hello' })
        flushSync()
        expect(stubCount('alert').mounts).toBe(1)
        expect(shownSurface()).toBe('chat')
        expect(media(element)).toBe('all')
    })

    test('17 to 7 to 17: Settings turns the sheet off and closing it turns it on, with no remount', async () => {
        const root = await showApp()
        const chat = root.querySelector('[data-stub="chat"]')
        const element = sheet()
        expect(media(element)).toBe('all')
        setSettingsOpen(true)
        expect(media(element)).toBe('not all')
        setSettingsOpen(false)
        expect(media(element)).toBe('all')
        expect(root.querySelector('[data-stub="chat"]')).toBe(chat)
    })

    test('17 to 9 to 17: Studio turns the sheet off and closing it turns it on', async () => {
        await showApp()
        const element = sheet()
        expect(media(element)).toBe('all')
        await setStudioOpen(true)
        expect(media(element)).toBe('not all')
        await setStudioOpen(false)
        expect(media(element)).toBe('all')
    })

    test('Settings and Studio both set: the sheet is off until both are closed', async () => {
        await showApp()
        const element = sheet()
        setSettingsOpen(true)
        await setStudioOpen(true)
        expect(media(element)).toBe('not all')
        setSettingsOpen(false)
        expect(media(element)).toBe('not all')
        await setStudioOpen(false)
        expect(media(element)).toBe('all')
    })

    test('a sheet registered while covered stays off until the cover lifts', async () => {
        await showApp()
        setSettingsOpen(true)
        const element = sheet()
        expect(media(element)).toBe('not all')
        setSettingsOpen(false)
        expect(media(element)).toBe('all')
    })
})

// Last on purpose: a StudioScreen chunk that never resolves stays pending in the module registry for later tests.
describe('a Studio chunk that is still loading', () => {
    test('row 8: the cover is on and the sheet is off', async () => {
        studioChunkPending = true
        await showApp()
        const element = sheet()
        expect(media(element)).toBe('all')
        await setStudioOpen(true)
        expect(stubCount('studio').mounts).toBe(0)
        expect(shownSurface()).toBeNull()
        expect(media(element)).toBe('not all')
    })
})
