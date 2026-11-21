// @vitest-environment jsdom
/**
 * CHORE-842: the chat screen reads the selected character's view settings. A selection that names no character
 * (an index past the end of the list, as after a permanent delete shortened it, or -1) renders without the view
 * extras instead of throwing.
 *
 * Labels: R = regression reproducer (throws on the base), G = guard (passes before and after).
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
const oldMount = vi.fn(() => ({}))
const shell = vi.hoisted(() => ({ props: null as null | { customStyle?: string }, background: '' }))

vi.mock('src/ts/stores.svelte', () => ({
    DBState: state,
    selIdState: selection,
    selectedCharID,
    CharEmotion: writable({}),
    moduleBackgroundEmbedding: writable(''),
}))
vi.mock('../../ts/util', () => ({ getCustomBackground: async () => shell.background, getEmotion: () => '' }))
vi.mock('./DefaultChatScreen.svelte', () => ({ default: oldMount }))
// The branch test only needs to know which side mounted; the real shell has its own tests.
vi.mock('../ChatShell/ChatShell.svelte', () => ({
    default: (anchor: Comment, props: { customStyle?: string }) => {
        shell.props = props
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

afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    oldMount.mockClear()
    localStorage.clear()
    shell.props = null
    shell.background = ''
    state.db.customBackground = ''
    state.db.textBorder = false
})

async function show() {
    const { default: ChatScreen } = await import('./ChatScreen.svelte')
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ChatScreen, { target })
    flushSync()
    return import('../../ts/chatShell/shellSwitch.svelte')
}

const CHAR = () => ({ chaId: 'char', type: 'character', chatPage: 0, chats: [{ id: 'chat' }], viewScreen: 'emotion', inlayViewScreen: false })

describe('ChatScreen with a selection that names no character', () => {
    for (const theme of ['', 'waifu']) {
        test(`R: an index past the end of the list renders without an error (theme '${theme}')`, async () => {
            state.db.theme = theme
            state.db.characters = [CHAR()]
            selectedCharID.set(0)
            const switcher = await show()
            switcher.setShellEnabled(false)
            flushSync()

            selectedCharID.set(1)
            expect(() => flushSync()).not.toThrow()
            expect(target.querySelector('.halfwp')).toBeNull()
        })

        test(`G: no selection (-1) renders without an error (theme '${theme}')`, async () => {
            state.db.theme = theme
            state.db.characters = [CHAR()]
            selectedCharID.set(0)
            const switcher = await show()
            switcher.setShellEnabled(false)
            flushSync()

            selectedCharID.set(-1)
            expect(() => flushSync()).not.toThrow()
        })
    }
})
