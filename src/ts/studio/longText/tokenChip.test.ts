import { describe, expect, test } from 'vitest'
import { tokenChipView, type TokenChipCopy } from './tokenChip'
import type { TokenResult } from './tokenCount'

const copy: TokenChipCopy = {
    tokens: (n, model) => `tokens(${n},${model})`,
    tokensEst: (n) => `tokensEst(${n})`,
    estOnline: (model) => `online(${model})`,
    estUnavailable: (model) => `unavailable(${model})`,
    estError: (model) => `error(${model})`,
    tokensVaries: (n, model) => `tokensVaries(${n},${model})`,
    noteRaw: 'NOTE',
    noteFilled: 'FILLED',
}

describe('E1-U1 the chip view of a token result', () => {
    test('an app count uses the exact key, has no reason and still carries the raw-text note', () => {
        const result: TokenResult = { kind: 'app-count', count: 1234, tokenizer: 'o200k_base', model: 'M' }
        expect(tokenChipView(result, copy)).toEqual({ text: 'tokens(1234,M)', reason: null, note: 'NOTE', estimate: false })
    })

    test.each([
        ['online-only', 'online(M)'],
        ['unavailable', 'unavailable(M)'],
        ['error', 'error(M)'],
    ] as const)('an estimate (%s) never uses the exact key, names its reason and carries the note', (reason, expected) => {
        const view = tokenChipView({ kind: 'estimate', count: 7, model: 'M', reason }, copy)
        expect(view).toEqual({ text: 'tokensEst(7)', reason: expected, note: 'NOTE', estimate: true })
        expect(view.text).not.toContain('tokens(')
    })
})

describe('E1-U1 amended (MC-1755) the filled-count variants', () => {
    const exact: TokenResult = { kind: 'app-count', count: 12, tokenizer: 'o200k_base', model: 'M' }
    const estimate: TokenResult = { kind: 'estimate', count: 7, model: 'M', reason: 'online-only' }

    test('a count of filled text carries the filled note, not the raw one', () => {
        expect(tokenChipView(exact, copy, { filled: true, varies: false })).toEqual({ text: 'tokens(12,M)', reason: null, note: 'FILLED', estimate: false })
    })

    test('an exact count of text that varies uses the varies key', () => {
        expect(tokenChipView(exact, copy, { filled: true, varies: true })).toEqual({ text: 'tokensVaries(12,M)', reason: null, note: 'FILLED', estimate: false })
    })

    test('an estimate of text that varies stays an estimate with no varies key', () => {
        const view = tokenChipView(estimate, copy, { filled: true, varies: true })
        expect(view).toEqual({ text: 'tokensEst(7)', reason: 'online(M)', note: 'FILLED', estimate: true })
    })

    test('the varies flag of a raw count changes nothing: only a filled count can vary', () => {
        expect(tokenChipView(exact, copy, { filled: false, varies: true })).toEqual({ text: 'tokens(12,M)', reason: null, note: 'NOTE', estimate: false })
        expect(tokenChipView(exact, copy)).toEqual({ text: 'tokens(12,M)', reason: null, note: 'NOTE', estimate: false })
    })
})
