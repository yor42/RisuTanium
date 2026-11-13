// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { checkCbs, type CbsCheckOptions, type CbsCheckResult, type CbsProblemKind } from './cbsCheck'
import { createMacroIndex, type MacroEntry } from './macroIndex'

vi.mock(import('../../stores.svelte'), () => ({
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('../../stores.svelte'))

import { collectMacroEntries } from './macroRegistry'

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

// What the registry would answer for the names the rows use; `video-img` is missing on purpose, so the
// asset-display rule is what keeps it quiet.
const index = createMacroIndex([
    entry('return'),
    entry('trim'),
    entry('getvar'),
    entry('blank'),
    entry('slot', { docOnly: true }),
    entry('inlay', { docOnly: true }),
    entry('#if', { docOnly: true, blockSyntax: true, deprecated: { message: 'use #when', replacement: '#when' } }),
    entry('#if_pure', { docOnly: true, blockSyntax: true, deprecated: { message: 'use #when', replacement: '#when' } }),
    entry('#pure', { docOnly: true, blockSyntax: true, deprecated: { message: 'use #puredisplay' } }),
    entry('oldmacro', { deprecated: { message: 'gone', replacement: 'newmacro' } }),
])

const check = (text: string, extra: Partial<CbsCheckOptions> = {}): CbsCheckResult =>
    checkCbs(text, index, { mode: 'cbs', slotAllowed: false, ...extra })

const ofKind = (result: CbsCheckResult, kind: CbsProblemKind) => result.problems.filter((p) => p.kind === kind)
const spans = (result: CbsCheckResult, kind: CbsProblemKind) => ofKind(result, kind).map((p) => `${p.start}-${p.end}`)

describe('unknown macros', () => {
    test('a complete frame whose name reaches no entry is a warning with its span, line and name', () => {
        const result = check('a\n{{nope::x}}')
        expect(ofKind(result, 'unknown-macro')).toEqual([
            { kind: 'unknown-macro', severity: 'warning', start: 2, end: 13, line: 2, name: 'nope' },
        ])
        expect(result.valueDependent).toBe(false)
    })

    test('names are normalised the way the engine normalises them', () => {
        for(const text of ['{{TRIM::a}}', '{{ t_r-i m::a}}', '{{Get Var::x}}', '{{blank}}', '{{trim:a}}']){
            expect(spans(check(text), 'unknown-macro'), text).toEqual([])
        }
        expect(spans(check('{{NoPe}}'), 'unknown-macro')).toEqual(['0-8'])
        expect(spans(check('{{ }}'), 'unknown-macro')).toEqual(['0-5'])
    })

    test('a calculation, a comment and a function call are not looked up', () => {
        for(const text of ['{{? 1+1}}', '{{// a note}}', '{{call::f::1}}']){
            expect(spans(check(text), 'unknown-macro'), text).toEqual([])
        }
    })

    test('an asset-display name before :: is left to the display step; a different spelling is not', () => {
        for(const name of ['raw', 'path', 'img', 'image', 'video', 'audio', 'bgm', 'bg', 'emotion', 'asset', 'video-img', 'source']){
            expect(spans(check(`{{${name}::a}}`), 'unknown-macro'), name).toEqual([])
        }
        expect(spans(check('{{video-img::a}}'), 'unknown-macro')).toEqual([])
        expect(spans(check('{{VIDEO-IMG::a}}'), 'unknown-macro')).toEqual(['0-16'])
        expect(spans(check('{{video-img}}'), 'unknown-macro')).toEqual(['0-13'])
        expect(spans(check('{{ img::a}}'), 'unknown-macro')).toEqual(['0-11'])
    })

    test('a documented-only name is known', () => {
        expect(spans(check('{{inlay::x}}'), 'unknown-macro')).toEqual([])
    })

    test('a name a value decides is not judged, and a static name before a value is', () => {
        const dynamic = check('{{no{{getvar::a}}}}')
        expect(spans(dynamic, 'unknown-macro')).toEqual([])
        expect(dynamic.valueDependent).toBe(false)
        expect(spans(check('{{nope::{{getvar::a}}}}'), 'unknown-macro')).toEqual(['0-23'])
    })

    test('inside a block whose body is evaluated it is reported, also where the block may be dropped', () => {
        for(const text of ['{{#when 1}}{{nope}}{{/when}}', '{{#if 1}}{{nope}}{{/if}}', '{{#when 0}}{{nope}}{{/when}}']){
            expect(ofKind(check(text), 'unknown-macro'), text).toHaveLength(1)
        }
        const maybe = check('{{#when::{{getvar::c}}}}{{nope}}{{/when}}')
        expect(ofKind(maybe, 'unknown-macro')).toHaveLength(1)
        expect(maybe.valueDependent).toBe(false)
    })

    test('inside a pure, ignored, escaped, function or each body it is not reported', () => {
        for(const text of [
            '{{#pure}}{{nope}}{{/pure}}',
            '{{#puredisplay}}{{nope}}{{/puredisplay}}',
            '{{#escape}}{{nope}}{{/escape}}',
            '{{#if 0}}{{nope}}{{/if}}',
            '{{#func f}}{{nope}}{{/func}}',
            '{{#each [1] as x}}{{nope}}{{/each}}',
            '{{#each {{getvar::l}} as x}}{{nope}}{{/each}}',
            '{{#if 1}}{{#pure}}{{nope}}{{/pure}}{{/if}}',
        ]){
            expect(spans(check(text), 'unknown-macro'), text).toEqual([])
        }
    })

    test('text an #each element brings in is not judged for names or slots', () => {
        const unknownElement = '{{#each ["\\u007b\\u007bnope\\u007d\\u007d"] as x}}{{slot::x}}{{/each}}'
        const result = check(unknownElement)
        expect(result.problems).toEqual([])
        expect(result.valueDependent).toBe(false)
        const slotElement = '{{#each ["\\u007b\\u007bslot::z\\u007d\\u007d"] as x}}{{slot::x}}{{/each}}'
        expect(check(slotElement).problems).toEqual([])
    })

    test('after a pure block closes, the following text is judged again', () => {
        expect(spans(check('{{#pure}}{{nope}}{{/pure}}{{nope}}'), 'unknown-macro')).toEqual(['26-34'])
    })
})

describe('text that is no block', () => {
    test('a head that starts a block in no pure state but matches none is a warning', () => {
        const result = check('a{{#foo}}b{{:bar x}}')
        expect(ofKind(result, 'not-a-block')).toEqual([
            { kind: 'not-a-block', severity: 'warning', start: 1, end: 9, line: 1, name: '#foo' },
            { kind: 'not-a-block', severity: 'warning', start: 10, end: 20, line: 1, name: ':bar x' },
        ])
    })

    test('inside a pure body the same head is a counted frame, not text, and is not reported', () => {
        expect(ofKind(check('{{#pure}}{{#foo}}{{/foo}}{{/pure}}'), 'not-a-block')).toEqual([])
    })

    test('a real block head and the misplaced-else head are not reported as no block', () => {
        expect(ofKind(check('{{#when 1}}a{{/when}}'), 'not-a-block')).toEqual([])
        expect(ofKind(check('{{:else}}'), 'not-a-block')).toEqual([])
    })
})

describe('an :else its block does not read', () => {
    const elseText = (kind: string) => (text: string) => spans(check(text), kind as CbsProblemKind)

    test('with no block around it', () => {
        const result = check('a\n{{:else}}')
        expect(ofKind(result, 'misplaced-else')).toEqual([
            { kind: 'misplaced-else', severity: 'warning', start: 2, end: 11, line: 2, name: ':else' },
        ])
    })

    test('inside a block whose type never reads it, also when an else-capable block is further out', () => {
        const misplaced = elseText('misplaced-else')
        expect(misplaced('{{#if 1}}a{{:else}}b{{/if}}')).toEqual(['10-19'])
        expect(misplaced('{{#when::legacy::1}}a{{:else}}b{{/when}}')).toEqual(['21-30'])
        expect(misplaced('{{#when 1}}{{#if 1}}{{:else}}{{/if}}{{/when}}')).toEqual(['20-29'])
    })

    test('the second :else of an else-capable block, and only that one', () => {
        const misplaced = elseText('misplaced-else')
        expect(misplaced('{{#when 1}}a{{:else}}b{{:else}}c{{/when}}')).toEqual(['22-31'])
        expect(misplaced('{{#when 1}}a{{:else}}b{{/when}}')).toEqual([])
        expect(misplaced('{{#when 1}}a{{#when 0}}b{{:else}}c{{/when}}{{:else}}d{{/when}}')).toEqual([])
    })

    test('silent where the block is read, where the type is only maybe else-capable and in a pure body', () => {
        const misplaced = elseText('misplaced-else')
        expect(misplaced('{{#when 1}}a{{:else}}b{{/when}}')).toEqual([])
        expect(misplaced('{{#when 0}}a{{:else}}b{{/when}}')).toEqual([])
        expect(misplaced('{{#when::{{getvar::c}}}}a{{:else}}b{{:else}}c{{/when}}')).toEqual([])
        expect(misplaced('{{#pure}}a{{:else}}b{{/pure}}')).toEqual([])
        expect(misplaced('{{#if 0}}a{{:else}}b{{/if}}')).toEqual([])
    })

    test('an :else that is the value of a macro belongs to no block and is not reported', () => {
        expect(spans(check('{{trim::{{:else}}}}'), 'misplaced-else')).toEqual([])
    })
})

describe('a slot outside a slot field', () => {
    test('is a warning without a slot field and silent with one', () => {
        const result = check('a {{slot::x}} b {{slot}}')
        expect(ofKind(result, 'slot-outside')).toEqual([
            { kind: 'slot-outside', severity: 'warning', start: 2, end: 13, line: 1, name: 'slot' },
            { kind: 'slot-outside', severity: 'warning', start: 16, end: 24, line: 1, name: 'slot' },
        ])
        expect(spans(check('a {{slot::x}} b {{slot}}', { slotAllowed: true }), 'slot-outside')).toEqual([])
    })

    test('the loop variable of an enclosing #each is exempt; the bare slot and another name are not', () => {
        expect(spans(check('{{#each [1,2] as x}}{{slot::x}}{{/each}}'), 'slot-outside')).toEqual([])
        expect(spans(check('{{#each [1,2] as x}}{{slot}}{{/each}}'), 'slot-outside')).toEqual(['20-28'])
        expect(spans(check('{{#each [1,2] as x}}{{slot::y}}{{/each}}'), 'slot-outside')).toEqual(['20-31'])
        expect(spans(check('{{#each [1,2] as x}}{{slot:x}}{{/each}}'), 'slot-outside')).toEqual(['20-30'])
    })

    test('a slot of an #each nested in the body is exempt under the inner loop variable', () => {
        const text = '{{#each [1,2] as x}}{{#each [3,4] as y}}{{slot::x}}{{slot::y}}{{/each}}{{/each}}'
        expect(spans(check(text), 'slot-outside')).toEqual([])
    })

    test('a slot in a body the engine never renders is skipped', () => {
        for(const text of [
            '{{#pure}}{{slot::x}}{{/pure}}',
            '{{#puredisplay}}{{slot::x}}{{/puredisplay}}',
            '{{#escape}}{{slot::x}}{{/escape}}',
            '{{#if 0}}{{slot::x}}{{/if}}',
            '{{#func f}}{{slot::x}}{{/func}}',
        ]){
            expect(spans(check(text), 'slot-outside'), text).toEqual([])
        }
        expect(spans(check('{{#if 1}}{{slot::x}}{{/if}}'), 'slot-outside')).toEqual(['9-20'])
    })

    test('under a loop variable a value decides, the named slot stops the scan instead of warning', () => {
        const text = '{{#each {{getvar::l}}}}{{slot::item}}{{/each}}'
        const result = check(text)
        expect(spans(result, 'slot-outside')).toEqual([])
        expect(result.valueDependent).toBe(true)
        expect(result.judgedUntil).toBe(text.indexOf('{{slot::item}}'))
        expect(result.problems.filter((p) => p.kind === 'not-static').map((p) => p.reason)).toEqual(['each-reparse'])
        expect(spans(check('{{#each {{getvar::l}} x}}{{slot::item}}{{/each}}'), 'slot-outside')).toEqual([])
    })

    test('a loop variable that ends in a value is not fixed by the text before that value', () => {
        const text = '{{#each {{getvar::l}} as it{{getvar::n}}}}{{slot::it}}{{/each}}'
        const result = check(text)
        expect(spans(result, 'slot-outside')).toEqual([])
        expect(result.judgedUntil).toBe(text.indexOf('{{slot::it}}'))
    })

    test('the bare slot still warns under such a loop variable, and the stop comes at the closer', () => {
        const text = '{{#each {{getvar::l}}}}{{slot}}{{/each}}'
        const result = check(text)
        expect(spans(result, 'slot-outside')).toEqual(['23-31'])
        expect(result.judgedUntil).toBe(text.indexOf('{{/each}}'))
    })

    test('a static tail with as fixes the loop variable, so the exempt slot does not stop the scan', () => {
        const text = '{{#each {{getvar::l}} as item}}{{slot::item}}x}}{{/each}}'
        const result = check(text)
        expect(spans(result, 'slot-outside')).toEqual([])
        expect(result.valueDependent).toBe(true)
        expect(result.judgedUntil).toBe(text.indexOf('{{/each}}'))
        expect(spans(result, 'stray-macro-close')).toEqual(['46-48'])
        expect(spans(check('{{#each {{getvar::l}} as item  }}{{slot::item}}{{/each}}'), 'slot-outside')).toEqual([])
    })

    test('with a slot field there is no stop at the slot', () => {
        const text = '{{#each {{getvar::l}}}}{{slot::item}}{{/each}}'
        const result = check(text, { slotAllowed: true })
        expect(result.judgedUntil).toBe(text.indexOf('{{/each}}'))
    })
})

describe('deprecated syntax', () => {
    test('a role tag is a deprecated info over its original span, with the pre-pass replacement as the fix', () => {
        const result = check('a <USER> b <char>')
        expect(ofKind(result, 'deprecated')).toEqual([
            { kind: 'deprecated', severity: 'info', start: 2, end: 8, line: 1, name: '<USER>', fix: { start: 2, end: 8, text: '{{USER}}' } },
            { kind: 'deprecated', severity: 'info', start: 11, end: 17, line: 1, name: '<char>', fix: { start: 11, end: 17, text: '{{char}}' } },
        ])
    })

    test('a later problem is positioned in the original text, behind the longer replacement', () => {
        const result = check('<user><bot> }}')
        expect(spans(result, 'stray-macro-close')).toEqual(['12-14'])
    })

    test('a role tag that starts a line before a colon has no fix, because the example parser reads it raw', () => {
        for(const text of ['<bot>: hi', '  <char>: hi', '<user>:hi', 'a\n<bot>: hi', 'a\r\n\t<char>:x']){
            const problems = ofKind(check(text), 'deprecated')
            expect(problems, text).toHaveLength(1)
            expect(problems[0].fix, text).toBeUndefined()
        }
    })

    test('a role tag elsewhere keeps its fix', () => {
        for(const text of ['x <bot>: hi', '<bot> : hi', '<char> hi', 'a\n<user> :', 'a:<char>:']){
            const problems = ofKind(check(text), 'deprecated')
            expect(problems.length, text).toBeGreaterThan(0)
            expect(problems.every((p) => p.fix !== undefined), text).toBe(true)
        }
    })

    test('a role tag after the scan stopped is still reported', () => {
        const result = check('{{{{getvar::d}}}}<user>')
        expect(result.valueDependent).toBe(true)
        expect(result.judgedUntil).toBe(0)
        expect(spans(result, 'deprecated')).toEqual(['17-23'])
    })

    test('a deprecated block names its registry entry and offers no fix', () => {
        const ifBlock = ofKind(check('{{#if 1}}a{{/if}}'), 'deprecated')
        expect(ifBlock).toEqual([{ kind: 'deprecated', severity: 'info', start: 0, end: 9, line: 1, name: '#if 1', registryName: '#if' }])
        expect(ofKind(check('{{#if_pure 1}}a{{/if_pure}}'), 'deprecated')[0]).toMatchObject({ registryName: '#if_pure', name: '#if_pure 1' })
        expect(ofKind(check('{{#pure}}a{{/pure}}'), 'deprecated')[0]).toMatchObject({ registryName: '#pure' })
        expect(ofKind(check('{{#when 1}}a{{/when}}'), 'deprecated')).toEqual([])
    })

    test('a deprecated macro names its entry; inside a pure body it is not reported', () => {
        expect(ofKind(check('{{oldmacro::a}}'), 'deprecated')).toEqual([
            { kind: 'deprecated', severity: 'info', start: 0, end: 15, line: 1, name: 'oldmacro', registryName: 'oldmacro' },
        ])
        expect(ofKind(check('{{#escape}}{{oldmacro::a}}{{/escape}}'), 'deprecated')).toEqual([])
    })

    test('a legacy brace block is a deprecated info with no fix and no entry', () => {
        expect(ofKind(check('a{#x#}'), 'deprecated')).toEqual([
            { kind: 'deprecated', severity: 'info', start: 1, end: 6, line: 1 },
        ])
        expect(ofKind(check('{#if 1\nb#}'), 'deprecated')).toHaveLength(1)
    })

    test('the deprecated kinds are reported in both modes', () => {
        expect(spans(check('<user>{#x#}', { mode: 'html+cbs' }), 'deprecated')).toEqual(['0-6', '6-11'])
    })
})

describe('severities', () => {
    test('one table gives each advisory kind its severity', () => {
        const result = check('{{nope}}{{#foo}}{{:else}}{{slot::a}}<user>')
        const bySeverity = Object.fromEntries(result.problems.map((p) => [p.kind, p.severity]))
        expect(bySeverity).toMatchObject({
            'unknown-macro': 'warning',
            'not-a-block': 'warning',
            'misplaced-else': 'warning',
            'slot-outside': 'warning',
            deprecated: 'info',
        })
    })
})

describe('the names the checker relies on, in the real registry', () => {
    const real = createMacroIndex(collectMacroEntries())

    test('the callable and documented-only names are what the rules assume', () => {
        for(const name of ['trim', 'blank', 'getvar', 'return']){
            const found = real.lookup(name)
            expect(found, name).not.toBeNull()
            expect(found?.docOnly, name).toBe(false)
        }
        for(const name of ['slot', '//', '?']){
            const found = real.lookup(name)
            expect(found, name).not.toBeNull()
            expect(found?.docOnly, name).toBe(true)
        }
    })

    test('the deprecated entries are exactly #if, #if_pure and #pure, and a name key drops the underscore', () => {
        const deprecated = real.entries.filter((e) => e.deprecated !== null).map((e) => e.name).sort()
        expect(deprecated).toEqual(['#if', '#if_pure', '#pure'])
        expect(real.lookup('#if_pure')).toBeNull()
    })

    test('a real deprecated block and a real unknown name are reported with the real registry', () => {
        const options: CbsCheckOptions = { mode: 'cbs', slotAllowed: false }
        const result = checkCbs('{{#if_pure 1}}{{nope}}{{/if_pure}}', real, options)
        expect(result.problems.map((p) => [p.kind, p.registryName ?? p.name])).toEqual([
            ['deprecated', '#if_pure'],
            ['unknown-macro', 'nope'],
        ])
    })
})
