import { describe, expect, test } from 'vitest'
import type { character, folder } from '../../ts/storage/database.svelte'
import { buildIndex, createSearchCache, searchIndex, type CharacterMatch } from '../../ts/gui/characterSearch'
import { refKey, type OrderEntry } from '../SideBars/sidebarOrder'
import { buildGridEntries, folderTileClass, type GridEntry } from './charListOrder'

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

    test('(U) a sort other than the saved order lists the live characters flat, in the order given', () => {
        for (const sort of ['recent', 'name'] as const) {
            const entries = buildGridEntries({ live, order, openFolderIds: new Set(['f1']), sort, searching: false })
            expect(entries.map(label)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
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
