// @vitest-environment happy-dom

/**
 * `gridDrop.ts`: the Grid's pure drop resolver. Scenes are built through the real pipeline
 * (`buildGridEntries`, `gridSectionRows`, `buildRowLayout`) and every expected position is written
 * out by hand from the tile size (3.5 rem), the gap (0.5 rem) and a 16 px rem: a tile is 56 px, the
 * pitch 64 px, a row 64 px. With four columns in 248 px a full row has no inset.
 *
 * Test labels: every test here is a feature test of a new module (on the earlier base each one
 * fails at the import); the evidence that the rules are pinned is the mutation table of the stage
 * report. The `tileKeyAt` agreement test is a compatibility guard.
 */
import { describe, expect, test } from 'vitest'
import type { folder } from '../../ts/storage/database.svelte'
import type { CharacterMatch } from '../../ts/gui/characterSearch'
import { refKey, type FolderRef, type Gap, type ItemRef, type OrderEntry } from '../SideBars/sidebarOrder'
import { NO_TARGET } from '../SideBars/railTarget'
import { buildGridEntries, type GridEntry } from './charListOrder'
import { buildRowLayout, gridSectionRows } from './charListRows'
import { appendGap, buildDropModel, gapOf, resolveGridTarget, slotAt, slotKey, zoneCandidateAt, type GridDropInput, type GridMoved, type GridSlot } from './gridDrop'
import { tileKeyAt, type GridGeometry } from './gridTarget'

const makeFolder = (id: string, data: string[]): folder => ({ id, name: id, data, color: '' })
const match = (index: number, chaId: string): CharacterMatch => ({ index, chaId, key: JSON.stringify(['s', chaId, 0]) })
const tile = (chaId: string): string => JSON.stringify(['s', chaId, 0])
const folderTile = (id: string, occurrence = 0): string => refKey({ kind: 'folder', id, occurrence })

interface Scene {
    entries: GridEntry[]
    geometry: GridGeometry
    model: ReturnType<typeof buildDropModel>
    entryOf: (key: string) => GridEntry
}

/** Characters listed in `order` are live, plus the `extra` ones the order does not list. */
function scene(order: (string | folder)[], open: string[] = [], extra: string[] = [], columns = 4, width = 248): Scene {
    const ids = order.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.data)).concat(extra)
    const entries = buildGridEntries({ live: ids.map((id, i) => match(i, id)), order, openFolderIds: new Set(open), sort: 'order', searching: false })
    const rows = gridSectionRows(entries, columns)
    const geometry: GridGeometry = { rows, layout: buildRowLayout(rows, new Map(), 64), contentWidth: width, remPx: 16 }
    return { entries, geometry, model: buildDropModel(entries), entryOf: (key) => entries.find((entry) => entry.key === key)! }
}

const moved = (s: Scene, ...keys: string[]): GridMoved => ({
    keys: new Set(keys),
    sources: keys.map((key) => s.entryOf(key).ref).filter((ref): ref is ItemRef => ref !== null),
})

const char = (id: string, occurrence = 0): ItemRef => ({ kind: 'char', id, occurrence })
const fol = (id: string, occurrence = 0): FolderRef => ({ kind: 'folder', id, occurrence })

function resolve(s: Scene, x: number, y: number, dragged: GridMoved, over: Partial<GridDropInput> = {}) {
    return resolveGridTarget({
        geometry: s.geometry,
        model: s.model,
        x,
        y,
        viewportY: y,
        viewportHeight: 10000,
        outside: false,
        moved: dragged,
        zoneKey: null,
        mergeArmed: false,
        isNoop: () => false,
        ...over,
    })
}

const ORDER8 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

describe('slotAt', () => {
    const s = scene(ORDER8)

    test('R-drop-1 the left half of a tile is before it, the right half after it', () => {
        expect(slotAt(s.geometry, 10, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'before' })
        expect(slotAt(s.geometry, 27, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'before' })
        expect(slotAt(s.geometry, 28, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'after' })
        expect(slotAt(s.geometry, 50, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'after' })
        expect(slotAt(s.geometry, 64 + 10, 10)).toEqual({ kind: 'gap', anchorKey: tile('b'), side: 'before' })
        expect(slotAt(s.geometry, 3 * 64 + 40, 64 + 10)).toEqual({ kind: 'gap', anchorKey: tile('h'), side: 'after' })
    })

    test('R-drop-1 the gap between two tiles belongs to the tile on its left; beyond the row end is the last tile\'s outer side', () => {
        expect(slotAt(s.geometry, 60, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'after' })
        expect(slotAt(s.geometry, 300, 10)).toEqual({ kind: 'gap', anchorKey: tile('d'), side: 'after' })
        expect(slotAt(s.geometry, -20, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'before' })
    })

    test('R-drop-1 the band of a row includes the gap below its tiles; above the content is the first row, below it the end slot', () => {
        expect(slotAt(s.geometry, 10, 60)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'before' })
        expect(slotAt(s.geometry, 10, 64)).toEqual({ kind: 'gap', anchorKey: tile('e'), side: 'before' })
        expect(slotAt(s.geometry, 10, 127)).toEqual({ kind: 'gap', anchorKey: tile('e'), side: 'before' })
        expect(slotAt(s.geometry, 10, -30)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'before' })
        expect(slotAt(s.geometry, 10, 128)).toEqual({ kind: 'end' })
        expect(slotAt(s.geometry, 10, 5000)).toEqual({ kind: 'end' })
    })

    test('R-drop-1 a partial last row is centred: the inset is half of the unused width', () => {
        const partial = scene(['a', 'b', 'c', 'd', 'e', 'f'])
        // Two tiles span 120 px in 248 px: they start at 64 and the pitch is 64.
        expect(slotAt(partial.geometry, 10, 70)).toEqual({ kind: 'gap', anchorKey: tile('e'), side: 'before' })
        expect(slotAt(partial.geometry, 64 + 10, 70)).toEqual({ kind: 'gap', anchorKey: tile('e'), side: 'before' })
        expect(slotAt(partial.geometry, 64 + 40, 70)).toEqual({ kind: 'gap', anchorKey: tile('e'), side: 'after' })
        expect(slotAt(partial.geometry, 128 + 10, 70)).toEqual({ kind: 'gap', anchorKey: tile('f'), side: 'before' })
        expect(slotAt(partial.geometry, 240, 70)).toEqual({ kind: 'gap', anchorKey: tile('f'), side: 'after' })
    })

    test('R-drop-1 an open folder is a section of its own rows between the flow before and after it', () => {
        const open = scene(['a', makeFolder('F', ['x', 'y']), 'b', 'c'], ['F'])
        // Rows: [a] (inset 96), [F x y] (inset 32, tiles at 32, 96 and 160), [b c] (inset 64).
        expect(slotAt(open.geometry, 10, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'before' })
        expect(slotAt(open.geometry, 150, 10)).toEqual({ kind: 'gap', anchorKey: tile('a'), side: 'after' })
        expect(slotAt(open.geometry, 40, 64 + 10)).toEqual({ kind: 'gap', anchorKey: folderTile('F'), side: 'before' })
        expect(slotAt(open.geometry, 74, 64 + 10)).toEqual({ kind: 'gap', anchorKey: folderTile('F'), side: 'after' })
        expect(slotAt(open.geometry, 100, 64 + 10)).toEqual({ kind: 'gap', anchorKey: tile('x'), side: 'before' })
        expect(slotAt(open.geometry, 256, 64 + 10)).toEqual({ kind: 'gap', anchorKey: tile('y'), side: 'after' })
        expect(slotAt(open.geometry, 10, 2 * 64 + 10)).toEqual({ kind: 'gap', anchorKey: tile('b'), side: 'before' })
    })

    test('no rows: no slot', () => {
        const none = scene([])
        expect(slotAt(none.geometry, 10, 10)).toBeNull()
    })
})

describe('gapOf', () => {
    const open = scene(['a', makeFolder('F', ['x', 'y']), 'b', makeFolder('C', ['p']), 'c'], ['F'], ['u'])

    test('R-drop-2 beside a top-level tile: before it is after the previous top-level entry, after it is after itself', () => {
        expect(gapOf({ kind: 'gap', anchorKey: tile('a'), side: 'before' }, open.model)).toEqual({ in: 'top', after: null })
        expect(gapOf({ kind: 'gap', anchorKey: tile('a'), side: 'after' }, open.model)).toEqual({ in: 'top', after: char('a') })
        expect(gapOf({ kind: 'gap', anchorKey: tile('b'), side: 'before' }, open.model)).toEqual({ in: 'top', after: fol('F') })
        expect(gapOf({ kind: 'gap', anchorKey: tile('c'), side: 'before' }, open.model)).toEqual({ in: 'top', after: fol('C') })
    })

    test('R-drop-2 a closed folder\'s tile is a top-level anchor on both sides', () => {
        expect(gapOf({ kind: 'gap', anchorKey: folderTile('C'), side: 'before' }, open.model)).toEqual({ in: 'top', after: char('b') })
        expect(gapOf({ kind: 'gap', anchorKey: folderTile('C'), side: 'after' }, open.model)).toEqual({ in: 'top', after: fol('C') })
    })

    test('R-drop-2 an open folder: before its tile is a top-level gap, after it is the gap before its first member', () => {
        expect(gapOf({ kind: 'gap', anchorKey: folderTile('F'), side: 'before' }, open.model)).toEqual({ in: 'top', after: char('a') })
        expect(gapOf({ kind: 'gap', anchorKey: folderTile('F'), side: 'after' }, open.model)).toEqual({ in: 'folder', folder: fol('F'), after: null })
    })

    test('R-drop-2 beside a member: a gap of its folder, before the first member the first-member gap, after the last member the end of the folder', () => {
        const member = (id: string) => ({ kind: 'member', folder: fol('F'), id, occurrence: 0 })
        expect(gapOf({ kind: 'gap', anchorKey: tile('x'), side: 'before' }, open.model)).toEqual({ in: 'folder', folder: fol('F'), after: null })
        expect(gapOf({ kind: 'gap', anchorKey: tile('x'), side: 'after' }, open.model)).toEqual({ in: 'folder', folder: fol('F'), after: member('x') })
        expect(gapOf({ kind: 'gap', anchorKey: tile('y'), side: 'before' }, open.model)).toEqual({ in: 'folder', folder: fol('F'), after: member('x') })
        expect(gapOf({ kind: 'gap', anchorKey: tile('y'), side: 'after' }, open.model)).toEqual({ in: 'folder', folder: fol('F'), after: member('y') })
    })

    test('R-drop-2 leaving a folder: the left of the next top-level tile, or below the last row', () => {
        expect(gapOf({ kind: 'gap', anchorKey: tile('b'), side: 'before' }, open.model)).toEqual({ in: 'top', after: fol('F') })
        expect(gapOf({ kind: 'end' }, open.model)).toEqual({ in: 'top', after: char('c') })
    })

    test('R-drop-2 a tile with no order entry, on either side, is the end of the top level; a gone anchor and zone slots have no gap', () => {
        expect(gapOf({ kind: 'gap', anchorKey: tile('u'), side: 'before' }, open.model)).toEqual({ in: 'top', after: char('c') })
        expect(gapOf({ kind: 'gap', anchorKey: tile('u'), side: 'after' }, open.model)).toEqual({ in: 'top', after: char('c') })
        expect(gapOf({ kind: 'gap', anchorKey: tile('gone'), side: 'after' }, open.model)).toBeNull()
        expect(gapOf({ kind: 'merge', tileKey: tile('a') }, open.model)).toBeNull()
        expect(gapOf({ kind: 'append', tileKey: folderTile('C') }, open.model)).toBeNull()
    })

    test('the end of the top level after an open folder\'s last member is still the folder', () => {
        const tail = scene(['a', makeFolder('F', ['x'])], ['F'])
        expect(gapOf({ kind: 'end' }, tail.model)).toEqual({ in: 'top', after: fol('F') })
    })

    test('R-drop-2 the right of a row\'s last tile and the left of the next row\'s first tile name one gap but have different slot keys', () => {
        const s = scene(ORDER8)
        const lastOfRow: GridSlot = { kind: 'gap', anchorKey: tile('d'), side: 'after' }
        const firstOfNext: GridSlot = { kind: 'gap', anchorKey: tile('e'), side: 'before' }
        expect(gapOf(lastOfRow, s.model)).toEqual(gapOf(firstOfNext, s.model))
        expect(slotKey(lastOfRow)).not.toBe(slotKey(firstOfNext))
        expect(new Set([slotKey({ kind: 'end' }), slotKey({ kind: 'merge', tileKey: 'k' }), slotKey({ kind: 'append', tileKey: 'k' }), slotKey(lastOfRow)]).size).toBe(4)
    })
})

describe('appendGap', () => {
    test('after the last string member, hidden ones included, counting its own occurrence', () => {
        const order = [makeFolder('F', ['x', 'y', 'x']), makeFolder('E', []), 'a']
        expect(appendGap(order, fol('F'))).toEqual({ in: 'folder', folder: fol('F'), after: { kind: 'member', folder: fol('F'), id: 'x', occurrence: 1 } })
        expect(appendGap(order, fol('E'))).toEqual({ in: 'folder', folder: fol('E'), after: null })
        expect(appendGap(order, fol('zz'))).toBeNull()
    })

    test('non-string members are not counted', () => {
        const order = [{ id: 'F', name: 'F', color: '', data: ['x', 7] } as unknown as folder]
        expect(appendGap(order as OrderEntry[], fol('F'))).toEqual({ in: 'folder', folder: fol('F'), after: { kind: 'member', folder: fol('F'), id: 'x', occurrence: 0 } })
    })
})

describe('zoneCandidateAt', () => {
    const s = scene(['a', 'b', 'c', makeFolder('C', ['p']), makeFolder('F', ['x', 'y']), 'd'], ['F'], ['u'])
    // Rows: [a b c C], [F x y] (inset 32), [d u] (inset 64). Tile centres: a (28, 28), b (92, 28), c (156, 28),
    // C (220, 28), F (60, 92), x (124, 92), y (188, 92), d (92, 156), u (156, 156).

    test('R-drop-5 the candidate is the middle half of the tile on both axes', () => {
        const none = moved(s)
        const key = tile('b')
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 28, 28, none)).toMatchObject({ key, closedFolder: false, ref: char('b') })
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 14, 28, none)?.key).toBe(key)
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 41, 28, none)?.key).toBe(key)
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 13, 28, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 42, 28, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 28, 13, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 28, 42, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 64 + 28, 60, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 60, 28, none)).toBeNull()
    })

    test('R-drop-5 a dragged folder alone can dwell-merge onto a character', () => {
        const folderMoved = moved(s, folderTile('C'))
        expect(zoneCandidateAt(s.geometry, s.model, 28, 28, folderMoved)?.key).toBe(tile('a'))
    })

    test('R-drop-4 a dragged tile, a dragged folder\'s tile, member tiles and tiles with no order entry are never candidates', () => {
        const dragged = moved(s, tile('a'), folderTile('C'), tile('x'))
        expect(zoneCandidateAt(s.geometry, s.model, 28, 28, dragged)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 220, 28, dragged)).toBeNull()
        const none = moved(s)
        expect(zoneCandidateAt(s.geometry, s.model, 28, 28, none)?.key).toBe(tile('a'))
        expect(zoneCandidateAt(s.geometry, s.model, 220, 28, none)?.key).toBe(folderTile('C'))
        expect(zoneCandidateAt(s.geometry, s.model, 124, 92, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 188, 92, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 156, 156, none)).toBeNull()
        expect(zoneCandidateAt(s.geometry, s.model, 92, 156, none)?.key).toBe(tile('d'))
    })

    test('R-drop-4 a folder tile is a candidate (an immediate append) unless every moved item is already its member', () => {
        const t = scene([makeFolder('T', ['p', 'q']), 'a'], ['T'])
        // Rows: [T p q] (inset 32), [a] (inset 96): the folder tile T is centred at (60, 28).
        const folderCentre = { x: 60, y: 28 }
        const mixed = moved(t, tile('a'), tile('p'))
        expect(zoneCandidateAt(t.geometry, t.model, folderCentre.x, folderCentre.y, mixed)).toMatchObject({ key: folderTile('T'), ref: fol('T'), closedFolder: false })
        const membersOnly = moved(t, tile('p'), tile('q'))
        expect(zoneCandidateAt(t.geometry, t.model, folderCentre.x, folderCentre.y, membersOnly)).toBeNull()
        expect(zoneCandidateAt(t.geometry, t.model, folderCentre.x, folderCentre.y, moved(t, tile('p')))).toBeNull()
        const other = scene([makeFolder('T', ['p']), makeFolder('T', ['q']), 'a'], ['T'])
        // Two folders sharing an id: a member of the second is not a member of the first. Rows: [T p], [T q], [a].
        const second = other.entryOf(tile('q'))
        expect(second.ref).toMatchObject({ kind: 'member', folder: { occurrence: 1 } })
        expect(zoneCandidateAt(other.geometry, other.model, 92, 28, moved(other, tile('q')))).toMatchObject({ ref: fol('T', 0) })
    })

    test('agrees with the press hit test: a candidate is always the tile `tileKeyAt` names at that point', () => {
        for (let y = -10; y < 220; y += 3) {
            for (let x = -10; x < 270; x += 3) {
                const candidate = zoneCandidateAt(s.geometry, s.model, x, y, moved(s))
                if (candidate) {
                    expect(tileKeyAt(s.geometry, x, y)).toBe(candidate.key)
                }
            }
        }
    })
})

describe('resolveGridTarget', () => {
    const s = scene(['a', 'b', 'c', 'd', makeFolder('F', ['x', 'y']), makeFolder('G', ['p', 'q'])], ['F', 'G'])
    // Rows: [a b c d], [F x y] (inset 32: F at 32, x at 96, y at 160), [G p q] (same insets).

    test('a gap target carries the gap, a key from the slot, no index and the caller\'s no-op verdict', () => {
        const seen: Array<{ gap: Gap; key: string }> = []
        const result = resolve(s, 64 + 10, 10, moved(s, tile('d')), {
            isNoop: (gap, key) => {
                seen.push({ gap, key })
                return true
            },
        })
        const slot: GridSlot = { kind: 'gap', anchorKey: tile('b'), side: 'before' }
        expect(result.slot).toEqual(slot)
        expect(result.target).toEqual({ kind: 'gap', gap: { in: 'top', after: char('a') }, key: slotKey(slot), index: -1, noop: true })
        expect(seen).toEqual([{ gap: { in: 'top', after: char('a') }, key: slotKey(slot) }])
        expect(resolve(s, 64 + 10, 10, moved(s, tile('d')), { isNoop: () => false }).target).toMatchObject({ noop: false })
    })

    test('R-drop-2 the target key follows the slot: two slots that name one gap report different keys, so the machine reports the move', () => {
        const dragged = moved(s, tile('b'))
        const rightOfD = resolve(s, 250, 10, dragged).target
        const leftOfF = resolve(s, 40, 64 + 10, dragged).target
        expect(rightOfD).toMatchObject({ kind: 'gap', gap: { in: 'top', after: char('d') } })
        expect(leftOfF).toMatchObject({ kind: 'gap', gap: { in: 'top', after: char('d') } })
        expect(rightOfD.kind === 'gap' && leftOfF.kind === 'gap' && rightOfD.key !== leftOfF.key).toBe(true)
    })

    test('R-drop-3 a pointer above the scroller or at/below its height has no target, one just inside has', () => {
        const dragged = moved(s, tile('d'))
        const x = 64 + 10
        expect(resolve(s, x, 10, dragged, { viewportY: -1, viewportHeight: 300 }).target).toBe(NO_TARGET)
        expect(resolve(s, x, 10, dragged, { viewportY: 0, viewportHeight: 300 }).target.kind).toBe('gap')
        expect(resolve(s, x, 10, dragged, { viewportY: 299, viewportHeight: 300 }).target.kind).toBe('gap')
        expect(resolve(s, x, 10, dragged, { viewportY: 300, viewportHeight: 300 }).target).toBe(NO_TARGET)
        expect(resolve(s, x, 10, dragged, { viewportY: 300, viewportHeight: 300 }).slot).toBeNull()
    })

    test('R-drop-3 a pointer outside the column has no target whatever the slot would be', () => {
        const dragged = moved(s, tile('d'))
        expect(resolve(s, 64 + 10, 10, dragged, { outside: true }).target).toBe(NO_TARGET)
        expect(resolve(s, 64 + 10, 10, dragged, { outside: false }).target.kind).toBe('gap')
        expect(resolve(s, 64 + 28, 28, dragged, { outside: true, zoneKey: tile('b'), mergeArmed: true }).target).toBe(NO_TARGET)
    })

    test('R-drop-2 a dragged folder dropped beside a member of another open folder targets that folder\'s gap', () => {
        const dragged = moved(s, folderTile('F'))
        const result = resolve(s, 100, 2 * 64 + 10, dragged)
        expect(result.target).toMatchObject({ kind: 'gap', gap: { in: 'folder', folder: fol('G'), after: null } })
        const afterP = resolve(s, 140, 2 * 64 + 10, dragged)
        expect(afterP.target).toMatchObject({ kind: 'gap', gap: { in: 'folder', folder: fol('G'), after: { kind: 'member', id: 'p' } } })
    })

    test('R-drop-2 inside a dragged open folder\'s own section there is no target, but the left half of its own tile is an ordinary gap', () => {
        const dragged = moved(s, folderTile('F'))
        const row = 64 + 10
        // Right half of F, both halves of x, the gap between x and y, and the end slot right of y.
        expect(resolve(s, 74, row, dragged).target).toBe(NO_TARGET)
        expect(resolve(s, 100, row, dragged).target).toBe(NO_TARGET)
        expect(resolve(s, 140, row, dragged).target).toBe(NO_TARGET)
        expect(resolve(s, 170, row, dragged).target).toBe(NO_TARGET)
        expect(resolve(s, 256, row, dragged).target).toBe(NO_TARGET)
        expect(resolve(s, 40, row, dragged).target).toMatchObject({ kind: 'gap', gap: { in: 'top', after: char('d') } })
    })

    test('R-drop-2 a dragged folder is excluded from its own section only, not from the section of a folder with the same id', () => {
        const twins = scene(['a', makeFolder('F', ['x']), makeFolder('F', ['y']), 'b'], ['F'])
        const dragged = moved(twins, folderTile('F', 0))
        // Rows: [a], [F#0 x] (own section), [F#1 y] (the twin's section: tiles at 64 and 128), [b].
        expect(resolve(twins, 100, 64 + 10, dragged).target).toBe(NO_TARGET)
        expect(resolve(twins, 140, 2 * 64 + 10, dragged).target).toMatchObject({ kind: 'gap', gap: { in: 'folder', folder: fol('F', 1), after: null } })
        expect(resolve(twins, 190, 2 * 64 + 10, dragged).target).toMatchObject({ kind: 'gap', gap: { in: 'folder', folder: fol('F', 1), after: { kind: 'member', id: 'y' } } })
    })

    test('R-drop-2 a member of the dragged folder moved on its own may still be dropped inside that folder', () => {
        const dragged = moved(s, tile('x'))
        expect(resolve(s, 256, 64 + 10, dragged).target).toMatchObject({ kind: 'gap', gap: { in: 'folder', folder: fol('F') } })
    })

    test('R-drop-5 an active zone gives a merge on a character only once armed, an append on a folder at once', () => {
        const dragged = moved(s, tile('a'))
        const onB = { zoneKey: tile('b') }
        expect(resolve(s, 64 + 28, 28, dragged, { ...onB, mergeArmed: false }).target.kind).toBe('gap')
        expect(resolve(s, 64 + 28, 28, dragged, { ...onB, mergeArmed: true }).target).toEqual({ kind: 'merge', ref: char('b'), key: tile('b') })
        expect(resolve(s, 64 + 28, 28, dragged, { ...onB, mergeArmed: true }).slot).toEqual({ kind: 'merge', tileKey: tile('b') })
        const onF = resolve(s, 60, 64 + 28, dragged, { zoneKey: folderTile('F'), mergeArmed: false })
        expect(onF.target).toEqual({ kind: 'append', ref: fol('F'), key: folderTile('F') })
        expect(onF.slot).toEqual({ kind: 'append', tileKey: folderTile('F') })
    })

    test('R-drop-5 a zone for another tile, or one the pointer has left, falls back to the gap', () => {
        const dragged = moved(s, tile('a'))
        expect(resolve(s, 64 + 28, 28, dragged, { zoneKey: tile('c'), mergeArmed: true }).target.kind).toBe('gap')
        expect(resolve(s, 64 + 5, 28, dragged, { zoneKey: tile('b'), mergeArmed: true }).target.kind).toBe('gap')
    })

    test('a zone on a dragged tile never merges, even if the machine still holds it', () => {
        const dragged = moved(s, tile('b'))
        expect(resolve(s, 64 + 28, 28, dragged, { zoneKey: tile('b'), mergeArmed: true }).target.kind).toBe('gap')
    })

    test('below the content the target is the end of the top level', () => {
        const result = resolve(s, 100, 3 * 64 + 20, moved(s, tile('a')))
        expect(result.slot).toEqual({ kind: 'end' })
        expect(result.target).toMatchObject({ kind: 'gap', gap: { in: 'top', after: fol('G') } })
    })
})
