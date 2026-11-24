// @vitest-environment jsdom
// Per-list restore lines and the mixed-revert check, with a second list in the tables: `probe`, held by the character
// only (the data module and the session kinds are replaced by themselves plus the probe rows).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { planRevert, type LiveReader, type OwnerRecord } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { OBJ_LIST_MESSAGES } from '../objectLists'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { build, liveCharacter, makeCharacter, putCharacter, rows, textEdit } from './objService.test-helpers'

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
vi.mock('../objectLists', async (importOriginal) => {
    const original = await importOriginal<typeof import('../objectLists')>()
    return {
        ...original,
        OBJ_LIST_HOLDERS: { ...original.OBJ_LIST_HOLDERS, probe: { character: 'probeList' } },
        OBJ_LIST_FIELDS: { ...original.OBJ_LIST_FIELDS, probe: { fields: { x: 'text' }, labelOnly: [], refused: [] } },
        OBJ_LIST_IDENTITY: { ...original.OBJ_LIST_IDENTITY, probe: { id: null, folder: null, content: true } },
        OBJ_LIST_ANCHOR_EXCLUDED: { ...original.OBJ_LIST_ANCHOR_EXCLUDED, probe: [] },
        OBJ_LIST_ASSET_PREFIX: { ...original.OBJ_LIST_ASSET_PREFIX, probe: 'probe/' },
        OBJ_LIST_MESSAGES: {
            ...original.OBJ_LIST_MESSAGES,
            probe: { line: 'probeLine', changed: 'probeChanged', earlierVisit: 'probeEarlier', idTaken: 'probeIdTaken', mixed: 'probeMixed' },
        },
    }
})
vi.mock('../sessionKinds', async (importOriginal) => {
    const original = await importOriginal<typeof import('../sessionKinds')>()
    return {
        ...original,
        SESSION_OWNER_KINDS: { ...original.SESSION_OWNER_KINDS, probeSession: { setPaths: ['customModuleToggle'], objLists: ['probe'] } },
    }
})

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let service: OwnerHistoryService

// The probe list is not in the list-name type; the tables hold it for this file only.
const PROBE = 'probe' as 'lore'
const probeRows = (): { x: string }[] => [{ x: 'a' }, { x: 'b' }]
const live = (): Record<string, unknown> & { probeList: { x: string }[] } => liveCharacter() as unknown as Record<string, unknown> & { probeList: { x: string }[] }

function probeEdit(index: number, value: string) {
    return build(
        [{ op: 'objSet', list: PROBE, index, field: 'x', after: { had: true, value } }],
        { kind: 'obj', list: PROBE, action: 'edit', name: null, field: 'x' },
        `probe:${index}:x`,
    )
}

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    putCharacter({ ...makeCharacter({ globalLore: rows(2) }), probeList: probeRows() })
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    DBState.db.characters = []
})

describe('T58: lines are per list', () => {
    test('a visit editing lore and probe offers two lines', () => {
        expect(service.objEdit(A, textEdit(0, 'comment', 'lore edit')).ok).toBe(true)
        expect(service.objEdit(A, probeEdit(0, 'changed')).ok).toBe(true)
        expect(live().probeList[0].x).toBe('changed')
        expect(service.view(A).restoreLines).toEqual([{ list: 'lore', n: 1 }, { list: PROBE, n: 1 }])
    })

    test('an outside change to probe refuses only the probe line; the lore line applies', () => {
        service.objEdit(A, textEdit(0, 'comment', 'lore edit'))
        service.objEdit(A, probeEdit(0, 'changed'))
        live().probeList[0].x = 'outside'
        const result = service.restore(A, new Set(), { lines: ['lore', PROBE] })
        expect(result).toMatchObject({ ok: true, linesRefused: [PROBE] })
        expect((liveCharacter().globalLore as { comment: string }[])[0].comment).toBe('Row 0')
        expect(live().probeList[0].x).toBe('outside')
        expect(service.view(A).restoreLines).toEqual([{ list: PROBE, n: 1 }])
    })

    test('a list the character does not hold in this world is refused as an unreadable list', () => {
        const result = service.objEdit(A, build(
            [{ op: 'objInsert', list: 'regex' as 'lore', index: 0, entry: { x: 'a' } }],
            { kind: 'obj', list: 'lore', action: 'add', name: null },
        ))
        expect(result).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('T58: the mixed-revert check follows each list\'s own prefix', () => {
    const liveReader: LiveReader = { field: () => ({ had: false }), greetings: () => null, fmIndex: () => null, objList: () => [] }
    const setOp = { op: 'objSet', list: 'probe', index: 0, field: 'x', before: { had: true, value: 'a' }, after: { had: true, value: 'b' }, anchorBefore: 1, anchorAfter: 2 }
    const textOp = { op: 'textEdit', target: 'probe/0/x', offset: 0, from: '', to: 'x' }
    const stepOf = (id: string, ops: unknown[], label: unknown): unknown => ({ id, at: 1, label, ops })

    test('a range with probe obj ops and a text edit under probe/ is refused with probe mixed', () => {
        const record = {
            ownerKey: A,
            touchedAt: 1,
            done: [
                stepOf('s1', [], { kind: 'restorePoint' }),
                stepOf('s2', [setOp], { kind: 'obj', list: 'probe', action: 'edit', name: null, field: 'x' }),
                stepOf('s3', [textOp], { kind: 'field', field: 'desc' }),
            ],
            undone: [],
            deleted: [],
            restore: null,
        } as unknown as OwnerRecord
        expect(planRevert(record, 's1', liveReader)).toEqual({ ok: false, reason: 'precondition', obj: { list: PROBE, kind: 'mixed' } })
    })

    test('the real table keeps the five lore message keys', () => {
        expect(OBJ_LIST_MESSAGES.lore).toEqual({
            line: 'studioLoreRestoreLine',
            changed: 'studioLoreRestoreChanged',
            earlierVisit: 'studioLoreRestoreEarlierVisit',
            idTaken: 'studioLoreRestoreIdTaken',
            mixed: 'studioLoreRevertMixed',
        })
    })
})
