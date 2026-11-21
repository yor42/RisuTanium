// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

const control = vi.hoisted(() => ({
    contexts: [] as unknown[],
    hold: null as null | { source: string, promise: Promise<void> },
    converted: [] as string[],
    // The span rules the mocked createSpanRules resolves with; null defers to the real one. `rulesGate` holds the resolution.
    rules: null as null | { probes: { lead: string, regex: RegExp, ignoreCase: boolean }[] },
    rulesGate: null as null | Promise<void>,
    rulesDelayMs: 0,
    rulesCalls: 0,
    splits: [] as { text: string, spans: unknown }[],
}))

vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return {
        ...original,
        createToSafeHtml: async (_model: string, _character: unknown, context: unknown) => {
            control.contexts.push(context)
            return async (source: string) => {
                control.converted.push(source)
                if (control.hold && source === control.hold.source) await control.hold.promise
                return `<p>${source}</p>`
            }
        },
        createSpanRules: async (character: Parameters<typeof original.createSpanRules>[0]) => {
            control.rulesCalls++
            if (control.rulesGate) await control.rulesGate
            if (control.rulesDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, control.rulesDelayMs))
            return control.rules ?? original.createSpanRules(character)
        },
        splitStreamingText: (text: string, from: number | undefined, spans: Parameters<typeof original.splitStreamingText>[2]) => {
            control.splits.push({ text, spans })
            return original.splitStreamingText(text, from, spans)
        },
    }
})
vi.mock('../../ts/chatShell/yieldToEventLoop', () => ({ yieldToEventLoop: async () => {} }))
vi.mock('../../lang', () => ({ language: { chatShellThinking: (words: number) => `Thinking… ${words}`, chatShellFormatting: 'Formatting…' } }))

import StreamingView from './StreamingView.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof StreamingView> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    vi.useRealTimers()
    control.contexts = []
    control.hold = null
    control.converted = []
    control.rules = null
    control.rulesGate = null
    control.rulesDelayMs = 0
    control.rulesCalls = 0
    control.splits = []
})

async function show(props: { text: string, parseContext?: object }) {
    const state = $state(props)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StreamingView, { target, props: state })
    mounted.push({ target, app })
    await vi.advanceTimersByTimeAsync(150)
    await tickFake()
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
        await tickFake()
        const finished = target.querySelector('[data-part="chat-stream-finished"]')
        const open = target.querySelector('[data-part="chat-stream-open"]')
        expect(finished?.textContent).toContain('Finished.')
        expect(open?.textContent).toContain('Open')
        state.text = 'Finished.\n\nOpen text'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
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
        await tickFake()
        expect(target.querySelector('[data-part="chat-stream-thinking"]')).toBeNull()
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).toContain('Answer')
    })

    test('no chip without an open Thoughts block', async () => {
        vi.useFakeTimers()
        const { target } = await show({ text: 'Plain\n\ntext' })
        expect(target.querySelector('[data-part="chat-stream-thinking"]')).toBeNull()
    })
})

const ST_RULES = { probes: [{ lead: '<st>', regex: /<st>[\s\S]*?<\/st>/y, ignoreCase: false }] }

describe('StreamingView formatting chip', () => {
    test('T-SV-1 an unbalanced CBS block shows the chip, hides its text, and finishes whole when it closes', async () => {
        vi.useFakeTimers()
        const { state, target } = await show({ text: 'A\n\n{{#if 1}}\n\nsecret' })
        expect(target.querySelector('[data-part="chat-stream-formatting"]')?.textContent).toBe('Formatting…')
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(1)
        expect(target.textContent).not.toContain('{{#if')
        expect(target.textContent).not.toContain('secret')
        expect(control.converted).not.toContain('{{#if 1}}\n\n')
        state.text = 'A\n\n{{#if 1}}\n\nsecret\n\n{{/if}}\n\nD'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(target.querySelector('[data-part="chat-stream-formatting"]')).toBeNull()
        expect(control.converted.filter((source) => source === '{{#if 1}}\n\nsecret\n\n{{/if}}\n\n')).toHaveLength(1)
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(2)
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).toContain('D')
    })

    test('T-SV-2 the chip follows the open block, and only one chip shows', async () => {
        vi.useFakeTimers()
        const { target } = await show({ text: 'Before.\n\n<Thoughts>one {{#if 1}} two' })
        const open = target.querySelector('[data-part="chat-stream-open"]')!
        const thinking = target.querySelector('[data-part="chat-stream-thinking"]')!
        expect(open.compareDocumentPosition(thinking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(target.querySelector('[data-part="chat-stream-formatting"]')).toBeNull()
        const second = await show({ text: 'x {{#if 1}} y' })
        const formatting = second.target.querySelector('[data-part="chat-stream-formatting"]')!
        expect(second.target.querySelector('[data-part="chat-stream-open"]')!.compareDocumentPosition(formatting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(second.target.querySelector('[data-part="chat-stream-thinking"]')).toBeNull()
    })

    test('T-SV-13 a probe span already present on the first pass is held', async () => {
        vi.useFakeTimers()
        control.rules = ST_RULES
        control.rulesDelayMs = 1
        const { state, target } = await show({ text: 'A\n\n<st>\n\nB' })
        const finished = [...target.querySelectorAll('[data-part="chat-stream-finished"]')]
        expect(finished).toHaveLength(1)
        expect(finished[0].textContent).toContain('A')
        expect(finished.some((block) => block.textContent?.includes('<st>'))).toBe(false)
        expect(target.querySelector('[data-part="chat-stream-formatting"]')).not.toBeNull()
        state.text = 'A\n\n<st>\n\nB\n\n</st>\n\nC'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(control.converted).toContain('<st>\n\nB\n\n</st>\n\n')
        expect(target.querySelector('[data-part="chat-stream-formatting"]')).toBeNull()
    })

    test('T-SV-7 the rules are built once per view and every split, the first included, runs after they resolve', async () => {
        vi.useFakeTimers()
        control.rules = ST_RULES
        let release: () => void = () => {}
        control.rulesGate = new Promise<void>((resolve) => { release = resolve })
        const state = $state({ text: 'A\n\nB' })
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(StreamingView, { target, props: state })
        mounted.push({ target, app })
        await vi.advanceTimersByTimeAsync(300)
        await tickFake()
        expect(control.splits).toHaveLength(0)
        release()
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(control.splits.length).toBeGreaterThan(0)
        const firstPassSplits = control.splits.length
        state.text = 'A\n\nB\n\nC'
        flushSync()
        // The wait on the gate counts as busy time, so the cadence has backed off by the time the second pass is due.
        await vi.advanceTimersByTimeAsync(5000)
        await tickFake()
        expect(control.splits.length).toBeGreaterThan(firstPassSplits)
        expect(control.rulesCalls).toBe(1)
        for (const split of control.splits) expect(split.spans).toBe(ST_RULES)
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
        await tickFake()
        await Promise.resolve()
        await tickFake()
        expect(target.textContent).not.toContain('Two.')
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(0)
        control.hold = null
        await vi.advanceTimersByTimeAsync(300)
        await tickFake()
        expect(target.querySelector('[data-part="chat-stream-finished"]')?.textContent).toContain('New.')
    })
})
