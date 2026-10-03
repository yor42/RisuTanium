import { describe, expect, test, vi } from 'vitest'

vi.mock('../tokenizer', () => ({
    tokenizeAccurate: vi.fn(async (text: string) => text.length),
}))

vi.mock('../storage/database.svelte', () => ({
    getDatabase: vi.fn(),
    presetTemplate: {},
    setDatabase: vi.fn(),
}))

vi.mock('../alert', () => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
}))

vi.mock('../stores.svelte', () => ({
    DBState: { db: {} },
}))

import { tokenizePreset, type PromptItem } from './prompt'

describe('tokenizePreset', () => {
    test('a lorebook item adds nothing for its innerFormat', async () => {
        const items: PromptItem[] = [{ type: 'lorebook', innerFormat: 'abc' }]
        expect(await tokenizePreset(items)).toBe(0)
    })

    test('a postEverything item adds nothing for its innerFormat', async () => {
        const items: PromptItem[] = [{ type: 'postEverything', innerFormat: 'abc' }]
        expect(await tokenizePreset(items)).toBe(0)
    })

    test('persona, description, authornote and memory items still count their innerFormat', async () => {
        const items: PromptItem[] = [
            { type: 'persona', innerFormat: 'abc' },
            { type: 'description', innerFormat: 'de' },
            { type: 'authornote', innerFormat: 'f' },
            { type: 'memory', innerFormat: 'gh' },
        ]
        expect(await tokenizePreset(items)).toBe(8)
    })
})
