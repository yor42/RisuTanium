// @vitest-environment jsdom
// A character token bias list stored with malformed rows (a null cell, a 3-tuple, a non-array) is repaired to a valid
// `BiasRow[]` through `biasFix`: one history step whose undo puts the stored value back byte-for-byte.
import { describe, expect, test, vi } from 'vitest'

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

import { normalizeBiasRows } from 'src/ts/studio/edit/biasRows'
import { selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import type { BiasRow, SetPath } from 'src/ts/studio/history/fieldRegistry'
import { parseOwnerRecord } from 'src/ts/studio/history/historyModel'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { readBack } from 'src/ts/studio/history/tests/s1Records.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { liveCharacter, makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'

const BIAS_FIX = 'biasFix' as SetPath

function setup(stored: unknown) {
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    putCharacter({ ...makeCharacter(), name: 'Alice', viewScreen: 'none', type: 'character', bias: stored } as never)
    const key = characterOwnerKey('A')
    const clock = createFakeClock(1000)
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    const value = () => (liveCharacter() as unknown as Record<string, unknown>).bias
    return { key, clock, service, value }
}

describe('biasFix repairs a malformed character bias list', () => {
    // Regression reproducer: fails on origin/main without `biasFix`.
    test.each<[string, unknown, BiasRow[]]>([
        ['null cell', [['tok', null]], [['tok', 0]]],
        ['3-tuple', [['tok', 1, 'x']], [['tok', 1]]],
        ['non-array', 'x', []],
        ['mixed rows', [null, [123, '2.5']], [['123', 2.5]]],
    ])('regression reproducer (%s): editField on biasFix normalizes and undo restores stored bytes', async (_name, stored, repaired) => {
        const { key, clock, service, value } = setup(stored)
        await service.whenReady(key)
        expect(service.editField(key, BIAS_FIX, repaired)).toMatchObject({ ok: true })
        expect(value()).toEqual(repaired)

        clock.tick(60_000)
        expect(service.undo(key)).toMatchObject({ ok: true })
        expect(value()).toStrictEqual(stored)

        expect(service.redo(key)).toMatchObject({ ok: true })
        expect(value()).toEqual(repaired)
    })

    test('regression reproducer: readBack round-trips foreign malformed bias and rejects valid BiasRow[] wrapped as foreign', async () => {
        const { key, service } = setup([['tok', null]])
        await service.whenReady(key)
        expect(service.editField(key, BIAS_FIX, [['tok', 0]])).toMatchObject({ ok: true })
        const step = service.view(key).done[0]
        const record = { ownerKey: key, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }
        const loaded = readBack(record)
        expect(loaded).toEqual(record)
        expect(loaded?.done[0].ops).toEqual([
            { op: 'set', path: BIAS_FIX, before: { had: 'foreign', value: [['tok', null]] }, after: { had: true, value: [['tok', 0]] } },
        ])

        const invalidForeign = {
            ownerKey: key,
            touchedAt: 1,
            done: [{
                id: 'p:1',
                at: 1,
                label: { kind: 'field', field: BIAS_FIX },
                ops: [{ op: 'set', path: BIAS_FIX, before: { had: 'foreign', value: [['tok', 1]] }, after: { had: true, value: [['tok', 0]] } }],
            }],
            undone: [],
            deleted: [],
            restore: null,
        }
        expect(parseOwnerRecord(invalidForeign, key)).toBeNull()
    })

    // Compatibility guard: passes before and after; the base `bias` path keeps its normal behaviour.
    test('compatibility guard: a valid bias list still edits and undoes through the base bias path', async () => {
        const { key, clock, service, value } = setup([['a', 1]])
        await service.whenReady(key)
        expect(service.editField(key, 'bias', [['a', 2]])).toMatchObject({ ok: true })
        expect(value()).toEqual([['a', 2]])
        clock.tick(60_000)
        expect(service.undo(key)).toMatchObject({ ok: true })
        expect(value()).toEqual([['a', 1]])
    })

    test('normalizeBiasRows handles non-arrays, non-array entries, -0, NaN/Infinity, numeric strings, and out-of-range finite numbers', () => {
        expect(normalizeBiasRows(null)).toEqual([])
        expect(normalizeBiasRows('bad')).toEqual([])
        expect(normalizeBiasRows([null, 42, {}, ['a', -0], ['b', NaN], ['c', Infinity], ['d', ' 12.5 '], ['e', ''], [99, true], ['f', 250]])).toEqual([
            ['a', 0],
            ['b', 0],
            ['c', 0],
            ['d', 12.5],
            ['e', 0],
            ['99', 0],
            ['f', 250],
        ])
    })
})
