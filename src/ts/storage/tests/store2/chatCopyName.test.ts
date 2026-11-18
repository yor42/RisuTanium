// CHORE-478 S5 (C1): `copyNameFor` names a chat after upstream's two copy buttons. 'Copy' is the keep-both name and is
// unchanged; 'Branch' is the name upstream's Branch button writes. Titles: `guard` for a new rule, `compatibility` for a
// behaviour that holds before and after.
import { describe, expect, test } from 'vitest'
import { copyNameFor } from '../../store2/fastForward/chatCopy'

const none: ReadonlySet<string> = new Set()

describe('copyNameFor Branch', () => {
    test('guard: the first branch of a chat is "(Branch)"', () => {
        expect(copyNameFor('Chat', none, 'Branch')).toBe('Chat (Branch)')
    })

    test('guard: a taken name moves on to the first free "(Branch N)"', () => {
        expect(copyNameFor('Chat', new Set(['Chat (Branch)']), 'Branch')).toBe('Chat (Branch 2)')
        expect(copyNameFor('Chat', new Set(['Chat (Branch)', 'Chat (Branch 2)']), 'Branch')).toBe('Chat (Branch 3)')
        expect(copyNameFor('Chat', new Set(['Chat (Branch)', 'Chat (Branch 3)']), 'Branch')).toBe('Chat (Branch 2)')
    })

    test('guard: a parent that is itself a branch or a copy gives its base name', () => {
        expect(copyNameFor('Chat (Branch 2)', none, 'Branch')).toBe('Chat (Branch)')
        expect(copyNameFor('Chat (Copy)', none, 'Branch')).toBe('Chat (Branch)')
        expect(copyNameFor('Chat (Branch)', new Set(['Chat (Branch)']), 'Branch')).toBe('Chat (Branch 2)')
    })

    test('guard: a copy name is not taken by a branch name, and the other way round', () => {
        expect(copyNameFor('Chat', new Set(['Chat (Copy)']), 'Branch')).toBe('Chat (Branch)')
        expect(copyNameFor('Chat', new Set(['Chat (Branch)']), 'Copy')).toBe('Chat (Copy)')
    })
})

describe('copyNameFor Copy', () => {
    test('compatibility: the default type is the keep-both copy name', () => {
        expect(copyNameFor('Chat', none)).toBe('Chat (Copy)')
        expect(copyNameFor('Chat', new Set(['Chat (Copy)']))).toBe('Chat (Copy 2)')
        expect(copyNameFor('Chat (Copy 2)', new Set(['Chat (Copy)']))).toBe('Chat (Copy 2)')
        expect(copyNameFor('Chat', none, 'Copy')).toBe('Chat (Copy)')
    })
})
