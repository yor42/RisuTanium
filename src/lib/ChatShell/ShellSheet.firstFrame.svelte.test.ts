// @vitest-environment jsdom

/**
 * The settle of `ShellSheet.svelte` after a handle drag is released, observed at the first animation frame: by then the
 * settle state is applied and the computed transition duration has been read, so the travel timer starts in the frame
 * that paints the settle state, not one frame later. Sizes, capture and the computed style are stubbed as in the drag
 * suite; real timers (the first-frame harness).
 *
 * Labels: "reproducer" fails when the release's wait resolves on a frame or a timer instead of before the first frame.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from '../../ts/backHandlers'
import { drainMicrotasks, installFrameQueue, readAtFirstFrame, runFrame, uninstallFrameQueue } from '../../ts/tests/firstFrame.test-helpers'

vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

const children = createRawSnippet(() => ({ render: () => '<button data-sheet-initial>First action</button>' }))
const HEIGHT = 400
let app: ReturnType<typeof mount> | null = null
let host: HTMLElement | null = null
let durationReads = 0

beforeEach(() => {
    durationReads = 0
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).dataset.part === 'chat-sheet' ? HEIGHT : 0 } })
    Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element) => {
        const style = real(element)
        if ((element as HTMLElement).dataset?.part !== 'chat-sheet') return style
        return new Proxy(style, {
            get: (target, key) => {
                if (key === 'transitionDuration') {
                    durationReads++
                    return '0s'
                }
                return Reflect.get(target, key)
            },
        })
    })
})

afterEach(async () => {
    uninstallFrameQueue()
    if (app) {
        await unmount(app)
        app = null
    }
    host?.remove()
    host = null
    vi.restoreAllMocks()
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight
    resetBackHandlersForTests()
})

function pointer(on: Element, type: string, y: number, time: number): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 }, timeStamp: { value: time } })
    on.dispatchEvent(event)
    flushSync()
}

describe('releasing the sheet handle, before the first frame', () => {
    test('reproducer: a spring-back release has applied its settle state and read the transition duration at the first frame', async () => {
        const { default: ShellSheet } = await import('./ShellSheet.svelte')
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(ShellSheet, { target: host, props: { open: true, kind: 'sheet', mode: 'bottom', label: 'Sheet', onclose: vi.fn(), children } })
        flushSync()
        const handle = host.querySelector<HTMLElement>('[data-part="chat-sheet-handle"]')!
        pointer(handle, 'pointerdown', 100, 0)
        pointer(handle, 'pointermove', 180, 1000)
        pointer(handle, 'pointermove', 190, 2000)
        expect(durationReads).toBe(0)

        installFrameQueue()
        pointer(handle, 'pointerup', 190, 2100)
        const readsAtFirstFrame = readAtFirstFrame(() => durationReads)
        // Only microtasks run: a wait that needs an animation frame or a timer has not finished yet.
        await drainMicrotasks()
        runFrame()
        expect(await readsAtFirstFrame).toBeGreaterThan(0)
    })
})
