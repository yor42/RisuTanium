// @vitest-environment jsdom
// T39, field part: a field edit of one row of a 300 x 20 KB regex list, on a character and on a module, is stored as one
// small step and the restore point holds no list. Record size, save time and plan time are written to the console in
// MEASURE lines (a diagnostic, never asserted tightly); the assertions are that the step is stored after a reload, the
// restore holds no list and the owner's stored bytes stay far below the owner cap.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { regexFieldEdit, regexTypingKey } from 'src/ts/studio/edit/regexListOps'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey, SAVE_DEBOUNCE_MS, type OwnerKey } from '../ownerPhase'
import { CAP_BYTES } from '../studioHistoryStore'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from './studioStoreDoubles'
import { makeCharacter, putCharacter } from './objService.test-helpers'

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

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const COUNT = 300
const SIZE = 20_000

let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService

const hugeList = (): Entry[] =>
    Array.from({ length: COUNT }, (_, i) => ({ comment: `c${i}`, in: `<ROW${i}>` + 'x'.repeat(SIZE - 10), out: `o${i}`, type: 'editinput' }))

function createService(shared?: Map<string, string>): OwnerHistoryService {
    store = createMemoryStudioStore({ shared })
    return createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: shared === undefined ? 'p1' : 'p2',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
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
    DBState.db = { characters: [], modules: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

function storedBytes(shared: ReadonlyMap<string, string>, owner: OwnerKey): number {
    const stored = storedRecord(shared, owner as never)
    return (stored?.keys ?? []).reduce((sum, key) => sum + (shared.get(key)?.length ?? 0), 0)
}

describe('T39 (field part): a field edit of a huge regex list is one small stored step', () => {
    for (const [name, owner] of [['character', A], ['module', M1]] as const) {
        test(`${name}: one field edit, a save and a reload keep the step and no list in the restore point`, async () => {
            putCharacter({ ...makeCharacter(), customscript: hugeList() })
            DBState.db.modules = [{ id: 'M1', name: 'M1', assets: [], regex: hugeList() }] as unknown as typeof DBState.db.modules
            clock = createFakeClock()
            service = createService()
            await service.whenReady(A)
            await service.whenReady(M1)

            const started = performance.now()
            const result = service.objEdit(owner, regexFieldEdit(150, 'out', 'edited out', regexTypingKey('t1', 150, 'out')).build)
            const planMs = performance.now() - started
            expect(result.ok).toBe(true)

            const saveStarted = performance.now()
            await clock.advance(SAVE_DEBOUNCE_MS + 1)
            const saveMs = performance.now() - saveStarted
            const bytes = storedBytes(store.shared, owner)
            console.log(`MEASURE regexSize ${name} plan=${planMs.toFixed(1)}ms save=${saveMs.toFixed(1)}ms recordBytes=${bytes} listBytes=${COUNT * SIZE}`)
            expect(bytes).toBeGreaterThan(0)
            expect(bytes).toBeLessThan(CAP_BYTES)
            expect(bytes).toBeLessThan(COUNT * SIZE / 10)

            const reloaded = createService(new Map(store.shared))
            await reloaded.whenReady(owner)
            const view = reloaded.view(owner)
            expect(view.done).toHaveLength(1)
            expect(view.done[0].ops[0]).toMatchObject({ op: 'objSet', list: 'regex', index: 150, field: 'out', after: { had: true, value: 'edited out' } })
            const point = storedRecord(store.shared, owner as never)?.record.restore ?? null
            expect(point).not.toBeNull()
            const text = JSON.stringify(point)
            expect(text).not.toContain('<ROW0>')
            expect(text).not.toContain('<ROW150>')
            expect(Object.keys(point?.fields ?? {}).filter((path) => path.startsWith('customscript') || path.startsWith('regex'))).toEqual([])
        })
    }
})
