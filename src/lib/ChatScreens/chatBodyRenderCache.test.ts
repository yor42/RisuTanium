/**
 * The render cache and the two display rules of `ChatBody`. Labels: G = guard, R = reproducer (fails on the base before
 * the char budget, by assertion, since it imports only existing symbols). The evidence of each row is a named mutant
 * of the rule it pins.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    AWAITING, BACKGROUND_SLOT, clearChatBodyRenderCache, lookup, pendingDisplay, record, RENDER_CACHE_CAPACITY, runShowsSpinner,
    scopeOf, slotKeyOf, type CacheLookup, type DisplayInput, type RenderFingerprint, type SpinnerInput,
} from './chatBodyRenderCache'

const SCOPE = scopeOf('a', 'cA', 0)

function fp(over: Partial<RenderFingerprint> = {}): RenderFingerprint {
    return {
        scope: SCOPE,
        slot: slotKeyOf(false, 3, { name: 'c' } as never),
        source: 'src',
        role: 'char',
        charArg: { name: 'c' } as never,
        ...over,
    }
}

beforeEach(() => {
    clearChatBodyRenderCache()
})

describe('G T13 the background slot never collides with a message slot', () => {
    test('no slotKeyOf output equals BACKGROUND_SLOT', () => {
        expect(typeof BACKGROUND_SLOT).toBe('string')
        expect(BACKGROUND_SLOT).not.toContain('|')
        for (const first of [true, false]) {
            for (const idx of [-1, 0, 3, 42]) {
                for (const charArg of [null, 'bookmark', '', { name: 'c' } as never]) {
                    expect(slotKeyOf(first, idx, charArg)).not.toBe(BACKGROUND_SLOT)
                }
            }
        }
    })

    test('a background entry and a message entry of one scope coexist', () => {
        record(fp({ slot: BACKGROUND_SLOT, source: 'bg', role: null, charArg: null }), '<p>BG</p>')
        record(fp(), '<p>H</p>')
        expect(lookup(fp({ slot: BACKGROUND_SLOT, source: 'bg', role: null, charArg: null }))).toEqual({ kind: 'html', html: '<p>BG</p>' })
        expect(lookup(fp())).toEqual({ kind: 'html', html: '<p>H</p>' })
    })
})

describe('G T18 the cache returns an entry only for the input that produced it', () => {
    test('an exact match returns the html', () => {
        record(fp(), '<p>H</p>')
        expect(lookup(fp())).toEqual({ kind: 'html', html: '<p>H</p>' })
    })

    test.each([
        ['source', { source: 'other' }],
        ['role', { role: 'user' }],
        ['character argument', { charArg: { name: 'd' } as never }],
    ])('a %s mismatch on the same slot is stale, never html', (_name, over) => {
        record(fp(), '<p>H</p>')
        expect(lookup(fp(over))).toEqual({ kind: 'stale' })
    })

    test('a different slot is none', () => {
        record(fp(), '<p>H</p>')
        expect(lookup(fp({ slot: slotKeyOf(false, 4, { name: 'c' } as never) }))).toEqual({ kind: 'none' })
        expect(lookup(fp({ slot: slotKeyOf(true, 3, { name: 'c' } as never) }))).toEqual({ kind: 'none' })
    })

    test('a new scope on record clears the older entries, and a lookup in another scope is none', () => {
        record(fp(), '<p>H</p>')
        expect(lookup(fp({ scope: scopeOf('a', 'cB', 0) }))).toEqual({ kind: 'none' })
        record(fp({ scope: scopeOf('a', 'cB', 0), slot: 'other' }), 'x')
        expect(lookup(fp())).toEqual({ kind: 'none' })
    })

    test('the awaiting mark round-trips, and a changed source reads stale', () => {
        record(fp(), AWAITING)
        expect(lookup(fp())).toEqual({ kind: 'awaiting' })
        expect(lookup(fp({ source: 'edited' }))).toEqual({ kind: 'stale' })
    })

    test('an id-less chat falls back to the page index', () => {
        expect(scopeOf('a', undefined, 2)).not.toBe(scopeOf('a', undefined, 3))
        expect(scopeOf('a', undefined, 2)).not.toBe(scopeOf('a', 'cA', 2))
    })

    test('N8: an object and a string character argument keep separate slots of one index', () => {
        const objectFp = fp({ slot: slotKeyOf(false, 3, { name: 'c' } as never), charArg: { name: 'c' } as never })
        const stringFp = fp({ slot: slotKeyOf(false, 3, 'c1'), charArg: 'c1' })
        record(objectFp, 'OBJECT')
        record(stringFp, 'STRING')
        expect(lookup(objectFp)).toEqual({ kind: 'html', html: 'OBJECT' })
        expect(lookup(stringFp)).toEqual({ kind: 'html', html: 'STRING' })
    })

    test('cap: the least recently used entry is dropped, and a hit counts as use', () => {
        const slotFp = (i: number) => fp({ slot: `slot${i}` })
        for (let i = 0; i < RENDER_CACHE_CAPACITY; i++) {
            record(slotFp(i), `h${i}`)
        }
        expect(lookup(slotFp(0)).kind).toBe('html')
        record(slotFp(RENDER_CACHE_CAPACITY), 'overflow')

        expect(lookup(slotFp(1))).toEqual({ kind: 'none' })
        expect(lookup(slotFp(0)).kind).toBe('html')
        expect(lookup(slotFp(RENDER_CACHE_CAPACITY)).kind).toBe('html')
    })
})

// Literals equal to RENDER_CACHE_CHAR_BUDGET (4,000,000) and RENDER_CACHE_ENTRY_CHAR_LIMIT (1,000,000) on purpose: the
// sizes stay exact edges even if a constant is edited. The default fingerprint source is 'src' (3 chars), so an entry of
// size S carries a value of S - 3 chars. Slots are read once at the end: a hit reorders the entries.
describe('char budget of the render cache', () => {
    const chunks = new Map<number, string>()
    const ch = (n: number): string => {
        let s = chunks.get(n)
        if(s === undefined){
            s = 'x'.repeat(n)
            chunks.set(n, s)
        }
        return s
    }
    const put = (slot: string, size: number, scope = SCOPE): void => record(fp({ slot, scope }), ch(size - 3))
    const kindOf = (slot: string, scope = SCOPE): string => lookup(fp({ slot, scope })).kind
    const kindsOf = (slots: string[]): string[] => slots.map((slot) => kindOf(slot))
    const names = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => prefix + i)

    test('R1: past the budget the oldest entries go; exactly at the budget nothing goes', () => {
        const slots = names('s', 10)
        for(const slot of slots){
            put(slot, 500_000)
        }
        expect(kindsOf(slots)).toEqual(['none', 'none', ...Array(8).fill('html')])
    })

    test('R2: one insert evicts as many oldest entries as it needs', () => {
        const small = names('k', 5)
        const big = names('b', 4)
        for(const slot of small){
            put(slot, 200_000)
        }
        for(const slot of big.slice(0, 3)){
            put(slot, 1_000_000)
        }
        put(big[3], 1_000_000)
        expect(kindsOf(small)).toEqual(Array(5).fill('none'))
        expect(kindsOf(big)).toEqual(Array(4).fill('html'))
    })

    test('R3: an entry over the per-entry limit is stored nowhere, evicts nothing and drops its slot\'s older entry', () => {
        const small = ['a', 'b', 'c']
        for(const slot of small){
            put(slot, 100)
        }
        put('X', 1_000_003)
        put('X2', 1_000_000)
        record(fp({ slot: 'Y' }), 'old')
        record(fp({ slot: 'Y' }), ch(1_000_000))
        expect(kindOf('X')).toBe('none')
        expect(kindOf('X2')).toBe('html')
        expect(kindOf('Y')).toBe('none')
        expect(kindsOf(small)).toEqual(Array(3).fill('html'))
    })

    test('R4: a replaced entry stops counting its old size', () => {
        record(fp({ slot: 'P' }), 'p')
        for(let i = 0; i < 10; i++){
            put('A', 900_000)
        }
        const big = names('b', 3)
        for(const slot of big){
            put(slot, 1_000_000)
        }
        put('C', 99_997)
        expect(kindOf('P')).toBe('none')
        expect(kindsOf(['A', ...big, 'C'])).toEqual(Array(5).fill('html'))
    })

    test('R5: a new scope starts the total from zero', () => {
        const other = scopeOf('a', 'cB', 0)
        for(const slot of names('s', 4)){
            put(slot, 1_000_000)
        }
        const slots = names('s', 5)
        for(const slot of slots){
            put(slot, 1_000_000, other)
        }
        expect(slots.map((slot) => kindOf(slot, other))).toEqual(['none', ...Array(4).fill('html')])
    })

    test('R6: clearing the cache starts the total from zero', () => {
        for(const slot of names('s', 4)){
            put(slot, 1_000_000)
        }
        clearChatBodyRenderCache()
        const slots = names('s', 5)
        for(const slot of slots){
            put(slot, 1_000_000)
        }
        expect(kindsOf(slots)).toEqual(['none', ...Array(4).fill('html')])
    })

    test('R7: an awaiting entry counts its source', () => {
        const slots = names('w', 5)
        for(const slot of slots){
            record(fp({ slot, source: ch(1_000_000) }), AWAITING)
        }
        expect(slots.map((slot) => lookup(fp({ slot, source: ch(1_000_000) })).kind))
            .toEqual(['none', ...Array(4).fill('awaiting')])
    })

    test('G1: an awaiting entry replaced by its html counts source plus html once', () => {
        record(fp({ slot: 'T', source: ch(600_000) }), AWAITING)
        record(fp({ slot: 'T', source: ch(600_000) }), ch(400_000))
        const rest = names('u', 3)
        for(const slot of rest){
            put(slot, 1_000_000)
        }
        expect(lookup(fp({ slot: 'T', source: ch(600_000) })).kind).toBe('html')
        expect(kindsOf(rest)).toEqual(Array(3).fill('html'))
    })

    test('G2: an oversized entry in a new scope still drops the older scope\'s entries', () => {
        const other = scopeOf('a', 'cB', 0)
        record(fp({ slot: 'a' }), 'a')
        put('big', 1_000_003, other)
        expect(kindOf('a')).toBe('none')
    })

    test('R8: a hit keeps its entry young under the budget path', () => {
        const slots = names('h', 4)
        for(const slot of slots){
            put(slot, 1_000_000)
        }
        expect(kindOf('h0')).toBe('html')
        record(fp({ slot: 'n' }), 'n')
        expect(kindOf('h1')).toBe('none')
        expect(kindsOf(['h0', 'h2', 'h3', 'n'])).toEqual(Array(4).fill('html'))
    })
})

const html = (h: string): CacheLookup => ({ kind: 'html', html: h })
const none: CacheLookup = { kind: 'none' }

describe('G T23 runShowsSpinner: the first matching rule decides', () => {
    const base: SpinnerInput = { translateRun: true, showTranslationLoading: true, revisionChanged: false, shown: 'S', lookup: none }

    test.each<[string, Partial<SpinnerInput>, boolean]>([
        ['S-a: not a translate run, though S-d would answer true', { translateRun: false }, false],
        ['S-a: loading display off, though S-d would answer true', { showTranslationLoading: false }, false],
        ['S-b: a revision change, though S-d would answer true', { revisionChanged: true }, false],
        ['S-c: nothing shown and a seed, though S-d would answer true', { shown: null, lookup: html('H') }, false],
        ['S-d: nothing shown and no seed', { shown: null }, true],
        ['S-d: a string already shown, even with a seed (S-c is narrowed)', { lookup: html('H') }, true],
        ['S-d: a string already shown', {}, true],
    ])('%s', (_name, over, expected) => {
        expect(runShowsSpinner({ ...base, ...over })).toBe(expected)
    })
})

describe('G T23 pendingDisplay: the first matching row decides', () => {
    const base: DisplayInput = { pending: false, runSpinner: false, shown: null, lookup: none, streamingTail: false }

    test.each<[string, Partial<DisplayInput>, ReturnType<typeof pendingDisplay>]>([
        ['D1: pending with a hit shows the hit over the indicator, the spinner and its own string',
            { pending: true, lookup: html('H'), runSpinner: true, shown: 'S' }, { kind: 'html', html: 'H' }],
        ['D2: pending without a hit shows the indicator, never the spinner or its own string',
            { pending: true, runSpinner: true, shown: 'S' }, { kind: 'indicator' }],
        ['D2: pending with a stale entry shows the indicator even on the streaming tail',
            { pending: true, lookup: { kind: 'stale' }, streamingTail: true }, { kind: 'indicator' }],
        ['D3: the run spinner beats its own string and the seed',
            { runSpinner: true, shown: 'S', lookup: html('H') }, { kind: 'spinner' }],
        ['D4: its own string beats the seed', { shown: 'S', lookup: html('H') }, { kind: 'html', html: 'S' }],
        ['D4: its own string beats the awaiting mark', { shown: 'S', lookup: { kind: 'awaiting' } }, { kind: 'html', html: 'S' }],
        ['D5: the seed shows when nothing was rendered', { lookup: html('H') }, { kind: 'html', html: 'H' }],
        ['D6: awaiting shows the indicator', { lookup: { kind: 'awaiting' } }, { kind: 'indicator' }],
        ['D6: awaiting shows the indicator on the streaming tail', { lookup: { kind: 'awaiting' }, streamingTail: true }, { kind: 'indicator' }],
        ['D7: stale shows the indicator, never the old html', { lookup: { kind: 'stale' } }, { kind: 'indicator' }],
        ['D7/D8: stale on the streaming tail stays blank', { lookup: { kind: 'stale' }, streamingTail: true }, { kind: 'blank' }],
        ['D8: nothing known stays blank', {}, { kind: 'blank' }],
    ])('%s', (_name, over, expected) => {
        expect(pendingDisplay({ ...base, ...over })).toEqual(expected)
    })
})
