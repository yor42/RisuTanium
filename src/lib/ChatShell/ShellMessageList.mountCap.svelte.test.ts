// @vitest-environment jsdom
// The new shell mounts at most 100 message articles (the first message included). Reading back slides the window: older rows mount,
// the newest fully off-screen rows unmount, and the reading position is held. The layout is a per-index model (row heights 90 and
// 117 px; the first message 100 px) over the rows that are actually mounted, so off-screen counts and offsets follow the mounted set.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Chat, ChatAlt, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'
import { siblingsAt, switchTo } from '../../ts/process/chatTree'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const editors = vi.hoisted(() => ({ open: false }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as unknown[], username: 'User', userIcon: '', translator: '', swipe: true, autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 30, chatLoadAdditionalPages: 15 } })
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
let top = 0
let hostHeight = 600
const writes: number[] = []
const frames = new Map<number, () => void>()
let frameId = 0
const scrolledTo: string[] = []
// Every rect read, classified when it happens: a read of an element inside a message container (not the container itself) forces that row's layout,
// and `index` names the article the read belongs to.
const CONTAINER = '[data-part="chat-message-container"]'
const reads: { inContainer: boolean, index: string | null }[] = []
const grown = { index: null as number | null, by: 0 }
const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0, alternateGreetings: ['Second'],
    chats: [{ id: 'room', message: [] as Message[], alt: [] as ChatAlt[] }, { id: 'other', message: [] as Message[], alt: [] as ChatAlt[] }] }) as unknown as Character

class FakeObserver {
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

function rowHeight(index: number): number { return (index < 0 ? 100 : index % 2 === 0 ? 90 : 117) + (index === grown.index ? grown.by : 0) }
function inContainerReads(except?: string): number { return reads.filter((read) => read.inContainer && read.index !== except).length }
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
function modelIndexOf(element: HTMLElement): number | null {
    const article = element.matches('article[data-chat-index]') ? element
        : element.matches('[data-part="chat-message-container"], [data-part="chat-first-message"]') ? element.querySelector<HTMLElement>('article[data-chat-index]') : null
    return article ? Number(article.dataset.chatIndex) : null
}
function rect(rectTop: number, height: number): DOMRect {
    return { x: 0, y: rectTop, top: rectTop, left: 0, right: 0, bottom: rectTop + height, width: 0, height, toJSON: () => ({}) }
}
// The row nearest the top of the viewport that is not scrolled out of it.
function viewportTopRow(): number {
    for (const index of mountedIndexes()) if (rowTop(index) + rowHeight(index) > 0) return index
    return -1
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
    app = mount(ShellMessageList, { target: host, props: { character, host, getTreeView: () => view } })
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
function tapNext(index: number): void {
    articleAt(index)!.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
    flushSync()
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { frameId += 1; frames.set(frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    writes.length = 0; frames.clear(); scrolledTo.length = 0
    editors.open = false
    chatFoldedStateMessageIndex.index = -1
    ScrollToMessageStore.value = -1
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        value: function (this: HTMLElement) { scrolledTo.push(this.dataset.chatIndex ?? '') }, configurable: true, writable: true,
    })
    reads.length = 0; grown.index = null; grown.by = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        reads.push({ inContainer: !this.matches(CONTAINER) && this.closest(CONTAINER) !== null, index: this.closest<HTMLElement>('article[data-chat-index]')?.dataset.chatIndex ?? null })
        if (this === host) return rect(0, hostHeight)
        const index = modelIndexOf(this)
        return index === null ? rect(0, 0) : rect(rowTop(index), rowHeight(index))
    })
    top = 0
    character.chatPage = 0
    stepSibling.mockImplementation(async (_source: unknown, index: number, _id: string | undefined, direction: 'back' | 'forward') => {
        const chat = character.chats[0]
        const heads = siblingsAt(chat, index)
        const at = heads.findIndex((message) => message.chatId === chat.message[index]?.chatId)
        const head = heads[at + (direction === 'forward' ? 1 : -1)]
        if (head?.chatId) switchTo(chat, index, head.chatId)
    })
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockReset(); regenerateNewest.mockClear()
    character.chats[0].message = []; character.chats[0].alt = []
    character.chats[1].message = []; character.chats[1].alt = []
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('reading back through a long chat holds the mount cap', () => {
    test('T1: 70 load-older steps never mount more than 100 articles, and the first message is mounted at the end', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        expect(mountedIndexes()).toHaveLength(31)
        for (let load = 0; load < 70; load++) {
            await readBack()
            expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        }
        expect(mountedIndexes()[0]).toBe(-1)
        expect(articleAt(-1)).not.toBeNull()
    }, 120000)
    test('T1 additional 500: one load-older step with a stored step of 500 stays within the cap', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 500)
        await readBack()
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(DBState.db.chatLoadAdditionalPages).toBe(500)
    })
    test('T6: a slide that unmounts the newest rows keeps the viewport-top row where it was', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        for (let load = 0; load < 4; load++) await readBack()
        expect(mountedIndexes()).toHaveLength(91)
        top = 50
        const held = viewportTopRow()
        const before = rowTop(held)
        app!.onScroll()
        await settle()
        // The fifth step would mount 106 articles, so the newest rows unmount.
        expect(articleAt(999)).toBeNull()
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(Math.abs(rowTop(held) - before)).toBeLessThanOrEqual(0.5)
    })
    test('T9: a chat switch from a slid window opens the other chat at its newest message', async () => {
        seedLong(character.chats[0], 1000)
        seedLong(character.chats[1], 1000)
        await show(30, 15)
        for (let load = 0; load < 5; load++) await readBack()
        expect(articleAt(999)).toBeNull()
        character.chatPage = 1
        await settle()
        expect(articleAt(999)).not.toBeNull()
        expect(mountedIndexes()).toHaveLength(31)
    })
})

describe('a jump to an old message', () => {
    test('T3: keeps the cap and mounts the target', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        ScrollToMessageStore.value = 10
        await settle()
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(articleAt(7)).not.toBeNull()
        expect(scrolledTo).toEqual(['7'])
    })
})

describe('a step hold ends at the cap', () => {
    test('T4: the committed window is trimmed to 100 and the stepped row keeps its top before the frame pass', async () => {
        seedChat(activeChat(), 60, 10, 100)
        await show(60, 15)
        expect(mountedIndexes()).toHaveLength(61)
        top = layoutTop(10) - 100
        const before = rowTop(10)
        tapNext(10)
        await tick()
        expect(mountedIndexes().length).toBeLessThanOrEqual(150)
        await settle(false)
        expect(activeChat().message).toHaveLength(110)
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(Math.abs(rowTop(10) - before)).toBeLessThanOrEqual(0.5)
        runFrames()
        await settle()
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(Math.abs(rowTop(10) - before)).toBeLessThanOrEqual(0.5)
    })
    test('T4 older rows: with the newer rows on screen the oldest rows unmount and the stepped row still keeps its top before the frame pass', async () => {
        seedChat(activeChat(), 60, 59, 51)
        await show(60, 15, 4500)
        top = layoutTop(59) - 100
        const before = rowTop(59)
        tapNext(59)
        await tick()
        await settle(false)
        expect(activeChat().message).toHaveLength(110)
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(mountedIndexes()[0]).toBeGreaterThan(-1)
        expect(Math.abs(rowTop(59) - before)).toBeLessThanOrEqual(0.5)
    })
    test('T4b: a kept commit with a newer trim leaves the newest article unmounted and does not land at the bottom', async () => {
        seedChat(activeChat(), 60, 10, 100)
        await show(60, 15)
        top = layoutTop(10) - 100
        tapNext(10)
        await tick()
        await settle()
        expect(articleAt(109)).toBeNull()
        const bottom = Math.max(0, contentHeight() - hostHeight)
        expect(writes.filter((value) => value >= bottom)).toEqual([])
    })
    test('T4b: a chain that outgrows the hold lands at the newest message from an unslid window', async () => {
        seedChat(activeChat(), 60, 10, 110)
        await show(60, 15)
        top = layoutTop(10) - 100
        tapNext(10)
        await tick()
        await settle()
        expect(activeChat().message).toHaveLength(120)
        expect(articleAt(119)).not.toBeNull()
        expect(top).toBe(Math.max(0, contentHeight() - hostHeight))
    })
    test('T15: a step on a row of a slid window keeps the row, stays within 150 during and 100 after, and ends kept', async () => {
        seedChat(activeChat(), 1000, 580, 100)
        await show(30, 15)
        ScrollToMessageStore.value = 550
        await settle()
        expect(mountedIndexes()).toHaveLength(100)
        expect(Math.max(...mountedIndexes())).toBe(600)
        top = layoutTop(580) - 100
        const before = rowTop(580)
        writes.length = 0
        tapNext(580)
        await tick()
        expect(mountedIndexes().length).toBeLessThanOrEqual(150)
        expect(articleAt(580)).not.toBeNull()
        await settle(false)
        expect(activeChat().message).toHaveLength(680)
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(articleAt(580)).not.toBeNull()
        expect(Math.max(...mountedIndexes())).toBe(600)
        expect(Math.abs(rowTop(580) - before)).toBeLessThanOrEqual(0.5)
        const bottom = Math.max(0, contentHeight() - hostHeight)
        expect(writes.filter((value) => value >= bottom)).toEqual([])
    })
})

describe('an open message editor blocks unmounting', () => {
    test('T10: load-older stops at the cap while an editor is open and slides again once it closes', async () => {
        seedLong(activeChat(), 1000)
        editors.open = true
        await show(30, 15)
        for (let load = 0; load < 12; load++) {
            await readBack()
            expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        }
        const stopped = mountedIndexes()
        expect(stopped).toHaveLength(100)
        expect(Math.max(...stopped)).toBe(999)
        editors.open = false
        await readBack()
        const after = mountedIndexes()
        expect(after.length).toBeLessThanOrEqual(100)
        expect(after[0]).toBeLessThan(stopped[0])
        expect(Math.max(...after)).toBeLessThan(999)
    })
    test('a near jump does not lower the pages of a window above the cap that a step hold left behind', async () => {
        seedChat(activeChat(), 60, 10, 100)
        await show(60, 15)
        top = layoutTop(10) - 100
        editors.open = true
        tapNext(10)
        await tick()
        await settle(false)
        const kept = mountedIndexes()
        expect(kept.length).toBeGreaterThan(100)
        ScrollToMessageStore.value = 100
        await settle()
        expect(mountedIndexes()).toEqual(kept)
    })
})

describe('classifying off-screen rows reads no row content', () => {
    test('R1: a read-back below the cap reads no element inside a row container and restores the bottom distance', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const distance = contentHeight() - 50
        reads.length = 0
        top = 50
        app!.onScroll()
        expect(inContainerReads()).toBe(0)
        await settle()
        expect(mountedIndexes()).toHaveLength(46)
        expect(Math.abs(contentHeight() - top - distance)).toBeLessThanOrEqual(0.5)
    })
    test('R2: a read-back at the cap reads no element inside a row container and unmounts the 15 newest rows', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        for (let load = 0; load < 5; load++) await readBack()
        expect(mountedIndexes()).toHaveLength(100)
        expect(articleAt(-1)).toBeNull()
        const before = mountedIndexes()
        reads.length = 0
        top = 50
        app!.onScroll()
        expect(inContainerReads()).toBe(0)
        await settle()
        expect(mountedIndexes()).toHaveLength(100)
        expect(articleAt(999)).toBeNull()
        expect(before.filter((index) => articleAt(index) === null)).toEqual(before.slice(-15))
    })
    test('R3: a step hold that commits a kept window reads no row content but the stepped row', async () => {
        seedChat(activeChat(), 60, 10, 100)
        await show(60, 15)
        top = layoutTop(10) - 100
        reads.length = 0
        tapNext(10)
        await tick()
        await settle(false)
        runFrames()
        await settle()
        expect(activeChat().message).toHaveLength(110)
        expect(mountedIndexes().length).toBeGreaterThan(50)
        expect(mountedIndexes().length).toBeLessThanOrEqual(100)
        expect(inContainerReads('10')).toBe(0)
    })
    test('G2b: a stream chunk that grows the newest row between load-older and its restore lands at the old distance from the bottom', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const distance = contentHeight() - 50
        top = 50
        app!.onScroll()
        grown.index = 999
        grown.by = 200
        await settle()
        expect(mountedIndexes()).toHaveLength(46)
        expect(Math.abs(contentHeight() - top - distance)).toBeLessThanOrEqual(0.5)
    })
    test('G3: further scroll events while a restore is pending start no second load', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        top = 50
        app!.onScroll()
        app!.onScroll()
        await settle()
        expect(mountedIndexes()).toHaveLength(46)
    })
    test('G5: a read-back keeps the mounted article nodes below the cap and drops exactly the 15 newest at the cap', async () => {
        seedLong(activeChat(), 1000)
        await show(30, 15)
        const held = new Map(mountedIndexes().map((index) => [index, articleAt(index)!]))
        await readBack()
        for (const [index, node] of held) {
            expect(node.isConnected).toBe(true)
            expect(articleAt(index)).toBe(node)
        }
        for (let load = 0; load < 4; load++) await readBack()
        const full = new Map(mountedIndexes().map((index) => [index, articleAt(index)!]))
        expect(full.size).toBe(100)
        await readBack()
        const gone = [...full].filter(([, node]) => !node.isConnected).map(([index]) => index)
        expect(gone).toEqual([...full.keys()].slice(-15))
        for (const [index, node] of full) if (!gone.includes(index)) expect(articleAt(index)).toBe(node)
    })
})

describe('windows below the cap and under a fold keep the old shape', () => {
    test('G2: a folded chat of 40 mounts rows 0 to 20 and no first message; an unfolded one mounts 9 to 39', async () => {
        seedLong(activeChat(), 40)
        chatFoldedStateMessageIndex.index = 20
        await show(30, 15)
        expect(mountedIndexes()).toEqual(Array.from({ length: 21 }, (_, i) => i))
        await unmount(app!)
        app = undefined
        target.remove()
        chatFoldedStateMessageIndex.index = -1
        await show(30, 15)
        expect(mountedIndexes()).toEqual(Array.from({ length: 31 }, (_, i) => i + 9))
    })
})
