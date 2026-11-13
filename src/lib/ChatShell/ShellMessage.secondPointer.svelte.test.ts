// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const tickHaptic = vi.hoisted(() => vi.fn())
const hostInset = vi.hoisted(() => ({ value: 0 as unknown }))
const editorFlags = vi.hoisted(() => ({ editMode: false, editTranslationMode: false }))
const createSwipeGesture = vi.hoisted(() => vi.fn())
vi.mock('../../ts/chatShell/swipeGesture', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/chatShell/swipeGesture')>()
    createSwipeGesture.mockImplementation(actual.createSwipeGesture)
    return { ...actual, createSwipeGesture }
})
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [{ chaId: 'c', chatPage: 0, chats: [{ id: 'room', message: [] as Message[] }] }], translator: '', swipe: true } })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../ts/chatShell/haptics', () => ({ tickHaptic, readHaptics: () => true }))
vi.mock('../../ts/android/hostBridge', () => ({ gestureInsetLeft: () => hostInset.value }))
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
    get editMode() { return editorFlags.editMode }, get editTranslationMode() { return editorFlags.editTranslationMode }, discardConfirmOpen: false, translationViewControlsDisabled: false,
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
    chatShellMoreActions: 'More actions', chatShellNewReply: 'New reply', bookmark: 'Bookmark', chatShellFirstReply: 'First reply', chatShellEndControl: (count: number) => `Bring back ${count}`,
    chatShellStillWriting: 'Still writing the reply', chatShellNoSavedReplies: 'No more saved replies',
    chatShellReleaseNewReply: 'Let go to generate a new reply', chatShellGenerateReply: 'Generate a reply',
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

const WIDTH = 1024
let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let body: HTMLElement

type OpenRequest = { opener: HTMLElement | null }
function show(options: { index?: number, count?: number, onOpenActions?: (request: OpenRequest) => void } = {}) {
    const message: Message = { role: 'char', data: 'Reply', chatId: 'm' }
    DBState.db.characters[0].chats[0].message = [message]
    target = document.createElement('div')
    document.body.appendChild(target)
    const index = options.index ?? 2
    const count = options.count ?? 2
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message: DBState.db.characters[0].chats[0].message[0], streaming: false, getBusy: () => false, onOpenActions: options.onOpenActions, getTreeView: () => ({ at: () => ({ index, count }), continuation: 0 }) } })
    flushSync()
    body = target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    Object.defineProperty(body, 'clientWidth', { value: 300 })
}
// One pointer event as the browser delivers it: the first touch of a type is primary, every touch that lands while another is down is not. A second finger's later events go to the element its down landed on.
function finger(kind: string, id: number, primary: boolean, x: number, time: number, on: Element = body, y = 100, pointerType = 'touch') {
    expect(on.isConnected).toBe(true)
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y })
    Object.defineProperties(event, { pointerType: { value: pointerType }, timeStamp: { value: time }, pointerId: { value: id }, isPrimary: { value: primary } })
    on.dispatchEvent(event)
    flushSync()
}
function moreButton(): HTMLElement {
    return target.querySelector<HTMLElement>('[data-part="chat-message-actions"] button[aria-label="More actions"]')!
}
function ring(): Element | null { return target.querySelector('[data-part="chat-long-press-ring"]') }
function dragged(): number {
    const match = /translateX\((-?[\d.]+)px\)/.exec(body.style.transform)
    return match ? Number(match[1]) : 0
}
beforeEach(() => {
    hostInset.value = 0
    editorFlags.editMode = false; editorFlags.editTranslationMode = false
    Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true })
})
afterEach(async () => {
    vi.useRealTimers()
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockClear(); regenerateNewest.mockClear(); tickHaptic.mockClear(); createSwipeGesture.mockClear()
})

describe('CHORE-741 a reply swipe follows only the pointer that started it', () => {
    test('the More button is a real, connected control outside every swipe start part', () => {
        show()
        expect(moreButton()).not.toBeNull()
        expect(moreButton().isConnected).toBe(true)
    })

    // REPRO (S1)
    test('a second finger moving on a control does not move the body', () => {
        show()
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 440, 50)
        finger('pointermove', 1, true, 470, 100)
        expect(dragged()).toBe(70)
        finger('pointerdown', 2, false, 900, 150, moreButton())
        finger('pointermove', 2, false, 1000, 200, moreButton())
        expect(dragged()).toBe(70)
    })
    // REPRO (S1, text)
    test('a second finger moving on the text does not move the body', () => {
        show()
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 470, 100)
        finger('pointerdown', 2, false, 900, 150)
        finger('pointermove', 2, false, 1000, 200)
        expect(dragged()).toBe(70)
    })
    // REPRO (S2)
    test('a second finger lifting does not end or commit the swipe, and the first finger lifting commits once', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 600, 100)
        finger('pointerdown', 2, false, 600, 150, moreButton())
        finger('pointerup', 2, false, 600, 200, moreButton())
        vi.advanceTimersByTime(1000)
        expect(stepSibling).not.toHaveBeenCalled()
        expect(body.hasAttribute('data-settle')).toBe(false)
        finger('pointerup', 1, true, 600, 1300)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
    })
    // REPRO (S3)
    test('a second finger cancelled does not end or spring the swipe', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 440, 100)
        finger('pointerdown', 2, false, 700, 150, moreButton())
        finger('pointercancel', 2, false, 700, 200, moreButton())
        expect(dragged()).toBe(40)
        expect(body.hasAttribute('data-spring')).toBe(false)
        finger('pointermove', 1, true, 520, 300)
        finger('pointerup', 1, true, 520, 400)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
    // COMPATIBILITY GUARD (S4): passes before and after.
    test('the first finger commits on its own lift and springs back on its own cancel, with any pointer id', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 7, true, 400, 0)
        finger('pointermove', 7, true, 520, 100)
        finger('pointerup', 7, true, 520, 200)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
    })
    test('a cancel of the first finger springs the body back, with any pointer id', () => {
        show({ index: 2, count: 3 })
        finger('pointerdown', 7, true, 400, 0)
        finger('pointermove', 7, true, 440, 100)
        expect(dragged()).toBe(40)
        finger('pointercancel', 7, true, 440, 150)
        expect(dragged()).toBe(0)
        expect(body.hasAttribute('data-spring')).toBe(true)
    })
    // REPRO (S5)
    test('a second finger landing on a row with no live swipe starts nothing', () => {
        vi.useFakeTimers()
        const onOpenActions = vi.fn<(request: OpenRequest) => void>()
        show({ index: 2, count: 3, onOpenActions })
        finger('pointerdown', 2, false, 400, 0)
        expect(createSwipeGesture).not.toHaveBeenCalled()
        vi.advanceTimersByTime(250)
        flushSync()
        expect(ring()).toBeNull()
        finger('pointermove', 2, false, 520, 300)
        expect(dragged()).toBe(0)
        vi.advanceTimersByTime(1000)
        expect(onOpenActions).not.toHaveBeenCalled()
        finger('pointerup', 2, false, 520, 1400)
        vi.advanceTimersByTime(260)
        expect(stepSibling).not.toHaveBeenCalled()
    })
    // REPRO (S6)
    test('a second finger landing on the text does not restart the gesture or move its origin', () => {
        show()
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 470, 100)
        finger('pointerdown', 2, false, 900, 150)
        expect(createSwipeGesture).toHaveBeenCalledTimes(1)
        finger('pointermove', 1, true, 520, 200)
        expect(dragged()).toBe(120)
    })
    // COMPATIBILITY GUARD (S7): passes before and after; a primary down replaces a swipe whose lift was lost.
    test('a new primary touch replaces a swipe whose lift was lost', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 470, 100)
        finger('pointerdown', 3, true, 400, 1000)
        finger('pointermove', 3, true, 520, 1100)
        expect(dragged()).toBe(120)
        finger('pointerup', 3, true, 520, 1200)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
    // REPRO (S7)
    test('after a primary touch replaced a swipe whose lift was lost, the stale pointer is ignored', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 470, 100)
        finger('pointerdown', 3, true, 400, 1000)
        finger('pointermove', 3, true, 520, 1100)
        expect(dragged()).toBe(120)
        finger('pointermove', 1, true, 900, 1150)
        expect(dragged()).toBe(120)
        finger('pointerup', 1, true, 900, 1200)
        vi.advanceTimersByTime(1000)
        expect(stepSibling).not.toHaveBeenCalled()
        finger('pointerup', 3, true, 520, 2300)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
    // REPRO (S8)
    test.each([['control'], ['text']])('a second finger on the %s changes nothing about the first finger\'s long press', (where) => {
        vi.useFakeTimers()
        const onOpenActions = vi.fn<(request: OpenRequest) => void>()
        show({ index: 2, count: 3, onOpenActions })
        finger('pointerdown', 1, true, 400, 0)
        vi.advanceTimersByTime(100)
        if (where === 'control') {
            finger('pointerdown', 2, false, 900, 100, moreButton())
            finger('pointermove', 2, false, 1000, 100, moreButton())
        } else {
            finger('pointerdown', 2, false, 900, 100)
        }
        vi.advanceTimersByTime(100)
        flushSync()
        expect(ring()).not.toBeNull()
        vi.advanceTimersByTime(300)
        expect(onOpenActions).toHaveBeenCalledTimes(1)
        expect(onOpenActions.mock.calls[0][0].opener).toBe(body)
        finger('pointerdown', 2, false, 900, 500)
        vi.advanceTimersByTime(2000)
        expect(onOpenActions).toHaveBeenCalledTimes(1)
        finger('pointerup', 1, true, 400, 2600)
        finger('pointerdown', 4, true, 400, 3000)
        finger('pointermove', 4, true, 520, 3100)
        finger('pointerup', 4, true, 520, 3200)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
    // REPRO (S9)
    test.each([['pointermove'], ['pointerup'], ['pointercancel']])('with the editor open a second finger\'s %s does nothing, and the first finger\'s next move cancels without a step', (kind) => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 440, 100)
        expect(dragged()).toBe(40)
        finger('pointerdown', 2, false, 900, 150, moreButton())
        editorFlags.editMode = true
        finger(kind, 2, false, 900, 200, moreButton())
        expect(dragged()).toBe(40)
        finger('pointermove', 1, true, 450, 300)
        expect(dragged()).toBe(0)
        finger('pointerup', 1, true, 450, 400)
        vi.advanceTimersByTime(1000)
        expect(stepSibling).not.toHaveBeenCalled()
    })
    // COMPATIBILITY GUARD (S10): passes before and after.
    test('a lone tap on the More button starts no gesture and opens the actions', () => {
        vi.useFakeTimers()
        const onOpenActions = vi.fn<(request: OpenRequest) => void>()
        show({ index: 2, count: 3, onOpenActions })
        finger('pointerdown', 1, true, 400, 0, moreButton())
        finger('pointerup', 1, true, 400, 50, moreButton())
        moreButton().click()
        flushSync()
        expect(createSwipeGesture).not.toHaveBeenCalled()
        expect(onOpenActions).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(250)
        flushSync()
        expect(ring()).toBeNull()
    })
    // REPRO (R6)
    test('a pen landing during a touch swipe neither replaces it nor drives it', () => {
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 470, 100)
        finger('pointerdown', 5, true, 900, 150, body, 100, 'pen')
        expect(createSwipeGesture).toHaveBeenCalledTimes(1)
        finger('pointermove', 5, true, 1000, 200, body, 100, 'pen')
        expect(dragged()).toBe(70)
    })
    // REPRO (Gate 1 finding 2): a primary down on a control while a stale swipe is live binds nothing.
    test('a primary touch landing on a control during a stale swipe leaves the swipe bound to its own pointer', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        finger('pointerdown', 1, true, 400, 0)
        finger('pointermove', 1, true, 520, 100)
        finger('pointerdown', 3, true, 520, 150, moreButton())
        finger('pointerup', 3, true, 520, 200, moreButton())
        vi.advanceTimersByTime(1000)
        expect(stepSibling).not.toHaveBeenCalled()
        expect(body.hasAttribute('data-settle')).toBe(false)
        finger('pointerup', 1, true, 520, 1300)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
})
