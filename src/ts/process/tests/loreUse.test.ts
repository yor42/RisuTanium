import { describe, expect, test } from 'vitest'
import { loreEntryTarget, type LoreUsedEntry } from '../loreUse'

const used = (over: Partial<LoreUsedEntry> = {}): LoreUsedEntry => ({ source: 'character', ownerId: 'cha-1', index: 1, name: 'Castle', ...over })
const live = [{ comment: 'Other' }, { comment: 'Castle' }]

describe('loreEntryTarget', () => {
    test('regression reproducer: an entry with an id is named by it and carries no index item, whatever the live list holds', () => {
        const entry = used({ entryId: 'e-1' })
        expect(loreEntryTarget(entry, live)).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', entry: 'e-1' })
        expect(loreEntryTarget(entry, [])).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', entry: 'e-1' })
        expect(loreEntryTarget(entry, undefined)).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', entry: 'e-1' })
    })

    test('compatibility guard: an id-less entry keeps the item only at the same index and name', () => {
        expect(loreEntryTarget(used(), live)).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', item: 'cha-1/lore:1' })
        expect(loreEntryTarget(used(), [{ comment: 'Castle' }, { comment: 'Other' }])).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore' })
        expect(loreEntryTarget(used(), undefined)).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore' })
    })

    test('compatibility guard: an empty entry id is treated as no id', () => {
        expect(loreEntryTarget(used({ entryId: '' }), live)).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', item: 'cha-1/lore:1' })
    })
})
