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

interface Options { role?: Message['role']; isLastMemory?: boolean; disabled?: boolean | 'allBefore'; index?: number; count?: number; streaming?: boolean; busy?: boolean; continuation?: number; tree?: { index: number, count: number }; stepRow?: (idx: number, step: () => Promise<void> | void) => Promise<void>; onOpenActions?: (request: { opener: HTMLElement | null }) => void }
function show(options: Options = {}) {
    const message: Message = { role: options.role ?? 'char', data: 'Reply', chatId: 'm' }
    DBState.db.characters[0].chats[0].message = [message]
    target = document.createElement('div')
    document.body.appendChild(target)
    const index = options.index ?? 2
    const count = options.count ?? 2
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message: DBState.db.characters[0].chats[0].message[0], streaming: options.streaming ?? false, isLastMemory: options.isLastMemory, disabled: options.disabled, getBusy: () => options.busy ?? false, stepRow: options.stepRow, onOpenActions: options.onOpenActions, getTreeView: () => ({ at: () => (options.tree ? { index: options.tree.index, count: options.tree.count } : { index, count }), continuation: options.continuation ?? 0 }) } })
    flushSync()
    body = target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    Object.defineProperty(body, 'clientWidth', { value: 300 })
}
function pointer(kind: string, x: number, time: number, on: Element = body, y = 100, pointerType = 'touch') {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y })
    Object.defineProperties(event, { pointerType: { value: pointerType }, timeStamp: { value: time }, pointerId: { value: 1 } })
    on.dispatchEvent(event)
    flushSync()
}
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

describe('C1 the pull arms from the hold timer', () => {
    test('a finger that stops after 160 px and sends no more events arms after 300 ms and generates on release', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 200, 100)
        expect(tickHaptic).not.toHaveBeenCalledWith('arm', 'touch', true)
        vi.advanceTimersByTime(299)
        expect(tickHaptic).not.toHaveBeenCalledWith('arm', 'touch', true)
        vi.advanceTimersByTime(1)
        flushSync()
        expect(tickHaptic).toHaveBeenCalledWith('arm', 'touch', true)
        expect(target.querySelector('[data-part="chat-swipe-arm"]')!.textContent).toBe('Let go to generate a new reply')
        pointer('pointerup', 200, 900)
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
    })
    test('releasing before the hold, or cancelling after it, never generates', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 200, 100)
        vi.advanceTimersByTime(150)
        pointer('pointerup', 200, 250)
        expect(regenerateNewest).not.toHaveBeenCalled()
        pointer('pointerdown', 400, 1000)
        pointer('pointermove', 200, 1100)
        vi.advanceTimersByTime(400)
        flushSync()
        pointer('pointercancel', 200, 1500)
        vi.advanceTimersByTime(1000)
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('a fling past 160 px never arms from the timer', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 0, 20)
        pointer('pointerup', -40, 30)
        vi.advanceTimersByTime(2000)
        expect(regenerateNewest).not.toHaveBeenCalled()
        expect(tickHaptic).not.toHaveBeenCalledWith('arm', 'touch', true)
    })
})

describe('R5 the armed cue holds through finger jitter', () => {
    const chip = () => target.querySelector('[data-part="chat-swipe-arm"]')?.textContent
    test('after arming, a small fast move keeps the chip on the generate cue, and letting go generates exactly as it says', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 200, 100)
        vi.advanceTimersByTime(300)
        flushSync()
        expect(chip()).toBe('Let go to generate a new reply')
        pointer('pointermove', 202, 108)
        expect(chip()).toBe('Let go to generate a new reply')
        pointer('pointermove', 198, 116)
        expect(chip()).toBe('Let go to generate a new reply')
        pointer('pointerup', 198, 900)
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
    })
    test('sliding back under the distance withdraws the cue and the release generates nothing', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 200, 100)
        vi.advanceTimersByTime(300)
        flushSync()
        pointer('pointermove', 330, 400)
        expect(chip()).toBe('No more saved replies')
        pointer('pointerup', 330, 900)
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('a hold timer that fires a hair early looks again instead of leaving a still finger unarmed', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        let now = 1000
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
        try {
            show()
            pointer('pointerdown', 400, 0)
            pointer('pointermove', 200, 100)
            now = 1299.5
            vi.advanceTimersByTime(300)
            flushSync()
            expect(chip()).not.toBe('Let go to generate a new reply')
            now = 1312
            vi.advanceTimersByTime(20)
            flushSync()
            expect(chip()).toBe('Let go to generate a new reply')
            expect(tickHaptic).toHaveBeenCalledWith('arm', 'touch', true)
            pointer('pointerup', 200, 900)
            expect(regenerateNewest).toHaveBeenCalledTimes(1)
        } finally {
            clock.mockRestore()
        }
    })
    test('an armed release springs back to the centre instead of sliding the body in', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 200, 100)
        vi.advanceTimersByTime(300)
        flushSync()
        pointer('pointerup', 200, 900)
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
        expect(body.hasAttribute('data-spring')).toBe(true)
        expect(body.hasAttribute('data-commit')).toBe(false)
        expect(dragged()).toBe(0)
    })
})

describe('R5 the message body carries a transform only while it moves', () => {
    function expectAtRest() {
        expect(body.style.transform).toBe('')
        expect(body.hasAttribute('data-spring')).toBe(false)
    }
    test('no transform at rest, one while dragged, translateX(0px) for the spring back, none again once its timer ends', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        expect(body.style.transform).toBe('')
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 160, 100)
        expect(body.style.transform).toBe('translateX(60px)')
        pointer('pointerup', 160, 200)
        expect(body.style.transform).toBe('translateX(0px)')
        expect(body.hasAttribute('data-spring')).toBe(true)
        vi.advanceTimersByTime(2000)
        flushSync()
        expectAtRest()
    })
    test('a gesture that never leaves the slop leaves no transform and no spring behind', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 104, 50)
        pointer('pointerup', 104, 100)
        flushSync()
        expectAtRest()
    })
    test('a tap leaves no transform and no spring behind', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointerup', 100, 40)
        flushSync()
        expectAtRest()
    })
    test('a cancelled touch that never moved leaves no transform and no spring behind', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointercancel', 100, 40)
        flushSync()
        expectAtRest()
    })
    test('a release under reduced motion returns at once: no transform and no spring', () => {
        const original = window.matchMedia
        window.matchMedia = ((query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia
        try {
            show({ index: 2, count: 3 })
            pointer('pointerdown', 100, 0)
            pointer('pointermove', 160, 100)
            expect(body.style.transform).toBe('translateX(60px)')
            pointer('pointerup', 160, 200)
            flushSync()
            expectAtRest()
        } finally {
            window.matchMedia = original
        }
    })
    test('reduce motion set to off (rm-off) keeps the spring even while the OS asks for reduced motion', () => {
        const original = window.matchMedia
        window.matchMedia = ((query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false, onchange: null })) as typeof window.matchMedia
        document.documentElement.classList.add('rm-off')
        try {
            show({ index: 2, count: 3 })
            pointer('pointerdown', 100, 0)
            pointer('pointermove', 160, 100)
            pointer('pointerup', 160, 200)
            flushSync()
            expect(body.hasAttribute('data-spring')).toBe(true)
        } finally {
            document.documentElement.classList.remove('rm-off')
            window.matchMedia = original
        }
    })
    test('the next touch cancels the pending spring timer', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 160, 100)
        pointer('pointerup', 160, 200)
        pointer('pointerdown', 100, 300)
        pointer('pointermove', 140, 350)
        vi.advanceTimersByTime(2000)
        flushSync()
        expect(body.style.transform).toBe('translateX(40px)')
        expect(body.hasAttribute('data-spring')).toBe(false)
    })
})

describe('R5b the spring fallback timer follows the page motion factor', () => {
    function springEndsAfter(factor: string | null): number {
        vi.useFakeTimers()
        if (factor !== null) document.documentElement.style.setProperty('--chat-motion', factor)
        try {
            show({ index: 2, count: 3 })
            pointer('pointerdown', 100, 0)
            pointer('pointermove', 160, 100)
            pointer('pointerup', 160, 200)
            expect(body.hasAttribute('data-spring')).toBe(true)
            for (let elapsed = 1; elapsed <= 3000; elapsed++) {
                vi.advanceTimersByTime(1)
                flushSync()
                if (!body.hasAttribute('data-spring')) return elapsed
            }
            return Infinity
        } finally {
            document.documentElement.style.removeProperty('--chat-motion')
            if (app) void unmount(app)
            app = undefined
            target.remove()
        }
    }
    test('the nominal 260 ms plus the margin without a factor, shorter at 0.5 and longer at 2', () => {
        const nominal = springEndsAfter(null)
        expect(nominal).toBe(410)
        expect(springEndsAfter('0.5')).toBe(280)
        expect(springEndsAfter('2')).toBe(670)
    })
    test('a missing or non-numeric factor falls back to nominal and an oversized one is clamped to 10', () => {
        expect(springEndsAfter('nonsense')).toBe(410)
        expect(springEndsAfter('50')).toBe(2750)
    })
})

describe('C2 vertical scroll stays with the browser', () => {
    test('the message body asks for vertical panning only', () => {
        show()
        expect(body.getAttribute('style')).toContain('touch-action: pan-y')
    })
})

describe('C3 the right edge uses the host inset like the left edge', () => {
    test('with a 16 dp host inset a start 30 px from the right edge belongs to the host, 60 px does not', () => {
        hostInset.value = 16
        show()
        pointer('pointerdown', WIDTH - 30, 0)
        pointer('pointermove', WIDTH - 150, 100)
        expect(dragged()).toBe(0)
        pointer('pointerup', WIDTH - 150, 200)
        pointer('pointerdown', WIDTH - 60, 300)
        pointer('pointermove', WIDTH - 180, 400)
        expect(Math.abs(dragged())).toBeGreaterThan(0)
    })
    test('without a host inset the plain 24 dp zone applies on the right', () => {
        show()
        pointer('pointerdown', WIDTH - 30, 0)
        pointer('pointermove', WIDTH - 150, 100)
        expect(Math.abs(dragged())).toBeGreaterThan(0)
    })
    test('the left edge still reserves the inset', () => {
        hostInset.value = 16
        show()
        pointer('pointerdown', 30, 0)
        pointer('pointermove', 150, 100)
        expect(dragged()).toBe(0)
    })
})

describe('C4 the sideways scroll exemption follows the event target', () => {
    function wide(): HTMLElement {
        const node = document.createElement('div')
        Object.defineProperties(node, { scrollWidth: { value: 600 }, clientWidth: { value: 200 } })
        return node
    }
    test('a drag that starts inside a wide block belongs to the block, and one beside it still swipes', () => {
        show()
        const table = wide()
        const inner = document.createElement('span')
        table.appendChild(inner)
        const plain = document.createElement('p')
        body.append(table, plain)
        pointer('pointerdown', 500, 0, inner)
        pointer('pointermove', 380, 100, inner)
        expect(dragged()).toBe(0)
        pointer('pointerup', 380, 200, inner)
        pointer('pointerdown', 500, 300, plain)
        pointer('pointermove', 380, 400, plain)
        expect(Math.abs(dragged())).toBeGreaterThan(0)
    })
    test('a wide first child no longer disables the swipe for the whole message', () => {
        show()
        const plain = document.createElement('p')
        body.append(wide(), plain)
        pointer('pointerdown', 500, 0, plain)
        pointer('pointermove', 380, 100, plain)
        expect(Math.abs(dragged())).toBeGreaterThan(0)
    })
})

describe('C10 swipe feedback', () => {
    // COMPATIBILITY GUARD (passes before and after CHORE-727): where motion is reduced the step lands at release with the crossfade.
    test('under reduced motion a committed step lands at once and marks the slide direction until the animation ends', () => {
        document.documentElement.classList.add('rm')
        try {
            show({ index: 2, count: 3 })
            pointer('pointerdown', 100, 0)
            pointer('pointermove', 220, 100)
            pointer('pointerup', 220, 200)
            expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
            expect(body.getAttribute('data-commit')).toBe('back')
            body.dispatchEvent(new Event('animationend', { bubbles: true }))
            flushSync()
            expect(body.hasAttribute('data-commit')).toBe(false)
        } finally {
            document.documentElement.classList.remove('rm')
        }
    })
    test('a release that commits nothing springs back, and the next touch removes the spring', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 150, 100)
        expect(Math.abs(dragged())).toBeGreaterThan(0)
        expect(body.hasAttribute('data-spring')).toBe(false)
        pointer('pointerup', 150, 200)
        expect(dragged()).toBe(0)
        expect(body.hasAttribute('data-spring')).toBe(true)
        expect(stepSibling).not.toHaveBeenCalled()
        pointer('pointerdown', 100, 400)
        expect(body.hasAttribute('data-spring')).toBe(false)
    })
    test('a cancelled swipe springs back too', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 160, 100)
        pointer('pointercancel', 160, 150)
        expect(dragged()).toBe(0)
        expect(body.hasAttribute('data-spring')).toBe(true)
    })
    test('past the first alternative the body stops at a rubber band instead of following the finger', () => {
        show({ index: 1, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 280, 100)
        const pulled = dragged()
        expect(pulled).toBeGreaterThan(0)
        expect(pulled).toBeLessThan(24)
        // SLICE1_SPEC §3.2 "At 1 / N, swiping right": the chip names the first reply and nothing peeks in.
        expect(target.querySelector('[data-part="chat-swipe-arm"]')!.textContent).toBe('First reply')
        expect(target.querySelector('[data-part="chat-swipe-peek"]')).toBeNull()
    })
    test('a streaming reply shows the still writing message and only a rubber band', () => {
        show({ streaming: true, index: 1, count: 2 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 280, 100)
        expect(Math.abs(dragged())).toBeLessThan(24)
        expect(target.querySelector('[data-part="chat-swipe-arm"]')!.textContent).toBe('Still writing the reply')
        pointer('pointerup', 280, 200)
        expect(stepSibling).not.toHaveBeenCalled()
        expect(target.querySelector('[data-part="chat-swipe-arm"]')).toBeNull()
    })
    test('where a step exists the body follows the finger one to one', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 160, 100)
        expect(dragged()).toBe(60)
    })
    test('the last user message offers a generate button that respects busy and the double press guard', () => {
        show({ role: 'user' })
        const button = target.querySelector<HTMLButtonElement>('[data-part="chat-generate-reply"]')!
        expect(button.textContent).toContain('Generate a reply')
        button.click()
        button.click()
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
    })
    test('a busy chat disables the user-last generate button and a reply row has none', () => {
        show({ role: 'user', busy: true })
        expect(target.querySelector<HTMLButtonElement>('[data-part="chat-generate-reply"]')!.disabled).toBe(true)
        unmount(app!); target.remove()
        show({ role: 'char' })
        expect(target.querySelector('[data-part="chat-generate-reply"]')).toBeNull()
    })
})

describe('CHORE-727 swipe feedback: peek, slide-out, meter and long-press ring', () => {
    const root = document.documentElement
    const chat = () => DBState.db.characters[0].chats[0] as { message: Message[], alt?: { p: string | null, a: number, m: Message }[] }
    // The shown reply sits between an earlier and a later take at the same position, in display (time) order.
    function withSiblings(): void {
        chat().alt = [
            { p: null, a: 1, m: { role: 'char', data: '**Earlier** take {{char}}', chatId: 'e', time: -1 } },
            { p: null, a: 1, m: { role: 'char', data: 'Later <img src=x onerror="alert(1)"> reply\nsecond line', chatId: 'l', time: 9 } },
        ]
    }
    function stageEl(): HTMLElement { return target.querySelector<HTMLElement>('[data-part="chat-message-stage"]')! }
    function peekEl(): HTMLElement | null { return target.querySelector<HTMLElement>('[data-part="chat-swipe-peek"]') }
    function meter(): HTMLElement | null { return target.querySelector<HTMLElement>('[data-part="chat-swipe-meter"]') }
    function key(name: string): void {
        target.querySelector('article')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }))
        flushSync()
    }
    afterEach(() => {
        delete chat().alt
        root.classList.remove('rm', 'nexus-low-power')
        root.removeAttribute('data-low-power')
    })

    test('the body sits in the registered swipe stage', () => {
        show()
        expect(body.parentElement).toBe(stageEl())
    })

    test('dragging toward the next reply peeks it in: its position chip and its first lines as plain text, following the finger', () => {
        withSiblings()
        show({ index: 2, count: 3 })
        pointer('pointerdown', 500, 0)
        pointer('pointermove', 440, 100)
        const peek = peekEl()!
        expect(peek.dataset.from).toBe('right')
        expect(peek.querySelector('[data-part="chat-swipe-peek-chip"]')!.textContent).toBe('3 / 3')
        expect(peek.querySelector('[data-part="chat-swipe-peek-text"]')!.textContent).toBe('Later reply second line')
        expect(peek.querySelector('img')).toBeNull()
        expect(peek.getAttribute('aria-hidden')).toBe('true')
        expect(peek.style.transform).toBe(`translateX(calc(${dragged()}px + (100% + 16px)))`)
        pointer('pointermove', 420, 120)
        expect(peek.style.transform).toBe(`translateX(calc(${dragged()}px + (100% + 16px)))`)
    })

    test('dragging toward the previous reply peeks it in from the other side, macros and marks removed', () => {
        withSiblings()
        show({ index: 2, count: 3 })
        pointer('pointerdown', 500, 0)
        pointer('pointermove', 560, 100)
        const peek = peekEl()!
        expect(peek.dataset.from).toBe('left')
        expect(peek.querySelector('[data-part="chat-swipe-peek-chip"]')!.textContent).toBe('1 / 3')
        expect(peek.querySelector('[data-part="chat-swipe-peek-text"]')!.textContent).toBe('Earlier take')
        expect(peek.style.transform).toBe(`translateX(calc(${dragged()}px - (100% + 16px)))`)
    })

    test('under low power the peek is the chip only', () => {
        withSiblings()
        root.setAttribute('data-low-power', '')
        show({ index: 2, count: 3 })
        pointer('pointerdown', 500, 0)
        pointer('pointermove', 440, 100)
        expect(peekEl()!.querySelector('[data-part="chat-swipe-peek-chip"]')!.textContent).toBe('3 / 3')
        expect(peekEl()!.querySelector('[data-part="chat-swipe-peek-text"]')).toBeNull()
    })

    test('a committed step slides the body out across the whole stage, the peek lands at the centre, and the step lands after the slow duration', () => {
        vi.useFakeTimers()
        withSiblings()
        show({ index: 2, count: 3 })
        Object.defineProperty(stageEl(), 'clientWidth', { value: 1000 })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        expect(body.hasAttribute('data-settle')).toBe(true)
        expect(dragged()).toBe(1016)
        expect(peekEl()!.style.transform).toBe('translateX(calc(1016px - (100% + 16px)))')
        expect(body.hasAttribute('data-commit')).toBe(false)
        vi.advanceTimersByTime(259)
        expect(stepSibling).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
    })

    test('under low power a committed step lands at once with the crossfade and nothing slides', () => {
        root.setAttribute('data-low-power', '')
        show({ index: 2, count: 3 })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(body.getAttribute('data-commit')).toBe('back')
        expect(body.hasAttribute('data-settle')).toBe(false)
        expect(dragged()).toBe(0)
    })

    test('while the body is out, the keys, the pager and another touch take no step, and exactly one step lands', async () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        key('ArrowLeft')
        key('ArrowRight')
        target.querySelector<HTMLButtonElement>('[data-step="prev"]')!.click()
        flushSync()
        pointer('pointerdown', 400, 300)
        pointer('pointermove', 520, 350)
        pointer('pointerup', 520, 400)
        expect(stepSibling).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })

    test('a key pressed after the slide-out ends but before its step has landed takes no second step', async () => {
        vi.useFakeTimers()
        const pending: (() => Promise<void>)[] = []
        const stepRow = (_idx: number, step: () => Promise<void> | void) => new Promise<void>((resolve) => { pending.push(async () => { await step(); resolve() }) })
        show({ index: 2, count: 3, stepRow })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        await vi.advanceTimersByTimeAsync(260)
        expect(pending).toHaveLength(1)
        key('ArrowLeft')
        expect(pending).toHaveLength(1)
        await pending[0]()
        await vi.advanceTimersByTimeAsync(0)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        key('ArrowLeft')
        expect(pending).toHaveLength(2)
    })

    test('a second touch while the body is out starts nothing: the body and the peek stay where the slide-out put them', () => {
        vi.useFakeTimers()
        withSiblings()
        show({ index: 2, count: 3 })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        const out = dragged()
        const peekTransform = peekEl()!.style.transform
        pointer('pointerdown', 300, 300)
        pointer('pointermove', 100, 350)
        expect(dragged()).toBe(out)
        expect(peekEl()!.style.transform).toBe(peekTransform)
        expect(meter()).toBeNull()
        expect(target.querySelector('[data-part="chat-swipe-arm"]')).toBeNull()
    })

    test('the end control while the body is out brings nothing back', async () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3, continuation: 2 })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        target.querySelector<HTMLButtonElement>('[data-action="endControl"]')!.click()
        flushSync()
        expect(stepSibling).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
    })

    test('a row whose position moved some other way while the body was out springs back and takes no step', () => {
        vi.useFakeTimers()
        const tree = $state({ index: 2, count: 3 })
        show({ tree })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        tree.index = 3
        flushSync()
        vi.advanceTimersByTime(260)
        flushSync()
        expect(stepSibling).not.toHaveBeenCalled()
        expect(body.hasAttribute('data-settle')).toBe(false)
        expect(body.hasAttribute('data-spring')).toBe(true)
    })

    test('New reply pressed while the body is out generates once it can, and the pending step is dropped', () => {
        vi.useFakeTimers()
        const options: Options = { index: 2, count: 2 }
        show(options)
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        // The New reply button generates on its own; the reply that starts makes the row busy, so the slide-out's step is refused at landing.
        target.querySelector<HTMLButtonElement>('[data-action="newReply"]')!.click()
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
        options.busy = true
        vi.advanceTimersByTime(260)
        flushSync()
        expect(stepSibling).not.toHaveBeenCalled()
        expect(body.hasAttribute('data-spring')).toBe(true)
    })

    test('a message gone from the chat while the body is out takes no step', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        chat().message[0] = { role: 'char', data: 'Other', chatId: 'other' }
        vi.advanceTimersByTime(260)
        flushSync()
        expect(stepSibling).not.toHaveBeenCalled()
    })

    test('a step the row cannot take at release springs back and never slides out', () => {
        show({ index: 2, count: 3, busy: true })
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        expect(body.hasAttribute('data-settle')).toBe(false)
        expect(body.hasAttribute('data-spring')).toBe(true)
        expect(dragged()).toBe(0)
        expect(stepSibling).not.toHaveBeenCalled()
    })

    test('a reply that starts generating while the body is out cancels the step: the body springs back', () => {
        vi.useFakeTimers()
        const options: Options = { index: 2, count: 3 }
        show(options)
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 520, 100)
        pointer('pointerup', 520, 200)
        options.busy = true
        vi.advanceTimersByTime(260)
        flushSync()
        expect(stepSibling).not.toHaveBeenCalled()
        expect(body.hasAttribute('data-settle')).toBe(false)
        expect(body.hasAttribute('data-spring')).toBe(true)
        expect(dragged()).toBe(0)
    })

    test('past the last reply the meter fills with the pull and turns the refresh icon', () => {
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 320, 100)
        const m = meter()!
        expect(m.getAttribute('aria-hidden')).toBe('true')
        expect(Number(m.dataset.fill)).toBeCloseTo(0.35, 2)
        expect(m.hasAttribute('data-armed')).toBe(false)
        expect(m.querySelector<HTMLElement>('.meter-icon')!.style.transform).toBe('rotate(126deg)')
        expect(m.querySelector<SVGCircleElement>('.meter-arc')!.style.strokeDashoffset).not.toBe('')
    })

    test('a still hold fills the meter from 70 % to full and arms it, accent on', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 200, 100)
        const fills: number[] = []
        for (let step = 0; step < 6; step++) {
            fills.push(Number(meter()!.dataset.fill))
            vi.advanceTimersByTime(50)
            flushSync()
        }
        expect(fills[0]).toBeCloseTo(0.7, 2)
        for (let at = 1; at < fills.length; at++) expect(fills[at]).toBeGreaterThan(fills[at - 1])
        expect(fills.some((fill) => fill > 0.75 && fill < 0.95)).toBe(true)
        vi.advanceTimersByTime(50)
        flushSync()
        expect(meter()!.dataset.fill).toBe('1.00')
        expect(meter()!.hasAttribute('data-armed')).toBe(true)
        expect(tickHaptic.mock.calls.filter((call) => call[0] === 'arm')).toHaveLength(1)
    })

    test.each([
        ['reduced motion', () => root.classList.add('rm')],
        ['low power', () => root.setAttribute('data-low-power', '')],
    ])('under %s the meter fills in quarter steps and the icon does not turn', (_name, on) => {
        on()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 320, 100)
        expect(meter()!.dataset.fill).toBe('0.25')
        expect(meter()!.querySelector<HTMLElement>('.meter-icon')!.style.transform).toBe('')
    })

    test('the long-press ring appears under the finger after 200 ms', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        stageEl().getBoundingClientRect = () => ({ left: 10, top: 20, right: 310, bottom: 220, width: 300, height: 200, x: 10, y: 20, toJSON: () => ({}) })
        pointer('pointerdown', 100, 0)
        vi.advanceTimersByTime(199)
        flushSync()
        expect(target.querySelector('[data-part="chat-long-press-ring"]')).toBeNull()
        vi.advanceTimersByTime(1)
        flushSync()
        const ring = target.querySelector<HTMLElement>('[data-part="chat-long-press-ring"]')!
        expect(ring.style.left).toBe('90px')
        expect(ring.style.top).toBe('80px')
        expect(ring.parentElement).toBe(stageEl())
        expect(ring.textContent).toBe('')
    })
})

describe('MC-1571 the swipe starts anywhere on the message except on interactive descendants', () => {
    function article(): HTMLElement { return target.querySelector<HTMLElement>('article')! }
    function part(selector: string): HTMLElement { return target.querySelector<HTMLElement>(selector)! }
    // A pull toward the previous reply by 0.4 of the body width, started on `on`.
    function pullFrom(on: Element, pointerType = 'touch'): void {
        pointer('pointerdown', 400, 0, on, 100, pointerType)
        pointer('pointermove', 520, 100, on, 100, pointerType)
    }
    function inBody<T extends HTMLElement>(node: T): T {
        body.append(node)
        return node
    }
    function withAttributes(node: HTMLElement, attributes: Record<string, string>): HTMLElement {
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
        return node
    }

    // REGRESSION REPRODUCER (T-BA-START): before the move, only the body listened, so these starts dragged nothing.
    test.each([
        ['the article padding', () => article()],
        ['the name row', () => part('[data-part="chat-message-name-row"]')],
        ['the name', () => part('[data-part="chat-message-name"]')],
        ['the avatar', () => part('[data-part="chat-message-avatar"]')],
    ])('a touch drag that starts on %s drags the body and takes the step', async (_name, pick) => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        await Promise.resolve()
        flushSync()
        const start = pick()
        expect(start).not.toBeNull()
        pullFrom(start)
        expect(dragged()).toBeGreaterThan(0)
        pointer('pointerup', 520, 200, start)
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
    })
    // REGRESSION REPRODUCER (T-BA-START, pen variant)
    test('a pen drag that starts on the name row drags the body and takes the step', () => {
        vi.useFakeTimers()
        show({ index: 2, count: 3 })
        const row = part('[data-part="chat-message-name-row"]')
        pullFrom(row, 'pen')
        expect(dragged()).toBeGreaterThan(0)
        pointer('pointerup', 520, 200, row, 100, 'pen')
        vi.advanceTimersByTime(260)
        expect(stepSibling).toHaveBeenCalledTimes(1)
    })
    // COMPATIBILITY GUARD (G-BA-MOUSE): passes before and after.
    test('a mouse press starts nothing, on the name row or on the body: no drag, no ring, no long press', () => {
        vi.useFakeTimers()
        const onOpenActions = vi.fn<(request: { opener: HTMLElement | null }) => void>()
        show({ index: 2, count: 3, onOpenActions })
        for (const on of [part('[data-part="chat-message-name-row"]'), body]) {
            pullFrom(on, 'mouse')
            expect(dragged()).toBe(0)
            vi.advanceTimersByTime(600)
            flushSync()
            expect(target.querySelector('[data-part="chat-long-press-ring"]')).toBeNull()
            pointer('pointerup', 520, 700, on, 100, 'mouse')
        }
        expect(onOpenActions).not.toHaveBeenCalled()
        expect(createSwipeGesture).not.toHaveBeenCalled()
    })
    // GUARD (single listener set): a pointer event that bubbles from the body or the name row is handled once.
    test('each touch creates one gesture and every pointer event is handled once', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 400, 0)
        expect(createSwipeGesture).toHaveBeenCalledTimes(1)
        pointer('pointermove', 380, 20)
        pointer('pointerup', 380, 40)
        pointer('pointerdown', 400, 100, part('[data-part="chat-message-name-row"]'))
        expect(createSwipeGesture).toHaveBeenCalledTimes(2)
    })

    // REGRESSION REPRODUCER (T-BA-EXCL-NEW): the earlier exclusion list missed these kinds, so each one started a drag.
    const ROLES = ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'slider', 'scrollbar', 'tab', 'checkbox', 'radio', 'switch', 'option', 'combobox', 'textbox', 'spinbutton']
    const NEW_KINDS: [string, () => HTMLElement][] = [
        ['select', () => inBody(document.createElement('select'))],
        ['summary in details', () => {
            const details = inBody(document.createElement('details'))
            const summary = document.createElement('summary')
            details.append(summary)
            return summary
        }],
        ['label', () => inBody(document.createElement('label'))],
        ['audio with controls', () => inBody(withAttributes(document.createElement('audio'), { controls: '' }))],
        ['video with controls', () => inBody(withAttributes(document.createElement('video'), { controls: '' }))],
        ...ROLES.map((role): [string, () => HTMLElement] => [`role ${role}`, () => inBody(withAttributes(document.createElement('div'), { role }))]),
    ]
    test.each(NEW_KINDS)('no swipe starts on %s', (_name, make) => {
        show({ index: 2, count: 3 })
        const node = make()
        pullFrom(node)
        expect(dragged()).toBe(0)
        pointer('pointerup', 520, 200, node)
        expect(stepSibling).not.toHaveBeenCalled()
    })
    // COMPATIBILITY GUARD (G-BA-EXCL-OLD): passes before and after; the pager counter and the end row are covered by their own parts.
    test.each([
        ['a link', () => inBody(withAttributes(document.createElement('a'), { href: '#somewhere' }))],
        ['a button', () => inBody(document.createElement('button'))],
        ['an input', () => inBody(document.createElement('input'))],
        ['a textarea', () => inBody(document.createElement('textarea'))],
        ['a contenteditable block', () => inBody(withAttributes(document.createElement('div'), { contenteditable: 'true' }))],
    ] as [string, () => HTMLElement][])('no swipe starts on %s', (_name, make) => {
        show({ index: 2, count: 3 })
        const node = make()
        pullFrom(node)
        expect(dragged()).toBe(0)
        pointer('pointerup', 520, 200, node)
        expect(stepSibling).not.toHaveBeenCalled()
    })
    test('no swipe starts on the pager counter, on the pager buttons or inside the end row', () => {
        show({ index: 2, count: 3, continuation: 1 })
        const counter = part('[data-part="chat-message-alts"] span[aria-live]')
        const endChild = document.createElement('span')
        part('[data-part="chat-message-end"]').append(endChild)
        for (const node of [counter, part('[data-step="next"]'), part('[data-part="chat-message-end"]'), part('[data-action="endControl"]'), endChild]) {
            pullFrom(node)
            expect(dragged()).toBe(0)
            pointer('pointerup', 520, 200, node)
        }
        expect(stepSibling).not.toHaveBeenCalled()
    })
    // COMPATIBILITY GUARD (G-BA-SCROLL): body starts keep the sideways-scroller rule; a start outside the body never looks at the elements above the article.
    test('a start on the name row ignores a scrollable ancestor above the article', () => {
        show({ index: 2, count: 3 })
        Object.defineProperties(target, { scrollWidth: { value: 600 }, clientWidth: { value: 200 } })
        pullFrom(part('[data-part="chat-message-name-row"]'))
        expect(dragged()).toBeGreaterThan(0)
    })

    // COMPATIBILITY GUARD (G-BA-ANCESTOR): an interactive ancestor above the article is not a control inside the message and never blocks the start.
    test('a start is allowed when an interactive ancestor sits above the article', () => {
        show({ index: 2, count: 3 })
        target.setAttribute('role', 'button')
        pullFrom(part('[data-part="chat-message-name-row"]'))
        expect(dragged()).toBeGreaterThan(0)
    })

    // REGRESSION REPRODUCER (T-BA-EDIT): the editors replace the body, so the chrome around them must not start a reply swipe.
    describe.each([
        ['the message editor', 'editMode'],
        ['the translation editor', 'editTranslationMode'],
    ] as const)('%s is open', (_name, flag) => {
        function editorChrome(): HTMLElement {
            const controls = document.createElement('div')
            controls.setAttribute('data-part', 'chat-message-editor-controls')
            article().append(controls)
            return controls
        }
        test('a touch drag that starts on the editor controls strip drags nothing and takes no step', () => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            editorFlags[flag] = true
            const controls = editorChrome()
            pullFrom(controls)
            expect(dragged()).toBe(0)
            pointer('pointerup', 520, 200, controls)
            vi.advanceTimersByTime(260)
            expect(stepSibling).not.toHaveBeenCalled()
            expect(createSwipeGesture).not.toHaveBeenCalled()
        })
        // COMPATIBILITY GUARD (G-BA-EDIT-OFF): with the editor closed the same start is still handled.
        test('with the editor closed a drag from the name row is handled', () => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const row = part('[data-part="chat-message-name-row"]')
            pullFrom(row)
            expect(dragged()).toBeGreaterThan(0)
            pointer('pointerup', 520, 200, row)
            vi.advanceTimersByTime(260)
            expect(stepSibling).toHaveBeenCalledTimes(1)
        })
        // GUARD (T-BA-BUSY-DOWN): the busy predicate alone stops a press on an allowed part.
        test('a press on the name row while the editor is open starts nothing', () => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            editorFlags[flag] = true
            const row = part('[data-part="chat-message-name-row"]')
            pullFrom(row)
            expect(dragged()).toBe(0)
            pointer('pointerup', 520, 200, row)
            expect(createSwipeGesture).not.toHaveBeenCalled()
            expect(stepSibling).not.toHaveBeenCalled()
        })
        // REGRESSION REPRODUCER (T-BA-OPEN-MID): the editor opens while a gesture is already down; the release must not step the row.
        test('an editor that opens after the press cancels the gesture: no drag on move, no step on release', () => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const row = part('[data-part="chat-message-name-row"]')
            pointer('pointerdown', 400, 0, row)
            editorFlags[flag] = true
            pointer('pointermove', 520, 100, row)
            expect(dragged()).toBe(0)
            expect(target.querySelector('[data-part="chat-long-press-ring"]')).toBeNull()
            pointer('pointerup', 520, 200, row)
            vi.advanceTimersByTime(260)
            expect(stepSibling).not.toHaveBeenCalled()
        })
        test('an editor that opens after the move cancels the release: no step', () => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const row = part('[data-part="chat-message-name-row"]')
            pullFrom(row)
            expect(dragged()).toBeGreaterThan(0)
            editorFlags[flag] = true
            pointer('pointerup', 520, 200, row)
            vi.advanceTimersByTime(260)
            expect(stepSibling).not.toHaveBeenCalled()
            expect(dragged()).toBe(0)
        })
    })

    // The fail-closed start area: only the row's own parts start a swipe.
    describe('the start area is an allow list', () => {
        function appendToArticle(markup: string): HTMLElement {
            const holder = document.createElement('div')
            holder.innerHTML = markup
            const node = holder.firstElementChild as HTMLElement
            article().append(node)
            return node
        }
        // REGRESSION REPRODUCER (T-BA-PARTIAL-MODAL): the partial-edit modal renders inside the article; a start on it must not swipe or step the row.
        test.each([
            ['the modal header', '.partial-edit-header'],
            ['the modal', '.partial-edit-modal'],
            ['the backdrop', '.partial-edit-overlay'],
        ])('a drag that starts on %s starts nothing', async (_name, selector) => {
            vi.useFakeTimers()
            Object.assign(DBState.db, { enableBlockPartialEdit: true })
            try {
                show({ index: 2, count: 3 })
                const overlay = appendToArticle('<div class="partial-edit-overlay"><div class="partial-edit-modal"><div class="partial-edit-header">Edit</div></div></div>')
                await Promise.resolve()
                const on = overlay.matches(selector) ? overlay : overlay.querySelector<HTMLElement>(selector)!
                pullFrom(on)
                expect(dragged()).toBe(0)
                pointer('pointerup', 520, 200, on)
                vi.advanceTimersByTime(260)
                expect(stepSibling).not.toHaveBeenCalled()
                expect(createSwipeGesture).not.toHaveBeenCalled()
            } finally { Reflect.deleteProperty(DBState.db, 'enableBlockPartialEdit') }
        })
        // GUARD (T-BA-BUSY-DOWN): with the modal open, a press on an allowed part starts nothing either.
        test('a press on the name row while a partial-edit modal is open starts nothing', async () => {
            vi.useFakeTimers()
            Object.assign(DBState.db, { enableBlockPartialEdit: true })
            try {
                show({ index: 2, count: 3 })
                appendToArticle('<div class="partial-edit-overlay"></div>')
                await Promise.resolve()
                const row = part('[data-part="chat-message-name-row"]')
                pullFrom(row)
                expect(dragged()).toBe(0)
                pointer('pointerup', 520, 200, row)
                expect(createSwipeGesture).not.toHaveBeenCalled()
                expect(stepSibling).not.toHaveBeenCalled()
            } finally { Reflect.deleteProperty(DBState.db, 'enableBlockPartialEdit') }
        })
        // REGRESSION REPRODUCER (T-BA-PARTIAL-MID): the modal opens while a gesture is already down; the busy predicate cancels it at move and at release.
        test('a partial-edit modal that opens after the press cancels the gesture: no drag, no step', async () => {
            vi.useFakeTimers()
            Object.assign(DBState.db, { enableBlockPartialEdit: true })
            try {
                show({ index: 2, count: 3 })
                const row = part('[data-part="chat-message-name-row"]')
                pointer('pointerdown', 400, 0, row)
                appendToArticle('<div class="partial-edit-overlay"></div>')
                await Promise.resolve()
                pointer('pointermove', 520, 100, row)
                expect(dragged()).toBe(0)
                pointer('pointerup', 520, 200, row)
                vi.advanceTimersByTime(260)
                expect(stepSibling).not.toHaveBeenCalled()
            } finally { Reflect.deleteProperty(DBState.db, 'enableBlockPartialEdit') }
        })
        test('a partial-edit modal that opens after the move cancels the release: no step', async () => {
            vi.useFakeTimers()
            Object.assign(DBState.db, { enableBlockPartialEdit: true })
            try {
                show({ index: 2, count: 3 })
                const row = part('[data-part="chat-message-name-row"]')
                pullFrom(row)
                expect(dragged()).toBeGreaterThan(0)
                appendToArticle('<div class="partial-edit-overlay"></div>')
                await Promise.resolve()
                pointer('pointerup', 520, 200, row)
                vi.advanceTimersByTime(260)
                expect(stepSibling).not.toHaveBeenCalled()
            } finally { Reflect.deleteProperty(DBState.db, 'enableBlockPartialEdit') }
        })
        // REGRESSION REPRODUCER (T-BA-FAIL-CLOSED): a layer the row does not know about, with or without a part of its own, starts nothing.
        test.each([
            ['an unknown part', '<div data-part="some-future-overlay"><span>x</span></div>'],
            ['a plain div with no part', '<div><span>x</span></div>'],
            ['the editor controls strip', '<div data-part="chat-message-editor-controls"><span>x</span></div>'],
        ])('a drag that starts on %s inside the article starts nothing', (_name, markup) => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const node = appendToArticle(markup)
            for (const on of [node, node.firstElementChild!]) {
                pullFrom(on)
                expect(dragged()).toBe(0)
                pointer('pointerup', 520, 200, on)
            }
            vi.advanceTimersByTime(260)
            expect(stepSibling).not.toHaveBeenCalled()
            expect(createSwipeGesture).not.toHaveBeenCalled()
        })
        // COMPATIBILITY GUARD (G-BA-OWN-PARTS): passes before and after; every part the row owns keeps starting the swipe.
        test.each([
            ['the message stage', '[data-part="chat-message-stage"]'],
            ['the message body', '[data-part="chat-message-body"]'],
            ['the meta group', '[data-part="chat-message-meta"]'],
        ])('a drag that starts on %s takes the step', (_name, selector) => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const on = part(selector)
            pullFrom(on)
            expect(dragged()).toBeGreaterThan(0)
            pointer('pointerup', 520, 200, on)
            vi.advanceTimersByTime(260)
            expect(stepSibling).toHaveBeenCalledTimes(1)
        })
        test.each([
            'chat-message-name-row', 'chat-message-meta', 'chat-message-name', 'chat-message-avatar', 'chat-message-badges',
            'chat-message-stage', 'chat-message-body', 'chat-streaming-view', 'chat-stream-finished', 'chat-stream-open', 'chat-stream-thinking',
            'chat-swipe-peek', 'chat-swipe-peek-chip', 'chat-swipe-peek-text', 'chat-swipe-meter', 'chat-swipe-arm', 'chat-long-press-ring',
            'chat-status-row', 'chat-message-delete-pending', 'chat-message-render-failed', 'chat-message-interrupted', 'chat-message-memory-limit', 'chat-message-divider',
        ])('a drag that starts on the row part %s takes the step', (partName) => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const on = appendToArticle(`<span data-part="${partName}"></span>`)
            pullFrom(on)
            expect(dragged()).toBeGreaterThan(0)
            pointer('pointerup', 520, 200, on)
            vi.advanceTimersByTime(260)
            expect(stepSibling).toHaveBeenCalledTimes(1)
        })
        // GUARD (G-MC1606-MARKERS, MC-1606): the memory-limit line and both divider kinds are rendered by the row itself and stay swipe starts.
        test.each([
            ['the memory-limit line', { isLastMemory: true }, '[data-part="chat-message-memory-limit"]'],
            ['the disabled divider', { disabled: true }, '[data-part="chat-message-divider"][data-kind="disabled"]'],
            ['the all-before divider', { disabled: 'allBefore' as const }, '[data-part="chat-message-divider"][data-kind="all-before"]'],
        ])('G-MC1606-MARKERS a drag that starts on the rendered %s takes the step', (_name, options, selector) => {
            vi.useFakeTimers()
            show({ index: 2, count: 3, ...options })
            const on = part(selector)
            expect(on).not.toBeNull()
            pullFrom(on)
            expect(dragged()).toBeGreaterThan(0)
            pointer('pointerup', 520, 200, on)
            vi.advanceTimersByTime(260)
            expect(stepSibling).toHaveBeenCalledTimes(1)
        })
        // GUARD (G-MC1606-ACTIONS, MC-1606): the action cluster rendered by MessageMeta, its gaps and its plain non-interactive nodes (time, model name) never start a swipe; the buttons inside stay excluded as interactive.
        test.each([
            ['the cluster itself', () => part('[data-part="chat-message-actions"]')],
            ['the cluster spacer gap', () => part('[data-part="chat-message-actions"] .spacer')],
            ['a plain label inside the cluster', () => { const label = document.createElement('span'); label.className = 'model'; label.textContent = 'model'; part('[data-part="chat-message-actions"]').append(label); return label }],
            ['a time node inside the cluster', () => { const time = document.createElement('time'); time.textContent = '12:00'; part('[data-part="chat-message-actions"]').append(time); return time }],
        ])('G-MC1606-ACTIONS a drag that starts on %s starts nothing', (_name, pick) => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const on = pick()
            expect(on).not.toBeNull()
            pullFrom(on)
            expect(dragged()).toBe(0)
            pointer('pointerup', 520, 200, on)
            vi.advanceTimersByTime(260)
            expect(stepSibling).not.toHaveBeenCalled()
            expect(createSwipeGesture).not.toHaveBeenCalled()
        })
        // GUARD (MC-1601, MC-1602): the translation block and plain inline images or assets are rendered into the body as markup without a part of their own, so they belong to the body; a tap-to-open one is a link or button and stays excluded.
        test.each([
            ['the translation block', () => { const block = inBody(document.createElement('div')); const paragraph = document.createElement('p'); block.append(paragraph); return paragraph }],
            ['a plain inline image', () => inBody(document.createElement('img'))],
            ['an inlay image inside its wrapper', () => { const wrapper = inBody(document.createElement('div')); wrapper.className = 'risu-inlay-image'; const image = document.createElement('img'); wrapper.append(image); return image }],
        ])('a drag that starts on %s inside the body takes the step', (_name, make) => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const on = make()
            pullFrom(on)
            expect(dragged()).toBeGreaterThan(0)
            pointer('pointerup', 520, 200, on)
            vi.advanceTimersByTime(260)
            expect(stepSibling).toHaveBeenCalledTimes(1)
        })
        test.each([['a link', 'a'], ['a button', 'button']])('a drag that starts on an image wrapped in %s starts nothing', (_name, tag) => {
            show({ index: 2, count: 3 })
            const wrapper = inBody(document.createElement(tag))
            const image = document.createElement('img')
            wrapper.append(image)
            pullFrom(image)
            expect(dragged()).toBe(0)
            pointer('pointerup', 520, 200, image)
            expect(stepSibling).not.toHaveBeenCalled()
        })
        test('a drag that starts on plain content inside the body takes the step', () => {
            vi.useFakeTimers()
            show({ index: 2, count: 3 })
            const on = inBody(document.createElement('p'))
            pullFrom(on)
            expect(dragged()).toBeGreaterThan(0)
            pointer('pointerup', 520, 200, on)
            vi.advanceTimersByTime(260)
            expect(stepSibling).toHaveBeenCalledTimes(1)
        })
    })

    // REGRESSION REPRODUCER (T-BA-PANY)
    test('the article asks for vertical panning only, like the body', () => {
        show()
        expect(article().getAttribute('style')).toContain('touch-action: pan-y')
        expect(body.getAttribute('style')).toContain('touch-action: pan-y')
    })
    // REGRESSION REPRODUCER (T-BA-LONGPRESS)
    test('a long press on the name row opens the actions once, with the body as the opener', () => {
        vi.useFakeTimers()
        const onOpenActions = vi.fn<(request: { opener: HTMLElement | null }) => void>()
        show({ index: 2, count: 3, onOpenActions })
        pointer('pointerdown', 400, 0, part('[data-part="chat-message-name-row"]'))
        vi.advanceTimersByTime(499)
        expect(onOpenActions).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onOpenActions).toHaveBeenCalledTimes(1)
        expect(onOpenActions.mock.calls[0][0].opener).toBe(body)
        vi.advanceTimersByTime(2000)
        expect(onOpenActions).toHaveBeenCalledTimes(1)
    })
    // COMPATIBILITY GUARD (G-BA-LINK): passes before and after.
    test('a tap on a link starts no drag and no long press, and the click is not prevented', () => {
        vi.useFakeTimers()
        const onOpenActions = vi.fn<(request: { opener: HTMLElement | null }) => void>()
        show({ index: 2, count: 3, onOpenActions })
        const link = inBody(withAttributes(document.createElement('a'), { href: '#somewhere' }))
        pointer('pointerdown', 400, 0, link)
        vi.advanceTimersByTime(200)
        flushSync()
        expect(target.querySelector('[data-part="chat-long-press-ring"]')).toBeNull()
        pointer('pointerup', 400, 250, link)
        const click = new MouseEvent('click', { bubbles: true, cancelable: true })
        link.dispatchEvent(click)
        expect(click.defaultPrevented).toBe(false)
        vi.advanceTimersByTime(1000)
        expect(onOpenActions).not.toHaveBeenCalled()
        expect(dragged()).toBe(0)
    })
    // GUARD (single listener set): a pointer event that reaches the article through the body is handled once, so a fast fling past the arm distance never arms or generates.
    test('a fast fling that starts on the body is handled once: no arm, no generate', () => {
        vi.useFakeTimers()
        show()
        pointer('pointerdown', 400, 0)
        pointer('pointermove', 0, 20)
        pointer('pointerup', -40, 30)
        vi.advanceTimersByTime(2000)
        expect(regenerateNewest).not.toHaveBeenCalled()
        expect(tickHaptic).not.toHaveBeenCalledWith('arm', 'touch', true)
    })
})

describe('W2 the recorded rest-then-flick through the host', () => {
    // Recorded touch pull: [ms after down, x, y]; row 0 is the pointerdown and the last row is the lift.
    const PULL_327: [number, number, number][] = [
        [0, 327.96, 317.92],
        [41, 327.66, 317.71],
        [91, 327.35, 317.71],
        [141.2, 326.4, 317.82],
        [174.5, 324.59, 318.23],
        [191.3, 322.1, 318.75],
        [208, 316.8, 320.1],
        [224.8, 312.99, 320.81],
        [241.4, 309.93, 321.64],
        [258.1, 307.27, 322.26],
        [274.7, 305.01, 323.08],
        [291.5, 302.8, 323.49],
        [308.1, 300.44, 324.22],
        [324.9, 298.48, 324.73],
        [341.6, 296.32, 325.25],
        [358.2, 294.06, 325.66],
        [374.9, 292, 326.28],
        [391.6, 290.24, 326.8],
        [408.3, 288.43, 327.11],
        [425, 286.72, 327.52],
        [441.7, 285.67, 327.62],
        [458.5, 284.26, 327.93],
        [475.2, 282.91, 328.35],
        [491.8, 281.45, 328.76],
        [508.6, 280.09, 329.07],
        [525.2, 278.84, 329.38],
        [542, 277.53, 329.59],
        [558.6, 276.08, 329.79],
        [575.3, 274.37, 330.2],
        [592, 272.21, 330.62],
        [608.8, 270.2, 330.93],
        [625.5, 268.34, 331.03],
        [642.2, 266.48, 331.24],
        [658.9, 264.43, 331.44],
        [675.6, 262.11, 331.65],
        [692.3, 259.35, 331.96],
        [708.9, 256.64, 332.17],
        [725.8, 254.03, 332.37],
        [742.4, 251.67, 332.58],
        [759.2, 249.66, 332.79],
        [775.9, 248.05, 332.99],
        [792.5, 247, 332.99],
        [809.2, 246.04, 332.99],
        [825.9, 244.99, 333.2],
        [842.7, 243.73, 333.3],
        [859.3, 242.23, 333.51],
        [876.1, 240.52, 333.71],
        [892.9, 238.81, 333.82],
        [909.5, 237.81, 334.02],
        [926.1, 236.6, 334.13],
        [942.9, 235.25, 334.33],
        [959.6, 233.84, 334.64],
        [976.3, 232.53, 334.85],
        [993, 231.53, 335.06],
        [1009.7, 230.73, 335.16],
        [1026.5, 229.92, 335.26],
        [1043.1, 228.87, 335.47],
        [1059.9, 227.31, 335.78],
        [1076.5, 225.25, 335.99],
        [1093.3, 223.19, 336.3],
        [1110, 221.03, 336.61],
        [1126.7, 219.17, 336.71],
        [1143.4, 217.87, 336.92],
        [1160.1, 216.91, 336.92],
        [1176.7, 215.91, 337.12],
        [1193.5, 213.95, 337.33],
        [1210.2, 211.69, 337.43],
        [1226.9, 209.48, 337.64],
        [1243.6, 207.07, 337.74],
        [1260.3, 204.16, 338.05],
        [1277, 200.49, 338.46],
        [1293.7, 196.93, 338.88],
        [1310.4, 193.41, 339.29],
        [1327, 189.94, 339.81],
        [1343.8, 186.43, 340.12],
        [1360.6, 183.42, 340.53],
        [1377.2, 180.9, 340.63],
        [1394, 178.44, 340.84],
        [1410.7, 176.23, 341.04],
        [1427.3, 173.82, 341.25],
        [1444.1, 171.46, 341.35],
        [1460.8, 169.5, 341.56],
        [1477.5, 167.54, 341.66],
        [1494.2, 165.84, 341.77],
        [1511, 163.68, 341.87],
        [1527.6, 162.17, 342.08],
        [1544.3, 160.71, 342.08],
        [1561, 159.21, 342.18],
        [1577.7, 157.3, 342.28],
        [1594.4, 155.14, 342.49],
        [1611.1, 152.83, 342.49],
        [1627.8, 150.87, 342.7],
        [1644.5, 149.01, 342.7],
        [1661.2, 147.3, 342.7],
        [1677.9, 145.75, 342.7],
        [1694.7, 144.64, 342.7],
        [1711.4, 143.99, 342.7],
        [1728.1, 143.69, 342.7],
        [1744.8, 143.29, 342.7],
        [1761.5, 142.53, 342.7],
        [1778.2, 141.93, 342.7],
        [1803.3, 141.18, 342.49],
        [1811.6, 140.93, 342.49],
        [1828.3, 140.32, 342.28],
        [1845, 139.37, 342.18],
        [1861.8, 138.42, 341.97],
        [1878.4, 137.51, 341.66],
        [1895.2, 137.11, 341.46],
        [1920.3, 136.71, 341.46],
        [1937, 136.59, 341.25],
        [1945.3, 136.61, 341.25],
        [2112.3, 128.82, 341.91],
        [2129.1, 104, 344.83],
        [2145.8, 62.2, 351.95],
        [2162.3, 18.95, 357.94],
        [2179.1, 18.68, 357.98],
        [2187.8, 18.68, 357.98],
    ]
    // REGRESSION REPRODUCER (T-W2-HOST): a finger that rests after the arm and then flicks left must not generate.
    test('the real pull 327 replayed through the host timers does not generate and takes no step', () => {
        vi.useFakeTimers()
        show({ index: 3, count: 3 })
        let clock = 0
        const advanceTo = (time: number) => {
            vi.advanceTimersByTime(Math.max(0, time - clock))
            flushSync()
            clock = Math.max(clock, time)
        }
        const last = PULL_327.length - 1
        PULL_327.forEach(([time, x, y], row) => {
            advanceTo(time)
            if (row === 0) pointer('pointerdown', x, time, body, y)
            else if (row === last) {
                expect(tickHaptic.mock.calls.filter((call) => call[0] === 'arm')).toHaveLength(1)
                pointer('pointerup', x, time, body, y)
            } else pointer('pointermove', x, time, body, y)
        })
        advanceTo(5000)
        expect(regenerateNewest).not.toHaveBeenCalled()
        expect(stepSibling).not.toHaveBeenCalled()
    })
})
