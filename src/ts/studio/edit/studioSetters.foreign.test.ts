// @vitest-environment jsdom
// A character written by a card import stores `prebuiltAssetCommand: ''`, a value the boolean path does not hold. The
// undo of an edit must put that stored value back byte-for-byte, and the redo must write the new value again.
import { expect, test, vi } from 'vitest'

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

import { selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { liveCharacter, makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'

function setup(stored: unknown) {
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    putCharacter({ ...makeCharacter(), name: 'Alice', viewScreen: 'none', type: 'character', prebuiltAssetCommand: stored } as never)
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
    const value = () => (liveCharacter() as unknown as Record<string, unknown>).prebuiltAssetCommand
    return { key, clock, service, value }
}

// Regression reproducer: undo must restore a foreign stored value (not a coerced boolean) byte-for-byte.
test('regression reproducer: undo of an edit on a card-import-shaped prebuiltAssetCommand restores the stored empty string, redo writes true', async () => {
    const { key, clock, service, value } = setup('')
    await service.whenReady(key)
    expect(value()).toBe('')

    expect(service.editField(key, 'prebuiltAssetCommand', true)).toMatchObject({ ok: true })
    expect(value()).toBe(true)

    clock.tick(60_000)
    expect(service.undo(key)).toMatchObject({ ok: true })
    expect(value()).toBe('')
    expect(service.view(key).undone).toHaveLength(1)

    expect(service.redo(key)).toMatchObject({ ok: true })
    expect(value()).toBe(true)
})

// Compatibility guard: passes before and after; a genuine boolean keeps round-tripping as a boolean.
test('compatibility guard: undo on a character whose stored value is a genuine boolean still restores the boolean', async () => {
    const { key, clock, service, value } = setup(false)
    await service.whenReady(key)
    expect(service.editField(key, 'prebuiltAssetCommand', true)).toMatchObject({ ok: true })
    clock.tick(60_000)
    expect(service.undo(key)).toMatchObject({ ok: true })
    expect(value()).toBe(false)
})
