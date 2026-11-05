// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'

const control = vi.hoisted(() => ({ contexts: [] as unknown[], hold: null as null | { source: string, promise: Promise<void> } }))

vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return {
        ...original,
        createToSafeHtml: async (_model: string, _character: unknown, context: unknown) => {
            control.contexts.push(context)
            return async (source: string) => {
                if (control.hold && source === control.hold.source) await control.hold.promise
                return `<p>${source}</p>`
            }
        },
    }
})
vi.mock('../../ts/chatShell/yieldToEventLoop', () => ({ yieldToEventLoop: async () => {} }))
vi.mock('../../lang', () => ({ language: { chatShellThinking: (words: number) => `Thinking… ${words}` } }))

import StreamingView from './StreamingView.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof StreamingView> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    vi.useRealTimers()
    control.contexts = []
    control.hold = null
})

async function show(props: { text: string, parseContext?: object }) {
    const state = $state(props)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StreamingView, { target, props: state })
    mounted.push({ target, app })
    await vi.advanceTimersByTimeAsync(150)
    await tick()
    return { state, target }
}

describe('StreamingView append-only rendering', () => {
    test('T1: a cadence tick updates only the open paragraph', async () => {
        vi.useFakeTimers()
        const state = $state({ text: 'Finished.\n\nOpen' })
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(StreamingView, { target, props: state })
        mounted.push({ target, app })
        await vi.advanceTimersByTimeAsync(150)
        await tick()
        const finished = target.querySelector('[data-part="chat-stream-finished"]')
        const open = target.querySelector('[data-part="chat-stream-open"]')
        expect(finished?.textContent).toContain('Finished.')
        expect(open?.textContent).toContain('Open')
        state.text = 'Finished.\n\nOpen text'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tick()
        expect(target.querySelector('[data-part="chat-stream-finished"]')).toBe(finished)
        expect(target.querySelector('[data-part="chat-stream-open"]')).toBe(open)
        expect(open?.textContent).toContain('Open text')
    })

    test('the open block is not a live region', async () => {
        vi.useFakeTimers()
        const { target } = await show({ text: 'Open' })
        const open = target.querySelector('[data-part="chat-stream-open"]')
        expect(open?.hasAttribute('aria-live')).toBe(false)
    })

    test('the parse context reaches the safe-html factory', async () => {
        vi.useFakeTimers()
        const parseContext = { chatID: 4, cbsConditions: { firstmsg: false, chatRole: 'char' } }
        await show({ text: 'Open', parseContext })
        expect(control.contexts).toEqual([parseContext])
    })
})

describe('StreamingView thinking chip', () => {
    test('an open Thoughts block shows the chip with its word count instead of a blank row, and closing removes it', async () => {
        vi.useFakeTimers()
        const { state, target } = await show({ text: 'Before.\n\n<Thoughts>one two three' })
        const chip = target.querySelector('[data-part="chat-stream-thinking"]')
        expect(chip?.textContent).toBe('Thinking… 3')
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).not.toContain('one two')
        state.text = 'Before.\n\n<Thoughts>one two three four</Thoughts>\n\nAnswer'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tick()
        expect(target.querySelector('[data-part="chat-stream-thinking"]')).toBeNull()
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).toContain('Answer')
    })

    test('no chip without an open Thoughts block', async () => {
        vi.useFakeTimers()
        const { target } = await show({ text: 'Plain\n\ntext' })
        expect(target.querySelector('[data-part="chat-stream-thinking"]')).toBeNull()
    })
})

describe('StreamingView prefix reset', () => {
    test('a render in flight for the old text cannot append stale blocks after the prefix changed', async () => {
        vi.useFakeTimers()
        const { state, target } = await show({ text: 'Old.\n\nopen' })
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(1)
        let release: () => void = () => {}
        control.hold = { source: 'Two.\n\n', promise: new Promise<void>((resolve) => { release = resolve }) }
        state.text = 'Old.\n\nTwo.\n\nopen'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        state.text = 'New.\n\nfresh'
        flushSync()
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(0)
        release()
        await tick()
        await Promise.resolve()
        await tick()
        expect(target.textContent).not.toContain('Two.')
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(0)
        control.hold = null
        await vi.advanceTimersByTimeAsync(300)
        await tick()
        expect(target.querySelector('[data-part="chat-stream-finished"]')?.textContent).toContain('New.')
    })
})
