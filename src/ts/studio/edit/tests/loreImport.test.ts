// Lorebook import at drafts level: `prepareLoreImport`'s passes (spec 3.6) and the `loreImport` builder's drafts. Files
// are made by the real producer (`lorebookExportBytes`) over the classic golden; for a risu file the element array the
// reader hands back is the envelope's `data`, so the helper below reads the bytes the same way.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import type { loreBook } from '../../../storage/database.svelte'
import { migrateLoreEntryToV2 } from '../../../process/loreEntryMigration'
import { lorebookExportBytes } from '../../../process/lorebookFile'
import type { LiveReader } from '../../history/historyModel'
import type { ObjBuildResult } from '../../history/ownerHistory.svelte'
import { LORE_FOLDER_PREFIX, idOf, isFolderRow } from '../loreListModel'
import { loreImport, prepareLoreImport, type LoreImportPlan } from '../loreImport'
import type { LoreHost } from '../loreListModel'
import type { LoreIds } from '../loreListOps'

type Row = Record<string, unknown>
const golden: { blank: { globalLore: Row[] }; mixedRows: { globalLore: unknown[] }; folderWithId: { globalLore: Row[] } } = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../history/tests/fixtures/loreClassic.golden.json'), 'utf8'),
)
const CLASSIC_ENTRY = golden.blank.globalLore[0]
const CLASSIC_FOLDER = golden.blank.globalLore[1]
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function entry(comment: string, extra: Row = {}): Row {
    return { ...CLASSIC_ENTRY, comment, content: `body ${comment}`, bookVersion: 2, ...extra }
}
function folder(key: string, comment: string, extra: Row = {}): Row {
    return { ...CLASSIC_FOLDER, key, comment, bookVersion: 2, ...extra }
}
const K = (name: string): string => `${LORE_FOLDER_PREFIX}${name}`

function fileOf(list: unknown): unknown[] {
    return (JSON.parse(Buffer.from(lorebookExportBytes(list)).toString('utf-8')) as { data: unknown[] }).data
}

interface Spy extends LoreIds {
    folderCalls: number
}
function ids(newIds: string[] = [], folderKeys: string[] = []): Spy {
    const idQueue = [...newIds]
    const keyQueue = [...folderKeys]
    let spare = 0
    const spy: Spy = {
        folderCalls: 0,
        newId: () => idQueue.shift() ?? `spare-${++spare}`,
        newFolderKey: () => {
            spy.folderCalls++
            return keyQueue.shift() ?? `spare-key-${spy.folderCalls}`
        },
    }
    return spy
}

function prepare(host: LoreHost, live: readonly unknown[], imported: readonly unknown[], source: LoreIds = ids()): LoreImportPlan {
    const plan = prepareLoreImport(host, live, imported, source)
    if (plan === null) throw new Error('no plan')
    return plan
}

describe('T25a: ids', () => {
    test('a taken id gets a fresh one, a free id is kept, an id-less entry gets one (uncounted), an id-less folder stays id-less, duplicates within the file are re-IDed', () => {
        const live = [entry('A', { id: 'id-a' }), entry('B', { id: 'id-b' })]
        const file = fileOf([
            entry('A2', { id: 'id-a' }),
            entry('C', { id: 'id-c' }),
            entry('D'),
            entry('E', { id: '' }),
            entry('F', { id: 'id-c' }),
            folder(K('f'), 'F'),
        ])
        const plan = prepare('character', live, file, ids(['n1', 'n2', 'n3', 'n4']))
        expect(plan.entries.map((e) => e.id)).toEqual(['n1', 'id-c', 'n2', 'n3', 'n4', undefined])
        expect(Object.hasOwn(plan.entries[5], 'id')).toBe(false)
        expect(plan.renamedIds).toBe(2)
        expect(plan.renamedFolders).toBe(0)
        expect(plan.skipped).toBe(0)
    })

    test('an export imported twice: every id of the second copy is fresh', () => {
        const first = [entry('A', { id: 'id-a' }), entry('B', { id: 'id-b' })]
        const plan = prepare('character', first, fileOf(first), ids(['n1', 'n2']))
        expect(plan.entries.map((e) => e.id)).toEqual(['n1', 'n2'])
        expect(plan.renamedIds).toBe(2)
    })

    test('a folder with a taken id and a taken key counts in both', () => {
        const live = [folder(K('x'), 'X', { id: 'fid' })]
        const plan = prepare('chat', live, [folder(K('x'), 'X', { id: 'fid' })], ids(['n1'], ['k1']))
        expect(plan.renamedIds).toBe(1)
        expect(plan.renamedFolders).toBe(1)
        expect(plan.entries[0]).toMatchObject({ id: 'n1', key: K('k1') })
    })

    test('a free id kept is not re-IDed', () => {
        const plan = prepare('character', [entry('A', { id: 'id-a' })], [entry('Z', { id: 'id-z' })], ids(['n1']))
        expect(plan.entries[0].id).toBe('id-z')
        expect(plan.renamedIds).toBe(0)
    })

    test('null when no fresh id can be found', () => {
        const same: LoreIds = { newId: () => 'id-a', newFolderKey: () => 'k' }
        expect(prepareLoreImport('character', [entry('A', { id: 'id-a' })], [entry('Z', { id: 'id-a' })], same)).toBeNull()
    })
})

describe('T25b: folders', () => {
    test('two same-key folders with a key the live list does not hold: the first keeps its children, the second is re-keyed and empty', () => {
        const file = [entry('c1', { folder: K('dup') }), folder(K('dup'), 'F1'), folder(K('dup'), 'F2'), entry('c2', { folder: K('dup') })]
        const plan = prepare('character', [], file, ids([], ['k1']))
        const [c1, f1, f2, c2] = plan.entries
        expect(f1.key).toBe(K('dup'))
        expect(f2.key).toBe(K('k1'))
        expect(c1.folder).toBe(K('dup'))
        expect(c2.folder).toBe(K('dup'))
        expect(plan.entries.filter((e) => e.folder === K('k1'))).toHaveLength(0)
        expect(plan.renamedFolders).toBe(1)
    })

    test('a taken key is re-keyed with the U+F000 prefix, children before or after their folder follow, a second same-key folder is empty, live rows are untouched', () => {
        const live = [folder(K('live'), 'Live'), entry('L', { folder: K('live') })]
        const before = clone(live)
        const file = fileOf([
            entry('early', { folder: K('live') }),
            folder(K('live'), 'F1'),
            entry('late', { folder: K('live') }),
            folder(K('live'), 'F2'),
            entry('ghost', { folder: K('ghost') }),
        ])
        const plan = prepare('character', live, file, ids([], ['k1', 'k2']))
        const [early, f1, late, f2, ghost] = plan.entries
        expect(f1.key).toBe(K('k1'))
        expect(String(f1.key).startsWith(LORE_FOLDER_PREFIX)).toBe(true)
        expect(f2.key).toBe(K('k2'))
        expect(early.folder).toBe(K('k1'))
        expect(late.folder).toBe(K('k1'))
        expect(plan.entries.filter((e) => e.folder === K('k2'))).toHaveLength(0)
        expect(ghost.folder).toBe(K('ghost'))
        expect(plan.renamedFolders).toBe(2)
        expect(live).toEqual(before)
    })

    test('the remap is applied once: a fresh key equal to another imported folder\'s original key does not chain', () => {
        const live = [folder(K('a'), 'A')]
        const file = [folder(K('a'), 'FA'), folder(K('b'), 'FB'), entry('childA', { folder: K('a') }), entry('childB', { folder: K('b') })]
        // The first folder takes the key that the second folder carries, so the second one is re-keyed in turn.
        const plan = prepare('character', live, file, ids([], ['b', 'c']))
        const [fa, fb, childA, childB] = plan.entries
        expect(fa.key).toBe(K('b'))
        expect(fb.key).toBe(K('c'))
        expect(childA.folder).toBe(K('b'))
        expect(childB.folder).toBe(K('c'))
    })

    test('an imported nested folder\'s own folder reference follows the remap', () => {
        const live = [folder(K('a'), 'A')]
        const plan = prepare('character', live, [folder(K('a'), 'Outer'), folder(K('inner'), 'Inner', { folder: K('a') })], ids([], ['n']))
        expect(plan.entries[1].folder).toBe(K('n'))
    })
})

describe('T49: pass 0', () => {
    test('non-objects are skipped and counted; an empty or non-string id gets a fresh uncounted id; non-objects in the live list hold no id', () => {
        const live = golden.mixedRows.globalLore
        const file = fileOf([null, 'x', 5, [], true, entry('ok', { id: 'id-new' }), entry('empty', { id: '' }), entry('seven', { id: 7 }), entry('clash', { id: 'id-a' })])
        const plan = prepare('character', live, file, ids(['n1', 'n2', 'n3']))
        expect(plan.skipped).toBe(5)
        expect(plan.entries.map((e) => e.id)).toEqual(['id-new', 'n1', 'n2', 'n3'])
        expect(plan.renamedIds).toBe(1)
    })

    test('a null element in a risu file survives the producer and the reader as null and is skipped', () => {
        const file = fileOf([entry('a'), null])
        expect(file[1]).toBeNull()
        expect(prepare('chat', [], file).skipped).toBe(1)
    })
})

describe('T19: unknown keys', () => {
    test.each(['character', 'chat', 'module'] as const)('unknown keys, an own __proto__ and loreCache survive import into a %s', (host) => {
        const source = JSON.parse(
            '{"key":"","comment":"U","content":"c","mode":"normal","insertorder":100,"alwaysActive":false,"secondkey":"","selective":false,"bookVersion":2,"mystery":{"n":[1,2]},"loreCache":[{"k":1}],"__proto__":{"own":true}}',
        ) as Row
        expect(Object.hasOwn(source, '__proto__')).toBe(true)
        const plan = prepare(host, [], fileOf([source]), ids(['n1']))
        const out = plan.entries[0]
        expect(out.mystery).toEqual({ n: [1, 2] })
        expect(out.loreCache).toEqual([{ k: 1 }])
        expect(Object.hasOwn(out, '__proto__')).toBe(true)
        expect(JSON.stringify(out)).toBe(JSON.stringify({ ...JSON.parse(JSON.stringify(source)), id: 'n1' }))
    })
})

describe('T-OQ1: a migration that throws', () => {
    const live = (): Row[] => [folder(K('live'), 'Live')]
    const bare = (extra: Row = {}): Row => ({ key: K('live'), comment: 'F', mode: 'folder', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, ...extra })

    test('(i) a below-v2 element without content is skipped before it touches the taken set, the remap or the counts', () => {
        const spy = ids(['n1', 'n2'], ['k1'])
        const file = [bare(), entry('c1', { folder: K('live') }), entry('c2', { folder: K('live') })]
        const plan = prepare('character', live(), file, spy)
        expect(plan.skipped).toBe(1)
        expect(plan.renamedFolders).toBe(0)
        expect(spy.folderCalls).toBe(0)
        expect(plan.entries.map((e) => e.folder)).toEqual([K('live'), K('live')])
        expect(JSON.stringify(plan.entries)).not.toContain('k1')
        const list = [...live(), ...plan.entries]
        expect(() => list.forEach((e) => migrateLoreEntryToV2(clone(e) as unknown as loreBook))).not.toThrow()
    })

    test('(ii) a truthy activationPercent migrates first, so a content-less element is imported with the text undefined', () => {
        const input = bare({ activationPercent: 30 })
        const expected = migrateLoreEntryToV2(clone(input) as unknown as loreBook)
        const plan = prepare('character', [], [input], ids(['n1'], ['k1']))
        expect(plan.skipped).toBe(0)
        expect(plan.entries[0]).toMatchObject({ content: expected.content, activationPercent: null, bookVersion: 2 })
        expect(plan.entries[0].content).toBe('@@probability 30\nundefined')
    })

    test('(iii) a chat list takes both rows verbatim and skips none', () => {
        const file = [bare(), bare({ activationPercent: 30 })]
        const plan = prepare('chat', live(), file, ids(['n1', 'n2'], ['k1', 'k2']))
        expect(plan.skipped).toBe(0)
        expect(plan.entries).toHaveLength(2)
        expect(plan.entries[1].activationPercent).toBe(30)
        expect(Object.hasOwn(plan.entries[0], 'bookVersion')).toBe(false)
    })
})

describe('D7: version', () => {
    test('character and module entries below version 2 arrive migrated, chat entries verbatim', () => {
        const legacy = entry('L', { bookVersion: undefined, activationPercent: 40, content: 'hi <char> @@end' })
        delete legacy.bookVersion
        for (const host of ['character', 'module'] as const) {
            const out = prepare(host, [], [legacy], ids(['n1'])).entries[0]
            expect(out).toMatchObject({ bookVersion: 2, activationPercent: null, content: '@@probability 40\nhi {{char}} @@depth 0' })
        }
        const chat = prepare('chat', [], [legacy], ids(['n1'])).entries[0]
        expect(chat).toMatchObject({ activationPercent: 40, content: 'hi <char> @@end' })
        expect(Object.hasOwn(chat, 'bookVersion')).toBe(false)
    })
})

describe('the builder', () => {
    function liveOf(rows: readonly unknown[] | null): LiveReader {
        return { objList: () => rows } as unknown as LiveReader
    }
    const okOf = (built: ObjBuildResult): Extract<ObjBuildResult, { ok: true }> => {
        if (built.ok === false) throw new Error(`refused: ${built.reason}`)
        return built
    }

    test('one objInsert per accepted element at the end, label import with the count, landing at the first index, summary recorded', () => {
        const rows = [entry('A'), entry('B')]
        const op = loreImport('character', [entry('X'), null, entry('Y')], ids(['n1', 'n2']))
        const built = okOf(op.build('s', liveOf(rows)))
        expect(built.label).toEqual({ kind: 'obj', list: 'lore', action: 'import', name: null, count: 2 })
        expect(built.drafts.map((d) => [d.op, (d as { index: number }).index])).toEqual([['objInsert', 2], ['objInsert', 3]])
        expect(built.coalesceKey).toBeNull()
        expect(op.landed()).toEqual({ index: 2 })
        expect(op.summary()).toEqual({ count: 2, skipped: 1, renamedIds: 0, renamedFolders: 0 })
    })

    test('a refused build after a successful one clears the summary; no accepted element is unchanged and keeps the skipped count', () => {
        const op = loreImport('chat', [null, 5, entry('X')], ids(['n1']))
        okOf(op.build('s', liveOf([])))
        expect(op.summary()).toMatchObject({ count: 1, skipped: 2 })
        expect(op.build('s', liveOf(null))).toEqual({ ok: false, reason: 'precondition' })
        expect(op.summary()).toBeNull()
        expect(op.landed()).toBeNull()
        const none = loreImport('chat', [null, 5], ids())
        expect(none.build('s', liveOf([]))).toEqual({ ok: false, reason: 'unchanged' })
        expect(none.summary()).toEqual({ count: 0, skipped: 2, renamedIds: 0, renamedFolders: 0 })
        expect(none.landed()).toBeNull()
    })

    test('a generated empty id is never used', () => {
        const queue = ['', 'n1']
        const source: LoreIds = { newId: () => queue.shift() ?? 'spare', newFolderKey: () => 'k' }
        expect(prepare('chat', [], [entry('X')], source).entries[0].id).toBe('n1')
    })

    test('the built entries carry the ids the plan chose, and folder identity helpers agree', () => {
        const op = loreImport('chat', [folder(K('x'), 'X')], ids(['n1'], ['k1']))
        const built = okOf(op.build('s', liveOf([folder(K('x'), 'Live')])))
        const inserted = (built.drafts[0] as { entry: Row }).entry
        expect(isFolderRow(inserted) && inserted.key).toBe(K('k1'))
        expect(idOf(inserted)).toBeNull()
    })
})
