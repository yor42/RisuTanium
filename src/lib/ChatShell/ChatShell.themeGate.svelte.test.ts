// @vitest-environment jsdom
/**
 * The real ChatShell declares the chat surface to the theme-pack gate while it is mounted (T3G-4), all GUARD: the gate
 * is new code, so no base fails for a reason other than a missing module.
 *
 * REAL: ChatShell.svelte, ChatScreen.svelte (the parent of the same-flush row) and surfaceGate.svelte.ts.
 * MOCKED: the stores and database, every sheet and part the shell loads, and the classic screen (a marker stand-in for Home).
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const classicMounts = vi.hoisted(() => ({ count: 0, live: 0 }))

vi.mock('../../ts/stores.svelte', () => {
    const DBState = $state<{ db: Record<string, unknown> }>({ db: { characters: [] } })
    const selIdState = $state({ selId: 0 })
    const selectedCharID = writable(0)
    selectedCharID.subscribe((value) => { selIdState.selId = value })
    return { DBState, selIdState, selectedCharID, CharEmotion: writable({}), sideBarStore: writable(false) }
})
vi.mock('../../ts/chatShell/switchTarget.svelte', () => ({ switchTarget: { target: null, phase: 'idle', reason: null }, retrySwitch: vi.fn(), backToPrevious: vi.fn(), abandonPendingSwitch: vi.fn() }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => undefined, backCloseHandler: () => () => false }))
vi.mock('../../ts/process/index.svelte', () => ({ doingChat: writable(false), chatProcessStage: writable(0) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { hidden: false, closeEpoch: 0 } }))
vi.mock('../../ts/process/chatTreeView', () => ({ treeView: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ hasher: (value: string) => value, risuChatParser: (value: string) => value, assetRegex: /{{asset:[^}]+}}/g }))
vi.mock('../../ts/parser/chatML', () => ({ parseChatML: () => [] }))
vi.mock('../../lang', () => ({ language: { chatShellMessages: 'Messages', chatShellChatOpened: (chat: string) => `Opened ${chat}` } }))
vi.mock('./ShellHeader.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellComposer.svelte', () => ({ default: () => ({}) }))
vi.mock('./PersonaSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./PlusSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellNotices.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellFloatingButtons.svelte', () => ({ default: () => ({}) }))
vi.mock('./ShellMessageList.svelte', () => ({ default: () => ({}) }))
vi.mock('./ActionSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./CustomizeButtonsSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ThisChatSheet.svelte', () => ({ default: () => ({}) }))
vi.mock('./ChatDeleteConfirm.svelte', () => ({ default: () => ({}) }))
vi.mock('./TogglesPanel.svelte', () => ({ default: () => ({}), toggleSummary: () => ({ n: 0, on: 0 }) }))
vi.mock('./SendFailureCard.svelte', () => ({ default: () => ({}) }))
vi.mock('./SwitchFrame.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/chatShell/sendFailure.svelte', () => ({ failureOf: () => null, retrySendFailure: vi.fn() }))
vi.mock('../Setting/settingsRoute', () => ({ openSettingsForFix: vi.fn() }))
vi.mock('../../ts/process/composerActions.svelte', () => ({ isComposerBusy: () => false, branchAt: vi.fn() }))
vi.mock('../ChatScreens/NotificationsOffNotice.svelte', () => ({ default: () => ({}) }))
// ChatScreen's own parts and the classic screen: the classic screen is the Home stand-in of the same-flush row.
vi.mock('../../ts/util', () => ({ getCustomBackground: async () => '', getEmotion: () => '' }))
vi.mock('../ChatScreens/DefaultChatScreen.svelte', () => ({
    default: (anchor: Comment) => {
        classicMounts.count += 1
        classicMounts.live += 1
        const marker = document.createElement('div')
        marker.setAttribute('data-testid', 'home-stand-in')
        anchor.before(marker)
        return {}
    },
}))
vi.mock('../ChatScreens/ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/media/charImageLookups', () => ({ useCharImageLookups: () => ({ get: vi.fn(), getIf: vi.fn(), dispose: vi.fn() }) }))
vi.mock('../ChatScreens/BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))

import { DBState, selectedCharID } from '../../ts/stores.svelte'
import { installThemePackGate, resetThemePackGateForTests, shownSurface } from '../../ts/themePack/surfaceGate.svelte'
import { setShellEnabled } from '../../ts/chatShell/shellSwitch.svelte'

const mounted: Array<{ instance: object, target: HTMLElement }> = []

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
}

async function mountComponent(load: () => Promise<{ default: never }>) {
    const { default: component } = await load()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(component, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return { instance, target }
}

const mountShell = () => mountComponent(() => import('./ChatShell.svelte') as never)
const mountScreen = () => mountComponent(() => import('../ChatScreens/ChatScreen.svelte') as never)

beforeEach(() => {
    DBState.db = {
        theme: '',
        characters: [{ chaId: 'a', type: 'character', name: 'Seraphina', chatPage: 0, chats: [{ id: 'chat-1', name: 'First', message: [], note: '', localLore: [] }], viewScreen: 'none', inlayViewScreen: false }],
        textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '',
        customBackground: '', classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100,
    } as never
    selectedCharID.set(0)
    classicMounts.count = 0
    classicMounts.live = 0
    installThemePackGate(() => false)
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetThemePackGateForTests()
    localStorage.clear()
    setShellEnabled(false)
})

describe('ChatShell declares the chat surface while mounted', () => {
    test('mounting declares chat, and the declaration raises no effect-depth error', async () => {
        expect(shownSurface()).toBeNull()
        await mountShell()
        await settle()
        expect(shownSurface()).toBe('chat')
    })

    test('unmounting releases the declaration', async () => {
        const { instance } = await mountShell()
        await settle()
        expect(shownSurface()).toBe('chat')
        await unmount(instance as never)
        mounted.length = 0
        flushSync()
        expect(shownSurface()).toBeNull()
    })

    test('unmounting one shell while another is mounted keeps the surface declared', async () => {
        const first = await mountShell()
        const second = await mountShell()
        await settle()
        await unmount(first.instance as never)
        mounted.splice(0, 1)
        flushSync()
        expect(shownSurface()).toBe('chat')
        await unmount(second.instance as never)
        mounted.length = 0
        flushSync()
        expect(shownSurface()).toBeNull()
    })

    test('an unmount followed by a mount before the flush ends declared', async () => {
        const { default: ChatShell } = await import('./ChatShell.svelte')
        const { instance } = await mountShell()
        await settle()
        // Both steps run before any flush, as a parent's branch swap does.
        void unmount(instance as never)
        mounted.length = 0
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ instance: mount(ChatShell, { target }), target })
        flushSync()
        expect(shownSurface()).toBe('chat')
        await unmount(mounted[0].instance as never)
        mounted.length = 0
        flushSync()
        expect(shownSurface()).toBeNull()
    })
})

describe('the release runs in the flush that shows the stand-in screen', () => {
    test('same flush: the parent switches the shell off and the classic screen on, and one flushSync releases and mounts', async () => {
        setShellEnabled(true)
        const { target } = await mountScreen()
        await settle()
        expect(shownSurface()).toBe('chat')
        expect(target.querySelector('[data-testid="home-stand-in"]')).toBeNull()
        setShellEnabled(false)
        flushSync()
        expect(shownSurface()).toBeNull()
        expect(target.querySelector('[data-testid="home-stand-in"]')).not.toBeNull()
        setShellEnabled(true)
        flushSync()
        await settle()
        expect(shownSurface()).toBe('chat')
    })
})
