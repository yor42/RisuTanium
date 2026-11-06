// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from '../../ts/backHandlers'

vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

const children = createRawSnippet(() => ({ render: () => '<div><input data-sheet-initial data-field></div>' }))
const mounted: { app: ReturnType<typeof mount>, target: HTMLElement }[] = []

afterEach(async () => {
    for (const item of mounted.reverse()) { await unmount(item.app); item.target.remove() }
    mounted.length = 0
    resetBackHandlersForTests()
})

async function show(props: { innerescape?: () => boolean, mode?: 'bottom' | 'tall' | 'side' }) {
    const { default: ShellSheet } = await import('./ShellSheet.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const onclose = vi.fn()
    const app = mount(ShellSheet, { target, props: { open: true, kind: 'sheet', mode: props.mode, label: 'Sheet', innerescape: props.innerescape, onclose, children } })
    mounted.push({ app, target })
    flushSync()
    return { target, onclose }
}

function escape(init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
}

describe('ShellSheet innerescape', () => {
    // Regression reproducer: Escape in a field always closed the sheet, whatever the field did with it.
    test('an Escape that the inner layer consumes does not close the sheet', async () => {
        const innerescape = vi.fn(() => true)
        const { target, onclose } = await show({ innerescape })
        target.querySelector<HTMLElement>('[data-field]')!.focus()
        const event = escape()
        expect(innerescape).toHaveBeenCalledTimes(1)
        expect(onclose).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(true)
    })

    test('an Escape that the inner layer does not consume closes the sheet', async () => {
        const innerescape = vi.fn(() => false)
        const { onclose } = await show({ innerescape })
        escape()
        expect(innerescape).toHaveBeenCalledTimes(1)
        expect(onclose).toHaveBeenCalledTimes(1)
    })

    test('without an inner layer Escape closes the sheet as before', async () => {
        const { onclose } = await show({})
        escape()
        expect(onclose).toHaveBeenCalledTimes(1)
    })

    test('Escape stays consumed at the window capture phase, so no later listener sees it', async () => {
        await show({ innerescape: () => true })
        const later = vi.fn()
        document.addEventListener('keydown', later)
        escape()
        document.removeEventListener('keydown', later)
        expect(later).not.toHaveBeenCalled()
    })

    // The IME guard comes first: a composition Escape cancels the composition and must reach neither layer.
    test('an Escape during composition reaches neither the inner layer nor the close', async () => {
        const innerescape = vi.fn(() => false)
        const { onclose } = await show({ innerescape })
        escape({ isComposing: true })
        escape({ keyCode: 229 })
        expect(innerescape).not.toHaveBeenCalled()
        expect(onclose).not.toHaveBeenCalled()
    })

    test('a held Escape does not reach the inner layer or the close', async () => {
        const innerescape = vi.fn(() => false)
        const { onclose } = await show({ innerescape })
        escape({ repeat: true })
        expect(innerescape).not.toHaveBeenCalled()
        expect(onclose).not.toHaveBeenCalled()
    })
})

describe('ShellSheet tall and side modes', () => {
    test('the layer and the panel carry the mode', async () => {
        for (const mode of ['tall', 'side'] as const) {
            const { target } = await show({ mode })
            expect(target.querySelector('[data-part="chat-sheet-layer"]')?.getAttribute('data-mode')).toBe(mode)
            expect(target.querySelector('[data-part="chat-sheet"]')?.getAttribute('data-mode')).toBe(mode)
        }
    })

    test('the layer element is exposed through the bindable prop', async () => {
        const { default: ShellSheet } = await import('./ShellSheet.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const state = $state<{ layer: HTMLElement | undefined }>({ layer: undefined })
        const app = mount(ShellSheet, { target, props: { open: true, kind: 'sheet', label: 'Sheet', onclose: vi.fn(), children, get layer() { return state.layer }, set layer(value: HTMLElement | undefined) { state.layer = value } } })
        mounted.push({ app, target })
        flushSync()
        expect(state.layer).toBe(target.querySelector('[data-part="chat-sheet-layer"]'))
    })
})
