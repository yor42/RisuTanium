// @vitest-environment node
import fc from 'fast-check'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { checkCbs, checkCbsWithExpansions, type CbsCheckOptions, type CbsCheckResult, type CbsProblemKind } from './cbsCheck'
import {
    EACH_CHAR_BUDGET,
    EACH_MAX_ELEMENTS,
    eachBodyOutput,
    eachLoopVar,
    expandEach,
    expansionBound,
    legacyFrameOutput,
    parseEachHeader,
    type EachElement,
    type EachHeader,
} from './cbsEach'
import { createMacroIndex, type MacroEntry } from './macroIndex'

function entry(name: string, extra: Partial<MacroEntry> = {}): MacroEntry {
    return {
        name,
        aliases: [],
        summary: '',
        usage: null,
        docOnly: false,
        internalOnly: false,
        blockSyntax: false,
        deprecated: null,
        ...extra,
    }
}

const index = createMacroIndex([entry('return'), entry('trim'), entry('getvar')])

const options = (extra: Partial<CbsCheckOptions> = {}): CbsCheckOptions => ({ mode: 'cbs', slotAllowed: false, ...extra })
// These rows judge only the scanner kinds (pairing, blocks, stops, expansions); the advisory kinds have
// their own files, so `check` leaves them out.
const ADVISORY_KINDS = new Set<CbsProblemKind>(['unknown-macro', 'not-a-block', 'misplaced-else', 'slot-outside', 'deprecated'])

const check = (text: string, extra: Partial<CbsCheckOptions> = {}): CbsCheckResult => {
    const result = checkCbs(text, index, options(extra))
    return { ...result, problems: result.problems.filter((p) => !ADVISORY_KINDS.has(p.kind)) }
}
const shape = (result: CbsCheckResult) => result.problems.map((p) => `${p.kind}:${p.start}-${p.end}`)

// A header that parsed to an array, for the expansion rows.
function arrayHeader(headText: string): Exclude<EachHeader, { dropped: true }> {
    const header = parseEachHeader(headText)
    if('dropped' in header){
        throw new Error(`header ${JSON.stringify(headText)} was dropped`)
    }
    return header
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('the engine header of an #each', () => {
    test.each<[string, readonly EachElement[], string, boolean]>([
        ['#each [1,2] as x', [1, 2], 'x', false],
        ['#each ["a","b"] as item', ['a', 'b'], 'item', false],
        ['#each a§b§c as x', ['a', 'b', 'c'], 'x', false],
        ['#each ::keep [1] as x', [1], 'x', true],
        ['#each as [1] as x', [1], 'x', false],
        ['#each ::keep as [1] as x', [1], 'x', true],
        ['#each [1,2] x', [1, 2], 'x', false],
        ['#each ["a b"] x', ['a b'], 'x', false],
        ['#each a§b x', ['a', 'b'], 'x', false],
        ['#each [1] as y as z', ['[1] as y'], 'z', false],
        ['#each [1, as x', ['[1,'], 'x', false],
        ['#each {"a":1} as x', ['{"a":1}'], 'x', false],
        ['#each [{"a":1},[2],null,true] as x', [{ a: 1 }, [2], null, true], 'x', false],
    ])('%j: array, loop variable and keep', (head, array, slotName, keep) => {
        expect(parseEachHeader(head)).toEqual({ array, slotName, keep })
    })

    test.each(['#each', '#each [1,2]', '#each ::keep [1,2]', '#each     '])('%j has no space and is dropped', (head) => {
        expect(parseEachHeader(head)).toEqual({ dropped: true })
    })

    test('the loop variable of a header partly made of a value reads only the static tail', () => {
        expect(eachLoopVar(' as item')).toBe('item')
        expect(eachLoopVar(' as item  ')).toBe('item')
        expect(eachLoopVar('x as y as z')).toBe('z')
        expect(eachLoopVar('x as')).toBeNull()
        expect(eachLoopVar('x as ')).toBeNull()
        expect(eachLoopVar(' as   ')).toBeNull()
        expect(eachLoopVar(' item')).toBeNull()
        expect(eachLoopVar('')).toBeNull()
    })
})

describe('the body of an #each and its legacy frames', () => {
    test('a legacy frame is replaced the way the engine does it, or kept', () => {
        expect(legacyFrameOutput('if 0\nx')).toBe('')
        expect(legacyFrameOutput('if -1\nx')).toBe('')
        expect(legacyFrameOutput('if \nx')).toBe('')
        expect(legacyFrameOutput('if 1\n  x  ')).toBe('x')
        expect(legacyFrameOutput('if\nx')).toBe('x')
        expect(legacyFrameOutput('if 1')).toBeNull()
        expect(legacyFrameOutput('foo\nbar')).toBeNull()
    })

    test('the block end trims every line unless the block keeps its text', () => {
        expect(eachBodyOutput('  \n  a\n   b  \n', false)).toBe('a\nb')
        expect(eachBodyOutput('  \n  a\n   b  \n', true)).toBe('  \n  a\n   b  \n')
    })
})

describe('the expansion of an #each', () => {
    test('every element fills the loop variable, and other slots stay', () => {
        const header = arrayHeader('#each [1,"b",null,[2],{"k":3}] as x')
        expect(expandEach(header, 'a{{slot::x}}|{{slot::w}}|{{slot}}')).toBe(
            'a1|{{slot::w}}|{{slot}}ab|{{slot::w}}|{{slot}}anull|{{slot::w}}|{{slot}}a[2]|{{slot::w}}|{{slot}}a{"k":3}|{{slot::w}}|{{slot}}',
        )
    })

    test('an element is a string replacement, so $ patterns apply', () => {
        expect(expandEach(arrayHeader('#each ["$&"] as x'), 'a{{slot::x}}b')).toBe('a{{slot::x}}b')
        expect(expandEach(arrayHeader('#each ["$`"] as x'), 'a{{slot::x}}b')).toBe('aab')
        expect(expandEach(arrayHeader('#each ["$\'"] as x'), 'a{{slot::x}}b')).toBe('abb')
        expect(expandEach(arrayHeader('#each ["$$"] as x'), 'a{{slot::x}}b')).toBe('a$b')
        expect(expandEach(arrayHeader('#each ["$1"] as x'), 'a{{slot::x}}b')).toBe('a$1b')
    })

    test('the result is trimmed unless the block keeps its text, and a dropped header gives nothing', () => {
        expect(expandEach(arrayHeader('#each [1,2] as x'), ' {{slot::x}} ')).toBe('1  2')
        expect(expandEach(arrayHeader('#each ::keep [1,2] as x'), ' {{slot::x}} ')).toBe(' 1  2 ')
        expect(expandEach(parseEachHeader('#each [1,2]'), 'a')).toBe('')
        expect(expansionBound(parseEachHeader('#each [1,2]'), 'a')).toBe(0)
    })

    test('the bound counts every pattern that grows the text', () => {
        const body = `${'Z'.repeat(50)}{{slot::x}}`
        const header = arrayHeader('#each ["$`$`"] as x')
        expect(expandEach(header, body).length).toBe(150)
        expect(expansionBound(header, body)).toBe(61 + (4 + 2 * 61))
        expect(expansionBound(arrayHeader('#each ["$&"] as x'), body)).toBe(61 + (2 + 11))
        expect(expansionBound(arrayHeader('#each [1,2,3] as x'), 'no slot here')).toBe(3 * 12)
    })

    test('the bound is never below the length that is built', () => {
        const ELEMENT = fc.constantFrom('a', '$&', '$`', "$'", '$$', '$1', '$<x>', '$', '$$&', '{{slot::x}}', '')
        const BODY_PART = fc.constantFrom('p', '{{slot::x}}', '{{slot::y}}', '$&', ' ', '\n', '{{slot::x}}{{slot::x}}')
        fc.assert(
            fc.property(
                fc.array(ELEMENT, { maxLength: 5 }),
                fc.array(BODY_PART, { maxLength: 8 }),
                fc.boolean(),
                (elements, parts, keep) => {
                    const header: EachHeader = { array: elements, slotName: 'x', keep }
                    const body = parts.join('')
                    expect(expansionBound(header, body)).toBeGreaterThanOrEqual(expandEach(header, body).length)
                },
            ),
            { seed: 20261113, numRuns: 500 },
        )
    })
})

describe('a literal-array #each in the checker', () => {
    test('the scan goes on after it and reports what follows', () => {
        const result = check('}}{{#each [1] as x}}a{{/each}}}}')
        expect(shape(result)).toEqual(['stray-macro-close:0-2', 'stray-macro-close:30-32'])
        expect(result.valueDependent).toBe(false)
        expect(result.judgedUntil).toBe('}}{{#each [1] as x}}a{{/each}}}}'.length)
    })

    test('an expansion that holds nothing, and a header with no space, splice nothing', () => {
        const none = checkCbsWithExpansions('{{#each [] as x}}a{{/each}}}}{{#each [1,2]}}b{{/each}}}}', index, options())
        expect(none.expansions).toEqual([])
        expect(shape(none.result)).toEqual(['stray-macro-close:27-29', 'stray-macro-close:54-56'])
    })

    test('positions after the splice are original offsets, also behind a role tag', () => {
        const text = '<user>{{#each [1,2] as x}}{{slot::x}}{{/each}} }}'
        expect(shape(check(text))).toEqual(['stray-macro-close:47-49'])
        expect(checkCbsWithExpansions(text, index, options()).expansions).toEqual(['12'])
    })

    test('the body is the first pass: legacy frames are replaced, and a frame opened by {# is re-emitted as {{', () => {
        const spliced = (text: string) => checkCbsWithExpansions(text, index, options()).expansions
        expect(spliced('{{#each [1] as x}}{#if 0\nhidden#}a{{/each}}')).toEqual(['a'])
        expect(spliced('{{#each [1] as x}}{#if 1\n  shown {{slot::x}} #}{{/each}}')).toEqual(['shown 1'])
        expect(spliced('{{#each [1] as x}}{#trim::{{slot::x}}}}{{/each}}')).toEqual(['{{trim::1}}'])
        expect(spliced('{{#each [1] as x}}{#x#}{{/each}}')).toEqual(['{#x#}'])
    })

    test('a legacy frame that hides a structure does not report that structure from the expansion', () => {
        const hidden = '{{#each [1,2] as x}}{#if 0\n{{#foo}}{{/x}}#}{{/each}}'
        expect(check(hidden).problems).toEqual([])
        const shown = '{{#each [1,2] as x}}{#if 1\n{{#foo}}{{/x}}#}{{/each}}'
        expect(shape(check(shown))).toEqual(['stray-block-close:43-52'])
    })

    test('a nested literal #each is simulated again inside the expansion', () => {
        const text = '{{#each [1,2] as x}}{{#each [3,4] as y}}{{slot::x}}{{slot::y}}{{/each}}{{/each}}'
        const { result, expansions } = checkCbsWithExpansions(text, index, options())
        expect(expansions).toEqual([
            '{{#each [3,4] as y}}1{{slot::y}}{{/each}}{{#each [3,4] as y}}2{{slot::y}}{{/each}}',
            '1314',
            '2324',
        ])
        expect(result.valueDependent).toBe(false)
        expect(result.problems).toEqual([])
    })

    test('a role tag in an element is not rewritten, and the text is scanned as it stands', () => {
        const text = '{{#each ["\\u003cuser\\u003e"] as x}}{{slot::x}}{{/each}}'
        const { result, expansions } = checkCbsWithExpansions(text, index, options())
        expect(expansions).toEqual(['<user>'])
        expect(result.problems).toEqual([])
    })

    test('a `}}` read across the seam closes the macro around the #each', () => {
        const text = '{{trim::{{#each [1] as y}}}{{/each}}}'
        const result = check(text)
        expect(result.problems).toEqual([])
        expect(result.valueDependent).toBe(false)
    })
})

describe('what an #each leaves the scan unable to judge', () => {
    const note = (result: CbsCheckResult) => result.problems.filter((p) => p.kind === 'not-static').map((p) => [p.start, p.reason])

    test('a header with a value, or inside a maybe pure body, stops at the closer', () => {
        const dynamic = check('}}{{#each {{getvar::l}} as x}}a{{/each}}}}')
        expect(note(dynamic)).toEqual([[31, 'each-reparse']])
        expect(dynamic.judgedUntil).toBe(31)
        expect(shape(dynamic)).toEqual(['stray-macro-close:0-2', 'not-static:31-40'])
        const maybe = check('{{#when::legacy::var::x}}{{#each [1] as x}}a{{/each}}}}{{/when}}')
        expect(note(maybe)).toEqual([[44, 'each-reparse']])
    })

    test('a call in the body stops at the closer, even for an empty array', () => {
        expect(note(check('{{#each [1] as x}}{{call::f}}{{/each}}}}'))).toEqual([[29, 'each-reparse']])
        expect(note(check('{{#each [] as x}}{{call::f}}{{/each}}}}'))).toEqual([[28, 'each-reparse']])
        expect(note(check('{{#each [1] as x}}{{calls::f}}{{/each}}}}'))).toEqual([])
    })

    test('the element cap: 1000 elements are judged, 1001 stop', () => {
        const array = (n: number) => `[${Array.from({ length: n }, () => '1').join(',')}]`
        expect(EACH_MAX_ELEMENTS).toBe(1000)
        expect(check(`{{#each ${array(1000)} as x}}a{{/each}}}}`).valueDependent).toBe(false)
        const over = check(`{{#each ${array(1001)} as x}}a{{/each}}}}`)
        expect(note(over).map((n) => n[1])).toEqual(['each-reparse'])
        expect(over.valueDependent).toBe(true)
    })

    test('the character budget: what fits is judged, what does not stops', () => {
        expect(EACH_CHAR_BUDGET).toBe(200_000)
        const body = 'a'.repeat(1000)
        const header = (n: number) => `[${Array.from({ length: n }, () => '1').join(',')}]`
        expect(check(`{{#each ${header(200)} as x}}${body}{{/each}}`).valueDependent).toBe(false)
        expect(check(`{{#each ${header(201)} as x}}${body}{{/each}}`).valueDependent).toBe(true)
    })

    test('the budget is shared by every expansion of one check', () => {
        const body = 'a'.repeat(1000)
        const one = `{{#each [${Array.from({ length: 150 }, () => '1').join(',')}] as x}}${body}{{/each}}`
        expect(check(one).valueDependent).toBe(false)
        expect(check(one + one).valueDependent).toBe(true)
    })

    test('an element whose bound is over the budget stops, though its expansion would fit', () => {
        const text = `{{#each ["$'"] as x}}${'Q'.repeat(150_000)}{{slot::x}}{{/each}}`
        expect(checkCbsWithExpansions(`{{#each [1] as x}}${'Q'.repeat(150_000)}{{slot::x}}{{/each}}`, index, options()).expansions[0]).toHaveLength(150_001)
        expect(check(text).valueDependent).toBe(true)
    })

    test('a bound that fits only when $ is read literally is not taken literally', () => {
        const text = `{{#each ["$'"] as x}}${'Q'.repeat(120_000)}{{slot::x}}{{/each}}`
        const result = check(text)
        expect(result.valueDependent).toBe(true)
        expect(note(result).map((n) => n[1])).toEqual(['each-reparse'])
    })

    test('an expansion over the bound is never built', () => {
        const body = `${'x'.repeat(88)}{{slot::x}}`.repeat(1000)
        const spy = vi.spyOn(String.prototype, 'replaceAll')
        const result = check(`{{#each ["$'"] as x}}${body}{{/each}}`)
        const calls = spy.mock.calls.length
        spy.mockRestore()
        expect(result.valueDependent).toBe(true)
        expect(calls).toBe(0)
        const built = vi.spyOn(String.prototype, 'replaceAll')
        check('{{#each [1,2] as x}}{{slot::x}}{{/each}}')
        const builtCalls = built.mock.calls.length
        built.mockRestore()
        expect(builtCalls).toBe(2)
    })

    test('a return in the body stops at the closer, and only when something is expanded', () => {
        expect(note(check('{{#each [1] as x}}{{return::z}}{{/each}}'))).toEqual([[31, 'early-return']])
        expect(check('{{#each [] as x}}{{return::z}}{{/each}}').valueDependent).toBe(false)
    })
})

describe('problems found in an expansion', () => {
    test('are reported once per kind at the span of the outermost closer', () => {
        const text = '{{#each [1,2] as x}}{{#foo}}a{{/x}}{{/each}}'
        const result = check(text)
        expect(shape(result)).toEqual([`stray-block-close:35-44`])
        expect(result.problems[0].name).toBe('/x')
        expect(result.problems[0].end).toBeLessThanOrEqual(text.length)
    })

    test('are not reported again for a kind the body pass reported inside the same block', () => {
        const text = '{{#each [1,2] as x}}{{a{{/x}}}}{{/each}}'
        expect(shape(check(text))).toEqual(['stray-block-close:23-29'])
    })

    test('a problem of another kind in the same expansion is reported too', () => {
        const text = '{{#each [1,2] as x}}{{#foo}}a{{/x}}{{/each}}'
        const kinds = (result: CbsCheckResult) => result.problems.map((p) => p.kind)
        expect(kinds(check(text))).toEqual(['stray-block-close'])
        const more = '{{#each ["\\u007b\\u007bb"] as x}}{{#foo}}{{/x}}{{slot::x}}{{/each}}'
        expect(kinds(check(more))).toEqual(['stray-block-close', 'unclosed-macro'])
    })

    test('the macro being typed is never one that started in an expansion', () => {
        const text = '{{#each ["\\u007b\\u007ba"] as x}}{{slot::x}}{{/each}}'
        const closer = text.indexOf('{{/each}}')
        expect(shape(check(text))).toEqual([`unclosed-macro:${closer}-${closer + 9}`])
        expect(shape(check(text, { typingAt: text.length }))).toEqual([`unclosed-macro:${closer}-${closer + 9}`])
    })

    test('a stop inside an expansion drops its problems and stops at the closer', () => {
        const text = '}}{{#each [1] as x}}{{return::a}}{{#foo}}{{/q}}{{/each}}x}}'
        const result = check(text)
        expect(shape(result)).toEqual(['stray-macro-close:0-2', `not-static:${text.indexOf('{{/each}}')}-${text.indexOf('{{/each}}') + 9}`])
        expect(result.judgedUntil).toBe(text.indexOf('{{/each}}'))
    })
})
