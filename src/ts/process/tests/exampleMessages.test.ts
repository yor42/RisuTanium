import { describe, test, expect, vi } from 'vitest'
import type { character, groupChat } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/process/scripts'))

import { exampleMessage, hasExampleTurns } from 'src/ts/process/exampleMessages'

function charOf(exampleMessage: string | undefined, name = 'bot'): character {
    return { name, exampleMessage } as unknown as character
}

describe('hasExampleTurns', () => {
    test.each([
        ['{{char}}: hi', true],
        ['<BOT>: hi', true],
        ['bot: hi', true],
        ['{{user}}: hi', true],
        ['<user>: hi', true],
        ['  {{User}}: hi', true],
        ['<START>', false],
        ['plain text only', false],
        ['', false],
    ])('%j -> %s', (text, expected) => {
        expect(hasExampleTurns(charOf(text))).toBe(expected)
    })

    test('a missing exampleMessage and a group have no turns', () => {
        expect(hasExampleTurns(charOf(undefined))).toBe(false)
        expect(hasExampleTurns({ type: 'group' } as unknown as groupChat)).toBe(false)
    })

    test('agrees with exampleMessage: speaker entries exist exactly when it says so', () => {
        for (const text of ['<START>\n{{user}}: a\n{{char}}: b', '<START>', 'text', 'bot: x\nmore', '']) {
            const c = charOf(text)
            const turns = exampleMessage(c).filter((m) => m.name !== undefined)
            expect(hasExampleTurns(c)).toBe(turns.length > 0)
        }
    })
})

describe('exampleMessage', () => {
    test('guard (passes before and after the shared prefix test): output', () => {
        const out = exampleMessage(charOf('intro\n<START>\n{{user}}: hi\nthere\nbot: yo\n<bot>: two\n<user>: x'))
        expect(out).toEqual([
            { role: 'system', content: '[Start a new chat]', name: undefined, memo: 'NewChatExample' },
            { role: 'user', content: 'hi\nthere', name: 'example_user', memo: undefined },
            { role: 'assistant', content: 'yo', name: 'example_assistant', memo: undefined },
            { role: 'assistant', content: 'two', name: 'example_assistant', memo: undefined },
            { role: 'user', content: 'x', name: 'example_user', memo: undefined },
        ])
    })
})
