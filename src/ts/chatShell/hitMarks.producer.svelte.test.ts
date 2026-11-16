// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { COLD_TRANSFORM_HOOK_MS } from '../tests/coldTransform.test-helpers'

const mutant = vi.hoisted(() => ({ identitySanitize: false }))

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
    aiWatermarkingLawApplies: () => false,
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

// The factory is run for real; only the identity mutant wraps the real sanitizer.
vi.mock('../parser/parser.svelte', async (importOriginal) => {
    const original = await importOriginal<typeof import('../parser/parser.svelte')>()
    return {
        ...original,
        trimMarkdown: (html: string) => mutant.identitySanitize ? html : original.trimMarkdown(html),
    }
})

vi.mock('../process/scripts', () => ({
    risuChatParser: (text: string) => text.replace('{{user}}', 'Ari'),
}))

import { language } from 'src/lang'
import { normalizeQuery } from './inChatSearch'
import { findAllOriginalRangesFromHtml } from '../parser/partialEdit'
import { createHitMarks, locateInBody, type LocateResult, type WalkOptions } from './hitMarks'

let parser: typeof import('../parser/parser.svelte')
beforeAll(async () => { parser = await import('../parser/parser.svelte') }, COLD_TRANSFORM_HOOK_MS)
afterEach(() => { mutant.identitySanitize = false })

const walk: WalkOptions = { thinking: true, thoughtsLabel: language.cot }

// Built like ChatBody: the display text, the real markdown render, the sanitizer, then the metadata step, set as the body's markup.
async function bodyOf(stored: string): Promise<HTMLElement> {
    const display = stored.replace('{{user}}', 'Ari')
    const rendered = await parser.ParseMarkdown(display, null, 'notrim')
    const body = document.createElement('div')
    body.setAttribute('data-part', 'chat-message-body')
    body.innerHTML = parser.addMetadataToElement(parser.trimMarkdown(rendered), 'model')
    return body
}

function segmentTexts(result: LocateResult): string[][] {
    if (result.status !== 'located') return []
    return result.occurrences.map((occurrence) => occurrence.segments.map((segment) => segment.node.data.slice(segment.start, segment.end)))
}

describe('hit locating against the real producer', () => {
    test('H1 a match across bold, italic, strike and code gives one segment per Text node, in order', async () => {
        const body = await bodyOf('a **bold** word and *it* then ~~gone~~ and `code` end')
        expect(segmentTexts(locateInBody(body, normalizeQuery('a bold word'), walk))).toEqual([['a ', 'bold', ' word']])
        expect(segmentTexts(locateInBody(body, normalizeQuery('it then gone'), walk))).toEqual([['it', ' then ', 'gone']])
        expect(segmentTexts(locateInBody(body, normalizeQuery('and code end'), walk))).toEqual([['and ', 'code', ' end']])
    })

    test('H2 every occurrence is found, the first in reading order first', async () => {
        const body = await bodyOf('The lantern burns.\n\nA second lantern waits, and a third Lantern.')
        const result = locateInBody(body, normalizeQuery('lantern'), walk)
        expect(segmentTexts(result)).toEqual([['lantern'], ['lantern'], ['Lantern']])
        if (result.status !== 'located') throw new Error('unlocated')
        expect(result.occurrences[0].segments[0].node.data).toContain('The lantern')
    })

    test('H3 a line break and a paragraph break each count as one space and are never marked', async () => {
        const body = await bodyOf('first line\nsecond line\n\nthird paragraph')
        expect(segmentTexts(locateInBody(body, normalizeQuery('first line second line'), walk))).toEqual([['first line', 'second line']])
        expect(segmentTexts(locateInBody(body, normalizeQuery('second line third paragraph'), walk))).toEqual([['second line', 'third paragraph']])
        for (const piece of segmentTexts(locateInBody(body, normalizeQuery('line third'), walk)).flat()) expect(piece).not.toMatch(/^\s|\s$/)
    })

    test('H4 an escaped tag is found as literal text and no element is created', async () => {
        const body = await bodyOf('use the &lt;div&gt; tag here')
        const before = body.innerHTML
        expect(segmentTexts(locateInBody(body, normalizeQuery('&lt;div&gt;'), walk))).toEqual([['<div>']])
        expect(body.innerHTML).toBe(before)
        expect(body.querySelector('div')).toBeNull()
    })

    test('H5 text the engine matches but the display no longer holds is unlocated and the DOM is unchanged', async () => {
        const star = await bodyOf('so 2 * 3 = 6 holds')
        const starBefore = star.innerHTML
        expect(locateInBody(star, normalizeQuery('2 * 3'), walk)).toEqual({ status: 'unlocated' })
        expect(star.innerHTML).toBe(starBefore)
        const macro = await bodyOf('Hi {{user}}')
        const macroBefore = macro.innerHTML
        expect(locateInBody(macro, normalizeQuery('{{user}}'), walk)).toEqual({ status: 'unlocated' })
        expect(macro.innerHTML).toBe(macroBefore)
    })

    test('H6 the Thoughts summary label is never matched and the block follows the thinking option', async () => {
        const body = await bodyOf('<Thoughts>secret lantern</Thoughts>visible lantern')
        expect(body.querySelector('details > summary')?.textContent).toBe(language.cot)
        expect(locateInBody(body, normalizeQuery(language.cot), walk)).toEqual({ status: 'unlocated' })
        expect(segmentTexts(locateInBody(body, normalizeQuery('lantern'), walk))).toEqual([['lantern'], ['lantern']])
        expect(segmentTexts(locateInBody(body, normalizeQuery('lantern'), { ...walk, thinking: false }))).toEqual([['lantern']])
        expect(locateInBody(body, normalizeQuery('secret'), { ...walk, thinking: false })).toEqual({ status: 'unlocated' })
    })
})

describe('hostile markup (MC-239)', () => {
    const hostile = '<img src=x onerror="alert(1)"> <a title="lantern" href="javascript:alert(1)">lantern</a> lantern'

    // The guard the sanitizer wiring must satisfy; the body is only read here, so it must hold before and after locating.
    async function assertSanitized(body: HTMLElement): Promise<void> {
        expect(body.querySelector('img')).not.toBeNull()
        for (const element of Array.from(body.querySelectorAll('*'))) {
            for (const attribute of Array.from(element.attributes)) {
                expect(attribute.name.startsWith('on')).toBe(false)
                expect(attribute.value.toLowerCase()).not.toContain('javascript:')
            }
        }
        expect(body.querySelector('a')?.getAttribute('title')).toBe('lantern')
    }

    test('H17 two matches are located, the attribute text is untouched and nothing hostile survives', async () => {
        const body = await bodyOf(hostile)
        await assertSanitized(body)
        const before = body.innerHTML
        expect(segmentTexts(locateInBody(body, normalizeQuery('lantern'), walk))).toEqual([['lantern'], ['lantern']])
        expect(body.innerHTML).toBe(before)
        await assertSanitized(body)
    })

    test('H18 with an identity sanitizer the H17 guard rejects', async () => {
        mutant.identitySanitize = true
        const body = await bodyOf(hostile)
        await expect(assertSanitized(body)).rejects.toThrow()
    })
})

describe('H20 partial edit over marked text', () => {
    test('the ranges found for a marked block equal those of the unmarked clone', async () => {
        const markdown = 'The lantern burns.\n\nA second **lantern** waits, and a third Lantern.'
        const body = await bodyOf(markdown)
        const block = body.querySelector('p:nth-of-type(2)') as HTMLElement
        const clone = block.cloneNode(true) as HTMLElement
        const marks = createHitMarks({ viewportTop: () => null })
        expect(marks.mark(marks.token(), body, { query: 'lantern', thinking: true, thoughtsLabel: language.cot, onLost: () => {} })).not.toBeNull()
        expect(block.querySelectorAll('mark.search-mark').length).toBeGreaterThan(0)
        const marked = findAllOriginalRangesFromHtml(markdown, block)
        expect(marked.length).toBeGreaterThan(0)
        expect(marked).toEqual(findAllOriginalRangesFromHtml(markdown, clone))
        marks.clear({ jumping: true })
    })
})