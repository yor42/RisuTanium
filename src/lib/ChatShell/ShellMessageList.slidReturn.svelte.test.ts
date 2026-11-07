// @vitest-environment jsdom
// A message appended while the reader is not following never unmounts a mounted row; a slid window (newest message not mounted)
// shows the new-message button and a tap rebuilds the newest window. The layout is a per-index model (row heights 90 and 117 px)
// over the rows that are actually mounted, so offsets follow the mounted set.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'

const editors = vi.hoisted(() => ({ open: false }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 30, chatLoadAdditionalPages: 15 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling: vi.fn(), regenerateNewest: vi.fn() }))
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
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => editors.open, onDraftsChanged: () => () => {} }))
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
import { DBState, ScrollToMessageStore } from '../../ts/stores.svelte'
import { chatFoldedStateMessageIndex } from '../../ts/globalApi.svelte'

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let props: { character: Character, host: HTMLElement, getTreeView: () => TreeView, unread: boolean, atBottom: boolean }
let top = 0
let hostHeight = 600
let appended = 0
const writes: number[] = []
const frames = new Map<number, () => void>()
const observers = new Set<() => void>()
let frameId = 0
const scrolledTo: string[] = []
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }, { id: 'other', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

class FakeObserver {
    constructor(callback: () => void) { observers.add(callback) }
    observe(): void {}
    disconnect(): void {}
}

function activeChat(): Chat { return character.chats[character.chatPage] }
function seedLong(chat: Chat, length: number): void {
    chat.message = Array.from({ length }, (_, i): Message => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `m${i}` }))
    chat.alt = []
}
function appendReplies(count: number): void {
    for (let k = 0; k < count; k++) {
        const chat = activeChat()
        appended += 1
        chat.message.push({ role: 'char', data: `reply${appended}`, chatId: `reply${appended}` })
    }
}
const view: TreeView = { at: () => ({ index: 1, count: 1 }), continuation: 0 }

function rowHeight(index: number): number { return index < 0 ? 100 : index % 2 === 0 ? 90 : 117 }
function mountedIndexes(): number[] {
    return [...host.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')].map((row) => Number(row.dataset.chatIndex)).sort((a, b) => a - b)
}
function articleAt(index: number): HTMLElement | null { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`) }
function layoutTop(index: number): number {
    let sum = 0
    for (const mounted of mountedIndexes()) {
        if (mounted >= index) break
        sum += rowHeight(mounted)
    }
    return sum
}
function contentHeight(): number { return mountedIndexes().reduce((sum, index) => sum + rowHeight(index), 0) }
function rowTop(index: number): number { return layoutTop(index) - top }
function bottomTop(): number { return Math.max(0, contentHeight() - hostHeight) }
function modelIndexOf(element: HTMLElement): number | null {
    const article = element.matches('article[data-chat-index]') ? element
        : element.matches('[data-part="chat-message-container"], [data-part="chat-first-message"]') ? element.querySelector<HTMLElement>('article[data-chat-index]') : null
    return article ? Number(article.dataset.chatIndex) : null
}
function rect(rectTop: number, height: number): DOMRect {
    return { x: 0, y: rectTop, top: rectTop, left: 0, right: 0, bottom: rectTop + height, width: 0, height, toJSON: () => ({}) }
}
function viewportTopRow(): number {
    for (const index of mountedIndexes()) if (rowTop(index) + rowHeight(index) > 0) return index
    return -1
}
function runFrames(): void {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
}
function fireObservers(): void {
    for (const callback of [...observers]) callback()
}
async function settle(withFrames = true): Promise<void> {
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    if (withFrames) runFrames()
    await tick()
    flushSync()
}
async function show(initial: number, additional: number, height = 600): Promise<void> {
    DBState.db.chatLoadInitialPages = initial
    DBState.db.chatLoadAdditionalPages = additional
    hostHeight = height
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => contentHeight(), configurable: true })
    Object.defineProperty(host, 'clientHeight', { get: () => hostHeight, configurable: true })
    Object.defineProperty(host, 'scrollTop', {
        get: () => top,
        set: (value: number) => { const clamped = Math.max(0, Math.min(value, Math.max(0, contentHeight() - hostHeight))); writes.push(clamped); top = clamped },
        configurable: true,
    })
    target.appendChild(host)
    document.body.appendChild(target)
    const bound = $state({ character, host, getTreeView: () => view, unread: false, atBottom: true })
    props = bound
    app = mount(ShellMessageList, { target: host, props: bound })
    await settle()
    // The mount rests the reader at the newest message; the tests start from a reader who pulled back to read.
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
    writes.length = 0
    frames.clear()
}
// The reader is at the top of the loaded rows and asks for older ones.
async function readBack(): Promise<void> {
    top = 50
    app!.onScroll()
    await settle()
}
// The reader reads in the middle of the mounted rows, not following the newest message.
async function readMidWindow(at: number): Promise<void> {
    top = at
    app!.onScroll()
    await settle()
}
// A 1000-message chat read back until the newest rows have unmounted (five steps of 15 past the cap).
async function slideBack(): Promise<void> {
    seedLong(activeChat(), 1000)
    await show(30, 15)
    for (let load = 0; load < 5; load++) await readBack()
    expect(articleAt(999)).toBeNull()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    writes.length = 0; frames.clear(); observers.clear(); scrolledTo.length = 0
    editors.open = false
    chatFoldedStateMessageIndex.index = -1
    ScrollToMessageStore.value = -1
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: function (this: HTMLElement) { scrolledTo.push(this.dataset.chatIndex ?? '') }, configurable: true, writable: true,
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === host) return rect(0, hostHeight)
        const index = modelIndexOf(this)
        return index === null ? rect(0, 0) : rect(rowTop(index), rowHeight(index))
    })
    top = 0
    character.chatPage = 0
    DBState.db.autoScrollToNewMessage = true
    DBState.db.alwaysScrollToNewMessage = false
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    character.chats[0].message = []; character.chats[0].alt = []
    character.chats[1].message = []; character.chats[1].alt = []
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('a reply appended while the reader is not following', () => {
    test('T13: below the cap the window grows, no row unmounts and the viewport-top row keeps its top', async () => {
        seedLong(activeChat(), 200)
        await show(30, 15)
        await readMidWindow(1000)
        const before = mountedIndexes()
        expect(before[0]).toBe(169)
        const held = viewportTopRow()
        const heldTop = rowTop(held)
        appendReplies(1)
        await settle()
        const after = mountedIndexes()
        expect(after[0]).toBe(169)
        expect(after).toEqual([...before, 200])
        expect(Math.abs(rowTop(held) - heldTop)).toBeLessThanOrEqual(0.5)
    })
    test('T14: at the cap the oldest row stays, the reply stays unmounted and the new-message button shows', async () => {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        await readMidWindow(3000)
        expect(mountedIndexes()).toHaveLength(100)
        expect(mountedIndexes()[0]).toBe(900)
        const held = viewportTopRow()
        const heldTop = rowTop(held)
        appendReplies(1)
        await settle()
        expect(mountedIndexes()[0]).toBe(900)
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(articleAt(1000)).toBeNull()
        expect(props.unread).toBe(true)
        expect(props.atBottom).toBe(false)
        expect(Math.abs(rowTop(held) - heldTop)).toBeLessThanOrEqual(0.5)
    })
    test('T17: a following reader at the cap gets the reply mounted and stays at the bottom', async () => {
        seedLong(activeChat(), 1000)
        await show(99, 15)
        top = bottomTop()
        app!.onScroll()
        await settle()
        appendReplies(1)
        await settle()
        fireObservers()
        await settle()
        expect(articleAt(1000)).not.toBeNull()
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(top).toBe(bottomTop())
        expect(props.unread).toBe(false)
    })
})

describe('a jump to a message while an editor is open', () => {
    test('a slid window stays mounted: a far jump does not move it, a jump to a mounted row only scrolls', async () => {
        await slideBack()
        const before = mountedIndexes()
        editors.open = true
        ScrollToMessageStore.value = 100
        await settle()
        expect(mountedIndexes()).toEqual(before)
        const nearNewest = before[before.length - 1] - 5
        ScrollToMessageStore.value = nearNewest
        await settle()
        expect(mountedIndexes()).toEqual(before)
        expect(scrolledTo).toContain(String(nearNewest - 3))
    })
    test('a jump toward the newest message from a slid window does not slide it back while an editor is open', async () => {
        await slideBack()
        const before = mountedIndexes()
        editors.open = true
        ScrollToMessageStore.value = 990
        await settle()
        expect(mountedIndexes()).toEqual(before)
        expect(articleAt(999)).toBeNull()
    })
    test('an unslid window is not slid by a far jump, and still grows for a near one', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const before = mountedIndexes()
        editors.open = true
        ScrollToMessageStore.value = 10
        await settle()
        expect(mountedIndexes()).toEqual(before)
        ScrollToMessageStore.value = 960
        await settle()
        const grown = mountedIndexes()
        expect(grown[0]).toBeLessThan(before[0])
        expect(grown[grown.length - 1]).toBe(999)
        expect(grown.length).toBeLessThanOrEqual(100)
    })
    test('with no editor open the same far jump slides the window around the target', async () => {
        await slideBack()
        ScrollToMessageStore.value = 100
        await settle()
        expect(articleAt(97)).not.toBeNull()
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
    })
})

describe('opening a chat is not an append', () => {
    test('T18 half 1: a long chat opens with its newest message mounted and no button', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        expect(mountedIndexes()).toHaveLength(31)
        expect(mountedIndexes()[0]).toBe(969)
        expect(articleAt(999)).not.toBeNull()
        expect(props.unread).toBe(false)
    })
    test('T18 half 2: switching from a chat the reader scrolled up in to a longer chat opens it unslid', async () => {
        seedLong(character.chats[0], 200)
        seedLong(character.chats[1], 1000)
        await show(30, 15)
        await readMidWindow(1000)
        character.chatPage = 1
        await settle()
        expect(mountedIndexes()).toHaveLength(31)
        expect(articleAt(999)).not.toBeNull()
        expect(props.unread).toBe(false)
    })
})

describe('a slid window shows the new-message button and a tap returns to the newest message', () => {
    test('T8: a slid window publishes the button and a reply arriving into it keeps it', async () => {
        await slideBack()
        expect(props.unread).toBe(true)
        expect(props.atBottom).toBe(false)
        const oldest = mountedIndexes()[0]
        appendReplies(1)
        await settle()
        expect(props.unread).toBe(true)
        expect(props.atBottom).toBe(false)
        expect(mountedIndexes()[0]).toBe(oldest)
        expect(articleAt(1000)).toBeNull()
    })
    test('T5: the bottom of the mounted rows is not the bottom, and a tap rebuilds the newest window', async () => {
        // Far enough back that the load-newer step triggered at the mounted bottom still leaves the newest message unmounted.
        seedLong(activeChat(), 2000)
        await show(30, 15)
        for (let load = 0; load < 8; load++) await readBack()
        expect(articleAt(1999)).toBeNull()
        top = bottomTop()
        app!.onScroll()
        await settle()
        expect(articleAt(1999)).toBeNull()
        expect(props.atBottom).toBe(false)
        expect(props.unread).toBe(true)
        const scrolls = scrolledTo.length
        app!.scrollToLatestMessage()
        await settle()
        expect(articleAt(1999)).not.toBeNull()
        expect(mountedIndexes()).toHaveLength(31)
        expect(scrolledTo.length).toBeGreaterThan(scrolls)
        expect(props.unread).toBe(false)
        expect(props.atBottom).toBe(true)
    })
    test('T5: a tap after a reply arrived into the slid window mounts the reply', async () => {
        await slideBack()
        appendReplies(1)
        await settle()
        app!.scrollToLatestMessage()
        await settle()
        expect(articleAt(1000)).not.toBeNull()
        expect(props.unread).toBe(false)
    })
    test('the keyboard anchor does nothing while the newest message is not mounted, and scrolls once it is', async () => {
        await slideBack()
        const scrolls = scrolledTo.length
        app!.anchorNewestBottom()
        expect(scrolledTo.length).toBe(scrolls)
        app!.scrollToLatestMessage()
        await settle()
        const rebuilt = scrolledTo.length
        app!.anchorNewestBottom()
        expect(scrolledTo.length).toBeGreaterThan(rebuilt)
    })
    test('an open editor on a mounted row keeps a slid window mounted when a reply arrives with always-scroll on', async () => {
        await slideBack()
        const before = mountedIndexes()
        editors.open = true
        DBState.db.alwaysScrollToNewMessage = true
        const scrolls = scrolledTo.length
        appendReplies(1)
        await settle()
        expect(mountedIndexes()).toEqual(before)
        expect(articleAt(1000)).toBeNull()
        expect(scrolledTo.length).toBe(scrolls)
        expect(props.unread).toBe(true)
    })
    test('an open editor keeps a slid window mounted when the new-message button is tapped, and the tap rebuilds once it closes', async () => {
        await slideBack()
        const before = mountedIndexes()
        editors.open = true
        const scrolls = scrolledTo.length
        app!.scrollToLatestMessage()
        await settle()
        expect(mountedIndexes()).toEqual(before)
        expect(scrolledTo.length).toBe(scrolls)
        expect(props.unread).toBe(true)
        editors.open = false
        app!.scrollToLatestMessage()
        await settle()
        expect(articleAt(999)).not.toBeNull()
        expect(props.unread).toBe(false)
    })
    test('T16: a stale bottom left by a shrinking chat does not freeze later replies', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        ScrollToMessageStore.value = 550
        await settle()
        expect(Math.max(...mountedIndexes())).toBe(600)
        activeChat().message.splice(595)
        await settle()
        top = bottomTop()
        app!.onScroll()
        await settle()
        appendReplies(10)
        await settle()
        expect(articleAt(604)).not.toBeNull()
    })
})
