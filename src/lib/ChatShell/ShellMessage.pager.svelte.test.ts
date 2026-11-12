// @vitest-environment jsdom
// Every row with more than one alternative shows a browse-only pager (older rows never generate); the last row also shows the end control
// when a continuation was set aside. Swipe, wheel and the arrow keys act only on rows that show a pager.
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

import ShellMessage, { type ActionRequest } from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'
import type { StepRowRunner } from '../../ts/chatShell/stepHold'

const WIDTH = 1024
let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let request: ActionRequest | null = null

interface Options { idx?: number; index?: number; count?: number; continuation?: number; role?: Message['role']; stepRow?: StepRowRunner }
// Five messages: rows 0..3 are older, row 4 is the newest reply.
function show(options: Options = {}) {
    const list: Message[] = [
        { role: 'user', data: 'u0', chatId: 'a0' }, { role: 'char', data: 'c1', chatId: 'a1' },
        { role: 'user', data: 'u2', chatId: 'a2' }, { role: 'char', data: 'c3', chatId: 'a3' },
        { role: options.role ?? 'char', data: 'c4', chatId: 'a4' },
    ]
    DBState.db.characters[0].chats[0].message = list
    const idx = options.idx ?? 1
    const view: TreeView = { at: (i) => i === idx ? { index: options.index ?? 2, count: options.count ?? 3 } : { index: 1, count: 1 }, continuation: options.continuation ?? 0 }
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ShellMessage, { target, props: {
        idx, chatId: `a${idx}`, expectedId: `a${idx}`, name: 'Ari', message: DBState.db.characters[0].chats[0].message[idx],
        getTreeView: () => view, onOpenActions: (opened: ActionRequest) => { request = opened }, stepRow: options.stepRow,
    } })
    flushSync()
    return target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
}
function pointer(body: Element, kind: string, x: number, time: number) {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: 100 })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
    body.dispatchEvent(event)
    flushSync()
}
function key(name: string) {
    target.querySelector('article')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name }))
    flushSync()
}
function wheel(body: Element, deltaX: number) {
    body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY: 0 }))
    flushSync()
}
beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true })
    request = null
})
afterEach(async () => {
    vi.useRealTimers()
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockClear(); regenerateNewest.mockClear()
})

describe('an older row with three alternatives', () => {
    test('shows the counter and both arrows, but no New reply button and none of the hotkey classes', () => {
        show()
        const alts = target.querySelector('[data-part="chat-message-alts"]')!
        expect(alts.querySelector('span[aria-live]')?.textContent).toBe('2 / 3')
        expect(alts.getAttribute('aria-label')).toBe('Reply 2 of 3')
        expect(alts.querySelector('[data-action="newReply"]')).toBeNull()
        expect(target.querySelector('.button-icon-reroll, .button-icon-unreroll')).toBeNull()
    })
    test('the arrows browse the saved alternatives of that position and never generate', () => {
        show()
        target.querySelector<HTMLButtonElement>('[data-step="prev"]')!.click()
        expect(stepSibling).toHaveBeenLastCalledWith(expect.anything(), 1, 'a1', 'back', { generate: false })
        target.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        expect(stepSibling).toHaveBeenLastCalledWith(expect.anything(), 1, 'a1', 'forward', { generate: false })
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('at the last alternative the next arrow is disabled and nothing in the row can generate', () => {
        const body = show({ index: 3, count: 3 })
        expect(target.querySelector<HTMLButtonElement>('[data-step="next"]')!.disabled).toBe(true)
        vi.useFakeTimers()
        pointer(body, 'pointerdown', 400, 0)
        pointer(body, 'pointermove', 200, 100)
        vi.advanceTimersByTime(600)
        flushSync()
        pointer(body, 'pointerup', 200, 900)
        key('ArrowRight')
        wheel(body, -80)
        expect(regenerateNewest).not.toHaveBeenCalled()
        expect(stepSibling).not.toHaveBeenCalled()
    })
    test('a right swipe, the wheel and the arrow key step back through the alternatives', async () => {
        vi.useFakeTimers()
        const body = show()
        pointer(body, 'pointerdown', 100, 0)
        pointer(body, 'pointermove', 260, 100)
        pointer(body, 'pointerup', 260, 200)
        // The swipe's step lands once the body has slid out (CHORE-727), and the row takes other steps once it has.
        await vi.advanceTimersByTimeAsync(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenLastCalledWith(expect.anything(), 1, 'a1', 'back', { generate: false })
        key('ArrowLeft')
        expect(stepSibling).toHaveBeenCalledTimes(2)
        wheel(body, 80)
        expect(stepSibling).toHaveBeenCalledTimes(3)
    })
    test('the action sheet offers the previous and next entries', () => {
        show()
        target.querySelector('article')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        flushSync()
        expect(request!.available()).toEqual(expect.arrayContaining(['stepPrev', 'stepNext']))
        expect(request!.available()).not.toContain('newReply')
    })
})

describe('an older row with one alternative has no pager and nothing acts on it', () => {
    test('no pager, no step by swipe, wheel or arrow key, and no sheet entries for them', () => {
        const body = show({ index: 1, count: 1 })
        expect(target.querySelector('[data-part="chat-message-alts"]')).toBeNull()
        pointer(body, 'pointerdown', 100, 0)
        pointer(body, 'pointermove', 260, 100)
        pointer(body, 'pointerup', 260, 200)
        key('ArrowLeft')
        key('ArrowRight')
        wheel(body, 80)
        wheel(body, -80)
        expect(stepSibling).not.toHaveBeenCalled()
        expect(regenerateNewest).not.toHaveBeenCalled()
        target.querySelector('article')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
        flushSync()
        expect(request!.available()).not.toContain('stepPrev')
        expect(request!.available()).not.toContain('stepNext')
    })
})

describe('the end control of the last row', () => {
    test('appears with the count when a continuation was set aside and brings back the most recent one without generating', () => {
        show({ idx: 4, index: 1, count: 1, continuation: 2 })
        const end = target.querySelector<HTMLButtonElement>('[data-action="endControl"]')!
        expect(end.getAttribute('aria-label')).toBe('Bring back 2')
        expect(end.textContent).toContain('2')
        end.click()
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 5, 'a4', 'back', { generate: false })
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('is absent without a continuation and on every row but the last', () => {
        show({ idx: 4, continuation: 0 })
        expect(target.querySelector('[data-action="endControl"]')).toBeNull()
        unmount(app!); target.remove()
        show({ idx: 1, index: 2, count: 3, continuation: 2 })
        expect(target.querySelector('[data-action="endControl"]')).toBeNull()
    })
    test('stands alone under a last user message with a single alternative', () => {
        show({ idx: 4, role: 'user', index: 1, count: 1, continuation: 1 })
        expect(target.querySelector('[data-action="endControl"]')).not.toBeNull()
        expect(target.querySelector('[data-part="chat-message-alts"]')).toBeNull()
    })
    test('the newest reply keeps its pager with the New reply button next to the end control', () => {
        show({ idx: 4, index: 1, count: 2, continuation: 1 })
        expect(target.querySelector('[data-part="chat-message-alts"] span[aria-live]')?.textContent).toBe('1 / 2')
        expect(target.querySelector('[data-action="newReply"]')).not.toBeNull()
        expect(target.querySelector('[data-action="endControl"]')).not.toBeNull()
    })
})

// The list's hold wraps every step of a row. The runner here records the step without running it, so the tests show that nothing
// reaches the reply tree except through the runner.
describe('every step of a row runs inside the list hold when the row is given one', () => {
    function pendingRunner() {
        const steps: { idx: number; step: () => Promise<void> | void }[] = []
        const stepRow: StepRowRunner = (idx, step) => { steps.push({ idx, step }); return Promise.resolve() }
        return { steps, stepRow }
    }
    test('a pager tap on an older row goes through the runner with the row index and steps the tree only when the runner runs it', async () => {
        const { steps, stepRow } = pendingRunner()
        show({ stepRow })
        target.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        expect(steps.map((entry) => entry.idx)).toEqual([1])
        expect(stepSibling).not.toHaveBeenCalled()
        await steps[0].step()
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 1, 'a1', 'forward', { generate: false })
    })
    test('the arrow key, the wheel and the swipe go through the runner as well', () => {
        vi.useFakeTimers()
        const { steps, stepRow } = pendingRunner()
        const body = show({ stepRow })
        key('ArrowLeft')
        wheel(body, 80)
        pointer(body, 'pointerdown', 100, 0)
        pointer(body, 'pointermove', 260, 100)
        pointer(body, 'pointerup', 260, 200)
        vi.advanceTimersByTime(260)
        expect(steps.map((entry) => entry.idx)).toEqual([1, 1, 1])
        expect(stepSibling).not.toHaveBeenCalled()
    })
    test('the click of the global reroll hotkey target on the newest reply goes through the runner', () => {
        const { steps, stepRow } = pendingRunner()
        show({ idx: 4, index: 1, count: 2, stepRow })
        target.querySelector<HTMLElement>('.button-icon-reroll')!.click()
        expect(steps.map((entry) => entry.idx)).toEqual([4])
        expect(stepSibling).not.toHaveBeenCalled()
    })
    test('the end control goes through the runner for its own row and brings back the continuation only when the runner runs it', async () => {
        const { steps, stepRow } = pendingRunner()
        show({ idx: 4, index: 1, count: 1, continuation: 2, stepRow })
        target.querySelector<HTMLButtonElement>('[data-action="endControl"]')!.click()
        expect(steps.map((entry) => entry.idx)).toEqual([4])
        expect(stepSibling).not.toHaveBeenCalled()
        await steps[0].step()
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 5, 'a4', 'back', { generate: false })
    })
    test('the first message steps its greetings through the runner with index -1', async () => {
        const { steps, stepRow } = pendingRunner()
        const onReroll = vi.fn()
        const unReroll = vi.fn()
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ShellMessage, { target, props: {
            idx: -1, name: 'Ari', message: { role: 'char', data: 'Greeting' }, firstMessage: true, stepRow, onReroll, unReroll,
            getTreeView: () => ({ at: () => ({ index: 2, count: 3 }), continuation: 0 }),
        } })
        flushSync()
        target.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        target.querySelector<HTMLButtonElement>('[data-step="prev"]')!.click()
        expect(steps.map((entry) => entry.idx)).toEqual([-1, -1])
        expect(onReroll).not.toHaveBeenCalled()
        expect(unReroll).not.toHaveBeenCalled()
        await steps[0].step()
        await steps[1].step()
        expect(onReroll).toHaveBeenCalledTimes(1)
        expect(unReroll).toHaveBeenCalledTimes(1)
        expect(stepSibling).not.toHaveBeenCalled()
        // Wheel and arrow key use the same path.
        wheel(target.querySelector('[data-part="chat-message-body"]')!, 80)
        key('ArrowLeft')
        expect(steps.map((entry) => entry.idx)).toEqual([-1, -1, -1, -1])
    })
    test('a row that was given no runner steps directly, as a row mounted on its own does', async () => {
        show()
        target.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        await Promise.resolve()
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 1, 'a1', 'forward', { generate: false })
    })
})
