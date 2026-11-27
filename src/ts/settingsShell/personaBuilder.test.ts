import { describe, expect, test } from 'vitest'
import { composePersonaText, EMPTY_ANSWERS, isUntouchedPersona, recomposeDecision } from './personaBuilder'

const labels = { appearance: 'Appearance', personality: 'Personality', background: 'Background' }

describe('composePersonaText', () => {
    test('empty answers compose to the empty string', () => {
        expect(composePersonaText(EMPTY_ANSWERS, labels)).toBe('')
    })

    test('one labelled line per filled answer in order, "anything else" without a label', () => {
        const text = composePersonaText({ appearance: 'tall', personality: '', background: 'coast', other: 'plain talk' }, labels)
        expect(text).toBe('Appearance: tall\nBackground: coast\nplain talk')
    })

    test('whitespace-only answers count as empty and the rest is trimmed', () => {
        expect(composePersonaText({ appearance: '   ', personality: ' calm ', background: '', other: '\n' }, labels)).toBe('Personality: calm')
    })

    test('inner line breaks of an answer are kept as typed', () => {
        expect(composePersonaText({ ...EMPTY_ANSWERS, other: 'a\nb' }, labels)).toBe('a\nb')
    })
})

describe('recomposeDecision', () => {
    test('the first composition writes unless it equals the current text', () => {
        expect(recomposeDecision('x', null, '')).toBe('write')
        expect(recomposeDecision('', null, '')).toBe('unchanged')
    })

    test('an unchanged composition does nothing even over a hand-edited text', () => {
        expect(recomposeDecision('x', 'x', 'mine')).toBe('unchanged')
    })

    test('a changed composition replaces an unedited text and asks over an edited one', () => {
        expect(recomposeDecision('y', 'x', 'x')).toBe('write')
        expect(recomposeDecision('y', 'x', 'mine')).toBe('ask')
    })
})

describe('isUntouchedPersona', () => {
    const base = { name: 'New persona', icon: '', personaPrompt: '', note: '' }
    test('only the default name with nothing else counts', () => {
        expect(isUntouchedPersona(base, 'New persona')).toBe(true)
        expect(isUntouchedPersona({ ...base, name: 'A' }, 'New persona')).toBe(false)
        expect(isUntouchedPersona({ ...base, icon: 'asset' }, 'New persona')).toBe(false)
        expect(isUntouchedPersona({ ...base, personaPrompt: 'p' }, 'New persona')).toBe(false)
        expect(isUntouchedPersona({ ...base, note: 'n' }, 'New persona')).toBe(false)
    })
})
