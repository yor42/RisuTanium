// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import HtmlRangeHost from '../../lib/ChatShell/tests/HtmlRangeHost.svelte'
import { createHitMarks, type MarkOptions } from './hitMarks'

interface HostProps {
    mode: 'html' | 'text'
    html: string
    text: string
    pending: boolean
}

let cleanup: (() => void)[] = []
afterEach(() => {
    for (const run of cleanup) run()
    cleanup = []
})

function host(initial: Partial<HostProps>) {
    const props: HostProps = $state({ mode: 'html', html: '', text: '', pending: false, ...initial })
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(HtmlRangeHost, { target, props })
    flushSync()
    cleanup.push(() => { void unmount(instance); target.remove() })
    return { props, body: target.querySelector('[data-part="chat-message-body"]') as HTMLElement }
}

function options(query: string, onLost: () => void): MarkOptions {
    return { query, thinking: true, thoughtsLabel: 'Chain of Thoughts', onLost }
}

// Svelte's own anchor comments are not content.
function contentOf(body: HTMLElement): string {
    return body.innerHTML.replaceAll('<!---->', '')
}

async function update(change: () => void): Promise<void> {
    change()
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('H11 an {@html} update under marks', () => {
    test('marking the range\'s last top-level Text node and then updating leaves exactly the new content', async () => {
        const { props, body } = host({ html: '<p>first</p>closing lantern text' })
        const onLost = vi.fn()
        const marks = createHitMarks({ viewportTop: () => null })
        expect(marks.mark(marks.token(), body, options('lantern', onLost))).not.toBeNull()
        expect(body.querySelectorAll('mark.search-mark')).toHaveLength(1)
        await update(() => { props.html = '<p>second</p>fresh ending' })
        expect(contentOf(body)).toBe('<p>second</p>fresh ending')
        expect(onLost).toHaveBeenCalledTimes(1)
        marks.clear({ jumping: true })
        expect(contentOf(body)).toBe('<p>second</p>fresh ending')
    })

    test('marking the first top-level Text node of the range and then updating leaves exactly the new content', async () => {
        const { props, body } = host({ html: 'opening lantern text<p>rest</p>' })
        const onLost = vi.fn()
        const marks = createHitMarks({ viewportTop: () => null })
        marks.mark(marks.token(), body, options('lantern', onLost))
        await update(() => { props.html = '<p>other</p>' })
        expect(contentOf(body)).toBe('<p>other</p>')
        expect(onLost).toHaveBeenCalledTimes(1)
    })
})

describe('H22 a Svelte-owned text node', () => {
    test('an update after marking runs onLost once and the text is the new value with no duplicated piece', async () => {
        const { props, body } = host({ mode: 'text', text: 'the lantern is lit' })
        const onLost = vi.fn()
        const marks = createHitMarks({ viewportTop: () => null })
        expect(marks.mark(marks.token(), body, options('lantern', onLost))).not.toBeNull()
        expect(body.textContent).toBe('the lantern is lit')
        await update(() => { props.text = 'a new lantern appears' })
        expect(onLost).toHaveBeenCalledTimes(1)
        expect(body.textContent).toBe('a new lantern appears')
        expect(body.querySelectorAll('mark')).toHaveLength(0)
        marks.clear({ jumping: true })
        expect(body.textContent).toBe('a new lantern appears')
    })

    test('with no update, clear restores the original text', () => {
        const { body } = host({ mode: 'text', text: 'the lantern is lit' })
        const marks = createHitMarks({ viewportTop: () => null })
        marks.mark(marks.token(), body, options('lantern', () => {}))
        marks.clear({ jumping: true })
        expect(body.textContent).toBe('the lantern is lit')
    })
})
