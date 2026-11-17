// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: [] as Message[] }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/android/hostBridge', () => ({ gestureInsetLeft: () => 0 }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/tts', () => ({ stopTTS: vi.fn() }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertNormal: vi.fn(), alertSelect: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: vi.fn(), deleteNow: vi.fn(), copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
    branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { rebuildEpoch: 0, closeEpoch: 0 }, isChatSurfaceInstalled: () => false }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark', chatShellFirstReply: 'First reply', chatShellEndControl: (count: number) => `Bring back ${count}`,
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let body: HTMLElement

function show(): void {
    const message: Message = { role: 'char', data: 'Reply', chatId: 'm' }
    DBState.db.characters[0].chats[0].message = [message]
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message: DBState.db.characters[0].chats[0].message[0], streaming: false, getBusy: () => false, getTreeView: () => ({ at: () => ({ index: 2, count: 3 }), continuation: 0 }) } })
    flushSync()
    body = target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    Object.defineProperty(body, 'clientWidth', { value: 300 })
}
function pointer(kind: string, x: number, time: number): void {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
    body.dispatchEvent(event)
    flushSync()
}
/** A swipe step that commits under reduced motion, which marks the body's slide direction. */
function commit(): void {
    pointer('pointerdown', 100, 0)
    pointer('pointermove', 220, 100)
    pointer('pointerup', 220, 200)
}

beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    document.documentElement.classList.add('rm')
})
afterEach(async () => {
    document.documentElement.classList.remove('rm')
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockClear()
    regenerateNewest.mockClear()
})

describe('the commit cue ends only on the body\'s own animation (CHORE-818 S3)', () => {
    // REPRODUCER (T3.8): a card descendant's zero-duration animation bubbles animationend to the body, and the
    // body's handler used to clear the cue before it played.
    test('an animationend bubbling up from a descendant leaves the cue in place', () => {
        show()
        commit()
        expect(body.getAttribute('data-commit')).toBe('back')
        const descendant = document.createElement('span')
        body.appendChild(descendant)
        descendant.dispatchEvent(new Event('animationend', { bubbles: true }))
        flushSync()
        expect(body.getAttribute('data-commit')).toBe('back')
    })
    test('the body\'s own animationend still clears the cue', () => {
        show()
        commit()
        expect(body.getAttribute('data-commit')).toBe('back')
        body.dispatchEvent(new Event('animationend', { bubbles: true }))
        flushSync()
        expect(body.hasAttribute('data-commit')).toBe(false)
    })
})
