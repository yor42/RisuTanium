// @vitest-environment jsdom
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
const oldMount = vi.fn(() => ({}))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: state,
    selIdState: selection,
    selectedCharID,
    CharEmotion: writable({}),
}))
vi.mock('../../ts/util', () => ({ getCustomBackground: async () => '', getEmotion: () => '' }))
vi.mock('./DefaultChatScreen.svelte', () => ({ default: oldMount }))
vi.mock('./ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('./TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('./BackgroundDom.svelte', () => ({ default: () => ({}) }))
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({ default: () => ({}) }))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))
vi.mock('./chatSurface.svelte', () => ({ chatSurface: { closeEpoch: 0 } }))

let target: HTMLElement
let app: ReturnType<typeof mount>

afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    oldMount.mockClear()
    localStorage.clear()
})

async function show() {
    const { default: ChatScreen } = await import('./ChatScreen.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    flushSync()
    return import('../../ts/chatShell/shellSwitch.svelte')
}

describe('S0 ChatScreen branch', () => {
    test('off mounts the old path and on mounts the stub for a standard character', async () => {
        state.db.theme = ''
        state.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], viewScreen: 'none', inlayViewScreen: false }]
        selectedCharID.set(0)
        const switcher = await show()
        switcher.setShellEnabled(false)
        flushSync()
        expect(oldMount).toHaveBeenCalled()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).toBeNull()
        oldMount.mockClear()
        switcher.setShellEnabled(true)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).not.toBeNull()
        expect(oldMount).not.toHaveBeenCalled()
    })

    test('waifu, group and playground keep the old path', async () => {
        state.db.characters = [
            { chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'a' }], viewScreen: 'none', inlayViewScreen: false },
            { chaId: 'group', type: 'group', chatPage: 0, chats: [{ id: 'b' }], viewScreen: 'none', inlayViewScreen: false },
            { chaId: '§playground', type: 'character', chatPage: 0, chats: [{ id: 'c' }], viewScreen: 'none', inlayViewScreen: false },
        ]
        state.db.theme = 'waifu'
        selectedCharID.set(0)
        const switcher = await show()
        switcher.setShellEnabled(true)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).toBeNull()
        state.db.theme = ''
        selectedCharID.set(1)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).toBeNull()
        selectedCharID.set(2)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).toBeNull()
        selectedCharID.set(0)
        flushSync()
        expect(target.querySelector('[data-testid="chat-shell-stub"]')).not.toBeNull()
    })
})
