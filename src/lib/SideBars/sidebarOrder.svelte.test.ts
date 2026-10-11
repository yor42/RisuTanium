import { describe, test, expect } from 'vitest'
import fc from 'fast-check'
import type { folder } from 'src/ts/storage/database.svelte'
import {
    dropOnItem,
    editFolder,
    folderMemberIds,
    groupIntoFolder,
    isShownFolder,
    listRows,
    moveToGap,
    refKey,
    type CharRef,
    type FolderRef,
    type Gap,
    type ItemRef,
    type MemberRef,
    type OrderEntry,
    type TopRow,
    ungroupFolder,
} from './sidebarOrder'

/**
 * The pure order operations of the character sidebar. The plain-array tests and the random-order
 * properties over plain arrays freeze their inputs (the $state proxy tests, the proxy property
 * test, the listRows tests and the second move of the return-to-origin test do not), so those
 * fail if an operation mutates what it was given. Tests whose title starts with `guard:` pin
 * the results every sidebar operation must keep; the others state rules of the model itself.
 */

function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null) {
        for (const inner of Object.values(value)) {
            deepFreeze(inner)
        }
        Object.freeze(value)
    }
    return value
}

const f = (id: string, data: string[], extra: Partial<folder> = {}): folder => ({ id, name: `n-${id}`, color: '', data, ...extra })

const char = (id: string, occurrence = 0): CharRef => ({ kind: 'char', id, occurrence })
const fol = (id: string, occurrence = 0): FolderRef => ({ kind: 'folder', id, occurrence })
const mem = (folderRef: FolderRef, id: string, occurrence = 0): MemberRef => ({ kind: 'member', folder: folderRef, id, occurrence })
const topGap = (after: CharRef | FolderRef | null): Gap => ({ in: 'top', after })
const folderGap = (folderRef: FolderRef, after: MemberRef | null): Gap => ({ in: 'folder', folder: folderRef, after })

const NEW = { id: 'new-id', name: 'New Folder' }

function show(order: readonly OrderEntry[]): string[] {
    return order.map((e) => (e === null ? 'null' : typeof e === 'string' ? e : `${e.id}[${(e.data ?? []).join(',')}]`))
}

const move = (order: OrderEntry[], source: ItemRef, gap: Gap): string[] => show(moveToGap(deepFreeze(order), source, gap))
const drop = (order: OrderEntry[], source: ItemRef, target: ItemRef): string[] => show(dropOnItem(deepFreeze(order), source, target, NEW))

describe('moveToGap', () => {
    test('guard: reorders through a top gap, to the start and to the end', () => {
        expect(move(['A', 'B', 'C'], char('C'), topGap(char('A')))).toEqual(['A', 'C', 'B'])
        expect(move(['A', 'B', 'C'], char('C'), topGap(null))).toEqual(['C', 'A', 'B'])
        expect(move(['A', 'B', 'C'], char('A'), topGap(char('C')))).toEqual(['B', 'C', 'A'])
    })

    test('guard: a folder moves whole through a top gap', () => {
        expect(move(['A', f('f1', ['B', 'C']), 'D'], fol('f1'), topGap(char('D')))).toEqual(['A', 'D', 'f1[B,C]'])
        expect(move(['A', f('f1', ['B', 'C']), 'D'], fol('f1'), topGap(null))).toEqual(['f1[B,C]', 'A', 'D'])
    })

    test('guard: a character enters a folder at a position, and members reorder inside it', () => {
        const order = ['A', f('f1', ['B', 'C'])]
        expect(move(order, char('A'), folderGap(fol('f1'), mem(fol('f1'), 'B')))).toEqual(['f1[B,A,C]'])
        expect(move(order, char('A'), folderGap(fol('f1'), null))).toEqual(['f1[A,B,C]'])
        expect(move([f('f1', ['B', 'C', 'D'])], mem(fol('f1'), 'D'), folderGap(fol('f1'), null))).toEqual(['f1[D,B,C]'])
        expect(move([f('f1', ['B', 'C', 'D'])], mem(fol('f1'), 'B'), folderGap(fol('f1'), mem(fol('f1'), 'D')))).toEqual(['f1[C,D,B]'])
    })

    test('guard: a member moves to a top gap, to another folder, and an emptied folder is removed', () => {
        expect(move(['A', f('f1', ['B', 'C']), 'D'], mem(fol('f1'), 'C'), topGap(char('D')))).toEqual(['A', 'f1[B]', 'D', 'C'])
        expect(move([f('f1', ['A', 'B']), f('f2', ['C'])], mem(fol('f1'), 'A'), folderGap(fol('f2'), mem(fol('f2'), 'C')))).toEqual(['f1[B]', 'f2[C,A]'])
        expect(move(['A', f('f1', ['B'])], mem(fol('f1'), 'B'), topGap(null))).toEqual(['B', 'A'])
        expect(move([f('f1', ['A']), f('f2', ['B'])], mem(fol('f1'), 'A'), folderGap(fol('f2'), null))).toEqual(['f2[A,B]'])
    })

    test('guard: a folder is not moved into a folder', () => {
        const order = [f('f1', ['A']), f('f2', ['B'])]
        expect(moveToGap(deepFreeze(order), fol('f1'), folderGap(fol('f2'), null))).toBe(order)
    })

    test('a drop into the item own gap returns the same array', () => {
        const order = deepFreeze(['A', 'B', f('f1', ['C', 'D'])])
        expect(moveToGap(order, char('B'), topGap(char('A')))).toBe(order)
        expect(moveToGap(order, char('B'), topGap(char('B')))).toBe(order)
        expect(moveToGap(order, fol('f1'), topGap(char('B')))).toBe(order)
        expect(moveToGap(order, fol('f1'), topGap(fol('f1')))).toBe(order)
        expect(moveToGap(order, mem(fol('f1'), 'C'), folderGap(fol('f1'), null))).toBe(order)
        expect(moveToGap(order, mem(fol('f1'), 'C'), folderGap(fol('f1'), mem(fol('f1'), 'C')))).toBe(order)
    })

    test('an unknown source or target returns the same array', () => {
        const order = deepFreeze(['A', 'B', f('f1', ['C'])])
        expect(moveToGap(order, char('Z'), topGap(null))).toBe(order)
        expect(moveToGap(order, char('A', 1), topGap(null))).toBe(order)
        expect(moveToGap(order, char('A'), topGap(char('Z')))).toBe(order)
        expect(moveToGap(order, char('A'), folderGap(fol('nope'), null))).toBe(order)
        expect(moveToGap(order, mem(fol('nope'), 'C'), topGap(null))).toBe(order)
        expect(moveToGap(order, mem(fol('f1'), 'Z'), topGap(null))).toBe(order)
        expect(moveToGap(order, char('A'), folderGap(fol('f1'), mem(fol('f1'), 'Z')))).toBe(order)
    })

    test('an unknown id in the order does not change where a drop lands', () => {
        expect(move(['stale', 'A', 'B', 'C'], char('C'), topGap(char('A')))).toEqual(['stale', 'A', 'C', 'B'])
        expect(move([f('f1', ['stale', 'A', 'B', 'C'])], mem(fol('f1'), 'C'), folderGap(fol('f1'), mem(fol('f1'), 'A')))).toEqual(['f1[stale,A,C,B]'])
    })

    test('a duplicate entry moves the occurrence that was dragged', () => {
        expect(move(['A', 'B', 'A', 'C'], char('A', 1), topGap(char('C')))).toEqual(['A', 'B', 'C', 'A'])
        expect(move(['A', 'B', 'A', 'C'], char('A', 0), topGap(char('C')))).toEqual(['B', 'A', 'C', 'A'])
        expect(move(['A', 'B', 'A', 'C'], char('B'), topGap(char('A', 1)))).toEqual(['A', 'A', 'B', 'C'])
        expect(move([f('f1', ['A', 'B', 'A'])], mem(fol('f1'), 'A', 1), folderGap(fol('f1'), null))).toEqual(['f1[A,A,B]'])
    })

    test('two folders with the same id are told apart by occurrence', () => {
        const order = [f('x', ['A']), f('x', ['B']), 'C']
        expect(move(order, char('C'), folderGap(fol('x', 1), null))).toEqual(['x[A]', 'x[C,B]'])
        expect(move(order, char('C'), folderGap(fol('x', 0), null))).toEqual(['x[C,A]', 'x[B]'])
        expect(move(order, fol('x', 1), topGap(null))).toEqual(['x[B]', 'x[A]', 'C'])
    })

    test('return to origin: moving an item away and back restores the order', () => {
        const start: OrderEntry[] = ['A', 'B', 'C', 'D']
        const away = moveToGap(deepFreeze(start), char('A'), topGap(char('C')))
        expect(show(away)).toEqual(['B', 'C', 'A', 'D'])
        expect(show(moveToGap(away, char('A'), topGap(null)))).toEqual(['A', 'B', 'C', 'D'])
        const grouped: OrderEntry[] = [f('f1', ['B', 'C']), 'A']
        const out = moveToGap(deepFreeze(grouped), mem(fol('f1'), 'B'), topGap(char('A')))
        expect(show(out)).toEqual(['f1[C]', 'A', 'B'])
        expect(show(moveToGap(out, char('B'), folderGap(fol('f1'), null)))).toEqual(['f1[B,C]', 'A'])
    })

    test('a null entry and a folder without data keep their place relative to their neighbours', () => {
        const noData = { id: 'nd', name: 'x', color: '' } as unknown as folder
        const order: OrderEntry[] = [null, 'A', noData, 'B', 'C']
        const result = moveToGap(deepFreeze(order), char('C'), topGap(char('A')))
        expect(result).toEqual([null, 'A', 'C', noData, 'B'])
        expect(result[0]).toBeNull()
        expect(result[3]).toBe(noData)
    })

    test('an unchanged input is not mutated and unchanged folders are shared', () => {
        const untouched = f('f9', ['Z'])
        const order = deepFreeze(['A', 'B', untouched])
        const result = moveToGap(order, char('B'), topGap(null))
        expect(result[2]).toBe(untouched)
    })
})

describe('dropOnItem', () => {
    test('guard: a character on a character makes a new folder at the target place with the dragged one first', () => {
        const result = dropOnItem(deepFreeze(['A', 'B', 'C']), char('C'), char('A'), NEW)
        expect(show(result)).toEqual(['new-id[C,A]', 'B'])
        expect(result[0]).toEqual({ name: 'New Folder', data: ['C', 'A'], color: '', id: 'new-id' })
        expect(show(dropOnItem(deepFreeze(['A', 'B', 'C']), char('A'), char('C'), NEW))).toEqual(['B', 'new-id[A,C]'])
    })

    test('guard: a character on a folder is appended to it', () => {
        expect(drop(['A', f('f1', ['B', 'C'])], char('A'), fol('f1'))).toEqual(['f1[B,C,A]'])
        expect(drop([f('f1', ['B', 'C']), 'A'], char('A'), fol('f1'))).toEqual(['f1[B,C,A]'])
    })

    test('guard: a member on a character makes a new folder from the two; an emptied folder is removed', () => {
        expect(drop(['A', f('f1', ['B', 'C']), 'D'], mem(fol('f1'), 'B'), char('D'))).toEqual(['A', 'f1[C]', 'new-id[B,D]'])
        expect(drop([f('f1', ['B']), 'D'], mem(fol('f1'), 'B'), char('D'))).toEqual(['new-id[B,D]'])
    })

    test('guard: a member on another folder is appended; on its own folder it moves to the end', () => {
        expect(drop([f('f1', ['A', 'B']), f('f2', ['C'])], mem(fol('f1'), 'A'), fol('f2'))).toEqual(['f1[B]', 'f2[C,A]'])
        expect(drop([f('f1', ['A', 'B'])], mem(fol('f1'), 'A'), fol('f1'))).toEqual(['f1[B,A]'])
        expect(drop([f('f1', ['A'])], mem(fol('f1'), 'A'), fol('f1'))).toEqual(['f1[A]'])
    })

    test('guard: ignored drops return the same array', () => {
        const order = deepFreeze(['A', 'B', f('f1', ['C', 'D']), f('f2', ['E'])])
        expect(dropOnItem(order, fol('f1'), char('A'), NEW)).toBe(order)
        expect(dropOnItem(order, fol('f1'), fol('f2'), NEW)).toBe(order)
        expect(dropOnItem(order, char('A'), mem(fol('f1'), 'C'), NEW)).toBe(order)
        expect(dropOnItem(order, mem(fol('f1'), 'C'), mem(fol('f1'), 'D'), NEW)).toBe(order)
        expect(dropOnItem(order, char('A'), char('A'), NEW)).toBe(order)
        expect(dropOnItem(order, char('Z'), char('A'), NEW)).toBe(order)
        expect(dropOnItem(order, char('A'), char('Z'), NEW)).toBe(order)
        expect(dropOnItem(order, char('A'), fol('nope'), NEW)).toBe(order)
    })

    test('an unknown id in the order or in a folder does not change which entry is used', () => {
        expect(drop(['stale', 'A', 'B'], char('B'), char('A'))).toEqual(['stale', 'new-id[B,A]'])
        expect(drop([f('f1', ['stale', 'A', 'B'])], mem(fol('f1'), 'B'), fol('f1'))).toEqual(['f1[stale,A,B]'])
        expect(drop([f('f1', ['stale', 'A', 'B']), 'C'], mem(fol('f1'), 'B'), char('C'))).toEqual(['f1[stale,A]', 'new-id[B,C]'])
    })

    test('duplicate entries: the dragged occurrence and the target occurrence are used', () => {
        expect(drop(['A', 'B', 'A'], char('A', 1), char('B'))).toEqual(['A', 'new-id[A,B]'])
        expect(drop(['A', 'B', 'A'], char('B'), char('A', 1))).toEqual(['A', 'new-id[B,A]'])
        expect(drop([f('x', ['A']), f('x', ['B']), 'C'], char('C'), fol('x', 1))).toEqual(['x[A]', 'x[B,C]'])
    })

    test('a null entry is carried through', () => {
        expect(drop([null, 'A', 'B'], char('B'), char('A'))).toEqual(['null', 'new-id[B,A]'])
    })
})

describe('editFolder', () => {
    test('edits a copy of the folder that has the id and leaves the input alone', () => {
        const order = deepFreeze(['A', f('f1', ['B'], { imgFile: 'i.png' }), f('f2', ['C'])])
        const result = editFolder(order, 'f2', (copy) => {
            copy.name = 'renamed'
        })
        expect(result).not.toBeNull()
        expect(result![2]).toEqual({ id: 'f2', name: 'renamed', color: '', data: ['C'] })
        expect(result![1]).toBe(order[1])
    })

    test('returns null when no folder or more than one folder has the id', () => {
        const order = deepFreeze(['A', f('x', ['B']), f('x', ['C']), f('y', ['D'])])
        expect(editFolder(order, 'x', () => {})).toBeNull()
        expect(editFolder(order, 'missing', () => {})).toBeNull()
        expect(editFolder(order, 'A', () => {})).toBeNull()
        expect(editFolder(order, 'y', () => {})).not.toBeNull()
    })

    test('a folder without data is not a folder that can be edited', () => {
        const noData = { id: 'nd', name: 'x', color: '' } as unknown as folder
        expect(editFolder(deepFreeze([null, noData]), 'nd', () => {})).toBeNull()
    })
})

describe('listRows and refKey', () => {
    const known = (id: string): boolean => id !== 'stale'

    test('one row per known occurrence, with occurrence numbers counted over every entry', () => {
        const rows = listRows(['stale', 'A', 'stale', 'A', f('f1', ['B', 'stale', 'B'])], known)
        expect(rows.map((r) => (r.kind === 'folder' ? `F:${r.id}` : `${r.id}#${r.ref.occurrence}`))).toEqual(['A#0', 'A#1', 'F:f1'])
        const folderRow = rows[2]
        expect(folderRow.kind === 'folder' && folderRow.members.map((m) => `${m.id}#${m.ref.occurrence}`)).toEqual(['B#0', 'B#1'])
    })

    test('a ref stays the same when an unknown entry before it comes or goes', () => {
        const withStale = listRows(['stale', 'A', 'B'], known)
        const without = listRows(['A', 'B'], known)
        expect(withStale.map((r) => r.key)).toEqual(without.map((r) => r.key))
    })

    test('a null entry, a folder without data, an empty folder and a folder without a known member have no row', () => {
        const noData = { id: 'nd', name: 'x', color: '' } as unknown as folder
        const rows = listRows([null, 'A', noData, f('e', []), f('s', ['stale']), f('k', ['B'])], known)
        expect(rows.map((r) => (r.kind === 'folder' ? `F:${r.id}` : r.id))).toEqual(['A', 'F:k'])
    })

    test('guard: a folder is shown by its visible members, and members come from the first predicate', () => {
        const visible = (id: string): boolean => id !== 'hidden' && id !== 'stale'
        expect(isShownFolder(f('a', ['hidden', 'B']), visible)).toBe(true)
        expect(isShownFolder(f('a', ['hidden', 'stale']), visible)).toBe(false)
        expect(isShownFolder(f('a', []), visible)).toBe(false)
        // A closed folder lists no members but keeps its row; an open one lists the members it is given.
        const closed = listRows([f('c', ['B', 'C'])], () => false, visible)
        expect(closed.map((r) => r.kind === 'folder' && r.members.length)).toEqual([0])
        const open = listRows([f('c', ['B', 'hidden', 'C'])], visible)
        expect(open.map((r) => r.kind === 'folder' && r.members.map((m) => m.id))).toEqual([['B', 'C']])
    })

    test('guard: a dropped folder still counts as an occurrence, so a later folder with the same id keeps its ref', () => {
        const rows = listRows([f('F', ['stale']), 'A', f('F', ['B'])], known)
        expect(rows.map((r) => r.key)).toEqual([refKey(char('A')), refKey(fol('F', 1))])
    })

    test('keys are unique for duplicates, duplicate folder ids and a folder id equal to a character id', () => {
        const order: OrderEntry[] = ['A', 'B', 'A', f('B', ['C', 'C']), f('B', ['C']), f('A', ['A', 'A']), f('a:b', ['c']), 'a:b']
        const keys = allKeys(listRows(order, () => true))
        expect(new Set(keys).size).toBe(keys.length)
    })

    test('ids that contain separators cannot collide', () => {
        expect(refKey(mem(fol('a:b'), 'c'))).not.toBe(refKey(mem(fol('a'), 'b:c')))
        expect(refKey(char('1:x', 0))).not.toBe(refKey(char('1', 0)))
        expect(refKey(char('a'))).not.toBe(refKey(fol('a')))
    })
})

describe('operations on a $state proxy', () => {
    test('moveToGap and dropOnItem read a live proxy and return plain results', () => {
        const order: OrderEntry[] = $state(['A', 'B', f('f1', ['C', 'D'])])
        const moved = moveToGap(order, char('A'), topGap(char('B')))
        expect(show(moved)).toEqual(['B', 'A', 'f1[C,D]'])
        const dropped = dropOnItem(order, char('A'), char('B'), NEW)
        expect(show(dropped)).toEqual(['new-id[A,B]', 'f1[C,D]'])
        const out = moveToGap(order, mem(fol('f1'), 'C'), topGap(null))
        expect(show(out)).toEqual(['C', 'A', 'B', 'f1[D]'])
        // the proxy itself was not touched
        expect(show($state.snapshot(order))).toEqual(['A', 'B', 'f1[C,D]'])
    })

    test('listRows and editFolder read a live proxy', () => {
        const order: OrderEntry[] = $state(['A', f('f1', ['B'])])
        expect(listRows(order, () => true)).toHaveLength(2)
        const edited = editFolder(order, 'f1', (copy) => {
            copy.color = 'red'
        })
        expect(edited).not.toBeNull()
        expect((edited![1] as folder).color).toBe('red')
        expect((order[1] as folder).color).toBe('')
    })

    test('a result assigned back into the proxy replaces the order', () => {
        const order: OrderEntry[] = $state(['A', 'B', 'C'])
        const holder = $state({ order })
        holder.order = moveToGap(holder.order, char('C'), topGap(null))
        expect(show($state.snapshot(holder.order))).toEqual(['C', 'A', 'B'])
    })
})

//#region properties

function allKeys(rows: TopRow[]): string[] {
    const keys: string[] = []
    for (const row of rows) {
        keys.push(row.key)
        if (row.kind === 'folder') {
            for (const member of row.members) {
                keys.push(member.key)
            }
        }
    }
    return keys
}

const ids = ['a', 'b', 'c', 'd']
const idArb = fc.constantFrom(...ids)
const folderArb: fc.Arbitrary<OrderEntry> = fc.oneof(
    { weight: 8, arbitrary: fc.record({ id: fc.constantFrom('a', 'b', 'f1', 'f2'), name: fc.constantFrom('n1', 'n2'), color: fc.constantFrom('', 'red'), data: fc.array(idArb, { maxLength: 4 }) }, { requiredKeys: ['id', 'name', 'color', 'data'] }) },
    { weight: 1, arbitrary: fc.constant({ id: 'nd', name: 'nodata', color: '' } as unknown as folder) },
)
const entryArb: fc.Arbitrary<OrderEntry> = fc.oneof(
    { weight: 6, arbitrary: idArb },
    { weight: 3, arbitrary: folderArb },
    { weight: 1, arbitrary: fc.constant(null) },
)
const orderArb = fc.array(entryArb, { maxLength: 9 })

function isValidFolder(entry: OrderEntry): entry is folder {
    return typeof entry === 'object' && entry !== null && Array.isArray(entry.data)
}

function topIndexOf(order: readonly OrderEntry[], ref: CharRef | FolderRef): number {
    let seen = 0
    for (let i = 0; i < order.length; i++) {
        const entry = order[i]
        const same = ref.kind === 'char' ? entry === ref.id : isValidFolder(entry) && entry.id === ref.id
        if (same) {
            if (seen === ref.occurrence) {
                return i
            }
            seen++
        }
    }
    return -1
}
function leaves(order: readonly OrderEntry[]): string[] {
    const out: string[] = []
    for (const entry of order) {
        if (typeof entry === 'string') {
            out.push(entry)
        } else if (isValidFolder(entry)) {
            out.push(...entry.data)
        }
    }
    return out.sort()
}

function others(order: readonly OrderEntry[]): string[] {
    return order
        .filter((e) => e === null || (typeof e === 'object' && !Array.isArray(e.data)))
        .map((e) => JSON.stringify(e))
        .sort()
}

function folderMetas(order: readonly OrderEntry[]): string[] {
    return order
        .filter(isValidFolder)
        .map((e) => JSON.stringify({ ...e, data: undefined }))
        .sort()
}

function removedFrom(before: string[], after: string[]): string[] {
    const rest = [...after]
    const gone: string[] = []
    for (const item of before) {
        const at = rest.indexOf(item)
        if (at === -1) {
            gone.push(item)
        } else {
            rest.splice(at, 1)
        }
    }
    return gone
}

/** Every ref that points at a row of `order`, plus some that point at nothing. */
function refsOf(order: readonly OrderEntry[]): { tops: Array<CharRef | FolderRef>; members: MemberRef[]; folders: FolderRef[] } {
    const rows = listRows(order, () => true)
    const tops: Array<CharRef | FolderRef> = []
    const members: MemberRef[] = []
    const folders: FolderRef[] = []
    for (const row of rows) {
        tops.push(row.ref)
        if (row.kind === 'folder') {
            folders.push(row.ref)
            members.push(...row.members.map((m) => m.ref))
        }
    }
    tops.push(char('zz'), fol('zz'))
    members.push(mem(fol('zz'), 'a'))
    return { tops, members, folders }
}

describe('properties (random orders with duplicates, unknown entries and nested duplicates)', () => {
    const pick = <T>(items: readonly T[], n: number): T => items[n % items.length]

    test('every operation keeps the characters, the other entries and the folder settings', () => {
        fc.assert(
            fc.property(orderArb, fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.boolean(), (order, a, b, c, d, useMove) => {
                deepFreeze(order)
                const { tops, members, folders } = refsOf(order)
                const sources: ItemRef[] = [...tops, ...members]
                const source = pick(sources, a)
                let result: OrderEntry[]
                if (useMove) {
                    const after = pick<CharRef | FolderRef | null>([null, ...tops], b)
                    const gap: Gap = c % 2 === 0 || folders.length === 0
                        ? topGap(after)
                        : folderGap(pick(folders, c), pick<MemberRef | null>([null, ...members], d))
                    result = moveToGap(order, source, gap)
                } else {
                    result = dropOnItem(order, source, pick<ItemRef>([...tops, ...members], b), NEW)
                }
                if (useMove && result !== order && source.kind !== 'member' && result.length === order.length) {
                    const gapIsTop = !(c % 2 !== 0 && folders.length > 0)
                    if (gapIsTop) {
                        const at = topIndexOf(order, source)
                        const moved = JSON.stringify(order[at])
                        const without = order.filter((_, i) => i !== at).map((e) => JSON.stringify(e))
                        const stillInOrder = result.some((_, k) => {
                            return JSON.stringify(result[k]) === moved && result.filter((_, i) => i !== k).map((e) => JSON.stringify(e)).join('|') === without.join('|')
                        })
                        expect(stillInOrder).toBe(true)
                    }
                }                expect(leaves(result)).toEqual(leaves(order))
                expect(others(result)).toEqual(others(order))

                const removed = removedFrom(folderMetas(order), folderMetas(result))
                const added = removedFrom(folderMetas(result), folderMetas(order))
                expect(removed.length).toBeLessThanOrEqual(1)
                expect(added.length).toBeLessThanOrEqual(1)
                if (added.length === 1) {
                    expect(JSON.parse(added[0]).id).toBe(NEW.id)
                    expect(useMove).toBe(false)
                }
            }),
            { numRuns: 400 },
        )
    })

    test('the same operation on a $state proxy and on a plain copy gives the same result', () => {
        fc.assert(
            fc.property(orderArb, fc.nat(), fc.nat(), fc.nat(), fc.boolean(), (order, a, b, c, useMove) => {
                const plain: OrderEntry[] = structuredClone(order)
                const proxied: OrderEntry[] = $state(structuredClone(order))
                const { tops, members } = refsOf(plain)
                const source = pick([...tops, ...members], a)
                const target = pick<CharRef | FolderRef | null>([null, ...tops], b)
                const targetItem = pick<ItemRef>([...tops, ...members], c)
                const run = (o: OrderEntry[]): string[] =>
                    show(useMove ? moveToGap(o, source, topGap(target)) : dropOnItem(o, source, targetItem, NEW))
                expect(run(proxied)).toEqual(run(plain))
            }),
            { numRuns: 300 },
        )
    })
    test('keys of listRows are unique for every random order', () => {
        fc.assert(
            fc.property(orderArb, (order) => {
                const keys = allKeys(listRows(order, () => true))
                expect(new Set(keys).size).toBe(keys.length)
            }),
            { numRuns: 400 },
        )
    })

    test('moving a character to any gap and back after its old neighbour restores the order', () => {
        fc.assert(
            fc.property(fc.shuffledSubarray(['a', 'b', 'c', 'd', 'e', 'f'], { minLength: 1 }), fc.nat(), fc.nat(), (order, a, b) => {
                deepFreeze(order)
                const index = a % order.length
                const source = char(order[index])
                const previous = index === 0 ? null : char(order[index - 1])
                const after = pick<CharRef | null>([null, ...order.map((id) => char(id))], b)
                const away = moveToGap(order, source, topGap(after))
                expect(away.length).toBe(order.length)
                expect(moveToGap(away, source, topGap(previous))).toEqual(order)
            }),
            { numRuns: 300 },
        )
    })
})
//#endregion

//#region ungroup
describe('ungroupFolder', () => {
    test('(U) the folder is replaced in place by its members, in folder order, at the top, middle and end', () => {
        expect(ungroupFolder(deepFreeze(['a', f('F', ['x', 'y']), 'b']), fol('F'))).toEqual(['a', 'x', 'y', 'b'])
        expect(ungroupFolder(deepFreeze([f('F', ['x', 'y']), 'a']), fol('F'))).toEqual(['x', 'y', 'a'])
        expect(ungroupFolder(deepFreeze(['a', f('F', ['y', 'x'])]), fol('F'))).toEqual(['a', 'y', 'x'])
    })
    test('(U) other folders and their members are untouched and no input is mutated', () => {
        const other = f('G', ['m'])
        const order = deepFreeze(['a', f('F', ['x']), other])
        const next = ungroupFolder(order, fol('F'))
        expect(next).toEqual(['a', 'x', other])
        expect(next?.[2]).toBe(other)
    })
    test('(G) with two folders sharing an id only the referenced occurrence is ungrouped', () => {
        const order = deepFreeze([f('F', ['x']), 'a', f('F', ['y', 'z'])])
        expect(ungroupFolder(order, fol('F', 1))).toEqual([expect.objectContaining({ id: 'F', data: ['x'] }), 'a', 'y', 'z'])
        expect(ungroupFolder(order, fol('F', 0))).toEqual(['x', 'a', expect.objectContaining({ id: 'F', data: ['y', 'z'] })])
    })
    test('(U) a folder that is gone, an occurrence past the end and a non-folder id give null', () => {
        expect(ungroupFolder(['a', f('F', ['x'])], fol('G'))).toBeNull()
        expect(ungroupFolder(['a', f('F', ['x'])], fol('F', 1))).toBeNull()
        expect(ungroupFolder(['F'], fol('F'))).toBeNull()
        expect(ungroupFolder([], fol('F'))).toBeNull()
    })
    test('(U) an empty folder disappears without adding anything', () => {
        expect(ungroupFolder(['a', f('F', [])], fol('F'))).toEqual(['a'])
    })
    test('(U) folderMemberIds names the members of the referenced occurrence, or null', () => {
        const order = [f('F', ['x']), f('F', ['y', 'z'])]
        expect(folderMemberIds(order, fol('F', 1))).toEqual(['y', 'z'])
        expect(folderMemberIds(order, fol('F', 2))).toBeNull()
        expect(folderMemberIds(['F'], fol('F'))).toBeNull()
    })
})
//#endregion

//#region groupIntoFolder
const grp = (order: OrderEntry[], sources: ItemRef[]): string[] => show(groupIntoFolder(deepFreeze(order), sources, NEW))

describe('groupIntoFolder', () => {
    test('(F) two top-level characters become one folder at the first one place, in document order', () => {
        expect(grp(['a', 'b', 'c', 'd'], [char('b'), char('d')])).toEqual(['a', 'new-id[b,d]', 'c'])
    })
    test('(F) the order the sources arrive in does not change the result', () => {
        expect(grp(['a', 'b', 'c', 'd'], [char('d'), char('b')])).toEqual(['a', 'new-id[b,d]', 'c'])
    })
    test('(F) members of one folder keep their folder order whatever order they are given in', () => {
        expect(grp(['a', f('F', ['x', 'y', 'z'])], [mem(fol('F'), 'z'), mem(fol('F'), 'x')])).toEqual(['a', 'new-id[x,z]', 'F[y]'])
    })
    test('(F) one character makes a folder of one at its own place', () => {
        expect(grp(['a', 'b'], [char('b')])).toEqual(['a', 'new-id[b]'])
    })
    test('(F) a folder member as the first source puts the new folder immediately before its folder', () => {
        expect(grp(['a', f('F1', ['x', 'y']), 'b'], [mem(fol('F1'), 'y')])).toEqual(['a', 'new-id[y]', 'F1[x]', 'b'])
    })
    test('(F) a member that empties its folder leaves the new folder in the place of the old one', () => {
        expect(grp(['a', f('F1', ['x']), 'b'], [mem(fol('F1'), 'x')])).toEqual(['a', 'new-id[x]', 'b'])
    })
    test('(F) a member and a later top-level character: the new folder stands before the folder of the member', () => {
        expect(grp(['a', f('F1', ['x', 'y']), 'b', 'c'], [mem(fol('F1'), 'x'), char('c')])).toEqual(['a', 'new-id[x,c]', 'F1[y]', 'b'])
    })
    test('(F) every member of a folder plus a character before it: one folder at that character place, old folder gone', () => {
        expect(grp(['a', f('F1', ['x', 'y']), 'b'], [char('a'), mem(fol('F1'), 'x'), mem(fol('F1'), 'y')])).toEqual(['new-id[a,x,y]', 'b'])
    })
    test('(F) members of two folders: the new folder stands before the earlier folder, both keep their other members', () => {
        expect(grp([f('F1', ['x', 'y']), 'a', f('F2', ['p', 'q'])], [mem(fol('F2'), 'p'), mem(fol('F1'), 'y')])).toEqual(['new-id[y,p]', 'F1[x]', 'a', 'F2[q]'])
    })
    test('(F) with a duplicated id each occurrence is its own source', () => {
        expect(grp(['a', 'x', 'a', 'y'], [char('a', 1)])).toEqual(['a', 'x', 'new-id[a]', 'y'])
        expect(grp(['a', 'x', 'a', 'y'], [char('a', 0)])).toEqual(['new-id[a]', 'x', 'a', 'y'])
    })
    test('(F) the same source twice counts once', () => {
        expect(grp(['a', 'b'], [char('b'), char('b')])).toEqual(['a', 'new-id[b]'])
    })
    test('(G) a source that does not resolve changes nothing, even beside valid ones', () => {
        const order = deepFreeze(['a', 'b'])
        expect(groupIntoFolder(order, [char('b'), char('zz')], NEW)).toBe(order)
        expect(groupIntoFolder(order, [mem(fol('zz'), 'a')], NEW)).toBe(order)
    })
    test('(G) no sources changes nothing', () => {
        const order = deepFreeze(['a', 'b'])
        expect(groupIntoFolder(order, [], NEW)).toBe(order)
    })
    test('(G) null entries, folders without data and folders that were already empty are carried through', () => {
        const nodata = { id: 'nd', name: 'nodata', color: '' } as unknown as folder
        const result = groupIntoFolder(deepFreeze([null, nodata, 'a', 'b', f('E', [])]), [char('a'), char('b')], NEW)
        expect(result).toEqual([null, nodata, { id: 'new-id', name: 'New Folder', color: '', data: ['a', 'b'] }, f('E', [])])
        expect(grp(['a', f('E', []), 'b'], [char('a'), char('b')])).toEqual(['new-id[a,b]', 'E[]'])
    })
    test('(G) non-string members of a folder stay in its copy, and a folder left with only them stays', () => {
        const junk = f('F', ['x', 7 as never, 'y'])
        const result = groupIntoFolder(deepFreeze(['a', junk]), [char('a'), fol('F')], NEW)
        expect(result).toEqual([{ id: 'new-id', name: 'New Folder', color: '', data: ['a', 'x', 'y'] }, { ...junk, data: [7] }])
        const partly = groupIntoFolder(deepFreeze([f('F', ['x', 7 as never, 'y'])]), [mem(fol('F'), 'y')], NEW)
        expect(partly).toEqual([{ id: 'new-id', name: 'New Folder', color: '', data: ['y'] }, f('F', ['x', 7 as never])])
    })
    test('(F) a folder and a character: the folder members join the new folder in member order and the folder is gone', () => {
        expect(grp(['a', f('F', ['x', 'y']), 'b'], [fol('F'), char('b')])).toEqual(['a', 'new-id[x,y,b]'])
    })
    test('(F) a folder together with one of its own members is the folder alone', () => {
        expect(grp(['a', f('F', ['x', 'y'])], [fol('F'), mem(fol('F'), 'x')])).toEqual(['a', 'new-id[x,y]'])
    })
    test('(F) a folder as the only source regroups its members; a folder with no string member changes nothing', () => {
        expect(grp([f('F', ['x', 'y'])], [fol('F')])).toEqual(['new-id[x,y]'])
        const empty = deepFreeze([f('F', [])])
        expect(groupIntoFolder(empty, [fol('F')], NEW)).toBe(empty)
    })
    test('(F) two folders merge into one at the first folder place', () => {
        expect(grp([f('F', ['x']), 'a', f('G', ['y', 'z'])], [fol('F'), fol('G')])).toEqual(['new-id[x,y,z]', 'a'])
    })
    test('(F) a character before a selected folder keeps the folder place rule: the first source in document order decides', () => {
        expect(grp([f('F', ['x']), 'a', 'b'], [char('b'), fol('F')])).toEqual(['new-id[x,b]', 'a'])
    })
    test('(G) the result on a $state proxy equals the result on a plain copy', () => {
        const plain: OrderEntry[] = ['a', f('F1', ['x', 'y']), 'b', 'c']
        const proxied: OrderEntry[] = $state(structuredClone(plain))
        const sources = [mem(fol('F1'), 'x'), char('c')]
        expect(show(groupIntoFolder(proxied, sources, NEW))).toEqual(show(groupIntoFolder(plain, sources, NEW)))
    })
    test('(G) the input folders are not mutated and untouched entries are the same objects', () => {
        const keep = f('K', ['k'])
        const touched = f('T', ['x', 'y'])
        const order = deepFreeze(['a', keep, touched, 'b'])
        const result = groupIntoFolder(order, [mem(fol('T'), 'x'), char('b')], NEW)
        expect(result[1]).toBe(keep)
        expect(touched.data).toEqual(['x', 'y'])
        expect(result[0]).toBe('a')
    })
})

describe('groupIntoFolder properties', () => {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f']
    const memberArb = fc.oneof(
        { weight: 9, arbitrary: fc.constantFrom(...letters) },
        { weight: 1, arbitrary: fc.constant(7 as never as string) },
    )
    const groupFolderArb: fc.Arbitrary<OrderEntry> = fc.oneof(
        { weight: 9, arbitrary: fc.record({ id: fc.constantFrom('a', 'b', 'f1', 'f2', 'f3'), name: fc.constantFrom('n1', 'n2'), color: fc.constantFrom('', 'red'), data: fc.array(memberArb, { maxLength: 4 }) }, { requiredKeys: ['id', 'name', 'color', 'data'] }) },
        { weight: 1, arbitrary: fc.constant({ id: 'nd', name: 'nodata', color: '' } as unknown as folder) },
    )
    const groupOrderArb = fc.array(
        fc.oneof(
            { weight: 6, arbitrary: fc.constantFrom(...letters) },
            { weight: 3, arbitrary: groupFolderArb },
            { weight: 1, arbitrary: fc.constant(null) },
        ),
        { maxLength: 14 },
    )
    const nats = fc.array(fc.nat(), { minLength: 1, maxLength: 8 })

    /** Every ref that resolves in `order`: top-level characters, folders and folder members. */
    function resolvable(order: readonly OrderEntry[]): ItemRef[] {
        const { tops, members } = refsOf(order)
        return [...tops.slice(0, -2), ...members.slice(0, -1)]
    }

    function nth(order: readonly OrderEntry[], ref: ItemRef): { top: number; member: number } | null {
        const indexes = (list: readonly unknown[], same: (item: unknown) => boolean) => list.map((item, i) => (same(item) ? i : -1)).filter((i) => i >= 0)
        if (ref.kind === 'char') {
            const at = indexes(order, (e) => e === ref.id)[ref.occurrence]
            return at === undefined ? null : { top: at, member: -1 }
        }
        const folderAt = (r: FolderRef) => indexes(order, (e) => isValidFolder(e as OrderEntry) && (e as folder).id === r.id)[r.occurrence]
        if (ref.kind === 'folder') {
            const at = folderAt(ref)
            return at === undefined ? null : { top: at, member: -2 }
        }
        const owner = folderAt(ref.folder)
        if (owner === undefined) {
            return null
        }
        const at = indexes((order[owner] as folder).data, (m) => m === ref.id)[ref.occurrence]
        return at === undefined ? null : { top: owner, member: at }
    }

    /** An independent model of the operation: filter-based, no splicing, written from the rules. */
    function oracle(order: readonly OrderEntry[], sources: readonly ItemRef[]): OrderEntry[] | null {
        const chosen = new Map<number, Set<number>>()
        const take = (top: number, member: number) => {
            chosen.set(top, (chosen.get(top) ?? new Set<number>()).add(member))
        }
        for (const ref of sources) {
            const found = nth(order, ref)
            if (!found) {
                return null
            }
            if (found.member === -2) {
                (order[found.top] as folder).data.forEach((m, i) => { if (typeof m === 'string') { take(found.top, i) } })
            }
            else {
                take(found.top, found.member)
            }
        }
        if (chosen.size === 0) {
            return null
        }
        const tops = [...chosen.keys()].sort((x, y) => x - y)
        const data: string[] = []
        for (const t of tops) {
            if (chosen.get(t)!.has(-1)) {
                data.push(order[t] as string)
            }
            else {
                const picked = [...chosen.get(t)!].sort((x, y) => x - y)
                data.push(...picked.map((m) => (order[t] as folder).data[m]))
            }
        }
        const out: OrderEntry[] = []
        order.forEach((entry, t) => {
            if (t === tops[0]) {
                out.push({ name: NEW.name, data, color: '', id: NEW.id })
            }
            const picked = chosen.get(t)
            if (!picked) {
                out.push(entry)
                return
            }
            if (picked.has(-1)) {
                return
            }
            const rest = (entry as folder).data.filter((_, m) => !picked.has(m))
            if (rest.length > 0) {
                out.push({ ...(entry as folder), data: rest })
            }
        })
        return out
    }

    const strings = (order: readonly OrderEntry[]): string[] => {
        const out: string[] = []
        for (const e of order) {
            if (typeof e === 'string') {
                out.push(e)
            }
            else if (isValidFolder(e)) {
                out.push(...e.data.filter((m): m is string => typeof m === 'string'))
            }
        }
        return out.sort()
    }

    const sourcesFrom = (order: readonly OrderEntry[], picks: number[]): ItemRef[] => {
        const all = resolvable(order)
        return all.length === 0 ? [] : picks.map((n) => all[n % all.length])
    }

    test('(P) the result matches an independent model, never mutates its input and keeps every character once', () => {
        fc.assert(
            fc.property(groupOrderArb, nats, (order, picks) => {
                deepFreeze(order)
                const sources = sourcesFrom(order, picks)
                const result = groupIntoFolder(order, sources, NEW)
                const expected = oracle(order, sources)
                if (expected === null) {
                    expect(result).toBe(order)
                    return
                }
                expect(result).toEqual(expected)
                expect(strings(result)).toEqual(strings(order))
                const created = result.filter((e) => typeof e === 'object' && e !== null && e.id === NEW.id)
                expect(created.length).toBe(1)
                const at = result.indexOf(created[0])
                for (let i = 0; i < at; i++) {
                    expect(result[i]).toBe(order[i])
                }
                expect((created[0] as folder).data.every((m) => typeof m === 'string')).toBe(true)
            }),
            { numRuns: 500 },
        )
    })

    test('(P) the result does not depend on the order, repetition or member expansion of the sources', () => {
        fc.assert(
            fc.property(groupOrderArb, nats, (order, picks) => {
                deepFreeze(order)
                const sources = sourcesFrom(order, picks)
                const base = groupIntoFolder(order, sources, NEW)
                const { members } = refsOf(order)
                const selectedFolders = sources.filter((s): s is FolderRef => s.kind === 'folder')
                const expanded = [
                    ...sources,
                    ...members.filter((m) => selectedFolders.some((fr) => fr.id === m.folder.id && fr.occurrence === m.folder.occurrence) && nth(order, m) !== null),
                ]
                expect(groupIntoFolder(order, [...sources].reverse(), NEW)).toEqual(base)
                expect(groupIntoFolder(order, [...sources, ...sources], NEW)).toEqual(base)
                expect(groupIntoFolder(order, expanded, NEW)).toEqual(base)
            }),
            { numRuns: 400 },
        )
    })

    test('(P) any source that does not resolve refuses the whole operation', () => {
        fc.assert(
            fc.property(groupOrderArb, nats, fc.nat(), (order, picks, where) => {
                deepFreeze(order)
                const sources = sourcesFrom(order, picks)
                sources.splice(where % (sources.length + 1), 0, char('zz'))
                expect(groupIntoFolder(order, sources, NEW)).toBe(order)
            }),
            { numRuns: 300 },
        )
    })

    test('(P) two characters grouped equal the rail drop of the later on the earlier, up to the folder member order', () => {
        const norm = (order: readonly OrderEntry[]) => order.map((e) => (typeof e === 'object' && e !== null && e.id === NEW.id && Array.isArray(e.data) ? { ...e, data: [...e.data].sort() } : e))
        fc.assert(
            fc.property(groupOrderArb, fc.nat(), fc.nat(), (order, i, j) => {
                deepFreeze(order)
                const { tops, members } = refsOf(order)
                const firsts = tops.slice(0, -2).filter((r): r is CharRef => r.kind === 'char')
                if (firsts.length === 0) {
                    return
                }
                const a = firsts[i % firsts.length]
                const aAt = nth(order, a)!.top
                const laters: ItemRef[] = [
                    ...firsts.filter((r) => nth(order, r)!.top > aAt),
                    ...members.slice(0, -1).filter((m) => nth(order, m)!.top > aAt),
                ]
                if (laters.length === 0) {
                    return
                }
                const b = laters[j % laters.length]
                expect(norm(groupIntoFolder(order, [a, b], NEW))).toEqual(norm(dropOnItem(order, b, a, NEW)))
            }),
            { numRuns: 500 },
        )
    })

    test('(P) top-level characters only: the others stay in order and the block lands at the first one place', () => {
        fc.assert(
            fc.property(fc.array(fc.constantFrom(...letters), { maxLength: 10 }), fc.array(fc.nat(), { minLength: 1, maxLength: 6 }), (order, picks) => {
                deepFreeze(order)
                if (order.length === 0) {
                    return
                }
                const chosen = [...new Set(picks.map((n) => n % order.length))].sort((x, y) => x - y)
                const refs = chosen.map((at) => char(order[at], order.slice(0, at).filter((id) => id === order[at]).length))
                const rest = order.filter((_, at) => !chosen.includes(at))
                const expected: OrderEntry[] = [...rest]
                expected.splice(chosen[0], 0, { name: NEW.name, data: chosen.map((at) => order[at]), color: '', id: NEW.id })
                expect(groupIntoFolder(order, [...refs].reverse(), NEW)).toEqual(expected)
            }),
            { numRuns: 400 },
        )
    })

    test('(P) ungrouping the new folder gives the characters back, and for one top-level character the same order', () => {
        fc.assert(
            fc.property(groupOrderArb, nats, (order, picks) => {
                deepFreeze(order)
                const sources = sourcesFrom(order, picks)
                const result = groupIntoFolder(order, sources, NEW)
                if (result === order) {
                    return
                }
                const back = ungroupFolder(result, fol(NEW.id))
                expect(back).not.toBeNull()
                expect(strings(back!)).toEqual(strings(order))
                expect(back!.some((e) => typeof e === 'object' && e !== null && e.id === NEW.id)).toBe(false)
            }),
            { numRuns: 400 },
        )
        fc.assert(
            fc.property(fc.array(fc.constantFrom(...letters), { minLength: 1, maxLength: 8 }), fc.nat(), (order, n) => {
                deepFreeze(order)
                const at = n % order.length
                const ref = char(order[at], order.slice(0, at).filter((id) => id === order[at]).length)
                expect(ungroupFolder(groupIntoFolder(order, [ref], NEW), fol(NEW.id))).toEqual(order)
            }),
            { numRuns: 300 },
        )
    })
})
//#endregion