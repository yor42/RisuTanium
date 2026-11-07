// @vitest-environment jsdom
/**
 * Studio is unavailable while the Beta Mobile GUI is on: no row in More, the open is refused with no
 * state change, and a visit that is open closes when the Beta Mobile GUI turns on. The sheet's row
 * is covered in its own file; App's desktop mount is covered in App.studioMount.svelte.test.ts, and the
 * mobile layout case here pins that App mounts no Studio under the Beta Mobile GUI.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const stub = vi.hoisted(() => () => ({ default: () => { } }))
const countingStub = (kind: string) => async () => {
    const { default: Counting } = await import('../../App.keepChatCountingStub.svelte')
    return { default: (anchor: Parameters<typeof Counting>[0], props: object) => Counting(anchor, { ...props, kind }) }
}

interface TestCharacter {
    chaId: string
    type: string
    chatPage: number
    chats: { id: string }[]
}

const db = $state({ db: { enableDevTools: false, didFirstSetup: true, characters: [] as TestCharacter[] } })
const selection = $state({ selId: 0 })
const MobileGUI = writable(false)
const settingsOpen = writable(false)

vi.mock('src/ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    PlaygroundStore: writable(0),
    additionalHamburgerMenu: [],
    alertStore: writable({ type: 'none', msg: '' }),
    bookmarkListOpen: writable(false),
    selectedCharID: writable(0),
    DynamicGUI: writable(false),
    SettingsMenuIndex: writable(-1),
    sideBarStore: writable(false),
    ShowRealmFrameStore: writable(false),
    openPresetList: writable(false),
    openPersonaList: writable(false),
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({}),
    CustomGUISettingMenuStore: writable(false),
    loadedStore: writable(true),
    LoadingStatusState: { text: '' },
    popupStore: { children: null },
    easyPanelStore: { open: false },
    popUpEditorStore: { open: false },
    loadoutModalStore: { open: false },
    irisStore: { open: false },
    customSideBarConfigDialogStore: { open: false },
    hypaV3ModalOpen: writable(false),
    hypaV3ProgressStore: writable({ open: false }),
}))
vi.mock('@lucide/svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@lucide/svelte')>()
    const icon = () => { }
    return { ...actual, ArrowUpIcon: icon, GlobeIcon: icon, PlusIcon: icon }
})
vi.mock('../SideBars/Sidebar.svelte', () => countingStub('sidebar')())
vi.mock('../ChatScreens/ChatScreen.svelte', () => countingStub('chat')())
vi.mock('../Mobile/MobileBody.svelte', () => countingStub('mobileBody')())
vi.mock('./StudioScreen.svelte', () => countingStub('studio')())
vi.mock('../Setting/Settings.svelte', stub)
vi.mock('../SettingsShell/SettingsShell.svelte', stub)
vi.mock('../Others/AlertComp.svelte', stub)
vi.mock('../UI/Realm/RealmPopUp.svelte', stub)
vi.mock('../Others/GridCatalog.svelte', stub)
vi.mock('../Others/WelcomeRisu.svelte', stub)
vi.mock('../Others/BookmarkList.svelte', stub)
vi.mock('../UI/Realm/RealmFrame.svelte', stub)
vi.mock('../Others/SavePopupIcon.svelte', stub)
vi.mock('../Setting/botpreset.svelte', stub)
vi.mock('../Setting/listedPersona.svelte', stub)
vi.mock('../Mobile/MobileHeader.svelte', stub)
vi.mock('../Mobile/MobileFooter.svelte', stub)
vi.mock('../Setting/Pages/CustomGUISettingMenu.svelte', stub)
vi.mock('../Others/HypaV3Modal.svelte', stub)
vi.mock('../Others/HypaV3Progress.svelte', stub)
vi.mock('../UI/PopupList.svelte', stub)
vi.mock('../Others/ProTools/EasyPanel.svelte', stub)
vi.mock('../Others/PopupEditor.svelte', stub)
vi.mock('../Others/LoadoutModal.svelte', stub)
vi.mock('../Others/IrisModal.svelte', stub)
vi.mock('../Others/Legal.svelte', stub)
vi.mock('../Others/CustomSidebarConfig.svelte', stub)
vi.mock('../../ts/characterCards', () => ({ showRealmInfoStore: writable(null) }))
vi.mock('../../ts/storage/database.svelte', () => ({ getDatabase: () => ({}), setDatabase: () => { } }))
vi.mock('../../ts/dropImport', () => ({ importDroppedFile: async () => { } }))
vi.mock('../../ts/keepAliveAudio', () => ({ createKeepAliveAudio: () => ({}) }))
vi.mock('../../ts/storage/tauriByteTransport', () => ({ isAndroidTransport: () => false }))
vi.mock('../SideBars/CharConfig.svelte', () => ({ default: () => ({}) }))
vi.mock('../SideBars/DevTool.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => ({}) }))
const languageMock = vi.hoisted(() => ({
    language: new Proxy({ settingsPage: { back: 'Back' }, playground: { playground: 'Playground' } } as Record<string, unknown>, {
        get: (target, key) => key in target ? target[key as string] : String(key),
    }),
}))
vi.mock('src/lang', () => languageMock)

import SidebarMoreMenu from '../ChatShell/sidebar/SidebarMoreMenu.svelte'
import { openStudio, resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import { setStudioEnabled } from '../../ts/studio/studioSwitch.svelte'
import { studioOpen } from '../../ts/studio/studioOpen'
import { resetStubCounts, stubCount } from '../../App.keepChatCountingStub.svelte'
import { resetChatSurfaceForTests } from '../ChatScreens/chatSurface.svelte'

const target = { owner: { type: 'character', id: 'char' }, from: 'chat' } as const

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

beforeEach(() => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    resetStubCounts()
    localStorage.clear()
    resetStudioScreenForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    db.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'c' }] }]
    selection.selId = 0
    setStudioEnabled(true)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    resetChatSurfaceForTests()
    studioOpen.set(false)
    vi.unstubAllEnvs()
    resetStudioScreenForTests()
    setStudioEnabled(false)
    localStorage.clear()
})

describe('2p Studio under the Beta Mobile GUI', () => {
    test('App mounts no Studio under the Beta Mobile GUI even if the flag is set; the mobile layout shows', async () => {
        MobileGUI.set(true)
        studioOpen.set(true)
        const { default: App } = await import('../../App.svelte')
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(App, { target: host, props: {} })
        flushSync()
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            await tick()
            flushSync()
        }
        expect(stubCount('mobileBody').mounts).toBe(1)
        expect(stubCount('studio').mounts).toBe(0)
        expect(host.querySelector('[data-stub="studio"]')).toBeNull()
        expect(host.querySelector('[data-chat-surface]')).toBeNull()
    })

    test('More shows no Studio row while the Beta Mobile GUI is on', () => {
        MobileGUI.set(true)
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(SidebarMoreMenu, { target: host, props: { reseter: vi.fn(), onclose: vi.fn(), afterAction: vi.fn() } })
        flushSync()
        expect(document.querySelector('[data-part="more-list"]')).not.toBeNull()
        expect(document.querySelector('[data-part="more-studio"]')).toBeNull()
    })

    test('openStudio is refused and leaves the flag and the visit state alone', () => {
        MobileGUI.set(true)
        expect(openStudio(target, null)).toBe(false)
        expect(get(studioOpen)).toBe(false)
        expect(studioScreen.open).toBe(false)
        expect(studioScreen.chaId).toBe('')
    })

    test('a visit that is open closes when the Beta Mobile GUI turns on', () => {
        expect(openStudio(target, null)).toBe(true)
        flushSync()
        expect(get(studioOpen)).toBe(true)
        MobileGUI.set(true)
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })

    test('turning the Beta Mobile GUI off again does not reopen Studio', () => {
        openStudio(target, null)
        flushSync()
        MobileGUI.set(true)
        flushSync()
        MobileGUI.set(false)
        flushSync()
        expect(get(studioOpen)).toBe(false)
    })
})
