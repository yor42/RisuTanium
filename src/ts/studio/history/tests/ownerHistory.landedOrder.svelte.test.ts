// @vitest-environment jsdom
// The order of a landed Studio write: the record is assigned, the history save is armed (in `ready`), and only then do
// the notifications run (`noteEdit`, `onLanded`). A callback that throws after a landed write therefore never leaves
// the step without a save: the step stays on top and its save runs. Real service, real history model and real setters
// over the memory store double; the page database and its save marks are plain objects.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

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

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets: string[][]
    emotionImages: string[][]
}

const A = characterOwnerKey('A')

function makeCharacter(chaId: string): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        alternateGreetings: ['g0', 'g1'],
        chats: [{ id: 'c1', note: '', fmIndex: 0 }],
        chatPage: 0,
        additionalAssets: [['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png'], ['wave', 'assets/wave.png', 'png']],
        emotionImages: [['happy', 'assets/happy.png']],
    }
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    service: OwnerHistoryService
    landed: [OwnerKey, string | null][]
    // While set, `onLanded` records the call and then throws.
    throwOnLanded: boolean
}

let harness: Harness

function build(): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore()
    const built: Harness = { clock, store, landed: [], throwOnLanded: false, service: undefined as unknown as OwnerHistoryService }
    built.service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        onLanded: (owner, top) => {
            built.landed.push([owner, top])
            if (built.throwOnLanded) {
                throw new Error('onLanded')
            }
        },
    })
    return built
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [makeCharacter('A')] as unknown as typeof DBState.db.characters
    DBState.db.modules = []
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    harness = build()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

// The owner is ready and every save it started has finished, so the next save count is a delta of the action under test.
async function readyAndSettled(): Promise<number> {
    await harness.service.whenReady(A)
    await drainMicrotasks()
    return harness.store.counts.save
}

describe('a callback that throws after a landed write leaves the step with its save armed', () => {
    test('a throwing landed callback after an asset delete in ready: the step is on top and its save runs', async () => {
        const saved = await readyAndSettled()
        harness.throwOnLanded = true

        expect(() => harness.service.assetDelete(A, 'additionalAssets', [1])).toThrow('onLanded')

        expect(harness.service.view(A).done).toHaveLength(1)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile', 'wave'])
        await drainMicrotasks()
        expect(harness.store.counts.save).toBe(saved + 1)
    })

    test('a throwing landed callback after a replay that finds its step already in place: the move is saved', async () => {
        await readyAndSettled()
        expect(harness.service.editField(A, 'desc', 'typed').ok).toBe(true)
        harness.service.closeOpenStep(A)
        // The earlier step's save is settled first, so only the save of the replay below can add to the count.
        await harness.clock.advance(SAVE_MAX_WAIT_MS)
        expect(harness.clock.pendingTimers()).toBe(0)
        const saved = harness.store.counts.save
        live().desc = 'd0'
        harness.throwOnLanded = true

        expect(() => harness.service.undo(A)).toThrow('onLanded')

        expect(harness.service.view(A).undone).toHaveLength(1)
        expect(harness.service.view(A).done).toHaveLength(0)
        await harness.clock.advance(SAVE_DEBOUNCE_MS)
        expect(harness.store.counts.save).toBe(saved + 1)
    })

    test('a throwing edit acknowledgement after an asset delete in ready: the step is on top and its save runs', async () => {
        const saved = await readyAndSettled()
        harness.service.setAck('A', {
            noteEdit: () => {
                throw new Error('noteEdit')
            },
        })

        expect(() => harness.service.assetDelete(A, 'additionalAssets', [1])).toThrow('noteEdit')

        expect(harness.service.view(A).done).toHaveLength(1)
        await drainMicrotasks()
        expect(harness.store.counts.save).toBe(saved + 1)
    })
})

describe('a write whose callbacks do not throw', () => {
    test('the landed callback sees the new top step, and exactly one save follows an asset delete', async () => {
        const saved = await readyAndSettled()

        const result = harness.service.assetDelete(A, 'additionalAssets', [1])

        const top = harness.service.view(A).done.at(-1)?.id
        expect(top).toBeDefined()
        expect(result).toMatchObject({ ok: true, stepId: top })
        expect(harness.landed).toEqual([[A, top]])
        await drainMicrotasks()
        expect(harness.store.counts.save).toBe(saved + 1)
    })
})
