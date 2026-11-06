// @vitest-environment jsdom
// A step swaps the shown alternative and the list mounts a new row for it: the wheel gesture, its lock and the keyboard focus must survive that swap,
// and the alternatives row answers the wheel like the body.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'
import type { TreeView } from '../../ts/process/chatTreeView'

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
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark',
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    chatShellPreviousReply: 'Previous', chatShellNextReply: 'Next', chatShellFirstReply: 'First', chatShellLastReply: 'Last',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
    chatShellEndControl: (count: number) => `Bring back ${count}`,
} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

const IDX = 1
const COUNT = 5
let list: HTMLElement
let current: { app: ReturnType<typeof ShellMessage>; wrapper: HTMLElement } | undefined
let shown = 1

// The list keys its rows by chat id, so a step mounts the new alternative's row before the old one is removed.
function mountRow(): void {
    const messages: Message[] = [
        { role: 'user', data: 'u0', chatId: 'a0' }, { role: 'char', data: `c${shown}`, chatId: `alt${shown}` },
        { role: 'user', data: 'u2', chatId: 'a2' }, { role: 'char', data: 'c3', chatId: 'a3' }, { role: 'char', data: 'c4', chatId: 'a4' },
    ]
    DBState.db.characters[0].chats[0].message = messages
    const view: TreeView = { at: (i) => i === IDX ? { index: shown, count: COUNT } : { index: 1, count: 1 }, continuation: 0 }
    const wrapper = document.createElement('div')
    list.appendChild(wrapper)
    const app = mount(ShellMessage, { target: wrapper, props: {
        idx: IDX, chatId: `alt${shown}`, expectedId: `alt${shown}`, name: 'Ari', message: messages[IDX], getTreeView: () => view,
    } })
    flushSync()
    const previous = current
    current = { app, wrapper }
    if (previous) {
        void unmount(previous.app)
        previous.wrapper.remove()
    }
    flushSync()
}
function swapRow(direction: 'back' | 'forward'): void {
    shown += direction === 'forward' ? 1 : -1
    mountRow()
}
function article(): HTMLElement { return current!.wrapper.querySelector<HTMLElement>('article[data-part="chat-message"]')! }
function body(): HTMLElement { return current!.wrapper.querySelector<HTMLElement>('[data-part="chat-message-body"]')! }
function alts(): HTMLElement { return current!.wrapper.querySelector<HTMLElement>('[data-part="chat-message-alts"]')! }
function wheel(node: Element, deltaX: number, time: number, extra: WheelEventInit = {}): void {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY: 0, ...extra })
    Object.defineProperty(event, 'timeStamp', { value: time })
    node.dispatchEvent(event)
    flushSync()
}
function arrow(name: string): void {
    article().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name }))
    flushSync()
}
beforeEach(() => {
    shown = 1
    list = document.createElement('div')
    list.setAttribute('data-part', 'chat-message-list')
    document.body.appendChild(list)
    // A step is a swap of the shown alternative, as the real stepper does through the tree.
    stepSibling.mockImplementation(async (_source: unknown, _index: number, _id: string | undefined, direction: 'back' | 'forward') => { swapRow(direction) })
    mountRow()
})
afterEach(async () => {
    if (current) await unmount(current.app)
    current = undefined
    list.remove()
    stepSibling.mockReset(); regenerateNewest.mockClear()
})

describe('a step replaces the row', () => {
    test('one continuous wheel gesture crossing the swap steps once', () => {
        // Fifteen events 20 ms apart: the third reaches the distance and swaps the row, the rest belong to the same gesture.
        for (let i = 0; i < 15; i++) wheel(body(), -15, 1000 + i * 20)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(shown).toBe(2)
    })
    test('the 450 ms lock outlives the swap and the next gesture after it steps again', () => {
        for (let i = 0; i < 4; i++) wheel(body(), -30, 1000 + i * 20)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        wheel(body(), -60, 1300)
        wheel(body(), -60, 1460)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        wheel(body(), -60, 1900)
        expect(stepSibling).toHaveBeenCalledTimes(2)
        expect(shown).toBe(3)
    })
    test('a Shift+wheel gesture crossing the swap steps once as well', () => {
        for (let i = 0; i < 12; i++) {
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 0, deltaY: -15, shiftKey: true })
            Object.defineProperty(event, 'timeStamp', { value: 5000 + i * 20 })
            body().dispatchEvent(event)
            flushSync()
        }
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
    test('two ArrowRight presses step twice and the focus never falls back to the page', () => {
        article().focus()
        arrow('ArrowRight')
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(article())
        arrow('ArrowRight')
        expect(stepSibling).toHaveBeenCalledTimes(2)
        expect(document.activeElement).toBe(article())
        expect(document.activeElement).not.toBe(document.body)
        expect(shown).toBe(3)
    })
    test('a step by a row that did not hold the focus does not take it', () => {
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        outside.focus()
        wheel(body(), -80, 100)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(outside)
        outside.remove()
    })
})

describe('the alternatives row belongs to its message', () => {
    test('a qualifying wheel over the row steps once', () => {
        wheel(alts(), -80, 100)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenLastCalledWith(expect.anything(), IDX, 'alt1', 'forward', { generate: false })
    })
    test('a Shift+wheel over the row steps and a vertical wheel over it does not', () => {
        wheel(alts(), 0, 100, { deltaY: 80 })
        expect(stepSibling).not.toHaveBeenCalled()
        wheel(alts(), 0, 1000, { deltaY: -80, shiftKey: true })
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenLastCalledWith(expect.anything(), IDX, 'alt1', 'forward', { generate: false })
    })
    test('one gesture that moves between the body and the row steps once', () => {
        wheel(body(), -25, 1000)
        wheel(alts(), -25, 1020)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        wheel(body(), -25, 1040)
        wheel(alts(), -25, 1060)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
})
