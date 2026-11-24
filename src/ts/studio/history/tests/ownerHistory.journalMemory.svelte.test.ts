// @vitest-environment jsdom
// Diagnostic, skipped unless RISU_MEASURE_JOURNAL=1: what the visit journal keeps alive on top of the record's own
// window while one row's long text is typed, with the real service. Numbers on a desktop are best case; the stated
// budgets are for the conditional question of the S7 spec (10.1), not a cap in the code. The structural number is the
// gating one: the generated values share their base string (V8 cons and sliced strings), so the retained heap
// understates what flat textarea strings would hold.
//   $env:RISU_MEASURE_JOURNAL='1'; pnpm vitest run src/ts/studio/history/tests/ownerHistory.journalMemory.svelte.test.ts
import v8 from 'node:v8'
import vm from 'node:vm'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { COALESCE_MS, MAX_DONE } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import type { ObjFamilyOp } from '../objectListOps'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { golden, makeCharacter, putCharacter, row, textEdit, type LiveCharacter } from './objService.test-helpers'

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

vi.setConfig({ testTimeout: 120_000 })
v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const TEXT_LENGTH = 25_000
const BASE = '가'.repeat(TEXT_LENGTH)
const MIB = 1024 * 1024

let clock: FakeClock
let service: OwnerHistoryService
let visit = 'v1'

beforeEach(async () => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    const entry = { ...golden.blank.globalLore[0], content: BASE, comment: BASE }
    const character: LiveCharacter = makeCharacter({ globalLore: [entry, { ...row(1), content: BASE }] })
    putCharacter(character)
    clock = createFakeClock()
    visit = 'v1'
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => visit,
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    DBState.db.characters = []
})

// A distinct two-byte value of the same length: one character at a rotating position changes each time.
function valueAt(i: number): string {
    const position = i % TEXT_LENGTH
    return BASE.slice(0, position) + String.fromCharCode(0xac01 + (i % 2000)) + BASE.slice(position + 1)
}

// The bytes of the distinct strings the journal's ops hold (two bytes per character), found by walking the ops.
function journalStringBytes(): number {
    const seen = new Set<string>()
    const walk = (value: unknown): void => {
        if (typeof value === 'string') {
            seen.add(value)
        } else if (Array.isArray(value)) {
            value.forEach(walk)
        } else if (typeof value === 'object' && value !== null) {
            Object.values(value).forEach(walk)
        }
    }
    for (const entries of service.journalForTests(A).values()) {
        for (const entry of entries) {
            entry.ops.forEach((op: ObjFamilyOp) => walk(op))
        }
    }
    return [...seen].reduce((sum, text) => sum + text.length * 2, 0)
}

// (A): the heap the journal alone keeps alive, by releasing it at a new visit; (B): the structural count.
function measure(): { retained: number; structural: number } {
    gc()
    const structural = journalStringBytes()
    const before = process.memoryUsage().heapUsed
    visit = 'v2'
    service.view(A)
    gc()
    return { retained: before - process.memoryUsage().heapUsed, structural }
}

describe.skipIf(process.env.RISU_MEASURE_JOURNAL !== '1')('R9: what the visit journal retains', () => {
    test('run 1: 500 typing steps of one field merge into one entry that keeps about one value', () => {
        for (let i = 0; i < 500; i += 1) {
            expect(service.objEdit(A, textEdit(0, 'content', valueAt(i))).ok).toBe(true)
            clock.tick(COALESCE_MS + 1)
        }
        expect(service.journalForTests(A).get('lore')).toHaveLength(1)
        expect(service.view(A).done).toHaveLength(MAX_DONE)
        expect(service.view(A).restoreLines).toEqual([{ list: 'lore', n: 1 }])
        const result = measure()
        console.log('R9 run1', JSON.stringify(result))
        expect(result.retained).toBeLessThanOrEqual(256 * 1024)
        expect(result.structural).toBeLessThanOrEqual(128 * 1024)
    })

    test('run 2: 200 alternations between two fields of one row', () => {
        for (let i = 0; i < 200; i += 1) {
            expect(service.objEdit(A, textEdit(0, i % 2 === 0 ? 'content' : 'comment', valueAt(i))).ok).toBe(true)
            clock.tick(COALESCE_MS + 1)
        }
        const result = measure()
        console.log('R9 run2', JSON.stringify(result))
        expect(result.retained).toBeLessThanOrEqual(16 * MIB)
        expect(result.structural).toBeLessThanOrEqual(16 * MIB)
    })

    test('run 2b: 200 alternations of one field between two rows', () => {
        for (let i = 0; i < 200; i += 1) {
            expect(service.objEdit(A, textEdit(i % 2, 'content', valueAt(i))).ok).toBe(true)
            clock.tick(COALESCE_MS + 1)
        }
        const result = measure()
        console.log('R9 run2b', JSON.stringify(result))
        expect(result.retained).toBeLessThanOrEqual(16 * MIB)
        expect(result.structural).toBeLessThanOrEqual(16 * MIB)
    })
})

test('the forced-collection hook is available to the diagnostic', () => {
    expect(typeof gc).toBe('function')
})
