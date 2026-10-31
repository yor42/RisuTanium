import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import PatternDialog from './PatternDialog.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []
const extras: HTMLElement[] = []

const body = createRawSnippet(() => ({
    render: () => '<div><button id="ok">OK</button><button id="cancel" data-pattern-initial>Cancel</button></div>',
}))

interface DialogProps {
    labelId: string
    descriptionId?: string
    cancelSafe?: boolean
    oncancel?: () => void
    trigger?: HTMLElement | null
    background?: HTMLElement[]
    open?: boolean
    children: typeof body
}

function openDialog(overrides: Partial<DialogProps> = {}): { target: HTMLElement, props: DialogProps } {
    const props = $state<DialogProps>({ labelId: 'label', cancelSafe: true, children: body, ...overrides })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PatternDialog as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return { target, props }
}

function element(tag: string, attributes: Record<string, string> = {}): HTMLElement {
    const created = document.createElement(tag)
    for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value)
    document.body.appendChild(created)
    extras.push(created)
    return created
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.activeElement ?? document.body): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    for (const created of extras.splice(0)) created.remove()
    vi.restoreAllMocks()
})

describe('PatternDialog', () => {
    test('is a modal alert dialog that is labelled and takes first focus on the marked control', () => {
        const { target } = openDialog({ descriptionId: 'description' })
        const dialog = target.querySelector('[data-part="pattern-dialog"]')!
        expect(dialog.getAttribute('role')).toBe('alertdialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        expect(dialog.getAttribute('aria-labelledby')).toBe('label')
        expect(dialog.getAttribute('aria-describedby')).toBe('description')
        expect(document.activeElement?.id).toBe('cancel')
    })

    test('a tap on the scrim does nothing', () => {
        const oncancel = vi.fn()
        const { target } = openDialog({ oncancel })
        target.querySelector<HTMLElement>('[data-part="pattern-scrim"]')!.click()
        expect(oncancel).not.toHaveBeenCalled()
        expect(target.querySelector('[data-part="pattern-dialog"]')).not.toBeNull()
    })

    test('Escape calls oncancel once when cancel is safe and never when it is not', () => {
        const safe = vi.fn()
        const first = openDialog({ oncancel: safe, cancelSafe: true })
        expect(press('Escape').defaultPrevented).toBe(true)
        expect(safe).toHaveBeenCalledTimes(1)
        void first

        const unsafe = vi.fn()
        const { props } = openDialog({ oncancel: unsafe, cancelSafe: false })
        void props
        // The newer dialog is topmost; the older one must not act.
        expect(press('Escape').defaultPrevented).toBe(true)
        expect(unsafe).not.toHaveBeenCalled()
        expect(safe).toHaveBeenCalledTimes(1)
    })

    test('Tab wraps from the last control to the first and Shift+Tab the other way', () => {
        openDialog()
        const ok = document.getElementById('ok')!
        const cancel = document.getElementById('cancel')!
        cancel.focus()
        expect(press('Tab').defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(ok)
        expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(cancel)
    })

    test('closing restores focus to the trigger and every background element to its prior inert state', () => {
        const trigger = element('button', { id: 'trigger' })
        const plain = element('main')
        const alreadyInert = element('aside', { inert: '' })
        const { props } = openDialog({ trigger, background: [plain, alreadyInert] })
        expect(plain.hasAttribute('inert')).toBe(true)
        expect(alreadyInert.hasAttribute('inert')).toBe(true)

        props.open = false
        flushSync()
        expect(plain.hasAttribute('inert')).toBe(false)
        expect(alreadyInert.hasAttribute('inert')).toBe(true)
        expect(document.activeElement).toBe(trigger)
    })

    test('destroying the dialog also restores inert and focus and removes the key listener', async () => {
        const trigger = element('button')
        const plain = element('main')
        const oncancel = vi.fn()
        const { target } = openDialog({ trigger, background: [plain], oncancel })
        const entry = mounted.pop()!
        await unmount(entry.app as never)
        target.remove()
        expect(plain.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(trigger)
        press('Escape', {}, document.body)
        expect(oncancel).not.toHaveBeenCalled()
    })

    test('destroying the dialog removes the exact capturing key listener it added to the window', async () => {
        const added = vi.spyOn(window, 'addEventListener')
        const removed = vi.spyOn(window, 'removeEventListener')
        const { target } = openDialog()
        const keydownAdds = added.mock.calls.filter(call => call[0] === 'keydown')
        expect(keydownAdds).toHaveLength(1)
        const [, handler, capture] = keydownAdds[0]
        expect(capture).toBe(true)
        expect(removed.mock.calls.filter(call => call[0] === 'keydown')).toHaveLength(0)
        const entry = mounted.pop()!
        await unmount(entry.app as never)
        target.remove()
        expect(removed.mock.calls.filter(call => call[0] === 'keydown' && call[1] === handler && call[2] === true)).toHaveLength(1)
    })

    test('Escape after focus has moved to the body still cancels, and no document listener sees it', () => {
        const oncancel = vi.fn()
        openDialog({ oncancel, cancelSafe: true })
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        ;(document.activeElement as HTMLElement).blur()
        const event = press('Escape', {}, document.body)
        document.removeEventListener('keydown', seen)
        expect(oncancel).toHaveBeenCalledTimes(1)
        expect(event.defaultPrevented).toBe(true)
        expect(seen).not.toHaveBeenCalled()
    })

    test('Escape with cancel unsafe is still consumed and unseen, and cancels nothing', () => {
        const oncancel = vi.fn()
        openDialog({ oncancel, cancelSafe: false })
        const seen = vi.fn()
        document.addEventListener('keydown', seen)
        const event = press('Escape', {}, document.body)
        document.removeEventListener('keydown', seen)
        expect(oncancel).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(true)
        expect(seen).not.toHaveBeenCalled()
    })

    test('only the topmost of two shells acts on Escape, and the first acts again once the second closes', () => {
        const first = vi.fn()
        const second = vi.fn()
        openDialog({ oncancel: first })
        const top = openDialog({ oncancel: second })
        press('Escape')
        expect(second).toHaveBeenCalledTimes(1)
        expect(first).not.toHaveBeenCalled()

        top.props.open = false
        flushSync()
        press('Escape', {}, document.body)
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
    })

    test('a held Escape does not cancel again', () => {
        const oncancel = vi.fn()
        openDialog({ oncancel })
        press('Escape', { repeat: true })
        expect(oncancel).not.toHaveBeenCalled()
    })

    test('when the focused control is hidden, focus moves to the dialog', async () => {
        const { target } = openDialog()
        const cancel = document.getElementById('cancel')!
        expect(document.activeElement).toBe(cancel)
        cancel.hidden = true
        await Promise.resolve()
        await Promise.resolve()
        expect(document.activeElement).toBe(target.querySelector('[data-part="pattern-dialog"]'))
    })
})
