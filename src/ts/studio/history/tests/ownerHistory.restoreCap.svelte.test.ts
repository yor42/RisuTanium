// @vitest-environment jsdom
// An owner whose restore point alone passes its share of the store (a large alternate greetings list is stored whole
// in the restore point) keeps its newest steps and deleted items across a reload; the restore point gives way first.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

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

interface LiveCharacter {
    chaId: string
    desc: string
    firstMessage: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex: number }[]
    chatPage: number
}

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

function build(shared?: Map<string, string>) {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({ shared })
    const service: OwnerHistoryService = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
    })
    return { clock, store, service }
}

function bigCharacter(): LiveCharacter {
    // 600 greetings of 1000 characters: the restore point stores the list twice, which passes the owner cap.
    const alternateGreetings = Array.from({ length: 600 }, (_, at) => `${at}`.padEnd(1000, 'x'))
    return { chaId: 'A', desc: 'd0', firstMessage: 'M', alternateGreetings, chats: [{ id: 'c1', note: '', fmIndex: -1 }], chatPage: 0 }
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    DBState.db.characters = [bigCharacter()] as unknown as typeof DBState.db.characters
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('#716: an over-cap restore point gives way before the owner’s newer steps and deleted items', () => {
    test('a greeting delete and an edit on a large list keep their steps and deleted item across a reload, and the restore point is the one dropped', async () => {
        const first = build()
        await first.service.whenReady(A)
        expect(first.service.greetingDelete(A, 5).ok).toBe(true)
        expect(first.service.greetingEdit(A, 0, 'edited').ok).toBe(true)
        const before = first.service.view(A)
        expect(before.restore).not.toBeNull()
        await first.clock.advance(SAVE_DEBOUNCE_MS)

        const second = build(first.store.shared)
        await second.service.whenReady(A)
        const view = second.service.view(A)
        expect(view.done.length).toBe(before.done.length)
        expect(view.deleted.length).toBe(before.deleted.length)
        expect(view.deleted.length).toBeGreaterThan(0)
        expect(view.restore).toBeNull()
    })
})
