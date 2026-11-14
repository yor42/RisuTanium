// The pure half of the asset setters: the op builders over a reader, the removal check and its survivor rule, the
// retained-path recompute, the module slot lookup and the file probe. No service, no database.
import { describe, expect, test, vi } from 'vitest'

// The hash cache lives beside the worker and the byte-store readers; none of them runs here.
vi.mock('src/ts/globalApi.svelte', () => ({ pieceStoreOrNull: vi.fn(async () => null) }))
vi.mock('src/ts/storage/store/appStore', () => ({ getAppStoreKind: vi.fn(async () => 'tauri') }))
vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isDesktopTransport: () => false,
    transportKind: () => 'web',
    readRangedPieces: vi.fn(),
    statStoredSize: vi.fn(),
}))

import { createHashCache } from 'src/ts/studio/assets/assetHashJob'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { invertOp, type LiveReader, type Op, type Step, type WriteOp } from '../../history/historyModel'
import { retainedPathsOf } from '../../history/retainedPaths'
import {
    buildAssetDelete,
    buildAssetInsert,
    buildAssetRemoveExtras,
    buildAssetRename,
    buildFolderIntent,
    buildFolderReorder,
    everyRemovalHasSurvivor,
    folderOpsOf,
    moduleSlotsWithId,
    orderAssetWrites,
    readRetainedPairs,
    recomputeRetained,
    removesAssetRow,
    retainedPairsOf,
    survivorDepsFrom,
    touchesAssets,
    type AssetBuildResult,
} from '../assetSetters'

type Row = string[]

function reader(rows: Row[], folder?: unknown, array: 'additionalAssets' | 'emotionImages' | 'assets' = 'additionalAssets'): LiveReader {
    return {
        field: () => ({ had: false }),
        greetings: () => null,
        fmIndex: () => null,
        assetRows: (name) => (name === array ? rows : null),
        folderValue: () => folder,
    }
}

const SMILE = ['smile', 'assets/smile.png', 'png']
const GRIN = ['grin', 'assets/grin.png', 'png']
const SMILE_TWIN = ['Smile', 'assets/smile.png', 'png']

function opsOf(result: AssetBuildResult): Op[] {
    if (result.ok === false) {
        throw new Error('expected a build, got ' + result.reason)
    }
    return result.ops
}

function step(id: string, ...ops: Op[]): Step {
    return { id, at: 1, label: { kind: 'assetDelete', count: 1, name: null }, ops }
}

describe('buildAssetDelete', () => {
    test('a bulk delete removes highest index first, with the count of identical rows at each op, and one bulk label', () => {
        const rows = [[...SMILE], [...GRIN], [...SMILE]]
        const result = buildAssetDelete('additionalAssets', [0, 2], reader(rows))
        expect(result).toMatchObject({ ok: true, label: { kind: 'assetDelete', count: 2, name: null } })
        expect(opsOf(result)).toEqual([
            { op: 'assetRowRemove', array: 'additionalAssets', index: 2, tuple: SMILE, count: 2 },
            { op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: SMILE, count: 1 },
        ])
    })

    test('a single delete names its row, and a bad or repeated index refuses', () => {
        const rows = [[...SMILE], [...GRIN]]
        expect(buildAssetDelete('additionalAssets', [1], reader(rows))).toMatchObject({ ok: true, label: { kind: 'assetDelete', count: 1, name: 'grin' } })
        expect(buildAssetDelete('additionalAssets', [2], reader(rows))).toEqual({ ok: false, reason: 'precondition' })
        expect(buildAssetDelete('additionalAssets', [0, 0], reader(rows))).toEqual({ ok: false, reason: 'precondition' })
        expect(buildAssetDelete('additionalAssets', [], reader(rows))).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildAssetDelete('emotionImages', [0], reader(rows))).toEqual({ ok: false, reason: 'precondition' })
    })

    test('the folder entry of a name goes with its last row only, and an emotion list has no folders', () => {
        const stored = { v: 1, additional: { order: ['F'], of: [['smile', 'F']] } }
        const rows = [[...SMILE], [...SMILE_TWIN]]
        const keeps = buildAssetDelete('additionalAssets', [1], reader(rows, stored))
        expect(opsOf(keeps).map((op) => op.op)).toEqual(['assetRowRemove'])
        const drops = buildAssetDelete('additionalAssets', [0, 1], reader(rows, stored))
        expect(opsOf(drops).map((op) => op.op)).toEqual(['assetRowRemove', 'assetRowRemove', 'assetFolderSet'])
        const emotions = buildAssetDelete('emotionImages', [0], reader([['smile', 'assets/smile.png']], stored, 'emotionImages'))
        expect(opsOf(emotions).map((op) => op.op)).toEqual(['assetRowRemove'])
    })
})

describe('buildAssetRename', () => {
    test('a same-name rename is no step, a rename is one row op, and the folder entry follows the name', () => {
        const stored = { v: 1, additional: { order: ['F'], of: [['smile', 'F']] } }
        const rows = [[...SMILE], [...GRIN]]
        expect(buildAssetRename('additionalAssets', 0, 'smile', reader(rows, stored))).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildAssetRename('additionalAssets', 0, '', reader(rows, stored))).toEqual({ ok: false, reason: 'precondition' })
        const renamed = buildAssetRename('additionalAssets', 0, 'beam', reader(rows, stored))
        expect(opsOf(renamed)[0]).toEqual({ op: 'assetRowSet', array: 'additionalAssets', index: 0, before: SMILE, after: ['beam', 'assets/smile.png', 'png'] })
        expect(opsOf(renamed).map((op) => op.op)).toEqual(['assetRowSet', 'assetFolderSet', 'assetFolderSet'])
    })

    test('an unreadable folder document never blocks a rename and yields no folder op', () => {
        const rows = [[...SMILE]]
        const renamed = buildAssetRename('additionalAssets', 0, 'beam', reader(rows, { v: 9, x: 1 }))
        expect(opsOf(renamed).map((op) => op.op)).toEqual(['assetRowSet'])
        const deleted = buildAssetDelete('additionalAssets', [0], reader(rows, { v: 9, x: 1 }))
        expect(opsOf(deleted).map((op) => op.op)).toEqual(['assetRowRemove'])
    })
})

describe('buildAssetInsert and buildFolderIntent', () => {
    test('an insert lands at the end with the count of identical rows, labelled assetAdd with its row count', () => {
        const result = buildAssetInsert('additionalAssets', [GRIN, GRIN], reader([[...SMILE], [...GRIN]]))
        expect(result).toMatchObject({ ok: true, label: { kind: 'assetAdd', count: 2 } })
        expect(opsOf(result)).toEqual([
            { op: 'assetRowInsert', array: 'additionalAssets', index: 2, tuple: GRIN, count: 1 },
            { op: 'assetRowInsert', array: 'additionalAssets', index: 3, tuple: GRIN, count: 2 },
        ])
        expect(buildAssetInsert('additionalAssets', [], reader([]))).toEqual({ ok: false, reason: 'unchanged' })
    })

    test('a created folder is labelled folderCreate with its name as stored: trimmed, never case-folded', () => {
        const stored = { v: 1, additional: { order: ['F'], of: [] } }
        expect(buildFolderIntent({ kind: 'create', name: '  Poses ' }, reader([], stored))).toMatchObject({ ok: true, label: { kind: 'folderCreate', name: 'Poses' } })
        expect(buildFolderIntent({ kind: 'create', name: 'FACES' }, reader([], stored))).toMatchObject({ ok: true, label: { kind: 'folderCreate', name: 'FACES' } })
    })

    test('a folder action is one build, a refusal carries the codec reason, and a no-op is unchanged', () => {
        const stored = { v: 1, additional: { order: ['F'], of: [] } }
        expect(buildFolderIntent({ kind: 'create', name: 'G' }, reader([], stored))).toMatchObject({ ok: true, label: { kind: 'folderCreate', name: 'G' } })
        expect(buildFolderIntent({ kind: 'create', name: 'f' }, reader([], stored))).toEqual({ ok: false, reason: 'precondition', folderRefusal: 'nameTaken' })
        expect(buildFolderIntent({ kind: 'create', name: 'G' }, reader([], { v: 9 }))).toEqual({ ok: false, reason: 'precondition', folderRefusal: 'newerVersion' })
        expect(buildFolderIntent({ kind: 'move', names: ['smile'], folder: null }, reader([], stored))).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildFolderIntent({ kind: 'rename', from: 'F', to: 'H' }, reader([], stored))).toMatchObject({ ok: true, label: { kind: 'folderRename', from: 'F', to: 'H' } })
        expect(buildFolderIntent({ kind: 'delete', name: 'F' }, reader([], stored))).toMatchObject({ ok: true, label: { kind: 'folderDelete', name: 'F' } })
    })
})

describe('buildFolderReorder', () => {
    const stored = { v: 1, additional: { order: ['F', 'G'], of: [['smile', 'F']] } }

    test('a reorder is one entry-level order op labelled folderReorder, never a whole document, and it inverts', () => {
        const result = buildFolderReorder(['G', 'F'], reader([[...SMILE]], stored))
        expect(result).toEqual({ ok: true, label: { kind: 'folderReorder' }, ops: [{ op: 'assetFolderOrder', before: ['F', 'G'], after: ['G', 'F'] }] })
        const inverse = opsOf(result).map(invertOp)
        expect(inverse).toEqual([{ op: 'assetFolderOrder', before: ['G', 'F'], after: ['F', 'G'] }])
        expect(inverse.map(invertOp)).toEqual(opsOf(result))
    })

    test('a list that is not exactly the listed folders refuses, and an unchanged order is no step', () => {
        expect(buildFolderReorder(['G'], reader([], stored))).toEqual({ ok: false, reason: 'precondition', folderRefusal: 'unknownFolder' })
        expect(buildFolderReorder(['G', 'G'], reader([], stored))).toEqual({ ok: false, reason: 'precondition', folderRefusal: 'unknownFolder' })
        expect(buildFolderReorder(['F', 'G'], reader([], stored))).toEqual({ ok: false, reason: 'unchanged' })
    })

    test('an unreadable or newer folder document refuses and yields no op', () => {
        expect(buildFolderReorder(['G', 'F'], reader([], { v: 9, x: 1 }))).toEqual({ ok: false, reason: 'precondition', folderRefusal: 'newerVersion' })
        expect(buildFolderReorder([], reader([], { v: 9 }))).toEqual({ ok: false, reason: 'precondition', folderRefusal: 'newerVersion' })
    })
})

describe('the removal check and the survivor rule', () => {
    const removal: Op = { op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: SMILE, count: 1 }
    const insert: Op = { op: 'assetRowInsert', array: 'additionalAssets', index: 0, tuple: SMILE, count: 0 }
    const sameFile: Op = { op: 'assetRowSet', array: 'additionalAssets', index: 0, before: SMILE, after: ['beam', SMILE[1], 'png'] }
    const otherFile: Op = { op: 'assetRowSet', array: 'additionalAssets', index: 0, before: SMILE, after: GRIN }
    const folder: Op = { op: 'assetFolderOrder', before: [], after: ['F'] }

    test('a removal and a row moved to another file are removal-type; an insert, a rename and a folder op are not', () => {
        expect(removesAssetRow([removal])).toBe(true)
        expect(removesAssetRow([insert, otherFile])).toBe(true)
        expect(removesAssetRow([insert, sameFile, folder])).toBe(false)
        expect(removesAssetRow([])).toBe(false)
    })

    test('touchesAssets sees every row and folder op and no text op', () => {
        expect(touchesAssets([removal])).toBe(true)
        expect(touchesAssets([insert])).toBe(true)
        expect(touchesAssets([sameFile])).toBe(true)
        expect(touchesAssets([folder])).toBe(true)
        expect(touchesAssets([{ op: 'textEdit', target: 'desc', offset: 0, from: 'a', to: 'b' }])).toBe(false)
    })

    test('a row needs a survivor with an equal path or an equal cached hash', () => {
        const none = { hashOf: () => undefined }
        expect(everyRemovalHasSurvivor([SMILE], [[...SMILE_TWIN]], none)).toBe(true)
        expect(everyRemovalHasSurvivor([GRIN], [[...SMILE]], none)).toBe(false)
        const sameBytes = { hashOf: (path: string) => (path === GRIN[1] || path === SMILE[1] ? 'h1' : undefined) }
        expect(everyRemovalHasSurvivor([GRIN], [[...SMILE]], sameBytes)).toBe(true)
        expect(everyRemovalHasSurvivor([GRIN], [], sameBytes)).toBe(false)
    })

    test('a path rewritten in place has no cached hash under its new size, so its removal has no survivor', () => {
        const cache = createHashCache()
        cache.set(GRIN[1], 100, 'h1')
        cache.set(SMILE[1], 100, 'h1')
        let size = 100
        const deps = survivorDepsFrom(cache, () => size)
        expect(everyRemovalHasSurvivor([GRIN], [[...SMILE]], deps)).toBe(true)
        // The file under the path now has another size: the cached hash no longer describes it.
        size = 250
        expect(everyRemovalHasSurvivor([GRIN], [[...SMILE]], deps)).toBe(false)
        const extras = buildAssetRemoveExtras('additionalAssets', 'grin', [1], reader([[...SMILE], [...GRIN]]), deps)
        expect(extras).toEqual({ ok: false, reason: 'precondition' })
    })

    test('a content-addressed path keeps its hash whatever size a row reported', () => {
        const hashed = 'a'.repeat(64)
        const cache = createHashCache()
        cache.set(`assets/${hashed}.png`, 10, 'same')
        cache.set(SMILE[1], 10, 'same')
        const deps = survivorDepsFrom(cache, (path) => (path === SMILE[1] ? 10 : 9999))
        expect(everyRemovalHasSurvivor([[`x`, `assets/${hashed}.png`, 'png']], [[...SMILE]], deps)).toBe(true)
    })

    test('remove extras with a survivor builds the removal and its label; the survivor is checked against the rows that stay', () => {
        const rows = [[...SMILE], [...SMILE_TWIN], [...GRIN]]
        const result = buildAssetRemoveExtras('additionalAssets', 'smile', [1], reader(rows), { hashOf: () => undefined })
        expect(result).toMatchObject({ ok: true, label: { kind: 'assetRemoveExtras', count: 1, name: 'smile' } })
        const lonely = buildAssetRemoveExtras('additionalAssets', 'grin', [2], reader(rows), { hashOf: () => undefined })
        expect(lonely).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('the retained pairs and the recompute', () => {
    const removeSmile: Op = { op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: SMILE, count: 1 }
    const insertGrin: Op = { op: 'assetRowInsert', array: 'additionalAssets', index: 0, tuple: GRIN, count: 0 }
    const rename: Op = { op: 'assetRowSet', array: 'additionalAssets', index: 0, before: SMILE, after: ['beam', SMILE[1], 'png'] }

    test('the pairs are the steps paths, unique and sorted, each with the name of its first naming op', () => {
        const steps = new Set([step('a', removeSmile), step('b', rename, insertGrin)])
        expect(retainedPairsOf(steps)).toEqual([
            ['grin', 'assets/grin.png'],
            ['smile', 'assets/smile.png'],
        ])
        expect(retainedPairsOf(steps).map((pair) => pair[1])).toEqual(retainedPathsOf(steps))
    })

    test('the pair test accepts only an array of pairs of strings', () => {
        expect(readRetainedPairs([['a', 'b']])).toEqual([['a', 'b']])
        expect(readRetainedPairs([])).toEqual([])
        expect(readRetainedPairs([['a']])).toBeNull()
        expect(readRetainedPairs([['a', 'b', 'c']])).toBeNull()
        expect(readRetainedPairs([['a', 1]])).toBeNull()
        expect(readRetainedPairs({ a: ['assets/K.png'] })).toBeNull()
        expect(readRetainedPairs('x')).toBeNull()
    })

    test('ready sets exactly the steps paths, removes the key when none remain, and keeps an equal value untouched', () => {
        const steps = new Set([step('a', removeSmile)])
        expect(recomputeRetained(undefined, 'ready', steps)).toEqual({ kind: 'set', value: [['smile', 'assets/smile.png']] })
        expect(recomputeRetained([['old', 'assets/old.png']], 'ready', steps)).toEqual({ kind: 'set', value: [['smile', 'assets/smile.png']] })
        expect(recomputeRetained([['smile', 'assets/smile.png']], 'ready', steps)).toEqual({ kind: 'keep' })
        expect(recomputeRetained([['old', 'assets/old.png']], 'ready', new Set())).toEqual({ kind: 'remove' })
        expect(recomputeRetained(undefined, 'ready', new Set())).toEqual({ kind: 'keep' })
    })

    test('memoryOnly adds the steps paths to what the field holds and never drops a path', () => {
        const steps = new Set([step('a', insertGrin)])
        expect(recomputeRetained([['old', 'assets/old.png']], 'memoryOnly', steps)).toEqual({
            kind: 'set',
            value: [['grin', 'assets/grin.png'], ['old', 'assets/old.png']],
        })
        expect(recomputeRetained([['old', 'assets/old.png']], 'memoryOnly', new Set())).toEqual({ kind: 'keep' })
    })

    test('a value that is not an array of pairs is left exactly as it is, in either phase', () => {
        const steps = new Set([step('a', removeSmile)])
        for (const phase of ['ready', 'memoryOnly'] as const) {
            expect(recomputeRetained({ a: ['assets/K.png'] }, phase, steps)).toEqual({ kind: 'keep' })
            expect(recomputeRetained([['x']], phase, new Set())).toEqual({ kind: 'keep' })
        }
    })
})

describe('write ordering, module slots and the file probe', () => {
    test('rows come first, then folder entries, then the rest, each group in the plan order', () => {
        const text: WriteOp = { op: 'textEdit', target: 'lore/0/content', offset: 0, from: 'a', to: 'b' }
        const set: WriteOp = { op: 'set', path: 'desc', value: { had: true, value: 'x' } }
        const folderSet: WriteOp = { op: 'assetFolderSet', name: 'a', before: { had: false }, after: { had: true, value: 'F' } }
        const rowA: WriteOp = { op: 'assetRowRemove', array: 'additionalAssets', index: 3, tuple: GRIN, count: 1 }
        const rowB: WriteOp = { op: 'assetRowInsert', array: 'additionalAssets', index: 0, tuple: SMILE, count: 0 }
        expect(orderAssetWrites([text, folderSet, rowA, set, rowB])).toEqual([rowA, rowB, folderSet, text, set])
        expect(folderOpsOf([text, folderSet, rowA])).toEqual([{ kind: 'assetFolderSet', name: 'a', before: { had: false }, after: { had: true, value: 'F' } }])
    })

    test('a module slot lookup counts every slot with the id, stubs included, and never reads a body key', () => {
        const modules = [{ id: 'a' }, stubModule('b'), { id: 'b' }, null, 'x']
        expect(moduleSlotsWithId(modules, 'b').map((slot) => slot.index)).toEqual([1, 2])
        expect(moduleSlotsWithId(modules, 'a')).toHaveLength(1)
        expect(moduleSlotsWithId(modules, 'zz')).toEqual([])
        expect(moduleSlotsWithId(undefined, 'a')).toEqual([])
    })
})
