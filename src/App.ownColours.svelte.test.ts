// @vitest-environment jsdom

/**
 * App's Settings switch for the own colours (`$effect.pre` calling `setSettingsOwnColours`). REAL: App.svelte,
 * colorschemeCore.ts and ownColours.svelte.ts, with `DBState` a real `$state` object. MOCKED: every child component, as in
 * `App.themeGate.svelte.test.ts`.
 *
 * TB-8 is the regression reproducer: for a pack whose colours are unreadable, the root keeps painting the pack scheme in the
 * flush that mounts Settings on the base, and paints the own scheme there after. TB-13a and TB-13b are compatibility guards
 * for the new switch: it follows only the open/close edge, and a throw in its repaint is contained.
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
    const state = $state({ db: { didFirstSetup: true } as Record<string, unknown> })
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
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        DBState: state,
    }
})
vi.mock('./ts/characterCards', async () => {
    const { writable } = await import('svelte/store')
    return { showRealmInfoStore: writable(null) }
})
vi.mock('./ts/storage/database.svelte', async () => {
    const { DBState } = await import('./ts/stores.svelte')
    return { getDatabase: () => DBState.db, setDatabase: () => { } }
})
vi.mock('./ts/gui/systemBars', () => ({ syncSystemBars: () => { }, releaseSystemBarsAfterPaint: () => { } }))
vi.mock('./ts/gui/colorschemeCore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./ts/gui/colorschemeCore')>()
    return { ...actual, setSettingsOwnColours: vi.fn(actual.setSettingsOwnColours) }
})
vi.mock('./ts/dropImport',() => ({ importDroppedFile: async () => { } }))
vi.mock('./ts/keepAliveAudio', () => ({ createKeepAliveAudio: () => ({}) }))
vi.mock('./ts/storage/tauriByteTransport', () => ({ isAndroidTransport: () => false }))

import type { Writable } from 'svelte/store'
import { CustomCSSStore, DBState, settingsOpen } from './ts/stores.svelte'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts, stubCount } from './App.keepChatCountingStub.svelte'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'
import { resetThemePackGateForTests } from './ts/themePack/surfaceGate.svelte'
import { colorSchemePresets, enterPackScheme, setSettingsOwnColours, updateColorScheme, type ColorScheme } from './ts/gui/colorschemeCore'
import { ownColours, resetOwnColoursForTests } from './ts/themePack/ownColours.svelte'

// textcolor2 #888888 on bgcolor #333333 is 3.56:1: unreadable, so the own colours are on.
const F1: ColorScheme = {
    bgcolor: '#333333', darkbg: '#2a2a2a', borderc: '#bd93f9', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#eeeeee', textcolor2: '#888888', darkBorderc: '#343746', darkbutton: '#282a36', type: 'dark',
}
const OWN = colorSchemePresets.ocean

const flag = <T,>(store: unknown) => store as Writable<T>

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null

function prop(name: string): string {
    return document.documentElement.style.getPropertyValue(name)
}

function resetDb(): void {
    for (const key of Object.keys(DBState.db)) {
        Reflect.deleteProperty(DBState.db, key)
    }
    Object.assign(DBState.db, {
        didFirstSetup: true,
        colorSchemeName: 'ocean',
        colorScheme: structuredClone(OWN),
        customColorScheme: structuredClone(OWN),
        textTheme: 'standard',
        customTextTheme: {},
        font: 'default',
        customCSS: '',
    })
}

/** The state a user turn-on of an unreadable pack leaves: the pack scheme entered over the user's own scheme. */
function enterF1(): void {
    enterPackScheme(F1)
    updateColorScheme()
}

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    resetStubCounts()
    resetOwnColoursForTests()
    resetDb()
    document.documentElement.removeAttribute('style')
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(async () => {
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
    resetBootScreenForTests()
    flag<boolean>(settingsOpen).set(false)
    resetOwnColoursForTests()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

async function showApp(): Promise<void> {
    const { default: App } = await import('./App.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedApp = mount(App, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
}

function setSettingsOpen(open: boolean): void {
    flag<boolean>(settingsOpen).set(open)
    flushSync()
}

describe('TB-8 the root paints the own scheme in the flush that mounts Settings', () => {
    test('open paints the own scheme with Settings in the DOM, and close restores the pack scheme', async () => {
        enterF1()
        await showApp()
        expect(ownColours.on).toBe(true)
        expect(prop('--risu-theme-textcolor2')).toBe(F1.textcolor2)
        setSettingsOpen(true)
        expect(stubCount('settings').mounts).toBe(1)
        expect(prop('--risu-theme-textcolor2')).toBe(OWN.textcolor2)
        expect(prop('--risu-theme-bgcolor')).toBe(OWN.bgcolor)
        setSettingsOpen(false)
        expect(prop('--risu-theme-textcolor2')).toBe(F1.textcolor2)
    })

    test('a readable pack is not touched by Settings', async () => {
        enterPackScheme({ ...F1, textcolor2: '#cccccc' })
        updateColorScheme()
        await showApp()
        expect(ownColours.on).toBe(false)
        const spy = vi.spyOn(document.documentElement.style, 'setProperty')
        setSettingsOpen(true)
        setSettingsOpen(false)
        expect(spy).not.toHaveBeenCalled()
    })

    test('no pack: Settings paints nothing', async () => {
        updateColorScheme()
        await showApp()
        const spy = vi.spyOn(document.documentElement.style, 'setProperty')
        setSettingsOpen(true)
        setSettingsOpen(false)
        expect(spy).not.toHaveBeenCalled()
    })
})

describe('TB-13a the switch follows only the open and close edge', () => {
    test('database edits repaint nothing at the root, with Settings open or closed', async () => {
        enterF1()
        await showApp()
        setSettingsOpen(true)
        const spy = vi.spyOn(document.documentElement.style, 'setProperty')
        const themeWrites = () => spy.mock.calls.filter(([name]) => String(name).startsWith('--risu-theme-'))
        DBState.db.customCSS = 'x'
        flushSync()
        DBState.db.font = 'timesnewroman'
        flushSync()
        DBState.db.textTheme = 'highcontrast'
        flushSync()
        expect(themeWrites()).toHaveLength(0)
        setSettingsOpen(false)
        expect(themeWrites().length).toBeGreaterThan(0)
        spy.mockClear()
        DBState.db.customCSS = 'y'
        flushSync()
        expect(themeWrites()).toHaveLength(0)
    })

    test('the switch runs once per store edge: a database edit never re-runs the effect', async () => {
        enterF1()
        await showApp()
        const calls = vi.mocked(setSettingsOwnColours)
        calls.mockClear()
        setSettingsOpen(true)
        expect(calls).toHaveBeenCalledTimes(1)
        DBState.db.customCSS = 'x'
        flushSync()
        DBState.db.font = 'timesnewroman'
        flushSync()
        expect(calls).toHaveBeenCalledTimes(1)
        setSettingsOpen(false)
        expect(calls).toHaveBeenCalledTimes(2)
        DBState.db.customCSS = 'y'
        flushSync()
        expect(calls).toHaveBeenCalledTimes(2)
    })

    test('mounting with the own colours already on repaints nothing', async () => {
        enterF1()
        const spy = vi.spyOn(document.documentElement.style, 'setProperty')
        await showApp()
        expect(spy).not.toHaveBeenCalled()
    })
})

describe('TB-13b a throw in the switch repaint is contained', () => {
    test('Settings stays mounted, the error is logged and the scheme paint landed first', async () => {
        enterF1()
        await showApp()
        const error = new Error('css store failed')
        vi.spyOn(CustomCSSStore, 'set').mockImplementation(() => { throw error })
        expect(() => setSettingsOpen(true)).not.toThrow()
        expect(console.error).toHaveBeenCalledWith(error)
        expect(stubCount('settings').mounts).toBe(1)
        expect(prop('--risu-theme-textcolor2')).toBe(OWN.textcolor2)
    })
})
