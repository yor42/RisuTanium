// @vitest-environment jsdom
// A restore to the start of a visit over two registry paths that alias one holder property: after undos that cross
// visits, the restore returns the visit-start value and reports nothing changed elsewhere. Real service, model and
// setters over the memory store double, on the real registry rows `lowLevelAccess` and `lowLevelAccessFix`.
// Regression reproducer (T1).
import { describe, expect, test, vi } from 'vitest'
import { selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { BASE, FIX } from './aliasRegistry.test-helpers'
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
// A replay of a base-path step asks for the base path and a restore for the slot path (the fix row); both are confirmed.
const CONFIRMED = [BASE, FIX]

describe('restore over aliased paths', () => {
    test('T1: after undos across visits the restore returns the visit start value with no false changed-elsewhere', async () => {
        const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
        resetCharacterSaveMarksForTest()
        installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
        resetStudioScreenForTests()
        selIdState.selId = 0
        studioScreen.chaId = 'A'
        putCharacter({ ...makeCharacter(), name: 'Alice', viewScreen: 'none', type: 'character', lowLevelAccess: 1 })
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
        const value = (): unknown => (liveCharacter() as unknown as Record<string, unknown>).lowLevelAccess
        await service.whenReady(key)

        // Visit A: the stored 1 is fixed to a real false through the alias row.
        expect(service.editField(key, FIX, false, { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        // Visit B: turned on through the base row.
        visit = 'vB'
        expect(service.editField(key, 'desc', 'd1', { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        expect(service.editField(key, BASE, true, { confirmed: [BASE], coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        // Visit C starts at true: turn off through the base row, then undo all four steps.
        visit = 'vC'
        expect(value()).toBe(true)
        expect(service.editField(key, BASE, false, { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        await expect(service.replay(key, { kind: 'undo', confirmed: CONFIRMED })).resolves.toMatchObject({ ok: true })
        expect(value()).toBe(true)
        await expect(service.replay(key, { kind: 'undo', confirmed: CONFIRMED })).resolves.toMatchObject({ ok: true })
        expect(value()).toBe(false)
        await expect(service.replay(key, { kind: 'undo', confirmed: CONFIRMED })).resolves.toMatchObject({ ok: true })
        await expect(service.replay(key, { kind: 'undo', confirmed: CONFIRMED })).resolves.toMatchObject({ ok: true })
        expect(value()).toBe(1)

        // Restoring to the start of visit C is the value visit B left: true.
        const result = service.restore(key, new Set(), { confirmed: CONFIRMED })
        expect(result).toMatchObject({ ok: true, changedElsewhere: [] })
        expect(value()).toBe(true)
        const fields = Object.keys(service.view(key).restore?.fields ?? {})
        expect(fields).toContain(FIX)
        expect(fields).not.toContain(BASE)
        clock.tick(60_000)

        const back = await service.replay(key, { kind: 'undo', confirmed: CONFIRMED })
        expect(back).toMatchObject({ ok: true })
        expect(back.ok === true ? (back.skipped ?? 0) : -1).toBe(0)
    })
})
