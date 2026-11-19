// Duplicate groups of one asset array. Pure: the rows, the known sizes and the hashes Check bytes filled in are
// handed in; nothing is read or hashed here.
//
// Tier 0 needs no bytes: the same name (compared as a string) with a byte-identical path is one stored file. An equal
// stem or extension is only a hint, so `<h>.png` and `<h>.webp` stay apart until their hashes say otherwise. A pair
// of different names becomes a merge candidate only with an identical path or equal hashes; an equal size alone
// lists nothing. Grouping never leaves the array it is given.

import type { StoredSize } from './assetSizes'

export interface GroupRow {
    readonly name: string
    readonly path: string
    /** Position in the array the rows come from. */
    readonly index: number
    /** The folder of the row's name, or null/absent for "No folder". */
    readonly folder?: string | null
    /** How many places use the row's name. */
    readonly references?: number
}

export type DuplicateClass =
    /** Tier 0, or the same name with equal hashes. Removable. */
    | 'sameFile'
    /** The same name and the same known size, different paths, no confirming hash. Never removable. */
    | 'possibleDuplicate'
    /** The same name, different paths, and a size is not known for every file. */
    | 'sizeUnknown'
    /** Different names over one stored file or equal hashes. A merge candidate only. */
    | 'sameFileDifferentNames'
    /** The same name, different files: an info note, a variant pool. */
    | 'sameNameDifferentFile'
    | 'unreadable'

export interface DuplicateGroup<R extends GroupRow> {
    cls: DuplicateClass
    /** In array order. */
    rows: R[]
    /** Remove extras is offered: only a same-file group of an array that is not report-only. */
    removable: boolean
    /** Merge is offered: only a same-file-different-names group of an array that is not report-only. */
    mergeCandidate: boolean
    /** The array is reported but never changed (ccAssets). */
    reportOnly: boolean
    /** Set on a removable group: the row that stays. */
    survivor?: Survivor<R>
}

export interface GroupOptions {
    /** Path to size: a number (known), `null` (the store cannot say) or `undefined`/absent (not read). */
    sizes?: ReadonlyMap<string, StoredSize>
    /** Path to hash, as Check bytes fills it. */
    hashes?: ReadonlyMap<string, string>
    /** Paths whose bytes could not be read. */
    unreadable?: ReadonlySet<string>
    /** An array that is only reported: `ccAssets` and any array a merge or removal never touches. */
    reportOnly?: boolean
}

class UnionFind {
    private readonly parent: number[]

    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, i) => i)
    }

    find(i: number): number {
        let root = i
        while (this.parent[root] !== root) {
            root = this.parent[root]
        }
        let node = i
        while (this.parent[node] !== root) {
            const next = this.parent[node]
            this.parent[node] = root
            node = next
        }
        return root
    }

    union(a: number, b: number): void {
        const rootA = this.find(a)
        const rootB = this.find(b)
        if (rootA !== rootB) {
            this.parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB)
        }
    }

    /** The members of each set with at least two members, each in index order, sets in order of their first member. */
    sets(): number[][] {
        const byRoot = new Map<number, number[]>()
        for (let i = 0; i < this.parent.length; i++) {
            const root = this.find(i)
            const members = byRoot.get(root)
            if (members) {
                members.push(i)
            } else {
                byRoot.set(root, [i])
            }
        }
        return [...byRoot.values()].filter((members) => members.length >= 2)
    }
}

type Relation = 'differ' | 'possible' | 'unknown'

/**
 * Groups the rows of one array, in order of each group's first row. A row can appear in more than one group when
 * its relations differ: for example a same-name pair that is a possible duplicate of one file and provably unlike
 * another.
 */
export function groupDuplicates<R extends GroupRow>(rows: readonly R[], options: GroupOptions = {}): DuplicateGroup<R>[] {
    const reportOnly = options.reportOnly === true
    const sizeOf = (row: R): StoredSize => options.sizes?.get(row.path)
    const hashOf = (row: R): string | undefined => options.hashes?.get(row.path)
    const groups: { first: number, group: DuplicateGroup<R> }[] = []

    const emit = (cls: DuplicateClass, members: number[], pool: readonly R[]): DuplicateGroup<R> => {
        const picked = members.slice().sort((a, b) => a - b).map((i) => pool[i])
        const group: DuplicateGroup<R> = {
            cls,
            rows: picked,
            removable: cls === 'sameFile' && !reportOnly,
            mergeCandidate: cls === 'sameFileDifferentNames' && !reportOnly,
            reportOnly,
        }
        if (group.removable) {
            group.survivor = chooseSurvivor(picked)
        }
        groups.push({ first: picked[0].index, group })
        return group
    }

    // A row whose bytes could not be read is reported alone and takes no part in hash grouping. Tier 0 needs no
    // bytes, but an unreadable row has no hash to confirm anything else with, so it is set aside whole.
    const unreadableRows: number[] = []
    const live: number[] = []
    rows.forEach((row, i) => {
        if (options.unreadable?.has(row.path)) {
            unreadableRows.push(i)
        } else {
            live.push(i)
        }
    })
    if (unreadableRows.length > 0) {
        emit('unreadable', unreadableRows, rows)
    }

    const liveRows = live.map((i) => rows[i])
    const sameFile = new UnionFind(liveRows.length)
    const byName = new Map<string, number[]>()
    liveRows.forEach((row, i) => {
        const list = byName.get(row.name)
        if (list) {
            list.push(i)
        } else {
            byName.set(row.name, [i])
        }
    })

    // Same name: an identical path (tier 0) or equal hashes make one file.
    for (const members of byName.values()) {
        for (let a = 0; a < members.length; a++) {
            for (let b = a + 1; b < members.length; b++) {
                const rowA = liveRows[members[a]]
                const rowB = liveRows[members[b]]
                const hashA = hashOf(rowA)
                if (rowA.path === rowB.path || (hashA !== undefined && hashA === hashOf(rowB))) {
                    sameFile.union(members[a], members[b])
                }
            }
        }
    }
    for (const members of sameFile.sets()) {
        emit('sameFile', members, liveRows)
    }

    // Same name, files that are not one file: classify each pair of files by what is known about them.
    for (const members of byName.values()) {
        const files = new Map<number, number[]>()
        for (const i of members) {
            const root = sameFile.find(i)
            const list = files.get(root)
            if (list) {
                list.push(i)
            } else {
                files.set(root, [i])
            }
        }
        const fileList = [...files.values()]
        if (fileList.length < 2) {
            continue
        }
        const relate = (fileA: number[], fileB: number[]): Relation => {
            const hashedA = fileA.some((i) => hashOf(liveRows[i]) !== undefined)
            const hashedB = fileB.some((i) => hashOf(liveRows[i]) !== undefined)
            if (hashedA && hashedB) {
                return 'differ'
            }
            const sizesA = new Set(fileA.map((i) => sizeOf(liveRows[i])).filter((size): size is number => typeof size === 'number'))
            const sizesB = new Set(fileB.map((i) => sizeOf(liveRows[i])).filter((size): size is number => typeof size === 'number'))
            if (sizesA.size === 0 || sizesB.size === 0) {
                return 'unknown'
            }
            return [...sizesA].some((size) => sizesB.has(size)) ? 'possible' : 'differ'
        }
        const possible = new UnionFind(fileList.length)
        const unknown = new UnionFind(fileList.length)
        const differing = new Set<number>()
        for (let a = 0; a < fileList.length; a++) {
            for (let b = a + 1; b < fileList.length; b++) {
                const relation = relate(fileList[a], fileList[b])
                if (relation === 'possible') {
                    possible.union(a, b)
                } else if (relation === 'unknown') {
                    unknown.union(a, b)
                } else {
                    differing.add(a)
                    differing.add(b)
                }
            }
        }
        const rowsOfFiles = (fileIndexes: number[]) => fileIndexes.flatMap((f) => fileList[f])
        for (const fileIndexes of possible.sets()) {
            emit('possibleDuplicate', rowsOfFiles(fileIndexes), liveRows)
        }
        for (const fileIndexes of unknown.sets()) {
            emit('sizeUnknown', rowsOfFiles(fileIndexes), liveRows)
        }
        if (differing.size > 0) {
            emit('sameNameDifferentFile', rowsOfFiles([...differing]), liveRows)
        }
    }

    // Different names: an identical path (one stored file) or equal hashes. An equal size alone never lists a pair.
    const crossName = new UnionFind(liveRows.length)
    for (const members of sameFile.sets()) {
        for (const i of members.slice(1)) {
            crossName.union(members[0], i)
        }
    }
    let crossNameEdges = false
    for (let a = 0; a < liveRows.length; a++) {
        for (let b = a + 1; b < liveRows.length; b++) {
            const rowA = liveRows[a]
            const rowB = liveRows[b]
            if (rowA.name === rowB.name) {
                continue
            }
            const hashA = hashOf(rowA)
            if (rowA.path === rowB.path || (hashA !== undefined && hashA === hashOf(rowB))) {
                crossName.union(a, b)
                crossNameEdges = true
            }
        }
    }
    if (crossNameEdges) {
        for (const members of crossName.sets()) {
            if (new Set(members.map((i) => liveRows[i].name)).size >= 2) {
                emit('sameFileDifferentNames', members, liveRows)
            }
        }
    }

    return groups
        .map((entry, order) => ({ entry, order }))
        .sort((a, b) => a.entry.first - b.entry.first || a.order - b.order)
        .map(({ entry }) => entry.group)
}

export type SurvivorCase = 'folder' | 'references' | 'first'

export interface Survivor<R extends GroupRow> {
    row: R
    /** Which rule chose it, for the toast. */
    reason: SurvivorCase
}

/**
 * The row that stays when extras of a same-file group are removed: the first row that is in a folder, else the one
 * whose name is used in the most places, else the first. `references` decides only when the counts differ.
 */
export function chooseSurvivor<R extends GroupRow>(rows: readonly R[]): Survivor<R> {
    const inFolder = rows.find((row) => row.folder !== undefined && row.folder !== null)
    if (inFolder) {
        return { row: inFolder, reason: 'folder' }
    }
    const counts = rows.map((row) => row.references ?? 0)
    const most = Math.max(...counts)
    if (most > Math.min(...counts)) {
        return { row: rows[counts.indexOf(most)], reason: 'references' }
    }
    return { row: rows[0], reason: 'first' }
}

export interface NameChoice {
    name: string
    references: number
}

/**
 * The name a merge keeps by default: for emotions `neutral` when it is among them, otherwise the name used in the
 * most places, the first on a tie. Returns the index into `names`.
 */
export function preselectKeptName(names: readonly NameChoice[], kind: 'asset' | 'emotion'): number {
    if (kind === 'emotion') {
        // The default emotion is read by its exact name, so the exact `neutral` outranks a spelling that differs by case.
        const exact = names.findIndex((choice) => choice.name === 'neutral')
        const neutral = exact >= 0 ? exact : names.findIndex((choice) => choice.name.toLocaleLowerCase() === 'neutral')
        if (neutral >= 0) {
            return neutral
        }
    }
    let best = 0
    names.forEach((choice, i) => {
        if (choice.references > names[best].references) {
            best = i
        }
    })
    return best
}
