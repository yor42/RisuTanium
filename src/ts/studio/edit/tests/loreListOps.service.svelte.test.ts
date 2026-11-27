// @vitest-environment jsdom
// The lorebook builders through the real owner history service (memory store, fake clock, a character owner and its
// chat): steps, undo, restore and the refusals the service itself decides. Rows come from the classic producers' golden
// (`loreClassic.golden.json`); a row shape the classic editor cannot write is built by hand and says why.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { migrateLoreEntryToV2 } from 'src/ts/process/loreEntryMigration'
import type { loreBook } from 'src/ts/storage/database.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { clone, golden, liveCharacter, makeCharacter, putCharacter, row } from 'src/ts/studio/history/tests/objService.test-helpers'
import { trackedOf, type LoreTracked } from '../loreListModel'
import {
    loreActivateInChat,
    loreAlwaysActive,
    loreBulkActive,
    loreCaseSensitive,
    loreDelete,
    loreDeleteFolder,
    loreDuplicate,
    loreFieldEdit,
    loreMove,
    loreMoveLegacyIntoLine,
    loreNewId,
    loreTypingKey,
    loreUnlink,
    type LoreIds,
    type LoreOp,
} from '../loreListOps'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
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
    return { ...clone(golden.blank.globalLore[1]), key, comment, ...extra }
}
function linkRow(id: string): Row {
    return { key: '', comment: '', content: '', mode: 'child', insertorder: 100, alwaysActive: true, secondkey: '', selective: false, id }
}

async function start(globalLore: unknown[], localLore: unknown = [], readyChat = true): Promise<void> {
    putCharacter(makeCharacter({ globalLore, chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: localLore as unknown[] }] }))
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
    if (readyChat) await service.whenReady(C1)
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
const chatLore = (): unknown => liveCharacter().chats[0].localLore
const snapshot = (): string => JSON.stringify(lore())
const doneOf = (owner = A) => service.view(owner).done

function target(index: number): { tracked: LoreTracked; hint: number } {
    const tracked = trackedOf(lore(), index)
    if (tracked === null) throw new Error('no row')
    return { tracked, hint: index }
}

function edit(op: LoreOp, owner = A) {
    return service.objEdit(owner, op.build)
}

function ids(newIds: string[]): LoreIds {
    const queue = [...newIds]
    return { newId: () => queue.shift() ?? `spare-${queue.length}`, newFolderKey: () => 'k' }
}

describe('T15: folder delete', () => {
    const world = (): Row[] => [folderRow('K1', 'F1'), row(1), { ...row(2), folder: 'K1' }, folderRow('K2', 'F2', { folder: 'K1' }), { ...row(3), folder: 'K2' }, row(4)]

    test('one step, one deleted item holding every row, a count of the rows inside, and a restore returning each index', async () => {
        await start(world())
        const before = snapshot()
        const t = target(0)
        expect(edit(loreDeleteFolder(t.tracked, t.hint))).toEqual({ ok: true })
        expect(lore().map((r) => r.comment)).toEqual(['Row 1', 'Row 4'])
        expect(doneOf()).toHaveLength(1)
        expect(doneOf()[0].label).toEqual({ kind: 'obj', list: 'lore', action: 'folderDelete', name: 'F1', count: 3 })
        const deleted = service.view(A).deleted
        expect(deleted).toHaveLength(1)
        expect(service.restoreDeleted(A, deleted[0].id)).toMatchObject({ ok: true })
        expect(snapshot()).toBe(before)
    })

    test('a folder cycle terminates and removes both folders', async () => {
        // The classic editor cannot write a cycle, but a hand-edited import can carry one.
        await start([folderRow('A', 'FA', { folder: 'B' }), folderRow('B', 'FB', { folder: 'A' }), row(1)])
        const t = target(0)
        expect(edit(loreDeleteFolder(t.tracked, t.hint))).toEqual({ ok: true })
        expect(lore().map((r) => r.comment)).toEqual(['Row 1'])
    })
})

describe('T16, T17, T17c: moves', () => {
    test('moving out to the top level deletes the folder key and undo restores it', async () => {
        await start([folderRow('K', 'F'), { ...row(1), folder: 'K' }])
        const before = snapshot()
        const t = target(1)
        expect(edit(loreMove(t.tracked, t.hint, { to: null }))).toEqual({ ok: true })
        expect(Object.hasOwn(lore()[1], 'folder')).toBe(false)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(snapshot()).toBe(before)
    })

    test('a folder with a non-contiguous subtree moves as one contiguous block, and landed() names the folder row', async () => {
        await start([folderRow('K1', 'F'), row(1), { ...row(2), folder: 'K1' }, row(3)])
        const t = target(0)
        const op = loreMove(t.tracked, t.hint, 'down')
        expect(edit(op)).toEqual({ ok: true })
        expect(lore().map((r) => r.comment)).toEqual(['Row 1', 'F', 'Row 2', 'Row 3'])
        expect(lore()[op.landed()!.index as number].comment).toBe('F')
        expect(service.undo(A)).toEqual({ ok: true })
        expect(lore().map((r) => r.comment)).toEqual(['F', 'Row 1', 'Row 2', 'Row 3'])
    })

    test('moving into a folder sets the key on the row and keeps the inserted row in step with it (T16 insert entry)', async () => {
        await start([row(0), folderRow('K', 'F')])
        const t = target(0)
        expect(edit(loreMove(t.tracked, t.hint, { to: 'K' }))).toEqual({ ok: true })
        expect(lore().map((r) => [r.comment, r.folder])).toEqual([['F', undefined], ['Row 0', 'K']])
    })
})

describe('T18, T18e: always active', () => {
    test('a nested folder sets itself and its direct children only', async () => {
        await start([folderRow('K1', 'F1'), { ...row(1), folder: 'K1' }, folderRow('K2', 'F2', { folder: 'K1' }), { ...row(2), folder: 'K2' }])
        const t = target(0)
        expect(edit(loreAlwaysActive(t.tracked, t.hint, true))).toEqual({ ok: true })
        expect(lore().map((r) => r.alwaysActive)).toEqual([true, true, true, false])
        expect(doneOf()).toHaveLength(1)
    })

    test('bulk off on a chat leaves its links on and includes folders', async () => {
        const chatRows = [{ ...row(1), alwaysActive: true }, folderRow('K', 'F', { alwaysActive: true }), linkRow('X'), linkRow('Y')]
        await start([], chatRows)
        expect(edit(loreBulkActive(false), C1)).toEqual({ ok: true })
        const after = chatLore() as Row[]
        expect(after.map((r) => r.alwaysActive)).toEqual([false, false, true, true])
        expect(doneOf(C1)).toHaveLength(1)
    })

    test('MC-4191: a malformed row is skipped by bulk and folder toggles; a malformed folder root is refused', async () => {
        // A classic import appends an entry verbatim, so a hand-edited export can carry alwaysActive as a string.
        const bad = { ...row(9), alwaysActive: 'true' }
        await start([row(0), bad, folderRow('K', 'F'), { ...row(2), folder: 'K', alwaysActive: 'true' }, { ...row(3), folder: 'K' }])
        const badBytes = JSON.stringify(lore()[1])
        expect(edit(loreBulkActive(true))).toEqual({ ok: true })
        expect(lore().map((r) => r.alwaysActive)).toEqual([true, 'true', true, 'true', true])
        expect(JSON.stringify(lore()[1])).toBe(badBytes)
        expect(doneOf()).toHaveLength(1)
        const folder = target(2)
        expect(edit(loreAlwaysActive(folder.tracked, folder.hint, false))).toEqual({ ok: true })
        expect(lore().map((r) => r.alwaysActive)).toEqual([true, 'true', false, 'true', false])
        const root = target(1)
        const before = snapshot()
        expect(edit(loreAlwaysActive(root.tracked, root.hint, false))).toMatchObject({ ok: false, reason: 'precondition' })
        expect(snapshot()).toBe(before)
    })
})

describe('T19p: unknown keys survive every op', () => {
    test('edit, case sensitive, move, duplicate, new id and delete then restore keep unknown keys and loreCache', async () => {
        const mark = { loreCache: { k: 1 }, unknownKey: 'u' }
        await start([{ ...row(0), ...mark, id: 'X' }, { ...row(1), id: 'X' }, row(2)])
        const keep = (index: number): void => {
            expect(lore()[index]).toMatchObject(mark)
        }
        let t = target(0)
        edit(loreFieldEdit(t.tracked, t.hint, 'comment', { had: true, value: 'e' }, null))
        keep(0)
        t = target(0)
        edit(loreCaseSensitive(t.tracked, t.hint, true))
        keep(0)
        t = target(0)
        edit(loreMove(t.tracked, t.hint, 'down'))
        keep(1)
        t = target(1)
        edit(loreDuplicate('character', t.tracked, t.hint, ids(['dup'])))
        keep(2)
        t = target(1)
        edit(loreNewId(t.tracked, t.hint, ids(['newer'])))
        keep(1)
        t = target(1)
        edit(loreDelete(t.tracked, t.hint))
        const deleted = service.view(A).deleted
        expect(service.restoreDeleted(A, deleted[0].id)).toMatchObject({ ok: true })
        keep(1)
    })
})

describe('T24, T24e: local activation', () => {
    const readRows = (): readonly unknown[] => lore()

    test('(a) an id-less entry gets an id and the chat a classic link: two steps on two owners', async () => {
        await start([row(0), row(1)])
        const t = target(1)
        const out = loreActivateInChat(service, A, C1, readRows, t.tracked, t.hint, ids(['new-id']))
        expect(out.result).toEqual({ ok: true })
        expect(out.assigned).toEqual({ index: 1, newId: 'new-id' })
        expect(lore()[1].id).toBe('new-id')
        expect(doneOf(A)).toHaveLength(1)
        expect(doneOf(C1)).toHaveLength(1)
        expect(chatLore()).toEqual([linkRow('new-id')])
    })

    test('(b) with two links carrying the entry id, turning it off removes both in one step', async () => {
        await start([{ ...row(0), id: 'X' }], [linkRow('X'), linkRow('X'), linkRow('Y')])
        expect(edit(loreUnlink('X', null), C1)).toEqual({ ok: true })
        expect(chatLore()).toEqual([linkRow('Y')])
        expect(doneOf(C1)).toHaveLength(1)
    })

    test('(c) a chat lorebook that is not a list: the character step lands, the chat step refuses, assigned stays', async () => {
        // The classic editor always keeps localLore a list; a damaged chat is the residual the builder must survive.
        await start([row(0)], { notAList: true })
        const t = target(0)
        const out = loreActivateInChat(service, A, C1, readRows, t.tracked, t.hint, ids(['n1']))
        expect(out.result.ok).toBe(false)
        expect(out.assigned).toEqual({ index: 0, newId: 'n1' })
        expect(lore()[0].id).toBe('n1')
        expect(chatLore()).toEqual({ notAList: true })
    })

    test('(d) an entry that already has an id writes only the chat step', async () => {
        await start([{ ...row(0), id: 'X' }])
        const t = target(0)
        const out = loreActivateInChat(service, A, C1, readRows, t.tracked, t.hint)
        expect(out).toEqual({ result: { ok: true }, assigned: null })
        expect(doneOf(A)).toHaveLength(0)
        expect(doneOf(C1)).toHaveLength(1)
    })

    test('S1: the chat link and unlink steps carry the entry name', async () => {
        await start([{ ...row(0), comment: 'Castle' }])
        const t = target(0)
        expect(loreActivateInChat(service, A, C1, readRows, t.tracked, t.hint, ids(['n1'])).result).toEqual({ ok: true })
        expect(doneOf(C1)[0].label).toEqual({ kind: 'obj', list: 'lore', action: 'link', name: 'Castle' })
        expect(edit(loreUnlink('n1', 'Castle'), C1)).toEqual({ ok: true })
        expect(doneOf(C1)[1].label).toEqual({ kind: 'obj', list: 'lore', action: 'unlink', name: 'Castle' })
    })

    test('T24e: a chat owner that is not started writes nothing on either owner and stays unused', async () => {
        await start([row(0)], [], false)
        const before = snapshot()
        const t = target(0)
        const out = loreActivateInChat(service, A, C1, readRows, t.tracked, t.hint, ids(['n1']))
        expect(out).toEqual({ result: { ok: false, reason: 'loading' }, assigned: null })
        expect(snapshot()).toBe(before)
        expect(doneOf(A)).toHaveLength(0)
        expect(service.view(C1).phase).toBe('unused')
    })
})

describe('T30b, T39, T40: identity and containers', () => {
    test('Give new ID is one step; only the chosen sharer changes id', async () => {
        await start([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }])
        const t = target(0)
        expect(edit(loreNewId(t.tracked, t.hint, ids(['fresh'])))).toEqual({ ok: true })
        expect(lore().map((r) => r.id)).toEqual(['fresh', 'X'])
        expect(doneOf()).toHaveLength(1)
        expect(doneOf()[0].label).toMatchObject({ action: 'newId' })
        expect(service.undo(A)).toEqual({ ok: true })
        expect(lore().map((r) => r.id)).toEqual(['X', 'X'])
    })

    test('T39: case sensitive spreads the existing container, creates one when absent, and undo restores the absence', async () => {
        await start([{ ...row(0), extentions: { other: 1 } }, row(1), { ...row(2), extentions: null }])
        let t = target(0)
        expect(edit(loreCaseSensitive(t.tracked, t.hint, true))).toEqual({ ok: true })
        expect(lore()[0].extentions).toEqual({ other: 1, risu_case_sensitive: true })
        t = target(1)
        expect(edit(loreCaseSensitive(t.tracked, t.hint, true))).toEqual({ ok: true })
        expect(lore()[1].extentions).toEqual({ risu_case_sensitive: true })
        expect(service.undo(A)).toEqual({ ok: true })
        expect(Object.hasOwn(lore()[1], 'extentions')).toBe(false)
        t = target(2)
        expect(edit(loreCaseSensitive(t.tracked, t.hint, true))).toMatchObject({ ok: false, reason: 'precondition' })
    })

    test('T40: a move of an id sharer lands, and undoing the delete of one of two sharers restores it', async () => {
        await start([{ ...row(0), id: 'X' }, { ...row(1), id: 'X' }, row(2)])
        let t = target(0)
        expect(edit(loreMove(t.tracked, t.hint, 'down'))).toEqual({ ok: true })
        expect(lore().map((r) => r.comment)).toEqual(['Row 1', 'Row 0', 'Row 2'])
        t = target(1)
        expect(edit(loreDelete(t.tracked, t.hint))).toEqual({ ok: true })
        expect(service.undo(A)).toEqual({ ok: true })
        expect(lore().map((r) => r.comment)).toEqual(['Row 1', 'Row 0', 'Row 2'])
    })
})

describe('T43b: the older probability value into the line', () => {
    test('one step undone as a whole; an outside change to the content refuses the undo and writes nothing', async () => {
        // A classic risu v1 file carries activationPercent; an entry added in this editor does not.
        await start([{ ...row(0), activationPercent: 40 }])
        const t = target(0)
        expect(edit(loreMoveLegacyIntoLine(t.tracked, t.hint))).toEqual({ ok: true })
        expect(lore()[0]).toMatchObject({ content: '@@probability 40\nbody 0', activationPercent: null })
        expect(doneOf()).toHaveLength(1)
        lore()[0].content = 'changed elsewhere'
        const before = snapshot()
        expect(service.undo(A)).toMatchObject({ ok: false, reason: 'precondition' })
        expect(snapshot()).toBe(before)
    })
})

describe('TE2: typing joins steps by row identity', () => {
    test('two edits with one identity key are one step; another identity is a step of its own', async () => {
        await start([row(0), row(1)])
        let t = target(0)
        edit(loreFieldEdit(t.tracked, t.hint, 'comment', { had: true, value: 'a' }, loreTypingKey('@0', 'comment')))
        edit(loreFieldEdit(t.tracked, t.hint, 'comment', { had: true, value: 'ab' }, loreTypingKey('@0', 'comment')))
        expect(doneOf()).toHaveLength(1)
        t = target(1)
        edit(loreFieldEdit(t.tracked, t.hint, 'comment', { had: true, value: 'c' }, loreTypingKey('@1', 'comment')))
        expect(doneOf()).toHaveLength(2)
    })
})

describe('T46b: duplicate and the version migration', () => {
    test('a classic v1 entry duplicated into a character equals the migrated clone with the new id; a chat copy is verbatim', async () => {
        // A version-1 entry as a risu v1 file or an old character carries it.
        const old = { ...row(0), bookVersion: 1, content: 'hi <user> @@end', activationPercent: 25 } as Row
        delete old.bookVersion
        await start([old], [clone(old)])
        const expected = migrateLoreEntryToV2(clone(old) as unknown as loreBook) as unknown as Row
        let t = target(0)
        expect(edit(loreDuplicate('character', t.tracked, t.hint, ids(['d1'])))).toEqual({ ok: true })
        expect(lore()[1]).toEqual({ ...expected, id: 'd1' })
        const chatTarget = trackedOf(chatLore() as unknown[], 0)!
        expect(edit(loreDuplicate('chat', chatTarget, 0, ids(['d2'])), C1)).toEqual({ ok: true })
        expect((chatLore() as Row[])[1]).toEqual({ ...old, id: 'd2' })
        t = target(0)
        expect(service.undo(A)).toEqual({ ok: true })
    })

    test('an entry edited in Studio still undoes after the load-time migration stamps the version in place', async () => {
        await start([row(0)])
        const t = target(0)
        edit(loreFieldEdit(t.tracked, t.hint, 'comment', { had: true, value: 'edited' }, null))
        migrateLoreEntryToV2(lore()[0] as unknown as loreBook)
        expect(lore()[0].bookVersion).toBe(2)
        expect(service.undo(A)).toEqual({ ok: true })
        expect(lore()[0].comment).toBe('Row 0')
    })
})
