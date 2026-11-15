// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BLOCK_TAG_NAMES, normalizeQuery } from './inChatSearch'
import { MARK_CAP, MARK_TEXT_CAP, bodyRendered, buildMappedText, createHitAim, createHitMarks, locateInBody, locateOccurrences, waitForRendered, type HitAimOptions, type HitMarks, type LocateResult, type MarkOptions, type WalkOptions } from './hitMarks'

const walk: WalkOptions = { thinking: true, thoughtsLabel: 'Chain of Thoughts' }

function bodyOf(html: string): HTMLElement {
    const body = document.createElement('div')
    body.setAttribute('data-part', 'chat-message-body')
    body.innerHTML = html
    return body
}

function segmentTexts(result: LocateResult): string[][] {
    if (result.status !== 'located') return []
    return result.occurrences.map((occurrence) => occurrence.segments.map((segment) => segment.node.data.slice(segment.start, segment.end)))
}

describe('walk and map', () => {
    test('inline elements add no boundary and block elements add one space', () => {
        const mapped = buildMappedText(bodyOf('<p>one<x-em>two</x-em><font>three</font></p><p>four</p>'), walk)
        expect(mapped?.text.trim()).toBe('onetwothree four')
    })

    test('a break element and an empty block each count as one space', () => {
        expect(buildMappedText(bodyOf('a<br>b<hr>c'), walk)?.text.trim()).toBe('a b c')
        expect(buildMappedText(bodyOf('a<div></div>b'), walk)?.text.trim()).toBe('a b')
    })

    test('whitespace runs, including no-break spaces and edges, collapse to one space', () => {
        const mapped = buildMappedText(bodyOf('a  \n\t b<p> </p> c'), walk)
        expect(mapped?.text.trim()).toBe('a b c')
        expect(mapped?.text).not.toMatch(/ {2}/)
    })

    test('text longer than the cap is not mapped', () => {
        expect(buildMappedText(bodyOf('x'.repeat(MARK_TEXT_CAP + 1)), walk)).toBeNull()
        expect(buildMappedText(bodyOf('x'.repeat(MARK_TEXT_CAP)), walk)).not.toBeNull()
        expect(locateInBody(bodyOf('x'.repeat(MARK_TEXT_CAP + 1)), 'x', walk)).toEqual({ status: 'unlocated' })
    })

})

describe('H7 case, whitespace and normalisation limits', () => {
    test('a lower-casing that grows the text marks the whole source code point', () => {
        const body = bodyOf('Das İstanbul ist')
        expect(segmentTexts(locateInBody(body, normalizeQuery('İstanbul'), walk))).toEqual([['İstanbul']])
        expect(segmentTexts(locateInBody(body, normalizeQuery('stanbul'), walk))).toEqual([['stanbul']])
    })

    test('a run of no-break spaces matches one space and the segment covers the run once', () => {
        const body = bodyOf('go   home')
        expect(segmentTexts(locateInBody(body, normalizeQuery('go home'), walk))).toEqual([['go   home']])
    })

    test('astral characters keep both code units in the span', () => {
        const body = bodyOf('x 😀 y')
        expect(segmentTexts(locateInBody(body, normalizeQuery('😀'), walk))).toEqual([['😀']])
    })

    test('a final sigma and a decomposed letter are not found, which falls to the outline', () => {
        expect(locateInBody(bodyOf('ΟΔΟΣ'), normalizeQuery('ΟΔΟΣ'), walk)).toEqual({ status: 'unlocated' })
        expect(locateInBody(bodyOf('café'), normalizeQuery('café'), walk)).toEqual({ status: 'unlocated' })
    })
})

describe('H8 skip zones', () => {
    test('text in svg, math, textarea, select, style and script is never located', () => {
        const body = bodyOf('<svg><text>lantern</text></svg><math><mi>lantern</mi></math><textarea>lantern</textarea>'
            + '<select><option>lantern</option></select><style>.lantern{}</style><script>lantern</script><p>one lantern</p>')
        const result = locateInBody(body, 'lantern', walk)
        expect(segmentTexts(result)).toEqual([['lantern']])
        if (result.status !== 'located') throw new Error('unlocated')
        expect(result.occurrences[0].segments[0].node.data).toBe('one lantern')
    })

    test('a skip zone separates words like a boundary', () => {
        const body = bodyOf('ab<svg><text>zz</text></svg>cd')
        expect(buildMappedText(body, walk)?.text).toBe('ab cd')
        expect(locateInBody(body, 'abcd', walk)).toEqual({ status: 'unlocated' })
    })
})

describe('locate', () => {
    test('occurrences do not overlap and are capped in reading order', () => {
        const mapped = buildMappedText(bodyOf('aaaa'), walk)
        if (mapped === null) throw new Error('unmapped')
        expect(locateOccurrences(mapped, 'aa')).toHaveLength(2)
        const many = buildMappedText(bodyOf('x '.repeat(MARK_CAP + 50)), walk)
        if (many === null) throw new Error('unmapped')
        expect(locateOccurrences(many, 'x')).toHaveLength(MARK_CAP)
    })

    test('an empty query locates nothing', () => {
        expect(locateInBody(bodyOf('text'), '', walk)).toEqual({ status: 'unlocated' })
    })
})

describe('Thoughts blocks', () => {
    const html = '<details><summary>Chain of Thoughts</summary>secret</details><details><summary>Other</summary>secret</details>'

    test('the label is never walked, an author details is, and thinking off skips only the Thoughts block', () => {
        expect(locateInBody(bodyOf(html), 'chain of thoughts', walk)).toEqual({ status: 'unlocated' })
        expect(segmentTexts(locateInBody(bodyOf(html), 'secret', walk))).toEqual([['secret'], ['secret']])
        expect(segmentTexts(locateInBody(bodyOf(html), 'secret', { ...walk, thinking: false }))).toEqual([['secret']])
    })
})

describe('H19 block names shared with the engine', () => {
    test('the set holds the expanded headings and the break element and matches the engine list', () => {
        for (const name of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'p', 'li', 'details', 'summary']) expect(BLOCK_TAG_NAMES.has(name)).toBe(true)
        expect(BLOCK_TAG_NAMES.has('h[1-6]')).toBe(false)
        for (const name of ['span', 'em', 'a', 'x-em', 'font']) expect(BLOCK_TAG_NAMES.has(name)).toBe(false)
    })
})

// A list shaped like the shell's: rows are keyed containers, each holding an article with a body.
interface ListFixture {
    list: HTMLElement
    container: HTMLElement
    body: HTMLElement
    article: HTMLElement
}

let mounted: HTMLElement[] = []
afterEach(() => {
    for (const element of mounted) element.remove()
    mounted = []
    vi.useRealTimers()
})

function rowHtml(html: string): string {
    return `<article><div data-part="chat-message-body">${html}</div></article>`
}

function listOf(html: string, siblings = 3): ListFixture {
    const list = document.createElement('div')
    list.setAttribute('data-part', 'chat-message-list')
    for (let index = 0; index < siblings; index++) list.append(rowContainer('<p>other row</p>'))
    const container = rowContainer(html)
    list.insertBefore(container, list.children[1] ?? null)
    document.body.append(list)
    mounted.push(list)
    return {
        list,
        container,
        article: container.querySelector('article') as HTMLElement,
        body: container.querySelector('[data-part="chat-message-body"]') as HTMLElement,
    }
}

function rowContainer(html: string): HTMLElement {
    const container = document.createElement('div')
    container.setAttribute('data-part', 'chat-message-container')
    container.innerHTML = rowHtml(html)
    return container
}

function textNodesOf(root: Node): Text[] {
    const found: Text[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) found.push(node as Text)
    return found
}

// The observer callback runs as a microtask after the writes; a timer turn lets every queued one settle.
function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

function markTexts(root: Element): string[] {
    return Array.from(root.querySelectorAll('mark.search-mark')).map((mark) => mark.textContent ?? '')
}

function newLayer(viewportTop: number | null = null) {
    return createHitMarks({ viewportTop: () => viewportTop })
}

function options(query: string, extra: Partial<MarkOptions> = {}): MarkOptions {
    return { query, thinking: true, thoughtsLabel: 'Chain of Thoughts', onLost: () => {}, ...extra }
}

describe('H9 apply and clear', () => {
    test('marks keep every original node and clear restores the markup and the Text nodes', () => {
        const { body } = listOf('<p>say a <b>bold</b> word, then a bold word again</p><p>tail</p>')
        const before = body.innerHTML
        const originals = textNodesOf(body).map((node) => ({ node, data: node.data }))
        const marks = newLayer()
        for (let cycle = 0; cycle < 3; cycle++) {
            const anchor = marks.mark(marks.token(), body, options('a bold word'))
            expect(anchor).not.toBeNull()
            expect(anchor?.matches('mark.search-mark')).toBe(true)
            expect(markTexts(body)).toEqual(['a ', 'bold', ' word', 'a bold word'])
            for (const { node } of originals) expect(node.isConnected).toBe(true)
            marks.clear({ jumping: true })
            expect(body.innerHTML).toBe(before)
            for (const { node, data } of originals) {
                expect(node.isConnected).toBe(true)
                expect(node.data).toBe(data)
            }
            expect(textNodesOf(body)).toEqual(originals.map((entry) => entry.node))
        }
    })

    test('marks are built from text, never from markup', () => {
        const { body } = listOf('<p>a &lt;img src=x onerror=boom&gt; b</p>')
        const marks = newLayer()
        marks.mark(marks.token(), body, options('<img'))
        expect(body.querySelector('img')).toBeNull()
        expect(markTexts(body)).toEqual(['<img'])
    })

    test('clear on a detached body and clear without marks do not throw', () => {
        const { list, body } = listOf('<p>one lantern</p>')
        const marks = newLayer()
        marks.clear({ jumping: false })
        marks.mark(marks.token(), body, options('lantern'))
        list.remove()
        expect(() => marks.clear({ jumping: false })).not.toThrow()
        expect(body.textContent).toBe('one lantern')
    })

    test('marking again replaces the earlier marks', () => {
        const { body } = listOf('<p>lantern and candle</p>')
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern'))
        marks.mark(marks.token(), body, options('candle'))
        expect(markTexts(body)).toEqual(['candle'])
        marks.clear({ jumping: true })
        expect(body.innerHTML).toBe('<p>lantern and candle</p>')
    })
})

describe('H10 external changes', () => {
    test('a re-render of the body runs onLost once and leaves no created node', async () => {
        const { body } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        body.innerHTML = '<p>rewritten lantern</p>'
        await settle()
        expect(onLost).toHaveBeenCalledTimes(1)
        expect(body.querySelectorAll('mark')).toHaveLength(0)
        expect(body.textContent).toBe('rewritten lantern')
        marks.clear({ jumping: true })
        expect(onLost).toHaveBeenCalledTimes(1)
    })

    test('a block restored from its marked markup has its copied marks unwrapped', async () => {
        const { body } = listOf('<p>one lantern here</p><p>second</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        const block = body.querySelector('p') as HTMLElement
        block.innerHTML = block.innerHTML
        expect(block.querySelectorAll('mark.search-mark')).toHaveLength(1)
        await settle()
        expect(onLost).toHaveBeenCalledTimes(1)
        expect(body.querySelectorAll('mark')).toHaveLength(0)
        expect(body.textContent).toBe('one lantern heresecond')
    })

    test('a change inside the body by a later writer is lost marks, never an exception', async () => {
        const { body } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        body.append(document.createElement('hr'))
        await settle()
        expect(onLost).toHaveBeenCalledTimes(1)
        expect(body.querySelectorAll('mark')).toHaveLength(0)
    })

    test('attribute changes are not content and keep the marks', async () => {
        const { body, container } = listOf('<p>one lantern</p><details><summary>s</summary>lantern</details>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        container.style.contentVisibility = 'auto'
        container.classList.add('older')
        body.querySelector('p')?.setAttribute('style', 'color: red')
        body.querySelector('details')?.toggleAttribute('open')
        await settle()
        expect(onLost).not.toHaveBeenCalled()
        expect(markTexts(body)).toEqual(['lantern', 'lantern'])
    })
})

describe('H12 and H21 row churn', () => {
    test('H12 the row container leaving the list runs onLost once', async () => {
        const { container, body, list } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        container.remove()
        await settle()
        expect(onLost).toHaveBeenCalledTimes(1)
        expect(body.querySelectorAll('mark')).toHaveLength(0)
        expect(list.querySelectorAll('mark')).toHaveLength(0)
        marks.clear({ jumping: true })
        expect(onLost).toHaveBeenCalledTimes(1)
    })

    function appended(list: HTMLElement, count: number, where: 'append' | 'prepend'): void {
        for (let index = 0; index < count; index++) {
            if (where === 'append') list.append(rowContainer('<p>new row</p>'))
            else list.prepend(rowContainer('<p>old row</p>'))
        }
    }

    test('H21a rows appended after the hit row keep the marks', async () => {
        const { list, body } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        appended(list, 20, 'append')
        await settle()
        expect(markTexts(body)).toEqual(['lantern'])
        expect(onLost).not.toHaveBeenCalled()
    })

    test('H21b rows prepended before the hit row keep the marks', async () => {
        const { list, body } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        appended(list, 20, 'prepend')
        await settle()
        expect(markTexts(body)).toEqual(['lantern'])
        expect(onLost).not.toHaveBeenCalled()
    })

    test('H21c removing an unrelated row keeps the marks', async () => {
        const { list, body } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        list.lastElementChild?.remove()
        await settle()
        expect(markTexts(body)).toEqual(['lantern'])
        expect(onLost).not.toHaveBeenCalled()
    })

    test('H21e a hit inside the first-message row is lost when that row leaves and kept through sibling churn', async () => {
        const { list, container, body } = listOf('<p>one lantern</p>')
        container.setAttribute('data-part', 'chat-first-message')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        list.append(rowContainer('<p>new row</p>'))
        list.lastElementChild?.remove()
        await settle()
        expect(markTexts(body)).toEqual(['lantern'])
        expect(onLost).not.toHaveBeenCalled()
        container.remove()
        await settle()
        expect(onLost).toHaveBeenCalledTimes(1)
        expect(body.querySelectorAll('mark')).toHaveLength(0)
    })

    test('H21d a keyed move of the hit row within one task keeps the marks', async () => {
        const { list, container, body } = listOf('<p>one lantern</p>')
        const onLost = vi.fn()
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern', { onLost }))
        list.insertBefore(container, list.firstChild)
        expect(list.firstChild).toBe(container)
        await settle()
        expect(markTexts(body)).toEqual(['lantern'])
        expect(onLost).not.toHaveBeenCalled()
    })
})

describe('H13 hidden occurrences', () => {
    test('the anchor is the first occurrence that is not hidden by style; all occurrences are marked', () => {
        const { body } = listOf('<p style="display: none">first lantern</p><p>second lantern</p><p style="visibility: hidden">third lantern</p>')
        const marks = newLayer()
        const anchor = marks.mark(marks.token(), body, options('lantern'))
        expect(anchor?.closest('p')?.textContent).toBe('second lantern')
        expect(markTexts(body)).toHaveLength(3)
    })

    test('when every occurrence is hidden nothing is marked and the DOM is unchanged', () => {
        const { body } = listOf('<p style="display: none">first lantern</p><div style="display: none"><p>second lantern</p></div>')
        const before = body.innerHTML
        const marks = newLayer()
        expect(marks.mark(marks.token(), body, options('lantern'))).toBeNull()
        expect(body.innerHTML).toBe(before)
    })
})

describe('H14 cap', () => {
    test('250 occurrences give 200 marks, the first in reading order', () => {
        const { body } = listOf(`<p>${'x '.repeat(250)}</p>`)
        const marks = newLayer()
        marks.mark(marks.token(), body, options('x'))
        expect(body.querySelectorAll('mark.search-mark')).toHaveLength(MARK_CAP)
        marks.clear({ jumping: true })
        expect(body.querySelectorAll('mark')).toHaveLength(0)
    })
})

describe('H15 token', () => {
    test('a mark carrying the token of a cleared hit creates nothing', () => {
        const { body } = listOf('<p>one lantern</p>')
        const marks = newLayer()
        const stale = marks.token()
        marks.clear({ jumping: true })
        expect(marks.token()).not.toBe(stale)
        expect(marks.mark(stale, body, options('lantern'))).toBeNull()
        expect(body.querySelectorAll('mark')).toHaveLength(0)
        expect(marks.mark(marks.token(), body, options('lantern'))).not.toBeNull()
    })
})

describe('H16 waitForRendered and bodyRendered', () => {
    test('bodyRendered rejects an empty body and the loading indicators', () => {
        const body = document.createElement('div')
        expect(bodyRendered(body)).toBe(false)
        body.innerHTML = '<span role="status">...</span>'
        expect(bodyRendered(body)).toBe(false)
        body.innerHTML = '<div style="animation: spin 1s"></div>'
        expect(bodyRendered(body)).toBe(false)
        body.innerHTML = '<p>text</p>'
        expect(bodyRendered(body)).toBe(true)
    })

    test('an indicator then content resolves true; no content resolves false at the timeout', async () => {
        vi.useFakeTimers()
        const body = document.createElement('div')
        body.innerHTML = '<span role="status">...</span>'
        let result: boolean | null = null
        const waiting = waitForRendered(body, 1000).then((value) => { result = value })
        body.innerHTML = '<span role="status">still</span>'
        await vi.advanceTimersByTimeAsync(500)
        expect(result).toBeNull()
        body.innerHTML = '<p>done</p>'
        await waiting
        expect(result).toBe(true)

        const empty = document.createElement('div')
        let timedOut: boolean | null = null
        const never = waitForRendered(empty, 1000).then((value) => { timedOut = value })
        await vi.advanceTimersByTimeAsync(999)
        expect(timedOut).toBeNull()
        await vi.advanceTimersByTimeAsync(1)
        await never
        expect(timedOut).toBe(false)
    })

    test('a rendered body resolves true at once', async () => {
        const body = document.createElement('div')
        body.textContent = 'ready'
        await expect(waitForRendered(body, 1000)).resolves.toBe(true)
    })
})

describe('details opening and closing', () => {
    const thoughts = '<p>visible</p><details><summary>Chain of Thoughts</summary>the hidden lantern</details>'

    test('a Thoughts block holding the anchor opens and a step closes it', () => {
        const { body } = listOf(thoughts)
        const details = body.querySelector('details') as HTMLDetailsElement
        const marks = newLayer()
        const anchor = marks.mark(marks.token(), body, options('lantern'))
        expect(anchor?.closest('details')).toBe(details)
        expect(details.open).toBe(true)
        marks.clear({ jumping: true })
        expect(details.open).toBe(false)
    })

    test('an author details opens the same way and one the reader had open is left alone', () => {
        const { body } = listOf('<details><summary>Note</summary>a lantern</details><details open><summary>Other</summary>no</details>')
        const [author, other] = Array.from(body.querySelectorAll('details'))
        const marks = newLayer()
        marks.mark(marks.token(), body, options('lantern'))
        expect(author.open).toBe(true)
        marks.clear({ jumping: true })
        expect(author.open).toBe(false)
        expect(other.open).toBe(true)
    })

    test('only the details holding the anchor opens; a match in a summary opens nothing', () => {
        const { body } = listOf('<details><summary>lantern title</summary>text</details><details><summary>b</summary>lantern</details>')
        const [first, second] = Array.from(body.querySelectorAll('details'))
        const marks = newLayer()
        const anchor = marks.mark(marks.token(), body, options('lantern'))
        expect(anchor?.closest('details')).toBe(first)
        expect(first.open).toBe(false)
        expect(second.open).toBe(false)
    })

    test('with thinking off a Thoughts block is neither marked nor opened', () => {
        const { body } = listOf(thoughts)
        const marks = newLayer()
        expect(marks.mark(marks.token(), body, options('lantern', { thinking: false }))).toBeNull()
        expect((body.querySelector('details') as HTMLDetailsElement).open).toBe(false)
    })

    test('a block opened by a step is closed; at search end it stays open only when its top is above the visible top', () => {
        for (const [top, expectedOpen] of [[-300, true], [40, false]] as const) {
            const { body } = listOf(thoughts)
            const details = body.querySelector('details') as HTMLDetailsElement
            details.getBoundingClientRect = () => ({ top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) })
            const marks = newLayer(0)
            marks.mark(marks.token(), body, options('lantern'))
            marks.clear({ jumping: false })
            expect(details.open).toBe(expectedOpen)
        }
        const { body } = listOf(thoughts)
        const details = body.querySelector('details') as HTMLDetailsElement
        details.getBoundingClientRect = () => ({ top: -300, bottom: -280, left: 0, right: 0, width: 0, height: 20, x: 0, y: -300, toJSON: () => ({}) })
        const marks = newLayer(0)
        marks.mark(marks.token(), body, options('lantern'))
        marks.clear({ jumping: true })
        expect(details.open).toBe(false)
    })
})

describe('createHitAim', () => {
    function article(html: string, attributes: Record<string, string> = {}): HTMLElement {
        const { article: element } = listOf(html)
        for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
        return element
    }

    function aimOf(marks: HitMarks, extra: Partial<HitAimOptions> = {}) {
        const onOutline = vi.fn()
        const onLost = vi.fn()
        const aim = createHitAim({ marks, token: marks.token(), query: 'lantern', thinking: true, thoughtsLabel: 'Chain of Thoughts', waitMs: 50, onOutline, onLost, ...extra })
        return { aim, onOutline, onLost }
    }

    test('a rendered body is marked and the anchor is returned without an outline', async () => {
        const target = article('<p>one lantern</p>')
        const marks = newLayer()
        const { aim, onOutline } = aimOf(marks)
        const anchor = await aim(target)
        expect(anchor?.matches('mark.search-mark')).toBe(true)
        expect(onOutline).not.toHaveBeenCalled()
    })

    test('a streaming article, an unlocated hit and a body that never renders show the outline', async () => {
        const marks = newLayer()
        const streaming = aimOf(marks)
        expect(await streaming.aim(article('<p>one lantern</p>', { 'data-streaming': '' }))).toBeNull()
        expect(streaming.onOutline).toHaveBeenCalledTimes(1)
        const missing = aimOf(marks)
        expect(await missing.aim(article('<p>no match</p>'))).toBeNull()
        expect(missing.onOutline).toHaveBeenCalledTimes(1)
        const empty = aimOf(marks)
        expect(await empty.aim(article(''))).toBeNull()
        expect(empty.onOutline).toHaveBeenCalledTimes(1)
    })

    test('a body that renders during the wait is marked', async () => {
        const target = article('')
        const body = target.querySelector('[data-part="chat-message-body"]') as HTMLElement
        const marks = newLayer()
        const { aim, onOutline } = aimOf(marks, { waitMs: 1000 })
        const pending = aim(target)
        body.innerHTML = '<p>late lantern</p>'
        expect((await pending)?.matches('mark.search-mark')).toBe(true)
        expect(onOutline).not.toHaveBeenCalled()
    })

    test('an aim whose hit was replaced marks nothing and shows no outline', async () => {
        const target = article('')
        const body = target.querySelector('[data-part="chat-message-body"]') as HTMLElement
        const marks = newLayer()
        const { aim, onOutline } = aimOf(marks, { waitMs: 1000 })
        const pending = aim(target)
        marks.clear({ jumping: true })
        body.innerHTML = '<p>late lantern</p>'
        expect(await pending).toBeNull()
        expect(body.querySelectorAll('mark')).toHaveLength(0)
        expect(onOutline).not.toHaveBeenCalled()
    })

    test('a failure inside the aim is reported and falls back to the outline without throwing', async () => {
        const target = article('<p>one lantern</p>')
        const marks = newLayer()
        const failing: HitMarks = { ...marks, mark: () => { throw new Error('boom') } }
        const onError = vi.fn()
        const { aim, onOutline } = aimOf(failing, { onError })
        expect(await aim(target)).toBeNull()
        expect(onError).toHaveBeenCalledTimes(1)
        expect(onOutline).toHaveBeenCalledTimes(1)
    })

    test('marks the aim placed that are later lost call onLost', async () => {
        const target = article('<p>one lantern</p>')
        const { onLost, aim } = aimOf(newLayer())
        await aim(target)
        target.querySelector('[data-part="chat-message-body"]')!.innerHTML = '<p>other</p>'
        await settle()
        expect(onLost).toHaveBeenCalledTimes(1)
    })
})
