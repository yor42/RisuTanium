// @vitest-environment jsdom
// A step mounts a successor row whose body renders later: the successor keeps the predecessor's height meanwhile, so the transcript
// neither collapses under the reader nor drops the bottom follower. The layout is modelled: header 40 px, rendered body 80 px,
// scrollTop clamped to the scroll extent at each frame, and the scroll event for a clamp delivered after the body has arrived.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const bodies = vi.hoisted(() => ({ pending: [] as { anchor: Comment; text: string }[] }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 30, chatLoadAdditionalPages: 30 } })
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
// The body of the real row renders after an asynchronous parse: it is empty until the test lets it arrive.
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment, props: { msgDisplay: string }) => { bodies.pending.push({ anchor, text: props.msgDisplay }) } }))
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

import DOMPurify from 'dompurify'
import chatBodySource from '../ChatScreens/ChatBody.svelte?raw'
import ShellMessageList from './ShellMessageList.svelte'
import { DBState } from '../../ts/stores.svelte'

const HEADER_PX = 40
const BODY_PX = 80
const CLIENT_PX = 100
const REPLY_COUNT = 5
let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let fire: () => void = () => {}
let top = 0
let extraHeight = 0
let shown = 1
let stepIdx = 1
let clock = 0
const writes: number[] = []
const character = $state({ chaId: 'c', type: 'group', name: 'Ari', image: '', chatPage: 0,
    chats: [{ id: 'room', message: [] as Message[] }] }) as unknown as Character

class FakeObserver {
    callback: () => void
    constructor(callback: () => void) { this.callback = callback }
    observe(node: Element): void { if (node.getAttribute('data-part') === 'chat-message-list') fire = this.callback }
    disconnect(): void {}
}

function articles(): HTMLElement[] { return [...host.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')] }
function articleAt(index: number): HTMLElement { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)! }
function heightOf(row: HTMLElement): number {
    const rendered = row.querySelector('[data-part="chat-message-body"] p') !== null
    return Math.max(HEADER_PX + (rendered ? BODY_PX : 0), parseFloat(row.style.minHeight) || 0)
}
// The list is column-reverse in the DOM: older rows come later, and a row's offset is the height of the rows older than it.
function offsetOf(row: HTMLElement): number {
    const all = articles()
    return all.slice(all.indexOf(row) + 1).reduce((sum, older) => sum + heightOf(older), 0)
}
function scrollHeight(): number { return articles().reduce((sum, row) => sum + heightOf(row), 0) + extraHeight }
function maxTop(): number { return Math.max(0, scrollHeight() - CLIENT_PX) }
// One rendering frame: the browser clamps scrollTop to the current extent; the scroll event for it is delivered later.
function frame(): boolean {
    if (top <= maxTop()) return false
    top = maxTop()
    return true
}
function renderBodies(): void {
    for (const item of bodies.pending.splice(0)) {
        if (!item.anchor.parentNode) continue
        const paragraph = document.createElement('p')
        paragraph.textContent = item.text
        item.anchor.before(paragraph)
    }
}
function showIndicator(row: HTMLElement): void {
    const indicator = document.createElement('span')
    indicator.setAttribute('role', 'status')
    row.querySelector('[data-part="chat-message-body"]')!.appendChild(indicator)
}
async function settleBodies(): Promise<void> {
    renderBodies()
    await tick()
}
function seed(count: number): void {
    const messages: Message[] = []
    for (let i = 0; i < count; i++) messages.push({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: i === stepIdx ? `alt${shown}` : `m${i}` })
    character.chats[0].message = messages
}
async function show(count: number): Promise<void> {
    seed(count)
    DBState.db.characters = [character]
    const view: TreeView = { at: (i) => i === stepIdx ? { index: shown, count: REPLY_COUNT } : { index: 1, count: 1 }, continuation: 0 }
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: scrollHeight, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: CLIENT_PX, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = Math.min(value, maxTop()) }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host, getTreeView: () => view } })
    flushSync()
    await tick()
    await settleBodies()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await settleBodies()
}
function pressStep(index: number): void {
    articleAt(index).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }))
    flushSync()
}
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const height = this.matches('article[data-part="chat-message"]') ? heightOf(this) : 0
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height, toJSON: () => ({}) }
    })
    writes.length = 0; bodies.pending.length = 0
    top = 0; extraHeight = 0; shown = 1; stepIdx = 1; clock = 1000
    DBState.db.autoScrollToNewMessage = true
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    // The real stepper swaps the shown alternative, which gives the row another chat id.
    stepSibling.mockImplementation(async (_source: unknown, index: number, _id: string | undefined, direction: 'back' | 'forward') => {
        shown += direction === 'forward' ? 1 : -1
        character.chats[0].message[index] = { role: 'char', data: `alt text ${shown}`, chatId: `alt${shown}` }
    })
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockReset(); regenerateNewest.mockClear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('a step keeps the transcript where it was while the successor body renders', () => {
    test('a reader at the bottom stays at the bottom after stepping the newest message', async () => {
        await show(2)
        top = maxTop()
        app!.onScroll()
        writes.length = 0
        const before = top
        pressStep(1)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(articleAt(1).getAttribute('data-chat-id')).toBe('alt2')
        const clamped = frame()
        await settleBodies()
        if (clamped) app!.onScroll()
        fire()
        expect(top).toBe(maxTop())
        expect(top).toBe(before)
    })
    test('the stepped row keeps its place and the row below it does not move before its body arrives', async () => {
        stepIdx = 3
        await show(8)
        top = 400
        app!.onScroll()
        writes.length = 0
        const rowBelow = offsetOf(articleAt(4))
        pressStep(3)
        expect(articleAt(3).getAttribute('data-chat-id')).toBe('alt2')
        expect(offsetOf(articleAt(4))).toBe(rowBelow)
        expect(frame()).toBe(false)
        expect(top).toBe(400)
        await settleBodies()
        expect(offsetOf(articleAt(4))).toBe(rowBelow)
        expect(top).toBe(400)
    })
    test('the reserved height is released once the body has rendered, not before', async () => {
        await show(2)
        pressStep(1)
        const row = articleAt(1)
        expect(row.style.minHeight).toBe(`${HEADER_PX + BODY_PX}px`)
        showIndicator(row)
        await tick()
        expect(row.style.minHeight).toBe(`${HEADER_PX + BODY_PX}px`)
        row.querySelector('[role="status"]')!.remove()
        await settleBodies()
        expect(row.style.minHeight).toBe('')
    })
    test('the real translation spinner of ChatBody keeps the reservation, the translated text releases it', async () => {
        await show(2)
        pressStep(1)
        const row = articleAt(1)
        const reserved = `${HEADER_PX + BODY_PX}px`
        expect(row.style.minHeight).toBe(reserved)
        const literal = /const SPINNER_HTML = `([^`]*)`/.exec(chatBodySource)
        expect(literal).not.toBeNull()
        const bodyRoot = row.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
        const spinner = document.createElement('div')
        spinner.innerHTML = DOMPurify.sanitize(literal![1], { ADD_TAGS: ['style'] })
        bodyRoot.appendChild(spinner)
        expect(spinner.querySelector('[style*="animation"]')).not.toBeNull()
        await tick()
        expect(row.style.minHeight).toBe(reserved)
        spinner.remove()
        await settleBodies()
        expect(row.style.minHeight).toBe('')
    })
    test('a pager tap on an older row reserves the predecessor height like a swipe does', async () => {
        stepIdx = 3
        await show(8)
        articleAt(3).querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        flushSync()
        expect(articleAt(3).getAttribute('data-chat-id')).toBe('alt2')
        expect(articleAt(3).style.minHeight).toBe(`${HEADER_PX + BODY_PX}px`)
    })
    test('focus on a pager arrow moves to the same arrow of the successor row', async () => {
        stepIdx = 3
        await show(8)
        const next = articleAt(3).querySelector<HTMLButtonElement>('[data-step="next"]')!
        next.focus()
        expect(document.activeElement).toBe(next)
        next.click()
        flushSync()
        await tick()
        const successor = articleAt(3).querySelector<HTMLButtonElement>('[data-step="next"]')
        expect(successor).not.toBeNull()
        expect(successor).not.toBe(next)
        expect(document.activeElement).toBe(successor)
    })
    test('when the successor has that arrow disabled the focus falls back to the row itself', async () => {
        stepIdx = 3
        shown = 4
        await show(8)
        const next = articleAt(3).querySelector<HTMLButtonElement>('[data-step="next"]')!
        next.focus()
        next.click()
        flushSync()
        await tick()
        const successor = articleAt(3)
        expect(successor.querySelector<HTMLButtonElement>('[data-step="next"]')!.disabled).toBe(true)
        expect(document.activeElement).toBe(successor)
    })
    test('a step that comes long after the recorded height reserves nothing', async () => {
        await show(2)
        stepSibling.mockImplementation(async (_source: unknown, index: number) => {
            clock += 3000
            shown += 1
            character.chats[0].message[index] = { role: 'char', data: 'late', chatId: `alt${shown}` }
        })
        pressStep(1)
        expect(articleAt(1).style.minHeight).toBe('')
    })
    test('a reader who scrolls up after the step still leaves the follow mode', async () => {
        await show(2)
        top = maxTop()
        app!.onScroll()
        pressStep(1)
        await settleBodies()
        fire()
        writes.length = 0
        host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -40 }))
        top = maxTop() - 30
        app!.onScroll()
        extraHeight += 50
        fire()
        expect(writes).toEqual([])
        expect(top).toBe(maxTop() - 80)
    })
})
