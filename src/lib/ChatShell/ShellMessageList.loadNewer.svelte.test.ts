// @vitest-environment jsdom
// Reading forward in a slid window: when the reader nears the bottom of the mounted rows, newer rows mount, the oldest off-screen
// rows unmount, and the viewport-top row keeps its top. The layout is a per-index model (row heights 90 and 117 px) over the rows
// that are actually mounted, so offsets follow the mounted set.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'
import { siblingsAt } from '../../ts/process/chatTree'

const editors = vi.hoisted(() => ({ open: false }))
const stepSibling = vi.hoisted(() => vi.fn())
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 30, chatLoadAdditionalPages: 15 } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest: vi.fn() }))
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
const writes: number[] = []
const frames = new Map<number, () => void>()
const observers = new Set<() => void>()
let frameId = 0
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

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
// A chat of `length` messages where position `at` has a sibling chain of `siblingLength` records that departs from m{at-1}.
function seedChat(chat: Chat, length: number, at: number, siblingLength: number): void {
    seedLong(chat, length)
    chat.alt = Array.from({ length: siblingLength }, (_, k): ChatAlt => ({
        m: { role: (at + k) % 2 === 0 ? 'user' : 'char', data: `alt${k}`, chatId: `m${at}b${k}` },
        p: k === 0 ? `m${at - 1}` : `m${at}b${k - 1}`, a: 1,
    }))
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
async function readBack(): Promise<void> {
    top = 50
    app!.onScroll()
    await settle()
}
// A 2000-message chat read back until 51 of its newest rows have unmounted (eight steps of 15, the last five past the cap).
const LAST = 1999
async function slideBack(): Promise<void> {
    seedLong(activeChat(), 2000)
    await show(30, 15)
    for (let load = 0; load < 8; load++) await readBack()
    expect(articleAt(LAST)).toBeNull()
    expect(Math.max(...mountedIndexes())).toBe(LAST - 51)
}
function tapNext(index: number): void {
    articleAt(index)!.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
    flushSync()
}
function wheelUp(): void {
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    writes.length = 0; frames.clear(); observers.clear()
    editors.open = false
    stepSibling.mockReset()
    chatFoldedStateMessageIndex.index = -1
    ScrollToMessageStore.value = -1
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: function () {}, configurable: true, writable: true,
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
    stepSibling.mockReset()
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('reading forward in a slid window', () => {
    test('T11: near the bottom of the mounted rows newer rows mount within the cap and the viewport-top row keeps its top', async () => {
        await slideBack()
        const before = mountedIndexes()
        const newestBefore = before[before.length - 1]
        top = bottomTop()
        const held = viewportTopRow()
        const heldTop = rowTop(held)
        app!.onScroll()
        await settle()
        const after = mountedIndexes()
        expect(after[after.length - 1]).toBe(newestBefore + 15)
        expect(after.length).toBeLessThanOrEqual(100)
        expect(after[0]).toBeGreaterThan(before[0])
        expect(articleAt(held)).not.toBeNull()
        expect(Math.abs(rowTop(held) - heldTop)).toBeLessThanOrEqual(0.5)
    })
    test('T11: the second pass in the next frame restores the held row when the layout settled late', async () => {
        await slideBack()
        top = bottomTop()
        const held = viewportTopRow()
        const heldTop = rowTop(held)
        app!.onScroll()
        await settle(false)
        // A late layout shift moves the held row after the first pass.
        top += 30
        expect(Math.abs(rowTop(held) - heldTop)).toBeGreaterThan(0.5)
        runFrames()
        await settle(false)
        expect(Math.abs(rowTop(held) - heldTop)).toBeLessThanOrEqual(0.5)
    })
    test('T11: repeated reads forward reach the newest message, which ends the slid state', async () => {
        await slideBack()
        for (let step = 0; step < 12 && !articleAt(LAST); step++) {
            top = bottomTop()
            app!.onScroll()
            await settle()
            expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        }
        expect(articleAt(LAST)).not.toBeNull()
        expect(props.unread).toBe(false)
        top = bottomTop()
        app!.onScroll()
        await settle()
        expect(props.atBottom).toBe(true)
        expect(props.unread).toBe(false)
    })
    test('T11: a reader far from the bottom of the mounted rows loads nothing', async () => {
        await slideBack()
        const before = mountedIndexes()
        top = 300
        app!.onScroll()
        await settle()
        expect(mountedIndexes()).toEqual(before)
    })
    test('T11: a second scroll event while a load is pending does not slide again', async () => {
        await slideBack()
        const newestBefore = Math.max(...mountedIndexes())
        top = bottomTop()
        app!.onScroll()
        app!.onScroll()
        await settle()
        expect(Math.max(...mountedIndexes())).toBe(newestBefore + 15)
    })
})

describe('an open editor stops load-newer at the cap', () => {
    test('nothing unmounts and nothing mounts while an editor is open, and the next read slides once it closes', async () => {
        await slideBack()
        const before = mountedIndexes()
        expect(before).toHaveLength(100)
        editors.open = true
        top = bottomTop()
        app!.onScroll()
        await settle()
        expect(mountedIndexes()).toEqual(before)
        editors.open = false
        top = bottomTop()
        app!.onScroll()
        await settle()
        const after = mountedIndexes()
        expect(after[after.length - 1]).toBe(before[before.length - 1] + 15)
        expect(after.length).toBeLessThanOrEqual(100)
        expect(after[0]).toBeGreaterThan(before[0])
    })
})

describe('a slid window follows its mounted bottom only when the newest message is mounted', () => {
    test('a row resize at the mounted bottom of a slid window does not move the reader', async () => {
        await slideBack()
        editors.open = true
        top = bottomTop()
        app!.onScroll()
        await settle()
        // The list content grows past the scroll position at the mounted bottom: a follower of the newest message would write it.
        hostHeight -= 100
        writes.length = 0
        fireObservers()
        await settle()
        expect(writes).toEqual([])
    })
})

describe('load-newer and load-older wait for each other and for a hold', () => {
    test('a step hold in flight blocks load-newer', async () => {
        seedChat(activeChat(), 1000, 580, 100)
        await show(30, 15)
        ScrollToMessageStore.value = 550
        await settle()
        expect(Math.max(...mountedIndexes())).toBe(600)
        stepSibling.mockImplementation(() => new Promise<void>(() => {}))
        tapNext(580)
        await tick()
        const before = mountedIndexes()
        top = bottomTop()
        app!.onScroll()
        await settle(false)
        expect(mountedIndexes()).toEqual(before)
    })
    test('a pending load-older restore blocks load-newer', async () => {
        await slideBack()
        top = 50
        app!.onScroll()
        await settle(false)
        const before = mountedIndexes()
        top = bottomTop()
        app!.onScroll()
        await settle(false)
        expect(mountedIndexes()).toEqual(before)
        runFrames()
        await settle()
        top = bottomTop()
        app!.onScroll()
        await settle()
        expect(Math.max(...mountedIndexes())).toBe(before[before.length - 1] + 15)
    })
    test('a pending load-newer blocks load-older', async () => {
        await slideBack()
        top = bottomTop()
        app!.onScroll()
        await settle(false)
        const before = mountedIndexes()
        top = 50
        app!.onScroll()
        await settle(false)
        expect(mountedIndexes()).toEqual(before)
        runFrames()
        await settle()
        top = 50
        app!.onScroll()
        await settle()
        expect(mountedIndexes()[0]).toBeLessThan(before[0])
    })
})

describe('the load-newer correction yields to the reader', () => {
    test('T12: reader intent before the first pass cancels both passes', async () => {
        await slideBack()
        const newestBefore = Math.max(...mountedIndexes())
        top = bottomTop()
        app!.onScroll()
        wheelUp()
        writes.length = 0
        await settle()
        expect(Math.max(...mountedIndexes())).toBe(newestBefore + 15)
        expect(writes).toEqual([])
    })
    test('T12: reader intent after the first pass cancels the frame pass', async () => {
        await slideBack()
        const newestBefore = Math.max(...mountedIndexes())
        top = bottomTop()
        app!.onScroll()
        await settle(false)
        expect(Math.max(...mountedIndexes())).toBe(newestBefore + 15)
        top += 30
        wheelUp()
        writes.length = 0
        const moved = top
        runFrames()
        await settle(false)
        expect(writes).toEqual([])
        expect(top).toBe(moved)
    })
})
