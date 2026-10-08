import { describe, test, expect } from 'vitest'
import fc from 'fast-check'
import type { folder } from 'src/ts/storage/database.svelte'
import {
    dropOnItem,
    editFolder,
    folderMemberIds,
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