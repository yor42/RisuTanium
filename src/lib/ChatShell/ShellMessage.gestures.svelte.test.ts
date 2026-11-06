// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
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

let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let sheetApp: ReturnType<typeof ActionSheet> | undefined
let hostedRequest: ActionRequest | null = $state.raw(null)
let hostedOpen = $state(false)
let body: HTMLElement
// The shell hosts one sheet outside the rows; the test hosts the real sheet next to the mounted row the same way.
function show() {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message: db.message[0], getTreeView: () => ({ at: () => ({ index: 2, count: 2 }), continuation: 0 }), onOpenActions: (request: ActionRequest) => { hostedRequest = request; hostedOpen = true } } })
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
    Object.defineProperty(body, 'clientWidth', { value: 300 })
}
function pointer(kind: string, x: number, time: number) {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
    body.dispatchEvent(event)
    flushSync()
}
afterEach(async () => { if (sheetApp) await unmount(sheetApp); sheetApp = undefined; hostedOpen = false; hostedRequest = null; if (app) await unmount(app); app = undefined; target?.remove(); stepSibling.mockClear(); regenerateNewest.mockClear(); tickHaptic.mockClear(); for (const fn of Object.values(messageActions)) fn.mockClear() })

function openSheet(): HTMLElement {
    target.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click()
    flushSync()
    return target
}

describe('message action wiring', () => {
    test('the sheet routes bookmark, hide and delete to the extracted functions with the live index', async () => {
        show()
        openSheet().querySelector<HTMLButtonElement>('[data-action="bookmark"]')!.click()
        flushSync()
        expect(messageActions.toggleBookmark).toHaveBeenCalledWith(0, 'Ari')
        openSheet().querySelector<HTMLButtonElement>('[data-action="hideAI"]')!.click()
        flushSync()
        const getter = messageActions.toggleMessageDisabled.mock.calls[0][0] as () => number
        expect(getter()).toBe(0)
        expect(messageActions.toggleMessageDisabled.mock.calls[0][1]).toBe('one')
        const sheet = openSheet()
        const remove = sheet.querySelector<HTMLButtonElement>('[role="menuitem"][data-action="delete"]')!
        expect(remove.closest('[data-destructive-group]')).not.toBeNull()
        remove.click()
        flushSync()
        expect(messageActions.requestRemove).toHaveBeenCalledTimes(1)
        expect(messageActions.requestRemove.mock.calls[0][2]).toMatchObject({ chatId: 'm' })
    })
    test('the sheet browse entries never generate and the new reply entry generates once', async () => {
        show()
        openSheet().querySelector<HTMLButtonElement>('[data-action="stepNext"]')!.click()
        flushSync()
        await vi.waitFor(() => expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'forward', { generate: false }), { timeout: 5000 })
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('keyboard Ctrl+Alt+R requests one new reply', () => {
        show()
        const article = target.querySelector('article')!
        article.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'r', ctrlKey: true, altKey: true }))
        article.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'r', ctrlKey: true, altKey: true }))
        flushSync()
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
    })
})

describe('message gesture wiring', () => {
    test('horizontal commit browses and ticks once', () => {
        show()
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 220, 100)
        pointer('pointerup', 220, 200)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
        expect(tickHaptic).toHaveBeenCalledWith('commit', 'touch', true)
    })
    test('edge start, cancel and wheel cannot generate', () => {
        show()
        pointer('pointerdown', 1, 0)
        pointer('pointermove', 220, 100)
        pointer('pointerup', 220, 200)
        pointer('pointerdown', 300, 300)
        pointer('pointermove', 100, 310)
        pointer('pointercancel', 100, 320)
        body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: -50, deltaY: 0 }))
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('an armed pull ticks and generates once; a fling does not arm', () => {
        show()
        pointer('pointerdown', 300, 0)
        pointer('pointermove', 100, 10)
        pointer('pointerup', 100, 20)
        expect(regenerateNewest).not.toHaveBeenCalled()
        expect(tickHaptic).not.toHaveBeenCalledWith('arm', 'touch', true)
        pointer('pointerdown', 300, 1000)
        pointer('pointermove', 120, 1100)
        pointer('pointermove', 110, 1200)
        pointer('pointermove', 110, 1510)
        pointer('pointerup', 110, 1600)
        expect(tickHaptic).toHaveBeenCalledWith('arm', 'touch', true)
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
    })
})
