// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const tickHaptic = vi.hoisted(() => vi.fn())
const alertSelect = vi.hoisted(() => vi.fn())
const actions = vi.hoisted(() => ({ requestRemove: vi.fn(), deleteNow: vi.fn() }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: [] as Message[] }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic, readHaptics: () => true }))
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
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn(), alertConfirm: vi.fn(), alertNormal: vi.fn(), alertSelect: alertSelect }))
vi.mock('../../ts/process/messageActions.svelte', () => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: actions.requestRemove, deleteNow: actions.deleteNow, copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
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
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark',
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    cancel: 'Cancel', chatShellDeleteRangeButton: (count: number) => `Delete ${count}`, chatShellDeleteRangeConfirm: (count: number, excerpt: string) => `Delete ${count} from ${excerpt}`, chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

let list: HTMLElement
let apps: ReturnType<typeof ShellMessage>[] = []
let wrappers: HTMLElement[] = []

// The list is rendered newest first like ShellMessageList, so the first article is the newest message.
function showList(count: number): HTMLElement[] {
    const messages: Message[] = Array.from({ length: count }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `c${i}` }) as Message)
    DBState.db.characters[0].chats[0].message = messages
    list = document.createElement('div')
    list.setAttribute('data-part', 'chat-message-list')
    document.body.appendChild(list)
    for (let i = count - 1; i >= 0; i--) {
        const wrapper = document.createElement('div')
        list.appendChild(wrapper)
        wrappers.push(wrapper)
        apps.push(mount(ShellMessage, { target: wrapper, props: { idx: i, chatId: `c${i}`, name: 'Ari', message: DBState.db.characters[0].chats[0].message[i], getTreeView: () => ({ at: () => ({ index: 2, count: 2 }), continuation: 0 }) } }))
    }
    flushSync()
    return [...list.querySelectorAll<HTMLElement>('article[data-part="chat-message"]')]
}
function key(node: Element, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    node.dispatchEvent(event)
    flushSync()
    return event
}
afterEach(async () => {
    for (const app of apps) await unmount(app)
    apps = []
    wrappers = []
    list?.remove()
    stepSibling.mockClear(); regenerateNewest.mockClear(); actions.requestRemove.mockReset(); actions.deleteNow.mockReset(); alertSelect.mockReset()
})

describe('C7 keyboard reach and navigation', () => {
    test('every message article is a tab stop', () => {
        const rows = showList(3)
        expect(rows.map((row) => row.getAttribute('tabindex'))).toEqual(['0', '0', '0'])
    })
    test('arrow keys move focus between messages by what is on screen, Home and End jump to the ends', () => {
        const rows = showList(4)
        const [newest, second, third, oldest] = rows
        newest.focus()
        key(newest, { key: 'ArrowUp' })
        expect(document.activeElement).toBe(second)
        key(second, { key: 'ArrowUp' })
        expect(document.activeElement).toBe(third)
        key(third, { key: 'ArrowDown' })
        expect(document.activeElement).toBe(second)
        key(second, { key: 'Home' })
        expect(document.activeElement).toBe(oldest)
        key(oldest, { key: 'End' })
        expect(document.activeElement).toBe(newest)
        key(newest, { key: 'ArrowDown' })
        expect(document.activeElement).toBe(newest)
    })
    test('Delete on a focused article removes it and the focus lands on the message that followed it', async () => {
        const rows = showList(3)
        const [newest, middle] = rows
        actions.requestRemove.mockImplementation(async () => { wrappers[1].remove() })
        middle.focus()
        key(middle, { key: 'Delete' })
        await vi.waitFor(() => expect(document.activeElement).toBe(newest))
        expect(actions.requestRemove).toHaveBeenCalledTimes(1)
    })
    test('after deleting the newest message the focus lands on the one before it', async () => {
        const rows = showList(3)
        const [newest, middle] = rows
        actions.requestRemove.mockImplementation(async () => { wrappers[0].remove() })
        newest.focus()
        key(newest, { key: 'Delete' })
        await vi.waitFor(() => expect(document.activeElement).toBe(middle))
    })
    test('the focus is not taken when it was somewhere else when the message was deleted', async () => {
        const rows = showList(3)
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        actions.requestRemove.mockImplementation(async () => { wrappers[1].remove(); outside.focus() })
        rows[1].focus()
        key(rows[1], { key: 'Delete' })
        await vi.waitFor(() => expect(actions.requestRemove).toHaveBeenCalled())
        await Promise.resolve()
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })
})

describe('C7 Shift click on the pinned Delete', () => {
    test('a plain click removes one message and a Shift click goes the Shift+Delete way, through the range confirm', async () => {
        const rows = showList(2)
        const remove = rows[0].querySelector<HTMLButtonElement>('[data-action="delete"]')!
        alertSelect.mockResolvedValue('1')
        remove.click()
        await vi.waitFor(() => expect(actions.requestRemove).toHaveBeenCalledTimes(1))
        expect(alertSelect).not.toHaveBeenCalled()
        remove.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
        await vi.waitFor(() => expect(actions.deleteNow).toHaveBeenCalledTimes(1))
        expect(actions.deleteNow.mock.calls[0][3]).toBe('from')
        expect(actions.requestRemove).toHaveBeenCalledTimes(1)
    })
    test('Shift+Delete on the key takes the same route as Shift click', async () => {
        const rows = showList(2)
        alertSelect.mockResolvedValue('1')
        rows[0].focus()
        key(rows[0], { key: 'Delete', shiftKey: true })
        await vi.waitFor(() => expect(actions.deleteNow).toHaveBeenCalledTimes(1))
        expect(actions.deleteNow.mock.calls[0][3]).toBe('from')
    })
})

describe('C6 the newest reply owns Ctrl+Alt+R', () => {
    test('a handled press on the newest article does not reach the document, where the global hotkey listens', () => {
        const rows = showList(2)
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        const event = key(rows[0], { key: 'r', ctrlKey: true, altKey: true })
        document.removeEventListener('keydown', seen)
        expect(seen).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(true)
    })
    test('a repeated press is still contained and does not act twice', () => {
        const rows = showList(2)
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        key(rows[0], { key: 'r', ctrlKey: true, altKey: true })
        key(rows[0], { key: 'r', ctrlKey: true, altKey: true, repeat: true })
        document.removeEventListener('keydown', seen)
        expect(seen).not.toHaveBeenCalled()
        expect(regenerateNewest.mock.calls.length + stepSibling.mock.calls.length).toBeLessThanOrEqual(1)
    })
    test('an older article lets the press through so the hotkey reaches the newest reply', () => {
        const rows = showList(3)
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        key(rows[2], { key: 'r', ctrlKey: true, altKey: true })
        document.removeEventListener('keydown', seen)
        expect(seen).toHaveBeenCalledTimes(1)
        expect(regenerateNewest).not.toHaveBeenCalled()
        expect(stepSibling).not.toHaveBeenCalled()
    })
})