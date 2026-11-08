import { afterEach, describe, expect, test } from 'vitest'
import { isImeComposing } from './compositionGuard'
import { compositionEnd, compositionStart, enterKeydown, imeEventSequence } from './tests/imeEventSequence'

function mountInput(): HTMLInputElement {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    return input
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('isImeComposing', () => {
    test.each([
        ['isComposing true with keyCode 13', { isComposing: true, keyCode: 13 }, true],
        ['isComposing false with keyCode 229', { isComposing: false, keyCode: 229 }, true],
        ['both flags', { isComposing: true, keyCode: 229 }, true],
        ['neither flag', { isComposing: false, keyCode: 13 }, false],
        ['a character key without flags', { isComposing: false, keyCode: 65 }, false],
        ['an arrow key with isComposing', { isComposing: true, keyCode: 40 }, true],
        ['an arrow key with keyCode 229', { isComposing: false, keyCode: 229 }, true],
    ])('%s', (_name, event, expected) => {
        expect(isImeComposing(event)).toBe(expected)
    })

})

describe('the keydown after a composition', () => {
    test('compositionend, then keydown 13 with isComposing false: not composing, and no time window holds it', () => {
        const input = mountInput()
        imeEventSequence(input, '간')
        const event = enterKeydown(input)
        expect(isImeComposing(event)).toBe(false)
        expect(event.defaultPrevented).toBe(false)
    })

    test('compositionstart without compositionend, then keydown 13 with isComposing false: not composing', () => {
        const input = mountInput()
        compositionStart(input)
        const event = enterKeydown(input)
        expect(isImeComposing(event)).toBe(false)
        compositionEnd(input, '간')
    })

    test('a keydown with isComposing or keyCode 229 is composing and the helper never prevents it', () => {
        const input = mountInput()
        compositionStart(input)
        const flagged = enterKeydown(input, { isComposing: true })
        const legacy = enterKeydown(input, { keyCode: 229 })
        expect(isImeComposing(flagged)).toBe(true)
        expect(isImeComposing(legacy)).toBe(true)
        expect(flagged.defaultPrevented).toBe(false)
        expect(legacy.defaultPrevented).toBe(false)
        compositionEnd(input, '간')
    })
})
