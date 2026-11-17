// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'
import { FakeIntersectionObserver, installAnimationWorld, type AnimationWorld } from '../../ts/gui/tests/realAnimationShape'

/**
 * A shell message row holds the infinite animations of its card while the row is outside the far band and releases
 * them when it comes back. The real `ShellMessage.svelte` and `nearViewport` run; the body's markup is the real
 * parser's sanitized card output placed by a stand-in `ChatBody`. R = regression reproducer (the base marks nothing).
 */

const markup = vi.hoisted(() => ({ html: '' }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { requestInfoInsideChat: false, translator: '', globalChatVariables: {}, templateDefaultVariables: '', characters: [{ chaId: 'c', chatPage: 0,
        chats: [{ id: 'room', message: [] as Message[], bookmarks: [] as string[] }] }], memoryLimitThickness: 3 } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, selectedCharID: writable(0), HideIconStore: writable(false) }
})
vi.mock('../../ts/globalApi.svelte', () => ({
    aiLawApplies: () => false,
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async () => '',
    readImage: async () => undefined,
}))
vi.mock('../../ts/storage/database.svelte', () => ({ appVer: '1234.5.67', getCurrentCharacter: () => null, getDatabase: () => ({}) }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn() }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    const node = document.createElement('div')
    node.innerHTML = markup.html
    anchor.before(node)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/characters', () => ({ getCharImage: async (source: string) => source }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'Model' }) }))
vi.mock('../../lang', () => ({ language: { bookmark: 'Bookmark', messageInterrupted: 'Interrupted', messageRenderFailed: 'Failed', edit: 'Edit', chatShellMoreActions: 'More actions', chatShellReadAloud: 'Read aloud', chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}` } }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

const CARD = '<style>.badge{animation:pulse 1s infinite}.glow::before{content:"";animation:spin 1s infinite}.reveal{animation:fade 1s forwards}</style>'
    + '<div class="badge">B</div><span class="glow">G</span><div class="reveal">R</div>'
const NEAR = '50% 0px'
const FAR = '100% 0px'

let world: AnimationWorld
let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement

beforeAll(async () => {
    // The real sanitizer, with no character so no script or asset step runs.
    const parser = await vi.importActual<typeof import('../../ts/parser/parser.svelte')>('../../ts/parser/parser.svelte')
    markup.html = await parser.ParseMarkdown(CARD, null, 'back')
})

beforeEach(() => {
    FakeIntersectionObserver.instances.length = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    world = installAnimationWorld()
    world.rule('.x-risu-badge', 'selfLoopInfinite')
    world.rule('.x-risu-glow', 'beforeLoopInfinite')
    world.rule('.x-risu-reveal', 'finiteFillForwardsRunning')
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    world.restore()
    vi.unstubAllGlobals()
})

async function show() {
    const message: Message = { role: 'char', data: 'Hi', chatId: 'm' }
    DBState.db.characters[0].chats[0].message = [message]
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message, onOpenActions: () => {} } })
    flushSync()
    await tick()
    const body = target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    return { body, badge: body.querySelector('.x-risu-badge'), glow: body.querySelector('.x-risu-glow'), reveal: body.querySelector('.x-risu-reveal') }
}

describe('a shell message row holds its card outside the far band', () => {
    test('R T2.7: far-exit holds the infinite targets and leaves the reveal; near-enter releases', async () => {
        const { body, badge, glow, reveal } = await show()
        expect(badge).not.toBeNull()
        expect(reveal).not.toBeNull()
        expect(badge!.hasAttribute('data-risu-anim-hold')).toBe(false)

        FakeIntersectionObserver.send(FAR, body, false)
        expect(badge!.getAttribute('data-risu-anim-hold')).toBe('self')
        expect(glow!.getAttribute('data-risu-anim-hold')).toBe('before')
        expect(reveal!.hasAttribute('data-risu-anim-hold')).toBe(false)
        expect(body.hasAttribute('data-risu-anim-hold')).toBe(false)

        FakeIntersectionObserver.send(NEAR, body, true)
        expect(badge!.hasAttribute('data-risu-anim-hold')).toBe(false)
        expect(glow!.hasAttribute('data-risu-anim-hold')).toBe(false)
    })
})
