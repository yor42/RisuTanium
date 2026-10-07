import { describe, expect, test } from 'vitest'
import isEqual from 'lodash/isEqual'
import type { folder } from '../../ts/storage/database.svelte'
import { buildItems, type LayoutItem, type RailEntry } from './railLayout'
import { classifyKey, describePosition, focusStep, keyboardMove, railRows, resolveCurrent, type KeyboardMove, type MoveDirection } from './railKeyboard'
import { listRows, refKey, type ItemRef, type OrderEntry } from './sidebarOrder'

/**
 * Acceptance tests for the rail's keyboard decisions: key classification, focus stepping,
 * the current entry and the one-place move.
 */

const folderOf = (id: string, data: string[]): folder => ({ id, name: `Name ${id}`, color: '', data })

interface Fixture {
    order: OrderEntry[]
    items: LayoutItem[]
}

/** Items the way the rail builds them: unknown ids have no row, `open` folders show their members. */
function fixture(order: OrderEntry[], open: readonly string[] = [], unknown: readonly string[] = []): Fixture {
    const known = (id: string) => !unknown.includes(id)
    const entries: RailEntry[] = listRows(order, known).map((row) =>
        row.kind === 'char'
            ? { ref: row.ref, key: row.key, open: false, members: [] }
            : { ref: row.ref, key: row.key, open: open.includes(row.id), members: row.members.map((m) => ({ ref: m.ref, key: m.key })) },
    )
    return { order, items: buildItems(entries) }
}

const ch = (id: string, occurrence = 0): ItemRef => ({ kind: 'char', id, occurrence })
const fo = (id: string, occurrence = 0): ItemRef => ({ kind: 'folder', id, occurrence })
const me = (folderId: string, id: string, occurrence = 0): ItemRef => ({ kind: 'member', folder: { kind: 'folder', id: folderId, occurrence: 0 }, id, occurrence })

const show = (order: readonly OrderEntry[]): string[] => order.map((e) => (typeof e === 'string' ? e : e === null ? 'null' : `${e.id}[${e.data.join(',')}]`))

function run(f: Fixture, source: ItemRef, dir: MoveDirection): KeyboardMove | null {
    return keyboardMove(f.order, f.items, source, dir)
}

function moved(result: KeyboardMove | null): { order: string[]; ref: string } {
    expect(result?.kind).toBe('move')
    if (result?.kind !== 'move') {
        throw new Error('not a move')
    }
    return { order: show(result.order), ref: refKey(result.ref) }
}

describe('classifyKey', () => {
    const key = (k: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
        classifyKey({ key: k, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...mods })

    test('plain arrows, Home and End move focus; Enter activates', () => {
        expect(key('ArrowDown')).toEqual({ kind: 'focus', key: 'ArrowDown' })
        expect(key('ArrowUp')).toEqual({ kind: 'focus', key: 'ArrowUp' })
        expect(key('Home')).toEqual({ kind: 'focus', key: 'Home' })
        expect(key('End')).toEqual({ kind: 'focus', key: 'End' })
        expect(key('Enter')).toEqual({ kind: 'activate' })
    })

    test('a bare Alt+Arrow moves; Ctrl, Shift or Meta with Alt is not handled', () => {
        expect(key('ArrowDown', { altKey: true })).toEqual({ kind: 'move', dir: 'down' })
        expect(key('ArrowUp', { altKey: true })).toEqual({ kind: 'move', dir: 'up' })
        for (const mod of ['ctrlKey', 'shiftKey', 'metaKey'] as const) {
            expect(key('ArrowDown', { altKey: true, [mod]: true })).toBeNull()
            expect(key('ArrowUp', { altKey: true, [mod]: true })).toBeNull()
        }
    })

    test('a modified plain arrow, an unrelated key and a modified Enter are not handled', () => {
        expect(key('ArrowDown', { ctrlKey: true })).toBeNull()
        expect(key('Home', { shiftKey: true })).toBeNull()
        expect(key('ArrowLeft')).toBeNull()
        expect(key('a')).toBeNull()
        expect(key('Enter', { altKey: true })).toBeNull()
    })
})

describe('focusStep', () => {
    const keys = ['a', 'b', 'c']
    test('arrows step by one, Home and End jump, ends stay', () => {
        expect(focusStep(keys, 'a', 'ArrowDown')).toBe('b')
        expect(focusStep(keys, 'b', 'ArrowUp')).toBe('a')
        expect(focusStep(keys, 'b', 'Home')).toBe('a')
        expect(focusStep(keys, 'b', 'End')).toBe('c')
        expect(focusStep(keys, 'c', 'ArrowDown')).toBeNull()
        expect(focusStep(keys, 'a', 'ArrowUp')).toBeNull()
        expect(focusStep(keys, 'a', 'Home')).toBeNull()
        expect(focusStep(keys, 'c', 'End')).toBeNull()
        expect(focusStep([], null, 'End')).toBeNull()
    })
})

describe('resolveCurrent', () => {
    const rows = [{ key: 'a' }, { key: 'f' }, { key: 'm', owner: 'f' }, { key: 'z' }]

    test('without a remembered entry: the selected row, else the first', () => {
        expect(resolveCurrent(rows, null, 'm')).toEqual({ key: 'm', index: 2, owner: 'f' })
        expect(resolveCurrent(rows, null, 'gone')).toEqual({ key: 'a', index: 0, owner: null })
        expect(resolveCurrent(rows, null, null)).toEqual({ key: 'a', index: 0, owner: null })
        expect(resolveCurrent([], null, null)).toBeNull()
    })

    test('a remembered entry that is still shown stays, with its new index', () => {
        expect(resolveCurrent(rows, { key: 'z', index: 0, owner: null }, 'a')).toEqual({ key: 'z', index: 3, owner: null })
    })

    test('a member whose folder closed gives way to the folder row', () => {
        const closed = [{ key: 'a' }, { key: 'f' }, { key: 'z' }]
        expect(resolveCurrent(closed, { key: 'm', index: 2, owner: 'f' }, null)).toEqual({ key: 'f', index: 1, owner: null })
    })

    test('a deleted entry gives way to the row at its index, else the last row', () => {
        expect(resolveCurrent([{ key: 'a' }, { key: 'z' }], { key: 'f', index: 1, owner: null }, null)).toEqual({ key: 'z', index: 1, owner: null })
        expect(resolveCurrent([{ key: 'a' }, { key: 'b' }], { key: 'z', index: 3, owner: null }, null)).toEqual({ key: 'b', index: 1, owner: null })
    })
})

describe('railRows', () => {
    test('lists character, folder and member rows in visual order with their owner', () => {
        const f = fixture(['A', folderOf('F', ['X', 'Y']), 'B'], ['F'])
        expect(railRows(f.items).map((row) => [row.key === refKey(ch('A')) ? 'A' : row.key === refKey(fo('F')) ? 'F' : row.owner ? 'member' : 'B', row.owner ?? null])).toEqual([
            ['A', null],
            ['F', null],
            ['member', refKey(fo('F'))],
            ['member', refKey(fo('F'))],
            ['B', null],
        ])
    })
})

describe('keyboardMove', () => {
    test('moves a top-level character one place down and up', () => {
        const f = fixture(['A', 'B', 'C'])
        expect(moved(run(f, ch('B'), 'down'))).toEqual({ order: ['A', 'C', 'B'], ref: refKey(ch('B')) })
        expect(moved(run(f, ch('B'), 'up'))).toEqual({ order: ['B', 'A', 'C'], ref: refKey(ch('B')) })
    })

    test('a character enters an open folder at its first slot going down and its last slot going up', () => {
        const down = fixture(['A', folderOf('F', ['X', 'Y']), 'B'], ['F'])
        expect(moved(run(down, ch('A'), 'down'))).toEqual({ order: ['F[A,X,Y]', 'B'], ref: refKey(me('F', 'A')) })
        const up = fixture([folderOf('F', ['X', 'Y']), 'A'], ['F'])
        expect(moved(run(up, ch('A'), 'up'))).toEqual({ order: ['F[X,Y,A]'], ref: refKey(me('F', 'A')) })
    })

    test('the last member leaves a folder of two downwards and the first leaves upwards', () => {
        const f = fixture([folderOf('F', ['X', 'Y']), 'B'], ['F'])
        expect(moved(run(f, me('F', 'Y'), 'down'))).toEqual({ order: ['F[X]', 'Y', 'B'], ref: refKey(ch('Y')) })
        expect(moved(run(f, me('F', 'X'), 'up'))).toEqual({ order: ['X', 'F[Y]', 'B'], ref: refKey(ch('X')) })
    })

    test('a member moves inside its folder by one place', () => {
        const f = fixture([folderOf('F', ['X', 'Y', 'Z'])], ['F'])
        expect(moved(run(f, me('F', 'X'), 'down'))).toEqual({ order: ['F[Y,X,Z]'], ref: refKey(me('F', 'X')) })
        expect(moved(run(f, me('F', 'Z'), 'up'))).toEqual({ order: ['F[X,Z,Y]'], ref: refKey(me('F', 'Z')) })
    })

    test('a closed folder is passed as one entry', () => {
        const f = fixture(['A', folderOf('F', ['X', 'Y']), 'B'])
        expect(moved(run(f, ch('A'), 'down'))).toEqual({ order: ['F[X,Y]', 'A', 'B'], ref: refKey(ch('A')) })
        expect(moved(run(f, ch('B'), 'up'))).toEqual({ order: ['A', 'B', 'F[X,Y]'], ref: refKey(ch('B')) })
    })

    test('a folder passes an open folder as one entry', () => {
        const f = fixture([folderOf('F1', ['a']), folderOf('F2', ['b', 'c']), 'D'], ['F1', 'F2'])
        expect(moved(run(f, fo('F1'), 'down'))).toEqual({ order: ['F2[b,c]', 'F1[a]', 'D'], ref: refKey(fo('F1')) })
        expect(moved(run(f, fo('F2'), 'up'))).toEqual({ order: ['F2[b,c]', 'F1[a]', 'D'], ref: refKey(fo('F2')) })
    })

    test('a folder never enters another folder', () => {
        const f = fixture([folderOf('F1', ['a']), folderOf('F2', ['b', 'c'])], ['F1', 'F2'])
        const result = moved(run(f, fo('F1'), 'down'))
        expect(result.order).toEqual(['F2[b,c]', 'F1[a]'])
    })

    test('the first entry has no place up and the last none down', () => {
        const f = fixture(['A', 'B'])
        expect(run(f, ch('A'), 'up')).toBeNull()
        expect(run(f, ch('B'), 'down')).toBeNull()
        const g = fixture([folderOf('F', ['X', 'Y'])], ['F'])
        expect(run(g, fo('F'), 'up')).toBeNull()
        expect(run(g, fo('F'), 'down')).toBeNull()
    })

    test('the only member of a folder is refused in both directions', () => {
        const f = fixture([folderOf('F', ['X']), 'A'], ['F'])
        expect(run(f, me('F', 'X'), 'down')).toEqual({ kind: 'refuse-sole', folder: { kind: 'folder', id: 'F', occurrence: 0 } })
        expect(run(f, me('F', 'X'), 'up')).toEqual({ kind: 'refuse-sole', folder: { kind: 'folder', id: 'F', occurrence: 0 } })
    })

    test('a folder with one shown member and one hidden id is moved, not refused', () => {
        const f = fixture([folderOf('F', ['X', 'U']), 'A'], ['F'], ['U'])
        const result = moved(run(f, me('F', 'X'), 'down'))
        expect(result.order).toEqual(['F[U]', 'X', 'A'])
        expect(result.ref).toBe(refKey(ch('X')))
    })

    test('the moved ref names the entry that moved when an identical id sits behind a hidden id', () => {
        const f = fixture(['A', 'U', 'A', 'B'], [], ['U'])
        const result = moved(run(f, ch('A', 0), 'down'))
        expect(result.order).toEqual(['U', 'A', 'A', 'B'])
        expect(result.ref).toBe(refKey(ch('A', 1)))
    })

    describe('identical duplicates', () => {
        test('[A, A, B]: A#0 down focuses A#1 without a write, then moves past B', () => {
            const f = fixture(['A', 'A', 'B'])
            expect(run(f, ch('A', 0), 'down')).toEqual({ kind: 'focus', ref: ch('A', 1) })
            expect(moved(run(f, ch('A', 1), 'down'))).toEqual({ order: ['A', 'B', 'A'], ref: refKey(ch('A', 1)) })
        })

        test('[B, A, A]: A#1 up focuses A#0 without a write, then moves past B', () => {
            const f = fixture(['B', 'A', 'A'])
            expect(run(f, ch('A', 1), 'up')).toEqual({ kind: 'focus', ref: ch('A', 0) })
            expect(moved(run(f, ch('A', 0), 'up'))).toEqual({ order: ['A', 'B', 'A'], ref: refKey(ch('A', 0)) })
        })

        test('[A, A]: A#0 down focuses A#1, which then has no place down', () => {
            const f = fixture(['A', 'A'])
            expect(run(f, ch('A', 0), 'down')).toEqual({ kind: 'focus', ref: ch('A', 1) })
            expect(run(f, ch('A', 1), 'down')).toBeNull()
        })
    })

    test('identical duplicate open folders: focus goes to the neighbouring folder row, not its member', () => {
        const f = fixture([folderOf('F', ['c']), folderOf('F', ['c']), 'b'], ['F'])
        expect(run(f, fo('F', 0), 'down')).toEqual({ kind: 'focus', ref: fo('F', 1) })
        expect(run(f, fo('F', 1), 'up')).toEqual({ kind: 'focus', ref: fo('F', 0) })
    })

    test('an unknown source gives nothing', () => {
        const f = fixture(['A', 'B'])
        expect(run(f, ch('Q'), 'down')).toBeNull()
    })
})

describe('describePosition', () => {
    test('counts the shown rows of the level: top level, or inside a folder with its name', () => {
        const f = fixture(['U', 'A', folderOf('F', ['U', 'X', 'Y']), 'B'], ['F'], ['U'])
        expect(describePosition(f.order, f.items, ch('B'))).toEqual({ position: 3, total: 3 })
        expect(describePosition(f.order, f.items, fo('F'))).toEqual({ position: 2, total: 3 })
        expect(describePosition(f.order, f.items, me('F', 'Y'))).toEqual({ position: 2, total: 2, folderName: 'Name F' })
        expect(describePosition(f.order, f.items, ch('Q'))).toBeNull()
    })
})

describe('keyboardMove property', () => {
    function rng(seed: number): () => number {
        let state = seed >>> 0
        return () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0
            return state / 0x100000000
        }
    }

    interface Slot {
        id: string
        parent: string | null
    }

    /** Shown rows in visual order; members only for open folders. */
    function visual(order: readonly OrderEntry[], open: ReadonlySet<string>): Slot[] {
        const slots: Slot[] = []
        for (const entry of order) {
            if (typeof entry === 'string') {
                slots.push({ id: entry, parent: null })
            }
            else if (entry && Array.isArray(entry.data)) {
                slots.push({ id: entry.id, parent: null })
                if (open.has(entry.id)) {
                    for (const member of entry.data) {
                        slots.push({ id: member, parent: entry.id })
                    }
                }
            }
        }
        return slots
    }

    const topLevel = (order: readonly OrderEntry[]): string[] => order.map((e) => (typeof e === 'string' ? e : (e as folder).id))

    function generate(next: () => number): { order: OrderEntry[]; open: Set<string> } {
        const chars = Array.from({ length: 2 + Math.floor(next() * 6) }, (_, i) => `c${i}`)
        const top: OrderEntry[] = []
        const open = new Set<string>()
        let folderIndex = 0
        while (chars.length > 0) {
            if (next() < 0.35 && folderIndex < 3) {
                const size = Math.min(chars.length, Math.floor(next() * 4))
                const id = `F${folderIndex++}`
                top.push(folderOf(id, chars.splice(0, size)))
                if (next() < 0.7) {
                    open.add(id)
                }
            }
            else {
                top.push(chars.shift()!)
            }
        }
        for (let i = top.length - 1; i > 0; i--) {
            const j = Math.floor(next() * (i + 1))
            ;[top[i], top[j]] = [top[j], top[i]]
        }
        return { order: top, open }
    }

    test('every move changes the order by one visible place and the opposite key restores it', () => {
        const next = rng(12345)
        let moves = 0
        let refusals = 0
        for (let sample = 0; sample < 400; sample++) {
            const { order, open } = generate(next)
            const f = fixture(order, [...open])
            for (const row of listRows(order, () => true)) {
                const sources: ItemRef[] = [row.ref, ...(row.kind === 'folder' && open.has(row.id) ? row.members.map((m) => m.ref) : [])]
                for (const source of sources) {
                    for (const dir of ['up', 'down'] as const) {
                        const result = run(f, source, dir)
                        if (!result) {
                            continue
                        }
                        if (result.kind === 'focus') {
                            throw new Error('unexpected focus result')
                        }
                        if (result.kind === 'refuse-sole') {
                            refusals++
                            continue
                        }
                        moves++
                        expect(isEqual(result.order, order)).toBe(false)
                        const sign = dir === 'down' ? 1 : -1
                        const before = visual(order, open)
                        const after = visual(result.order, open)
                        if (source.kind === 'folder') {
                            const a = topLevel(order)
                            const b = topLevel(result.order)
                            expect(b.indexOf(source.id) - a.indexOf(source.id)).toBe(sign)
                            expect(b.filter((id) => id !== source.id)).toEqual(a.filter((id) => id !== source.id))
                        }
                        else {
                            const from = before.findIndex((slot) => slot.id === source.id)
                            const to = after.findIndex((slot) => slot.id === source.id)
                            expect(after.filter((slot) => slot.id !== source.id)).toEqual(before.filter((slot) => slot.id !== source.id))
                            expect([0, sign]).toContain(to - from)
                            if (to === from) {
                                expect(after[to].parent).not.toBe(before[from].parent)
                            }
                        }
                        const back = keyboardMove(result.order, fixture(result.order, [...open]).items, result.ref, dir === 'down' ? 'up' : 'down')
                        if (back?.kind === 'refuse-sole') {
                            continue
                        }
                        expect(back?.kind).toBe('move')
                        if (back?.kind === 'move') {
                            expect(isEqual(back.order, order)).toBe(true)
                        }
                    }
                }
            }
        }
        expect(moves).toBeGreaterThan(200)
        expect(refusals).toBeGreaterThan(0)
    })
})
