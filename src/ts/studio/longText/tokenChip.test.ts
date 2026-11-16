import { describe, expect, test } from 'vitest'
import { tokenChipView, type TokenChipCopy } from './tokenChip'
import type { TokenResult } from './tokenCount'

const copy: TokenChipCopy = {
    tokens: (n, model) => `tokens(${n},${model})`,
    tokensEst: (n) => `tokensEst(${n})`,
    estOnline: (model) => `online(${model})`,
    estUnavailable: (model) => `unavailable(${model})`,
    estError: (model) => `error(${model})`,
    noteRaw: 'NOTE',
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
