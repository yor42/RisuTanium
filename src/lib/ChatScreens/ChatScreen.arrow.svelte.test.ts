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

vi.mock('src/ts/stores.svelte', () => ({
    DBState: state,
    selIdState: selection,
    selectedCharID,
    CharEmotion: writable({}),
}))
vi.mock('../../ts/util', () => ({ getCustomBackground: async () => '', getEmotion: () => '' }))
vi.mock('./DefaultChatScreen.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatShell/ChatShell.svelte', () => ({ default: () => ({}) }))
vi.mock('./ResizeBox.svelte', () => ({ default: () => ({}) }))
vi.mock('./TransitionImage.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/media/charImageLookups', () => ({ useCharImageLookups: () => ({ get: vi.fn(), getIf: vi.fn(), dispose: vi.fn() }) }))
vi.mock('./BackgroundDom.svelte', () => ({ default: () => ({}) }))
// The classic panel arrow is replaced by a marker so the test sees whether it mounted.
vi.mock('../UI/GUI/SideBarArrow.svelte', () => ({
    default: (anchor: Comment) => {
        const marker = document.createElement('div')
        marker.setAttribute('data-testid', 'sidebar-arrow-stub')
        anchor.before(marker)
        return {}
    },
}))
vi.mock('../Others/ChatList.svelte', () => ({ default: () => ({}) }))
vi.mock('../Setting/Pages/Module/ModuleChatMenu.svelte', () => ({ default: () => ({}) }))
vi.mock('./chatSurface.svelte', () => ({ chatSurface: { closeEpoch: 0 } }))

let target: HTMLElement
let app: ReturnType<typeof mount>

afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    localStorage.clear()
})

// The shell flag is set before mounting: the stub marker is inserted outside Svelte's teardown, so only a fresh mount shows which side rendered.
async function show(shellEnabled: boolean) {
    const switcher = await import('../../ts/chatShell/shellSwitch.svelte')
    switcher.setShellEnabled(shellEnabled)
    const { default: ChatScreen } = await import('./ChatScreen.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    flushSync()
}

const arrow = () => target.querySelector('[data-testid="sidebar-arrow-stub"]')

describe('the classic sidebar arrow while the shell header carries its own Back', () => {
    test('a mounted shell leaves one back control: the arrow is absent', async () => {
        state.db.theme = ''
        state.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], viewScreen: 'none', inlayViewScreen: false }]
        selectedCharID.set(0)
        await show(true)
        expect(arrow()).toBeNull()
    })

    test('with the shell off the classic screen keeps the arrow', async () => {
        state.db.theme = ''
        state.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], viewScreen: 'none', inlayViewScreen: false }]
        selectedCharID.set(0)
        await show(false)
        expect(arrow()).not.toBeNull()
    })

    test('the waifu screen keeps the arrow even with the shell enabled', async () => {
        state.db.theme = 'waifu'
        state.db.characters = [{ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], viewScreen: 'none', inlayViewScreen: false }]
        selectedCharID.set(0)
        await show(true)
        expect(arrow()).not.toBeNull()
    })

    test('a group chat, which the shell does not take, keeps the arrow', async () => {
        state.db.theme = ''
        state.db.characters = [{ chaId: 'group', type: 'group', chatPage: 0, chats: [{ id: 'chat' }], viewScreen: 'none', inlayViewScreen: false }]
        selectedCharID.set(0)
        await show(true)
        expect(arrow()).not.toBeNull()
    })
})
