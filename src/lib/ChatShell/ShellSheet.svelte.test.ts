// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'

let covered = false
const closeAlert = vi.fn()
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => covered }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => closeAlert() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

const children = createRawSnippet(() => ({ render: () => '<button data-sheet-initial>First action</button>' }))
const mounted: { app: ReturnType<typeof mount>, target: HTMLElement }[] = []

afterEach(async () => {
    for (const item of mounted.reverse()) { await unmount(item.app); item.target.remove() }
    mounted.length = 0
    covered = false
    closeAlert.mockClear()
    resetBackHandlersForTests()
})

async function show(open: { value: boolean }, opener: HTMLElement, background: HTMLElement, mode: 'bottom' | 'action' | 'wide-menu' = 'bottom', anchor?: { x: number; y: number }) {
    const { default: ShellSheet } = await import('./ShellSheet.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ShellSheet, { target, props: { get open() { return open.value }, kind: 'menu', mode, anchor, label: 'Actions', opener, background: [background], onclose: () => { open.value = false }, children } })
    mounted.push({ app, target })
    flushSync()
    return target
}

describe('T14 ShellSheet Back and focus', () => {
    test('action and wide menu modes expose their size and on-screen anchor state', async () => {
        const opener = document.createElement('button')
        const background = document.createElement('main')
        document.body.append(opener, background)
        const action = $state({ value: true })
        const actionTarget = await show(action, opener, background, 'action')
        expect(actionTarget.querySelector('[data-part="chat-sheet"]')?.getAttribute('data-mode')).toBe('action')
        const wide = $state({ value: true })
        const target = await show(wide, opener, background, 'wide-menu', { x: window.innerWidth + 40, y: window.innerHeight + 40 })
        const menu = target.querySelector<HTMLElement>('[data-part="chat-sheet"]')
        expect(menu?.getAttribute('data-mode')).toBe('wide-menu')
        expect(Number.parseFloat(menu?.style.left ?? '')).toBeLessThanOrEqual(window.innerWidth)
        expect(Number.parseFloat(menu?.style.top ?? '')).toBeLessThanOrEqual(window.innerHeight)
        opener.remove(); background.remove()
    })
    test('aria-modal sits only on a dialog and the scrim is named as a close action', async () => {
        const opener = document.createElement('button')
        const background = document.createElement('main')
        document.body.append(opener, background)
        const open = $state({ value: true })
        const target = await show(open, opener, background)
        const menu = target.querySelector<HTMLElement>('[data-part="chat-sheet"]')!
        expect(menu.getAttribute('role')).toBe('menu')
        expect(menu.hasAttribute('aria-modal')).toBe(false)
        expect(target.querySelector('[data-part="chat-sheet-scrim"]')?.getAttribute('aria-label')).toBe(language.cancel)
        opener.remove(); background.remove()
    })
    test('alert consumes Back first, then only top sheet closes, focus returns and inert restores', async () => {
        const opener = document.createElement('button')
        const background = document.createElement('main')
        document.body.append(opener, background)
        const first = $state({ value: true })
        const second = $state({ value: true })
        await show(first, opener, background)
        await show(second, opener, background)
        expect(background.hasAttribute('inert')).toBe(true)
        covered = true
        expect(dispatchBack()).toBe(true)
        expect(closeAlert).toHaveBeenCalledTimes(1)
        expect(second.value).toBe(true)
        covered = false
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(second.value).toBe(false)
        expect(first.value).toBe(true)
        expect(dispatchBack()).toBe(true)
        flushSync()
        expect(first.value).toBe(false)
        expect(background.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(opener)
        opener.remove(); background.remove()
    })

    test('destroy unregisters Back; Escape capture closes and emits one close event after focus return', async () => {
        const opener = document.createElement('button')
        const background = document.createElement('main')
        document.body.append(opener, background)
        opener.focus()
        const open = $state({ value: true })
        const target = await show(open, opener, background)
        const events: CustomEvent<{ kind: string, opener: HTMLElement | null, restored: boolean }>[] = []
        const listener = (event: Event) => events.push(event as CustomEvent<{ kind: string, opener: HTMLElement | null, restored: boolean }>)
        document.addEventListener('chat:sheetclosed', listener)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        flushSync()
        expect(open.value).toBe(false)
        expect(events).toHaveLength(1)
        expect(events[0].detail.kind).toBe('menu')
        expect(events[0].detail.opener).toBe(opener)
        expect(events[0].detail.restored).toBe(true)
        const item = mounted.pop()
        if (item) { await unmount(item.app); item.target.remove() }
        expect(dispatchBack()).toBe(false)
        document.removeEventListener('chat:sheetclosed', listener)
        target.remove(); opener.remove(); background.remove()
    })
})
