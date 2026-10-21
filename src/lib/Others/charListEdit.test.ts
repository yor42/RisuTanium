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
import { actingPicks, canEdit, chooseRowForms, dragPlan, gestureRef, groupPlan, resolvePicked, samePick, stalePickedKeys, type Picked } from './charListEdit'

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

describe('groupPlan', () => {
    const chars = [makeChar('a', 'A'), makeChar('b', 'B'), makeChar('c', 'C')]
    const live = [match(0, 'a'), match(1, 'b'), match(2, 'c')]
    const slotKey = (chaId: string) => JSON.stringify(['s', chaId, 0])

    /** The selection of the tiles named by `keys`, picked as the Grid picks them. */
    const select = (entries: Map<string, GridEntry>, order: (string | folder)[], keys: string[]): Map<string, Picked> => {
        const selection = new Map<string, Picked>()
        for (const key of keys) {
            const picked = resolvePicked(entries.get(key)!, chars, order)
            if (picked) {
                selection.set(key, picked)
            }
        }
        return selection
    }
    const folderKeyOf = (entries: Map<string, GridEntry>, id: string): string => [...entries.values()].find((e) => e.kind === 'folder' && e.id === id)!.key

    test('characters give their order references; nothing picked is unavailable', () => {
        const order = ['a', 'b', 'c']
        const entries = tiles(live, order)
        expect(groupPlan(select(entries, order, [slotKey('b'), slotKey('a')]), entries, chars, order)).toEqual({
            ok: true,
            sources: [{ kind: 'char', id: 'b', occurrence: 0 }, { kind: 'char', id: 'a', occurrence: 0 }],
        })
        expect(groupPlan(new Map(), entries, chars, order)).toEqual({ ok: false, reason: 'empty' })
    })

    test('a pick that went stale is skipped; with none left the plan is empty', () => {
        const order = ['a', 'b', 'c']
        const entries = tiles(live, order)
        const selection = select(entries, order, [slotKey('a'), slotKey('b')])
        const after = tiles([match(0, 'a'), match(2, 'c')], ['a', 'c'])
        expect(groupPlan(selection, after, chars, ['a', 'c'])).toEqual({ ok: true, sources: [{ kind: 'char', id: 'a', occurrence: 0 }] })
        expect(groupPlan(select(entries, order, [slotKey('b')]), after, chars, ['a', 'c'])).toEqual({ ok: false, reason: 'empty' })
    })

    test('a tile without an order entry makes the whole plan unavailable', () => {
        const order = ['a', 'b']
        const flat = new Map(buildGridEntries({ live, order, openFolderIds: new Set(), sort: 'recent', searching: false }).map((entry) => [entry.key, entry]))
        const selection = new Map<string, Picked>([[slotKey('a'), { kind: 'char', char: chars[0] }], [slotKey('b'), { kind: 'char', char: chars[1] }]])
        expect(groupPlan(selection, flat, chars, order)).toEqual({ ok: false, reason: 'unlisted' })
    })

    test('one folder alone is unavailable; a folder with a character or with a second folder is available', () => {
        const order = [makeFolder('f1', ['a']), makeFolder('f2', ['b']), 'c']
        const entries = tiles(live, order)
        const f1 = folderKeyOf(entries, 'f1')
        const f2 = folderKeyOf(entries, 'f2')
        expect(groupPlan(select(entries, order, [f1]), entries, chars, order)).toEqual({ ok: false, reason: 'loneFolder' })
        expect(groupPlan(select(entries, order, [f1, slotKey('c')]), entries, chars, order)).toEqual({
            ok: true,
            sources: [{ kind: 'folder', id: 'f1', occurrence: 0 }, { kind: 'char', id: 'c', occurrence: 0 }],
        })
        expect(groupPlan(select(entries, order, [f1, f2]), entries, chars, order).ok).toBe(true)
    })

    test('a member picked together with its own folder adds nothing: the folder is then alone and unavailable', () => {
        const order = [makeFolder('f1', ['a', 'b']), 'c']
        const entries = tiles(live, order, ['f1'])
        const f1 = folderKeyOf(entries, 'f1')
        expect(groupPlan(select(entries, order, [f1, slotKey('a')]), entries, chars, order)).toEqual({ ok: false, reason: 'loneFolder' })
        expect(groupPlan(select(entries, order, [f1, slotKey('a'), slotKey('b')]), entries, chars, order)).toEqual({ ok: false, reason: 'loneFolder' })
    })

    test('a member of another folder, or a character, still counts beside a picked folder', () => {
        const order = [makeFolder('f1', ['a']), makeFolder('f2', ['b', 'c'])]
        const entries = tiles(live, order, ['f1', 'f2'])
        const f1 = folderKeyOf(entries, 'f1')
        const plan = groupPlan(select(entries, order, [f1, slotKey('b')]), entries, chars, order)
        expect(plan.ok && plan.sources).toEqual([
            { kind: 'folder', id: 'f1', occurrence: 0 },
            { kind: 'member', folder: { kind: 'folder', id: 'f2', occurrence: 0 }, id: 'b', occurrence: 0 },
        ])
    })

    test('with two folders sharing an id, a member of the second still counts beside the first folder', () => {
        const order = [makeFolder('f1', ['a']), makeFolder('f1', ['b', 'c'])]
        const entries = tiles(live, order, ['f1'])
        const first = [...entries.values()].find((e) => e.kind === 'folder' && e.ref.occurrence === 0)!.key
        const plan = groupPlan(select(entries, order, [first, slotKey('b')]), entries, chars, order)
        expect(plan.ok && plan.sources).toEqual([
            { kind: 'folder', id: 'f1', occurrence: 0 },
            { kind: 'member', folder: { kind: 'folder', id: 'f1', occurrence: 1 }, id: 'b', occurrence: 0 },
        ])
    })

    test('the reference comes from the current entries, not from the pick', () => {
        const before = ['a', 'b']
        const selection = select(tiles(live, before), before, [slotKey('a')])
        const moved = [makeFolder('f1', ['a']), 'b']
        const entries = tiles(live, moved, ['f1'])
        expect(groupPlan(selection, entries, chars, moved)).toEqual({
            ok: true,
            sources: [{ kind: 'member', folder: { kind: 'folder', id: 'f1', occurrence: 0 }, id: 'a', occurrence: 0 }],
        })
    })

    test('planning leaves the selection untouched', () => {
        const order = ['a', 'b']
        const entries = tiles(live, order)
        const selection = select(entries, order, [slotKey('a'), slotKey('b')])
        const keys = [...selection.keys()]
        groupPlan(selection, tiles([match(0, 'a')], ['a']), chars, ['a'])
        expect([...selection.keys()]).toEqual(keys)
    })
})

describe('chooseRowForms', () => {
    // Row 280, Group 32, two gaps of 8 (16): beside a 224 px label 8 px are left, beside a 32 px icon 200.
    const base = { fullWidth: 90, numberWidth: 17, rowWidth: 280, groupWidth: 32, labelWidth: 224, iconWidth: 32, gap: 8 }
    const forms = (over: Partial<typeof base>) => chooseRowForms({ ...base, ...over })

    test('the full text beside the label when it fits, boundary included', () => {
        expect(forms({ labelWidth: 100 })).toEqual({ count: 'full', iconTrash: false })
        expect(forms({ labelWidth: 142 })).toEqual({ count: 'full', iconTrash: false })
        expect(forms({ labelWidth: 143 })).toEqual({ count: 'number', iconTrash: false })
    })

    test('the number beside the label when only the number fits there', () => {
        expect(forms({ labelWidth: 200 })).toEqual({ count: 'number', iconTrash: false })
        expect(forms({ labelWidth: 215 })).toEqual({ count: 'number', iconTrash: false })
    })

    test('an icon trash when not even the number fits beside the label; the count is full if it fits beside the icon, else the number', () => {
        expect(forms({})).toEqual({ count: 'full', iconTrash: true })
        expect(forms({ rowWidth: 100 })).toEqual({ count: 'number', iconTrash: true })
        expect(forms({ rowWidth: 100, labelWidth: 30 })).toEqual({ count: 'number', iconTrash: false })
    })

    test('an unmeasured row shows the full text and the label', () => {
        expect(forms({ rowWidth: 0 })).toEqual({ count: 'full', iconTrash: false })
        expect(chooseRowForms({ fullWidth: 0, numberWidth: 0, rowWidth: 0, groupWidth: 0, labelWidth: 0, iconWidth: 0, gap: 0 })).toEqual({ count: 'full', iconTrash: false })
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

describe('samePick', () => {
    test('two picks are the same only when they stand for the identical object', () => {
        const a = makeChar('a', 'A')
        const f1 = makeFolder('f1', ['a'])
        expect(samePick({ kind: 'char', char: a }, { kind: 'char', char: a })).toBe(true)
        expect(samePick({ kind: 'char', char: a }, { kind: 'char', char: { ...a } })).toBe(false)
        expect(samePick({ kind: 'folder', folder: f1 }, { kind: 'folder', folder: f1 })).toBe(true)
        expect(samePick({ kind: 'folder', folder: f1 }, { kind: 'folder', folder: { ...f1 } })).toBe(false)
        expect(samePick({ kind: 'char', char: a }, { kind: 'folder', folder: f1 })).toBe(false)
    })
})

describe('dragPlan', () => {
    const chars = [makeChar('a', 'A'), makeChar('b', 'B'), makeChar('c', 'C'), makeChar('d', 'D')]
    const live = [match(0, 'a'), match(1, 'b'), match(2, 'c'), match(3, 'd')]
    const slotKey = (chaId: string) => JSON.stringify(['s', chaId, 0])
    const charRef = (id: string) => ({ kind: 'char', id, occurrence: 0 })

    const select = (entries: Map<string, GridEntry>, order: (string | folder)[], keys: string[]): Map<string, Picked> => {
        const selection = new Map<string, Picked>()
        for (const key of keys) {
            selection.set(key, resolvePicked(entries.get(key)!, chars, order)!)
        }
        return selection
    }
    const folderKeyOf = (entries: Map<string, GridEntry>, id: string, occurrence = 0): string =>
        [...entries.values()].find((e) => e.kind === 'folder' && e.id === id && e.ref.occurrence === occurrence)!.key
    /** The plan for a press on `pressedKey`, whose identity is read from the same entries (a press that stood). */
    const plan = (selection: Map<string, Picked>, entries: Map<string, GridEntry>, order: (string | folder)[], pressedKey: string) =>
        dragPlan(selection, [...entries.values()], entries, chars, order, { key: pressedKey, picked: resolvePicked(entries.get(pressedKey)!, chars, order)! })

    test('R-plan-1 an unselected pressed tile drags only itself and the selection stays as it is', () => {
        const order = ['a', 'b', 'c', 'd']
        const entries = tiles(live, order)
        const selection = select(entries, order, [slotKey('a'), slotKey('b')])
        const result = plan(selection, entries, order, slotKey('c'))
        expect(result).toEqual({ ok: true, sources: [charRef('c')], keys: new Set([slotKey('c')]), count: 1 })
        expect([...selection.keys()]).toEqual([slotKey('a'), slotKey('b')])
    })

    test('R-plan-1 a selected pressed tile drags the whole live selection, in document order whatever the pick order', () => {
        const order = ['a', 'b', 'c', 'd']
        const entries = tiles(live, order)
        const selection = select(entries, order, [slotKey('d'), slotKey('a'), slotKey('c')])
        const result = plan(selection, entries, order, slotKey('c'))
        expect(result).toEqual({ ok: true, sources: [charRef('a'), charRef('c'), charRef('d')], keys: new Set([slotKey('a'), slotKey('c'), slotKey('d')]), count: 3 })
        expect(result.ok && [...result.keys]).toEqual([slotKey('a'), slotKey('c'), slotKey('d')])
    })

    test('R-plan-1 a pick that went stale is skipped', () => {
        const order = ['a', 'b', 'c', 'd']
        const selection = select(tiles(live, order), order, [slotKey('a'), slotKey('b')])
        const after = ['a', 'c', 'd']
        const entries = tiles([match(0, 'a'), match(2, 'c'), match(3, 'd')], after)
        const result = dragPlan(selection, [...entries.values()], entries, chars, after, { key: slotKey('a'), picked: { kind: 'char', char: chars[0] } })
        expect(result).toEqual({ ok: true, sources: [charRef('a')], keys: new Set([slotKey('a')]), count: 1 })
    })

    test('R-plan-1 a member picked with its own folder rides with the folder: one source, counted once', () => {
        const order = [makeFolder('f1', ['a', 'b']), 'c', 'd']
        const entries = tiles(live, order, ['f1'])
        const f1 = folderKeyOf(entries, 'f1')
        const selection = select(entries, order, [slotKey('a'), f1, slotKey('c'), slotKey('b')])
        const result = plan(selection, entries, order, f1)
        expect(result).toEqual({
            ok: true,
            sources: [{ kind: 'folder', id: 'f1', occurrence: 0 }, charRef('c')],
            keys: new Set([f1, slotKey('c')]),
            count: 2,
        })
    })

    test('R-plan-1 a member is dropped by the resolved position of its folder, never by the folder id alone', () => {
        const order = [makeFolder('f1', ['a']), makeFolder('f1', ['b', 'c']), 'd']
        const entries = tiles(live, order, ['f1'])
        const first = folderKeyOf(entries, 'f1', 0)
        const selection = select(entries, order, [first, slotKey('b')])
        const result = plan(selection, entries, order, first)
        expect(result.ok && result.sources).toEqual([
            { kind: 'folder', id: 'f1', occurrence: 0 },
            { kind: 'member', folder: { kind: 'folder', id: 'f1', occurrence: 1 }, id: 'b', occurrence: 0 },
        ])
        expect(result.ok && result.count).toBe(2)
    })

    test('R-plan-1 a member of one folder is kept when only a different folder with another id moves', () => {
        const order = [makeFolder('f1', ['a']), makeFolder('g1', ['b']), 'c', 'd']
        const entries = tiles(live, order, ['f1', 'g1'])
        const f1 = folderKeyOf(entries, 'f1')
        const selection = select(entries, order, [f1, slotKey('b')])
        const result = plan(selection, entries, order, f1)
        expect(result.ok && result.sources).toEqual([
            { kind: 'folder', id: 'f1', occurrence: 0 },
            { kind: 'member', folder: { kind: 'folder', id: 'g1', occurrence: 0 }, id: 'b', occurrence: 0 },
        ])
        expect(result.ok && result.count).toBe(2)
    })

    test('R-plan-1 a lone folder is a valid drag, unlike Group', () => {
        const order = [makeFolder('f1', ['a']), 'b']
        const entries = tiles(live, order)
        const f1 = folderKeyOf(entries, 'f1')
        expect(plan(select(entries, order, [f1]), entries, order, f1)).toEqual({ ok: true, sources: [{ kind: 'folder', id: 'f1', occurrence: 0 }], keys: new Set([f1]), count: 1 })
        expect(plan(new Map(), entries, order, f1)).toMatchObject({ ok: true, count: 1 })
    })

    test('R-plan-1 a tile with no order entry refuses the whole drag, whether it is pressed or only selected', () => {
        const order = ['a', 'b']
        const entries = tiles(live, order)
        expect(plan(new Map(), entries, order, slotKey('c'))).toEqual({ ok: false, reason: 'unlisted' })
        const selection = select(entries, order, [slotKey('a'), slotKey('d')])
        expect(plan(selection, entries, order, slotKey('a'))).toEqual({ ok: false, reason: 'unlisted' })
        const flat = new Map(buildGridEntries({ live, order, openFolderIds: new Set(), sort: 'recent', searching: false }).map((entry) => [entry.key, entry]))
        expect(plan(new Map(), flat, order, slotKey('a'))).toEqual({ ok: false, reason: 'unlisted' })
    })

    test('R-plan-1 N counts a folder once whether it moves whole or dissolves, and members riding with it not at all', () => {
        const order = [makeFolder('f1', ['a', 'b']), makeFolder('f2', ['c']), 'd']
        const entries = tiles(live, order, ['f1', 'f2'])
        const f1 = folderKeyOf(entries, 'f1')
        const f2 = folderKeyOf(entries, 'f2')
        const selection = select(entries, order, [f1, f2, slotKey('a'), slotKey('b'), slotKey('c'), slotKey('d')])
        const result = plan(selection, entries, order, f2)
        expect(result.ok && result.count).toBe(3)
        expect(result.ok && result.sources).toHaveLength(3)
    })

    test('R-plan-2 a pressed key that now names another object is not ok', () => {
        const order = ['a', 'b', 'c']
        const entries = tiles(live, order)
        const stood = resolvePicked(entries.get(slotKey('b'))!, chars, order)!
        const replaced = [chars[0], makeChar('b', 'B again'), chars[2], chars[3]]
        const result = dragPlan(new Map(), [...entries.values()], entries, replaced, order, { key: slotKey('b'), picked: stood })
        expect(result).toEqual({ ok: false, reason: 'stale' })
        expect(dragPlan(new Map(), [...entries.values()], entries, chars, order, { key: slotKey('b'), picked: stood }).ok).toBe(true)
    })

    test('R-plan-2 a pressed folder replaced by a same-id twin, or a pressed tile that left the entries, is not ok', () => {
        const original = makeFolder('f1', ['a'])
        const order = [original, 'b']
        const entries = tiles(live, order)
        const f1 = folderKeyOf(entries, 'f1')
        const stood = resolvePicked(entries.get(f1)!, chars, order)!
        const twinOrder = [makeFolder('f1', ['a']), 'b']
        const twinEntries = tiles(live, twinOrder)
        expect(dragPlan(new Map(), [...twinEntries.values()], twinEntries, chars, twinOrder, { key: f1, picked: stood })).toEqual({ ok: false, reason: 'stale' })
        const gone = tiles([match(1, 'b')], ['b'])
        expect(dragPlan(new Map(), [...gone.values()], gone, chars, ['b'], { key: f1, picked: stood })).toEqual({ ok: false, reason: 'stale' })
    })

    test('R-plan-2 a pressed tile whose own pick went stale drags alone', () => {
        const order = ['a', 'b', 'c']
        const entries = tiles(live, order)
        const selection = select(entries, order, [slotKey('a'), slotKey('b')])
        const replaced = [makeChar('a', 'A again'), chars[1], chars[2], chars[3]]
        const pressedNow = resolvePicked(entries.get(slotKey('a'))!, replaced, order)!
        expect(dragPlan(selection, [...entries.values()], entries, replaced, order, { key: slotKey('a'), picked: pressedNow })).toEqual({
            ok: true,
            sources: [charRef('a')],
            keys: new Set([slotKey('a')]),
            count: 1,
        })
    })
})
