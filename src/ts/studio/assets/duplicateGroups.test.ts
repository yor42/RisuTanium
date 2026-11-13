import { describe, expect, test } from 'vitest'
import type { StoredSize } from './assetSizes'
import { chooseSurvivor, groupDuplicates, preselectKeptName, type DuplicateClass, type DuplicateGroup, type GroupRow } from './duplicateGroups'
import { groupRow, hashPath } from './assetFixtures.test-helpers'

function classesOf(groups: DuplicateGroup<GroupRow>[]): DuplicateClass[] {
    return groups.map((group) => group.cls)
}

function sizesOf(entries: [string, StoredSize][]): Map<string, StoredSize> {
    return new Map(entries)
}

describe('tier 0: the same name and a byte-identical path', () => {
    test('the same name over an identical path is Same file and removable, with no sizes or hashes', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/a.png', 1)]
        const groups = groupDuplicates(rows)
        expect(classesOf(groups)).toEqual(['sameFile'])
        expect(groups[0].removable).toBe(true)
        expect(groups[0].mergeCandidate).toBe(false)
        expect(groups[0].rows).toEqual(rows)
    })

    test('an equal stem is only a hint: <h>.png and <h>.webp of one name are not tier 0', () => {
        const rows = [groupRow('smile', hashPath('a', 'png'), 0), groupRow('smile', hashPath('a', 'webp'), 1)]
        const groups = groupDuplicates(rows)
        expect(groups.some((group) => group.cls === 'sameFile')).toBe(false)
        expect(groups.some((group) => group.removable)).toBe(false)
    })

    test('paths are compared byte for byte: <h>.png and <h>.PNG are different files until hashed', () => {
        const rows = [groupRow('smile', hashPath('a', 'png'), 0), groupRow('smile', hashPath('a', 'PNG'), 1)]
        const groups = groupDuplicates(rows)
        expect(groups.some((group) => group.removable)).toBe(false)
        expect(classesOf(groups)).toEqual(['sizeUnknown'])
    })

    test('names are compared as strings: Smile and smile over one path are different names, not tier 0', () => {
        const rows = [groupRow('Smile', 'assets/a.png', 0), groupRow('smile', 'assets/a.png', 1)]
        const groups = groupDuplicates(rows)
        expect(classesOf(groups)).toEqual(['sameFileDifferentNames'])
        expect(groups[0].removable).toBe(false)
        expect(groups[0].mergeCandidate).toBe(true)
    })

    test('a hash path equal in stem but a different file name is no confirmation even with equal sizes', () => {
        const rows = [groupRow('smile', hashPath('a', 'png'), 0), groupRow('smile', hashPath('a', 'webp'), 1)]
        const groups = groupDuplicates(rows, { sizes: sizesOf([[rows[0].path, 10], [rows[1].path, 10]]) })
        expect(classesOf(groups)).toEqual(['possibleDuplicate'])
        expect(groups[0].removable).toBe(false)
    })
})

describe('same name, different paths', () => {
    test('equal known sizes and no hash: Possible duplicate, never removable', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/b.png', 1)]
        const groups = groupDuplicates(rows, { sizes: sizesOf([['assets/a.png', 10], ['assets/b.png', 10]]) })
        expect(classesOf(groups)).toEqual(['possibleDuplicate'])
        expect(groups[0].removable).toBe(false)
    })

    test('the same name and size over different paths is not removable by name and size alone', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/b.png', 1)]
        const groups = groupDuplicates(rows, { sizes: sizesOf([['assets/a.png', 10], ['assets/b.png', 10]]) })
        expect(groups.every((group) => group.removable === false)).toBe(true)
    })

    test('a size that is not known for a file is Size unknown', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/b.png', 1)]
        const unknown = groupDuplicates(rows, { sizes: sizesOf([['assets/a.png', 10], ['assets/b.png', null]]) })
        expect(classesOf(unknown)).toEqual(['sizeUnknown'])
        const pending = groupDuplicates(rows)
        expect(classesOf(pending)).toEqual(['sizeUnknown'])
    })

    test('equal hashes make the same file whatever the paths: removable', () => {
        const rows = [groupRow('smile', hashPath('a', 'png'), 0), groupRow('smile', hashPath('a', 'webp'), 1)]
        const hashes = new Map([[rows[0].path, 'h1'], [rows[1].path, 'h1']])
        const groups = groupDuplicates(rows, { hashes })
        expect(classesOf(groups)).toEqual(['sameFile'])
        expect(groups[0].removable).toBe(true)
    })

    test('upper and lower case extension with equal hashes is the same file', () => {
        const rows = [groupRow('smile', hashPath('a', 'png'), 0), groupRow('smile', hashPath('a', 'PNG'), 1)]
        const hashes = new Map([[rows[0].path, 'h1'], [rows[1].path, 'h1']])
        expect(classesOf(groupDuplicates(rows, { hashes }))).toEqual(['sameFile'])
    })

    test('two different hashes: Same name, different file, an info note and not removable', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/b.png', 1)]
        const hashes = new Map([[rows[0].path, 'h1'], [rows[1].path, 'h2']])
        const groups = groupDuplicates(rows, { hashes })
        expect(classesOf(groups)).toEqual(['sameNameDifferentFile'])
        expect(groups[0].removable).toBe(false)
        expect(groups[0].mergeCandidate).toBe(false)
    })

    test('different known sizes prove the files differ', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/b.png', 1)]
        const groups = groupDuplicates(rows, { sizes: sizesOf([['assets/a.png', 10], ['assets/b.png', 11]]) })
        expect(classesOf(groups)).toEqual(['sameNameDifferentFile'])
    })

    test('three rows: two same-file rows plus a third file keep the same-file group removable', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/a.png', 1), groupRow('smile', 'assets/c.png', 2)]
        const hashes = new Map([['assets/a.png', 'h1'], ['assets/c.png', 'h2']])
        const groups = groupDuplicates(rows, { hashes })
        expect(classesOf(groups)).toEqual(['sameFile', 'sameNameDifferentFile'])
        expect(groups[0].rows.map((row) => row.index)).toEqual([0, 1])
    })
})

describe('different names', () => {
    test('different paths and an equal hash: Same file, different names, a merge candidate only', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('grin', 'assets/b.png', 1)]
        const hashes = new Map([['assets/a.png', 'h1'], ['assets/b.png', 'h1']])
        const groups = groupDuplicates(rows, { hashes })
        expect(classesOf(groups)).toEqual(['sameFileDifferentNames'])
        expect(groups[0].removable).toBe(false)
        expect(groups[0].mergeCandidate).toBe(true)
    })

    test('an equal size and a different hash lists nothing', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('grin', 'assets/b.png', 1)]
        const groups = groupDuplicates(rows, {
            sizes: sizesOf([['assets/a.png', 10], ['assets/b.png', 10]]),
            hashes: new Map([['assets/a.png', 'h1'], ['assets/b.png', 'h2']]),
        })
        expect(groups).toEqual([])
    })

    test('an equal size with no hash lists nothing', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('grin', 'assets/b.png', 1)]
        const groups = groupDuplicates(rows, { sizes: sizesOf([['assets/a.png', 10], ['assets/b.png', 10]]) })
        expect(groups).toEqual([])
    })

    test('smile.png and smile over one path are listed at once, with no hash', () => {
        const rows = [groupRow('smile.png', 'assets/a.png', 0), groupRow('smile', 'assets/a.png', 1)]
        const groups = groupDuplicates(rows)
        expect(classesOf(groups)).toEqual(['sameFileDifferentNames'])
        expect(groups[0].mergeCandidate).toBe(true)
    })

    test('a name group of two rows plus a different name over one of their paths is one candidate group', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/a.png', 1), groupRow('grin', 'assets/a.png', 2)]
        const groups = groupDuplicates(rows)
        expect(classesOf(groups)).toEqual(['sameFile', 'sameFileDifferentNames'])
        expect(groups[1].rows).toHaveLength(3)
    })
})

describe('arrays and unreadable rows', () => {
    test('the same bytes in two arrays form no group: each array is grouped alone', () => {
        const additional = [groupRow('smile', 'assets/a.png', 0)]
        const cc = [groupRow('smile2', 'assets/b.png', 0)]
        const hashes = new Map([['assets/a.png', 'h1'], ['assets/b.png', 'h1']])
        expect(groupDuplicates(additional, { hashes })).toEqual([])
        expect(groupDuplicates(cc, { hashes, reportOnly: true })).toEqual([])
    })

    test('a report-only array is reported but never removable or mergeable', () => {
        const rows = [groupRow('a', 'assets/a.png', 0), groupRow('a', 'assets/a.png', 1), groupRow('b', 'assets/a.png', 2)]
        const groups = groupDuplicates(rows, { reportOnly: true })
        expect(groups.length).toBeGreaterThan(0)
        for (const group of groups) {
            expect(group.reportOnly).toBe(true)
            expect(group.removable).toBe(false)
            expect(group.mergeCandidate).toBe(false)
        }
    })

    test('an unreadable row is reported alone and takes no part in hash grouping', () => {
        const rows = [groupRow('smile', 'assets/a.png', 0), groupRow('smile', 'assets/b.png', 1)]
        const groups = groupDuplicates(rows, {
            hashes: new Map([['assets/a.png', 'h1']]),
            unreadable: new Set(['assets/b.png']),
        })
        expect(classesOf(groups)).toEqual(['unreadable'])
        expect(groups[0].rows).toEqual([rows[1]])
    })

    test('groups come in order of their first row', () => {
        const rows = [
            groupRow('b', 'assets/b.png', 0), groupRow('b', 'assets/b.png', 1),
            groupRow('a', 'assets/a.png', 2), groupRow('a', 'assets/a.png', 3),
        ]
        const groups = groupDuplicates(rows)
        expect(groups.map((group) => group.rows[0].name)).toEqual(['b', 'a'])
    })
})

describe('survivor of remove extras', () => {
    test('the row in a folder stays, and the result says folder', () => {
        const rows = [groupRow('a', 'p', 0, { references: 5 }), groupRow('a', 'p', 1, { folder: 'Faces', references: 1 })]
        const survivor = chooseSurvivor(rows)
        expect(survivor.row).toBe(rows[1])
        expect(survivor.reason).toBe('folder')
    })

    test('with no folder the row whose name has the most references stays', () => {
        const rows = [groupRow('a', 'p', 0, { references: 1 }), groupRow('a', 'p', 1, { references: 4 })]
        const survivor = chooseSurvivor(rows)
        expect(survivor.row).toBe(rows[1])
        expect(survivor.reason).toBe('references')
    })

    test('with neither the first row stays and the result says first', () => {
        const rows = [groupRow('a', 'p', 0), groupRow('a', 'p', 1)]
        expect(chooseSurvivor(rows)).toEqual({ row: rows[0], reason: 'first' })
        const tied = [groupRow('a', 'p', 0, { references: 2 }), groupRow('a', 'p', 1, { references: 2 })]
        expect(chooseSurvivor(tied).reason).toBe('first')
    })

    test('the folder rule wins over the references rule, and the references rule over the first', () => {
        const rows = [groupRow('a', 'p', 0, { references: 9 }), groupRow('a', 'p', 1, { folder: 'F' }), groupRow('a', 'p', 2, { folder: 'G' })]
        expect(chooseSurvivor(rows).row).toBe(rows[1])
    })

    test('a removable group carries its survivor', () => {
        const rows = [groupRow('a', 'p', 0), groupRow('a', 'p', 1, { references: 3 })]
        const groups = groupDuplicates(rows)
        expect(groups[0].survivor?.row).toBe(rows[1])
        expect(groups[0].survivor?.reason).toBe('references')
    })
})

describe('kept-name preselection for merge', () => {
    test('the name with more references is preselected, the first on a tie', () => {
        expect(preselectKeptName([{ name: 'a', references: 1 }, { name: 'b', references: 3 }], 'asset')).toBe(1)
        expect(preselectKeptName([{ name: 'a', references: 2 }, { name: 'b', references: 2 }], 'asset')).toBe(0)
    })

    test('for emotions neutral wins whatever the references', () => {
        const names = [{ name: 'happy', references: 9 }, { name: 'Neutral', references: 0 }]
        expect(preselectKeptName(names, 'emotion')).toBe(1)
        expect(preselectKeptName(names, 'asset')).toBe(0)
    })
})
