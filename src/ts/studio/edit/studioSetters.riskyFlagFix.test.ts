// @vitest-environment jsdom
// A character risky flag stored as a non-boolean (a classic-editor or card-import value) is set to a real boolean by the
// `...Fix` path of the flag: one history step whose undo puts the stored value back byte-for-byte.
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

import { selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import type { SetPath } from 'src/ts/studio/history/fieldRegistry'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { readBack } from 'src/ts/studio/history/tests/s1Records.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { liveCharacter, makeCharacter, putCharacter } from 'src/ts/studio/history/tests/objService.test-helpers'

const FLAGS = ['lowLevelAccess', 'utilityBot', 'escapeOutput'] as const
const fixOf = (flag: (typeof FLAGS)[number]) => `${flag}Fix` as SetPath

function setup(flag: (typeof FLAGS)[number], stored: unknown) {
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    putCharacter({ ...makeCharacter(), name: 'Alice', viewScreen: 'none', type: 'character', [flag]: stored } as never)
    const key = characterOwnerKey('A')
    const clock = createFakeClock(1000)
    const store = createMemoryStudioStore()
    const service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    const value = () => (liveCharacter() as unknown as Record<string, unknown>)[flag]
    return { key, clock, store, service, value }
}

describe.each(FLAGS)('%s stored as a non-boolean', (flag) => {
    // Regression reproducer: fails on a base without the Fix paths.
    test.each([0, 1, '', 'yes', null])('regression reproducer: %j is set to a real false as one step and undo restores it', async (stored) => {
        const { key, clock, service, value } = setup(flag, stored)
        await service.whenReady(key)
        expect(service.editField(key, fixOf(flag), false)).toMatchObject({ ok: true })
        expect(value()).toBe(false)
        clock.tick(60_000)
        await expect(service.replay(key, { kind: 'undo', confirmed: [fixOf(flag)] })).resolves.toMatchObject({ ok: true })
        expect(value()).toStrictEqual(stored)
        expect(service.redo(key)).toMatchObject({ ok: true })
        expect(value()).toBe(false)
    })

    test('regression reproducer: turning a non-boolean on needs the confirmation, then writes a real true', async () => {
        const { key, clock, service, value } = setup(flag, 0)
        await service.whenReady(key)
        expect(service.editField(key, fixOf(flag), true)).toMatchObject({ ok: false, reason: 'riskyConfirm', paths: [fixOf(flag)] })
        expect(value()).toBe(0)
        expect(service.editField(key, fixOf(flag), true, { confirmed: [fixOf(flag)] })).toMatchObject({ ok: true })
        expect(value()).toBe(true)
        clock.tick(60_000)
        expect(service.undo(key)).toMatchObject({ ok: true })
        expect(value()).toBe(0)
    })

    // Compatibility guard: passes before and after; the base path keeps its boolean behaviour.
    test('compatibility guard: a stored boolean still turns off and back through the base path', async () => {
        const { key, clock, service, value } = setup(flag, true)
        await service.whenReady(key)
        expect(service.editField(key, flag, false)).toMatchObject({ ok: true })
        expect(value()).toBe(false)
        clock.tick(60_000)
        await expect(service.replay(key, { kind: 'undo', confirmed: [flag] })).resolves.toMatchObject({ ok: true })
        expect(value()).toBe(true)
    })

    test('readBack round-trips the foreign before-value on the Fix path through the history store', async () => {
        const { key, service } = setup(flag, 'yes')
        await service.whenReady(key)
        expect(service.editField(key, fixOf(flag), false)).toMatchObject({ ok: true })
        const step = service.view(key).done[0]
        const record = { ownerKey: key, touchedAt: 1, done: [step], undone: [], deleted: [], restore: null }
        const loaded = readBack(record)
        expect(loaded).toEqual(record)
        expect(loaded?.done[0].ops).toEqual([
            { op: 'set', path: fixOf(flag), before: { had: 'foreign', value: 'yes' }, after: { had: true, value: false } },
        ])
    })
})
