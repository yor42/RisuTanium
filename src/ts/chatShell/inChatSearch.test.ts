import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Message } from '../storage/database.svelte'
import {
    SCAN_BUDGET_MS, SCAN_SLICE_MAX, SCAN_SLICE_MAX_LOW_POWER, createSearchCache, createSearchScan, dayBoundsOf, displayText, hasImageContent, isHiddenAt,
    matchesQuery, normalizeForSearch, normalizeQuery, passesFilters, promptResetIndex, sliceMaxFor,
    type SearchFilters, type SearchHit,
} from './inChatSearch'

// Messages are written as the model and the editor store them: raw markdown and HTML.
function msg(data: string, extra: Partial<Message> = {}): Message {
    return { role: 'char', data, ...extra }
}

// The prompt split's hidden set, written out the way cbs.ts walks the chat: newest to oldest, a true flag hides one message, the
// latest allBefore hides itself and everything before it. cbs.ts pulls in the whole parser graph, so the test mirrors it.
function promptSplitHidden(messages: Message[]): ReadonlySet<Message> {
    const hidden = new Set<Message>()
    let resetAt = -1
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].disabled === true) {
            hidden.add(messages[i])
            continue
        }
        if (messages[i].disabled === 'allBefore') {
            resetAt = i
            break
        }
    }
    for (let i = 0; i <= resetAt; i++) hidden.add(messages[i])
    return hidden
}

const OFF = { thinking: false }
const ON = { thinking: true }
const norm = (text: string) => normalizeForSearch(text, OFF)

describe('B1-1 normaliser, in step order', () => {
    test('(a) closed Thoughts blocks are dropped when thinking is off and kept when on', () => {
        expect(normalizeForSearch('x<Thoughts>secret</Thoughts>y', OFF)).toBe('x y')
        expect(normalizeForSearch('x<Thoughts>secret</Thoughts>y', ON)).toBe('x secret y')
    })
    test('(b) style blocks are removed', () => {
        expect(norm('<style>p { color: red }</style>hello')).toBe('hello')
        expect(norm('a<STYLE type="x">\n.b{}\n</STYLE>b')).toBe('a b')
    })
    test('(c) asset and inlay macros are removed, every other macro stays', () => {
        expect(norm('{{img::portrait}} hi')).toBe('hi')
        expect(norm('a {{inlay::abc123}} b')).toBe('a b')
        expect(norm('a {{inlayeddata::abc}} b')).toBe('a b')
        expect(norm('{{emotion::happy}}{{bg::town}}x')).toBe('x')
        expect(norm('{{user}} waved')).toBe('{{user}} waved')
    })
    test('(d) links and images keep only their text, never the address', () => {
        expect(norm('[t](http://x)')).toBe('t')
        expect(norm('![alt text](http://x/y.png) after')).toBe('alt text after')
        expect(norm('see [docs](http://example.test/page)')).not.toContain('http')
    })
    test('(e) line-start fences, heading and quote markers go; mid-line # and > stay', () => {
        expect(norm('# Title')).toBe('title')
        expect(norm('### Deep')).toBe('deep')
        expect(norm('> quoted line')).toBe('quoted line')
        expect(norm('before\n```js\nconst x = 1\n```\nafter')).toBe('before const x = 1 after')
        expect(norm('c# is a language')).toBe('c# is a language')
        expect(norm('a > b')).toBe('a > b')
    })
    test('(f) known inline tags join, block tags (br included) separate, unknown angle text stays', () => {
        expect(norm('a<b>c</b>d')).toBe('acd')
        expect(norm('a<span class="x">b</span>c')).toBe('abc')
        expect(norm('a<br>b')).toBe('a b')
        expect(norm('a<div>b</div>c')).toBe('a b c')
        expect(norm('Array<string>')).toBe('array<string>')
        expect(norm('a < b and c > d')).toBe('a < b and c > d')
    })
    test('(f) a stray Thoughts tag is removed as a block tag', () => {
        expect(norm('<Thoughts>unclosed words')).toBe('unclosed words')
    })
    test('(g) emphasis marks go, underscores inside words stay', () => {
        expect(norm('*bold* and **strong** and ~~gone~~ and `code`')).toBe('bold and strong and gone and code')
        expect(norm('snake_case and _em_ here')).toBe('snake_case and em here')
    })
    test('(h) entities decode after tags are removed, once', () => {
        expect(norm('&lt;div&gt;')).toBe('<div>')
        expect(norm('&amp;lt;')).toBe('&lt;')
        expect(norm('Tom &amp; Jerry &quot;x&quot; &apos;y&apos;')).toBe('tom & jerry "x" \'y\'')
        expect(norm('a&nbsp;b')).toBe('a b')
        expect(norm('&#65;&#x42;')).toBe('ab')
        expect(norm('&#0; &#xD800; &#x110000;')).toBe('&#0; &#xd800; &#x110000;')
    })
    test('(i) whitespace collapses, case folds, NFC applies to the text and the query alike', () => {
        expect(norm('  Hello \n\n\tWORLD  ')).toBe('hello world')
        const nfd = '등불'.normalize('NFD')
        expect(nfd).not.toBe('등불')
        expect(norm(nfd)).toBe('등불')
        expect(normalizeQuery(nfd)).toBe('등불')
        expect(normalizeQuery('HeLLo')).toBe('hello')
    })
    test('displayText applies the same cleaning but keeps the case', () => {
        expect(displayText('  **Hello**\n World ', OFF)).toBe('Hello World')
        expect(displayText('<Thoughts>t</Thoughts>Keep', OFF)).toBe('Keep')
        expect(normalizeForSearch('Keep Case', OFF)).toBe(displayText('Keep Case', OFF).toLowerCase())
    })
})

describe('B1-2 Thoughts blocks', () => {
    test('nested blocks drop as one outer block when off', () => {
        expect(normalizeForSearch('a<Thoughts>x<Thoughts>y</Thoughts>z</Thoughts>b', OFF)).toBe('a b')
    })
    test('nested blocks keep all inner text when on', () => {
        const text = normalizeForSearch('a<Thoughts>x<Thoughts>y</Thoughts>z</Thoughts>b', ON)
        expect(text).toContain('x')
        expect(text).toContain('y')
        expect(text).toContain('z')
        expect(text).not.toContain('thoughts')
    })
    test('an unclosed block is text, whether thinking is on or off', () => {
        expect(normalizeForSearch('a<Thoughts>never closed', OFF)).toBe('a never closed')
        expect(normalizeForSearch('a<Thoughts>never closed', ON)).toBe('a never closed')
    })
    test('a closed block nested in an unclosed one still counts as a block', () => {
        expect(normalizeForSearch('<Thoughts>a<Thoughts>b</Thoughts>c', OFF)).toBe('a c')
    })
})

describe('B1-7 the query is a literal substring', () => {
    test('regex characters are plain characters after normalisation', () => {
        expect(matchesQuery(norm('see [y] and (x) here'), normalizeQuery('[y]'))).toBe(true)
        expect(matchesQuery(norm('see [y] and (x) here'), normalizeQuery('(x)'))).toBe(true)
        expect(matchesQuery(norm('path C:\\dir\\file'), normalizeQuery('\\dir\\'))).toBe(true)
        expect(matchesQuery(norm('only the letter y and x'), normalizeQuery('[y]'))).toBe(false)
        expect(matchesQuery(norm('x'), normalizeQuery('(x)'))).toBe(false)
        expect(matchesQuery(norm('a.b'), normalizeQuery('a.b'))).toBe(true)
        expect(matchesQuery(norm('axb'), normalizeQuery('a.b'))).toBe(false)
        expect(matchesQuery(norm('a.b'), normalizeQuery('a.*b'))).toBe(true)
        expect(matchesQuery(norm('axxb'), normalizeQuery('a.*b'))).toBe(false)
        expect(matchesQuery(norm('a+b'), normalizeQuery('a+'))).toBe(true)
        expect(matchesQuery(norm('aab'), normalizeQuery('a+'))).toBe(false)
    })
    test('quotes are part of the phrase and several words are one phrase', () => {
        expect(matchesQuery(norm('he said "two words" today'), normalizeQuery('"two words"'))).toBe(true)
        expect(matchesQuery(norm('he said two words today'), normalizeQuery('"two words"'))).toBe(false)
        expect(matchesQuery(norm('one two  words\nhere'), normalizeQuery('two   words'))).toBe(true)
        expect(matchesQuery(norm('two other words'), normalizeQuery('two words'))).toBe(false)
    })
    test('a whitespace-only or empty query is empty and matches nothing', () => {
        expect(normalizeQuery('   \n\t ')).toBe('')
        expect(normalizeQuery('')).toBe('')
        expect(matchesQuery('anything', '')).toBe(false)
    })
})

describe('B1-8 no width folding, canonical composition only', () => {
    test('full-width letters do not match ASCII', () => {
        expect(matchesQuery(norm('abc'), normalizeQuery('ＡＢＣ'))).toBe(false)
        expect(matchesQuery(norm('ＡＢＣ'), normalizeQuery('abc'))).toBe(false)
        expect(matchesQuery(norm('ＡＢＣ'), normalizeQuery('ａｂｃ'))).toBe(true)
    })
    test('a decomposed Hangul query matches composed text', () => {
        expect(matchesQuery(norm('등불을 켜자'), normalizeQuery('등불'.normalize('NFD')))).toBe(true)
        expect(matchesQuery(norm('다른 글'), normalizeQuery('등불'.normalize('NFD')))).toBe(false)
    })
})

describe('B1-4 cache', () => {
    test('never holds more than the cap and stops inserting when full, keeping the earliest entries', () => {
        const cache = createSearchCache(3000)
        const messages = Array.from({ length: 3500 }, (_, i) => msg(`Message ${i}`))
        for (const message of messages) cache.textFor(message, message.data, false)
        expect(cache.size).toBe(3000)
        expect(cache.has(messages[0])).toBe(true)
        expect(cache.has(messages[2999])).toBe(true)
        expect(cache.has(messages[3000])).toBe(false)
        expect(cache.textFor(messages[3499], messages[3499].data, false)).toBe('message 3499')
        expect(cache.size).toBe(3000)
    })
    test('a changed raw text or thinking flag recomputes and replaces the entry in place', () => {
        const cache = createSearchCache(10)
        const message = msg('Alpha')
        expect(cache.textFor(message, 'Alpha', false)).toBe('alpha')
        expect(cache.textFor(message, 'BETA', false)).toBe('beta')
        expect(cache.size).toBe(1)
        expect(cache.textFor(message, '<Thoughts>q</Thoughts>z', false)).toBe('z')
        expect(cache.textFor(message, '<Thoughts>q</Thoughts>z', true)).toBe('q z')
        expect(cache.size).toBe(1)
    })
    test('a stale entry is replaced even when the cache is full', () => {
        const cache = createSearchCache(1)
        const first = msg('one')
        const second = msg('two')
        cache.textFor(first, 'one', false)
        cache.textFor(second, 'two', false)
        expect(cache.has(second)).toBe(false)
        expect(cache.textFor(first, 'ONE EDITED', false)).toBe('one edited')
        expect(cache.textFor(first, 'ONE EDITED', false)).toBe('one edited')
    })
    test('the message object is never written to', () => {
        const cache = createSearchCache(10)
        const message = Object.freeze(msg('Frozen text'))
        expect(() => cache.textFor(message, message.data, false)).not.toThrow()
        expect(Object.keys(message)).toEqual(['role', 'data'])
        expect(Object.getOwnPropertySymbols(message)).toEqual([])
    })
    test('clear empties the cache', () => {
        const cache = createSearchCache(10)
        const message = msg('x')
        cache.textFor(message, 'x', false)
        cache.clear()
        expect(cache.size).toBe(0)
        expect(cache.has(message)).toBe(false)
    })
})

describe('B1-5 filters', () => {
    const zone = process.env.TZ
    beforeEach(() => { process.env.TZ = 'Asia/Seoul' })
    afterEach(() => {
        if (zone === undefined) delete process.env.TZ
        else process.env.TZ = zone
    })
    const open: SearchFilters = { speaker: 'any', hasImage: false, thinking: false, from: '', to: '' }
    const noDays = dayBoundsOf('', '')

    test('speaker keeps only the chosen role', () => {
        const mine = msg('x', { role: 'user' })
        const theirs = msg('x', { role: 'char' })
        expect(passesFilters(mine, { ...open, speaker: 'me' }, noDays)).toBe(true)
        expect(passesFilters(theirs, { ...open, speaker: 'me' }, noDays)).toBe(false)
        expect(passesFilters(theirs, { ...open, speaker: 'char' }, noDays)).toBe(true)
        expect(passesFilters(mine, { ...open, speaker: 'char' }, noDays)).toBe(false)
        expect(passesFilters(mine, open, noDays)).toBe(true)
        expect(passesFilters(theirs, open, noDays)).toBe(true)
    })
    test('has image recognises inlay macros, image asset macros, img tags and markdown images', () => {
        const images = [
            'a {{inlay::id1}}', 'a {{inlayed::id1}}', 'a {{inlayeddata::id1}}',
            '{{img::pic}}', '{{image::pic}}', '{{emotion::happy}}', '{{asset::a}}', '{{bg::town}}',
            '<img src="x.png">', '<IMG src="x.png"/>', '![alt](http://x/y.png)',
        ]
        for (const data of images) {
            expect(hasImageContent(data), data).toBe(true)
            expect(passesFilters(msg(data), { ...open, hasImage: true }, noDays), data).toBe(true)
        }
        for (const data of ['plain', 'an {{user}} macro', '[link](http://x)', '<imgx>', '{{audio::a}}', '{{unknown::x}}']) {
            expect(hasImageContent(data), data).toBe(false)
            expect(passesFilters(msg(data), { ...open, hasImage: true }, noDays), data).toBe(false)
        }
        expect(passesFilters(msg('plain'), open, noDays)).toBe(true)
    })
    test('dates are local days: both bounds are inclusive days, the end bound is the next local midnight', () => {
        const bounds = dayBoundsOf('2026-03-10', '2026-03-10')
        const filters = { ...open, from: '2026-03-10', to: '2026-03-10' }
        // 2026-03-10 00:30 in Seoul is 2026-03-09 15:30 UTC.
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 2, 9, 15, 30) }), filters, bounds)).toBe(true)
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 2, 9, 14, 59) }), filters, bounds)).toBe(false)
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 2, 9, 15, 0) }), filters, bounds)).toBe(true)
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 2, 10, 14, 59) }), filters, bounds)).toBe(true)
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 2, 10, 15, 0) }), filters, bounds)).toBe(false)
    })
    test('one-sided ranges and invalid days', () => {
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 0, 1) }), open, dayBoundsOf('2026-03-10', ''))).toBe(false)
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 11, 1) }), open, dayBoundsOf('2026-03-10', ''))).toBe(true)
        expect(passesFilters(msg('x', { time: Date.UTC(2026, 11, 1) }), open, dayBoundsOf('', '2026-03-10'))).toBe(false)
        expect(dayBoundsOf('not a day', '2026-02-31')).toEqual({ from: null, to: null })
    })
    test('a message without a time fails any date filter and passes none', () => {
        const untimed = msg('x')
        expect(passesFilters(untimed, open, dayBoundsOf('2026-03-10', ''))).toBe(false)
        expect(passesFilters(untimed, open, dayBoundsOf('', '2026-03-10'))).toBe(false)
        expect(passesFilters(untimed, open, noDays)).toBe(true)
        expect(passesFilters(msg('x', { time: 0 }), open, dayBoundsOf('2026-03-10', ''))).toBe(false)
    })
})

describe('B1-6 hidden rule', () => {
    test('G: equals the hidden set of the prompt split on mixed fixtures', () => {
        const fixtures: Message['disabled'][][] = [
            [],
            [undefined, undefined, undefined],
            [undefined, true, undefined, true],
            [undefined, 'allBefore', undefined, undefined],
            [true, undefined, 'allBefore', true, undefined],
            ['allBefore', undefined, 'allBefore', undefined, false],
            [undefined, 'allBefore', true, undefined, 'allBefore', undefined, true],
        ]
        for (const flags of fixtures) {
            const messages = flags.map((disabled, i) => msg(`m${i}`, { disabled }))
            const expected = promptSplitHidden(messages)
            const reset = promptResetIndex(messages)
            const actual = messages.map((_, i) => isHiddenAt(messages, i, reset))
            expect(actual, JSON.stringify(flags)).toEqual(messages.map((m) => expected.has(m)))
        }
    })
    test('the reset index is the latest allBefore, or -1; the first message is never hidden', () => {
        expect(promptResetIndex([msg('a'), msg('b')])).toBe(-1)
        expect(promptResetIndex([msg('a', { disabled: 'allBefore' }), msg('b'), msg('c', { disabled: 'allBefore' }), msg('d')])).toBe(2)
        expect(isHiddenAt([msg('a', { disabled: 'allBefore' })], -1, 0)).toBe(false)
    })
    test('a later flag change is read at call time, not captured', () => {
        const messages = [msg('a'), msg('b'), msg('c')]
        expect(isHiddenAt(messages, 1, promptResetIndex(messages))).toBe(false)
        messages[1].disabled = true
        expect(isHiddenAt(messages, 1, promptResetIndex(messages))).toBe(true)
        messages[1].disabled = false
        messages[2].disabled = 'allBefore'
        expect(isHiddenAt(messages, 1, promptResetIndex(messages))).toBe(true)
    })
})

describe('B1-3 scan', () => {
    type Progress = { hits: readonly SearchHit[], complete: boolean }

    function harness(messages: Message[], overrides: Partial<Parameters<typeof createSearchScan>[0]> = {}) {
        const queue: (() => void)[] = []
        const progress: Progress[] = []
        const clock = { t: 0 }
        const textAt = vi.fn<(index: number) => string>((index) => (index < 0 ? 'first message matching' : messages[index].data.toLowerCase()))
        const cancel = createSearchScan({
            count: messages.length,
            includeFirst: false,
            messageAt: (index) => messages[index],
            textAt,
            passes: () => true,
            query: 'match',
            sliceMax: 500,
            budgetMs: 8,
            now: () => clock.t,
            schedule: (run) => { queue.push(run) },
            onProgress: (hits, complete) => { progress.push({ hits, complete }) },
            ...overrides,
        })
        const runOne = () => { const next = queue.shift(); if (next) next() }
        const runAll = () => { while (queue.length > 0) runOne() }
        return { queue, progress, clock, textAt, cancel, runOne, runAll }
    }

    test('nothing runs until the scheduler calls back', () => {
        const messages = [msg('match')]
        const h = harness(messages)
        expect(h.textAt).not.toHaveBeenCalled()
        expect(h.progress).toEqual([])
        expect(h.queue.length).toBe(1)
    })
    test('scans newest first, the first message last, and hits hold the message reference', () => {
        const messages = [msg('match a'), msg('no'), msg('match b'), msg('match c')]
        const h = harness(messages, { includeFirst: true })
        h.runAll()
        const last = h.progress[h.progress.length - 1]
        expect(last.complete).toBe(true)
        expect(last.hits.map((hit) => hit.index)).toEqual([3, 2, 0, -1])
        expect(last.hits[0].message).toBe(messages[3])
        expect(last.hits[1].message).toBe(messages[2])
        expect(last.hits[2].message).toBe(messages[0])
        expect(last.hits[3].message).toBeNull()
        expect(h.textAt.mock.calls.map((call) => call[0])).toEqual([3, 2, 1, 0, -1])
    })
    test('the first message is skipped when not included', () => {
        const h = harness([msg('match')])
        h.runAll()
        expect(h.textAt.mock.calls.map((call) => call[0])).toEqual([0])
    })
    test('passes decides before the text is read', () => {
        const messages = [msg('match 0'), msg('match 1'), msg('match 2')]
        const h = harness(messages, { passes: (index) => index !== 1 })
        h.runAll()
        expect(h.progress[h.progress.length - 1].hits.map((hit) => hit.index)).toEqual([2, 0])
        expect(h.textAt.mock.calls.map((call) => call[0])).toEqual([2, 0])
    })
    test('a slice stops at sliceMax and complete is only true after the last slice', () => {
        const messages = Array.from({ length: 5 }, () => msg('match'))
        const h = harness(messages, { sliceMax: 2 })
        h.runAll()
        expect(h.progress.map((p) => [p.hits.length, p.complete])).toEqual([[2, false], [4, false], [5, true]])
    })
    test('a slice that ends exactly on the last message completes in that slice', () => {
        const h = harness([msg('match'), msg('match')], { sliceMax: 2 })
        h.runAll()
        expect(h.progress.map((p) => [p.hits.length, p.complete])).toEqual([[2, true]])
    })
    test('a slice stops once the time budget is spent, after at least one message', () => {
        const messages = Array.from({ length: 10 }, () => msg('match'))
        const h = harness(messages)
        h.textAt.mockImplementation((index) => { h.clock.t += 3; return messages[index].data })
        h.runAll()
        expect(h.progress.map((p) => p.hits.length)).toEqual([3, 6, 9, 10])
        expect(h.progress.map((p) => p.complete)).toEqual([false, false, false, true])
    })
    test('a spent budget still processes one message so the scan always advances', () => {
        const messages = [msg('match'), msg('match'), msg('match')]
        const h = harness(messages, { budgetMs: 0 })
        h.runAll()
        expect(h.progress.map((p) => p.hits.length)).toEqual([1, 2, 3])
    })
    test('cancel before the first slice runs nothing and reports nothing', () => {
        const h = harness([msg('match')])
        h.cancel()
        h.runAll()
        expect(h.textAt).not.toHaveBeenCalled()
        expect(h.progress).toEqual([])
    })
    test('cancel between slices stops further reads and progress', () => {
        const messages = Array.from({ length: 6 }, () => msg('match'))
        const h = harness(messages, { sliceMax: 2 })
        h.runOne()
        expect(h.progress.length).toBe(1)
        h.cancel()
        h.runAll()
        expect(h.progress.length).toBe(1)
        expect(h.textAt).toHaveBeenCalledTimes(2)
    })
    test('cancel from inside onProgress schedules no further slice', () => {
        const messages = Array.from({ length: 6 }, () => msg('match'))
        const cancelHolder: { cancel: () => void } = { cancel: () => {} }
        const h = harness(messages, { sliceMax: 2, onProgress: () => { cancelHolder.cancel() } })
        cancelHolder.cancel = h.cancel
        h.runAll()
        expect(h.textAt).toHaveBeenCalledTimes(2)
    })
    test('an empty query never reads a message and completes with no hits', () => {
        const messages = [msg('match')]
        const h = harness(messages, { query: '', includeFirst: true })
        h.runAll()
        expect(h.textAt).not.toHaveBeenCalled()
        expect(h.progress).toEqual([{ hits: [], complete: true }])
    })
    test('an empty chat completes at once, or checks only the first message', () => {
        const h = harness([])
        h.runAll()
        expect(h.progress).toEqual([{ hits: [], complete: true }])
        const withFirst = harness([], { includeFirst: true })
        withFirst.runAll()
        expect(withFirst.progress[withFirst.progress.length - 1].hits.map((hit) => hit.index)).toEqual([-1])
    })
    test('text is read at slice time, so a streamed edit between slices is seen', () => {
        const messages = [msg('nothing yet'), msg('streaming')]
        const h = harness(messages, { sliceMax: 1 })
        h.runOne()
        messages[0].data = 'now a match'
        h.runAll()
        expect(h.progress[h.progress.length - 1].hits.map((hit) => hit.index)).toEqual([0])
    })
    test('progress hits are a snapshot that later slices do not mutate', () => {
        const messages = Array.from({ length: 4 }, () => msg('match'))
        const h = harness(messages, { sliceMax: 2 })
        h.runAll()
        expect(h.progress[0].hits.length).toBe(2)
    })
    test('slice size constants and the low-power halving', () => {
        expect(SCAN_SLICE_MAX).toBe(500)
        expect(SCAN_SLICE_MAX_LOW_POWER).toBe(250)
        expect(SCAN_BUDGET_MS).toBe(8)
        expect(sliceMaxFor(false)).toBe(500)
        expect(sliceMaxFor(true)).toBe(250)
    })
})
