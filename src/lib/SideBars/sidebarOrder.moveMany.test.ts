import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import isEqual from 'lodash/isEqual'
import type { folder } from 'src/ts/storage/database.svelte'
import {
    foldersDissolvedBy,
    groupIntoFolder,
    moveManyToGap,
    moveToGap,
    type CharRef,
    type FolderRef,
    type Gap,
    type ItemRef,
    type MemberRef,
    type OrderEntry,
} from './sidebarOrder'

/**
 * `moveManyToGap`, `foldersDissolvedBy` and the placement argument of `groupIntoFolder`: the order
 * operations behind the Grid's multi-tile drag. Every input is deep-frozen, so an operation that
 * mutates what it was given fails. These are feature tests of new exports (on the earlier base each
 * one fails because the export is absent, except the two tests titled compatibility guard, which pass there); the evidence that the rules are pinned is the mutation
 * table of the stage report. The differential property against `moveToGap` is a compatibility
 * guard: it holds for the single-source case the sidebar already relies on.
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

const f = (id: string, data: string[]): folder => ({ id, name: `n-${id}`, color: '', data })
/** A folder whose `data` also holds a non-string entry, as data from other tools can. */
const withResidue = (id: string, data: (string | number)[]): folder => ({ id, name: `n-${id}`, color: '', data } as unknown as folder)

const char = (id: string, occurrence = 0): CharRef => ({ kind: 'char', id, occurrence })
const fol = (id: string, occurrence = 0): FolderRef => ({ kind: 'folder', id, occurrence })
const mem = (folderRef: FolderRef, id: string, occurrence = 0): MemberRef => ({ kind: 'member', folder: folderRef, id, occurrence })
const topGap = (after: CharRef | FolderRef | null): Gap => ({ in: 'top', after })
const folderGap = (folderRef: FolderRef, after: MemberRef | null): Gap => ({ in: 'folder', folder: folderRef, after })

const NEW = { id: 'new-id', name: 'New Folder' }

function show(order: readonly OrderEntry[]): string[] {
    return order.map((e) => (e === null ? 'null' : typeof e === 'string' ? e : `${e.id}[${(e.data ?? []).join(',')}]`))
}

const many = (order: OrderEntry[], sources: ItemRef[], gap: Gap): string[] => show(moveManyToGap(deepFreeze(order), sources, gap))
const merge = (order: OrderEntry[], sources: ItemRef[], target: CharRef): string[] => show(groupIntoFolder(deepFreeze(order), sources, NEW, target))

describe('moveManyToGap', () => {
    test('R-op-1 scattered characters land contiguous in document order at the gap, whatever the pick order', () => {
        const order = ['a', 'b', 'c', 'd', 'e']
        const expected = ['b', 'd', 'a', 'c', 'e']
        expect(many(order, [char('a'), char('c'), char('e')], topGap(char('d')))).toEqual(expected)
        expect(many(order, [char('e'), char('c'), char('a')], topGap(char('d')))).toEqual(expected)
        expect(many(order, [char('c'), char('e')], topGap(null))).toEqual(['c', 'e', 'a', 'b', 'd'])
    })

    test('a position named twice is moved once', () => {
        expect(many(['a', 'b', 'c'], [char('a'), char('a')], topGap(char('c')))).toEqual(['b', 'c', 'a'])
    })

    test('R-op-4 an anchor that is itself a source is replaced by the nearest preceding sibling that is not', () => {
        expect(many(['a', 'b', 'c', 'd'], [char('a'), char('c')], topGap(char('c')))).toEqual(['b', 'a', 'c', 'd'])
        const order = ['a', 'b']
        expect(moveManyToGap(order, [char('a')], topGap(char('a')))).toBe(order)
        expect(many(['x', 'a', 'b'], [char('a'), char('b')], topGap(char('b')))).toEqual(['x', 'a', 'b'])
    })

    test('R-op-4 the first and the last gap', () => {
        expect(many(['a', 'b', 'c', 'd'], [char('a'), char('b')], topGap(char('d')))).toEqual(['c', 'd', 'a', 'b'])
        expect(many(['a', 'b', 'c', 'd'], [char('c'), char('d')], topGap(null))).toEqual(['c', 'd', 'a', 'b'])
    })

    test('R-op-4 a gap inside a folder whose members are sources: the insert index counts only the members removed before the anchor', () => {
        const order = [f('F', ['x', 'y', 'z']), 'q']
        expect(many(order, [mem(fol('F'), 'x'), mem(fol('F'), 'z')], folderGap(fol('F'), mem(fol('F'), 'y')))).toEqual(['F[y,x,z]', 'q'])
        expect(many(order, [mem(fol('F'), 'x'), mem(fol('F'), 'z')], folderGap(fol('F'), mem(fol('F'), 'x')))).toEqual(['F[x,z,y]', 'q'])
    })

    test('R-op-4 a move that empties a folder removes it, one that does not touch an already empty folder leaves it', () => {
        expect(many(['a', f('F', ['x']), 'b'], [mem(fol('F'), 'x')], topGap(char('a')))).toEqual(['a', 'x', 'b'])
        expect(many(['a', f('E', []), 'b'], [char('a')], topGap(char('b')))).toEqual(['E[]', 'b', 'a'])
    })

    test('R-op-4 members moved out of a folder to a gap inside another folder', () => {
        const order = [f('F', ['x', 'y']), f('G', ['p'])]
        expect(many(order, [mem(fol('F'), 'x')], folderGap(fol('G'), mem(fol('G'), 'p')))).toEqual(['F[y]', 'G[p,x]'])
    })

    test('R-op-6 a dragged folder dropped in a folder gap is dissolved: its members join the block in document order and the folder goes', () => {
        const order = ['a', f('F', ['x', 'y']), f('G', ['z'])]
        expect(many(order, [fol('F')], folderGap(fol('G'), mem(fol('G'), 'z')))).toEqual(['a', 'G[z,x,y]'])
        expect(many(order, [fol('F'), char('a')], folderGap(fol('G'), null))).toEqual(['G[a,x,y,z]'])
        expect(many(order, [char('a'), fol('F')], folderGap(fol('G'), null))).toEqual(['G[a,x,y,z]'])
    })

    test('R-op-6 non-string residue keeps the dragged folder, a dragged folder with no string member is untouched', () => {
        const kept = [withResidue('F', ['x', 7]), f('G', ['z'])]
        expect(many(kept, [fol('F')], folderGap(fol('G'), mem(fol('G'), 'z')))).toEqual(['F[7]', 'G[z,x]'])
        const none = ['a', withResidue('F', [7]), f('G', ['z'])]
        expect(many(none, [fol('F'), char('a')], folderGap(fol('G'), mem(fol('G'), 'z')))).toEqual(['F[7]', 'G[z,a]'])
        const alone = [withResidue('F', [7]), f('G', ['z'])]
        expect(moveManyToGap(alone, [fol('F')], folderGap(fol('G'), null))).toBe(alone)
    })

    test('R-op-6 a dragged folder with a string member after a non-string entry still contributes it', () => {
        const order = [withResidue('F', ['x', 7, 'y']), f('G', ['z'])]
        expect(many(order, [fol('F')], folderGap(fol('G'), null))).toEqual(['F[7]', 'G[x,y,z]'])
    })

    test('R-op-6 a dragged folder moves whole to a top-level gap, with its identity and members', () => {
        const folderF = f('F', ['x', 'y'])
        const order = ['a', folderF, 'b']
        const next = moveManyToGap(deepFreeze(order), [fol('F'), char('a')], topGap(char('b')))
        expect(show(next)).toEqual(['b', 'a', 'F[x,y]'])
        expect(next[2]).toBe(folderF)
    })

    test('R-op-7 a folder gap inside a dragged folder, or an append onto it, returns the input', () => {
        const order = [f('F', ['x', 'y']), 'a']
        expect(moveManyToGap(order, [fol('F')], folderGap(fol('F'), mem(fol('F'), 'x')))).toBe(order)
        expect(moveManyToGap(order, [fol('F'), char('a')], folderGap(fol('F'), null))).toBe(order)
        expect(moveManyToGap(order, [fol('F'), char('a')], folderGap(fol('F'), mem(fol('F'), 'y')))).toBe(order)
    })

    test('R-op-8 a mixed selection into a folder gap: folder, its own member, another folder\'s member and a loose character', () => {
        const order = [f('F', ['x', 'y']), f('G', ['p', 'q']), f('H', ['h']), 'a', 'b']
        const sources = [fol('F'), mem(fol('F'), 'y'), mem(fol('G'), 'p'), char('a')]
        expect(many(order, sources, folderGap(fol('H'), mem(fol('H'), 'h')))).toEqual(['G[q]', 'H[h,x,y,p,a]', 'b'])
        expect(merge(order, sources, char('b'))).toEqual(['G[q]', 'H[h]', 'new-id[x,y,p,a,b]'])
    })

    test('R-op-10 an emptied source owner that is the anchor folder is dropped only after the insert', () => {
        expect(many([f('F', ['x']), 'a', 'b'], [mem(fol('F'), 'x'), char('b')], topGap(fol('F')))).toEqual(['x', 'b', 'a'])
    })

    test('R-op-10 every member of the destination folder dragged to a gap inside it: the destination is never dropped', () => {
        expect(many(['a', f('F', ['x'])], [char('a'), mem(fol('F'), 'x')], folderGap(fol('F'), mem(fol('F'), 'x')))).toEqual(['F[a,x]'])
        const order = [f('F', ['x', 'y'])]
        expect(moveManyToGap(order, [mem(fol('F'), 'x'), mem(fol('F'), 'y')], folderGap(fol('F'), mem(fol('F'), 'y')))).toBe(order)
    })

    test('R-op-10 a dissolved folder next to the anchor, and a member leaving the anchor folder', () => {
        expect(many([f('G', ['g']), f('F', ['x']), 'a'], [fol('F')], folderGap(fol('G'), mem(fol('G'), 'g')))).toEqual(['G[g,x]', 'a'])
        expect(many([f('F', ['x']), 'a', 'b'], [mem(fol('F'), 'x')], topGap(fol('F')))).toEqual(['x', 'a', 'b'])
    })

    test('R-op-11 a member is subsumed by its folder by resolved position, not by id', () => {
        const order = [f('F', ['x']), f('F', ['y']), 'a']
        expect(many(order, [fol('F', 0), mem(fol('F', 1), 'y')], topGap(char('a')))).toEqual(['a', 'F[x]', 'y'])
        expect(many(order, [fol('F', 0), mem(fol('F', 0), 'x')], topGap(char('a')))).toEqual(['F[y]', 'a', 'F[x]'])
    })

    test('F-op-6 anything that changes nothing returns the input array itself', () => {
        const order = ['a', 'b', f('F', ['x']), 'c']
        expect(moveManyToGap(order, [], topGap(null))).toBe(order)
        expect(moveManyToGap(order, [char('a')], topGap(null))).toBe(order)
        expect(moveManyToGap(order, [char('b')], topGap(char('a')))).toBe(order)
        expect(moveManyToGap(order, [char('a'), char('b')], topGap(char('b')))).toBe(order)
        expect(moveManyToGap(order, [char('a'), char('zz')], topGap(char('c')))).toBe(order)
        expect(moveManyToGap(order, [char('b')], topGap(char('zz')))).toBe(order)
        expect(moveManyToGap(order, [char('a')], folderGap(fol('zz'), null))).toBe(order)
        expect(moveManyToGap(order, [char('a')], folderGap(fol('F'), mem(fol('F'), 'zz')))).toBe(order)
        expect(moveManyToGap(order, [mem(fol('F'), 'zz')], topGap(null))).toBe(order)
    })

    test('F-op-6 a source passing an identical duplicate: moveManyToGap returns the input, moveToGap (unchanged) a new equal array', () => {
        const order = ['a', 'a', 'b']
        const single = moveToGap(order, char('a', 1), topGap(null))
        expect(single).not.toBe(order)
        expect(single).toEqual(order)
        expect(moveManyToGap(order, [char('a', 1)], topGap(null))).toBe(order)
    })

    test('a null entry and a folder without a data array are carried through untouched', () => {
        const noData = { id: 'nd', name: 'n', color: '' } as unknown as folder
        const order: OrderEntry[] = ['a', null, noData, 'b']
        const next = moveManyToGap(deepFreeze(order), [char('a'), char('b')], topGap(null))
        expect(next).toEqual(['a', 'b', null, noData])
        expect(next[3]).toBe(noData)
    })

    test('the folders an operation does not edit keep their identity, an edited one is a copy', () => {
        const untouched = f('U', ['u'])
        const source = f('S', ['x', 'y'])
        const order = [untouched, source, 'a']
        const next = moveManyToGap(deepFreeze(order), [mem(fol('S'), 'x')], topGap(null))
        expect(next[1]).toBe(untouched)
        expect(next[2]).not.toBe(source)
        expect(show(next)).toEqual(['x', 'U[u]', 'S[y]', 'a'])
    })
})

describe('groupIntoFolder with a placement', () => {
    test('R-op-5 the folder takes the placement character\'s place whether the other sources are before or after it', () => {
        const order = ['a', 'b', 'c', 'd']
        expect(merge(order, [char('a'), char('d')], char('b'))).toEqual(['new-id[a,b,d]', 'c'])
        expect(merge(order, [char('d')], char('a'))).toEqual(['new-id[a,d]', 'b', 'c'])
        expect(merge(order, [char('a')], char('d'))).toEqual(['b', 'c', 'new-id[a,d]'])
        expect(merge(order, [char('a'), char('b')], char('c'))).toEqual(['new-id[a,b,c]', 'd'])
        expect(merge(order, [char('c'), char('a')], char('b'))).toEqual(['new-id[a,b,c]', 'd'])
    })

    test('R-op-5 the placement character is in the data exactly once', () => {
        const next = groupIntoFolder(deepFreeze(['a', 'b', 'c']), [char('a')], NEW, char('c'))
        expect(show(next)).toEqual(['b', 'new-id[a,c]'])
    })

    test('R-op-5 a dragged folder contributes its members and goes; member sources leave their folder', () => {
        expect(merge(['a', f('F', ['x', 'y']), 'b'], [fol('F')], char('b'))).toEqual(['a', 'new-id[x,y,b]'])
        expect(merge([f('F', ['x', 'y']), 'b'], [mem(fol('F'), 'x')], char('b'))).toEqual(['F[y]', 'new-id[x,b]'])
        expect(merge([f('F', ['x']), 'b'], [mem(fol('F'), 'x')], char('b'))).toEqual(['new-id[x,b]'])
    })

    test('R-op-5 a dragged folder with non-string residue stays, as it does without a placement', () => {
        expect(merge([withResidue('F', ['x', 7]), 'b'], [fol('F')], char('b'))).toEqual(['F[7]', 'new-id[x,b]'])
        const order = [withResidue('F', ['x', 7]), 'b']
        expect(show(groupIntoFolder(deepFreeze(order), [fol('F')], NEW))).toEqual(['new-id[x]', 'F[7]', 'b'])
    })

    test('compatibility guard: R-op-5 placement absent keeps the first source\'s place',() => {
        expect(show(groupIntoFolder(deepFreeze(['a', 'b', 'c']), [char('c'), char('b')], NEW))).toEqual(['a', 'new-id[b,c]'])
    })

    test('R-op-5 a placement that is unresolved, a member, a folder, or a source itself returns the input', () => {
        const order = ['a', 'b', f('F', ['x'])]
        expect(groupIntoFolder(order, [char('a')], NEW, char('zz'))).toBe(order)
        expect(groupIntoFolder(order, [char('a')], NEW, mem(fol('F'), 'x'))).toBe(order)
        expect(groupIntoFolder(order, [char('a')], NEW, fol('F'))).toBe(order)
        expect(groupIntoFolder(order, [char('a'), char('b')], NEW, char('b'))).toBe(order)
        expect(groupIntoFolder(order, [char('a'), char('zz')], NEW, char('b'))).toBe(order)
    })

    test('compatibility guard: a merge whose sources add no character returns the input',() => {
        const order = ['a', withResidue('F', [7]), f('E', [])]
        expect(groupIntoFolder(order, [], NEW, char('a'))).toBe(order)
        expect(groupIntoFolder(order, [fol('F')], NEW, char('a'))).toBe(order)
        expect(groupIntoFolder(order, [fol('E')], NEW, char('a'))).toBe(order)
    })
})

describe('foldersDissolvedBy', () => {
    test('R-op-9 a folder gap, an append and a merge name the dragged folders they remove, with the order\'s own objects', () => {
        const folderF = f('F', ['x'])
        const folderG = f('G', ['z'])
        const order = ['a', folderF, folderG]
        const input = deepFreeze(order)
        const viaGap = foldersDissolvedBy(input, [fol('F')], folderGap(fol('G'), mem(fol('G'), 'z')))
        expect(viaGap).toHaveLength(1)
        expect(viaGap[0].ref).toEqual(fol('F'))
        expect(viaGap[0].entry).toBe(folderF)
        const viaMerge = foldersDissolvedBy(input, [fol('F'), fol('G')], { in: 'merge', target: char('a') })
        expect(viaMerge.map((d) => d.entry)).toEqual([folderF, folderG])
        expect(viaMerge[1].entry).toBe(folderG)
    })

    test('R-op-9 none for a top-level gap, a character-only drag, a no-op, or a dragged folder that stays', () => {
        const order = ['a', f('F', ['x']), withResidue('R', ['y', 7]), withResidue('N', [7]), f('G', ['z'])]
        expect(foldersDissolvedBy(order, [fol('F')], topGap(null))).toEqual([])
        expect(foldersDissolvedBy(order, [char('a')], folderGap(fol('G'), null))).toEqual([])
        expect(foldersDissolvedBy(order, [fol('G')], folderGap(fol('G'), null))).toEqual([])
        expect(foldersDissolvedBy(order, [fol('R')], folderGap(fol('G'), null))).toEqual([])
        expect(foldersDissolvedBy(order, [fol('N'), char('a')], folderGap(fol('G'), null))).toEqual([])
        expect(foldersDissolvedBy(order, [fol('R')], { in: 'merge', target: char('a') })).toEqual([])
        expect(foldersDissolvedBy(order, [fol('zz')], folderGap(fol('G'), null))).toEqual([])
    })

    test('R-op-9 duplicate folder ids are told apart by occurrence', () => {
        const first = f('F', ['x'])
        const second = f('F', ['y'])
        const order = [first, second, f('G', ['z'])]
        const result = foldersDissolvedBy(order, [fol('F', 1)], folderGap(fol('G'), null))
        expect(result.map((d) => d.ref)).toEqual([fol('F', 1)])
        expect(result[0].entry).toBe(second)
    })

    test('R-op-9 a folder gap of a dragged folder\'s own, or onto it, dissolves nothing', () => {
        const order = [f('F', ['x']), f('G', ['z'])]
        expect(foldersDissolvedBy(order, [fol('F'), fol('G')], folderGap(fol('G'), null))).toEqual([])
    })
})

//#region properties

const chaIds = ['a', 'b', 'c', 'd', 'e']
const dataArb = fc.array(
    fc.oneof({ weight: 8, arbitrary: fc.constantFrom(...chaIds) }, { weight: 1, arbitrary: fc.constant(7 as unknown as string) }),
    { maxLength: 3 },
)
const folderArb: fc.Arbitrary<OrderEntry> = fc.oneof(
    { weight: 8, arbitrary: fc.record({ id: fc.constantFrom('F', 'G'), name: fc.constant('n'), color: fc.constant(''), data: dataArb }, { requiredKeys: ['id', 'name', 'color', 'data'] }) },
    { weight: 1, arbitrary: fc.constant({ id: 'nd', name: 'n', color: '' } as unknown as folder) },
)
const entryArb: fc.Arbitrary<OrderEntry> = fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom(...chaIds) },
    { weight: 3, arbitrary: folderArb },
    { weight: 1, arbitrary: fc.constant(null) },
)
const orderArb = fc.array(entryArb, { minLength: 1, maxLength: 8 })

function isFolderEntry(entry: OrderEntry | undefined): entry is folder {
    return typeof entry === 'object' && entry !== null && Array.isArray(entry.data)
}

function topIndexOf(order: readonly OrderEntry[], ref: CharRef | FolderRef): number {
    let seen = 0
    for (let i = 0; i < order.length; i++) {
        const entry = order[i]
        const same = ref.kind === 'char' ? entry === ref.id : isFolderEntry(entry) && entry.id === ref.id
        if (same) {
            if (seen === ref.occurrence) {
                return i
            }
            seen++
        }
    }
    return -1
}

function memberIndexOf(data: readonly unknown[], ref: MemberRef): number {
    let seen = 0
    for (let i = 0; i < data.length; i++) {
        if (data[i] === ref.id) {
            if (seen === ref.occurrence) {
                return i
            }
            seen++
        }
    }
    return -1
}

/** Every ref that points at an entry of `order`, empty folders and folders without string members included. */
function refsOf(order: readonly OrderEntry[]): { tops: Array<CharRef | FolderRef>; members: MemberRef[]; all: ItemRef[] } {
    const tops: Array<CharRef | FolderRef> = []
    const members: MemberRef[] = []
    const charSeen = new Map<string, number>()
    const folderSeen = new Map<string, number>()
    for (const entry of order) {
        if (typeof entry === 'string') {
            const occurrence = charSeen.get(entry) ?? 0
            charSeen.set(entry, occurrence + 1)
            tops.push(char(entry, occurrence))
        } else if (isFolderEntry(entry)) {
            const occurrence = folderSeen.get(entry.id) ?? 0
            folderSeen.set(entry.id, occurrence + 1)
            const ref = fol(entry.id, occurrence)
            tops.push(ref)
            const memberSeen = new Map<string, number>()
            for (const id of entry.data) {
                if (typeof id === 'string') {
                    const memberOccurrence = memberSeen.get(id) ?? 0
                    memberSeen.set(id, memberOccurrence + 1)
                    members.push(mem(ref, id, memberOccurrence))
                }
            }
        }
    }
    return { tops, members, all: [...tops, ...members] }
}

function gapsOf(order: readonly OrderEntry[]): Gap[] {
    const { tops, members } = refsOf(order)
    const gaps: Gap[] = [topGap(null), ...tops.map((ref) => topGap(ref))]
    for (const ref of tops) {
        if (ref.kind === 'folder') {
            gaps.push(folderGap(ref, null))
            gaps.push(...members.filter((m) => m.folder.id === ref.id && m.folder.occurrence === ref.occurrence).map((m) => folderGap(ref, m)))
        }
    }
    return gaps
}

function strings(order: readonly OrderEntry[]): string[] {
    const out: string[] = []
    for (const entry of order) {
        if (typeof entry === 'string') {
            out.push(entry)
        } else if (isFolderEntry(entry)) {
            out.push(...entry.data.filter((id): id is string => typeof id === 'string'))
        }
    }
    return out.sort()
}

/** The entries that are neither a character nor a folder with a data array, and the non-string members, as JSON. */
function others(order: readonly OrderEntry[]): string[] {
    const out: string[] = []
    for (const entry of order) {
        if (entry === null || (typeof entry === 'object' && !Array.isArray(entry.data))) {
            out.push(JSON.stringify(entry))
        } else if (isFolderEntry(entry)) {
            out.push(...entry.data.filter((id) => typeof id !== 'string').map((id) => `member:${JSON.stringify(id)}`))
        }
    }
    return out.sort()
}

function folderCounts(order: readonly OrderEntry[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const entry of order) {
        if (isFolderEntry(entry)) {
            counts[entry.id] = (counts[entry.id] ?? 0) + 1
        }
    }
    return counts
}

type Kind = 'top' | 'folder' | 'merge'

/**
 * An independent prediction of which folders the operation removes, from the rule alone: a dragged
 * folder dissolved into a folder gap or a merge goes when it has a string member and no other entry;
 * a folder that lost members and holds nothing afterwards goes; the destination folder never goes.
 * `null` when the operation must return its input (an unresolved ref, a destination that is dragged).
 */
function predict(order: readonly OrderEntry[], sources: readonly ItemRef[], gap: Gap | null, kind: Kind): { dissolved: number[]; emptied: number[] } | null {
    const tops = new Set<number>()
    const members = new Map<number, Set<number>>()
    for (const ref of sources) {
        if (ref.kind === 'member') {
            const at = topIndexOf(order, ref.folder)
            const owner = order[at]
            if (at === -1 || !isFolderEntry(owner)) {
                return null
            }
            const m = memberIndexOf(owner.data, ref)
            if (m === -1) {
                return null
            }
            members.set(at, (members.get(at) ?? new Set<number>()).add(m))
        } else {
            const at = topIndexOf(order, ref)
            if (at === -1) {
                return null
            }
            tops.add(at)
        }
    }
    for (const owner of [...members.keys()]) {
        if (tops.has(owner)) {
            members.delete(owner)
        }
    }
    let target = -1
    if (gap && gap.in === 'folder') {
        target = topIndexOf(order, gap.folder)
        if (target === -1 || tops.has(target)) {
            return null
        }
        if (gap.after && memberIndexOf((order[target] as folder).data, gap.after) === -1) {
            return null
        }
    } else if (gap && gap.in === 'top' && gap.after && topIndexOf(order, gap.after) === -1) {
        return null
    }
    const dissolved: number[] = []
    if (kind !== 'top') {
        for (const at of tops) {
            const entry = order[at]
            if (isFolderEntry(entry) && entry.data.some((id) => typeof id === 'string') && entry.data.every((id) => typeof id === 'string')) {
                dissolved.push(at)
            }
        }
    }
    const emptied: number[] = []
    for (const [at, moved] of members) {
        const owner = order[at]
        if (at !== target && isFolderEntry(owner) && owner.data.length === moved.size) {
            emptied.push(at)
        }
    }
    return { dissolved, emptied }
}

function occurrenceOf(order: readonly OrderEntry[], at: number): string {
    const entry = order[at] as folder
    let occurrence = 0
    for (let i = 0; i < at; i++) {
        const before = order[i]
        if (isFolderEntry(before) && before.id === entry.id) {
            occurrence++
        }
    }
    return `${entry.id}#${occurrence}`
}

const pickAt = <T>(items: readonly T[], n: number): T => items[n % items.length]

describe('properties (random orders with duplicate ids, empty folders, non-string members and unknown entries)', () => {
    test('R-op-2 one source: moveManyToGap equals moveToGap by content for every gap, except a folder into a folder gap', () => {
        fc.assert(
            fc.property(orderArb, (order) => {
                const input = deepFreeze(structuredClone(order))
                const gaps = gapsOf(input)
                for (const source of refsOf(input).all) {
                    for (const gap of gaps) {
                        const old = moveToGap(input, source, gap)
                        const next = moveManyToGap(input, [source], gap)
                        if (source.kind === 'folder' && gap.in === 'folder') {
                            continue
                        }
                        expect(next).toEqual(old)
                        if (isEqual(next, input)) {
                            expect(next).toBe(input)
                        }
                    }
                }
            }),
            { numRuns: 600 },
        )
    })

    test('R-op-3 R-op-9 many sources: every string and every other entry survives, exactly the predicted folders go, the dissolved ones are reported', () => {
        fc.assert(
            fc.property(orderArb, fc.array(fc.nat(), { minLength: 1, maxLength: 4 }), (order, picks) => {
                const input = deepFreeze(structuredClone(order))
                const refs = refsOf(input).all
                if (refs.length === 0) {
                    return
                }
                const sources = picks.map((n) => pickAt(refs, n))
                for (const gap of gapsOf(input)) {
                    const expected = predict(input, sources, gap, gap.in === 'folder' ? 'folder' : 'top')
                    const next = moveManyToGap(input, sources, gap)
                    const reported = foldersDissolvedBy(input, sources, gap)
                    if (expected === null) {
                        expect(next).toBe(input)
                        continue
                    }
                    if (next === input) {
                        expect(reported).toEqual([])
                        continue
                    }
                    expect(strings(next)).toEqual(strings(input))
                    expect(others(next)).toEqual(others(input))
                    const gone = [...expected.dissolved, ...expected.emptied].map((at) => (input[at] as folder).id)
                    const before = folderCounts(input)
                    const after = folderCounts(next)
                    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
                        expect((before[id] ?? 0) - (after[id] ?? 0)).toBe(gone.filter((g) => g === id).length)
                    }
                    expect(reported.map((d) => `${d.ref.id}#${d.ref.occurrence}`)).toEqual(expected.dissolved.sort((l, r) => l - r).map((at) => occurrenceOf(input, at)))
                    for (const dissolved of reported) {
                        expect(input).toContain(dissolved.entry)
                    }
                }
            }),
            { numRuns: 1500 },
        )
    })

    test('R-op-5 placement: the folder holds the same characters as grouping the placement character with the sources and sits where that character was', () => {
        fc.assert(
            fc.property(orderArb, fc.array(fc.nat(), { maxLength: 3 }), fc.nat(), (order, picks, which) => {
                const input = deepFreeze(structuredClone(order))
                const { all, tops } = refsOf(input)
                const placements = tops.filter((ref): ref is CharRef => ref.kind === 'char')
                if (placements.length === 0 || all.length === 0) {
                    return
                }
                const placement = pickAt(placements, which)
                const sources = picks.map((n) => pickAt(all, n))
                const placed = groupIntoFolder(input, sources, NEW, placement)
                const p = topIndexOf(input, placement)
                const topSources = new Set(sources.filter((r): r is CharRef => r.kind === 'char').map((r) => topIndexOf(input, r)))
                const moved = new Map<number, Set<number>>()
                for (const ref of sources) {
                    if (ref.kind === 'member') {
                        const at = topIndexOf(input, ref.folder)
                        moved.set(at, (moved.get(at) ?? new Set<number>()).add(memberIndexOf((input[at] as folder).data, ref)))
                    } else if (ref.kind === 'folder') {
                        const at = topIndexOf(input, ref)
                        const owner = input[at] as folder
                        owner.data.forEach((id, m) => {
                            if (typeof id === 'string') {
                                moved.set(at, (moved.get(at) ?? new Set<number>()).add(m))
                            }
                        })
                    }
                }
                const contributes = topSources.size > 0 || [...moved.values()].some((set) => set.size > 0)
                if (topSources.has(p) || !contributes) {
                    expect(placed).toBe(input)
                    return
                }
                const viaGroup = groupIntoFolder(input, [placement, ...sources], NEW)
                const createdOf = (order2: readonly OrderEntry[]) => order2.find((e): e is folder => isFolderEntry(e) && e.id === NEW.id) as folder
                const created = createdOf(viaGroup)
                const rest = viaGroup.filter((e) => e !== created)
                // The survivors of the input, in order, are the entries that remain besides the new folder.
                const survivors: number[] = []
                for (let i = 0; i < input.length; i++) {
                    const gone = moved.get(i)
                    const owner = input[i]
                    if (i === p || topSources.has(i) || (gone && gone.size > 0 && isFolderEntry(owner) && gone.size === owner.data.length)) {
                        continue
                    }
                    survivors.push(i)
                }
                expect(survivors).toHaveLength(rest.length)
                const placedCreated = createdOf(placed)
                expect(placedCreated.data).toEqual(created.data)
                expect(placed.filter((e) => e !== placedCreated)).toEqual(rest)
                expect(placed.indexOf(placedCreated)).toBe(survivors.filter((i) => i < p).length)
                expect(strings(placed)).toEqual(strings(input))
                expect(others(placed)).toEqual(others(input))
            }),
            { numRuns: 1500 },
        )
    })

    test('R-op-9 a merge reports exactly the dragged folders it removes', () => {
        fc.assert(
            fc.property(orderArb, fc.array(fc.nat(), { minLength: 1, maxLength: 3 }), fc.nat(), (order, picks, which) => {
                const input = deepFreeze(structuredClone(order))
                const { all, tops } = refsOf(input)
                const placements = tops.filter((ref): ref is CharRef => ref.kind === 'char')
                if (placements.length === 0 || all.length === 0) {
                    return
                }
                const placement = pickAt(placements, which)
                const sources = picks.map((n) => pickAt(all, n))
                const next = groupIntoFolder(input, sources, NEW, placement)
                const reported = foldersDissolvedBy(input, sources, { in: 'merge', target: placement })
                if (next === input) {
                    expect(reported).toEqual([])
                    return
                }
                const expected = predict(input, sources, null, 'merge')
                expect(expected).not.toBeNull()
                expect(reported.map((d) => `${d.ref.id}#${d.ref.occurrence}`)).toEqual((expected?.dissolved ?? []).sort((l, r) => l - r).map((at) => occurrenceOf(input, at)))
            }),
            { numRuns: 1000 },
        )
    })
})

//#endregion
