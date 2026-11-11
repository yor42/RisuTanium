// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { changedFieldTarget, focusLost, placeFocusAfterHistory } from './historyFocus'
import type { OwnerFields } from './ownerFields'

const fields = (greetings: string[], rest: Partial<OwnerFields> = {}): OwnerFields => ({ greetings, desc: 'd', hideChatIcon: false, note: undefined, ...rest })

describe('changedFieldTarget', () => {
    test('U1 an insert in the middle is the inserted row', () => {
        expect(changedFieldTarget(fields(['a', 'c']), fields(['a', 'b', 'c']))).toEqual({ kind: 'greeting', index: 1 })
    })
    test('U2 a removal in the middle is the row that took the slot', () => {
        expect(changedFieldTarget(fields(['a', 'b', 'c']), fields(['a', 'c']))).toEqual({ kind: 'greeting', index: 1 })
    })
    test('U3 a removal at the end is the row before it', () => {
        expect(changedFieldTarget(fields(['a', 'b', 'c']), fields(['a', 'b']))).toEqual({ kind: 'greeting', index: 1 })
    })
    test('U4 an emptied list is the Add button', () => {
        expect(changedFieldTarget(fields(['a']), fields([]))).toEqual({ kind: 'greetingAdd' })
    })
    test('U5 an edited row', () => {
        expect(changedFieldTarget(fields(['a', 'b', 'c']), fields(['a', 'B', 'c']))).toEqual({ kind: 'greeting', index: 1 })
    })
    test('U6 several changed rows: the first', () => {
        expect(changedFieldTarget(fields(['a', 'b', 'c', 'd']), fields(['A', 'b', 'c', 'D']))).toEqual({ kind: 'greeting', index: 0 })
    })
    test('U7 a changed row wins over a changed description', () => {
        expect(changedFieldTarget(fields(['a', 'b'], { desc: 'd1' }), fields(['a', 'B'], { desc: 'd2' }))).toEqual({ kind: 'greeting', index: 1 })
    })
    test('U8 only the description', () => {
        expect(changedFieldTarget(fields(['a'], { desc: 'd1' }), fields(['a'], { desc: 'd2' }))).toEqual({ kind: 'desc' })
    })
    test('U9 only the hide-icon box', () => {
        expect(changedFieldTarget(fields(['a'], { hideChatIcon: false }), fields(['a'], { hideChatIcon: true }))).toEqual({ kind: 'hideChatIcon' })
    })
    test('U19 among the non-row fields the order is description, then hide-icon, then note', () => {
        expect(changedFieldTarget(
            fields(['a'], { desc: 'd1', hideChatIcon: false }),
            fields(['a'], { desc: 'd2', hideChatIcon: true }),
        )).toEqual({ kind: 'desc' })
        expect(changedFieldTarget(
            fields(['a'], { hideChatIcon: false, note: 'n1' }),
            fields(['a'], { hideChatIcon: true, note: 'n2' }),
        )).toEqual({ kind: 'hideChatIcon' })
    })
    test('U10 only the note', () => {
        expect(changedFieldTarget(fields([], { note: 'n1' }), fields([], { note: 'n2' }))).toEqual({ kind: 'note' })
    })
    test('U11 nothing changed', () => {
        expect(changedFieldTarget(fields(['a'], { desc: 'x' }), fields(['a'], { desc: 'x' }))).toBeNull()
    })
    test('U12 a row added at the end is the new last row', () => {
        expect(changedFieldTarget(fields(['a', 'b']), fields(['a', 'b', '']))).toEqual({ kind: 'greeting', index: 2 })
    })
    test('U13 among equal texts the first row whose text differs at its position', () => {
        expect(changedFieldTarget(fields(['a', 'a', 'b']), fields(['a', 'a', 'a', 'b']))).toEqual({ kind: 'greeting', index: 2 })
    })
})

describe('focusLost', () => {
    afterEach(() => {
        document.body.replaceChildren()
    })
    test('U14 a focused button is not lost; disabled, removed or the body is', () => {
        const button = document.createElement('button')
        document.body.appendChild(button)
        button.focus()
        expect(focusLost()).toBe(false)
        button.disabled = true
        expect(focusLost()).toBe(true)
        button.disabled = false
        button.focus()
        button.remove()
        expect(focusLost()).toBe(true)
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        expect(focusLost()).toBe(true)
    })
})

describe('placeFocusAfterHistory', () => {
    afterEach(() => {
        document.body.replaceChildren()
    })

    // A character form whose first row is the given element, plus a fallback button outside it.
    function mountForm(row: HTMLElement): { fallback: HTMLButtonElement } {
        const form = document.createElement('div')
        form.dataset.part = 'studio-character-form'
        row.dataset.part = 'studio-greeting-input'
        form.appendChild(row)
        const fallback = document.createElement('button')
        document.body.append(form, fallback)
        return { fallback }
    }

    const edited = { before: fields(['a']), after: fields(['b']) }

    test('U15 a target that takes focus is focused and the fallback is left alone', async () => {
        const { fallback } = mountForm(document.createElement('textarea'))
        await placeFocusAfterHistory(edited.before, edited.after, () => document, () => fallback)
        expect(document.activeElement?.getAttribute('data-part')).toBe('studio-greeting-input')
    })

    test('U16 a disabled target cannot take focus, so a lost focus goes to the fallback', async () => {
        const row = document.createElement('textarea')
        row.disabled = true
        const { fallback } = mountForm(row)
        await placeFocusAfterHistory(edited.before, edited.after, () => document, () => fallback)
        expect(document.activeElement).toBe(fallback)
    })

    test('U17 a target that is not focusable at all falls to the fallback when focus was lost', async () => {
        const { fallback } = mountForm(document.createElement('div'))
        await placeFocusAfterHistory(edited.before, edited.after, () => document, () => fallback)
        expect(document.activeElement).toBe(fallback)
    })

    test('U18 a target that cannot take focus leaves focus where it is when it was not lost', async () => {
        const { fallback } = mountForm(document.createElement('div'))
        const holder = document.createElement('button')
        document.body.appendChild(holder)
        holder.focus()
        await placeFocusAfterHistory(edited.before, edited.after, () => document, () => fallback)
        expect(document.activeElement).toBe(holder)
    })
})
