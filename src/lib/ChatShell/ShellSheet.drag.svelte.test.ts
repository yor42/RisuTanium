// @vitest-environment jsdom
/**
 * CHORE-726: a chat bottom sheet closes when its handle is dragged down (SLICE1_SPEC 5.2, SLICE2_SPEC 3, TOGGLES_SPEC 2,
 * HOOKS1_SPEC C-2). jsdom has no layout, no animations and no pointer capture: the sheet's height is stubbed so the
 * 30 % rule means something, capture is stubbed, and the settle duration is read through a stubbed computed style.
 */
import { createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from '../../ts/backHandlers'

vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

type Mode = 'bottom' | 'action' | 'wide-menu' | 'tall' | 'side'
const children = createRawSnippet(() => ({ render: () => '<button data-sheet-initial>First action</button>' }))
const mounted: { app: ReturnType<typeof mount>, target: HTMLElement }[] = []
const HEIGHT = 400
let settleDuration = '0s'
let closedEvents = 0
const onClosed = () => { closedEvents++ }

beforeEach(() => {
    settleDuration = '0s'
    closedEvents = 0
    document.addEventListener('chat:sheetclosed', onClosed)
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).dataset.part === 'chat-sheet' ? HEIGHT : 0 } })
    Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
        const style = real(element)
        if ((element as HTMLElement).dataset?.part !== 'chat-sheet') return style
        return new Proxy(style, { get: (target, key) => key === 'transitionDuration' ? settleDuration : Reflect.get(target, key) })
    })
})

afterEach(async () => {
    vi.useRealTimers()
    for (const item of mounted.reverse()) { await unmount(item.app); item.target.remove() }
    mounted.length = 0
    document.removeEventListener('chat:sheetclosed', onClosed)
    vi.restoreAllMocks()
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
    document.documentElement.classList.remove('rm')
    resetBackHandlersForTests()
})

function pointer(on: Element, type: string, y: number, time: number, pointerType = 'touch', pointerId = 1): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y })
    Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: pointerId }, timeStamp: { value: time } })
    on.dispatchEvent(event)
    flushSync()
}

async function mountSheet(options: { mode?: Mode, keepOpen?: boolean } = {}) {
    const { default: ShellSheet } = await import('./ShellSheet.svelte')
    const state = $state({ open: true })
    const onclose = vi.fn(() => { if (!options.keepOpen) state.open = false })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ShellSheet, { target, props: { get open() { return state.open }, kind: 'sheet', mode: options.mode ?? 'bottom', label: 'Sheet', onclose, children } })
    mounted.push({ app, target })
    flushSync()
    const sheet = () => target.querySelector<HTMLElement>('[data-part="chat-sheet"]')
    const handle = () => target.querySelector<HTMLElement>('[data-part="chat-sheet-handle"]')
    const layer = () => target.querySelector<HTMLElement>('[data-part="chat-sheet-layer"]')
    return { state, onclose, target, sheet, handle, layer }
}

async function settled(): Promise<void> {
    await tick()
    await tick()
    flushSync()
}

describe('the drag handle', () => {
    test.each<Mode>(['bottom', 'action', 'tall', 'side'])('a %s sheet has the handle, hidden from assistive technology', async (mode) => {
        const { handle } = await mountSheet({ mode })
        expect(handle()).not.toBeNull()
        expect(handle()!.getAttribute('aria-hidden')).toBe('true')
    })
    test('a wide menu has no handle', async () => {
        const { handle } = await mountSheet({ mode: 'wide-menu' })
        expect(handle()).toBeNull()
    })
    test('the handle comes before the content, and the content still takes the first focus', async () => {
        const { sheet, handle } = await mountSheet()
        expect(sheet()!.firstElementChild).toBe(handle())
        expect(document.activeElement?.hasAttribute('data-sheet-initial')).toBe(true)
    })
})

describe('dragging the handle down', () => {
    test('the sheet follows the finger and the scrim fades with it', async () => {
        const { sheet, handle, layer } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 200, 100)
        expect(sheet()!.style.transform).toBe('translateY(100px)')
        expect(sheet()!.hasAttribute('data-dragging')).toBe(true)
        expect(sheet()!.hasAttribute('data-moved')).toBe(true)
        expect(layer()!.style.getPropertyValue('--sheet-drag')).toBe('0.25')
        pointer(handle()!, 'pointermove', 140, 200)
        expect(sheet()!.style.transform).toBe('translateY(40px)')
    })
    test('a release past 30 % of the height closes it once and fires the closed event once', async () => {
        const { handle, onclose } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 200, 1000)
        pointer(handle()!, 'pointermove', 230, 2000)
        pointer(handle()!, 'pointerup', 230, 2100)
        pointer(handle()!, 'lostpointercapture', 230, 2101)
        await settled()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(closedEvents).toBe(1)
    })
    test('a short slow release springs back and stays open', async () => {
        const { sheet, handle, onclose, layer } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 180, 1000)
        pointer(handle()!, 'pointermove', 190, 2000)
        pointer(handle()!, 'pointerup', 190, 2100)
        await settled()
        expect(onclose).not.toHaveBeenCalled()
        expect(sheet()!.style.transform).toBe('')
        expect(layer()!.hasAttribute('data-settle')).toBe(false)
        expect(layer()!.style.getPropertyValue('--sheet-drag')).toBe('')
    })
    test('a quick flick down closes it even when short', async () => {
        const { handle, onclose } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 120, 20)
        pointer(handle()!, 'pointermove', 160, 40)
        pointer(handle()!, 'pointerup', 170, 50)
        await settled()
        expect(onclose).toHaveBeenCalledTimes(1)
    })
    test('a mouse drag and a press that never passes the slop do nothing', async () => {
        const { sheet, handle, onclose } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0, 'mouse')
        pointer(handle()!, 'pointermove', 300, 100, 'mouse')
        pointer(handle()!, 'pointerup', 300, 200, 'mouse')
        expect(sheet()!.style.transform).toBe('')
        pointer(handle()!, 'pointerdown', 100, 300)
        pointer(handle()!, 'pointermove', 103, 310)
        pointer(handle()!, 'pointerup', 103, 320)
        await settled()
        expect(sheet()!.hasAttribute('data-moved')).toBe(false)
        expect(onclose).not.toHaveBeenCalled()
    })
    test('a cancelled drag springs back', async () => {
        const { sheet, handle, onclose } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 300, 100)
        pointer(handle()!, 'pointercancel', 300, 150)
        await settled()
        expect(onclose).not.toHaveBeenCalled()
        expect(sheet()!.style.transform).toBe('')
    })
})

describe('the settle after release', () => {
    test('the sheet travels off screen over the resolved duration before it closes', async () => {
        vi.useFakeTimers()
        settleDuration = '0.2s, 0.2s'
        const { sheet, handle, onclose, layer } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 300, 1000)
        pointer(handle()!, 'pointerup', 300, 1100)
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        expect(layer()!.dataset.settle).toBe('close')
        expect(sheet()!.style.transform).toBe('translateY(100%)')
        expect(layer()!.style.getPropertyValue('--sheet-drag')).toBe('1')
        await vi.advanceTimersByTimeAsync(199)
        expect(onclose).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(onclose).toHaveBeenCalledTimes(1)
    })
    test('Escape during the travel closes once, the pending travel never closes again, and the closed event fires once', async () => {
        vi.useFakeTimers()
        settleDuration = '200ms'
        const { handle, onclose } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 300, 1000)
        pointer(handle()!, 'pointerup', 300, 1100)
        await vi.advanceTimersByTimeAsync(0)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        flushSync()
        expect(onclose).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(500)
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(closedEvents).toBe(1)
    })
    test('a press during the travel is ignored', async () => {
        vi.useFakeTimers()
        settleDuration = '200ms'
        const { sheet, handle } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 300, 1000)
        pointer(handle()!, 'pointerup', 300, 1100)
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        pointer(handle()!, 'pointerdown', 100, 1150, 'touch', 2)
        pointer(handle()!, 'pointermove', 120, 1160, 'touch', 2)
        expect(sheet()!.style.transform).toBe('translateY(100%)')
    })
    test('a second finger does not take over a drag in progress', async () => {
        const { sheet, handle } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0, 'touch', 1)
        pointer(handle()!, 'pointermove', 200, 100, 'touch', 1)
        pointer(handle()!, 'pointerdown', 50, 110, 'touch', 2)
        pointer(handle()!, 'pointermove', 400, 120, 'touch', 2)
        expect(sheet()!.style.transform).toBe('translateY(100px)')
    })
    test('a cancel or a lost capture from another finger does not end the drag in progress', async () => {
        const { sheet, handle } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0, 'touch', 1)
        pointer(handle()!, 'pointermove', 200, 100, 'touch', 1)
        pointer(handle()!, 'pointercancel', 200, 110, 'touch', 2)
        pointer(handle()!, 'lostpointercapture', 200, 111, 'touch', 2)
        await settled()
        expect(sheet()!.style.transform).toBe('translateY(100px)')
        expect(sheet()!.hasAttribute('data-dragging')).toBe(true)
    })
    test('a sheet closed by a drag reopens at rest', async () => {
        const { state, sheet, handle, layer } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 300, 1000)
        pointer(handle()!, 'pointerup', 300, 1100)
        await settled()
        expect(state.open).toBe(false)
        state.open = true
        flushSync()
        expect(sheet()!.style.transform).toBe('')
        expect(sheet()!.hasAttribute('data-moved')).toBe(false)
        expect(sheet()!.hasAttribute('data-dragging')).toBe(false)
        expect(layer()!.hasAttribute('data-settle')).toBe(false)
        expect(layer()!.style.getPropertyValue('--sheet-drag')).toBe('')
    })
    test('under reduced motion the finger still drives the sheet', async () => {
        document.documentElement.classList.add('rm')
        const { sheet, handle, onclose } = await mountSheet()
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 250, 100)
        expect(sheet()!.style.transform).toBe('translateY(150px)')
        pointer(handle()!, 'pointerup', 250, 1100)
        await settled()
        expect(onclose).toHaveBeenCalledTimes(1)
    })
})

describe('stacked sheets and the scrim', () => {
    test('a drag on the top sheet closes only that sheet', async () => {
        const lower = await mountSheet({ mode: 'side' })
        const upper = await mountSheet({ mode: 'bottom' })
        pointer(upper.handle()!, 'pointerdown', 100, 0)
        pointer(upper.handle()!, 'pointermove', 300, 1000)
        pointer(upper.handle()!, 'pointerup', 300, 1100)
        await settled()
        expect(upper.onclose).toHaveBeenCalledTimes(1)
        expect(lower.onclose).not.toHaveBeenCalled()
    })
    test('the release of a drag does not count as a scrim tap', async () => {
        const { handle, onclose, target } = await mountSheet({ keepOpen: true })
        const scrim = target.querySelector<HTMLElement>('[data-part="chat-sheet-scrim"]')!
        const scrimClicks = vi.fn()
        scrim.addEventListener('click', scrimClicks)
        pointer(handle()!, 'pointerdown', 100, 0)
        pointer(handle()!, 'pointermove', 180, 1000)
        pointer(handle()!, 'pointermove', 190, 2000)
        pointer(handle()!, 'pointerup', 190, 2100)
        handle()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await settled()
        expect(scrimClicks).not.toHaveBeenCalled()
        expect(onclose).not.toHaveBeenCalled()
    })
})
