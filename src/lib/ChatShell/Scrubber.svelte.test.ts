// @vitest-environment jsdom
/**
 * The scrubber component: jsdom has no layout and no pointer capture, so the track and thumb rects are stubbed (track 456 high
 * from y=100, thumb 56 high at the top of the track) and capture is a spy. The thumb's grab point is its centre (y=128).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const tickHaptic = vi.hoisted(() => vi.fn(() => true))
vi.mock('../../ts/chatShell/haptics', () => ({ readHaptics: () => true, tickHaptic }))

import Scrubber from './Scrubber.svelte'

const rects = { trackHeight: 456, thumbHeight: 56 }
const formatter = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
const label = (position: string, total: string, date: string | null) => date === null ? `${position} / ${total}` : `${position} / ${total} · ${date}`
const mounted: { app: ReturnType<typeof mount>, target: HTMLElement }[] = []

function makeProps(overrides: Partial<{ count: number, fraction: number, visible: boolean, trackInteractive: boolean, time: number | undefined }> = {}) {
    const state = $state({ count: 101, fraction: 0, visible: true, trackInteractive: false, time: undefined as number | undefined, ...overrides })
    const handlers = {
        onrelease: vi.fn<(index: number) => void>(),
        onpage: vi.fn<(direction: -1 | 1) => void>(),
        onhover: vi.fn<(on: boolean) => void>(),
        ondrag: vi.fn<(on: boolean) => void>(),
        onwheel: vi.fn<(event: WheelEvent) => void>(),
        pick: vi.fn<(x: number, y: number) => Element | null | undefined>(() => null),
    }
    return { state, handlers }
}

function mountScrubber(props: ReturnType<typeof makeProps>) {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Scrubber, {
        target,
        props: {
            get count() { return props.state.count },
            get fraction() { return props.state.fraction },
            get visible() { return props.state.visible },
            get trackInteractive() { return props.state.trackInteractive },
            formatter,
            label,
            timeAt: () => props.state.time,
            ...props.handlers,
        },
    })
    mounted.push({ app, target })
    flushSync()
    const root = target.querySelector('[data-part="chat-scrubber"]') as HTMLElement
    return {
        app,
        root,
        track: root.querySelector('[data-part="chat-scrubber-track"]') as HTMLElement,
        thumb: root.querySelector('[data-part="chat-scrubber-thumb"]') as HTMLElement,
        bubble: () => root.querySelector('[data-part="chat-scrubber-bubble"]'),
    }
}

function pointer(on: Element | Window, type: string, y: number, pointerType = 'touch', pointerId = 1, x = 500): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: pointerId } })
    on.dispatchEvent(event)
    flushSync()
}

beforeEach(() => {
    rects.trackHeight = 456
    rects.thumbHeight = 56
    tickHaptic.mockClear()
    Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        const part = this.dataset.part
        const height = part === 'chat-scrubber-track' ? rects.trackHeight : part === 'chat-scrubber-thumb' ? rects.thumbHeight : 0
        const top = part === 'chat-scrubber-track' || part === 'chat-scrubber-thumb' ? 100 : 0
        return { top, bottom: top + height, left: 0, right: 44, width: 44, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    })
})

afterEach(async () => {
    vi.useRealTimers()
    for (const item of mounted.reverse()) { await unmount(item.app).catch(() => {}); item.target.remove() }
    mounted.length = 0
    vi.restoreAllMocks()
    delete (document as { visibilityState?: string }).visibilityState
})

describe('Scrubber drag and release', () => {
    test('S1 a drag reports one index on pointerup and nothing before it', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        pointer(view.thumb, 'pointermove', 368)
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
        expect(props.handlers.ondrag).toHaveBeenCalledTimes(1)
        expect(props.handlers.ondrag).toHaveBeenLastCalledWith(true)
        pointer(view.thumb, 'pointerup', 368)
        expect(props.handlers.onrelease).toHaveBeenCalledTimes(1)
        expect(props.handlers.onrelease).toHaveBeenCalledWith(60)
        expect(props.handlers.ondrag).toHaveBeenLastCalledWith(false)
        pointer(view.thumb, 'pointerup', 368)
        expect(props.handlers.onrelease).toHaveBeenCalledTimes(1)
    })

    test('S2 a quick tap clicks the element under the thumb and starts no drag', () => {
        const props = makeProps({ trackInteractive: true })
        const button = document.createElement('button')
        const clicked = vi.fn()
        button.addEventListener('click', clicked)
        props.handlers.pick.mockReturnValue(button)
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128, 'touch', 1, 480)
        pointer(view.thumb, 'pointerup', 128, 'touch', 1, 480)
        expect(props.handlers.pick).toHaveBeenCalledWith(480, 128)
        expect(clicked).toHaveBeenCalledTimes(1)
        expect(props.handlers.ondrag).not.toHaveBeenCalled()
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
        const native = new MouseEvent('click', { bubbles: true, cancelable: true, clientY: 400 })
        view.thumb.dispatchEvent(native)
        expect(native.defaultPrevented).toBe(true)
        expect(props.handlers.onpage).not.toHaveBeenCalled()
    })

    test('S2b a 260 ms hold starts a drag without movement', () => {
        vi.useFakeTimers()
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        vi.advanceTimersByTime(259)
        expect(props.handlers.ondrag).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        flushSync()
        expect(props.handlers.ondrag).toHaveBeenCalledWith(true)
        expect(view.bubble()?.textContent).toBe('1 / 101')
    })

    test.each([
        ['pointercancel', (view: ReturnType<typeof mountScrubber>) => pointer(view.thumb, 'pointercancel', 368)],
        ['lostpointercapture', (view: ReturnType<typeof mountScrubber>) => pointer(view.thumb, 'lostpointercapture', 368)],
        ['Escape', () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); flushSync() }],
        ['window blur', () => { window.dispatchEvent(new Event('blur')); flushSync() }],
        ['a hidden page', () => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); flushSync() }],
        ['unmount', (view: ReturnType<typeof mountScrubber>) => { void unmount(view.app); flushSync() }],
    ])('S3 %s after the drag started ends it without a jump', (_name, end) => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        end(view)
        pointer(view.thumb, 'pointerup', 368)
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
        expect(props.handlers.ondrag).toHaveBeenCalledTimes(2)
        expect(props.handlers.ondrag).toHaveBeenLastCalledWith(false)
        expect(view.root.isConnected ? view.bubble() : null).toBeNull()
    })

    test('S3b Escape is default-prevented but not stopped, and only while a session is live', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        const idle = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        window.dispatchEvent(idle)
        expect(idle.defaultPrevented).toBe(false)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        const live = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        const later = vi.fn()
        document.addEventListener('keydown', later)
        document.body.dispatchEvent(live)
        document.removeEventListener('keydown', later)
        expect(live.defaultPrevented).toBe(true)
        expect(later).toHaveBeenCalledTimes(1)
    })

    test('S7 a release at the index the drag started on does nothing', () => {
        const props = makeProps({ count: 21 })
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 134)
        pointer(view.thumb, 'pointerup', 134)
        expect(props.handlers.ondrag).toHaveBeenCalledTimes(2)
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
    })

    test('S9 during a drag the thumb follows the pointer, after it the prop', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        expect(Number(view.root.style.getPropertyValue('--chat-scrub-p'))).toBeCloseTo(0.6, 5)
        props.state.fraction = 0.9
        flushSync()
        expect(Number(view.root.style.getPropertyValue('--chat-scrub-p'))).toBeCloseTo(0.6, 5)
        pointer(view.thumb, 'pointerup', 368)
        expect(Number(view.root.style.getPropertyValue('--chat-scrub-p'))).toBeCloseTo(0.9, 5)
    })
})

describe('Scrubber bubble', () => {
    test('S6 shows index and total, with a date only when the message has a time, and only while dragging', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        expect(view.bubble()).toBeNull()
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        expect(view.bubble()?.textContent).toBe('61 / 101')
        props.state.time = Date.UTC(2026, 10, 15, 12)
        flushSync()
        expect(view.bubble()?.textContent).toBe('61 / 101 · Nov 15, 2026')
        pointer(view.thumb, 'pointerup', 368)
        expect(view.bubble()).toBeNull()
    })
})

describe('Scrubber hidden and fit', () => {
    test('S4 while not visible the root is hidden and a press starts nothing', () => {
        const props = makeProps({ visible: false })
        const view = mountScrubber(props)
        expect(view.root.hasAttribute('data-hidden')).toBe(true)
        expect(view.root.getAttribute('aria-hidden')).toBe('true')
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        pointer(view.thumb, 'pointerup', 368)
        expect(props.handlers.ondrag).not.toHaveBeenCalled()
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
        props.state.visible = true
        flushSync()
        expect(view.root.hasAttribute('data-hidden')).toBe(false)
    })

    test('S10 hiding during a live drag aborts it, releases capture and reports no jump', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        const release = HTMLElement.prototype.releasePointerCapture as ReturnType<typeof vi.fn>
        release.mockClear()
        props.state.visible = false
        flushSync()
        expect(release).toHaveBeenCalledWith(1)
        pointer(view.thumb, 'pointerup', 368)
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
        expect(props.handlers.ondrag).toHaveBeenCalledTimes(2)
        expect(props.handlers.ondrag).toHaveBeenLastCalledWith(false)
    })

    test('S11 a track under two thumb heights hides the scrubber and refuses a drag', () => {
        rects.trackHeight = 100
        const props = makeProps()
        const view = mountScrubber(props)
        expect(view.root.hasAttribute('data-hidden')).toBe(true)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 168)
        pointer(view.thumb, 'pointerup', 168)
        expect(props.handlers.ondrag).not.toHaveBeenCalled()
        expect(props.handlers.onrelease).not.toHaveBeenCalled()
    })

    test('S11b the fit is read again when a press starts', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        expect(view.root.hasAttribute('data-hidden')).toBe(false)
        rects.trackHeight = 100
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 168)
        pointer(view.thumb, 'pointerup', 168)
        expect(props.handlers.ondrag).not.toHaveBeenCalled()
        expect(view.root.hasAttribute('data-hidden')).toBe(true)
    })
})

describe('Scrubber track, hover and wheel', () => {
    test('S5 a track click pages toward the click only while the track is interactive', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        view.track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 150 }))
        expect(props.handlers.onpage).not.toHaveBeenCalled()
        props.state.trackInteractive = true
        flushSync()
        view.track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 120 }))
        view.track.dispatchEvent(new MouseEvent('click', { bubbles: true, clientY: 400 }))
        expect(props.handlers.onpage.mock.calls).toEqual([[-1], [1]])
    })

    test('hover reports mouse only, on the root', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.root, 'pointerenter', 128, 'touch')
        expect(props.handlers.onhover).not.toHaveBeenCalled()
        pointer(view.root, 'pointerenter', 128, 'mouse')
        pointer(view.root, 'pointerleave', 128, 'mouse')
        expect(props.handlers.onhover.mock.calls).toEqual([[true], [false]])
    })

    test('a wheel over the thumb is forwarded and kept off the page, except a zoom', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40 })
        view.thumb.dispatchEvent(plain)
        const zoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40, ctrlKey: true })
        view.thumb.dispatchEvent(zoom)
        expect(props.handlers.onwheel).toHaveBeenCalledTimes(2)
        expect(plain.defaultPrevented).toBe(true)
        expect(zoom.defaultPrevented).toBe(false)
    })

    test('a wheel while hidden is ignored', () => {
        const props = makeProps({ visible: false })
        const view = mountScrubber(props)
        view.thumb.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -40 }))
        expect(props.handlers.onwheel).not.toHaveBeenCalled()
    })
})

describe('Scrubber haptics', () => {
    test('S8 one tick per move that crosses a 10 percent mark, with the pointer type', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128)
        pointer(view.thumb, 'pointermove', 368)
        expect(tickHaptic).not.toHaveBeenCalled()
        pointer(view.thumb, 'pointermove', 388)
        expect(tickHaptic).not.toHaveBeenCalled()
        pointer(view.thumb, 'pointermove', 408)
        expect(tickHaptic).toHaveBeenCalledTimes(1)
        expect(tickHaptic).toHaveBeenCalledWith('scrub', 'touch', true)
        pointer(view.thumb, 'pointermove', 410)
        expect(tickHaptic).toHaveBeenCalledTimes(1)
        pointer(view.thumb, 'pointermove', 100)
        expect(tickHaptic).toHaveBeenCalledTimes(2)
    })

    test('S8b a mouse drag passes the mouse pointer type to the haptics rule', () => {
        const props = makeProps()
        const view = mountScrubber(props)
        pointer(view.thumb, 'pointerdown', 128, 'mouse')
        pointer(view.thumb, 'pointermove', 368, 'mouse')
        pointer(view.thumb, 'pointermove', 408, 'mouse')
        expect(tickHaptic).toHaveBeenCalledWith('scrub', 'mouse', true)
    })
})
