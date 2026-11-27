// @vitest-environment jsdom
// The risky-flag fix row `lowLevelAccessFix` and its base row `lowLevelAccess` are two registry paths over one holder
// property. Over the real registry rows (no mock) a restore to the start of a visit keeps one entry for the pair under the
// fix slot, returns the visit-start value with no false changed-elsewhere, and asks the turn-on question for the fix
// path. An undo back to a truthy foreign value asks as well. Real service, model and setters over the memory store double.
// The first two tests are regression reproducers: each fails when the restore slot is removed. The third is a compatibility
// guard on the generic confirmation gate and passes with or without the slot.
import { describe, expect, test, vi } from 'vitest'
import { selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import type { SetPath } from '../fieldRegistry'
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

const BASE = 'lowLevelAccess' as SetPath
const FIX = 'lowLevelAccessFix' as SetPath

// A character whose stored `lowLevelAccess` is the foreign number 1, opened for editing in visit `vA`.
async function open() {
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
    await service.whenReady(key)
    return {
        service,
        key,
        clock,
        setVisit: (next: string) => {
            visit = next
        },
        value: (): unknown => (liveCharacter() as unknown as Record<string, unknown>).lowLevelAccess,
    }
}

// Visit A fixes the stored 1 to false through the fix path; visit B turns it on through the base path; visit C starts
// at true, turns it off, and undoes every step back to the stored 1.
async function acrossVisits() {
    const ctx = await open()
    const { service, key, clock, setVisit, value } = ctx
    expect(service.editField(key, FIX, false, { coalesceKey: null })).toMatchObject({ ok: true })
    clock.tick(60_000)
    setVisit('vB')
    expect(service.editField(key, 'desc', 'd1', { coalesceKey: null })).toMatchObject({ ok: true })
    clock.tick(60_000)
    expect(service.editField(key, BASE, true, { confirmed: [BASE], coalesceKey: null })).toMatchObject({ ok: true })
    clock.tick(60_000)
    setVisit('vC')
    expect(value()).toBe(true)
    expect(service.editField(key, BASE, false, { coalesceKey: null })).toMatchObject({ ok: true })
    clock.tick(60_000)
    for (let undone = 0; undone < 4; undone += 1) {
        await expect(service.replay(key, { kind: 'undo', confirmed: [BASE, FIX] })).resolves.toMatchObject({ ok: true })
    }
    expect(value()).toBe(1)
    return ctx
}

describe('restore to the start of a visit over the risky fix rows', () => {
    test('the restore returns the visit start value, reports nothing changed elsewhere and keeps the fix slot only', async () => {
        const { service, key, value } = await acrossVisits()
        const result = service.restore(key, new Set(), { confirmed: [FIX] })
        expect(result).toMatchObject({ ok: true, changedElsewhere: [] })
        expect(value()).toBe(true)
        const fields = Object.keys(service.view(key).restore?.fields ?? {})
        expect(fields).toContain(FIX)
        expect(fields).not.toContain(BASE)
    })

    test('a restore that really turns the flag on is refused naming the fix path, and applies when that path is confirmed', async () => {
        const { service, key, clock, setVisit, value } = await open()
        expect(service.editField(key, FIX, false, { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        setVisit('vB')
        expect(service.editField(key, 'desc', 'd1', { coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        expect(service.editField(key, BASE, true, { confirmed: [BASE], coalesceKey: null })).toMatchObject({ ok: true })
        clock.tick(60_000)
        setVisit('vC')
        expect(service.editField(key, BASE, false, { coalesceKey: null })).toMatchObject({ ok: true })
        expect(value()).toBe(false)
        expect(service.restore(key, new Set())).toEqual({ ok: false, reason: 'riskyConfirm', paths: [FIX] })
        expect(value()).toBe(false)
        expect(service.restore(key, new Set(), { confirmed: [BASE] })).toMatchObject({ ok: false, reason: 'riskyConfirm', paths: [FIX] })
        expect(value()).toBe(false)
        expect(service.restore(key, new Set(), { confirmed: [FIX] })).toMatchObject({ ok: true })
        expect(value()).toBe(true)
    })
    test('an undo back to a truthy foreign value is refused without the confirmation and lands with it', async () => {
        const { service, key, value } = await open()
        expect(service.editField(key, FIX, false, { coalesceKey: null })).toMatchObject({ ok: true })
        expect(value()).toBe(false)
        const refused = await service.replay(key, { kind: 'undo' })
        expect(refused).toMatchObject({ ok: false, reason: 'riskyConfirm', paths: [FIX] })
        expect(value()).toBe(false)
        await expect(service.replay(key, { kind: 'undo', confirmed: [FIX] })).resolves.toMatchObject({ ok: true })
        expect(value()).toStrictEqual(1)
    })
})
