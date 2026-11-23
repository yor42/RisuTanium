// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { changedFieldTarget, focusLost, placeFocusAfterHistory } from './historyFocus'
import type { OwnerFields } from './ownerFields'

const fields = (greetings: string[], rest: Partial<OwnerFields> = {}): OwnerFields => ({ greetings, firstMessage: 'f', exampleMessage: '<START>\nx', desc: 'd', hideChatIcon: false, risutanium_render_when_complete: false, note: undefined, ...rest })

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
    test('U9b only the render-when-complete box, after the hide-icon box in the field order', () => {
        expect(changedFieldTarget(fields(['a'], { risutanium_render_when_complete: false }), fields(['a'], { risutanium_render_when_complete: true }))).toEqual({ kind: 'risutanium_render_when_complete' })
        expect(changedFieldTarget(
            fields(['a'], { hideChatIcon: false, risutanium_render_when_complete: false }),
            fields(['a'], { hideChatIcon: true, risutanium_render_when_complete: true }),
        )).toEqual({ kind: 'hideChatIcon' })
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

// The first message ranks after the alternates and before every other field. Every leg but (b) is red on a base
// that ignores the first message; (b) and (e) are compatibility legs.
describe('R-HF1 the first message in the focus order', () => {
    test('(a) only the first message changed', () => {
        expect(changedFieldTarget(fields(['a'], { firstMessage: 'f1' }), fields(['a'], { firstMessage: 'f2' }))).toEqual({ kind: 'firstMessage' })
    })
    test('(b) the alternates and the first message changed: the alternate (compatibility leg)', () => {
        expect(changedFieldTarget(fields(['a'], { firstMessage: 'f1' }), fields(['A'], { firstMessage: 'f2' }))).toEqual({ kind: 'greeting', index: 0 })
    })
    test('(c) the first message and the description changed: the first message', () => {
        expect(changedFieldTarget(fields(['a'], { firstMessage: 'f1', desc: 'd1' }), fields(['a'], { firstMessage: 'f2', desc: 'd2' }))).toEqual({ kind: 'firstMessage' })
    })
    test('(d) the first message and the render-when-complete box changed: the first message', () => {
        expect(changedFieldTarget(
            fields(['a'], { firstMessage: 'f1', risutanium_render_when_complete: false }),
            fields(['a'], { firstMessage: 'f2', risutanium_render_when_complete: true }),
        )).toEqual({ kind: 'firstMessage' })
    })
    test('(e) only the render-when-complete box changed while the first message is present and unchanged', () => {
        expect(changedFieldTarget(
            fields(['a'], { firstMessage: 'f1', risutanium_render_when_complete: false }),
            fields(['a'], { firstMessage: 'f1', risutanium_render_when_complete: true }),
        )).toEqual({ kind: 'risutanium_render_when_complete' })
    })
})

// The example text ranks after the first message and before every other field; its target is the first card whose
// text differs. Every leg but (e) is red on a base that ignores the example text.
describe('R-HF3 the example text in the focus order', () => {
    const exampleOf = (exampleMessage: string, rest: Partial<OwnerFields> = {}) => fields(['a'], { exampleMessage, ...rest })

    test('(a) only the example text changed: the first card whose text differs', () => {
        expect(changedFieldTarget(exampleOf('<START>\nA\n<START>\nB'), exampleOf('<START>\nA\n<START>\nb'))).toEqual({ kind: 'example', card: 1 })
    })
    test('(b) the first message and the example text changed: the first message', () => {
        expect(changedFieldTarget(exampleOf('<START>\nA', { firstMessage: 'f1' }), exampleOf('<START>\nB', { firstMessage: 'f2' }))).toEqual({ kind: 'firstMessage' })
    })
    test('(c) the example text and the description changed: the example card', () => {
        expect(changedFieldTarget(exampleOf('<START>\nA', { desc: 'd1' }), exampleOf('<START>\nB', { desc: 'd2' }))).toEqual({ kind: 'example', card: 0 })
    })
    test('(d) the example text and the render-when-complete box changed: the example card', () => {
        expect(changedFieldTarget(
            exampleOf('<START>\nA', { risutanium_render_when_complete: false }),
            exampleOf('<START>\nB', { risutanium_render_when_complete: true }),
        )).toEqual({ kind: 'example', card: 0 })
    })
    test('(e) the alternates and the example text changed: the alternate (compatibility leg)', () => {
        expect(changedFieldTarget(exampleOf('<START>\nA'), fields(['A'], { exampleMessage: '<START>\nB' }))).toEqual({ kind: 'greeting', index: 0 })
    })
    test('an added block is the new card; a removed trailing block is the card before it; an emptied list is the Add button', () => {
        expect(changedFieldTarget(exampleOf('<START>\nA'), exampleOf('<START>\nA\n<START>\n'))).toEqual({ kind: 'example', card: 1 })
        expect(changedFieldTarget(exampleOf('<START>\nA\n<START>\nB'), exampleOf('<START>\nA\n'))).toEqual({ kind: 'example', card: 0 })
        expect(changedFieldTarget(exampleOf('<START>\nA'), exampleOf(''))).toEqual({ kind: 'exampleAdd' })
    })
    test('a text with an opening counts the opening as card 0', () => {
        expect(changedFieldTarget(exampleOf('hello\n<START>\nA'), exampleOf('hello\n<START>\nB'))).toEqual({ kind: 'example', card: 1 })
    })
    test('an absent example text reads as empty', () => {
        expect(changedFieldTarget(exampleOf('<START>\nA'), fields(['a'], { exampleMessage: undefined }))).toEqual({ kind: 'exampleAdd' })
    })
})

describe('the example target resolves to the example form', () => {
    afterEach(() => {
        document.body.replaceChildren()
    })

    function mountExampleForm(withTextView: boolean): { cards: HTMLElement[]; add: HTMLElement; text: HTMLElement | null } {
        const form = document.createElement('div')
        form.dataset.part = 'studio-example-form'
        const cards = [0, 1].map(() => {
            const field = document.createElement('textarea')
            field.dataset.part = 'studio-example-input'
            form.appendChild(field)
            return field
        })
        const add = document.createElement('button')
        add.dataset.part = 'studio-example-add'
        form.appendChild(add)
        let text: HTMLElement | null = null
        if (withTextView) {
            text = document.createElement('textarea')
            text.dataset.part = 'studio-example-text'
            form.appendChild(text)
        }
        document.body.appendChild(form)
        return { cards, add, text }
    }

    const before = fields(['a'], { exampleMessage: '<START>\nA\n<START>\nB' })
    const edited = fields(['a'], { exampleMessage: '<START>\nA\n<START>\nb' })

    test('a card edit focuses that card of the list', async () => {
        const { cards } = mountExampleForm(false)
        await placeFocusAfterHistory(before, edited, () => document, () => null)
        expect(document.activeElement).toBe(cards[1])
    })
    test('the Add button is the target of an emptied list', async () => {
        const { add } = mountExampleForm(false)
        await placeFocusAfterHistory(before, fields(['a'], { exampleMessage: '' }), () => document, () => null)
        expect(document.activeElement).toBe(add)
    })
    test('with the text view shown, both targets resolve to the text view', async () => {
        const { text } = mountExampleForm(true)
        await placeFocusAfterHistory(before, edited, () => document, () => null)
        expect(document.activeElement).toBe(text)
        ;(document.activeElement as HTMLElement).blur()
        await placeFocusAfterHistory(before, fields(['a'], { exampleMessage: '' }), () => document, () => null)
        expect(document.activeElement).toBe(text)
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
        row.dataset.index = '0'
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
