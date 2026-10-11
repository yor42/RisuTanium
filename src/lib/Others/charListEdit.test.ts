// @vitest-environment happy-dom

/**
 * `charListEdit.ts`: the pure parts of the Grid's edit mode. Characters are plain fixtures; tiles come
 * from `buildGridEntries` so the keys and refs are the real ones.
 *
 * Test labels: every test here is a feature test (the module is new, so on the earlier base each one
 * fails at the import and proves nothing about a defect). The safety-critical ones, the stale-pick
 * rules, are backed by a mutation proof recorded in the stage report.
 */
import { describe, expect, test } from 'vitest'
import type { character, folder } from '../../ts/storage/database.svelte'
import type { CharacterMatch } from '../../ts/gui/characterSearch'
import { buildGridEntries, type GridEntry } from './charListOrder'
import { actingPicks, canEdit, gestureRef, resolvePicked, stalePickedKeys, type Picked } from './charListEdit'

const makeChar = (chaId: string, name: string): character => ({ chaId, name, type: 'character' }) as unknown as character
const match = (index: number, chaId: string, n = 0): CharacterMatch => ({ index, chaId, key: JSON.stringify(['s', chaId, n]) })
const makeFolder = (id: string, data: string[]): folder => ({ id, name: id, data, color: '' })

const tiles = (live: CharacterMatch[], order: (string | folder)[], open: string[] = []): Map<string, GridEntry> =>
    new Map(buildGridEntries({ live, order, openFolderIds: new Set(open), sort: 'order', searching: false }).map((entry) => [entry.key, entry]))

describe('canEdit', () => {
    test('only My order can be edited', () => {
        expect(canEdit('order')).toBe(true)
        expect(canEdit('recent')).toBe(false)
        expect(canEdit('name')).toBe(false)
    })
})

describe('resolvePicked', () => {
    test('a character tile resolves to the character object at its slot, a folder tile to the order\'s own entry', () => {
        const a = makeChar('a', 'A')
        const f = makeFolder('f1', ['b'])
        const order = ['a', f]
        const entries = tiles([match(0, 'a'), match(1, 'b')], order)
        const [charTile, folderTile] = [...entries.values()]
        expect(resolvePicked(charTile, [a, makeChar('b', 'B')], order)).toEqual({ kind: 'char', char: a })
        const resolved = resolvePicked(folderTile, [a, makeChar('b', 'B')], order)
        expect(resolved?.kind === 'folder' && resolved.folder === f).toBe(true)
    })

    test('a slot past the end or a folder no longer in the order resolves to nothing', () => {
        const order = ['a', makeFolder('f1', ['b'])]
        const entries = [...tiles([match(0, 'a'), match(1, 'b')], order).values()]
        expect(resolvePicked(entries[0], [], order)).toBeNull()
        expect(resolvePicked(entries[1], [makeChar('a', 'A'), makeChar('b', 'B')], ['a'])).toBeNull()
        expect(resolvePicked(entries[1], [makeChar('a', 'A'), makeChar('b', 'B')], undefined)).toBeNull()
    })
})

describe('stalePickedKeys', () => {
    test('a pick whose tile left the entries is stale; one that still stands for the same object is not', () => {
        const a = makeChar('a', 'A')
        const b = makeChar('b', 'B')
        const order = ['a', 'b']
        const before = tiles([match(0, 'a'), match(1, 'b')], order)
        const selection = new Map<string, Picked>([...before.keys()].map((key, i) => [key, { kind: 'char', char: [a, b][i] }]))
        const after = tiles([match(0, 'a')], ['a'])
        expect(stalePickedKeys(selection, after, [a], ['a'])).toEqual([JSON.stringify(['s', 'b', 0])])
        expect(stalePickedKeys(selection, before, [a, b], order)).toEqual([])
    })

    test('deleting an earlier holder of the same id drops the stale key instead of re-pointing it at the other holder', () => {
        const first = makeChar('a', 'A first')
        const second = makeChar('a', 'A second')
        const order = ['a', 'a']
        const before = tiles([match(0, 'a', 0), match(1, 'a', 1)], order)
        const firstKey = JSON.stringify(['s', 'a', 0])
        const selection = new Map<string, Picked>([[firstKey, { kind: 'char', char: first }]])
        expect(stalePickedKeys(selection, before, [first, second], order)).toEqual([])

        // The first holder is deleted: the surviving one is now the first holder and owns the key.
        const after = tiles([match(0, 'a', 0)], ['a'])
        expect(after.has(firstKey)).toBe(true)
        expect(stalePickedKeys(selection, after, [second], ['a'])).toEqual([firstKey])
        expect(actingPicks(selection, after, [second], ['a'])).toEqual({ characters: [], folders: [] })
    })

    test('a folder pick goes stale when a different same-id folder entry takes its place', () => {
        const original = makeFolder('f1', ['a'])
        const twin = makeFolder('f1', ['a'])
        const characters = [makeChar('a', 'A')]
        const order = [original]
        const entries = tiles([match(0, 'a')], order)
        const key = [...entries.keys()][0]
        const selection = new Map<string, Picked>([[key, { kind: 'folder', folder: original }]])
        expect(stalePickedKeys(selection, entries, characters, order)).toEqual([])
        const replaced = [twin]
        expect(stalePickedKeys(selection, tiles([match(0, 'a')], replaced), characters, replaced)).toEqual([key])
    })
})

describe('actingPicks', () => {
    test('returns the live picks, each object once, characters and folders apart', () => {
        const a = makeChar('a', 'A')
        const b = makeChar('b', 'B')
        const f = makeFolder('f1', ['b'])
        const order = ['a', f]
        const entries = tiles([match(0, 'a'), match(1, 'b')], order, ['f1'])
        const keys = [...entries.keys()]
        const selection = new Map<string, Picked>([
            [keys[0], { kind: 'char', char: a }],
            [keys[1], { kind: 'folder', folder: f }],
            [keys[2], { kind: 'char', char: b }],
        ])
        const acting = actingPicks(selection, entries, [a, b], order)
        expect(acting.characters).toEqual([a, b])
        expect(acting.folders).toEqual([f])
        expect(acting.folders[0]).toBe(f)
    })
})

describe('gestureRef', () => {
    test('a tile with an order entry hands that ref; one without gets a placeholder that names its tile key', () => {
        const entries = [...tiles([match(0, 'a')], ['a']).values()]
        expect(gestureRef(entries[0])).toBe((entries[0] as { ref: unknown }).ref)

        const flat = buildGridEntries({ live: [match(0, 'a')], order: ['a'], openFolderIds: new Set(), sort: 'recent', searching: false })[0]
        expect((flat as { ref: unknown }).ref).toBeNull()
        expect(gestureRef(flat)).toEqual({ kind: 'char', id: flat.key, occurrence: 0 })
    })
})
