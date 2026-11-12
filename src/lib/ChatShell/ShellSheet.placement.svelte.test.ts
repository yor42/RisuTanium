// @vitest-environment jsdom
/**
 * T8 (regression reproducer): a `wide-menu` sheet with `placement="above"` anchors its bottom edge to the opener's top edge,
 * keeps the list inside the panel with a max-height, and follows a window resize. Before the prop existed the panel was always
 * hung from the opener's bottom edge with `top`.
 * T9 (compatibility guard, passes before and after): without `placement` the panel still hangs from the opener's bottom edge.
 * REAL: ShellSheet. Layout is not computed by jsdom, so rects and window sizes are stubbed.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from '../../ts/backHandlers'

vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

const children = createRawSnippet(() => ({ render: () => '<button data-sheet-initial>Entry</button>' }))
let app: ReturnType<typeof mount> | null = null
let target: HTMLElement | null = null
let opener: HTMLButtonElement | null = null

afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    opener?.remove()
    app = null; target = null; opener = null
    resetBackHandlersForTests()
    vi.unstubAllGlobals()
})

async function show(placement: 'below' | 'above' | undefined, rect: { left: number, top: number, bottom: number }): Promise<HTMLElement> {
    const { default: ShellSheet } = await import('./ShellSheet.svelte')
    opener = document.createElement('button')
    opener.getBoundingClientRect = () => ({ left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.left + 40, width: 40, height: rect.bottom - rect.top, x: rect.left, y: rect.top, toJSON: () => ({}) })
    document.body.appendChild(opener)
    target = document.createElement('div')
    document.body.appendChild(target)
    const props = { open: true, kind: 'menu' as const, mode: 'wide-menu' as const, label: 'Menu', opener, onclose: () => {}, children }
    app = mount(ShellSheet, { target, props: placement ? { ...props, placement } : props })
    flushSync()
    return target.querySelector<HTMLElement>('[data-part="chat-sheet"]')!
}

describe('ShellSheet wide-menu placement', () => {
    test('T8: above anchors the bottom edge to the opener top, caps the height, and recomputes on resize', async () => {
        vi.stubGlobal('innerHeight', 800)
        vi.stubGlobal('innerWidth', 400)
        const panel = await show('above', { left: 20, top: 500, bottom: 540 })
        expect(panel.style.bottom).toBe('300px')
        expect(panel.style.top).toBe('')
        expect(panel.style.left).toBe('20px')
        expect(panel.style.maxHeight).toBe('500px')

        vi.stubGlobal('innerHeight', 700)
        window.dispatchEvent(new Event('resize'))
        flushSync()
        expect(panel.style.bottom).toBe('200px')
        expect(panel.style.maxHeight).toBe('500px')
    })

    test('above: the left edge is clamped into the window like below, from both sides', async () => {
        vi.stubGlobal('innerHeight', 800)
        vi.stubGlobal('innerWidth', 400)
        const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
        try {
            const right = await show('above', { left: 380, top: 500, bottom: 540 })
            expect(right.style.left).toBe('300px')
            await unmount(app!)
            target!.remove()
            opener!.remove()
            app = null
            const left = await show('above', { left: -50, top: 500, bottom: 540 })
            expect(left.style.left).toBe('0px')
        } finally {
            width.mockRestore()
        }
    })

    test('above: closing the sheet removes the resize listener', async () => {
        vi.stubGlobal('innerHeight', 800)
        vi.stubGlobal('innerWidth', 400)
        const view = $state({ open: true })
        const { default: ShellSheet } = await import('./ShellSheet.svelte')
        opener = document.createElement('button')
        const rect = vi.fn(() => ({ left: 20, top: 500, bottom: 540, right: 60, width: 40, height: 40, x: 20, y: 500, toJSON: () => ({}) }))
        opener.getBoundingClientRect = rect
        document.body.appendChild(opener)
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ShellSheet, { target, props: { get open() { return view.open }, kind: 'menu', mode: 'wide-menu', placement: 'above', label: 'Menu', opener, onclose: () => {}, children } })
        flushSync()
        expect(target.querySelector('[data-part="chat-sheet"]')).not.toBeNull()

        view.open = false
        flushSync()
        expect(target.querySelector('[data-part="chat-sheet"]')).toBeNull()
        rect.mockClear()
        expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
        flushSync()
        expect(rect).not.toHaveBeenCalled()
    })

    test('above: destroying the component removes the resize listener', async () => {
        vi.stubGlobal('innerHeight', 800)
        vi.stubGlobal('innerWidth', 400)
        const panel = await show('above', { left: 20, top: 500, bottom: 540 })
        expect(panel.isConnected).toBe(true)
        const rect = vi.fn(opener!.getBoundingClientRect)
        opener!.getBoundingClientRect = rect
        await unmount(app!)
        app = null
        rect.mockClear()
        expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow()
        flushSync()
        expect(rect).not.toHaveBeenCalled()
    })

    test('T9: without placement the panel still hangs from the opener bottom edge', async () => {
        vi.stubGlobal('innerHeight', 800)
        vi.stubGlobal('innerWidth', 400)
        const panel = await show(undefined, { left: 20, top: 500, bottom: 540 })
        expect(panel.style.top).toBe('540px')
        expect(panel.style.left).toBe('20px')
        expect(panel.style.bottom).toBe('')
        expect(panel.style.maxHeight).toBe('')
    })
})
