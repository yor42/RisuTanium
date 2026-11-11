// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

const control = vi.hoisted(() => ({
    yields: 0,
    onYield: null as null | (() => void),
    microYield: true,
    conversions: [] as string[],
    realSanitizer: false,
    identitySanitize: false,
}))
const law = vi.hoisted(() => ({ applies: false }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], hideAllImages: false } })
    return {
        DBState: state,
        selIdState: { selId: -1 },
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
    }
})
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => law.applies,
    getFileSrc: async () => '',
    setUsingSw: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
}))
vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    getModules: () => [],
    moduleUpdate: () => {},
}))
vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

vi.mock('../../ts/chatShell/yieldToEventLoop', () => ({
    yieldToEventLoop: async () => {
        control.yields++
        control.onYield?.()
        if (!control.microYield) await new Promise((resolve) => setTimeout(resolve, 0))
    },
}))
vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return {
        ...original,
        createToSafeHtml: async () => {
            const parser = control.realSanitizer ? await import('../../ts/parser/parser.svelte') : null
            return async (source: string) => {
                control.conversions.push(source)
                if (!parser) return `<p>${source.trim()}</p>`
                return original.toSafeHtml(source, {
                    display: (text) => text,
                    sanitize: (html) => control.identitySanitize ? html : parser.trimMarkdown(html),
                    watermark: (html) => html,
                })
            }
        },
    }
})
vi.mock('../../lang', () => ({ language: { chatShellThinking: (words: number) => `Thinking ${words}` } }))

import StreamingView from './StreamingView.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof StreamingView> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    vi.useRealTimers()
    control.yields = 0
    control.onYield = null
    control.microYield = true
    control.conversions = []
    control.realSanitizer = false
    control.identitySanitize = false
})

function open(props: { text: string }) {
    const state = $state(props)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StreamingView, { target, props: state })
    mounted.push({ target, app })
    return { state, target, app }
}
const finishedCount = (target: HTMLElement) => target.querySelectorAll('[data-part="chat-stream-finished"]').length

describe('StreamingView yields to the event loop', () => {
    test('one pass yields after the split, after every conversion and converts additions + 1 strings', async () => {
        vi.useFakeTimers()
        const { target } = open({ text: 'One.\n\nTwo.\n\nThree.\n\nopen' })
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(finishedCount(target)).toBe(3)
        expect(control.conversions).toHaveLength(3 + 1)
        expect(control.yields).toBeGreaterThanOrEqual(1 + 3 + 1)
    })

    test('a later pass converts only the new block and the open paragraph, never a committed block again', async () => {
        vi.useFakeTimers()
        const { state, target } = open({ text: 'One.\n\nTwo.\n\nopen' })
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        control.conversions = []
        control.yields = 0
        state.text = 'One.\n\nTwo.\n\nThree.\n\nopen more'
        flushSync()
        await vi.advanceTimersByTimeAsync(600)
        await tickFake()
        expect(finishedCount(target)).toBe(3)
        expect(control.conversions).toEqual(['Three.\n\n', 'open more'])
        expect(control.yields).toBeGreaterThanOrEqual(1 + 1 + 1)
    })

    test.each([1, 2, 3])('a prefix reset at yield %i of a pass drops the stale pass and appends no old block', async (resetAt) => {
        vi.useFakeTimers()
        const { state, target } = open({ text: 'Old.\n\nopen' })
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(finishedCount(target)).toBe(1)
        let reset = false
        let seen = 0
        control.onYield = () => {
            // The text changes to an unrelated stream while the pass is suspended at the chosen yield.
            if (reset || ++seen < resetAt) return
            reset = true
            state.text = 'New.\n\nfresh'
            flushSync()
        }
        state.text = 'Old.\n\nTwo.\n\nopen'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        control.onYield = null
        expect(reset).toBe(true)
        expect(target.textContent).not.toContain('Old.')
        expect(target.textContent).not.toContain('Two.')
        await vi.advanceTimersByTimeAsync(600)
        await tickFake()
        expect(finishedCount(target)).toBe(1)
        expect(target.querySelector('[data-part="chat-stream-finished"]')?.textContent).toContain('New.')
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).toContain('fresh')
    })

    test('destroying the view between yields commits nothing', async () => {
        vi.useFakeTimers()
        const { target, app } = open({ text: 'One.\n\nTwo.\n\nopen' })
        control.onYield = () => { void unmount(app) }
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        control.onYield = null
        mounted.length = 0
        expect(target.querySelector('[data-part="chat-stream-finished"]')).toBeNull()
        await vi.advanceTimersByTimeAsync(1000)
        target.remove()
    })

    test('text that arrives while a pass is suspended schedules exactly one follow-up for the latest text', async () => {
        vi.useFakeTimers()
        const { state, target } = open({ text: 'One.\n\nopen' })
        let passes = 0
        control.onYield = () => { passes++ }
        control.microYield = false
        await vi.advanceTimersByTimeAsync(110)
        state.text = 'One.\n\nopen a'
        flushSync()
        state.text = 'One.\n\nopen a b'
        flushSync()
        await vi.advanceTimersByTimeAsync(1500)
        await tickFake()
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).toContain('open a b')
        const settled = passes
        await vi.advanceTimersByTimeAsync(1500)
        expect(passes).toBe(settled)
    })

    test('cost bound: a 7.5k-char feed of 210-char paragraphs in 25-char chunks converts at most blocks + ticks', async () => {
        vi.useFakeTimers()
        const paragraph = (n: number) => `${('P' + n + ' ').padEnd(207, 'x')}.\n\n`
        const blocks = 36
        const full = Array.from({ length: blocks }, (_, n) => paragraph(n)).join('') + 'tail'
        expect(full.length).toBeGreaterThan(7500)
        const { state, target } = open({ text: '' })
        let fed = 0
        while (fed < full.length) {
            fed = Math.min(full.length, fed + 25)
            state.text = full.slice(0, fed)
            flushSync()
            await vi.advanceTimersByTimeAsync(50)
        }
        await vi.advanceTimersByTimeAsync(2000)
        await tickFake()
        // Every pass converts the open paragraph exactly once, so the open conversions count the ticks.
        const ticks = control.conversions.filter((source) => !source.endsWith('\n\n')).length
        expect(ticks).toBeGreaterThan(10)
        expect(finishedCount(target)).toBe(blocks)
        const finishedConversions = control.conversions.filter((source) => source.endsWith('\n\n'))
        expect(finishedConversions).toHaveLength(blocks)
        expect(new Set(finishedConversions).size).toBe(blocks)
        expect(control.conversions.length).toBeLessThanOrEqual(blocks + ticks)
    })
})

describe('StreamingView yields keep the output identical (MC-239)', () => {
    let reference: typeof import('../../ts/parser/parser.svelte')
    beforeAll(async () => { reference = await import('../../ts/parser/parser.svelte') })

    const text = 'Safe one.\n\n<img src=x onerror="alert(1)"> second\n\n- item\n- item two\n\nopen end'

    async function renderOnce(microYield: boolean) {
        vi.useFakeTimers()
        control.realSanitizer = true
        control.microYield = microYield
        const { target } = open({ text })
        await vi.advanceTimersByTimeAsync(400)
        await tickFake()
        const html = target.innerHTML
        await unmount(mounted.pop()!.app)
        target.remove()
        vi.useRealTimers()
        return html
    }

    function assertSanitized(html: string) {
        const element = document.createElement('div')
        element.innerHTML = html
        expect(element.querySelector('img')).not.toBeNull()
        expect(element.querySelector('img')?.hasAttribute('onerror')).toBe(false)
        expect(html).not.toContain('onerror')
    }

    test('macrotask yields and instant yields render the same sanitized markup', async () => {
        const instant = await renderOnce(true)
        const spaced = await renderOnce(false)
        expect(spaced).toBe(instant)
        assertSanitized(spaced)
    })

    test('an identity sanitizer makes the sanitized-markup assertion fail', async () => {
        control.identitySanitize = true
        const html = await renderOnce(true)
        expect(html).toContain('onerror')
        expect(() => assertSanitized(html)).toThrow()
    })
})
