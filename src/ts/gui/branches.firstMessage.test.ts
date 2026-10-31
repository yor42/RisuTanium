import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    character: {} as unknown,
}))

vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: () => h.character,
}))

import { getChatBranches } from './branches'

const chatOf = (fmIndex: number | undefined, data: string) => ({ fmIndex, message: [{ role: 'user', data }] })

beforeEach(() => {
    h.character = {}
})

describe('getChatBranches first message root', () => {
    test('regression reproducer: a chat with a stale fmIndex shares the root of a default-first-message chat', () => {
        h.character = {
            firstMessage: 'Hello',
            alternateGreetings: ['Alt0'],
            chats: [chatOf(-1, 'a'), chatOf(3, 'b')],
        }
        const rendered = getChatBranches()
        expect(rendered.filter((branch) => branch.y === 0)).toHaveLength(1)
    })

    test('guard: an in-range fmIndex roots its chat at the alternate greeting (passes before and after)',() => {
        h.character = {
            firstMessage: 'Hello',
            alternateGreetings: ['Alt0'],
            chats: [chatOf(-1, 'a'), chatOf(0, 'b')],
        }
        expect(getChatBranches().filter((branch) => branch.y === 0)).toHaveLength(2)
    })
})