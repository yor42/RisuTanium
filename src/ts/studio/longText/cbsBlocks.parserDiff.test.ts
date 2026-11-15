import fc from 'fast-check'
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import { classifyBlockStart, purity, type EngineBlockType } from './cbsBlocks'

//#region module mocks (the parser harness of src/ts/parser/tests/cbs/conditionals.test.ts)

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

// Chat variables read back as their own key, so a variable-free text never depends on this record.
const varStorage = vi.hoisted(() => new Proxy({}, {
    get(_, prop) {
        return typeof prop === 'string' ? (prop.startsWith('$') ? prop.slice(1) : prop) : 'null'
    },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: {
        db: {
            characters: [{ chatPage: 0, chats: [{ scriptstate: varStorage }], defaultVariables: '' }],
            globalChatVariables: varStorage,
            templateDefaultVariables: '',
        },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

//#endregion

import { risuChatParser } from 'src/ts/parser/parser.svelte'

// The parser keeps `callStack` on its options object, so every call gets a fresh one.
const parse = (text: string) => risuChatParser(text, {})

const STRAY_CLOSER = '{{/}}'

// Heads that cover every branch of the engine's block table, with and without a block result.
const TOKENS = [
    '#if 1', '#if true', '#if 0', '#if', '#if  1', '#iffy 1', '#if_pure 1', '#if_pure 0', '#if_pure',
    '#when 1', '#when 0', '#when x', '#when', '#whenx', '#when::1', '#when::0', '#when::keep::1',
    '#when::legacy::1', '#when::legacy::0', '#when::1::and::0',
    '#pure', '#pure ', '#pure x', '#pure_display', '#puredisplay', '#code', '#code ',
    '#escape', '#escape::keep', '#escapex', '#each', '#each [1] as x', '#eachx',
    '#func', '#funcx', '#func a', '#func ',
    '#', '#foo', '#pur', ':else', ':foo',
]

describe('classifyBlockStart against the engine', () => {
    test('a following {{/}} stays text exactly when the head is not a block', () => {
        for(const tok of TOKENS){
            const out = parse(`A{{${tok}}}S${STRAY_CLOSER}`)
            const kept = out.includes(STRAY_CLOSER)
            expect({ tok, kept }).toEqual({ tok, kept: classifyBlockStart(tok, true).kind === 'nothing' })
        }
    })

    test('a following {{#foo}} opens a counted frame exactly when the block is pure', () => {
        // Pure body: `{{#foo}}` is a counted frame, the first closer closes it and the last closes the block.
        // Not pure: the first closer closes the block and the last closer is a stray that stays text.
        for(const tok of TOKENS){
            const start = classifyBlockStart(tok, true)
            if(start.kind !== 'block'){
                continue
            }
            const out = parse(`{{${tok}}}{{#foo}}${STRAY_CLOSER}Z${STRAY_CLOSER}`)
            const countedFrame = !out.endsWith(STRAY_CLOSER)
            expect({ tok, countedFrame }).toEqual({ tok, countedFrame: purity(start.types) === 'yes' })
        }
    })
})

// Operators and operands of the legacy and modern `#when::` fold that need no chat state.
const SEGMENTS = ['0', '1', 'true', 'x', 'a', 'not', 'and', 'or', 'is', 'isnot', 'keep', 'legacy', '>', '<', '>=', '<=']

// The four results of the fold are told apart by what `{{:else}}` does at the block end.
function engineType(tok: string): EngineBlockType | null {
    const out = parse(`{{${tok}}}A{{:else}}B{{/}}`)
    switch(out){
        case 'A': return 'newif'
        case 'B': return 'newif-falsy'
        case 'A{{:else}}B': return 'parse'
        case '': return 'ignore'
        default: return null
    }
}

describe('the #when:: fold against the engine', () => {
    test('a chat-state-free fold gives the single type the engine reads', () => {
        fc.assert(
            fc.property(fc.array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 7 }), (segments) => {
                const tok = `#when::${segments.join('::')}`
                const start = classifyBlockStart(tok, true)
                if(start.kind !== 'block'){
                    throw new Error(`${tok} is not a block`)
                }
                const engine = engineType(tok)
                expect({ tok, types: [...start.types] }).toEqual({ tok, types: [engine] })
            }),
            { seed: 20261113, numRuns: 400 },
        )
    })
})
