// @vitest-environment jsdom
// The records the real S7 service writes, one per owner kind, holding every op, label and item shape. The test always
// produces the records and asserts they equal the committed `fixtures/s7Records.json`, so a change to what the writer
// emits fails here; the file is rewritten only with RISU_WRITE_S7_RECORDS=1. A pre-S7 reader must refuse every one of
// these (checked once outside the repository, see the S7-0 plan), so the file is also that check's input.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { parseOwnerRecord } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { addRow, build, deleteRows, golden, liveCharacter, makeCharacter, putCharacter, row, rows, textEdit } from './objService.test-helpers'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 's7Records.json')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const A = characterOwnerKey('A')
const C1 = chatOwnerKey('A', 'c1')
const M1 = moduleOwnerKey('M1')

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// One owner's session through the real service, one step per shape, on rows of the classic producers' golden.
async function produce(): Promise<Record<'character' | 'chat' | 'module', unknown>> {
    putCharacter(makeCharacter({ globalLore: [...rows(3), golden.folderWithId.globalLore[0]], chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: rows(3) }] }))
    DBState.db.modules = [{ id: 'M1', name: 'M1', lorebook: rows(3) }] as unknown as typeof DBState.db.modules
    const clock = createFakeClock(1000)
    const service: OwnerHistoryService = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    const out: Partial<Record<'character' | 'chat' | 'module', unknown>> = {}
    const lap = (): void => clock.tick(60_000)
    for (const [kind, owner] of [['character', A], ['chat', C1], ['module', M1]] as const) {
        await service.whenReady(owner)
        const steps = [
            textEdit(0, 'content', 'edited body', null),
            addRow(1, { ...row(9), loreCache: { unknown: 'kept' } }),
            deleteRows([2, 0], `D-${kind}`),
        ]
        for (const step of steps) {
            const result = service.objEdit(owner, step)
            if (!result.ok) {
                throw new Error(`${kind} step refused: ${JSON.stringify(result)}`)
            }
            lap()
        }
        if (kind === 'character') {
            const props = service.objEdit(owner, build([
                { op: 'propSet', prop: 'loreSettings', after: { had: true, value: { tokenBudget: 800 } } },
                { op: 'propSet', prop: 'loreExt', after: { had: true, value: { depth: 2 } } },
            ], { kind: 'prop', prop: 'loreSettings' }))
            lap()
            if (!props.ok || !service.editValue(owner, 'lorePlus', true).ok) {
                throw new Error('character prop or lorePlus step refused')
            }
        }
        const view = service.view(owner)
        out[kind] = { ownerKey: owner, touchedAt: clock.now(), done: view.done, undone: view.undone, deleted: view.deleted, restore: view.restore }
    }
    return JSON.parse(JSON.stringify(out))
}

describe('F4: the records the S7 writer produces', () => {
    test('they equal the committed fixture, and every one reads back through the strict parser', async () => {
        const produced = await produce()
        if (process.env.RISU_WRITE_S7_RECORDS === '1') {
            writeFileSync(FIXTURE, JSON.stringify(produced, null, 2) + '\n')
        }
        const committed = JSON.parse(readFileSync(FIXTURE, 'utf8'))
        expect(produced).toEqual(committed)
        for (const [kind, key] of [['character', A], ['chat', C1], ['module', M1]] as [keyof typeof produced, StoredOwnerKey][]) {
            expect(parseOwnerRecord(JSON.parse(JSON.stringify(produced[kind])), key), kind).toEqual(produced[kind])
        }
        expect(liveCharacter().chaId).toBe('A')
    })

    test('the records hold every op name, both labels, the obj item and the lorePlus step', async () => {
        const text = JSON.stringify(await produce())
        for (const needle of ['"objSet"', '"objInsert"', '"objRemove"', '"propSet"', '"kind":"prop"', '"kind":"obj"', '"entries"', '"path":"lorePlus"']) {
            expect(text, needle).toContain(needle)
        }
    })
})
