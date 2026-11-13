// @vitest-environment node
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { checkCbs, type CbsCheckOptions, type CbsCheckResult, type CbsProblemKind } from './cbsCheck'
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

// These rows judge only the scanner kinds (pairing, blocks, stops); the advisory kinds have their own
// files, so `check` leaves them out.
const ADVISORY_KINDS = new Set<CbsProblemKind>(['unknown-macro', 'not-a-block', 'misplaced-else', 'slot-outside', 'deprecated'])

const check = (text: string, extra: Partial<CbsCheckOptions> = {}): CbsCheckResult => {
    const result = checkCbs(text, index, { mode: 'cbs', slotAllowed: false, ...extra })
    return { ...result, problems: result.problems.filter((p) => !ADVISORY_KINDS.has(p.kind)) }
}

// `kind:start-end` per problem, in source order.
const shape = (result: CbsCheckResult) => result.problems.map((p) => `${p.kind}:${p.start}-${p.end}`)

describe('pairing of macro closers', () => {
    test.each<[string, string[]]>([
        ['a}}b', ['stray-macro-close:1-3']],
        ['}}}', ['stray-macro-close:0-2']],
        ['}}}}', ['stray-macro-close:0-2', 'stray-macro-close:2-4']],
        ['}}}}}', ['stray-macro-close:0-2', 'stray-macro-close:2-4']],
        ['{{a}}}}', ['stray-macro-close:5-7']],
        ['}', []],
        ['}{{blank}}}', []],
        ['{{blank}}}}}', ['stray-macro-close:9-11']],
    ])('cbs mode: %j gives %j', (text, expected) => {
        expect(shape(check(text))).toEqual(expected)
    })

    test('html+cbs mode reports no stray macro closer and keeps every other problem', () => {
        expect(shape(check('a}}b', { mode: 'html+cbs' }))).toEqual([])
        expect(shape(check('}}{{x', { mode: 'html+cbs' }))).toEqual(['unclosed-macro:2-4'])
        expect(shape(check('}}{{x', { mode: 'cbs' }))).toEqual(['stray-macro-close:0-2', 'unclosed-macro:2-4'])
    })

    test.each<[string, string[]]>([
        ['{{#}}', []],
        ['{#x#}', []],
        ['{#x}}', []],
        ['{{x}}', []],
        ['{{x', ['unclosed-macro:0-2']],
        ['{#x', ['unclosed-macro:0-2']],
        ['{#trim::a', ['unclosed-macro:0-2']],
        ['{{{{a}}', ['unclosed-macro:0-2']],
        ['#}', []],
        ['{{#if 1}}#}{{/if}}', []],
        ['{{#if 1}}#}', ['unclosed-block:0-9']],
        ['{{#if 1}}a{{/if}}', []],
    ])('legacy frames and unclosed text: %j gives %j', (text, expected) => {
        expect(shape(check(text))).toEqual(expected)
    })

    test('a role tag is a macro frame, even after a brace', () => {
        expect(shape(check('{<user>'))).toEqual([])
        expect(shape(check('<char>{<bot>'))).toEqual([])
        expect(shape(check('<user>{{x'))).toEqual(['unclosed-macro:6-8'])
    })

    test('a role tag inside braces is a nested value of the frame around it', () => {
        const result = check('{{<user>}}')
        expect(result.problems.map((p) => [p.kind, p.start, p.end, p.reason])).toEqual([['not-static', 0, 10, 'dynamic-name']])
    })

    test('positions after a role tag map back to the original text', () => {
        expect(shape(check('<user> }}'))).toEqual(['stray-macro-close:7-9'])
        expect(shape(check('<USER><Char>}}'))).toEqual(['stray-macro-close:12-14'])
        expect(shape(check('a<bot>{{b'))).toEqual(['unclosed-macro:6-8'])
    })

    test('an unclosed block names its opener span and head', () => {
        const result = check('<user>{{#if 1}}x')
        expect(result.problems).toHaveLength(1)
        expect(result.problems[0]).toMatchObject({ kind: 'unclosed-block', start: 6, end: 15, name: '#if 1' })
    })

    test('lines count line feeds, so CRLF text has the same line numbers as LF text', () => {
        const crlf = check('a\r\nb\r\n}}')
        const lf = check('a\nb\n}}')
        expect(crlf.problems.map((p) => p.line)).toEqual([3])
        expect(lf.problems.map((p) => p.line)).toEqual([3])
        expect(check('x\r\n{{a\r\n{{b').problems.map((p) => p.line)).toEqual([2, 3])
    })

    test('severity: errors for unclosed and stray block closes, info for a stray macro close', () => {
        const result = check('}}{{/x}}{{a')
        expect(result.problems.map((p) => `${p.kind}:${p.severity}`)).toEqual([
            'stray-macro-close:info',
            'stray-block-close:error',
            'unclosed-macro:error',
        ])
        expect(check('{{#if 1}}').problems[0].severity).toBe('error')
    })

    test('a closer with nothing to close is a stray block close; a type-1 top does not count as a block', () => {
        expect(shape(check('{{/x}}'))).toEqual(['stray-block-close:0-6'])
        expect(shape(check('{{// note}}'))).toEqual([])
        expect(shape(check('{{a{{/x}}}}'))).toEqual(['stray-block-close:3-9'])
        expect(shape(check('{{#if 1}}{{/x}}'))).toEqual([])
    })
})

describe('pure state', () => {
    test('a head left as text in a pure body is a frame, closed by its own closer', () => {
        expect(shape(check('{{#pure}}{{#x}}{{/x}}{{/pure}}'))).toEqual([])
        expect(shape(check('{{#if 0}}{{#x}}{{/if}}'))).toEqual(['unclosed-block:0-9'])
        expect(shape(check('{{#if 0}}{{:else}}{{/if}}'))).toEqual([])
    })

    test('in a body that is only maybe pure, a macro or :else does not stop the scan', () => {
        expect(check('{{#if {{getvar::c}}}}{{x}}{{/if}}').valueDependent).toBe(false)
        expect(check('{{#if {{getvar::c}}}}a{{:else}}b{{/if}}').valueDependent).toBe(false)
    })

    test('in a body that is only maybe pure, a head the engine would leave as text stops the scan', () => {
        const result = check('{{#if {{getvar::c}}}}{{#foo}}x{{/foo}}{{/if}}')
        expect(result.valueDependent).toBe(true)
        expect(result.judgedUntil).toBe(21)
        expect(result.problems.map((p) => [p.kind, p.start, p.end, p.reason])).toEqual([['not-static', 21, 29, 'maybe-pure']])
    })

    test('the same head is plain text outside a pure body', () => {
        expect(check('{{#foo}}x').valueDependent).toBe(false)
        expect(shape(check('{{#foo}}x{{/foo}}'))).toEqual(['stray-block-close:9-17'])
    })

    test('static legacy bodies are judged: an ignored body is pure, a kept one is not', () => {
        expect(shape(check('{{#when::legacy::0}}}}{{/when}}'))).toEqual(['stray-macro-close:20-22'])
        expect(shape(check('{{#when::legacy::1}}{{#foo}}{{/foo}}{{/when}}'))).toEqual(['stray-block-close:36-45'])
        expect(shape(check('{{#when::legacy::0}}{{#foo}}{{/foo}}{{/when}}'))).toEqual([])
    })

    test('a chat-state legacy fold leaves the body maybe pure', () => {
        const result = check('{{#when::legacy::var::x}}{{#foo}}{{/foo}}{{/when}}')
        expect(result.valueDependent).toBe(true)
        expect(result.problems.map((p) => p.reason)).toEqual(['maybe-pure'])
    })

    test('a pure block closes and the scan is no longer pure', () => {
        expect(check('{{#pure}}x{{/pure}}{{#foo}}y').valueDependent).toBe(false)
        expect(shape(check('{{#pure}}x{{/pure}}{{#foo}}y'))).toEqual([])
        expect(shape(check('{{#pure}}x{{/pure}}{{/x}}'))).toEqual(['stray-block-close:19-25'])
    })

    test('a nested maybe block returns the state to the outer one on close', () => {
        const text = '{{#if {{getvar::c}}}}{{#if {{getvar::d}}}}{{/if}}{{x}}{{/if}}'
        expect(check(text).valueDependent).toBe(false)
        expect(shape(check(`${text}{{#foo}}`))).toEqual([])
    })
})

describe('pairing does not depend on the enclosing block', () => {
    const CONTEXTS = ['#pure', '#if 0', '#if {{getvar::c}}', '#escape', '#when 1']
    const closerOf = (head: string) => `{{/${head.split(' ')[0].slice(1)}}}`

    test.each(CONTEXTS)('a stray }} and an unclosed {{ inside {{%s}}', (head) => {
        const open = `{{${head}}}`
        expect(shape(check(`${open}a}}b${closerOf(head)}`))).toEqual([`stray-macro-close:${open.length + 1}-${open.length + 3}`])
        const unclosed = check(`${open}{{x${closerOf(head)}`)
        expect(shape(unclosed)).toEqual([
            `unclosed-block:0-${open.length}`,
            `unclosed-macro:${open.length}-${open.length + 2}`,
            `stray-block-close:${open.length + 3}-${open.length + 3 + closerOf(head).length}`,
        ])
    })
})

describe('freezes', () => {
    test('an evaluated return stops the scan at the macro; earlier problems stay, later ones are dropped', () => {
        const result = check('a}}{{return::x}}}}{{/y}}{{z')
        expect(result.valueDependent).toBe(true)
        expect(result.judgedUntil).toBe(3)
        expect(result.problems.map((p) => [p.kind, p.start, p.end, p.reason])).toEqual([
            ['stray-macro-close', 1, 3, undefined],
            ['not-static', 3, 16, 'early-return'],
        ])
    })

    test('a result that is not frozen is judged to the end', () => {
        const result = check('a}}b')
        expect(result.valueDependent).toBe(false)
        expect(result.judgedUntil).toBe(4)
    })

    test.each<[string, boolean]>([
        ['{{return::x}}', true],
        ['{{#when 0}}{{return::x}}{{/when}}', true],
        ['{{#if {{getvar::c}}}}{{return::x}}{{/if}}', true],
        ['{{#pure}}{{return::x}}{{/pure}}', false],
        ['{{#if 0}}{{return::x}}{{/if}}', false],
        ['{{#escape}}{{return::x}}{{/escape}}', false],
        ['{{ret{{getvar::d}}::x}}', true],
        ['{{x{{getvar::d}}}}', false],
        ['{{getvar::d{{x}}}}', false],
        ['{{Return::x}}', true],
        ['{{re-turn::x}}', true],
        ['{{returns::x}}', false],
    ])('%j freezes: %s', (text, frozen) => {
        const result = check(text)
        expect(result.valueDependent).toBe(frozen)
        if(frozen){
            expect(result.problems.filter((p) => p.reason === 'early-return')).toHaveLength(1)
        }
    })

    test('a name that is only a prefix of return freezes when part of it is a nested value', () => {
        expect(check('{{r{{getvar::d}}}}').problems.map((p) => p.reason)).toEqual(['early-return'])
        expect(check('{{{{getvar::d}}}}').problems.map((p) => p.reason)).toEqual(['dynamic-name'])
        expect(check('{{ {{getvar::d}}}}').problems.map((p) => p.reason)).toEqual(['early-return'])
    })

    test('a head that is a nested value for its first character stops the scan', () => {
        expect(check('{{#if {{x}}}}a').valueDependent).toBe(false)
        expect(check('{{#pur{{x}}}}a').problems.map((p) => p.reason)).toEqual(['dynamic-name'])
        expect(check('{{/{{x}}}}').problems.map((p) => p.reason)).toEqual(['dynamic-name'])
        expect(check('{{:el{{x}}}}').problems.map((p) => p.reason)).toEqual([])
        expect(check('{{#pure}}{{:el{{x}}}}').problems.map((p) => p.reason)).toEqual(['dynamic-name'])
    })

    test('an #each over a value-dependent array stops the scan at its close', () => {
        const result = check('}}{{#each {{getvar::l}} as x}}a{{/each}}}}')
        expect(result.problems.map((p) => [p.kind, p.start, p.reason])).toEqual([
            ['stray-macro-close', 0, undefined],
            ['not-static', 31, 'each-reparse'],
        ])
        expect(result.judgedUntil).toBe(31)
        expect(check('{{#each {{getvar::l}} as x}}a').valueDependent).toBe(false)
    })

    test('an #each over a literal array within the caps does not stop the scan', () => {
        const result = check('}}{{#each [1] as x}}a{{/each}}}}')
        expect(result.problems.map((p) => [p.kind, p.start, p.reason])).toEqual([
            ['stray-macro-close', 0, undefined],
            ['stray-macro-close', 30, undefined],
        ])
        expect(result.valueDependent).toBe(false)
    })

    test('the engine frame limit: 510 open frames are judged, one more stops the scan', () => {
        const ok = check('{{a'.repeat(510))
        expect(ok.valueDependent).toBe(false)
        expect(ok.problems.filter((p) => p.kind === 'unclosed-macro')).toHaveLength(510)
        const over = check('{{a'.repeat(511))
        expect(over.valueDependent).toBe(true)
        expect(over.problems.map((p) => p.reason).filter(Boolean)).toEqual(['depth'])
        expect(over.judgedUntil).toBe(510 * 3)
        expect(over.problems.at(-1)).toMatchObject({ kind: 'not-static', start: 1530, end: 1532 })
    })

    test('a frame-limit stop that ends inside a replaced tag ends at the tag end in the text', () => {
        const over = check('{{x'.repeat(510) + '{<user>')
        expect(over.problems.at(-1)).toMatchObject({ kind: 'not-static', start: 1530, end: 1537, reason: 'depth' })
    })

    test('nothing is reported after a freeze, whatever follows', () => {
        const result = check('{{return::x}}}}{{/x}}{{a')
        expect(result.problems.map((p) => p.kind)).toEqual(['not-static'])
    })

    test('a problem inside the frozen construct is dropped', () => {
        const result = check('{{ret{{/x}}{{getvar::d}}::y}}')
        expect(result.problems.map((p) => p.kind)).toEqual(['not-static'])
        expect(result.judgedUntil).toBe(0)
    })

    test('without a return entry in the index nothing freezes on a return', () => {
        const bare = createMacroIndex([entry('trim')])
        expect(checkCbs('{{return::x}}', bare, { mode: 'cbs', slotAllowed: false }).valueDependent).toBe(false)
        const doc = createMacroIndex([entry('return', { docOnly: true })])
        expect(checkCbs('{{return::x}}', doc, { mode: 'cbs', slotAllowed: false }).valueDependent).toBe(false)
    })

    test('an alias of return freezes too', () => {
        const aliased = createMacroIndex([entry('return', { aliases: ['halt'] })])
        const result = checkCbs('{{halt::x}}', aliased, { mode: 'cbs', slotAllowed: false })
        expect(result.valueDependent).toBe(true)
    })
})

describe('the macro being typed', () => {
    test('only the innermost open {{ that starts before the cursor is exempt', () => {
        expect(shape(check('{{a {{b', { typingAt: 7 }))).toEqual(['unclosed-macro:0-2'])
        expect(shape(check('{{a {{b', { typingAt: 4 }))).toEqual(['unclosed-macro:4-6'])
        expect(shape(check('{{a {{b', { typingAt: 3 }))).toEqual(['unclosed-macro:4-6'])
        expect(shape(check('{{a {{b', { typingAt: 0 }))).toEqual(['unclosed-macro:0-2', 'unclosed-macro:4-6'])
        expect(shape(check('{{a {{b'))).toEqual(['unclosed-macro:0-2', 'unclosed-macro:4-6'])
    })

    test('the cursor exempts one frame, not every open frame before it', () => {
        expect(shape(check('{{a {{b {{c', { typingAt: 11 }))).toEqual(['unclosed-macro:0-2', 'unclosed-macro:4-6'])
    })

    test('a closed frame before the cursor exempts nothing, and an open block is still reported', () => {
        expect(shape(check('{{a}} {{b', { typingAt: 9 }))).toEqual([])
        expect(shape(check('{{#if 1}}{{b', { typingAt: 12 }))).toEqual(['unclosed-block:0-9'])
    })

    test('the cursor position is an original offset, after a role tag', () => {
        expect(shape(check('<user>{{b', { typingAt: 9 }))).toEqual([])
        expect(shape(check('<user>{{b', { typingAt: 7 }))).toEqual([])
        expect(shape(check('<user>{{b', { typingAt: 6 }))).toEqual(['unclosed-macro:6-8'])
    })
})

describe('brace alphabets', () => {
    const ALPHABET = ['{{', '}}', '}', 'a', '{#', '#}']
    const CONTEXTS: [string, string][] = [
        ['', ''],
        ['{{#pure}}', '{{/pure}}'],
        ['{{#if 0}}', '{{/if}}'],
        ['{{#if {{getvar::c}}}}', '{{/if}}'],
        ['{{#escape}}', '{{/escape}}'],
        ['{{#when 1}}', '{{/when}}'],
    ]
    const PAIRING = new Set(['stray-macro-close', 'unclosed-macro'])

    test('macro pairing reads the same at the root and inside five blocks', () => {
        fc.assert(
            fc.property(fc.array(fc.constantFrom(...ALPHABET), { maxLength: 12 }), (tokens) => {
                const body = tokens.join('')
                const root = check(body)
                const rootPairing = root.problems.filter((p) => PAIRING.has(p.kind)).map((p) => `${p.kind}@${p.start}`)
                for(const [open, close] of CONTEXTS){
                    const inside = check(`${open}${body}${close}`)
                    expect(inside.valueDependent, `${open}${body}${close}`).toBe(root.valueDependent)
                    if(root.valueDependent){
                        expect(inside.judgedUntil - open.length).toBe(root.judgedUntil)
                        continue
                    }
                    const insidePairing = inside.problems
                        .filter((p) => PAIRING.has(p.kind) && p.start >= open.length && p.start < open.length + body.length)
                        .map((p) => `${p.kind}@${p.start - open.length}`)
                    expect(insidePairing, `${open}${body}${close}`).toEqual(rootPairing)
                    if(open !== ''){
                        const leavesOpen = root.problems.some((p) => p.kind === 'unclosed-macro')
                        expect(inside.problems.some((p) => p.kind === 'unclosed-block'), `${open}${body}${close}`).toBe(leavesOpen)
                    }
                }
            }),
            { seed: 20261113, numRuns: 400 },
        )
    })
})

describe('static and frozen generated texts', () => {
    const STATIC = [
        'x', ' ', '\n', '{{a}}', '{{trim::b}}', '{#a#}', '}}', '}', '{{#if 1}}', '{{#if 0}}', '{{#pure}}', '{{#when 1}}',
        '{{#escape}}', '{{#foo}}', '{{/if}}', '{{/x}}', '{{:else}}', '{{// c}}', '<user>', '{{#}}', '#}', '{{#func f}}',
    ]
    const FROZEN = [
        ...STATIC, '{{return::x}}', '{{ret{{getvar::d}}::x}}', '{{{{getvar::d}}}}', '{{#if {{getvar::c}}}}', '{{#each [1] as x}}',
        '{{/each}}', '{{#when::legacy::var::x}}', '{{#pur{{getvar::d}}}}',
    ]

    test('a text with no nested value, no return, no #each and few frames never stops', () => {
        fc.assert(
            fc.property(fc.array(fc.constantFrom(...STATIC), { maxLength: 14 }), fc.boolean(), (tokens, openTail) => {
                const text = tokens.join('') + (openTail ? '{{a' : '')
                const result = check(text)
                expect(result.valueDependent, text).toBe(false)
                expect(result.judgedUntil).toBe(text.length)
                expect(result.problems.some((p) => p.kind === 'not-static')).toBe(false)
            }),
            { seed: 20261113, numRuns: 400 },
        )
    })

    test('when the scan stops, every other problem starts before the stop and there is one stop line', () => {
        fc.assert(
            fc.property(fc.array(fc.constantFrom(...FROZEN), { maxLength: 12 }), (tokens) => {
                const text = tokens.join('')
                const result = check(text)
                const stops = result.problems.filter((p) => p.kind === 'not-static')
                if(!result.valueDependent){
                    expect(stops).toHaveLength(0)
                    expect(result.judgedUntil).toBe(text.length)
                    return
                }
                expect(stops).toHaveLength(1)
                expect(stops[0].start).toBe(result.judgedUntil)
                for(const p of result.problems){
                    if(p.kind !== 'not-static'){
                        expect(p.start, text).toBeLessThan(result.judgedUntil)
                    }
                    expect(p.start).toBeGreaterThanOrEqual(0)
                    expect(p.end).toBeLessThanOrEqual(text.length)
                    expect(p.end).toBeGreaterThan(p.start)
                }
            }),
            { seed: 20261113, numRuns: 400 },
        )
    })
})
