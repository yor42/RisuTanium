import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { characters: [] as unknown[] },
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: h.db }, selectedCharID: writable(0), selIdState: { selId: 0 } }
})
vi.mock('src/ts/process/scripts', () => ({ processScriptFull: vi.fn(), risuChatParser: vi.fn() }))
vi.mock('src/ts/cbs', () => ({ splitSentMessages: vi.fn() }))
vi.mock('src/ts/process/exampleMessages', () => ({ hasExampleTurns: vi.fn() }))
vi.mock('src/ts/process/memory/hypaResume', () => ({ findResumeIndex: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn() }))
vi.mock('src/lang', () => ({ language: {} }))

import { getFirstMessage } from './utils'

function installCharacter(fmIndex: number): void {
    h.db.characters = [{
        firstMessage: 'Default hello',
        alternateGreetings: ['Alt0'],
        chatPage: 0,
        chats: [{ fmIndex, message: [] }],
    }]
}

beforeEach(() => {
    h.db.characters = []
})

describe('HypaV3 getFirstMessage', () => {
    test('regression reproducer: a stale fmIndex reads as the default first message', () => {
        installCharacter(3)
        expect(getFirstMessage()).toBe('Default hello')
    })

    test('guard: an in-range fmIndex reads that alternate greeting and -1 the default', () => {
        installCharacter(0)
        expect(getFirstMessage()).toBe('Alt0')
        installCharacter(-1)
        expect(getFirstMessage()).toBe('Default hello')
    })
})