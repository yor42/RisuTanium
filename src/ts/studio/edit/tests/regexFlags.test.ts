// The flag text rules of a regex script: token-aware letter, action and order edits. Expected strings are written out
// literally; nothing is computed by the module under test.
import { describe, expect, test } from 'vitest'
import {
    actionsOn, flagTokens, keptTokens, lettersOn, orderOf, setOrder, toggleAction, toggleLetter,
    type FlagAction,
} from '../regexFlags'

function groupsOf(flag: string): string[] {
    return flagTokens(flag).filter((t) => t.kind === 'group').map((t) => t.text)
}

describe('flagTokens', () => {
    test('a group is what the runtime strips: <...> with at least one character, no newline', () => {
        expect(groupsOf('g<cbs>i<order 3, move_top>')).toEqual(['<cbs>', '<order 3, move_top>'])
        expect(groupsOf('<>')).toEqual([])
        expect(groupsOf('<a\nb>')).toEqual([])
        expect(flagTokens('<>').map((t) => t.text)).toEqual(['<', '>'])
    })

    test('the tokens joined in order give the flag back', () => {
        for (const flag of ['', 'g', '<cbs>s', 'g<a>i<>x<b, c>', '<a\nb>g']) {
            expect(flagTokens(flag).map((t) => t.text).join('')).toBe(flag)
        }
    })
})

describe('letters', () => {
    test('off removes every occurrence outside the groups and never touches a group', () => {
        expect(toggleLetter('<cbs>s', 's', false)).toBe('<cbs>')
        expect(toggleLetter('gig', 'g', false)).toBe('i')
        expect(toggleLetter('<order 3, cbs>g', 'g', false)).toBe('<order 3, cbs>')
        expect(toggleLetter('<mgs>m', 'm', false)).toBe('<mgs>')
    })

    test('on appends when absent and is a no-op when present', () => {
        expect(toggleLetter('', 'g', true)).toBe('g')
        expect(toggleLetter('<cbs>', 'i', true)).toBe('<cbs>i')
        expect(toggleLetter('gi', 'g', true)).toBe('gi')
    })

    test('a letter inside a group does not count as on', () => {
        expect(lettersOn('<mgs>i')).toEqual(['i'])
        expect(lettersOn('gi<cbs>g')).toEqual(['g', 'i'])
    })

    test('toggling a letter never changes the text of any group', () => {
        const flags = ['', 'g', '<cbs>s', 'g<a, g>i<order -2>g', '<>g<x>', '<g>', 'm<foo bar>m<move_top, cbs>']
        for (const flag of flags) {
            for (const letter of ['g', 'i', 'm', 'u', 's']) {
                for (const on of [true, false]) {
                    expect(groupsOf(toggleLetter(flag, letter, on))).toEqual(groupsOf(flag))
                }
            }
        }
    })
})

describe('actions', () => {
    test('off removes the name from its group, drops a group that empties and keeps the other names', () => {
        expect(toggleAction('<order 3, cbs>g', 'cbs', false)).toBe('<order 3>g')
        expect(toggleAction('<cbs>g', 'cbs', false)).toBe('g')
        expect(toggleAction('<cbs, move_top, foo>g', 'cbs', false)).toBe('<move_top, foo>g')
    })

    test('off removes the name from every group that holds it and leaves other text byte for byte', () => {
        expect(toggleAction('<cbs>g<cbs, foo>', 'cbs', false)).toBe('g<foo>')
        expect(toggleAction('<foo,bar>g<cbs>', 'cbs', false)).toBe('<foo,bar>g')
        expect(toggleAction('x<a>y', 'cbs', false)).toBe('x<a>y')
    })

    test('on appends <name> when absent', () => {
        expect(toggleAction('g', 'cbs', true)).toBe('g<cbs>')
        expect(toggleAction('<cbs>g', 'cbs', true)).toBe('<cbs>g')
        expect(toggleAction('', 'no_end_nl', true)).toBe('<no_end_nl>')
    })

    test('actionsOn lists the known actions only', () => {
        const expected: FlagAction[] = ['cbs', 'move_top']
        expect(actionsOn('<cbs, foo>g<move_top>')).toEqual(expected)
        expect(actionsOn('<inject>')).toEqual([])
    })
})

describe('order', () => {
    test('setting an order', () => {
        expect(setOrder('g', 5)).toBe('<order 5>g')
        expect(setOrder('<order 3>g', 5)).toBe('<order 5>g')
        expect(setOrder('g', -2)).toBe('<order -2>g')
        expect(setOrder('<cbs, order 3>g', 7)).toBe('<cbs, order 7>g')
        expect(setOrder('', 1)).toBe('<order 1>')
    })

    test('clearing removes only the order meta', () => {
        expect(setOrder('<order 3>g', null)).toBe('g')
        expect(setOrder('<order 3, cbs>g', null)).toBe('<cbs>g')
        expect(setOrder('<foo>g<order -1>i', null)).toBe('<foo>gi')
        expect(setOrder('g', null)).toBe('g')
    })

    test('the runtime honours the last order meta, so that is the one read and rewritten', () => {
        expect(orderOf('<order 1>g<order 2>')).toBe(2)
        expect(orderOf('<order 1, order -4>')).toBe(-4)
        expect(setOrder('<order 1>g<order 2>', 9)).toBe('<order 1>g<order 9>')
        expect(setOrder('<order 1>g<order 2>', null)).toBe('g')
        expect(orderOf('g')).toBeNull()
        expect(orderOf('<order x>')).toBeNull()
        expect(orderOf('<order -2>g')).toBe(-2)
    })
})

describe('keptTokens', () => {
    test('unknown group names and unknown loose characters are kept; known tokens and order are not', () => {
        expect(keptTokens('<foo>g<cbs, inject, order 2>q')).toEqual(['foo', 'inject', 'q'])
        expect(keptTokens('<foo>')).toEqual(['foo'])
        expect(keptTokens('gimsuyd')).toEqual([])
        expect(keptTokens('<>')).toEqual(['<', '>'])
    })

    test('an unknown group survives every chip edit', () => {
        let flag = '<foo>g'
        flag = toggleAction(flag, 'cbs', true)
        flag = setOrder(flag, 4)
        flag = toggleLetter(flag, 'g', false)
        flag = toggleAction(flag, 'cbs', false)
        flag = setOrder(flag, null)
        expect(flag).toBe('<foo>')
    })
})
