// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
const tickHaptic = vi.hoisted(() => vi.fn())
const hostInset = vi.hoisted(() => ({ value: 0 as unknown }))
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
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`,
    chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`,
} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

const WIDTH = 1024
let target: HTMLElement
let app: ReturnType<typeof ShellMessage> | undefined
let body: HTMLElement

interface Options { role?: Message['role']; index?: number; count?: number; streaming?: boolean; busy?: boolean }
function show(options: Options = {}) {
    const message: Message = { role: options.role ?? 'char', data: 'Reply', chatId: 'm' }
    DBState.db.characters[0].chats[0].message = [message]
    target = document.createElement('div')
    document.body.appendChild(target)
    const index = options.index ?? 2
    const count = options.count ?? 2
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message: DBState.db.characters[0].chats[0].message[0], streaming: options.streaming ?? false, getBusy: () => options.busy ?? false, getTreeView: () => ({ at: () => ({ index, count }), continuation: 0 }) } })
    flushSync()
    body = target.querySelector<HTMLElement>('[data-part="chat-message-body"]')!
    Object.defineProperty(body, 'clientWidth', { value: 300 })
}
function pointer(kind: string, x: number, time: number, on: Element = body, y = 100) {
    const event = new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: time }, pointerId: { value: 1 } })
    on.dispatchEvent(event)
    flushSync()
}
function dragged(): number {
    const match = /translateX\((-?[\d.]+)px\)/.exec(body.style.transform)
    return match ? Number(match[1]) : 0
}
beforeEach(() => {
    hostInset.value = 0
    Object.defineProperty(window, 'innerWidth', { value: WIDTH, configurable: true })
})
afterEach(async () => {
    vi.useRealTimers()
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    stepSibling.mockClear(); regenerateNewest.mockClear(); tickHaptic.mockClear()
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
    test('a committed step marks the slide direction until the animation ends', () => {
        show({ index: 2, count: 3 })
        pointer('pointerdown', 100, 0)
        pointer('pointermove', 220, 100)
        pointer('pointerup', 220, 200)
        expect(stepSibling).toHaveBeenCalledWith(expect.anything(), 0, 'm', 'back', { generate: false })
        expect(body.getAttribute('data-commit')).toBe('back')
        body.dispatchEvent(new Event('animationend', { bubbles: true }))
        flushSync()
        expect(body.hasAttribute('data-commit')).toBe(false)
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
        expect(target.querySelector('[data-part="chat-swipe-arm"]')).toBeNull()
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
