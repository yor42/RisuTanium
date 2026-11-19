// Class G (new-behaviour guard): the scanner has no earlier version. Every row asserts each hit's key, offset and
// length, not only the key.
import { describe, expect, test } from 'vitest'
import type { TargetClass } from './assets/referenceTargets'
import { cbsPatternTargets, scanTextUses, type UseHit } from './toggleUses'

const A: ReadonlySet<string> = new Set(['a'])
const scan = (text: string, keys: ReadonlySet<string> = A, cls: TargetClass = 'rewritable', path = 'desc'): UseHit[] => scanTextUses(text, path, cls, keys)
const plain = (text: string, keys: ReadonlySet<string> = A): UseHit[] => scan(text, keys).filter((hit) => !hit.flag)
const sliceOf = (text: string, hit: UseHit): string => text.slice(hit.offset, hit.offset + hit.length)

describe('getglobalvar readers (U1)', () => {
    test.each([
        '{{getglobalvar::toggle_a}}',
        '{{GetGlobal_Var::toggle_a}}',
        '{{getglobalvar:toggle_a}}',
        '{{getglobalvar:toggle_a::x}}',
        '{{getglobalvar::toggle_a::x}}',
        '{#getglobalvar::toggle_a}}',
        '{{getglobalvar::toggle_a}}}',
    ])('%s has one hit on the key', (text) => {
        const hits = plain(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ key: 'a', length: 1, syntax: 'getglobalvar', path: 'desc' })
        expect(sliceOf(text, hits[0])).toBe('a')
        expect(text.slice(hits[0].offset - 'toggle_'.length, hits[0].offset)).toBe('toggle_')
    })

    test.each([
        '{{getglobalvar::toggle_a:b}}',
        '{{{getglobalvar::toggle_a}}}',
        '{{getglobalvar::toggle_a#}}',
        '{{getglobalvar::toggle_a',
        ':: toggle_a',
        'toggle_ab',
        '{{getvar::toggle_a}}',
        '{{getglobalvar::toggle_ab}}',
        '{{getglobalvar:: toggle_a}}',
    ])('%s has no hit and no listed row', (text) => {
        expect(scan(text)).toEqual([])
    })

    test('a static key beside a nested macro and a role-tag key are listed as dynamic names, never plain hits', () => {
        for (const text of ['{{getglobalvar::toggle_a{{x}}}}', '{{getglobalvar::toggle_<user>}}']) {
            const hits = scan(text)
            expect(hits).toHaveLength(1)
            expect(hits[0]).toMatchObject({ key: 'a', flag: 'dynamicName' })
            expect(text.slice(hits[0].offset, hits[0].offset + hits[0].length)).toBe(text.slice(2, -2))
        }
    })

    test('role tags before a dynamic name leave its offset and length in stored space: the slice is the macro text', () => {
        for (const prefix of ['<user>', '<char> x <BOT>', '<user><char><bot>']) {
            for (const macro of ['{{getglobalvar::toggle_a{{x}}}}', '{{getglobalvar::toggle_<user>}}']) {
                const text = `${prefix}${macro}`
                const hits = scan(text)
                expect(hits).toHaveLength(1)
                expect(hits[0]).toMatchObject({ key: 'a', flag: 'dynamicName' })
                expect(sliceOf(text, hits[0])).toBe(macro.slice(2, -2))
            }
        }
    })

    test('a hit key is compared exactly: a longer key sharing the prefix is another key', () => {
        const text = '{{getglobalvar::toggle_a}}{{getglobalvar::toggle_ab}}'
        expect(plain(text, new Set(['a', 'ab'])).map((hit) => [hit.key, sliceOf(text, hit)])).toEqual([['a', 'a'], ['ab', 'ab']])
    })
})

describe('role tags before a hit shift its offset by two each (U1 R1 to R5)', () => {
    const expectOffsets = (text: string, expected: number[]) => {
        const hits = plain(text)
        expect(hits.map((hit) => hit.offset)).toEqual(expected)
        for (const hit of hits) {
            expect(sliceOf(text, hit)).toBe('a')
        }
    }

    test('R1 a tag before the hit', () => {
        expectOffsets('<user>{{getglobalvar::toggle_a}}', [29])
    })
    test('R2 two tags of other case and kind before the hit', () => {
        expectOffsets('<CHAR> x <bot>{{getglobalvar::toggle_a}}', [37])
    })
    test('R3 a tag after the hit does not count', () => {
        expectOffsets('{{getglobalvar::toggle_a}}<user>', [23])
    })
    test('R4 a tag before two hits of different syntaxes', () => {
        expectOffsets('<Bot>{{#when::toggle::a}}x{{? @toggle_a}}', [22, 38])
    })
    test('R5 five tags before the hit and one directly after it', () => {
        const text = '<user>'.repeat(5) + '{{getglobalvar::toggle_a}}<user>'
        expectOffsets(text, [53])
    })
})

describe('#when readers (U2)', () => {
    test.each([
        'toggle::a',
        'x::and::toggle::a',
        'a::tis::1',
        'b::is::1::and::a::tisnot::2',
        'toggle::keep::a',
        'a::tis::v::vis::c',
        'a::tis::1::>::0',
        'legacy::toggle::a',
    ])('{{#when::%s}} has exactly one hit, on a', (body) => {
        const text = `{{#when::${body}}}`
        const hits = plain(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ key: 'a', length: 1, syntax: 'when' })
        expect(sliceOf(text, hits[0])).toBe('a')
        expect(text.slice(hits[0].offset - 2, hits[0].offset)).toBe('::')
    })

    test.each([
        '{{#when::toggle::a::and::1}}',
        '{{#When::toggle::a}}',
        '{{#when toggle a}}',
        '{{#when::a::tis::vis::a}}',
        '{{#when::a::tis::>::a}}',
    ])('%s has no hit', (text) => {
        expect(scan(text)).toEqual([])
    })
})

describe('calc readers (U3)', () => {
    test.each([
        '{{? @toggle_a + 1}}',
        '{{? @x::@toggle_a}}',
        '{{calc::@toggle_a*2}}',
        '{{calc::@toggle_a-1}}',
    ])('%s has one hit on the key', (text) => {
        const hits = plain(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ key: 'a', length: 1, syntax: 'calc' })
        expect(sliceOf(text, hits[0])).toBe('a')
    })

    test.each([
        '{{calc::@x::@toggle_a}}',
        '{{? @toggle_ab}}',
        '{{? $toggle_a}}',
        '@toggle_a',
    ])('%s has no hit', (text) => {
        expect(scan(text)).toEqual([])
    })

    test.each([
        '{{? @toggle_a(1)}}',
        '{{? @toggle_a$x}}',
        '{{calc::@toggle_a(1)}}',
        '{{calc::@toggle_a$x}}',
    ])('%s reads a longer key in the engine: the hit is listed as calcKey and is never a plain hit', (text) => {
        const hits = scan(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ key: 'a', length: 1, syntax: 'calc', flag: 'calcKey' })
        expect(sliceOf(text, hits[0])).toBe('a')
        expect(plain(text)).toEqual([])
    })

    test.each([
        '{{? (@toggle_a)*2}}',
        '{{? (@toggle_a + 1)}}',
        '{{? @toggle_a+(1)}}',
    ])('%s keeps a plain hit: a parenthesis around or after the name does not change the key', (text) => {
        expect(plain(text)).toHaveLength(1)
    })

    test('a key with `-` is never a calc hit: the engine captures letters, digits and `_` only', () => {
        expect(scan('{{? @toggle_a-b}}', new Set(['a-b']))).toEqual([])
    })
})

describe('dynamic names (U4)', () => {
    test.each([
        '{{getglobalvar::toggle_{{getvar::x}}}}',
        '{{getglobalvar::{{getvar::x}}}}',
        '{{#when::toggle::{{getvar::x}}}}',
        '{{? @toggle_{{getvar::x}}}}',
    ])('%s is listed as a dynamic name', (text) => {
        const hits = scan(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ key: 'a', flag: 'dynamicName' })
    })

    test.each([
        '{{getglobalvar::hp_{{getvar::x}}}}',
        '{{#when::{{getvar::hp}}::>::3}}',
    ])('%s reads no toggle and is not listed', (text) => {
        expect(scan(text)).toEqual([])
    })
})

describe('block structure (U5)', () => {
    test.each(['#pure', '#escape', '#puredisplay'])('a {{%s}} block lists every hit of the text as a literal block', (head) => {
        const text = `{{getglobalvar::toggle_a}}{{${head}}}{{getglobalvar::toggle_a}}{{/}}`
        const hits = scan(text)
        expect(hits.map((hit) => hit.flag)).toEqual(['literalBlock', 'literalBlock'])
        expect(hits.map((hit) => sliceOf(text, hit))).toEqual(['a', 'a'])
    })

    test.each([
        '{{#each [1] as x}}{{getglobalvar::toggle_a}}{{/each}}',
        '{{#if 0}}{{getglobalvar::toggle_a}}{{/if}}',
        '{{#func f}}{{getglobalvar::toggle_a}}{{/func}}',
        '{{#if 1}}{{getglobalvar::toggle_a}}{{/if}}',
    ])('%s stays rewritable', (text) => {
        const hits = scan(text)
        expect(hits).toHaveLength(1)
        expect(hits[0].flag).toBeUndefined()
        expect(sliceOf(text, hits[0])).toBe('a')
    })

    test('a `}}` above an open block level stays text, so the reader never closes', () => {
        expect(scan('{{getglobalvar::{{#if 1}}}}toggle_a}}{{/if}}')).toEqual([])
    })

    test('inside a pure body a block-start macro opens a level of its own, so a `}}` above it stays text too', () => {
        expect(scan('{{#each [1] as x}}{{getglobalvar::{{#if 1}}}}toggle_a}}{{/if}}}}{{/each}}')).toEqual([])
    })

    test('a reader after a closed block is read again', () => {
        const text = '{{#if 1}}x{{/if}}{{getglobalvar::toggle_a}}'
        expect(plain(text)).toHaveLength(1)
    })
})

describe('flag-only texts (U6) and patterns (U9)', () => {
    test('a literal toggle_<key> in script code is listed as code, once', () => {
        const text = 'local v = getGlobal("toggle_a") .. "{{getglobalvar::toggle_a}}"'
        const hits = scan(text, A, 'flagOnly', 'trigger/0/effect/0/code')
        expect(hits.map((hit) => hit.flag)).toEqual(['code', 'code'])
        expect(hits.map((hit) => sliceOf(text, hit))).toEqual(['a', 'a'])
    })

    test.each(['toggle_ab', 'xtoggle_a', 'toggle_a9', 'toggle_a_'])('%s in script code is not listed', (text) => {
        expect(scan(text, A, 'flagOnly', 'cjs')).toEqual([])
    })

    test('a hit in a regex in pattern is flagged as a pattern that runs macros', () => {
        const text = 'x{{getglobalvar::toggle_a}}'
        const hits = scan(text, A, 'flagOnly', 'regex/3/in')
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ flag: 'regexPattern', key: 'a', path: 'regex/3/in' })
        expect(sliceOf(text, hits[0])).toBe('a')
    })

    test('cbsPatternTargets names the in pattern of a script whose flag group holds cbs', () => {
        const script = (flag: string | undefined, text = 'p') => ({ comment: 'c', in: text, out: '', type: 'editdisplay', flag, ableFlag: true })
        const character = {
            kind: 'character' as const,
            source: {
                customscript: [script('<cbs>', 'one'), script('<order 2, cbs>', 'two'), script('< cbs >', 'three'), script('g'), script('<cbsx>'), script(undefined)],
            },
        }
        expect(cbsPatternTargets(character)).toEqual([
            { path: 'regex/0/in', text: 'one', cls: 'flagOnly' },
            { path: 'regex/1/in', text: 'two', cls: 'flagOnly' },
            { path: 'regex/2/in', text: 'three', cls: 'flagOnly' },
        ])
        expect(cbsPatternTargets({ kind: 'module', source: { regex: [script('<cbs>', 'm')] } })).toEqual([{ path: 'regex/0/in', text: 'm', cls: 'flagOnly' }])
    })
})

describe('keys of any script (U7f scanner side)', () => {
    test('a Hangul key is a getglobalvar and #when hit but never a calc hit', () => {
        const text = '{{getglobalvar::toggle_기분}}{{#when::toggle::기분}}{{? @toggle_기분}}'
        const hits = scan(text, new Set(['기분']))
        expect(hits.map((hit) => hit.syntax)).toEqual(['getglobalvar', 'when'])
        expect(hits.map((hit) => sliceOf(text, hit))).toEqual(['기분', '기분'])
    })
})
