// @vitest-environment jsdom
// T40: an over-share regex import (300 entries of about 20 KB each) through the real owner history service and the memory
// store. This pins today's keep walk and changes with #716: the stored copy of an owner over its share keeps the deleted
// items and stops at the first step that does not fit, so after the save the import step, every older step and the restore
// point are gone from the stored record while the deleted item stays. In memory the import still undoes. The MEASURE lines
// record the stored size and the timings of the save, the import plan and the undo plan.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock, type FakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'
import type { PlainToastInit } from 'src/ts/toast/toastHost.svelte'
import { runRegexImport } from '../../edit/regexFileActions'
import { regexDelete, type RegexOp } from '../../edit/regexListOps'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(async () => true),
    AppendableBuffer: class {},
}))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})
vi.mock('src/ts/storage/database.svelte', async () => {
    const { DBState: state } = await import('src/ts/stores.svelte')
    return { getDatabase: () => state.db, getCurrentCharacter: vi.fn(), getCurrentChat: vi.fn(), defaultSdDataFunc: () => [] }
})
vi.mock('src/ts/util', () => ({ selectSingleFile: vi.fn(async () => null) }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('src/ts/exportNotice', () => ({ downloadNotice: vi.fn() }))
vi.mock('src/ts/parser/parser.svelte', () => ({ assetRegex: {}, risuChatParser: vi.fn() }))
vi.mock('src/ts/process/modules', () => ({ getModuleAssets: vi.fn(() => []), getModuleRegexScripts: vi.fn(() => []) }))
vi.mock('src/ts/process/memory/hypamemory', () => ({ HypaProcesser: class {} }))
vi.mock('src/ts/process/scriptings', () => ({ runLuaEditTrigger: vi.fn() }))
vi.mock('src/ts/plugins/plugins.svelte', () => ({ pluginV2: {} }))
vi.mock('src/ts/process/triggers', () => ({ runTrigger: vi.fn() }))

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')
const ENTRY_COUNT = 300
const ENTRY_BYTES = 20 * 1024
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

let service: OwnerHistoryService
let clock: FakeClock
let store: MemoryStudioStore
let toasts: PlainToastInit[]

const smallRow = (): Entry => ({ comment: 'small', in: 's', out: 's', type: 'editinput' })

function liveList(owner: OwnerKey): unknown[] {
    if (owner === M1) return (DBState.db.modules as unknown as { regex: unknown[] }[])[0].regex
    return (DBState.db.characters as unknown as { customscript: unknown[] }[])[0].customscript
}

const runOn = (owner: OwnerKey) => (op: RegexOp) => service.objEdit(owner, op.build)

// 300 distinct entries of about 20 KB each, written as a regex export file.
function bigFile(): Uint8Array {
    const entries = Array.from({ length: ENTRY_COUNT }, (_, n): Entry => ({
        comment: `Big ${n}`,
        in: `${n}:`.padEnd(ENTRY_BYTES, 'a'),
        out: 'b',
        type: 'editinput',
    }))
    return new TextEncoder().encode(JSON.stringify({ type: 'regex', data: entries }))
}

async function start(list: unknown[]): Promise<void> {
    putCharacter({ ...makeCharacter(), customscript: structuredClone(list) })
    DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], regex: structuredClone(list) }] as unknown as typeof DBState.db.modules
    clock = createFakeClock()
    store = createMemoryStudioStore()
    service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    await service.whenReady(A)
    await service.whenReady(M1)
}

// A field edit of the owner makes its restore point, so the stored `restore` is present before the import.
function editRestoreField(owner: OwnerKey): void {
    const result = owner === M1 ? service.editField(M1, 'moduleHideIcon', true) : service.editField(A, 'desc', 'edited')
    expect(result).toEqual({ ok: true })
}

beforeEach(() => {
    h.marks = 0
    toasts = []
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    DBState.db = { characters: [], modules: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe.each([['character', A], ['module', M1]] as const)('T40: an over-share import after a small delete (%s owner)', (name, owner) => {
    test('the stored record keeps the deleted item and drops the import step, older steps and the restore point; undo still applies in memory', async () => {
        await start([smallRow()])

        // One small delete first, so a deleted item exists, then a field edit so the stored record holds a restore point.
        expect(runOn(owner)(regexDelete(smallRow(), 0))).toMatchObject({ ok: true })
        editRestoreField(owner)
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const control = storedRecord(store.shared, owner as never)
        expect(control).not.toBeNull()
        expect(control?.record.deleted).toHaveLength(1)
        expect(control?.record.restore).not.toBeNull()
        expect(liveList(owner)).toHaveLength(0)

        const file = bigFile()
        const planStart = performance.now()
        await runRegexImport(() => true, runOn(owner), { pick: async () => ({ name: 'regex.json', data: file }), toast: (init) => { toasts.push(init) } })
        const importMs = performance.now() - planStart
        expect(liveList(owner)).toHaveLength(ENTRY_COUNT)
        expect(toasts.map((toast) => toast.kind)).toEqual(['info'])

        const saveStart = performance.now()
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const saveMs = performance.now() - saveStart

        const stored = storedRecord(store.shared, owner as never)
        expect(stored).not.toBeNull()
        expect(stored?.record.deleted).toHaveLength(1)
        expect(stored?.record.done).toHaveLength(0)
        expect(stored?.record.restore).toBeNull()
        expect(service.view(owner).banner).toBe('trimmed')

        // The session keeps every step: the import undoes in memory.
        expect(service.view(owner).done.length).toBeGreaterThan(0)
        const undoStart = performance.now()
        const undone = service.undo(owner)
        const undoMs = performance.now() - undoStart
        expect(undone).toEqual({ ok: true })
        expect(liveList(owner)).toHaveLength(0)

        console.log(`MEASURE regexImportSize ${name} recordBytes=${stored?.header.size} fileBytes=${file.length} saveMs=${saveMs.toFixed(1)} importPlanMs=${importMs.toFixed(1)} undoPlanMs=${undoMs.toFixed(1)}`)
    })
})
