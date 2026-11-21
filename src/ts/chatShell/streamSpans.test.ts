import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { customscript } from '../storage/database.svelte'

const control = vi.hoisted(() => ({
    db: { presetRegex: [] as customscript[] },
    moduleScripts: [] as customscript[],
    moduleSpy: vi.fn((..._args: unknown[]): customscript[] => []),
}))

vi.mock('../stores.svelte', () => ({ DBState: { db: control.db } }))
vi.mock('../process/modules', () => ({ getModuleRegexScripts: (...args: unknown[]) => control.moduleSpy(...args) }))
vi.mock('../util', () => ({ findCharacterbyId: () => undefined }))

import { buildProbes, cbsIntervals, deriveScriptFlags, leadLiteral, MAX_PROBES, parseProbe, type SpanRules } from './streamSpans'
import { createSpanRules, renderOpenParagraphSource, splitStreamingText } from './streamingSafe'

const ST: SpanRules = { probes: [{ lead: '<st>', regex: /<st>[\s\S]*?<\/st>/y, ignoreCase: false }] }

function script(input: string, extra: Partial<customscript> = {}): customscript {
    return { comment: '', in: input, out: 'x', type: 'editdisplay', ...extra }
}

describe('CBS span hold in the splitter', () => {
    test('T-SPAN-1 an unbalanced block holds everything after its opener', () => {
        expect(splitStreamingText('A\n\n{{#if 1}}\n\nB\n\nC').finished).toEqual(['A\n\n'])
    })

    test('T-SPAN-2 the closer finishes the whole span as one block', () => {
        const split = splitStreamingText('{{#if 1}}\n\nB\n\n{{/if}}\n\nC')
        expect(split).toEqual({ finished: ['{{#if 1}}\n\nB\n\n{{/if}}\n\n'], open: 'C' })
    })

    test('T-SPAN-3 nesting and the short closer', () => {
        const nested = '{{#when::x}}a\n\n{{#each a as b}}b\n\n{{/each}}c\n\n{{/when}}\n\nafter'
        expect(splitStreamingText(nested)).toEqual({ finished: ['{{#when::x}}a\n\n{{#each a as b}}b\n\n{{/each}}c\n\n{{/when}}\n\n'], open: 'after' })
        expect(splitStreamingText('{{#if_pure 1}}x\n\ny\n\n{{/}}\n\nz')).toEqual({ finished: ['{{#if_pure 1}}x\n\ny\n\n{{/}}\n\n'], open: 'z' })
    })

    test('T-SPAN-4 a stray closer, an unknown opener and a near miss hold nothing', () => {
        const split = splitStreamingText('a {{/if}}\n\nb\n\n{{#iff}}\n\nc\n\n{{#foo}}\n\nd')
        expect(split.finished).toEqual(['a {{/if}}\n\n', 'b\n\n', '{{#iff}}\n\n', 'c\n\n', '{{#foo}}\n\n'])
        expect(cbsIntervals('{{/if}} then {{/if}}')).toEqual([])
        expect(cbsIntervals('{{/if}} {{#if 1}}')).toEqual([{ q: 8, e: Infinity }])
    })

    test('T-SPAN-9 a span open for twenty thousand characters is still held', () => {
        const text = 'A\n\n{{#if 1}}\n\n' + 'x\n\n'.repeat(7000)
        expect(text.length).toBeGreaterThan(20000)
        expect(splitStreamingText(text).finished).toEqual(['A\n\n'])
    })

    test('interval offsets: closed and open spans carry their start and end', () => {
        expect(cbsIntervals('ab {{#if 1}}x{{/if}} {{#each a as b}}')).toEqual([{ q: 3, e: 20 }, { q: 21, e: Infinity }])
    })
})

describe('probe span hold in the splitter', () => {
    test('T-SPAN-5 an opened display span holds its text', () => {
        expect(splitStreamingText('A\n\n<st>\n\nB', 0, ST).finished).toEqual(['A\n\n'])
    })

    test('T-SPAN-6 a closed span finishes whole', () => {
        const split = splitStreamingText('A\n\n<st>\n\nB\n\n</st>\n\nC', 0, ST)
        expect(split).toEqual({ finished: ['A\n\n', '<st>\n\nB\n\n</st>\n\n'], open: 'C' })
    })

    test('T-SPAN-7 ignoreCase lead', () => {
        const rules: SpanRules = { probes: [{ lead: '<ST>', regex: /<ST>[\s\S]*?<\/ST>/iy, ignoreCase: true }] }
        expect(splitStreamingText('A\n\n<st>\n\nB', 0, rules).finished).toEqual(['A\n\n'])
    })

    test('T-SPAN-8 a split from a finished prefix equals the tail of the full split', () => {
        const pieces = ['word ', '\n\n', '\n', '{{#if 1}}', '{{/if}}', '<st>', '</st>', '- item', '{{#each a as b}}', '{{/each}}', 'more ']
        let seed = 77
        const next = (limit: number) => { seed = (seed * 48271) % 2147483647; return seed % limit }
        for (let n = 0; n < 300; n++) {
            const text = Array.from({ length: 3 + next(30) }, () => pieces[next(pieces.length)]).join('')
            const full = splitStreamingText(text, 0, ST)
            let offset = 0
            for (let k = 0; k <= full.finished.length; k++) {
                const tail = splitStreamingText(text, offset, ST)
                expect({ finished: tail.finished, open: tail.open }, JSON.stringify({ text, k })).toEqual({ finished: full.finished.slice(k), open: full.open })
                offset += full.finished[k]?.length ?? 0
            }
        }
    })

    test('without rules a probe-shaped opener splits as before', () => {
        expect(splitStreamingText('A\n\n<st>\n\nB').finished).toEqual(['A\n\n', '<st>\n\n'])
    })
})

describe('open tail cut at an open span', () => {
    test('T-OT-3 the open CBS block and the open probe span are cut from the tail', () => {
        expect(renderOpenParagraphSource('Before {{#if 1}}\n\nsecret')).toBe('Before ')
        expect(renderOpenParagraphSource('x <st>\n\nsecret', ST)).toBe('x ')
    })

    test('T-OT-4 a closed span is not cut', () => {
        expect(renderOpenParagraphSource('{{#if 1}}a{{/if}} tail')).toBe('{{#if 1}}a{{/if}} tail')
        expect(renderOpenParagraphSource('<st>a</st> tail', ST)).toBe('<st>a</st> tail')
    })
})

describe('probe parsing', () => {
    test('T-PR-1 eligibility table', () => {
        expect(parseProbe(script('<a>[\\s\\S]*?</a>'))?.lead).toBe('<a>')
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { type: 'editoutput' }))).toBeNull()
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { out: '@@emo x' }))).toBeNull()
        expect(parseProbe(script('', { }))).toBeNull()
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { ableFlag: true, flag: 'g<cbs>' }))).toBeNull()
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { ableFlag: true, flag: 'g<order 1>' }))?.lead).toBe('<a>')
        expect(parseProbe(script('<a>[\\s\\S]*?</a>|<b>'))).toBeNull()
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { }))?.regex.flags).toBe('y')
        expect(parseProbe(script('(?=<a>)<a>[\\s\\S]'))).toBeNull()
        expect(parseProbe(script('<a>[\\s\\S]*?('))).toBeNull()
        expect(parseProbe(script('<[\\s\\S]*?>'))).toBeNull()
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { ableFlag: true, flag: 'is' }))).toMatchObject({ ignoreCase: true })
        expect(parseProbe(script('<a>[\\s\\S]*?</a>', { ableFlag: true, flag: 'is' }))?.regex.flags).toBe('isy')
    })

    test('T-PR-1 flags derive as executeScript derives them', () => {
        expect(deriveScriptFlags(script('a'))).toEqual({ flags: 'g', actions: [] })
        expect(deriveScriptFlags(script('a', { ableFlag: true, flag: '' }))).toEqual({ flags: 'g', actions: [] })
        expect(deriveScriptFlags(script('a', { ableFlag: true, flag: 'xgg' }))).toEqual({ flags: 'g', actions: [] })
        expect(deriveScriptFlags(script('a', { ableFlag: true, flag: '<order 2>' }))).toEqual({ flags: 'u', actions: [] })
        expect(deriveScriptFlags(script('a', { ableFlag: true, flag: 'i<cbs>' }))).toEqual({ flags: 'i', actions: ['cbs'] })
    })

    test('T-PR-1 only the first 32 eligible scripts become probes', () => {
        const scripts = Array.from({ length: 40 }, (_, k) => script(`<s${k}>[\\s\\S]*?</s${k}>`))
        const probes = buildProbes([script('plain'), ...scripts])
        expect(probes).toHaveLength(MAX_PROBES)
        expect(probes[0].lead).toBe('<s0>')
        expect(probes[31].lead).toBe('<s31>')
    })

    test('T-PR-2 lead literal table', () => {
        expect(leadLiteral('^<s>[\\s\\S]*?</s>')).toBe('<s>')
        expect(leadLiteral('(<s>)([\\s\\S]*?)')).toBe('<s>')
        expect(leadLiteral('(?:<s>)[\\s\\S]*')).toBe('<s>')
        expect(leadLiteral('(?<n><s>)[\\s\\S]*')).toBe('<s>')
        expect(leadLiteral('\\[STATUS\\][\\s\\S]*?\\[/STATUS\\]')).toBe('[STATUS]')
        expect(leadLiteral('ab*[\\s\\S]')).toBeNull()
        expect(leadLiteral('ab+[\\s\\S]')).toBe('ab')
        expect(leadLiteral('abc?[\\s\\S]')).toBe('ab')
        expect(leadLiteral('(?<=x)ab[\\s\\S]')).toBeNull()
    })

    test('T-PR-3 newline capability', () => {
        expect(parseProbe(script('<b>(.*?)</b>'))).toBeNull()
        expect(parseProbe(script('<b>(.*?)</b>', { ableFlag: true, flag: 's' }))?.lead).toBe('<b>')
        expect(parseProbe(script('<b>\\s*'))?.lead).toBe('<b>')
        expect(parseProbe(script('<b>[^<]*</b>'))?.lead).toBe('<b>')
        expect(parseProbe(script('<b>\\w*</b>'))).toBeNull()
    })

    test('T-PR-4 a ^ anchor outside a character class is ineligible', () => {
        expect(parseProbe(script('^<st>[\\s\\S]*?</st>'))).toBeNull()
        expect(parseProbe(script('^<st>[\\s\\S]*?</st>', { ableFlag: true, flag: 'm' }))).toBeNull()
        expect(parseProbe(script('<st>(?:^x)?[\\s\\S]*?</st>'))).toBeNull()
        expect(parseProbe(script('<st>[^x]*</st>'))?.lead).toBe('<st>')
        expect(parseProbe(script('<st>\\^[\\s\\S]*?</st>'))?.lead).toBe('<st>^')
    })
})

describe('createSpanRules', () => {
    beforeEach(() => {
        control.db.presetRegex = [script('<p1>[\\s\\S]*?</p1>')]
        control.moduleScripts = [script('<m1>[\\s\\S]*?</m1>')]
        control.moduleSpy.mockReset()
        control.moduleSpy.mockImplementation(() => control.moduleScripts)
    })

    test('T-PR-4 order is preset, character, module; modules are read for the shown chat (no subject)', async () => {
        const character = { type: 'character', customscript: [script('<c1>[\\s\\S]*?</c1>')] }
        const rules = await createSpanRules(character as never)
        expect(rules.probes.map((probe) => probe.lead)).toEqual(['<p1>', '<c1>', '<m1>'])
        expect(control.moduleSpy).toHaveBeenCalledTimes(1)
        expect(control.moduleSpy.mock.calls[0]).toEqual([])
    })

    test('T-PR-4 a group contributes no character script; no character gives no rules', async () => {
        const group = await createSpanRules({ type: 'group', customscript: [script('<g1>[\\s\\S]*?</g1>')] } as never)
        expect(group.probes.map((probe) => probe.lead)).toEqual(['<p1>', '<m1>'])
        const calls = control.moduleSpy.mock.calls.length
        expect((await createSpanRules(null)).probes).toEqual([])
        expect(control.moduleSpy.mock.calls.length).toBe(calls)
    })
})
