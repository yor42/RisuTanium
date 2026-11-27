// @vitest-environment jsdom
// The token bias rows `bias` and `biasFix` are two registry paths over one holder property, and `biasFix` is their shared
// restore slot. Over the real registry rows (no mock) a stored malformed bias list is repaired through `biasFix` in
// visit A and edited through `bias` in visit B and C; a restore to the start of visit C returns the visit-start list,
// reports nothing changed elsewhere and keeps one restore entry, keyed `biasFix`. Real service, model and setters over
// the memory store double.
// The first test is a regression reproducer: it fails when the restore slot is removed (`restoreSlotOf` as the identity).
// The second is a compatibility guard on the repair and undo path alone and passes with or without the slot.
import { describe, expect, test, vi } from 'vitest'
import { selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'
import { liveCharacter, makeCharacter, putCharacter } from './objService.test-helpers'

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

const MALFORMED = 'not-a-list'

// A character whose stored `bias` is a non-array value, opened for editing in visit `vA`.
async function open() {
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    putCharacter({ ...makeCharacter(), name: 'Alice', viewScreen: 'none', type: 'character', bias: MALFORMED })
    const key = characterOwnerKey('A')
    const clock = createFakeClock(1000)
    let visit = 'vA'
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => visit,
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(key)
    return {
        service,
        key,
        clock,
        setVisit: (next: string) => {
            visit = next
        },
        value: (): unknown => (liveCharacter() as unknown as Record<string, unknown>).bias,
    }
}

describe('restore to the start of a visit over the bias rows', () => {
    test('the restore returns the visit start list, reports nothing changed elsewhere and keeps the biasFix slot only', async () => {
        const { service, key, clock, setVisit, value } = await open()
        expect(service.editField(key, 'biasFix', [['a', 1]], { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        setVisit('vB')
        expect(service.editField(key, 'desc', 'd1', { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        expect(service.editField(key, 'bias', [['a', 1], ['b', 2]], { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        setVisit('vC')
        expect(service.editField(key, 'bias', [['c', 3]], { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        for (let undone = 0; undone < 4; undone += 1) {
            await expect(service.replay(key, { kind: 'undo' })).resolves.toMatchObject({ ok: true })
        }
        expect(value()).toBe(MALFORMED)
        const result = service.restore(key, new Set())
        expect(result).toMatchObject({ ok: true, changedElsewhere: [] })
        expect(value()).toEqual([['a', 1], ['b', 2]])
        const fields = Object.keys(service.view(key).restore?.fields ?? {})
        expect(fields).toContain('biasFix')
        expect(fields).not.toContain('bias')
    })

    test('the repair is one undoable step and an undo returns the stored malformed value', async () => {
        const { service, key, value } = await open()
        expect(service.editField(key, 'biasFix', [['a', 1]], { coalesceKey: null })).toMatchObject({ ok: true })
        expect(value()).toEqual([['a', 1]])
        await expect(service.replay(key, { kind: 'undo' })).resolves.toMatchObject({ ok: true })
        expect(value()).toBe(MALFORMED)
    })
})
