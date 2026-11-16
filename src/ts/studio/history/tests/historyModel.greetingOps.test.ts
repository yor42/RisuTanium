// The three greeting list labels through the strict record parser: a valid label reads back whole, a malformed one
// refuses the whole record (never a record with fewer steps).
import { describe, expect, test } from 'vitest'
import { isOpAllowedFor, parseOwnerRecord, type OwnerRecord, type StepLabel } from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'

const KEY = characterOwnerKey('c1')

function readable(label: unknown): OwnerRecord | null {
    const raw = { ownerKey: KEY, touchedAt: 1, done: [{ id: 'p:1', at: 1, label, ops: [] }], undone: [], deleted: [], restore: null }
    return parseOwnerRecord(raw, KEY)
}

describe('greeting list labels', () => {
    test.each<StepLabel>([{ kind: 'greetingMove' }, { kind: 'greetingSwap' }, { kind: 'greetingAddMany', count: 3 }])('%o reads back unchanged', (label) => {
        expect(readable(label)?.done[0].label).toEqual(label)
    })

    test.each([
        ['a zero count', { kind: 'greetingAddMany', count: 0 }],
        ['a fractional count', { kind: 'greetingAddMany', count: 1.5 }],
        ['a missing count', { kind: 'greetingAddMany' }],
        ['a string count', { kind: 'greetingAddMany', count: '2' }],
        ['an extra field', { kind: 'greetingAddMany', count: 2, extra: true }],
    ])('%s refuses the whole record', (_name, label) => {
        expect(readable(label)).toBeNull()
    })

    test('the list ops of move and swap are character-only (rule K)', () => {
        const ops = [
            { op: 'listRemove', index: 0, value: 'a', deletedId: null },
            { op: 'listInsert', index: 1, value: 'a' },
            { op: 'listSet', index: 0, before: 'a', after: 'b' },
            { op: 'chatFm', chatId: 'c', before: { had: true, value: 0 }, after: { had: true, value: 1 } },
        ] as const
        for (const op of ops) {
            expect(isOpAllowedFor('character', op)).toBe(true)
            expect(isOpAllowedFor('chat', op)).toBe(false)
            expect(isOpAllowedFor('module', op)).toBe(false)
        }
        const swapSet = { op: 'set', path: 'firstMessage', before: { had: true, value: 'a' }, after: { had: true, value: 'b' } } as const
        expect(isOpAllowedFor('character', swapSet)).toBe(true)
        expect(isOpAllowedFor('chat', swapSet)).toBe(false)
    })
})
