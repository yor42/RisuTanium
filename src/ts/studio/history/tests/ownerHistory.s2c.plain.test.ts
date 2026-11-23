// @vitest-environment jsdom
// T2-BI-4 on a plain (non-reactive) holder: the list a write assigns is a copy, so the classic editor mutating a live row in
// place can never change a stored step, on the edit path and on the redo path. A reactive holder hides this, because its
// proxy keeps its own signals; the plain holder is the case where an assignment by reference would be shared.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { BiasRow } from '../fieldRegistry'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

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

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const liveRows = (): BiasRow[] => (DBState.db.characters[0] as unknown as { bias: BiasRow[] }).bias

async function ready(): Promise<OwnerHistoryService> {
    DBState.db.characters = [
        { chaId: 'A', name: 'A', type: 'character', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', alternateGreetings: [], chats: [], chatPage: 0, bias: [['a', 1], ['b', 2]] },
    ] as unknown as typeof DBState.db.characters
    const service = createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock: createFakeClock(1000),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
    await service.whenReady(A)
    return service
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
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

describe('T2-BI-4 (plain holder): the live list and the stored steps share nothing', () => {
    test('after an edit, a classic in-place mutation of the live rows changes no stored step', async () => {
        const service = await ready()
        service.editField(A, 'bias', [['a', 1], ['b', 2], ['c', 3]], { coalesceKey: null })
        const stored = JSON.stringify(service.view(A))
        liveRows()[0][0] = 'mutated'
        liveRows().push(['extra', 9])
        expect(JSON.stringify(service.view(A))).toBe(stored)
    })

    test('after an undo and a redo, the same holds', async () => {
        const service = await ready()
        service.editField(A, 'bias', [['a', 1], ['b', 2], ['c', 3]], { coalesceKey: null })
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        const afterUndo = JSON.stringify(service.view(A))
        liveRows()[0][0] = 'mutated after the undo'
        expect(JSON.stringify(service.view(A))).toBe(afterUndo)
        expect((await service.replay(A, { kind: 'redo' })).ok).toBe(false)
    })

    test('the list a redo writes is a copy of the step the redo came from', async () => {
        const service = await ready()
        service.editField(A, 'bias', [['a', 1], ['b', 2], ['c', 3]], { coalesceKey: null })
        await service.replay(A, { kind: 'undo' })
        expect((await service.replay(A, { kind: 'redo' })).ok).toBe(true)
        const stored = JSON.stringify(service.view(A))
        liveRows()[0][0] = 'mutated after the redo'
        liveRows().push(['extra', 1])
        expect(JSON.stringify(service.view(A))).toBe(stored)
    })
})
