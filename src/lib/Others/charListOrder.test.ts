import { describe, expect, test, vi } from 'vitest'
import type { character, folder } from '../../ts/storage/database.svelte'
import { buildIndex, createSearchCache, searchIndex, type CharacterMatch } from '../../ts/gui/characterSearch'
import { refKey, type OrderEntry } from '../SideBars/sidebarOrder'
import { buildGridEntries, compareRecent, folderTileClass, type GridEntry, type SortMode } from './charListOrder'

/** The Grid tab's tile list: the live characters in the saved order, with folders. */

const match = (index: number, chaId: string): CharacterMatch => ({ index, chaId, key: JSON.stringify(['s', chaId, index]) })
const makeFolder = (id: string, data: string[], extra: Partial<folder> = {}): folder => ({ id, name: `name-${id}`, data, color: '', ...extra })
const none: ReadonlySet<string> = new Set()
const label = (entry: GridEntry): string => (entry.kind === 'folder' ? `[${entry.id}:${entry.count}${entry.open ? ' open' : ''}]` : `${entry.index}`)

describe('buildGridEntries: placement', () => {
    // Slots: 0 a, 1 b, 2 g, 3 g, 4 x, 5 x, 6 y, 7 u. The order lists x twice, y three times and g once.
    const live = [match(0, 'a'), match(1, 'b'), match(2, 'g'), match(3, 'g'), match(4, 'x'), match(5, 'x'), match(6, 'y'), match(7, 'u')]
    const order: OrderEntry[] = [
        'b',
        makeFolder('f1', ['a', 'dead', 'y']),
        null,
        'ghost',
        'g',
        'x',
        makeFolder('f2', ['x', 'y']),
        makeFolder('f3', ['dead']),
        'y',
    ]

    test('(U) closed folders are one tile; a repeated id takes the next holder; unlisted and unused holders follow in slot order', () => {
        const entries = buildGridEntries({ live, order, openFolderIds: none, sort: 'order', searching: false })
        expect(entries.map(label)).toEqual(['1', '[f1:2]', '2', '4', '[f2:1]', '3', '7'])
        expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length)
    })

    test('(U) an open folder is followed by its members, which name their folder', () => {
        const entries = buildGridEntries({ live, order, openFolderIds: new Set(['f1', 'f2']), sort: 'order', searching: false })
        expect(entries.map(label)).toEqual(['1', '[f1:2 open]', '0', '6', '2', '4', '[f2:1 open]', '5', '3', '7'])
        const members = entries.filter((entry) => entry.kind === 'char' && entry.folderId !== undefined)
        expect(members.map((entry) => entry.kind === 'char' && [entry.index, entry.folderId, entry.folderName])).toEqual([
            [0, 'f1', 'name-f1'],
            [6, 'f1', 'name-f1'],
            [5, 'f2', 'name-f2'],
        ])
        const top = entries.find((entry) => entry.kind === 'char' && entry.index === 1)
        expect(top?.kind === 'char' && top.folderId).toBeUndefined()
    })

    test('(U) a folder tile is keyed like the rail keys the folder, a character tile by its slot', () => {
        const entries = buildGridEntries({ live, order, openFolderIds: none, sort: 'order', searching: false })
        const f1 = entries.find((entry) => entry.kind === 'folder' && entry.id === 'f1')
        expect(f1?.key).toBe(refKey({ kind: 'folder', id: 'f1', occurrence: 0 }))
        expect(entries.find((entry) => entry.kind === 'char' && entry.index === 2)?.key).toBe(live[2].key)
    })

    test('(U) searching gives the flattened order with the folder name on each member and no folder tile', () => {
        const entries = buildGridEntries({ live, order, openFolderIds: new Set(['f1']), sort: 'order', searching: true })
        expect(entries.map(label)).toEqual(['1', '0', '6', '2', '4', '5', '3', '7'])
        expect(entries.map((entry) => entry.kind === 'char' ? entry.folderName : 'folder')).toEqual([undefined, 'name-f1', 'name-f1', undefined, undefined, 'name-f2', undefined, undefined])
    })

    test('(U) a sort other than the saved order lists the live characters flat, with no folder tile', () => {
        const nameOf = (index: number): string => String.fromCharCode(120 - index)
        const interactionOf = (index: number): number => index
        for (const sort of ['recent', 'name'] as const) {
            const entries = buildGridEntries({ live, order, openFolderIds: new Set(['f1']), sort, searching: false, nameOf, interactionOf })
            expect(entries.map(label)).toEqual(['7', '6', '5', '4', '3', '2', '1', '0'])
        }
    })

    test('(U) a missing order lists every live character in the order given', () => {
        const entries = buildGridEntries({ live, order: undefined, openFolderIds: none, sort: 'order', searching: false })
        expect(entries.map(label)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
    })

    test('(U) a folder whose members are all unknown, or that has none, has no tile', () => {
        const entries = buildGridEntries({ live: [match(0, 'a')], order: ['a', makeFolder('f9', ['dead']), makeFolder('f8', [])], openFolderIds: new Set(['f9', 'f8']), sort: 'order', searching: false })
        expect(entries.map(label)).toEqual(['0'])
    })

    test('(U) a folder whose every member was already taken earlier has no tile', () => {
        const entries = buildGridEntries({ live: [match(0, 'a')], order: ['a', makeFolder('f1', ['a'])], openFolderIds: none, sort: 'order', searching: false })
        expect(entries.map(label)).toEqual(['0'])
    })

    test('(U) the colour classes of a folder tile are the rail\'s, with the theme colour for the default', () => {
        expect(folderTileClass('red')).toBe('bg-red-700/50')
        expect(folderTileClass('indigo')).toBe('bg-indigo-700/50')
        expect(folderTileClass('default')).toBe('bg-darkbg/50')
        expect(folderTileClass('')).toBe('bg-darkbg/50')
        expect(folderTileClass('unheard-of')).toBe('bg-darkbg/50')
    })
})

//#region property

/** A small deterministic generator (mulberry32), so a failure names its seed. */
function rng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
        for (const inner of Object.values(value)) {
            deepFreeze(inner)
        }
        Object.freeze(value)
    }
    return value
}

describe('buildGridEntries: property', () => {
    test('(U) every live character appears exactly once, nothing else does, keys are unique and inputs are not mutated', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const random = rng(seed)
            const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
            const ids = ['a', 'b', 'c', 'd', 'e', 'f']
            const characters = Array.from({ length: Math.floor(random() * 12) }, (_, i) => {
                const roll = random()
                return {
                    chaId: roll < 0.1 ? '§playground' : pick(ids),
                    name: `n${i}`,
                    type: 'character',
                    creatorNotes: '',
                    ...(roll > 0.8 ? { trashTime: 1 } : {}),
                } as unknown as character
            })
            const pool = [...ids, 'dead', 'dead2', '§playground']
            const entry = (): OrderEntry => {
                const roll = random()
                if (roll < 0.1) {
                    return null
                }
                if (roll < 0.4) {
                    const data = Array.from({ length: Math.floor(random() * 5) }, () => pick(pool))
                    const made = makeFolder(`f${Math.floor(random() * 4)}`, data)
                    // A folder from other tools can lack its member list.
                    return random() < 0.15 ? ({ id: made.id, name: made.name, color: '' } as unknown as OrderEntry) : made
                }
                return pick(pool)
            }
            const order = Array.from({ length: Math.floor(random() * 14) }, entry)
            const open = new Set(['f0', 'f1', 'f2', 'f3'].filter(() => random() < 0.5))
            const live = searchIndex(buildIndex(characters, createSearchCache()), []).live
            const liveBefore = JSON.stringify(live)
            const orderBefore = JSON.stringify(order)
            deepFreeze(live)
            deepFreeze(order)

            for (const searching of [false, true]) {
                for (const sort of ['order', 'recent', 'name'] as const) {
                    const where = `seed ${seed} searching ${searching} sort ${sort}`
                    const entries = buildGridEntries({ live, order, openFolderIds: open, sort, searching })
                    const keys = entries.map((tile) => tile.key)
                    expect(new Set(keys).size, where).toBe(keys.length)
                    const chars = entries.filter((tile) => tile.kind === 'char')
                    // A closed folder holds its members without a tile of their own.
                    const hidden = entries.reduce((sum, tile) => sum + (tile.kind === 'folder' && !tile.open ? tile.count : 0), 0)
                    expect(chars.length + hidden, where).toBe(live.length)
                    expect(chars.every((tile) => live.some((m) => m.key === tile.key)), where).toBe(true)
                    if (hidden === 0) {
                        expect(chars.map((tile) => tile.key).sort(), where).toEqual(live.map((m) => m.key).sort())
                    }
                    for (const tile of chars) {
                        expect(live.find((m) => m.key === tile.key)?.index, where).toBe(tile.index)
                    }
                    if (searching || sort !== 'order') {
                        expect(entries.every((tile) => tile.kind === 'char'), where).toBe(true)
                    }
                    for (const tile of entries) {
                        if (tile.kind === 'folder') {
                            expect(tile.count, where).toBeGreaterThan(0)
                        }
                    }
                }
            }
            expect(JSON.stringify(live)).toBe(liveBefore)
            expect(JSON.stringify(order)).toBe(orderBefore)
        }
    })
})

//#endregion

//#region sorts: Recent and Name (F = new behaviour, fails before the sorts exist; G = guard)

interface SortSlot {
    chaId: string
    name: string
    interaction: number
}

function buildSorted(slots: SortSlot[], sort: SortMode, order: OrderEntry[] | undefined = undefined, searching = false) {
    const live = slots.map((slot, index) => match(index, slot.chaId))
    const nameOf = vi.fn((index: number) => slots[index].name)
    const interactionOf = vi.fn((index: number) => slots[index].interaction)
    const entries = buildGridEntries({ live, order, openFolderIds: none, sort, searching, nameOf, interactionOf })
    return { entries, live, nameOf, interactionOf }
}

const slotIndexes = (entries: GridEntry[]): number[] => entries.map((entry) => (entry.kind === 'char' ? entry.index : -1))
const folderOfTile = (entries: GridEntry[], index: number): Array<string | undefined> | null => {
    const entry = entries.find((candidate) => candidate.kind === 'char' && candidate.index === index)
    return entry?.kind === 'char' ? [entry.folderId, entry.folderName] : null
}

describe('buildGridEntries: Recent', () => {
    const slots: SortSlot[] = [
        { chaId: 'a', name: 'Beta', interaction: 5 },
        { chaId: 'b', name: 'Alpha', interaction: 9 },
        { chaId: 'c', name: 'Zed', interaction: 5 },
        { chaId: 'd', name: 'Alpha', interaction: 0 },
        { chaId: 'e', name: 'Mid', interaction: 5 },
    ]

    test('(F) newest first; equal interactions fall back to the displayed name, as the simple list does', () => {
        expect(slotIndexes(buildSorted(slots, 'recent').entries)).toEqual([1, 0, 4, 2, 3])
    })

    test('(F) members of folders carry their folder, others none, and no folder tile appears', () => {
        const order: OrderEntry[] = ['a', makeFolder('f1', ['c', 'd'])]
        const { entries } = buildSorted(slots, 'recent', order)
        expect(entries.every((entry) => entry.kind === 'char')).toBe(true)
        expect(folderOfTile(entries, 2)).toEqual(['f1', 'name-f1'])
        expect(folderOfTile(entries, 3)).toEqual(['f1', 'name-f1'])
        expect(folderOfTile(entries, 0)).toEqual([undefined, undefined])
        expect(folderOfTile(entries, 1)).toEqual([undefined, undefined])
    })

    test('(F) the sort works on a copy: live keeps its order', () => {
        const { live } = buildSorted(slots, 'recent')
        expect(live.map((m) => m.index)).toEqual([0, 1, 2, 3, 4])
    })

    test('(G) compareRecent is the comparator the simple list sorts with', () => {
        const rows = slots.map((slot) => ({ name: slot.name, interaction: slot.interaction }))
        expect([...rows].sort(compareRecent).map((row) => rows.indexOf(row))).toEqual([1, 0, 4, 2, 3])
    })
})

describe('buildGridEntries: Name', () => {
    test('(F) by displayed name with the locale collation', () => {
        const slots: SortSlot[] = [
            { chaId: 'a', name: 'zebra', interaction: 0 },
            { chaId: 'b', name: 'Apple', interaction: 0 },
            { chaId: 'c', name: 'apple pie', interaction: 0 },
            { chaId: 'd', name: 'Ärger', interaction: 0 },
        ]
        const expected = slots.map((_, i) => i).sort((x, y) => slots[x].name.localeCompare(slots[y].name))
        expect(expected).not.toEqual([0, 1, 2, 3])
        expect(slotIndexes(buildSorted(slots, 'name').entries)).toEqual(expected)
    })

    test('(F) equal names are ordered by key, whatever the order of live', () => {
        const live = [match(2, 'c'), match(0, 'a'), match(1, 'b')]
        const entries = buildGridEntries({ live, order: undefined, openFolderIds: none, sort: 'name', searching: false, nameOf: () => 'Same' })
        expect(slotIndexes(entries)).toEqual([0, 1, 2])
    })

    test('(F) members of folders carry their folder in Name too', () => {
        const slots: SortSlot[] = [
            { chaId: 'a', name: 'B', interaction: 0 },
            { chaId: 'b', name: 'A', interaction: 0 },
        ]
        const { entries } = buildSorted(slots, 'name', [makeFolder('f', ['b'])])
        expect(slotIndexes(entries)).toEqual([1, 0])
        expect(folderOfTile(entries, 1)).toEqual(['f', 'name-f'])
        expect(folderOfTile(entries, 0)).toEqual([undefined, undefined])
    })
})

describe('buildGridEntries: what is read', () => {
    const slots: SortSlot[] = [
        { chaId: 'a', name: 'B', interaction: 1 },
        { chaId: 'b', name: 'A', interaction: 2 },
    ]

    test('(F) the last interaction is read only under Recent', () => {
        expect(buildSorted(slots, 'order').interactionOf).not.toHaveBeenCalled()
        expect(buildSorted(slots, 'name').interactionOf).not.toHaveBeenCalled()
        expect(buildSorted(slots, 'recent').interactionOf).toHaveBeenCalled()
    })

    test('(G) the name is not read under My order', () => {
        expect(buildSorted(slots, 'order').nameOf).not.toHaveBeenCalled()
    })

    test('(G) a flat sort does not modify the saved order', () => {
        const order: OrderEntry[] = ['a', makeFolder('f', ['b'])]
        const before = JSON.stringify(order)
        buildSorted(slots, 'recent', order)
        buildSorted(slots, 'name', order)
        expect(JSON.stringify(order)).toBe(before)
    })

    test('(G) searching under My order keeps the saved-order list with folder names', () => {
        const order: OrderEntry[] = [makeFolder('f', ['b']), 'a']
        const { entries } = buildSorted(slots, 'order', order, true)
        expect(slotIndexes(entries)).toEqual([1, 0])
        expect(folderOfTile(entries, 1)).toEqual(['f', 'name-f'])
    })
})

//#endregion
