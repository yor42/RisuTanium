// @vitest-environment jsdom
// What a reader sees at the first animation frame after a change to the message list. requestAnimationFrame is a manual queue and only microtasks
// are drained, so a list wait that needs a frame or a timer has not finished when the frame reader runs. Real timers only.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'
import { siblingsAt, switchTo } from '../../ts/process/chatTree'
import { applyMotionClasses, type MotionState } from '../../ts/chatShell/motionPrefs.svelte'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from '../../ts/tests/firstFrame.test-helpers'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const bodyAtMount = vi.hoisted(() => ({ on: false }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 3, chatLoadAdditionalPages: 3 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/android/hostBridge', () => ({ gestureInsetLeft: () => 0 }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
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
// The body is empty until a test makes it render at mount, like ChatBody before its asynchronous parse ends.
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    if (bodyAtMount.on) anchor.before(document.createTextNode('Reply'))
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { rebuildEpoch: 0, closeEpoch: 0, hidden: false, heldGui: 0, heldChat: {} }, isChatSurfaceInstalled: () => false, onSurfaceHiding: () => () => {} }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {
    loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted',
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark',
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellFirstReply: 'First', chatShellLastReply: 'Last',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
    chatShellEndControl: (count: number) => `Bring back ${count}`,
} }))

import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'

const REDUCED: MotionState = { lowPower: false, reducedMotion: 'on', systemReduced: false }
const NEUTRAL: MotionState = { lowPower: false, reducedMotion: 'system', systemReduced: false }

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let top = 0
let height = 1000
// The stepped row (index 9) sits at content pixels from the top of the scroll content; afterStep models the layout change the step causes.
const layout = { content: 100, afterStep: null as (() => void) | null }
// The elements scrollIntoView was called on, in order.
const scrolledInto: Element[] = []
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

class FakeObserver {
    observe(): void {}
    disconnect(): void {}
}

function activeChat(): Chat { return character.chats[character.chatPage] }
// A chat of `length` messages m0.. where position `at` has a sibling chain of `siblingLength` records (alt0, alt1, ...) that departs from m{at-1}.
function seedChat(chat: Chat, length: number, at: number, siblingLength: number): void {
    chat.message = Array.from({ length }, (_, i): Message => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `m${i}` }))
    chat.alt = Array.from({ length: siblingLength }, (_, k): ChatAlt => ({
        m: { role: (at + k) % 2 === 0 ? 'user' : 'char', data: `alt${k}`, chatId: `m${at}b${k}` },
        p: k === 0 ? `m${at - 1}` : `m${at}b${k - 1}`, a: 1,
    }))
}
// Three messages whose newest reply has one alternative; the alternative is shown (reply 2 of 2).
function seedNewestReply(): void {
    const chat = activeChat()
    seedChat(chat, 3, 2, 1)
    switchTo(chat, 2, 'm2b0')
}
const view: TreeView = {
    at: (position) => {
        const chat = activeChat()
        const heads = siblingsAt(chat, position)
        if (heads.length < 2) return { index: 1, count: 1 }
        return { index: heads.findIndex((message) => message.chatId === chat.message[position]?.chatId) + 1, count: heads.length }
    },
    continuation: 0,
}

function articleAt(index: number): HTMLElement { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)! }
function bodyOf(index: number): HTMLElement { return articleAt(index).querySelector<HTMLElement>('[data-part="chat-message-body"]')! }
function rowsElement(): HTMLElement { return host.querySelector<HTMLElement>('[data-part="chat-message-list"]')! }
// Lets the mount and its follow-up work finish on real timers, with the frames run by hand.
async function settle(): Promise<void> {
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    runFrame()
    await tick()
    flushSync()
}
async function show(): Promise<void> {
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => height, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { top = value }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host, getTreeView: () => view } })
    await settle()
}
function pointer(kind: string, x: number, time: number, on: Element): void {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
    on.dispatchEvent(event)
    flushSync()
}
// A touch drag over half the body's width, released: it commits the step. The returned element is the predecessor's body.
function swipeCommit(body: HTMLElement, from: number, to: number): HTMLElement {
    Object.defineProperty(body, 'clientWidth', { value: 300 })
    pointer('pointerdown', from, 0, body)
    pointer('pointermove', to, 100, body)
    pointer('pointerup', to, 200, body)
    return body
}
function tapStep(index: number, which: 'prev' | 'next'): void {
    articleAt(index).querySelector<HTMLButtonElement>(`[data-step="${which}"]`)!.click()
    flushSync()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    installFrameQueue()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: function (this: Element) { scrolledInto.push(this) }, configurable: true, writable: true,
    })
    scrolledInto.length = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const rowTop = this.matches('article[data-chat-index="9"]') ? layout.content - top : 0
        return { x: 0, y: rowTop, top: rowTop, left: 0, right: 0, bottom: rowTop, width: 0, height: 0, toJSON: () => ({}) }
    })
    top = 0; height = 1000
    layout.content = 100; layout.afterStep = null
    bodyAtMount.on = false
    DBState.db.chatLoadInitialPages = 3
    DBState.db.chatLoadAdditionalPages = 3
    character.chatPage = 0
    stepSibling.mockImplementation(async (_source: unknown, index: number, _id: string | undefined, direction: 'back' | 'forward') => {
        const chat = character.chats[0]
        const heads = siblingsAt(chat, index)
        const at = heads.findIndex((message) => message.chatId === chat.message[index]?.chatId)
        const head = heads[at + (direction === 'forward' ? 1 : -1)]
        if (head?.chatId) switchTo(chat, index, head.chatId)
        layout.afterStep?.()
    })
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    applyMotionClasses(document.documentElement, NEUTRAL)
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    stepSibling.mockReset(); regenerateNewest.mockClear()
    uninstallFrameQueue()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('the message list at the first animation frame', () => {
    test('a reply that arrives for a reader at the bottom is scrolled into view before the first frame', async () => {
        seedChat(character.chats[0], 3, 2, 0)
        await show()
        const newestRow = (): Element | null => rowsElement().firstElementChild
        const scrolledAtFrame = readAtFirstFrame(() => scrolledInto.filter((element) => element === newestRow()).length)
        character.chats[0].message.push({ role: 'char', data: 'new reply', chatId: 'm3' })
        flushSync()
        await drainMicrotasks()
        runFrame()
        expect(await scrolledAtFrame).toBe(1)
    })

    test('a swipe commit under reduced motion leaves the successor row its fade and the next step at that position none', async () => {
        applyMotionClasses(document.documentElement, REDUCED)
        bodyAtMount.on = true
        seedNewestReply()
        await show()
        const before = swipeCommit(bodyOf(2), 100, 250)
        await drainMicrotasks()
        const after = bodyOf(2)
        expect(activeChat().message[2].chatId).toBe('m2')
        expect(after).not.toBe(before)
        expect(after.getAttribute('data-commit')).toBe('back')
        tapStep(2, 'next')
        await drainMicrotasks()
        expect(activeChat().message[2].chatId).toBe('m2b0')
        expect(bodyOf(2).hasAttribute('data-commit')).toBe(false)
    })

    test('a step on a row above the newest has its first scroll correction applied before the first frame', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        // The reader pulled back to read mid-chat, so the list is not following.
        top = 400
        host.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
        layout.afterStep = () => { layout.content = 160 }
        const topAtFrame = readAtFirstFrame(() => top)
        tapStep(9, 'next')
        await drainMicrotasks()
        runFrame()
        // The step moved the stepped row down by 60 px, so the hold moves scrollTop by the same amount.
        expect(await topAtFrame).toBe(460)
    })
})
