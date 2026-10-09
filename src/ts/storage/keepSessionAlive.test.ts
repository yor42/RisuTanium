/**
 * The stored keep-session-alive mode is one of two values; every other stored
 * value (absent, the retired 'pip', an unknown string) reads as 'off'.
 */
import { describe, expect, test, vi } from 'vitest'

// Importing the database module loads modules whose import-time effects read
// the stores; the helper under test needs none of them.
vi.mock(import('../parser/parser.svelte'), () => ({
    risuChatParser: vi.fn(),
    applyMarkdownToNode: vi.fn(),
}) as unknown as typeof import('../parser/parser.svelte'))
vi.mock(import('../process/modules'), () => ({}) as unknown as typeof import('../process/modules'))
vi.mock(import('../stores.svelte'), () => ({
    DBState: { db: {} },
}) as unknown as typeof import('../stores.svelte'))

import { normalizeKeepSessionAlive } from './database.svelte'

describe('normalizeKeepSessionAlive', () => {
    test('keeps the two supported modes', () => {
        expect(normalizeKeepSessionAlive('sound')).toBe('sound')
        expect(normalizeKeepSessionAlive('off')).toBe('off')
    })

    test('reads the retired pip mode as off', () => {
        expect(normalizeKeepSessionAlive('pip')).toBe('off')
    })

    test('reads an absent value as off', () => {
        expect(normalizeKeepSessionAlive(undefined)).toBe('off')
    })

    test('reads an unknown string as off', () => {
        expect(normalizeKeepSessionAlive('Sound')).toBe('off')
        expect(normalizeKeepSessionAlive('')).toBe('off')
        expect(normalizeKeepSessionAlive('future-mode')).toBe('off')
    })
})
