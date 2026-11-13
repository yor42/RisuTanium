// @vitest-environment jsdom
/**
 * ChatScreen never declares the chat surface to the theme-pack gate itself (T3G-3), all GUARD: the gate is new code, so no
 * base fails for a reason other than a missing module. Only ChatShell declares; the classic screen and every branch that
 * does not mount the shell leave the gate with nothing shown.
 *
 * REAL: ChatScreen.svelte, shellSwitch.svelte.ts, surfaceGate.svelte.ts. MOCKED: ChatShell and DefaultChatScreen (marker
 * stand-ins that do not declare), the stores and ChatScreen's other parts, as in `ChatScreen.shellBranch.svelte.test.ts`.
 *
 * The stand-in shell does not declare, so every `shownSurface()` assertion here only pins that ChatScreen itself never
 * declares (XG-4a). The marker assertions (`chat-shell-stub` absent or present, `classic-stub` present) carry T3G-3.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

interface TestCharacter {
    chaId: string
    type: string
    chatPage: number
    chats: { id: string }[]
    viewScreen: string
    inlayViewScreen: boolean
}

const state = $state({ db: {
    theme: '', characters: [] as TestCharacter[],
    textScreenColor: '', textBorder: false, textScreenRounded: false, textScreenBorder: '',
    customBackground: '', classicMaxWidth: false, waifuWidth: 100, waifuWidth2: 100,
} })
const selection = $state({ selId: 0 })
const selectedCharID = writable(0)
selectedCharID.subscribe((value) => { selection.selId = value })

vi.mock('src/ts/stores.svelte', () => ({
    DBState: state,
    selIdState: selection,
    selectedCharID,
    CharEmotion: writable({}),
}))
vi.mock('../../ts/util', () => ({ getCustomBackground: async () => '', getEmotion: () => '' }))
vi.mock('./DefaultChatScreen.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('div')
        marker.setAttribute('data-testid', 'classic-stub')
        anchor.before(marker)
        return {}
    },
}))
vi.mock('../ChatShell/ChatShell.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('div')
        marker.setAttribute('data-testid', 'chat-shell-stub')
        anchor.before(marker)
        return {}
    },
}))
vi.mock('./ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('./TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/media/charImageLookups', () => ({ useCharImageLookups: () => ({ get: vi.fn(), getIf: vi.fn(), dispose: vi.fn() }) }))
vi.mock('./BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))
vi.mock('./chatSurface.svelte', () => ({ chatSurface: { closeEpoch: 0 } }))

let target: HTMLElement
let app: ReturnType<typeof mount>

const standard = (chaId: string, type = 'character'): TestCharacter =>
    ({ chaId, type, chatPage: 0, chats: [{ id: `${chaId}-chat` }], viewScreen: 'none', inlayViewScreen: false })

afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    const gate = await import('../../ts/themePack/surfaceGate.svelte')
    gate.resetThemePackGateForTests()
    localStorage.clear()
    state.db.theme = ''
})

async function show() {
    const gate = await import('../../ts/themePack/surfaceGate.svelte')
    gate.installThemePackGate(() => false)
    const { default: ChatScreen } = await import('./ChatScreen.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    flushSync()
    const switcher = await import('../../ts/chatShell/shellSwitch.svelte')
    return { switcher, gate }
}

describe('ChatScreen leaves the gate with nothing shown', () => {
    test('switch off: the classic screen mounts and nothing is declared', async () => {
        state.db.characters = [standard('char')]
        selectedCharID.set(0)
        const { switcher, gate } = await show()
        switcher.setShellEnabled(false)
        flushSync()
        expect(target.querySelector('[data-testid="classic-stub"]')).not.toBeNull()
        expect(gate.shownSurface()).toBeNull()
    })

    test('the shell branch mounts the shell stand-in, and ChatScreen itself still declares nothing', async () => {
        state.db.characters = [standard('char')]
        selectedCharID.set(0)
        const { switcher, gate } = await show()
        switcher.setShellEnabled(true)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).not.toBeNull()
        expect(gate.shownSurface()).toBeNull()
    })

    test('waifu theme, group chat, playground, a missing chat and Home declare nothing', async () => {
        state.db.characters = [
            standard('char'),
            standard('group', 'group'),
            standard('§playground'),
            { ...standard('empty'), chats: [] },
        ]
        state.db.theme = 'waifu'
        selectedCharID.set(0)
        const { switcher, gate } = await show()
        switcher.setShellEnabled(true)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).toBeNull()
        expect(gate.shownSurface()).toBeNull()
        state.db.theme = ''
        for (const index of [1, 2, 3, -1]) {
            selectedCharID.set(index)
            flushSync()
            expect(target.querySelector('[data-testid="chat-shell-stub"]')).toBeNull()
            expect(target.querySelector('[data-testid="classic-stub"]')).not.toBeNull()
            expect(gate.shownSurface()).toBeNull()
        }
    })
})
