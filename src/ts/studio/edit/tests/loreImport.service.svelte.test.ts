// @vitest-environment jsdom
// The import builder through the real owner history service (memory store, fake clock, a character owner and its chat):
// one step per import, undo and redo, the load migration standing in for `updateLorebooks`, and the identity rules a
// classic append can break. Files come from the real producer (`lorebookExportBytes`) over the classic golden; the
// reader's output for a risu file is the envelope's `data`, read the same way here.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { migrateLoreEntryToV2 } from 'src/ts/process/loreEntryMigration'
import { lorebookExportBytes } from 'src/ts/process/lorebookFile'
import type { loreBook } from 'src/ts/storage/database.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { clone, golden, liveCharacter, makeCharacter, putCharacter, row } from 'src/ts/studio/history/tests/objService.test-helpers'
import { LORE_FOLDER_PREFIX, trackedOf } from '../loreListModel'
import { loreImport } from '../loreImport'
import { loreDeleteFolder, loreFieldEdit, type LoreIds } from '../loreListOps'
import { language } from 'src/lang'
import type { PlainToastInit } from 'src/ts/toast/toastHost.svelte'
import { runLoreImport } from '../loreFileActions'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
// loreFileActions is the real module; only its heavy leaves are stubbed, and every dependency the test exercises is passed explicitly.
vi.mock('src/ts/util', () => ({ selectMultipleFile: vi.fn() }))
vi.mock('src/ts/process/lorebook.svelte', () => ({ parseLorebookImport: vi.fn() }))
vi.mock('src/ts/downloadFile', () => ({ downloadFile: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
    }
})

type Row = Record<string, unknown>
const A = characterOwnerKey('A')
const C1 = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let service: OwnerHistoryService

function folderRow(key: string, comment: string, extra: Row = {}): Row {
    return { ...clone(golden.blank.globalLore[1]), key, comment, bookVersion: 2, ...extra }
}
const K = (name: string): string => `${LORE_FOLDER_PREFIX}${name}`
const fileOf = (list: unknown): unknown[] => (JSON.parse(Buffer.from(lorebookExportBytes(list)).toString('utf-8')) as { data: unknown[] }).data

async function start(globalLore: unknown[], localLore: unknown[] = []): Promise<void> {
    putCharacter(makeCharacter({ globalLore, chats: [{ id: 'c1', note: '', fmIndex: -1, localLore }] }))
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
    await service.whenReady(C1)
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    DBState.db = { characters: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const lore = (): Row[] => liveCharacter().globalLore as Row[]
const chatLore = (): Row[] => liveCharacter().chats[0].localLore as Row[]
const snapshot = (): string => JSON.stringify(lore())
const doneOf = (owner = A) => service.view(owner).done

interface Counted extends LoreIds {
    calls: number
}
function ids(newIds: string[] = [], folderKeys: string[] = []): Counted {
    const idQueue = [...newIds]
    const keyQueue = [...folderKeys]
    let spare = 0
    const counted: Counted = {
        calls: 0,
        newId: () => {
            counted.calls++
            return idQueue.shift() ?? `spare-${++spare}`
        },
        newFolderKey: () => keyQueue.shift() ?? `spare-key-${++spare}`,
    }
    return counted
}

// What `updateLorebooks` does on the next selection: every entry brought to version 2 in place.
function loadMigration(list: Row[]): void {
    for (const entry of list) migrateLoreEntryToV2(entry as unknown as loreBook)
}

// The element shape `convertExternalLorebook` produces: no id, no bookVersion.
function ccEntry(comment: string, content: string): Row {
    return { key: 'k', insertorder: 100, comment, content, mode: 'normal', alwaysActive: false, secondkey: '', selective: false }
}

describe('T25: several files, one step', () => {
    test('one step labelled import with the count, appended in order, landing at the first index; undo removes all; redo is byte-identical and generates no id', async () => {
        await start([row(0), row(1)])
        const before = snapshot()
        const fileA = fileOf([{ ...row(10), id: 'id-x' }, row(11)])
        const fileB = fileOf([row(12)])
        const source = ids(['n1', 'n2', 'n3'])
        const op = loreImport('character', [...fileA, ...fileB], source)
        expect(service.objEdit(A, op.build)).toEqual({ ok: true })
        expect(doneOf()).toHaveLength(1)
        expect(doneOf()[0].label).toEqual({ kind: 'obj', list: 'lore', action: 'import', name: null, count: 3 })
        expect(lore().map((r) => r.comment)).toEqual(['Row 0', 'Row 1', 'Row 10', 'Row 11', 'Row 12'])
        expect(lore().slice(2).map((r) => r.id)).toEqual(['id-x', 'n1', 'n2'])
        expect(op.landed()).toEqual({ index: 2 })
        const after = snapshot()
        const spent = source.calls

        expect(service.undo(A)).toEqual({ ok: true })
        expect(snapshot()).toBe(before)
        expect(service.redo(A)).toEqual({ ok: true })
        expect(snapshot()).toBe(after)
        expect(source.calls).toBe(spent)
    })

    test('redo after an outside insert of an imported id is refused as a changed list (only a restore reports idTaken) and writes nothing', async () => {
        await start([row(0)])
        expect(service.objEdit(A, loreImport('character', fileOf([{ ...row(10), id: 'id-x' }]), ids()).build)).toEqual({ ok: true })
        expect(service.undo(A)).toEqual({ ok: true })
        lore().push({ ...row(20), id: 'id-x' })
        const before = snapshot()
        expect(service.redo(A)).toMatchObject({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'changed' } })
        expect(snapshot()).toBe(before)
    })

    test('undo is refused when an imported row changed elsewhere', async () => {
        await start([row(0)])
        expect(service.objEdit(A, loreImport('character', fileOf([row(10)]), ids(['n1'])).build)).toEqual({ ok: true })
        lore()[1].comment = 'elsewhere'
        expect(service.undo(A)).toMatchObject({ ok: false, reason: 'precondition' })
    })
})

describe('T-AWAIT, builder side: the list is read at build time', () => {
    test('an id and a folder key inserted after the op was made, before it ran, force a fresh id and key', async () => {
        await start([row(0)])
        const file = [{ ...row(10), id: 'id-x' }, folderRow(K('f'), 'F')]
        const op = loreImport('character', file, ids(['n1'], ['k1']))
        // The picker is open here: another writer inserts the same identities.
        lore().push({ ...row(30), id: 'id-x' }, folderRow(K('f'), 'Outside'))
        expect(service.objEdit(A, op.build)).toEqual({ ok: true })
        expect(op.summary()).toMatchObject({ count: 2, renamedIds: 1, renamedFolders: 1 })
        const holders = (pick: (r: Row) => unknown, value: string) => lore().filter((r) => pick(r) === value).length
        expect(holders((r) => r.id, 'id-x')).toBe(1)
        expect(holders((r) => (r.mode === 'folder' ? r.key : undefined), K('f'))).toBe(1)
        expect(lore().slice(-2).map((r) => [r.id, r.key])).toEqual([['n1', ''], [undefined, K('k1')]])
    })
})

describe('T-AWAIT: the real runLoreImport with a deferred pick', () => {
    const pickedFile = { name: 'a.json', data: new Uint8Array() }
    const holders = (pick: (r: Row) => unknown, value: string): number => lore().filter((r) => pick(r) === value).length

    test('an id and a folder key inserted while the pick is pending are re-issued, with the counts in the toast sub', async () => {
        await start([row(0)])
        const file = [{ ...row(10), id: 'id-x' }, folderRow(K('f'), 'F')]
        let release!: (files: { name: string, data: Uint8Array }[]) => void
        const pick = new Promise<{ name: string, data: Uint8Array }[]>((resolve) => { release = resolve })
        const toasts: PlainToastInit[] = []
        const running = runLoreImport('character', () => true, (op) => service.objEdit(A, op.build), { pick: () => pick, parse: () => file, toast: (init) => { toasts.push(init) } })
        lore().push({ ...row(30), id: 'id-x' }, folderRow(K('f'), 'Outside'))
        release([pickedFile])
        await running
        expect(holders((r) => r.id, 'id-x')).toBe(1)
        expect(holders((r) => (r.mode === 'folder' ? r.key : undefined), K('f'))).toBe(1)
        expect(lore()).toHaveLength(5)
        expect(toasts).toEqual([{ kind: 'info', text: language.studioLoreImported(2), sub: language.studioLoreImportRenamed(1, 1) }])
    })

    test('a surface that is no longer live after the pick writes nothing and shows nothing', async () => {
        await start([row(0)])
        let release!: (files: { name: string, data: Uint8Array }[]) => void
        const pick = new Promise<{ name: string, data: Uint8Array }[]>((resolve) => { release = resolve })
        const toasts: PlainToastInit[] = []
        let live = true
        const running = runLoreImport('character', () => live, (op) => service.objEdit(A, op.build), { pick: () => pick, parse: () => [row(10)], toast: (init) => { toasts.push(init) } })
        live = false
        release([pickedFile])
        await running
        expect(lore()).toHaveLength(1)
        expect(doneOf()).toHaveLength(0)
        expect(toasts).toEqual([])
    })
})

describe('T46: D7 migration', () => {
    test('a CC book into a character: no entry below v2, the load migration rewrites nothing, and the edit and the import both undo to the original bytes', async () => {
        // The live entry is already at version 2, so the load migration has nothing of its own to rewrite.
        await start([{ ...row(0), bookVersion: 2 }])
        const original = snapshot()
        const book = [ccEntry('cc1', '<char> greets <user>'), ccEntry('cc2', 'plain')]
        expect(service.objEdit(A, loreImport('character', book, ids(['n1', 'n2'])).build)).toEqual({ ok: true })
        expect(lore().slice(1).every((r) => r.bookVersion === 2)).toBe(true)
        expect(lore()[1].content).toBe('{{char}} greets {{user}}')
        const imported = snapshot()
        loadMigration(lore())
        expect(snapshot()).toBe(imported)

        const tracked = trackedOf(lore(), 1)!
        expect(service.objEdit(A, loreFieldEdit(tracked, 1, 'comment', { had: true, value: 'edited' }, null).build)).toEqual({ ok: true })
        loadMigration(lore())
        expect(service.undo(A)).toEqual({ ok: true })
        expect(snapshot()).toBe(imported)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(snapshot()).toBe(original)
    })

    test('a risu v1 entry with activationPercent 40 and <char> arrives migrated', async () => {
        await start([])
        const v1 = { ...row(5), activationPercent: 40, content: 'hello <char>' } as Row
        delete v1.bookVersion
        expect(service.objEdit(A, loreImport('character', fileOf([v1]), ids(['n1'])).build)).toEqual({ ok: true })
        expect(lore()[0]).toMatchObject({ content: '@@probability 40\nhello {{char}}', activationPercent: null, bookVersion: 2 })
    })

    test('a chat import is byte-verbatim apart from the id', async () => {
        await start([], [])
        const legacy = { ...ccEntry('chat1', '<char> and @@end') }
        expect(service.objEdit(C1, loreImport('chat', [legacy], ids(['n1'])).build)).toEqual({ ok: true })
        expect(JSON.stringify(chatLore()[0])).toBe(JSON.stringify({ ...legacy, id: 'n1' }))
        expect(Object.hasOwn(chatLore()[0], 'bookVersion')).toBe(false)
    })
})

describe('T-OQ1: a migration that throws, through the service', () => {
    test('the content-less folder row is skipped, its children join the live folder, and the load migration does not throw', async () => {
        await start([folderRow(K('live'), 'Live')])
        const bare: Row = { key: K('live'), comment: 'F', mode: 'folder', insertorder: 100, alwaysActive: false, secondkey: '', selective: false }
        const source = ids(['n1', 'n2'], ['k1'])
        const op = loreImport('character', [bare, { ...row(1), folder: K('live') }, { ...row(2), folder: K('live') }], source)
        expect(service.objEdit(A, op.build)).toEqual({ ok: true })
        expect(op.summary()).toEqual({ count: 2, skipped: 1, renamedIds: 0, renamedFolders: 0 })
        expect(lore().slice(1).map((r) => r.folder)).toEqual([K('live'), K('live')])
        expect(JSON.stringify(lore())).not.toContain('k1')
        expect(() => loadMigration(clone(lore()))).not.toThrow()
    })
})

describe('T51: identity instances after a Studio import', () => {
    test('an imported folder keeps its free id and key; after its delete, a verbatim append of the same key without the id refuses Undo and Restore', async () => {
        await start([])
        const file = fileOf(golden.folderWithId.globalLore)
        expect(service.objEdit(A, loreImport('character', file, ids()).build)).toEqual({ ok: true })
        expect(lore()[0]).toMatchObject({ id: 'folder-id', key: golden.folderWithId.globalLore[0].key, mode: 'folder' })
        const tracked = trackedOf(lore(), 0)!
        expect(service.objEdit(A, loreDeleteFolder(tracked, 0).build)).toEqual({ ok: true })
        // A classic import appends the file's elements verbatim: here the same key, without the id.
        const { id: _dropped, ...withoutId } = clone(golden.folderWithId.globalLore[0]) as Row
        lore().push(withoutId)
        expect(service.undo(A)).toMatchObject({ ok: false, reason: 'precondition' })
        const item = service.view(A).deleted[0]
        expect(service.restoreDeleted(A, item.id)).toMatchObject({ ok: false, reason: 'precondition', obj: { list: 'lore', kind: 'idTaken' } })
    })
})
