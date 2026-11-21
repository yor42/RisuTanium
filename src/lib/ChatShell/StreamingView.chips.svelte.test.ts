// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return {
        ...original,
        createToSafeHtml: async () => async (source: string) => `<p>${source}</p>`,
    }
})
vi.mock('../../ts/chatShell/yieldToEventLoop', () => ({ yieldToEventLoop: async () => {} }))
vi.mock('../../lang', () => ({
    language: {
        chatShellThinking: (words: number) => `Thinking… ${words}`,
        chatShellFormatting: 'Formatting…',
        chatShellWritingCode: (lines: number) => `Writing code… ${lines} ${lines === 1 ? 'line' : 'lines'}`,
        chatShellWritingStyles: 'Writing styles…',
        chatShellImageLoading: 'Image loading',
    },
}))

import StreamingView from './StreamingView.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof StreamingView> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    vi.useRealTimers()
})

async function settle() {
    await vi.advanceTimersByTimeAsync(150)
    await tickFake()
}

async function show(text: string, host: HTMLElement = document.body) {
    const state = $state({ text })
    const target = document.createElement('div')
    host.appendChild(target)
    const app = mount(StreamingView, { target, props: state })
    mounted.push({ target, app })
    await settle()
    const grow = async (next: string) => {
        state.text = next
        flushSync()
        await settle()
    }
    return { target, grow }
}

const part = (target: HTMLElement, name: string) => target.querySelector<HTMLElement>(`[data-part="${name}"]`)
const follows = (target: HTMLElement, name: string) => {
    const open = part(target, 'chat-stream-open')!
    const chip = part(target, name)!
    return Boolean(open.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('StreamingView code chip and peek', () => {
    test('T-SV-3 an open fence shows a button chip with the line count; the peek holds the raw code as text', async () => {
        vi.useFakeTimers()
        const { target, grow } = await show('Intro\n\n```js\n<b>x</b>\nl2')
        const chip = part(target, 'chat-stream-code')!
        expect(chip.tagName).toBe('BUTTON')
        expect(chip.textContent).toBe('Writing code… 2 lines')
        expect(chip.getAttribute('aria-expanded')).toBe('false')
        expect(part(target, 'chat-stream-code-peek')).toBeNull()
        expect(follows(target, 'chat-stream-code')).toBe(true)
        chip.click()
        flushSync()
        expect(chip.getAttribute('aria-expanded')).toBe('true')
        const peek = part(target, 'chat-stream-code-peek')!
        expect(peek.tagName).toBe('PRE')
        expect(peek.textContent).toBe('<b>x</b>\nl2')
        expect(peek.querySelector('b')).toBeNull()
        expect(target.textContent).not.toContain('```')
        await grow('Intro\n\n```js\n<b>x</b>\nl2\nl3')
        expect(part(target, 'chat-stream-code')!.textContent).toBe('Writing code… 3 lines')
        expect(part(target, 'chat-stream-code-peek')!.textContent).toBe('<b>x</b>\nl2\nl3')
        chip.click()
        flushSync()
        expect(chip.getAttribute('aria-expanded')).toBe('false')
        expect(part(target, 'chat-stream-code-peek')).toBeNull()
    })

    test('a tilde fence and a tilde fence with an info string show the chip; a pending lone tilde line does not', async () => {
        vi.useFakeTimers()
        expect(part((await show('a\n\n~~~\nl1')).target, 'chat-stream-code')?.textContent).toBe('Writing code… 1 line')
        expect(part((await show('a\n\n~~~ts\nl1')).target, 'chat-stream-code')).not.toBeNull()
        expect(part((await show('a\n\n~~~')).target, 'chat-stream-code')).toBeNull()
    })

    test('closing the fence removes the chip and the peek, and the block renders through the normal pipeline', async () => {
        vi.useFakeTimers()
        const { target, grow } = await show('Intro\n\n```js\nl1')
        part(target, 'chat-stream-code')!.click()
        flushSync()
        await grow('Intro\n\n```js\nl1\n```\n\nafter')
        expect(part(target, 'chat-stream-code')).toBeNull()
        expect(part(target, 'chat-stream-code-peek')).toBeNull()
        expect(part(target, 'chat-stream-open')?.textContent).toContain('after')
        await grow('Intro\n\n```js\nl1\n```\n\nafter\n\n```\nl9')
        expect(part(target, 'chat-stream-code')!.getAttribute('aria-expanded')).toBe('false')
        expect(part(target, 'chat-stream-code-peek')).toBeNull()
    })

    test('T-SV-6 a focused code chip that unmounts hands focus to the enclosing message', async () => {
        vi.useFakeTimers()
        const article = document.createElement('article')
        article.setAttribute('data-part', 'chat-message')
        article.tabIndex = -1
        document.body.appendChild(article)
        const { target, grow } = await show('Intro\n\n```js\nl1', article)
        const chip = part(target, 'chat-stream-code')!
        chip.focus()
        expect(document.activeElement).toBe(chip)
        await grow('Intro\n\n```js\nl1\n```\n\nafter')
        expect(part(target, 'chat-stream-code')).toBeNull()
        expect(document.activeElement).toBe(article)
        article.remove()
    })
})

// jsdom has no layout, so the peek's metrics are stubbed on the element: scrollHeight 1000, clientHeight 100, and a scrollTop that stores what is set.
function stubMetrics(peek: HTMLElement) {
    let top = 0
    Object.defineProperty(peek, 'scrollHeight', { configurable: true, get: () => 1000 })
    Object.defineProperty(peek, 'clientHeight', { configurable: true, get: () => 100 })
    Object.defineProperty(peek, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
    return {
        top: () => top,
        userScroll: (value: number) => { top = value; peek.dispatchEvent(new Event('scroll')) },
    }
}

describe('StreamingView peek follows the newest line', () => {
    async function openPeek() {
        const view = await show('a\n\n```\nl1')
        part(view.target, 'chat-stream-code')!.click()
        flushSync()
        const peek = part(view.target, 'chat-stream-code-peek')!
        return { ...view, metrics: stubMetrics(peek) }
    }

    test('T-SV-9 growth moves the peek to the bottom', async () => {
        vi.useFakeTimers()
        const { grow, metrics } = await openPeek()
        expect(metrics.top()).toBe(0)
        await grow('a\n\n```\nl1\nl2')
        expect(metrics.top()).toBe(1000)
    })

    test('T-SV-10 after the user scrolls up, growth leaves the peek where it is', async () => {
        vi.useFakeTimers()
        const { grow, metrics } = await openPeek()
        metrics.userScroll(100)
        await grow('a\n\n```\nl1\nl2')
        expect(metrics.top()).toBe(100)
    })

    test('T-SV-11 back at the bottom, the peek follows again', async () => {
        vi.useFakeTimers()
        const { grow, metrics } = await openPeek()
        metrics.userScroll(100)
        await grow('a\n\n```\nl1\nl2')
        metrics.userScroll(900)
        await grow('a\n\n```\nl1\nl2\nl3')
        expect(metrics.top()).toBe(1000)
    })

    test('reopening the peek follows again, even after a scroll up', async () => {
        vi.useFakeTimers()
        const { target, grow, metrics } = await openPeek()
        metrics.userScroll(100)
        const chip = part(target, 'chat-stream-code')!
        chip.click()
        flushSync()
        chip.click()
        flushSync()
        const peek = part(target, 'chat-stream-code-peek')!
        const next = stubMetrics(peek)
        await grow('a\n\n```\nl1\nl2')
        expect(next.top()).toBe(1000)
    })

    // The peek's 40vh cap and the scroll-follow tolerance need layout; device/PC rows cover them.
})

describe('StreamingView styles chip', () => {
    test('T-SV-4 an open style tag and open tag-less CSS show the chip and no CSS; it goes after 40 lines', async () => {
        vi.useFakeTimers()
        const open = await show('a\n\n<style>p{color:red}')
        expect(part(open.target, 'chat-stream-styles')?.textContent).toBe('Writing styles…')
        expect(open.target.textContent).not.toContain('color:red')
        expect(follows(open.target, 'chat-stream-styles')).toBe(true)
        const bare = await show('p{color:red')
        expect(part(bare.target, 'chat-stream-styles')?.textContent).toBe('Writing styles…')
        await bare.grow('p{color:red\n' + 'x\n'.repeat(45))
        expect(part(bare.target, 'chat-stream-styles')).toBeNull()
    })
})

describe('StreamingView image skeleton', () => {
    test.each(['Look {{img::cat', 'Look {{inlay::cat', 'Look {{inlay', 'Look <img src="data:'])('T-SV-5 %s shows the skeleton and no raw form', async (text) => {
        vi.useFakeTimers()
        const { target } = await show(text)
        const skeleton = part(target, 'chat-stream-image')!
        expect(skeleton.getAttribute('role')).toBe('img')
        expect(skeleton.getAttribute('aria-label')).toBe('Image loading')
        expect(follows(target, 'chat-stream-image')).toBe(true)
        expect(target.textContent).not.toMatch(/\{\{|<img/)
    })

    test.each(['x {{user', 'x {{im', 'x <imgx'])('T-SV-5 %s shows no skeleton', async (text) => {
        vi.useFakeTimers()
        const { target } = await show(text)
        expect(part(target, 'chat-stream-image')).toBeNull()
    })

    test('T-SV-5b a growing {{img:: fragment keeps the skeleton past 64 characters, and the image shows once it closes', async () => {
        vi.useFakeTimers()
        const { target, grow } = await show('Look {{img::a')
        expect(part(target, 'chat-stream-image')).not.toBeNull()
        await grow('Look {{img::' + 'a'.repeat(200))
        expect(part(target, 'chat-stream-image')).not.toBeNull()
        expect(target.textContent).not.toContain('{{img::')
        await grow('Look {{img::' + 'a'.repeat(200) + '}} done')
        expect(part(target, 'chat-stream-image')).toBeNull()
        expect(part(target, 'chat-stream-open')?.textContent).toContain('{{img::')
    })

    test('a macro fragment past 64 characters still shows as text', async () => {
        vi.useFakeTimers()
        const { target } = await show('x {{user' + 'a'.repeat(70))
        expect(part(target, 'chat-stream-image')).toBeNull()
        expect(part(target, 'chat-stream-open')?.textContent).toContain('{{user')
    })
})

describe('StreamingView shows one chip', () => {
    test('with Thoughts open before a fence, only the thinking chip exists', async () => {
        vi.useFakeTimers()
        const { target } = await show('a <Thoughts>one two\n\n```js\nl1')
        expect(part(target, 'chat-stream-thinking')).not.toBeNull()
        expect(part(target, 'chat-stream-code')).toBeNull()
    })
})
