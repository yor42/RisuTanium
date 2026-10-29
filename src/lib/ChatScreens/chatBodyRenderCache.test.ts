/**
 * The render cache and the two display rules of `ChatBody`. Labels: G = guard. The symbols are new, so on the base the
 * file fails at import; the evidence of each row is a named mutant of the rule it pins.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    AWAITING, clearChatBodyRenderCache, lookup, pendingDisplay, record, RENDER_CACHE_CAPACITY, runShowsSpinner,
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
