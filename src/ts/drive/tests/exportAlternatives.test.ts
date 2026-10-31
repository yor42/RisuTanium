// CHORE-478 S1c: the strip functions of a `.bin` export. Titles: `reproducer` fails when the strip is absent; `guard`
// passes before and after and pins that nothing is copied or changed when there is nothing to strip.
import { describe, test, expect } from 'vitest'
import { alternativeChatLabels, chatHoldsAlternatives, withoutChatAlternatives, withoutColdValueAlternatives } from '../exportAlternatives'

const ALT = [{ m: { time: 2, data: 'x', role: 'char' }, p: null, a: 1 }]

function character(chats: Record<string, unknown>[]): Record<string, unknown> {
    return { chaId: 'c1', name: 'Alice', chats }
}

describe('withoutChatAlternatives', () => {
    test('reproducer: a chat with alt comes back without it, the other fields intact, and the input is untouched', () => {
        const input = character([{ name: 'A', message: [1], alt: ALT }, { name: 'B', message: [2] }])
        const snapshot = JSON.stringify(input)

        const out = withoutChatAlternatives(input)

        expect(out).not.toBe(input)
        expect(out.chats).toEqual([{ name: 'A', message: [1] }, { name: 'B', message: [2] }])
        expect(JSON.stringify(input)).toBe(snapshot)
    })

    test('guard: a character without alt is returned itself, not a copy', () => {
        const input = character([{ name: 'A', message: [1] }])
        expect(withoutChatAlternatives(input)).toBe(input)
        expect(withoutChatAlternatives({ name: 'no chats' })).toEqual({ name: 'no chats' })
    })

    test('reproducer: an empty alt list is removed as well', () => {
        const out = withoutChatAlternatives(character([{ name: 'A', alt: [] }]))
        expect('alt' in (out.chats as Record<string, unknown>[])[0]).toBe(false)
    })
})

describe('alternativeChatLabels', () => {
    test('names only the chats that hold alternatives, character first', () => {
        const input = character([{ name: 'A', alt: ALT }, { name: 'B', alt: [] }, { name: 'C' }, { alt: ALT }])
        expect(alternativeChatLabels(input).map((label) => label.text)).toEqual(['Alice / A', 'Alice / Chat'])
        expect(chatHoldsAlternatives({ alt: [] })).toBe(false)
        expect(chatHoldsAlternatives({ alt: ALT })).toBe(true)
        expect(chatHoldsAlternatives({})).toBe(false)
    })

    test('keys: a chat id is used when there is one, otherwise the position; a character without chaId is keyed by its name', () => {
        const input = character([{ id: 'chat-a', name: 'A', alt: ALT }, { name: 'B', alt: ALT }, { id: '', name: 'C', alt: ALT }])
        expect(alternativeChatLabels(input).map((label) => label.key)).toEqual(['c:c1/id:chat-a', 'c:c1/at:1', 'c:c1/at:2'])
        expect(alternativeChatLabels({ name: 'Bob', chats: [{ name: 'A', alt: ALT }] }).map((label) => label.key)).toEqual(['?:Bob/at:0'])
    })

    // T80 regression reproducer: the key tells chats apart where the text cannot
    test('reproducer: two characters with equally named chats give two labels with distinct keys and the same text', () => {
        const first = alternativeChatLabels({ chaId: 'one', name: 'Alice', chats: [{ name: 'Chat 1', alt: ALT }] })
        const second = alternativeChatLabels({ chaId: 'two', name: 'Alice', chats: [{ name: 'Chat 1', alt: ALT }] })
        expect(first[0].text).toBe(second[0].text)
        expect(first[0].key).not.toBe(second[0].key)
        const twin = alternativeChatLabels(character([{ name: 'Chat', alt: ALT }, { name: 'Chat', alt: ALT }]))
        expect(twin).toHaveLength(2)
        expect(new Set(twin.map((label) => label.key)).size).toBe(2)
    })})

describe('withoutColdValueAlternatives', () => {
    test('reproducer: a character unit and a chat unit lose alt, a copy is returned', () => {
        const unit = { character: character([{ name: 'A', alt: ALT }]) }
        const loose = { message: [1], name: 'Loose', alt: ALT }

        const a = withoutColdValueAlternatives(unit, 'unit-a')
        const b = withoutColdValueAlternatives(loose, 'unit-b')

        expect(JSON.stringify(a.value)).not.toContain('"alt"')
        expect(a.labels).toEqual([{ key: 'c:c1/at:0', text: 'Alice / A' }])
        expect(JSON.stringify(b.value)).not.toContain('"alt"')
        expect(b.labels).toEqual([{ key: 'u:unit-b', text: 'Unknown Character / Loose' }])
        expect('alt' in unit.character.chats[0]).toBe(true)
        expect('alt' in loose).toBe(true)
    })

    test('guard: anything without alt, and any non-object, is returned itself', () => {
        const plain = { character: character([{ name: 'A' }]) }
        expect(withoutColdValueAlternatives(plain, 'k').value).toBe(plain)
        expect(withoutColdValueAlternatives([1, 2], 'k').value).toEqual([1, 2])
        expect(withoutColdValueAlternatives(null, 'k').labels).toEqual([])
    })
})
