// @vitest-environment jsdom
// An alternative step swaps the reply chain from one row on. The list pins the oldest mounted position for the duration of the step,
// so a shorter chain mounts no older rows above the reader, a longer one keeps the first message mounted, and the transcript's native
// anchoring is suppressed while the hold owns the position. The branches come from the real chat tree (switchTo), as the real stepper makes them.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'
import { siblingsAt, switchTo } from '../../ts/process/chatTree'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
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

let app: ReturnType<typeof ShellMessageList> | undefined
let target: HTMLElement
let host: HTMLElement
let top = 0
let height = 1000
const writes: number[] = []
const frames = new Map<number, () => void>()
let frameId = 0
let stepGate: Promise<void> | null = null
// The stepped row (index 9) sits at content pixels from the top of the scroll content; fterStep models the layout change the step causes.
const layout = { content: 100, afterStep: null as (() => void) | null }
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }, { id: 'other', message: [] as Message[] }] }) as unknown as Character

class FakeObserver {
    observe(): void {}
    disconnect(): void {}
}

// Callbacks of the observers that watch the rows element, so a test can fire the follower's size-change callback by hand.
const rowsObservers: (() => void)[] = []
class CapturingObserver {
    constructor(private readonly callback: () => void) {}
    observe(element: Element): void { if (element.matches('[data-part="chat-message-list"]')) rowsObservers.push(this.callback) }
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
const view: TreeView = {
    at: (position) => {
        const chat = activeChat()
        const heads = siblingsAt(chat, position)
        if (heads.length < 2) return { index: 1, count: 1 }
        return { index: heads.findIndex((message) => message.chatId === chat.message[position]?.chatId) + 1, count: heads.length }
    },
    continuation: 0,
}

function mountedIndexes(): number[] {
    return [...host.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')].map((row) => Number(row.dataset.chatIndex)).sort((a, b) => a - b)
}
function articleAt(index: number): HTMLElement { return host.querySelector<HTMLElement>(`article[data-chat-index="${index}"]`)! }
// Every row index added to the transcript from now on, including a row that is mounted and removed again within one step.
function watchMounts(): Set<number> {
    const seen = new Set<number>()
    const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue
            const found = node.matches('article[data-chat-index]') ? [node] : [...node.querySelectorAll('article[data-chat-index]')]
            for (const row of found) if (row instanceof HTMLElement) seen.add(Number(row.dataset.chatIndex))
        }
    })
    observer.observe(host, { childList: true, subtree: true })
    return seen
}
function runFrames(): void {
    for (const [id, callback] of [...frames]) { frames.delete(id); callback() }
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
async function show(): Promise<void> {
    DBState.db.characters = [character]
    target = document.createElement('div')
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { get: () => height, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(host, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
    target.appendChild(host)
    document.body.appendChild(target)
    app = mount(ShellMessageList, { target: host, props: { character, host, getTreeView: () => view } })
    await settle()
    // The mount rests the reader at the newest message; the tests start from a reader who pulled back to read mid-chat.
    top = 400
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
    writes.length = 0
    frames.clear()
}
function tapNext(index: number): void {
    articleAt(index).querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
    flushSync()
}
function anchorValue(): string { return host.style.getPropertyValue('overflow-anchor') }

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    writes.length = 0; frames.clear(); stepGate = null
    layout.content = 100; layout.afterStep = null
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const rowTop = this.matches('article[data-chat-index="9"]') ? layout.content - top : 0
        return { x: 0, y: rowTop, top: rowTop, left: 0, right: 0, bottom: rowTop, width: 0, height: 0, toJSON: () => ({}) }
    })
    top = 0; height = 1000
    DBState.db.chatLoadInitialPages = 3
    DBState.db.chatLoadAdditionalPages = 3
    character.chatPage = 0
    stepSibling.mockImplementation(async (_source: unknown, index: number, _id: string | undefined, direction: 'back' | 'forward') => {
        if (stepGate) await stepGate
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
    stepSibling.mockReset(); regenerateNewest.mockClear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('a step onto a shorter chain keeps the window where it was', () => {
    test('no row older than the previous oldest mounted row mounts, during the step and after the hold has ended', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        expect(mountedIndexes()).toEqual([8, 9, 10, 11])
        const seen = watchMounts()
        tapNext(9)
        await tick()
        flushSync()
        expect(character.chats[0].message.length).toBe(11)
        expect(mountedIndexes()).toEqual([8, 9, 10])
        await settle()
        expect(mountedIndexes()).toEqual([8, 9, 10])
        // A row mounted above the reader for a moment would shift the reader even if it is gone again after the commit.
        expect([...seen].filter((index) => index < 8)).toEqual([])
    })
    test('after the hold the window is an ordinary one again: a later load older still reaches older rows', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        tapNext(9)
        await settle()
        top = 50
        app!.onScroll()
        await settle()
        expect(mountedIndexes()[0]).toBeLessThan(8)
    })
})

describe('a step in a short chat keeps the first message mounted as the same node', () => {
    test('a longer chain past the page count does not unmount the first message', async () => {
        DBState.db.chatLoadInitialPages = 8
        seedChat(character.chats[0], 6, 3, 6)
        await show()
        const first = host.querySelector('[data-part="chat-first-message"]')
        expect(first).not.toBeNull()
        tapNext(3)
        await tick()
        flushSync()
        expect(character.chats[0].message.length).toBe(9)
        expect(first!.isConnected).toBe(true)
        await settle()
        expect(first!.isConnected).toBe(true)
        expect(host.querySelector('[data-part="chat-first-message"]')).toBe(first)
        expect(mountedIndexes()).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7, 8])
    })
    test('a shorter chain keeps it too', async () => {
        DBState.db.chatLoadInitialPages = 8
        seedChat(character.chats[0], 8, 3, 2)
        await show()
        const first = host.querySelector('[data-part="chat-first-message"]')
        expect(first).not.toBeNull()
        tapNext(3)
        await settle()
        expect(character.chats[0].message.length).toBe(5)
        expect(host.querySelector('[data-part="chat-first-message"]')).toBe(first)
        expect(first!.isConnected).toBe(true)
    })
    test('stepping the first message itself holds it in place without remounting anything', async () => {
        DBState.db.chatLoadInitialPages = 8
        seedChat(character.chats[0], 6, 3, 2)
        await show()
        const first = host.querySelector('[data-part="chat-first-message"]')
        const before = mountedIndexes()
        tapNext(-1)
        expect(anchorValue()).toBe('none')
        await settle()
        expect(anchorValue()).toBe('')
        expect(host.querySelector('[data-part="chat-first-message"]')).toBe(first)
        expect(mountedIndexes()).toEqual(before)
    })
})

describe('the transcript anchoring is suppressed on the real host for the length of a hold', () => {
    test('none while the step is pending and until the frame pass, empty after it', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(9)
        expect(anchorValue()).toBe('none')
        release()
        await tick()
        await Promise.resolve()
        flushSync()
        expect(anchorValue()).toBe('none')
        await settle()
        expect(anchorValue()).toBe('')
    })
    test('unmounting the list during a hold removes it', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(9)
        expect(anchorValue()).toBe('none')
        await unmount(app!)
        app = undefined
        expect(anchorValue()).toBe('')
        release()
        await settle()
        expect(anchorValue()).toBe('')
    })
    test('changing to another chat during a hold drops it: the old chat\'s pin never reaches the new chat and nothing is written', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        seedChat(character.chats[1], 100, 9, 2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(9)
        expect(anchorValue()).toBe('none')
        const seen = watchMounts()
        character.chatPage = 1
        flushSync()
        expect(anchorValue()).toBe('')
        await settle()
        top = 400
        writes.length = 0
        release()
        await settle()
        expect(writes).toEqual([])
        expect(mountedIndexes()).toEqual([96, 97, 98, 99])
        // The new chat renders through its own window; the old chat's pin never makes it mount the rows between.
        expect([...seen].filter((index) => index < 96)).toEqual([])
        expect(anchorValue()).toBe('')
    })
})

describe('the list wires the hold to its rows element and to the bottom follower', () => {
    function rowsElement(): HTMLElement { return host.querySelector<HTMLElement>('[data-part="chat-message-list"]')! }
    test('the scroll range is reserved on the rows element for the length of a step, and removed after it', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(9)
        expect(rowsElement().style.getPropertyValue('padding-bottom')).toBe('1000px')
        release()
        await settle()
        expect(rowsElement().style.getPropertyValue('padding-bottom')).toBe('')
    })
    test('a size change of the rows during a hold on the newest row writes no scroll position; the hold end applies it', async () => {
        rowsObservers.length = 0
        vi.stubGlobal('ResizeObserver', CapturingObserver)
        seedChat(character.chats[0], 12, 11, 1)
        await show()
        expect(rowsObservers.length).toBeGreaterThan(0)
        // The reader is back at the bottom, so the follower is following when the step starts on the newest row.
        top = 900
        app!.onScroll()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(11)
        expect(anchorValue()).toBe('none')
        writes.length = 0
        height = 1300
        for (const callback of rowsObservers) callback()
        expect(writes).toEqual([])
        release()
        await settle()
        expect(writes).toEqual([1200])
    })
})

describe('the frame pass of a hold', () => {
    // The step moves the stepped row down by 60 px; the hold moves scrollTop by 60. Content then settles another 15 px.
    async function stepThenSettle(): Promise<void> {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        layout.afterStep = () => { layout.content = 160 }
        tapNext(9)
        await settle(false)
        expect(writes).toEqual([460])
        layout.content = 175
    }
    test('corrects what settled after the first correction', async () => {
        await stepThenSettle()
        runFrames()
        expect(writes).toEqual([460, 475])
    })
    test('yields to a reader who moved the view in between', async () => {
        await stepThenSettle()
        host.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
        runFrames()
        expect(writes).toEqual([460])
    })
})

describe('a page count written while the window is pinned', () => {
    test('a jump to an older message during a hold keeps the larger count when the pin is released', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(9)
        ScrollToMessageStore.value = 2
        flushSync()
        release()
        await settle()
        expect(mountedIndexes().slice(0, 2)).toEqual([-1, 0])
    })
})

describe('a load older that is still settling when a step starts', () => {
    test('writes nothing once the hold owns the position, and the rows it mounted stay mounted', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        top = 50
        app!.onScroll()
        await tick()
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 0))
        flushSync()
        expect(mountedIndexes()[0]).toBe(5)
        // Its frame pass is still queued; the step starts first, and the content then grows so a late restore would write.
        tapNext(9)
        writes.length = 0
        height = 1300
        runFramesFirstOnly()
        expect(writes).toEqual([])
        await settle()
        expect(mountedIndexes()[0]).toBe(5)
    })
    test('rows a load older asked for but has not mounted yet are part of the pinned window', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        top = 50
        app!.onScroll()
        // The page count has grown but the rows are not rendered: the pin is read from state, not from the mounted rows.
        tapNext(9)
        await settle()
        expect(mountedIndexes()).toEqual([5, 6, 7, 8, 9, 10])
    })
    test('a scroll near the top during a hold does not start another load older', async () => {
        seedChat(character.chats[0], 12, 9, 2)
        await show()
        let release: () => void = () => {}
        stepGate = new Promise<void>((resolve) => { release = resolve })
        tapNext(9)
        top = 50
        app!.onScroll()
        await settle()
        expect(mountedIndexes()[0]).toBe(8)
        release()
        await settle()
        expect(mountedIndexes()[0]).toBe(8)
    })
})

// The oldest queued frame is the load older frame pass; the hold's own frame comes later.
function runFramesFirstOnly(): void {
    const first = [...frames.entries()][0]
    if (!first) return
    frames.delete(first[0])
    first[1]()
}
