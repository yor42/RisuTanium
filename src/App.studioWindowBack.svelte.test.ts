// @vitest-environment jsdom

/**
 * Back while the Studio chunk is still loading. From the moment `studioOpen` is set until the lazy
 * `StudioScreen` chunk mounts and registers its own Back layers, no Studio layer exists. `App.svelte`
 * therefore keeps one bridge handler registered for as long as the flag is set; it ends the visit the way
 * Studio's own top layer does (`leaveStudio`), sits above every handler registered before the open, and sits
 * below Studio's layers, which register later.
 *
 * MOCKED: the children of the app, as in `App.studioMount.svelte.test.ts`; `StudioScreen` is a deferred
 * stand-in whose chunk resolves or rejects when the test says so. REAL: the Studio flag, `studioScreen`,
 * `studioBack`, `backHandlers`, and for T10 `homeStudio` and `homeView`.
 *
 * Every test mounts App and flushes first, registers its "beneath" handler (standing in for the Home library
 * handler) afterwards, and only then opens Studio, so the beneath handler is older than the bridge as in the app.
 * A window test flushes after the open and checks that the chunk has not mounted before it presses Back.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const sidebarProps = vi.hoisted(() => ({ openGrid: null as (() => void) | null }))
const alertErrorSpy = vi.hoisted(() => vi.fn())
// The StudioScreen chunk waits on `current.promise`; `arm` makes a pending one, `release` and `reject` settle it.
const gate = vi.hoisted(() => {
    const current = {
        promise: Promise.resolve() as Promise<void>,
        release: () => { },
        reject: (_error: Error) => { },
    }
    return {
        current,
        arm() {
            current.promise = new Promise<void>((resolve, reject) => {
                current.release = resolve
                current.reject = reject
            })
        },
    }
})
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
vi.mock('./lib/ChatScreens/ChatScreen.svelte', () => countingStub('chat')())
vi.mock('./lib/Setting/Settings.svelte', () => countingStub('settings')())
vi.mock('./lib/SettingsShell/SettingsShell.svelte', stub)
vi.mock('./lib/Others/GridCatalog.svelte', () => countingStub('grid')())
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
        CharConfigSubMenu: writable(0),
        QuickSettings: writable({ open: false, index: 0 }),
        botMakerMode: writable(false),
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

// `vi.mock` is hoisted over the whole file, so the three mocks below apply to every test here, not only T10.
// The other tests are unaffected: App imports none of `characters` and `coldCharacterRestore`, and the only
// `caughtErrors` use on their paths is `backHandlers` recording a failing handler, which none of them provokes.
// `changeChar` selects before its first await, as the real one does for a warm slot.
vi.mock('./ts/characters', async () => {
    const stores = await import('./ts/stores.svelte')
    return {
        changeChar: vi.fn((index: number) => {
            stores.selIdState.selId = index
            stores.selectedCharID.set(index)
            return Promise.resolve()
        }),
        supersedeChangeChar: vi.fn(),
        changeCharGeneration: vi.fn(() => 0),
        characterFormatUpdate: vi.fn(),
    }
})
vi.mock('./ts/process/coldCharacterRestore', () => ({ restoreColdCharacter: vi.fn() }))
vi.mock('./ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { DBState, selIdState, selectedCharID, settingsOpen } from './ts/stores.svelte'
import { studioOpen } from './ts/studio/studioOpen'
import { openStudio, resetStudioScreenForTests, studioScreen } from './ts/studio/studioScreen.svelte'
import { setStudioEnabled } from './ts/studio/studioSwitch.svelte'
import * as backHandlersModule from './ts/backHandlers'
import { dispatchBack, installBackGuard, registerBackHandler, resetBackHandlersForTests } from './ts/backHandlers'
import { openStudioFromHome, resetHomeStudioForTests } from './lib/UI/Home/homeStudio.svelte'
import { homeView, showHomeLanding, takeHomeReturnFocus } from './lib/UI/Home/homeView.svelte'
import { resetBootScreenForTests } from './ts/storage/store2/ui/bootScreen.svelte'
import { resetChatSurfaceForTests } from './lib/ChatScreens/chatSurface.svelte'
import { resetStubCounts, stubCount } from './App.keepChatCountingStub.svelte'
import { backStubCounts, resetBackStubCounts } from './App.studioBackStub.svelte'
import { changeLanguage } from './lang'
import { resetTopLevelChangesForTests } from './ts/storage/topLevelChanges'

let mountedApp: Record<string, unknown> | null = null
let target: HTMLElement | null = null
const buttons: HTMLButtonElement[] = []
// The chunk variant of the next mounted app. `showApp` registers the chunk mock exactly once per test: vitest
// resolves the mocks queued for one module in parallel, so two registrations queued in succession can take
// effect in either order.
let studioVariant: 'counting' | 'back' = 'counting'

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 5, 15))
    resetStubCounts()
    resetBackStubCounts()
    sidebarProps.openGrid = null
    gate.arm()
    studioVariant = 'counting'
    alertErrorSpy.mockClear()
})

afterEach(async () => {
    if (mountedApp !== null && target !== null) {
        await unmount(mountedApp as never)
        target.remove()
    }
    mountedApp = null
    target = null
    gate.current.release()
    resetBackHandlersForTests()
    resetStudioScreenForTests()
    resetHomeStudioForTests()
    takeHomeReturnFocus()
    showHomeLanding()
    setStudioEnabled(false)
    selIdState.selId = -1
    selectedCharID.set(-1)
    Reflect.deleteProperty(DBState.db, 'characters')
    for (const button of buttons.splice(0)) button.remove()
    resetChatSurfaceForTests()
    resetTopLevelChangesForTests()
    changeLanguage('en')
    resetBootScreenForTests()
    settingsOpen.set(false)
    studioOpen.set(false)
    vi.useRealTimers()
    vi.unstubAllEnvs()
})

/** The StudioScreen chunk: it mounts once `gate` is released, and fails if the gate is rejected. */
function mockStudioScreen(variant: 'counting' | 'back') {
    vi.doMock('./lib/Studio/StudioScreen.svelte', async () => {
        await gate.current.promise
        if (variant === 'back') {
            const { default: BackStub } = await import('./App.studioBackStub.svelte')
            return { default: BackStub }
        }
        return countingStub('studio')()
    })
}

async function showApp() {
    mockStudioScreen(studioVariant)
    const { default: App } = await import('./App.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    mountedApp = mount(App, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return target
}

/** Studio is imported lazily; let the dynamic import settle and render. */
async function settleLazyImports() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await tick()
        flushSync()
    }
}

/** A handler older than the bridge, standing in for the one the Home library registers. */
function registerBeneath() {
    const beneath = vi.fn(() => true)
    registerBackHandler(beneath)
    return beneath
}

function makeOpener(): HTMLButtonElement {
    const button = document.createElement('button')
    document.body.appendChild(button)
    buttons.push(button)
    return button
}

/** The state `openStudio` needs: the switch on, a selected character, Beta Mobile GUI off. */
function eligibleCharacter() {
    setStudioEnabled(true)
    selIdState.selId = 0
    DBState.db.characters = [{ chaId: 'cha-1', type: 'character' }] as never
}

function openVisit(opener: HTMLElement | null) {
    expect(openStudio({ owner: { type: 'character', id: 'cha-1' }, from: 'chat' }, opener ? { element: opener } : null)).toBe(true)
}

/** Studio is open by flag and the chunk has not mounted: the state a window press must find. */
function expectWindowOpen() {
    expect(stubCount('studio').mounts).toBe(0)
    expect(backStubCounts.mounts).toBe(0)
    expect(get(studioOpen)).toBe(true)
}

describe('Back while the Studio chunk is loading', () => {
    test('T1: a press in the window ends the visit, the handler beneath does not run, and Studio never appears', async () => {
        await showApp()
        const beneath = registerBeneath()

        studioOpen.set(true)
        flushSync()
        expectWindowOpen()

        const handled = dispatchBack()
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)
        expect(handled).toBe(true)

        gate.current.release()
        await settleLazyImports()
        expect(stubCount('studio').mounts).toBe(0)
    })

    test('T2: the press returns focus to the control that opened Studio', async () => {
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        const opener = makeOpener()
        expect(document.activeElement).not.toBe(opener)

        openVisit(opener)
        flushSync()
        expectWindowOpen()
        expect(document.activeElement).not.toBe(opener)

        dispatchBack()
        await settleLazyImports()
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)
        expect(document.activeElement).toBe(opener)

        gate.current.release()
        await settleLazyImports()
        expect(stubCount('studio').mounts).toBe(0)
    })

    test('T3: the press is handled, so the quit warning is not shown', async () => {
        await showApp()
        const showToast = vi.fn()
        installBackGuard({ showToast })

        studioOpen.set(true)
        flushSync()
        expectWindowOpen()

        const handled = dispatchBack()
        expect(showToast).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)
        expect(handled).toBe(true)
    })

    test('guard: T4 once Studio is mounted its layers take the press first, then the visit closes and the handler beneath is reached', async () => {
        studioVariant = 'back'
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        openVisit(null)
        studioScreen.layout = 'stack'
        studioScreen.pickedInVisit = true
        studioScreen.detailShown = true
        flushSync()
        expectWindowOpen()

        gate.current.release()
        await settleLazyImports()
        expect(backStubCounts.mounts).toBe(1)

        // Back 1: detail to list; the visit stays open.
        expect(dispatchBack()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(get(studioOpen)).toBe(true)
        expect(beneath).not.toHaveBeenCalled()

        // Back 2: the list to the origin.
        expect(dispatchBack()).toBe(true)
        expect(get(studioOpen)).toBe(false)
        expect(beneath).not.toHaveBeenCalled()

        flushSync()
        await tick()
        await settleLazyImports()
        expect(backStubCounts.destroys).toBe(1)

        // Back 3: nothing of Studio is left, so the press reaches the handler beneath.
        dispatchBack()
        expect(beneath).toHaveBeenCalledTimes(1)
    })

    test('guard: T4b with the chunk already loaded the bridge still sits below Studio\'s layers', async () => {
        studioVariant = 'back'
        gate.current.release()
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        openVisit(null)
        studioScreen.layout = 'stack'
        studioScreen.pickedInVisit = true
        studioScreen.detailShown = true
        flushSync()
        expectWindowOpen()

        await settleLazyImports()
        expect(backStubCounts.mounts).toBe(1)

        expect(dispatchBack()).toBe(true)
        expect(studioScreen.detailShown).toBe(false)
        expect(get(studioOpen)).toBe(true)
        expect(beneath).not.toHaveBeenCalled()
    })

    test('T5: a press in the window and then a chunk failure: one report, Studio never mounts, nothing beneath ran', async () => {
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        openVisit(makeOpener())
        flushSync()
        expectWindowOpen()

        dispatchBack()
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)

        gate.current.reject(new Error('chunk failed to load'))
        await settleLazyImports()
        expect(get(studioOpen)).toBe(false)
        expect(alertErrorSpy).toHaveBeenCalledTimes(1)
        expect(stubCount('studio').mounts).toBe(0)
        expect(beneath).not.toHaveBeenCalled()
    })

    test('guard: T6 Settings opening in the window releases the bridge, so the next press reaches the handler beneath', async () => {
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        openVisit(makeOpener())
        flushSync()
        expectWindowOpen()

        settingsOpen.set(true)
        flushSync()
        await tick()
        expect(get(studioOpen)).toBe(false)

        dispatchBack()
        expect(beneath).toHaveBeenCalledTimes(1)
        expect(get(studioOpen)).toBe(false)

        gate.current.release()
        await settleLazyImports()
        expect(stubCount('studio').mounts).toBe(0)
    })

    test('T7: a second open in the window: one press closes the visit and focuses the second opener', async () => {
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        const first = makeOpener()
        const second = makeOpener()
        openVisit(first)
        openVisit(second)
        flushSync()
        expectWindowOpen()
        expect(document.activeElement).not.toBe(first)
        expect(document.activeElement).not.toBe(second)

        dispatchBack()
        await settleLazyImports()
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)
        expect(document.activeElement).toBe(second)

        gate.current.release()
        await settleLazyImports()
        expect(stubCount('studio').mounts).toBe(0)
    })

    test('T8: a press in the window, the chunk settling, then a reopen: Studio mounts once and Back closes it', async () => {
        studioVariant = 'back'
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        openVisit(makeOpener())
        flushSync()
        expectWindowOpen()

        dispatchBack()
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)

        gate.current.release()
        await settleLazyImports()
        expect(backStubCounts.mounts).toBe(0)

        // The old chunk has settled without mounting; the reopen starts a visit of its own.
        openVisit(makeOpener())
        await settleLazyImports()
        expect(backStubCounts.mounts).toBe(1)
        expect(get(studioOpen)).toBe(true)

        expect(dispatchBack()).toBe(true)
        expect(get(studioOpen)).toBe(false)
        expect(beneath).not.toHaveBeenCalled()
    })

    test('T9: a handler registered after the open is newer than the bridge and takes the press; once gone, the bridge answers', async () => {
        await showApp()
        const beneath = registerBeneath()
        eligibleCharacter()
        openVisit(makeOpener())
        flushSync()
        expectWindowOpen()

        const newer = vi.fn(() => true)
        const unregisterNewer = registerBackHandler(newer)
        expect(dispatchBack()).toBe(true)
        expect(newer).toHaveBeenCalledTimes(1)
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(true)

        unregisterNewer()
        expect(dispatchBack()).toBe(true)
        expect(get(studioOpen)).toBe(false)
        expect(beneath).not.toHaveBeenCalled()
    })

    test('the bridge registers once per visit and releases its registration when the flag falls, so repeated visits do not pile up handlers', async () => {
        await showApp()
        const register = backHandlersModule.registerBackHandler
        const releases: Array<ReturnType<typeof vi.fn>> = []
        const spy = vi.spyOn(backHandlersModule, 'registerBackHandler').mockImplementation((handler) => {
            const release = vi.fn(register(handler))
            releases.push(release)
            return release
        })
        try {
            for (let visit = 1; visit <= 3; visit += 1) {
                studioOpen.set(true)
                flushSync()
                expect(releases).toHaveLength(visit)
                expect(releases[visit - 1]).not.toHaveBeenCalled()

                studioOpen.set(false)
                flushSync()
                expect(releases[visit - 1]).toHaveBeenCalledTimes(1)
            }
            expect(releases).toHaveLength(3)
            for (const release of releases) expect(release).toHaveBeenCalledTimes(1)
        } finally {
            spy.mockRestore()
        }
    })

    test('T10: a press in the window on the Home entry leaves the Home end state: library, selection cleared, return focus', async () => {
        setStudioEnabled(true)
        DBState.db.characters = [{ chaId: 'cha-1', type: 'character' }] as never
        showHomeLanding()
        await showApp()
        const beneath = registerBeneath()

        expect(openStudioFromHome(0, makeOpener())).toBe(true)
        flushSync()
        expectWindowOpen()
        // The mocked `changeChar` and the Home module reach the same stores module.
        expect(get(selectedCharID)).toBe(0)

        dispatchBack()
        expect(beneath).not.toHaveBeenCalled()
        expect(get(studioOpen)).toBe(false)
        expect(homeView.view).toBe('library')
        expect(get(selectedCharID)).toBe(-1)
        expect(takeHomeReturnFocus()).toBe('cha-1')

        gate.current.release()
        await settleLazyImports()
        expect(stubCount('studio').mounts).toBe(0)
    })
})
