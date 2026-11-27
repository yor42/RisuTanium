// @vitest-environment jsdom
// U4: a character whose `additionalAssets` key is absent (a blank character has none) reads as an empty list, and the
// first Add creates it. Real service, real history model and real setters over the memory store double.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
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

type Row = string[]

interface LiveCharacter {
    chaId: string
    desc: string
    alternateGreetings: string[]
    chats: { id: string; note: string; fmIndex?: number }[]
    chatPage: number
    additionalAssets?: Row[] | null | string
    emotionImages?: Row[]
}

const A = characterOwnerKey('A')
const ROW = ['smile', 'assets/smile.png', 'png']
const ROW2 = ['grin', 'assets/grin.png', 'png']
const ROW3 = ['wave', 'assets/wave.png', 'png']

// The shape `createBlankChar` makes: no `additionalAssets` key at all.
function blank(extra: Partial<LiveCharacter> = {}): LiveCharacter {
    return { chaId: 'A', desc: 'd', alternateGreetings: [], chats: [{ id: 'c1', note: '', fmIndex: 0 }], chatPage: 0, ...extra }
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]

let service: OwnerHistoryService
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

async function open(character: LiveCharacter): Promise<void> {
    DBState.db.characters = [character] as unknown as typeof DBState.db.characters
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => null,
        onLanded: () => {},
    })
    await service.whenReady(A)
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('an insert into an absent additionalAssets', () => {
    test('C-T1: lands, creates the list, and undo and redo follow (key absent)', async () => {
        await open(blank())
        expect('additionalAssets' in live()).toBe(false)
        const result = service.assetInsert(A, 'additionalAssets', [ROW])
        expect(result.ok).toBe(true)
        expect(live().additionalAssets).toEqual([ROW])
        expect(service.undo(A).ok).toBe(true)
        expect(live().additionalAssets).toEqual([])
        expect(service.redo(A).ok).toBe(true)
        expect(live().additionalAssets).toEqual([ROW])
    })

    test('C-T1: the same for a null list', async () => {
        await open(blank({ additionalAssets: null }))
        expect(service.assetInsert(A, 'additionalAssets', [ROW]).ok).toBe(true)
        expect(live().additionalAssets).toEqual([ROW])
        expect(service.undo(A).ok).toBe(true)
        expect(live().additionalAssets).toEqual([])
    })

    test('C-T1g: a string list and an absent emotion list stay refused (compatibility guard)', async () => {
        await open(blank({ additionalAssets: 'x' }))
        expect(service.assetInsert(A, 'additionalAssets', [ROW])).toMatchObject({ ok: false, reason: 'precondition' })
        expect(live().additionalAssets).toBe('x')
        const noEmotions = blank()
        await open(noEmotions)
        expect(service.assetInsert(A, 'emotionImages', [['happy', 'assets/happy.png']])).toMatchObject({ ok: false })
        expect('emotionImages' in live()).toBe(false)
    })
})

// Every case starts on a present list, so the steps are made through the same path on base and after; the key is then deleted and only the replay differs.
describe('C-T1r: replay on an absent list after steps made on a present one', () => {
    test('(1) undo of an add of the sole row is already and writes nothing', async () => {
        await open(blank({ additionalAssets: [] }))
        expect(service.assetInsert(A, 'additionalAssets', [ROW]).ok).toBe(true)
        delete live().additionalAssets
        const result = service.undo(A)
        expect(result).toMatchObject({ ok: true })
        expect(result.ok && result.already).toBeDefined()
        expect('additionalAssets' in live()).toBe(false)
    })

    test('(2) redo of an add creates the list as [row]', async () => {
        await open(blank({ additionalAssets: [] }))
        expect(service.assetInsert(A, 'additionalAssets', [ROW]).ok).toBe(true)
        expect(service.undo(A).ok).toBe(true)
        delete live().additionalAssets
        expect(service.redo(A).ok).toBe(true)
        expect(live().additionalAssets).toEqual([ROW])
    })

    test('(3) undo of a delete at index 0 puts the row back', async () => {
        await open(blank({ additionalAssets: [[...ROW]] }))
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        delete live().additionalAssets
        expect(service.undo(A).ok).toBe(true)
        expect(live().additionalAssets).toEqual([ROW])
    })

    test('(4) undo of a delete at index 2 is refused (compatibility guard)', async () => {
        await open(blank({ additionalAssets: [[...ROW], [...ROW2], [...ROW3]] }))
        expect(service.assetDelete(A, 'additionalAssets', [2]).ok).toBe(true)
        delete live().additionalAssets
        expect(service.undo(A)).toMatchObject({ ok: false, reason: 'precondition' })
        expect('additionalAssets' in live()).toBe(false)
    })

    test('(5) redo of a delete is already and the list stays absent', async () => {
        await open(blank({ additionalAssets: [[...ROW]] }))
        expect(service.assetDelete(A, 'additionalAssets', [0]).ok).toBe(true)
        expect(service.undo(A).ok).toBe(true)
        delete live().additionalAssets
        const result = service.redo(A)
        expect(result).toMatchObject({ ok: true })
        expect(result.ok && result.already).toBeDefined()
        expect('additionalAssets' in live()).toBe(false)
    })
})
