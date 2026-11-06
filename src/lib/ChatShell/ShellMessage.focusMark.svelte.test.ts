// @vitest-environment jsdom
/**
 * The follower treats a focus that the shell itself placed (a sheet handing focus back to its opener, a stepped row's
 * successor taking the focus, the neighbour after a delete) as no departure, while a plain focus into an older row leaves.
 * REAL: `ShellMessage.svelte`, `ActionSheet.svelte`, `ShellSheet.svelte`, `ShellMessageList.svelte`, `bottomAnchor.ts`,
 * `shellFocus.ts`. MOCKED: stores, process actions, parsers and the row body components.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { character as Character, Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const rowMessages = vi.hoisted(() => [] as Message[])
const rowMode = vi.hoisted(() => ({ stubRows: false }))
const surfaceHooks = vi.hoisted(() => ({ hiding: () => {} }))
const alerts = vi.hoisted(() => ({ alertConfirm: vi.fn(async (_text: string) => true), alertSelect: vi.fn(async (_labels: string[], _text?: string) => '1'), alertNormal: vi.fn(), alertError: vi.fn(), alertRequestData: vi.fn() }))
const messageActions = vi.hoisted(() => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: vi.fn(), deleteNow: vi.fn(), copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
    branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}))

vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { username: 'User', userIcon: '', autoTranslate: false,
        autoScrollToNewMessage: true, alwaysScrollToNewMessage: false, chatLoadInitialPages: 2, chatLoadAdditionalPages: 2,
        characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: rowMessages }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    const ScrollToMessageStore = $state({ value: -1 })
    return { DBState, selIdState, HideIconStore: writable(false), ReloadChatPointer: writable<Record<number, number>>({}), ReloadGUIPointer: writable(0), ScrollToMessageStore, createSimpleCharacter: () => null }
})
vi.mock('../../ts/globalApi.svelte', () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return { chatFoldedState, chatFoldedStateMessageIndex, aiLawApplies: () => false }
})
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ hidden: false, rebuildEpoch: 0, closeEpoch: 0, heldGui: 0, heldChat: {} as Record<number, number> })
    return { chatSurface, isChatSurfaceInstalled: () => true, onSurfaceHiding: (callback: () => void) => { surfaceHooks.hiding = callback; return () => {} } }
})
vi.mock('../../ts/process/firstMessage', () => ({ firstMessageOf: () => 'Greeting', firstMessageIndexOf: () => -1, nextFirstMessageIndex: () => -1 }))
vi.mock('../../ts/process/activeStreams', () => ({ isActiveStreamReply: () => false }))
vi.mock('../../ts/localDrafts', () => ({ hasMessageEditorDrafts: () => false, onDraftsChanged: () => () => {} }))
vi.mock('../../ts/chatShell/stopDelete.svelte', () => ({ requestStopDelete: vi.fn(() => true), isStopDeletePending: () => false }))
vi.mock('../../ts/process/chatOrigin', () => ({
    originOf: (owner: { chaId: string }, chat: { id: string }) => ({ chaId: owner.chaId, chatId: chat.id }),
    isWriting: () => false,
}))
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest, abortChat: vi.fn() }))
vi.mock('../../ts/process/index.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) }
})
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic: vi.fn(), readHaptics: () => true }))
vi.mock('../../ts/android/hostBridge', () => ({ gestureInsetLeft: () => 0 }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
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
vi.mock('../../ts/alert', () => alerts)
vi.mock('../../ts/process/messageActions.svelte', () => messageActions)
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, discardConfirmOpen: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: () => ({}) }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {
    chatShellMoreActions: 'More actions', bookmark: 'Bookmark', remove: 'Delete', cancel: 'Cancel',
    chatShellStopAndDelete: 'Stop and delete', chatShellDeleteFromHere: 'Delete from here', chatShellDeletePendingStop: 'Stopping, then deleting...',
    chatShellStopDeleteChanged: 'changed', chatShellReplyInProgress: 'Writing the reply', chatShellStopDeleteCannot: 'cannot',
    chatShellDeleteRangeConfirm: (count: number, excerpt: string) => `range:${count}:${excerpt}`,
    chatShellDeleteRangeButton: (count: number) => `Delete ${count}`,
    chatShellStopDeleteConfirm: (count: number) => `stop:${count}`,
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
    chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellNewReply: 'New reply',
    chatShellFirstReply: 'First', chatShellLastReply: 'Last', chatShellStillWriting: 'Still writing the reply',
    chatShellNoSavedReplies: 'No more saved replies', chatShellReleaseNewReply: 'Let go to generate a new reply',
    chatShellGenerateReply: 'Generate a reply', chatShellEndControl: (count: number) => `Bring back ${count}`,
    loadMore: 'Load more', messageRenderFailed: 'Failed', messageRenderRetry: 'Retry', messageInterrupted: 'Interrupted',
} }))
// The list tests below render the list without row bodies; every other test uses the real row.
vi.mock('./ShellMessage.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./ShellMessage.svelte')>()
    const Row = ((anchor: Comment, props: Record<string, unknown>) => rowMode.stubRows ? {} : (actual.default as unknown as (a: Comment, p: Record<string, unknown>) => object)(anchor, props)) as unknown as typeof actual.default
    return { ...actual, default: Row }
})

import ShellMessage, { type ActionRequest } from './ShellMessage.svelte'
import ShellMessageList from './ShellMessageList.svelte'
import ActionSheet from './ActionSheet.svelte'
import { DBState } from '../../ts/stores.svelte'
import { chatSurface as surface } from '../ChatScreens/chatSurface.svelte'
import { createBottomFollower, type BottomFollower } from '../../ts/chatShell/bottomAnchor'
import { createReaderIntent } from '../../ts/chatShell/readerIntent'
import { asShellFocus } from '../../ts/chatShell/shellFocus'

// The transcript holds five messages; the newest is index 4. Rows are laid out newest first, like the real list.
const NEWEST = 4
const HOST_CLIENT = 100
const HOST_HEIGHT = 300

let host: HTMLElement
let rowList: HTMLElement
let sheetTarget: HTMLElement
let follower: BottomFollower
let rowApps = new Map<number, ReturnType<typeof mount>>()
let sheetApp: ReturnType<typeof mount> | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)

function resetMessages(): void {
    rowMessages.splice(0, rowMessages.length, ...Array.from({ length: 5 }, (_, i) => ({ role: i % 2 ? 'char' : 'user', data: `m${i}`, chatId: `a${i}` }) as Message))
}
function treeView(index: number): TreeView {
    return { at: (i) => i === index ? { index: 2, count: 3 } : { index: 1, count: 1 }, continuation: 0 }
}
function mountRow(idx: number, chatId: string, before: Node | null): void {
    rowApps.set(idx, mount(ShellMessage, { target: rowList, anchor: before ?? undefined, props: {
        idx, chatId, expectedId: chatId, name: 'Ari', message: rowMessages[idx], getTreeView: () => treeView(idx),
        onOpenActions: (request: ActionRequest) => { hostedRequest = request; hostedOpen = true },
    } }))
    flushSync()
}
function rowElement(idx: number): HTMLElement {
    return rowList.querySelector<HTMLElement>(`article[data-part="chat-message"][data-chat-index="${idx}"]`)!
}

// A resting bottom reader (the follower is following from the start) over real rows 4, 3, 2 and 1 and the real action sheet.
function buildTranscript(): void {
    resetMessages()
    host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { value: HOST_HEIGHT, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: HOST_CLIENT, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: HOST_HEIGHT - HOST_CLIENT, writable: true, configurable: true })
    rowList = document.createElement('div')
    rowList.setAttribute('data-part', 'chat-message-list')
    host.appendChild(rowList)
    sheetTarget = document.createElement('div')
    document.body.append(host, sheetTarget)
    for (const idx of [4, 3, 2, 1]) mountRow(idx, `a${idx}`, null)
    sheetApp = mount(ActionSheet, { target: sheetTarget, props: {
        get open() { return hostedOpen },
        get opener() { return hostedRequest?.opener ?? null },
        get available() { return hostedOpen ? hostedRequest?.available() ?? [] : [] },
        get disabled() { return hostedOpen ? hostedRequest?.disabled() ?? [] : [] },
        get generating() { return hostedOpen && hostedRequest?.generating() === true },
        onaction: (id) => hostedRequest?.run(id),
        onclose: () => { hostedOpen = false },
    } })
    flushSync()
    follower = createBottomFollower(host, rowList, () => true, createReaderIntent({ canMove: () => true }), () => NEWEST)
}
// The focus is on the row before the action under test, placed the way the shell places it.
function focusRowAsShell(idx: number): void {
    asShellFocus(() => rowElement(idx).focus())
}

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    rowMode.stubRows = false
    hostedOpen = false
    hostedRequest = null
    stepSibling.mockReset()
    for (const fn of Object.values(messageActions)) fn.mockReset()
    alerts.alertSelect.mockReset().mockResolvedValue('1')
})
afterEach(async () => {
    follower?.dispose()
    if (sheetApp) await unmount(sheetApp)
    sheetApp = undefined
    for (const app of rowApps.values()) await unmount(app).catch(() => {})
    rowApps = new Map()
    host?.remove()
    sheetTarget?.remove()
    vi.unstubAllGlobals()
})

describe('a plain focus into an older row leaves, the shell\'s own focus does not (control)', () => {
    test('an unmarked focus into an older row stops the following', () => {
        buildTranscript()
        expect(follower.isFollowing()).toBe(true)
        rowElement(2).focus()
        expect(document.activeElement).toBe(rowElement(2))
        expect(follower.isFollowing()).toBe(false)
    })
    test('a focus into the newest row does not', () => {
        buildTranscript()
        rowElement(NEWEST).focus()
        expect(document.activeElement).toBe(rowElement(NEWEST))
        expect(follower.isFollowing()).toBe(true)
    })
})

describe('T-A6e: the real sheet returns focus to its opener', () => {
    test('closing the action sheet of an older row refocuses the opener and the follower keeps following', async () => {
        buildTranscript()
        rowElement(2).querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click()
        flushSync()
        expect(hostedOpen).toBe(true)
        expect(rowElement(2).contains(document.activeElement)).toBe(false)
        expect(follower.isFollowing()).toBe(true)
        hostedOpen = false
        flushSync()
        await tick()
        expect(rowElement(2).contains(document.activeElement)).toBe(true)
        expect(follower.isFollowing()).toBe(true)
    })
})

describe('T-A6f: the real row hands focus over and refocuses after a delete', () => {
    test('a stepped row\'s successor at the same position takes the focus and the follower keeps following', async () => {
        buildTranscript()
        focusRowAsShell(2)
        expect(follower.isFollowing()).toBe(true)
        stepSibling.mockImplementation(() => {
            const olderRow = rowElement(1)
            void unmount(rowApps.get(2)!)
            flushSync()
            expect(document.activeElement).toBe(document.body)
            mountRow(2, 'a2b', olderRow)
        })
        rowElement(2).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }))
        expect(stepSibling).toHaveBeenCalledTimes(1)
        await vi.waitFor(() => expect(rowElement(2)?.getAttribute('data-chat-id')).toBe('a2b'), { timeout: 5000 })
        await vi.waitFor(() => expect(document.activeElement).toBe(rowElement(2)), { timeout: 3000 })
        expect(follower.isFollowing()).toBe(true)
    })
    test('after a delete the neighbour takes the focus and the follower keeps following', async () => {
        buildTranscript()
        focusRowAsShell(2)
        messageActions.requestRemove.mockImplementation(async () => {
            void unmount(rowApps.get(2)!)
            rowApps.delete(2)
            flushSync()
        })
        rowElement(2).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Delete' }))
        await vi.waitFor(() => expect(messageActions.requestRemove).toHaveBeenCalledTimes(1), { timeout: 5000 })
        await vi.waitFor(() => expect(document.activeElement).toBe(rowElement(3)), { timeout: 5000 })
        expect(follower.isFollowing()).toBe(true)
    })
})

describe('the list releases the follower when the surface returns away from the bottom', () => {
    const character = $state({ chaId: 'c', type: 'character', name: 'Ari', image: '', chatPage: 0,
        chats: [{ id: 'room', message: Array.from({ length: 6 }, (_, i) => ({ chatId: `m${i}`, role: i % 2 ? 'char' : 'user', data: String(i) }) as Message) }] }) as Character
    let fire: () => void = () => {}
    let top = 0
    let height = 0
    const writes: number[] = []
    let listApp: ReturnType<typeof ShellMessageList> | undefined
    let listTarget: HTMLElement

    beforeEach(() => {
        rowMode.stubRows = true
        vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { fire = callback } observe(): void {} disconnect(): void {} })
        writes.length = 0
        height = 1000
        surface.hidden = false
        surface.rebuildEpoch = 0
    })
    afterEach(async () => {
        if (listApp) await unmount(listApp)
        listApp = undefined
        listTarget?.remove()
    })

    async function showList(startTop: number): Promise<void> {
        top = startTop
        listTarget = document.createElement('div')
        const listHost = document.createElement('main')
        Object.defineProperty(listHost, 'scrollHeight', { get: () => height, configurable: true })
        Object.defineProperty(listHost, 'clientHeight', { value: HOST_CLIENT, configurable: true })
        Object.defineProperty(listHost, 'scrollTop', { get: () => top, set: (value: number) => { writes.push(value); top = value }, configurable: true })
        listTarget.appendChild(listHost)
        document.body.appendChild(listTarget)
        listApp = mount(ShellMessageList, { target: listHost, props: { character, host: listHost } })
        flushSync()
        await tick()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        await tick()
    }
    async function hideAndReturn(): Promise<void> {
        surfaceHooks.hiding()
        surface.hidden = true
        flushSync()
        surface.rebuildEpoch += 1
        surface.hidden = false
        flushSync()
        await tick()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }

    test('a reader restored away from the bottom is not pulled back by later growth', async () => {
        await showList(900)
        top = 400
        await hideAndReturn()
        expect(top).toBe(400)
        writes.length = 0
        height = 1200
        fire()
        expect(writes).toEqual([])
    })
    test('a reader restored at the bottom keeps following later growth', async () => {
        await showList(900)
        await hideAndReturn()
        writes.length = 0
        height = 1200
        fire()
        expect(writes).toEqual([1100])
    })
})
