// Class G (differential oracle): the scanner's static hits against the toggle keys the real `risuChatParser` reads.
// The oracle assumes the engine evaluates each reader once; a mismatch is a scanner defect and is never loosened.
import fc from 'fast-check'
import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks (the parser harness of cbsBlocks.parserDiff.test.ts)

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

// Every read of a `toggle_` key of the global variables is recorded; every value is falsy text.
const reads = vi.hoisted(() => [] as string[])
const globals = vi.hoisted(() => new Proxy({}, {
    get(_, prop) {
        if (typeof prop === 'string' && prop.startsWith('toggle_')) {
            reads.push(prop)
        }
        return '0'
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: {
        db: {
            characters: [{ chatPage: 0, chats: [{ scriptstate: {} }], defaultVariables: '' }],
            globalChatVariables: globals,
            templateDefaultVariables: '',
        },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

//#endregion

import { risuChatParser } from 'src/ts/parser/parser.svelte'
import { scanTextUses } from './toggleUses'

// Keys of the oracle: with a space and with `-`. `0`, `1`, `true`, `null` and `undefined` are fold results and
// underflow values, so they are never keys.
const KEYS = ['a', 'b', 'x y', 'a-b']
const KEY_SET: ReadonlySet<string> = new Set(KEYS)

function engineReads(text: string): string[] {
    reads.length = 0
    risuChatParser(text, {})
    return reads.filter((read) => KEY_SET.has(read.slice('toggle_'.length))).sort()
}

function scannerReads(text: string): string[] {
    return scanTextUses(text, 'desc', 'rewritable', KEY_SET)
        .filter((hit) => !hit.flag)
        .map((hit) => 'toggle_' + hit.key)
        .sort()
}

const expectSame = (text: string) => expect({ text, scanner: scannerReads(text) }).toEqual({ text, scanner: engineReads(text) })

beforeEach(() => {
    reads.length = 0
})

const STATIC_ROWS = [
    '{{getglobalvar::toggle_a}}', '{{GetGlobal_Var::toggle_a}}', '{{getglobalvar:toggle_a}}', '{{getglobalvar:toggle_a::x}}',
    '{{getglobalvar::toggle_a::x}}', '{#getglobalvar::toggle_a}}', '{{getglobalvar::toggle_a}}}',
    '{{getglobalvar::toggle_a:b}}', '{{{getglobalvar::toggle_a}}}', '{{getglobalvar::toggle_a#}}', '{{getglobalvar::toggle_a',
    ':: toggle_a', 'toggle_ab', '{{getvar::toggle_a}}', '{{getglobalvar::toggle_x y}}', '{{getglobalvar::toggle_a-b}}',
    '{{#when::toggle::a}}Z{{/}}', '{{#when::x::and::toggle::a}}Z{{/}}', '{{#when::a::tis::1}}Z{{/}}',
    '{{#when::b::is::1::and::a::tisnot::2}}Z{{/}}', '{{#when::toggle::keep::a}}Z{{/}}', '{{#when::a::tis::v::vis::c}}Z{{/}}',
    '{{#when::a::tis::1::>::0}}Z{{/}}', '{{#when::legacy::toggle::a}}Z{{/}}', '{{#when::toggle::a::and::1}}Z{{/}}',
    '{{#when::toggle::x y}}Z{{/}}', '{{#when::a::tis::vis::a}}Z{{/}}', '{{#when::a::tis::>::a}}Z{{/}}', '{{#when::a::tis::a}}Z{{/}}',
    '{{? @toggle_a + 1}}', '{{? @x::@toggle_a}}', '{{calc::@toggle_a*2}}', '{{calc::@x::@toggle_a}}', '{{? @toggle_ab}}',
    '{{? (@toggle_a)*2}}', '{{? @toggle_a+(1)}}', '{{? @toggle_a(1)}}', '{{? @toggle_a$x}}', '{{calc::@toggle_a(1)}}',
    '{{#if 1}}{{getglobalvar::toggle_a}}{{/if}}', '{{#if 1}}{{#when::toggle::a}}Z{{/}}{{/if}}',
    '{{getglobalvar::{{#if 1}}}}toggle_a}}{{/if}}',
    '{{#each [1] as x}}{{#if 1}}{{getglobalvar::toggle_a}}{{/if}}{{getglobalvar::toggle_b}}{{/each}}',
    '{{#if 0}}{{#if 1}}x{{/if}}{{/if}}{{getglobalvar::toggle_a}}',
]

describe('static rows against the engine (D2)', () => {
    test('the oracle sees the engine read keys, so a row that agrees is not agreeing on nothing', () => {
        expect(engineReads('{{getglobalvar::toggle_a}}')).toEqual(['toggle_a'])
        expect(engineReads('{{#when::b::tis::1}}Z{{/}}')).toEqual(['toggle_b'])
        expect(engineReads('{{? @toggle_a + 1}}')).toEqual(['toggle_a'])
        expect(engineReads('{{getglobalvar::toggle_ab}}')).toEqual([])
    })

    test('a calc name followed by `(` reads a longer key in the engine, so the scanner lists it and never reports a static hit', () => {
        reads.length = 0
        risuChatParser('{{? @toggle_a(1)}}', {})
        expect(reads).toEqual(['toggle_a1'])
        expect(scanTextUses('{{? @toggle_a(1)}}', 'desc', 'rewritable', KEY_SET).map((hit) => [hit.key, hit.flag])).toEqual([['a', 'calcKey']])
    })

    test.each(STATIC_ROWS)('%s', (text) => {
        expectSame(text)
    })
})

const key = fc.constantFrom(...KEYS)
const calcKey = fc.constantFrom('a', 'b')
const reader = fc.oneof(
    key.map((k) => `{{getglobalvar::toggle_${k}}}`),
    key.map((k) => `{{getglobalvar:toggle_${k}}}`),
    key.map((k) => `{{GetGlobal_Var::toggle_${k}::x}}`),
    key.map((k) => `{#getglobalvar::toggle_${k}}}`),
    key.map((k) => `{{#when::toggle::${k}}}Z{{:else}}Y{{/}}`),
    key.map((k) => `{{#when::${k}::tis::1}}Z{{/}}`),
    key.map((k) => `{{#when::x::and::toggle::${k}}}Z{{/}}`),
    calcKey.map((k) => `{{? @toggle_${k} + 1}}`),
    calcKey.map((k) => `{{calc::@toggle_${k}*2}}`),
)
const filler = fc.constantFrom('text ', '{{? 2*3}}', 'toggle_a ', '{{getglobalvar::other}}', '}} ', ' {{ ', '#} ')
const fragment = fc.oneof(reader, filler)
const wrapped = fragment.chain((inner) => fc.constantFrom(inner, `{{#if 1}}${inner}{{/if}}`))

describe('generated texts against the engine (D2)', () => {
    test('readers at top level or in an #if 1 body are read exactly as the engine reads them', () => {
        fc.assert(
            fc.property(fc.array(wrapped, { minLength: 1, maxLength: 6 }), (parts) => {
                expectSame(parts.join(''))
            }),
            { seed: 20261119, numRuns: 300 },
        )
    })
})
