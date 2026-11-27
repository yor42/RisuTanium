// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const tickHaptic = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({ message: [{ role: 'char', data: 'Reply', chatId: 'm' }] as Message[] }))
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: db.message }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic, readHaptics: () => true }))
vi.mock('../../ts/backHandlers', () => ({ registerBackHandler: () => () => {}, backCloseHandler: () => () => false }))
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false, globalFetch: vi.fn() }))
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
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
const messageActions = vi.hoisted(() => ({
    handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn(),
    requestRemove: vi.fn(), copyMessageText: vi.fn(), copyMessageAsCard: vi.fn(),
    branchMessage: vi.fn(), toggleMessageDisabled: vi.fn(), toggleBookmark: vi.fn(),
}))
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
vi.mock('../ChatScreens/chatSurface.svelte', () => ({ chatSurface: { rebuildEpoch: 0, closeEpoch: 0 }, isChatSurfaceInstalled: () => false }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: { chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark', chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}` } }))

import ShellMessage, { type ActionRequest } from './ShellMessage.svelte'
import ActionSheet from './ActionSheet.svelte'

import { startObserveDom } from '../../ts/observer.svelte'

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let sheetApp: ReturnType<typeof ActionSheet> | undefined
let stopObserver: (() => void) | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)
let opened = 0
let body: HTMLElement

function show() {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message: db.message[0], getTreeView: () => ({ at: () => ({ index: 2, count: 2 }), continuation: 0 }), onOpenActions: (request: ActionRequest) => { opened++; hostedRequest = request; hostedOpen = true } } })
    sheetApp = mount(ActionSheet, { target, props: {
        get open() { return hostedOpen },
        get opener() { return hostedRequest?.opener ?? null },
        get available() { return hostedOpen ? hostedRequest?.available() ?? [] : [] },
        get disabled() { return hostedOpen ? hostedRequest?.disabled() ?? [] : [] },
        get generating() { return hostedOpen && hostedRequest?.generating() === true },
        onaction: (id) => hostedRequest?.run(id),
        onclose: () => { hostedOpen = false },
    } })
    flushSync()
    body = target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    body.innerHTML = '<p id="prose">Some prose</p><pre id="fenced" x-hl-lang="js"><code id="fenced-text">let a = 1</code></pre><pre id="bare"><code id="bare-text">no language</code></pre>'
}
beforeEach(() => { vi.useFakeTimers(); stopObserver = startObserveDom() })
afterEach(async () => {
    stopObserver?.(); stopObserver = undefined
    document.getElementById('code-contextmenu')?.remove()
    if (sheetApp) await unmount(sheetApp); sheetApp = undefined; hostedOpen = false; hostedRequest = null; opened = 0
    if (app) await unmount(app); app = undefined; target?.remove(); vi.useRealTimers()
})
const at = (id: string) => target.querySelector<HTMLElement>(`#${id}`)!
const sheetShown = () => target.querySelector('[data-part="chat-sheet"]') !== null
const codeMenuShown = () => document.querySelector('[data-part="chat-code-menu"]') !== null
function rightClick(el: Element) { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 })); flushSync() }
function touchHold(el: Element) {
    const down = new MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 100 })
    Object.defineProperties(down, { pointerType: { value: 'touch' }, pointerId: { value: 1 }, timeStamp: { value: 0 } })
    el.dispatchEvent(down)
    vi.advanceTimersByTime(600)
    flushSync()
}

describe('a gesture on a fenced code block with a language belongs to the code-block menu', () => {
    test('a right-click opens only the code menu, not the message sheet', () => {
        show()
        rightClick(at('fenced-text'))
        expect(codeMenuShown()).toBe(true)
        expect(opened).toBe(0)
        expect(sheetShown()).toBe(false)
    })
    test('a touch long press opens no sheet from the row either', () => {
        show()
        touchHold(at('fenced-text'))
        expect(opened).toBe(0)
        expect(sheetShown()).toBe(false)
    })
    test('the sheet stays reachable from the message\'s More actions button while the code menu is open', () => {
        show()
        rightClick(at('fenced'))
        target.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click()
        flushSync()
        expect(sheetShown()).toBe(true)
    })
})

describe('a gesture outside a code block still opens the message sheet', () => {
    test('a right-click on prose opens the sheet and no code menu', () => {
        show()
        rightClick(at('prose'))
        expect(opened).toBe(1)
        expect(sheetShown()).toBe(true)
        expect(codeMenuShown()).toBe(false)
    })
    test('a touch long press on prose opens the sheet', () => {
        show()
        touchHold(at('prose'))
        expect(opened).toBe(1)
        expect(sheetShown()).toBe(true)
    })
    test('a fence without a language has no code menu, so its right-click and long press open the sheet', () => {
        show()
        rightClick(at('bare-text'))
        expect(opened).toBe(1)
        expect(codeMenuShown()).toBe(false)
        hostedOpen = false; flushSync()
        touchHold(at('bare-text'))
        expect(opened).toBe(2)
    })
})
