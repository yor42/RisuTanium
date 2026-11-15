import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    applyFolderOp,
    applyFolderOps,
    assetPoolKey,
    carryFolderOnRename,
    createFolder,
    deleteFolder,
    dropFolderEntries,
    folderNameKey,
    folderOf,
    folderOpAtTarget,
    invertFolderOp,
    moveManyToFolder,
    moveToFolder,
    readFolderDoc,
    renameFolder,
    reorderFolders,
    setFolderEntries,
    type AssetFolderDoc,
    type FolderOp,
    type FolderWriteResult,
} from './folderCodec'
import { OWNER_CAP_BYTES } from '../history/studioHistoryStore'

function docOf(order: string[], of: [string, string][]): AssetFolderDoc {
    return { v: 1, additional: { order, of } }
}

function opsOf(result: FolderWriteResult): FolderOp[] {
    if ('reason' in result) {
        throw new Error('refused: ' + result.reason)
    }
    return result.ops
}

function appliedOf(stored: unknown, ops: readonly FolderOp[]): AssetFolderDoc | null {
    const result = applyFolderOps(stored, ops)
    if ('index' in result) {
        throw new Error('op ' + result.index + ' did not apply')
    }
    return result.doc
}

function undoneOf(applied: AssetFolderDoc | null, ops: readonly FolderOp[]): AssetFolderDoc | null {
    return appliedOf(applied, ops.map(invertFolderOp).reverse())
}

/** What a reader sees of a stored value: the listed folders and the entries that show in one. */
function viewOfStored(stored: unknown): AssetFolderDoc {
    return readFolderDoc(stored).doc
}

/** The view with its entries sorted: an undone entry may sit at the end of `of`, which reads the same. */
function readEqualView(stored: unknown): AssetFolderDoc {
    const view = viewOfStored(stored)
    return docOf(view.additional.order, view.additional.of.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))
}

/**
 * The guarantees every rule gives: entry-level ops only, at most one set per fold key and one order op, no op whose
 * `before` equals its `after`, ops that apply in order, and inverses in reverse that restore a read-equal value.
 */
function expectComposed(stored: unknown, ops: readonly FolderOp[]): { applied: AssetFolderDoc | null, undone: AssetFolderDoc | null } {
    const seenKeys = new Set<string>()
    let orderOps = 0
    for (const op of ops) {
        if (op.kind === 'assetFolderSet') {
            expect(Object.keys(op).sort()).toEqual(['after', 'before', 'kind', 'name'])
            const key = assetPoolKey(op.name)
            expect(seenKeys.has(key), 'two sets for ' + key).toBe(false)
            seenKeys.add(key)
            expect(op.before).not.toEqual(op.after)
        } else {
            expect(Object.keys(op).sort()).toEqual(['after', 'before', 'kind'])
            expect(Array.isArray(op.before) && Array.isArray(op.after)).toBe(true)
            orderOps += 1
            expect(op.before).not.toEqual(op.after)
        }
    }
    expect(orderOps).toBeLessThanOrEqual(1)
    ops.forEach((op, i) => {
        if (op.kind === 'assetFolderOrder') {
            expect(i, 'the order op comes last').toBe(ops.length - 1)
        }
    })
    const applied = appliedOf(stored, ops)
    const undone = undoneOf(applied, ops)
    expect(readEqualView(undone)).toEqual(readEqualView(stored))
    return { applied, undone }
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('readFolderDoc', () => {
    test('absent and null read as no folders and say so', () => {
        expect(readFolderDoc(undefined).state).toBe('absent')
        expect(readFolderDoc(null).state).toBe('absent')
        expect(readFolderDoc(undefined).doc).toEqual(docOf([], []))
    })

    test('a v1 document reads with the stored name as written; of two entries that fold alike the first wins', () => {
        const read = readFolderDoc(docOf(['Faces'], [['SMILE', 'Faces'], ['smile', 'Other']]))
        expect(read.state).toBe('ok')
        expect(read.doc.additional.of).toEqual([['SMILE', 'Faces']])
        expect(folderOf(read.doc, 'Smile')).toBe('Faces')
    })

    test('an unknown version, a bad shape and an unknown key all read as unreadable', () => {
        const samples: unknown[] = [
            { v: 2, additional: { order: [], of: [] } },
            { v: 1, additional: { order: 'x', of: [] } },
            { v: 1, additional: { order: [], of: [['only-one']] } },
            { v: 1, additional: { order: [], of: [], emotion: {} } },
            { v: 1, additional: { order: [], of: [] }, extra: true },
            'text',
            [],
            { v: 1 },
        ]
        for (const sample of samples) {
            const read = readFolderDoc(sample)
            expect(read.state).toBe('unreadable')
            expect(read.doc).toEqual(docOf([], []))
        }
    })

    test('a name such as __proto__ is an ordinary entry', () => {
        const read = readFolderDoc(docOf(['F'], [['__proto__', 'F']]))
        expect(read.state).toBe('ok')
        expect(folderOf(read.doc, '__proto__')).toBe('F')
        expect(folderOf(read.doc, 'constructor')).toBeNull()
    })

    test('the read does not change the stored value', () => {
        const stored = docOf([' F ', 'f'], [['A', ' F '], ['a', 'G']])
        const snapshot = JSON.stringify(stored)
        readFolderDoc(stored)
        expect(JSON.stringify(stored)).toBe(snapshot)
    })
})

describe('the reader establishes the writer invariants', () => {
    test('two folders that fold alike are one folder: the first is listed, and an entry of the other shows in it', () => {
        const stored = docOf(['Faces', 'FACES'], [['a', 'FACES']])
        const read = readFolderDoc(stored)
        expect(read.doc.additional.order).toEqual(['Faces'])
        expect(folderOf(read.doc, 'a')).toBe('Faces')
        expect(opsOf(reorderFolders(stored, ['Faces']))).toEqual([{ kind: 'assetFolderOrder', before: ['Faces', 'FACES'], after: ['Faces'] }])
        const renamed = opsOf(renameFolder(stored, 'faces', 'Looks'))
        expect(renamed).toEqual([
            { kind: 'assetFolderSet', name: 'a', before: { had: true, value: 'FACES' }, after: { had: true, value: 'Looks' } },
            { kind: 'assetFolderOrder', before: ['Faces', 'FACES'], after: ['Looks'] },
        ])
        expect(viewOfStored(appliedOf(stored, renamed))).toEqual(docOf(['Looks'], [['a', 'Looks']]))
        const padded = docOf(['F'], [['smile', ' f ']])
        const deleted = opsOf(deleteFolder(padded, 'F'))
        expect(deleted).toEqual([
            { kind: 'assetFolderSet', name: 'smile', before: { had: true, value: ' f ' }, after: { had: false } },
            { kind: 'assetFolderOrder', before: ['F'], after: [] },
        ])
        expect(viewOfStored(appliedOf(padded, deleted))).toEqual(docOf([], []))
    })

    test('a repeated folder is listed once, and a delete acts on the one folder', () => {
        const stored = docOf(['F', 'F', 'G'], [['a', 'F']])
        expect(readFolderDoc(stored).doc.additional.order).toEqual(['F', 'G'])
        const ops = opsOf(deleteFolder(stored, 'F'))
        expect(ops).toEqual([
            { kind: 'assetFolderSet', name: 'a', before: { had: true, value: 'F' }, after: { had: false } },
            { kind: 'assetFolderOrder', before: ['F', 'F', 'G'], after: ['G'] },
        ])
        expect(viewOfStored(appliedOf(stored, ops))).toEqual(docOf(['G'], []))
    })

    test('an entry whose folder is not listed shows in No folder and can be moved into a listed folder', () => {
        const stored = docOf(['F'], [['ghost', 'Nowhere'], ['real', 'F']])
        const read = readFolderDoc(stored)
        expect(folderOf(read.doc, 'ghost')).toBeNull()
        expect(read.doc.additional.of).toEqual([['real', 'F']])
        const ops = opsOf(moveToFolder(stored, 'GHOST', 'F'))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'ghost', before: { had: true, value: 'Nowhere' }, after: { had: true, value: 'F' } }])
        expect(folderOf(viewOfStored(appliedOf(stored, ops)), 'ghost')).toBe('F')
    })

    test('an empty name, a padded name and No Folder in the order are listed trimmed, or not at all', () => {
        const stored = docOf(['', '  F ', 'No Folder', 'no folder', 'F', 'G'], [['a', 'F'], ['b', 'No Folder']])
        const read = readFolderDoc(stored)
        expect(read.doc.additional.order).toEqual(['F', 'G'])
        expect(folderOf(read.doc, 'a')).toBe('F')
        expect(folderOf(read.doc, 'b')).toBeNull()
        expect(opsOf(reorderFolders(stored, ['G', 'F']))).toEqual([{ kind: 'assetFolderOrder', before: ['', '  F ', 'No Folder', 'no folder', 'F', 'G'], after: ['G', 'F'] }])
        expect(reorderFolders(stored, ['G'])).toEqual({ ok: false, reason: 'unknownFolder' })
    })

    test('a reorder accepts exactly the listed folders, each once', () => {
        const stored = docOf(['F', 'f', 'G'], [])
        expect(reorderFolders(stored, ['G', 'F'])).toEqual({ ok: true, ops: [{ kind: 'assetFolderOrder', before: ['F', 'f', 'G'], after: ['G', 'F'] }] })
        expect(reorderFolders(stored, ['G', 'F', 'f'])).toEqual({ ok: false, reason: 'unknownFolder' })
        expect(reorderFolders(stored, ['F', 'F'])).toEqual({ ok: false, reason: 'unknownFolder' })
    })
})

describe('names are stored as written and folded at read time', () => {
    test('a move stores the row name as written, and the engine fold finds it from any case', () => {
        const base = docOf(['F'], [])
        const ops = opsOf(moveToFolder(base, 'Image1', 'F'))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'Image1', before: { had: false }, after: { had: true, value: 'F' } }])
        const stored = appliedOf(base, ops)
        expect(stored?.additional.of).toEqual([['Image1', 'F']])
        const stale = docOf(['F'], [['IMAGE1', 'F']])
        expect(folderOf(readFolderDoc(stale).doc, 'image1')).toBe('F')
        expect(folderOf(readFolderDoc(stale).doc, 'Image1')).toBe('F')
    })

    test('a stored name that folds alike is kept when a row of another case is moved', () => {
        const stored = docOf(['F', 'G'], [['Image1', 'F']])
        const ops = opsOf(moveToFolder(stored, 'image1', 'G'))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'Image1', before: { had: true, value: 'F' }, after: { had: true, value: 'G' } }])
        expect(appliedOf(stored, ops)?.additional.of).toEqual([['Image1', 'G']])
    })

    test('the fold of an entry and of a lookup are the same under a locale that maps I differently', () => {
        const base = docOf(['F'], [])
        const written = appliedOf(base, opsOf(moveToFolder(base, 'IMAGE1', 'F')))
        expect(written?.additional.of).toEqual([['IMAGE1', 'F']])
        vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string): string {
            return this.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase()
        })
        expect(folderOf(readFolderDoc(written).doc, 'IMAGE1')).toBe('F')
        expect(folderOf(readFolderDoc(written).doc, 'image1')).toBeNull()
    })

    test('folder names are compared without a locale, so INFO and info clash under any mapping', () => {
        vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string): string {
            return this.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase()
        })
        expect(folderNameKey('INFO')).toBe(folderNameKey('info'))
        expect(createFolder(docOf(['INFO'], []), 'info')).toEqual({ ok: false, reason: 'nameTaken' })
        expect(renameFolder(docOf(['INFO', 'Other'], []), 'Other', 'info')).toEqual({ ok: false, reason: 'nameTaken' })
    })
})

describe('the entry-level ops and their composition', () => {
    test('arm (i): shadowed entries get no op of their own; the forward rule clears them', () => {
        const stored = docOf(['F'], [['IMAGE1', 'F'], ['image1', 'F']])
        const ops = opsOf(deleteFolder(stored, 'F'))
        expect(ops).toEqual([
            { kind: 'assetFolderSet', name: 'IMAGE1', before: { had: true, value: 'F' }, after: { had: false } },
            { kind: 'assetFolderOrder', before: ['F'], after: [] },
        ])
        const { applied, undone } = expectComposed(stored, ops)
        expect(applied).toBeNull()
        expect(undone).toEqual(docOf(['F'], [['IMAGE1', 'F']]))
    })

    test('arm (ii): deleting the folder of a shadowed entry changes only the order; deleting the other clears both', () => {
        const stored = docOf(['F', 'G'], [['IMAGE1', 'F'], ['image1', 'G']])
        const deleteG = opsOf(deleteFolder(stored, 'G'))
        expect(deleteG).toEqual([{ kind: 'assetFolderOrder', before: ['F', 'G'], after: ['F'] }])
        expect(folderOf(viewOfStored(expectComposed(stored, deleteG).applied), 'image1')).toBe('F')

        const deleteF = opsOf(deleteFolder(stored, 'F'))
        expect(deleteF).toEqual([
            { kind: 'assetFolderSet', name: 'IMAGE1', before: { had: true, value: 'F' }, after: { had: false } },
            { kind: 'assetFolderOrder', before: ['F', 'G'], after: ['G'] },
        ])
        const { applied } = expectComposed(stored, deleteF)
        expect(applied).toEqual(docOf(['G'], []))
        expect(folderOf(viewOfStored(applied), 'image1')).toBeNull()
    })

    test('arm (iii): a rename gives one entry op for the view entry and one order op', () => {
        const stored = docOf(['F', 'G'], [['IMAGE1', 'F'], ['image1', 'G']])
        const ops = opsOf(renameFolder(stored, 'F', 'F2'))
        expect(ops).toEqual([
            { kind: 'assetFolderSet', name: 'IMAGE1', before: { had: true, value: 'F' }, after: { had: true, value: 'F2' } },
            { kind: 'assetFolderOrder', before: ['F', 'G'], after: ['F2', 'G'] },
        ])
        expect(expectComposed(stored, ops).applied).toEqual(docOf(['F2', 'G'], [['IMAGE1', 'F2']]))
    })

    test('arm (iv): a move of the row that folds alike is one op, named by the stored name', () => {
        const stored = docOf(['F', 'G'], [['IMAGE1', 'F'], ['image1', 'G']])
        const ops = opsOf(moveToFolder(stored, 'image1', 'G'))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'IMAGE1', before: { had: true, value: 'F' }, after: { had: true, value: 'G' } }])
        expect(expectComposed(stored, ops).applied).toEqual(docOf(['F', 'G'], [['IMAGE1', 'G']]))
    })

    test('arm (v): names that fold alike drop one entry once', () => {
        const stored = docOf(['F'], [['Grin', 'F']])
        const ops = opsOf(dropFolderEntries(stored, [{ name: 'Grin', rowsLeft: 0 }, { name: 'GRIN', rowsLeft: 0 }]))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'Grin', before: { had: true, value: 'F' }, after: { had: false } }])
        expectComposed(stored, ops)
    })

    test('arm (vi): a rename carry and the drop of the old name are two ops over distinct keys', () => {
        const stored = docOf(['F', 'G'], [['Grin', 'F'], ['GRIN', 'G']])
        const ops = opsOf(carryFolderOnRename(stored, 'grin', 'smile', 0))
        expect(ops).toEqual([
            { kind: 'assetFolderSet', name: 'smile', before: { had: false }, after: { had: true, value: 'F' } },
            { kind: 'assetFolderSet', name: 'Grin', before: { had: true, value: 'F' }, after: { had: false } },
        ])
        expect(expectComposed(stored, ops).applied).toEqual(docOf(['F', 'G'], [['smile', 'F']]))
    })

    test('arm (vii): a bulk move makes one op per fold key', () => {
        const stored = docOf(['F', 'G'], [['Grin', 'F'], ['GRIN', 'G']])
        const ops = opsOf(moveManyToFolder(stored, ['Grin', 'GRIN', 'smile'], 'G'))
        expect(ops).toEqual([
            { kind: 'assetFolderSet', name: 'Grin', before: { had: true, value: 'F' }, after: { had: true, value: 'G' } },
            { kind: 'assetFolderSet', name: 'smile', before: { had: false }, after: { had: true, value: 'G' } },
        ])
        expectComposed(stored, ops)
    })

    test('every rule composes on an absent value and on a one-entry value, and undo is byte-equal there', () => {
        const single = docOf(['F', 'G'], [['smile', 'F']])
        const steps: [unknown, FolderWriteResult][] = [
            [undefined, createFolder(undefined, 'F')],
            [single, createFolder(single, 'H')],
            [single, renameFolder(single, 'F', 'F2')],
            [single, deleteFolder(single, 'F')],
            [single, reorderFolders(single, ['G', 'F'])],
            [single, moveToFolder(single, 'smile', 'G')],
            [single, moveToFolder(single, 'smile', null)],
            [single, moveManyToFolder(single, ['smile', 'grin'], 'G')],
            [single, carryFolderOnRename(single, 'smile', 'grin', 0)],
            [single, dropFolderEntries(single, [{ name: 'smile', rowsLeft: 0 }])],
        ]
        for (const [stored, result] of steps) {
            const ops = opsOf(result)
            expect(ops.length).toBeGreaterThan(0)
            const { undone } = expectComposed(stored, ops)
            expect(undone).toEqual(stored === undefined ? null : stored)
        }
    })

    test('a create on an absent value and its undo leave nothing stored', () => {
        const ops = opsOf(createFolder(undefined, 'F'))
        expect(ops).toEqual([{ kind: 'assetFolderOrder', before: [], after: ['F'] }])
        expect(expectComposed(undefined, ops).applied).toEqual(docOf(['F'], []))
    })

    test('a second intent for a key replaces the after of the first and keeps its before', () => {
        const stored = docOf(['F', 'G'], [['smile', 'F']])
        const ops = opsOf(setFolderEntries(stored, [{ name: 'smile', folder: 'G' }, { name: 'SMILE', folder: 'F' }, { name: 'other', folder: 'F' }, { name: 'other', folder: null }]))
        expect(ops).toEqual([])
        const moved = opsOf(setFolderEntries(stored, [{ name: 'SMILE', folder: 'G' }, { name: 'smile', folder: null }]))
        expect(moved).toEqual([{ kind: 'assetFolderSet', name: 'smile', before: { had: true, value: 'F' }, after: { had: false } }])
    })
})

describe('the size of a step grows linearly with the names it touches', () => {
    function folderedNames(count: number): { stored: AssetFolderDoc, names: string[] } {
        const order = Array.from({ length: 10 }, (_, i) => 'Folder ' + i)
        const names = Array.from({ length: count }, (_, i) => 'asset-' + String(i).padStart(5, '0'))
        return { stored: docOf(order, names.map((name, i): [string, string] => [name, order[i % 10]])), names }
    }

    const sizeOfOps = (ops: readonly FolderOp[]) => JSON.stringify(ops).length

    test('dropping every entry: doubling the names at most doubles the bytes, plus a small margin', () => {
        const sizes = [1000, 2000].map((count) => {
            const { stored, names } = folderedNames(count)
            return sizeOfOps(opsOf(dropFolderEntries(stored, names.map((name) => ({ name, rowsLeft: 0 })))))
        })
        expect(sizes[1] / sizes[0]).toBeLessThanOrEqual(2.2)
    })

    test('moving every name to one folder: doubling the names at most doubles the bytes, plus a small margin', () => {
        const sizes = [1000, 2000].map((count) => {
            const { stored, names } = folderedNames(count)
            return sizeOfOps(opsOf(moveManyToFolder(stored, names, 'Folder 9')))
        })
        expect(sizes[1] / sizes[0]).toBeLessThanOrEqual(2.2)
    })

    test('the 300-name delete fits twice in an eighth of the history owner cap', () => {
        const { stored, names } = folderedNames(300)
        const length = sizeOfOps(opsOf(dropFolderEntries(stored, names.map((name) => ({ name, rowsLeft: 0 })))))
        expect(2 * length + 144).toBeLessThan(OWNER_CAP_BYTES / 8)
    })
})

describe('an unreadable document is never changed', () => {
    const unreadable = { v: 9, x: 1 }
    const snapshot = JSON.stringify(unreadable)

    test('an explicit folder action is refused as a newer version and the stored value is untouched', () => {
        const results = [
            createFolder(unreadable, 'New'),
            renameFolder(unreadable, 'A', 'B'),
            deleteFolder(unreadable, 'A'),
            reorderFolders(unreadable, ['A']),
            moveToFolder(unreadable, 'x', 'A'),
            moveManyToFolder(unreadable, ['x'], 'A'),
            setFolderEntries(unreadable, [{ name: 'x', folder: 'A' }]),
        ]
        for (const result of results) {
            expect(result).toEqual({ ok: false, reason: 'newerVersion' })
        }
        expect(JSON.stringify(unreadable)).toBe(snapshot)
    })

    test('a row-carried rule returns no ops, so the row action goes on, and the stored value is untouched', () => {
        expect(carryFolderOnRename(unreadable, 'x', 'y', 0)).toEqual({ ok: true, ops: [] })
        expect(dropFolderEntries(unreadable, [{ name: 'x', rowsLeft: 0 }])).toEqual({ ok: true, ops: [] })
        expect(JSON.stringify(unreadable)).toBe(snapshot)
    })

    test('the forward rule fails at index 0 on it', () => {
        const op: FolderOp = { kind: 'assetFolderOrder', before: [], after: ['F'] }
        expect(applyFolderOps(unreadable, [op])).toEqual({ ok: false, index: 0 })
        expect(applyFolderOp(unreadable, op)).toEqual({ ok: false, index: 0 })
        expect(applyFolderOps('text', [op])).toEqual({ ok: false, index: 0 })
        expect(folderOpAtTarget(unreadable, op)).toBe(false)
    })
})

describe('the forward rule', () => {
    const setOp = (name: string, before: string | null, after: string | null): FolderOp => ({
        kind: 'assetFolderSet',
        name,
        before: before === null ? { had: false } : { had: true, value: before },
        after: after === null ? { had: false } : { had: true, value: after },
    })

    test('an absent value applies as an empty document, and an empty result is null', () => {
        const create: FolderOp = { kind: 'assetFolderOrder', before: [], after: ['F'] }
        expect(applyFolderOps(undefined, [create])).toEqual({ ok: true, doc: docOf(['F'], []) })
        expect(applyFolderOps(docOf(['F'], []), [invertFolderOp(create)])).toEqual({ ok: true, doc: null })
        expect(applyFolderOps(undefined, [])).toEqual({ ok: true, doc: null })
    })

    test('an op whose before does not match the value fails at its own index, and nothing is returned', () => {
        const stored = docOf(['F'], [['a', 'F']])
        expect(applyFolderOps(stored, [setOp('a', 'F', 'G'), setOp('a', 'F', null)])).toEqual({ ok: false, index: 1 })
        expect(applyFolderOps(stored, [setOp('b', 'F', 'G')])).toEqual({ ok: false, index: 0 })
        expect(applyFolderOps(stored, [{ kind: 'assetFolderOrder', before: ['X'], after: [] }])).toEqual({ ok: false, index: 0 })
    })

    test('a set removes every raw entry that folds alike and inserts at the first one position, else at the end', () => {
        const stored = docOf(['F'], [['x', 'F'], ['A', 'F'], ['a', 'F'], ['y', 'F']])
        expect(applyFolderOps(stored, [setOp('A', 'F', 'G')])).toEqual({ ok: true, doc: docOf(['F'], [['x', 'F'], ['A', 'G'], ['y', 'F']]) })
        expect(applyFolderOps(stored, [setOp('a', 'F', null)])).toEqual({ ok: true, doc: docOf(['F'], [['x', 'F'], ['y', 'F']]) })
        expect(applyFolderOps(stored, [setOp('new', null, 'F')])).toEqual({ ok: true, doc: docOf(['F'], [['x', 'F'], ['A', 'F'], ['a', 'F'], ['y', 'F'], ['new', 'F']]) })
    })

    test('the value is not changed, and the result is a new document', () => {
        const stored = docOf(['F'], [['a', 'F']])
        const snapshot = JSON.stringify(stored)
        const result = applyFolderOps(stored, [setOp('b', null, 'F')])
        expect(JSON.stringify(stored)).toBe(snapshot)
        expect(result.ok && result.doc !== stored).toBe(true)
    })

    test('folderOpAtTarget compares the first alike entry, or the raw order, with the after of the op', () => {
        const stored = docOf(['F', 'G'], [['A', 'F'], ['a', 'G']])
        expect(folderOpAtTarget(stored, setOp('a', 'F', 'F'))).toBe(true)
        expect(folderOpAtTarget(stored, setOp('a', 'F', 'G'))).toBe(false)
        expect(folderOpAtTarget(stored, setOp('zz', 'F', null))).toBe(true)
        expect(folderOpAtTarget(stored, { kind: 'assetFolderOrder', before: [], after: ['F', 'G'] })).toBe(true)
        expect(folderOpAtTarget(undefined, { kind: 'assetFolderOrder', before: ['F'], after: [] })).toBe(true)
    })

    test('inverting swaps before and after, twice gives the op back, and the original is not shared', () => {
        const ops: FolderOp[] = [setOp('a', 'F', null), { kind: 'assetFolderOrder', before: ['F'], after: [] }]
        for (const op of ops) {
            const inverse = invertFolderOp(op)
            expect(inverse.before).toEqual(op.after)
            expect(inverse.after).toEqual(op.before)
            expect(invertFolderOp(inverse)).toEqual(op)
            expect(inverse.before).not.toBe(op.after)
        }
    })
})

describe('assetPoolKey', () => {
    test('equals the engine fold, toLocaleLowerCase, on dotted and dotless I samples', () => {
        for (const sample of ['I', 'İ', 'ı', 'i', 'Smile', 'ÄÖÜ', 'SMILE.PNG']) {
            expect(assetPoolKey(sample)).toBe(sample.toLocaleLowerCase())
        }
    })
})

describe('rename carries the folder (MC-1193)', () => {
    const base = docOf(['F', 'G'], [['x', 'F']])

    test('the new name takes the old name folder when it has none; the old entry goes when no row remains', () => {
        const ops = opsOf(carryFolderOnRename(base, 'X', 'Y', 0))
        expect(expectComposed(base, ops).applied?.additional.of).toEqual([['Y', 'F']])
    })

    test('the new name already in another folder keeps it; the old entry still goes', () => {
        const doc = docOf(['F', 'G'], [['x', 'F'], ['y', 'G']])
        expect(expectComposed(doc, opsOf(carryFolderOnRename(doc, 'x', 'y', 0))).applied?.additional.of).toEqual([['y', 'G']])
    })

    test('the new name already in the same folder: only the old entry goes', () => {
        const doc = docOf(['F'], [['x', 'F'], ['y', 'F']])
        const ops = opsOf(carryFolderOnRename(doc, 'x', 'y', 0))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'x', before: { had: true, value: 'F' }, after: { had: false } }])
        expect(expectComposed(doc, ops).applied?.additional.of).toEqual([['y', 'F']])
    })

    test('a two-row pool renamed one row at a time keeps the old entry while a row of it remains', () => {
        const ops = opsOf(carryFolderOnRename(base, 'x', 'z', 1))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'z', before: { had: false }, after: { had: true, value: 'F' } }])
        expect(expectComposed(base, ops).applied?.additional.of).toEqual([['x', 'F'], ['z', 'F']])
    })

    test('a case-only rename changes no entry and records no op', () => {
        expect(opsOf(carryFolderOnRename(base, 'x', 'X', 0))).toEqual([])
    })

    test('a name with no folder entry changes nothing', () => {
        expect(opsOf(carryFolderOnRename(base, 'plain', 'other', 0))).toEqual([])
    })

    test('the ops are entry-level: the name as written, the raw before and the raw after, with no document', () => {
        const ops = opsOf(carryFolderOnRename(base, 'x', 'y', 0))
        expect(ops).toEqual([
            { kind: 'assetFolderSet', name: 'y', before: { had: false }, after: { had: true, value: 'F' } },
            { kind: 'assetFolderSet', name: 'x', before: { had: true, value: 'F' }, after: { had: false } },
        ])
    })
})

describe('removal and merge drop the entry of a name with no row left', () => {
    const base = docOf(['F'], [['smile', 'F'], ['grin', 'F']])

    test('a name with no row left loses its entry; a name with rows left keeps it', () => {
        const ops = opsOf(dropFolderEntries(base, [{ name: 'Smile', rowsLeft: 0 }, { name: 'grin', rowsLeft: 2 }]))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'smile', before: { had: true, value: 'F' }, after: { had: false } }])
        expect(expectComposed(base, ops).applied?.additional.of).toEqual([['grin', 'F']])
    })

    test('two dropped entries are two independent ops that apply in order', () => {
        const ops = opsOf(dropFolderEntries(base, [{ name: 'smile', rowsLeft: 0 }, { name: 'grin', rowsLeft: 0 }]))
        expect(ops.map((op) => op.kind === 'assetFolderSet' ? op.name : '')).toEqual(['smile', 'grin'])
        expect(expectComposed(base, ops).applied).toEqual(docOf(['F'], []))
    })

    test('a name with no entry changes nothing', () => {
        expect(opsOf(dropFolderEntries(base, [{ name: 'other', rowsLeft: 0 }]))).toEqual([])
    })

    test('an entry for a name with no row is kept by writes that do not touch that name', () => {
        const doc = docOf(['F'], [['ghost', 'F']])
        const ops = opsOf(moveToFolder(doc, 'real', 'F'))
        expect(appliedOf(doc, ops)?.additional.of).toEqual([['ghost', 'F'], ['real', 'F']])
    })
})

describe('folder names (MC-1191)', () => {
    const base = docOf(['Faces', 'Poses'], [['smile', 'Faces']])

    test('a name is trimmed, and an empty name is refused', () => {
        expect(appliedOf(base, opsOf(createFolder(base, '  Props  ')))?.additional.order).toEqual(['Faces', 'Poses', 'Props'])
        expect(createFolder(base, '   ')).toEqual({ ok: false, reason: 'emptyName' })
        expect(createFolder(base, '')).toEqual({ ok: false, reason: 'emptyName' })
    })

    test('a name that equals an existing folder ignoring case is refused, for create and rename', () => {
        expect(createFolder(base, 'faces')).toEqual({ ok: false, reason: 'nameTaken' })
        expect(createFolder(base, 'POSES ')).toEqual({ ok: false, reason: 'nameTaken' })
        expect(renameFolder(base, 'Faces', 'poses')).toEqual({ ok: false, reason: 'nameTaken' })
    })

    test('"No folder" in any case is refused', () => {
        for (const name of ['No folder', 'no FOLDER', 'NO FOLDER']) {
            expect(createFolder(base, name)).toEqual({ ok: false, reason: 'noFolderName' })
            expect(renameFolder(base, 'Faces', name)).toEqual({ ok: false, reason: 'noFolderName' })
        }
    })

    test('a folder may change only the case of its own name; its rows keep it', () => {
        const applied = expectComposed(base, opsOf(renameFolder(base, 'Faces', 'FACES'))).applied
        expect(applied?.additional.order).toEqual(['FACES', 'Poses'])
        expect(applied?.additional.of).toEqual([['smile', 'FACES']])
    })

    test('deleting a folder moves its rows to No folder and deletes no row', () => {
        const applied = expectComposed(base, opsOf(deleteFolder(base, 'Faces'))).applied
        expect(applied?.additional.order).toEqual(['Poses'])
        expect(applied?.additional.of).toEqual([])
        expect(folderOf(viewOfStored(applied), 'smile')).toBeNull()
    })

    test('a folder that does not exist cannot be renamed, deleted or moved into', () => {
        expect(renameFolder(base, 'Nope', 'X')).toEqual({ ok: false, reason: 'unknownFolder' })
        expect(deleteFolder(base, 'Nope')).toEqual({ ok: false, reason: 'unknownFolder' })
        expect(moveToFolder(base, 'smile', 'Nope')).toEqual({ ok: false, reason: 'unknownFolder' })
        expect(moveManyToFolder(base, ['smile'], 'Nope')).toEqual({ ok: false, reason: 'unknownFolder' })
    })

    test('moving a name to No folder with null clears its entry', () => {
        const ops = opsOf(moveToFolder(base, 'Smile', null))
        expect(ops).toEqual([{ kind: 'assetFolderSet', name: 'smile', before: { had: true, value: 'Faces' }, after: { had: false } }])
        expect(appliedOf(base, ops)?.additional.of).toEqual([])
    })

    test('a move to the folder a name already is in, or to No folder for a name with no entry, records no op', () => {
        expect(opsOf(moveToFolder(base, 'smile', 'faces'))).toEqual([])
        expect(opsOf(moveToFolder(base, 'plain', null))).toEqual([])
        expect(opsOf(moveToFolder(undefined, 'x', null))).toEqual([])
    })

    test('a reorder must name every folder once and records an order op', () => {
        const ops = opsOf(reorderFolders(base, ['Poses', 'Faces']))
        expect(ops).toEqual([{ kind: 'assetFolderOrder', before: ['Faces', 'Poses'], after: ['Poses', 'Faces'] }])
        expect(reorderFolders(base, ['Poses'])).toEqual({ ok: false, reason: 'unknownFolder' })
        expect(reorderFolders(base, ['Poses', 'Poses'])).toEqual({ ok: false, reason: 'unknownFolder' })
        expect(opsOf(reorderFolders(base, ['Faces', 'Poses']))).toEqual([])
    })
})
