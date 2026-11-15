// @vitest-environment jsdom
// The retention roots of an owner's `assetRetained` field: a path stays in the field while memory, the record the
// store last acknowledged, or a save that may have stored it names a step for it. The real service, real history model
// and real commit order run over a store double whose saves answer as scripted; a "reload" builds a new service over
// what the double stored, with the owner write left in the page database.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { retainedNamesOf } from 'src/ts/storage/store2/lists/assetList'
import { ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS } from '../ownerPhase'
import { emptyRecord, MAX_DONE } from '../historyModel'
import { createFakeClock, drainMicrotasks, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, seedOwner } from './studioStoreDoubles'
import { createControlStudioStore, type ControlStudioStore } from './studioStoreControlDouble'

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
    [ASSET_RETAINED_KEY]?: unknown
}

const SMILE = ['smile', 'assets/smile.png', 'png']
const GRIN = ['grin', 'assets/grin.png', 'png']
const GRIN_PATH = 'assets/grin.png'

function makeCharacter(): LiveCharacter {
    return {
        chaId: 'A',
        desc: 'd0',
        alternateGreetings: ['g0'],
        chats: [{ id: 'c1', note: '' }],
        chatPage: 0,
        additionalAssets: [[...SMILE], [...GRIN]],
        emotionImages: [],
    }
}

const live = (): LiveCharacter => (DBState.db.characters as unknown as LiveCharacter[])[0]
const A = characterOwnerKey('A')

interface Session {
    clock: FakeClock
    store: ControlStudioStore
    service: OwnerHistoryService
}

let session: Session

function open(shared?: Map<string, string>, clock: FakeClock = createFakeClock()): Session {
    const store = createControlStudioStore({ shared })
    const built: Session = {
        clock,
        store,
        service: createOwnerHistoryService({
            store,
            claim: createClaimDouble(),
            clock,
            pageSession: 'p1',
            getVisitId: () => 'v1',
            registerLeaveFlush: () => () => {},
        }),
    }
    return built
}

const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    DBState.db.characters = [makeCharacter()] as unknown as typeof DBState.db.characters
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    session = open()
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const settle = (): Promise<void> => drainMicrotasks()

function fieldPaths(): string[] {
    return retainedNamesOf(live()[ASSET_RETAINED_KEY])
}

// Deletes the `grin` row: the delete step S, saved at once.
function deleteGrin(on: Session = session): void {
    expect(on.service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
}

// MAX_DONE more steps, each its own step, with no time passing: the oldest step leaves memory.
function overflow(on: Session = session): void {
    for (let i = 0; i < MAX_DONE; i++) {
        expect(on.service.editField(A, 'desc', 'v' + i).ok).toBe(true)
        on.service.closeOpenStep(A)
    }
}

let renames = 0
// An asset write that is not a removal: the retained field is recomputed, and its save only waits for the debounce.
function renameSmile(on: Session = session): void {
    renames += 1
    expect(on.service.assetRename(A, 'additionalAssets', 0, 'smile' + renames).ok).toBe(true)
}

async function ready(on: Session = session): Promise<void> {
    await on.service.whenReady(A)
}

describe('the field after the steps leave memory', () => {
    test('a delete is acknowledged, 100 steps follow and the owner write is saved while the history save never runs: the path stays, and after a reload Undo brings the row and its path back', async () => {
        await ready()
        deleteGrin()
        await settle()
        overflow()
        expect(session.service.view(A).done.some((step) => step.label.kind === 'assetDelete')).toBe(false)
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)

        const reloaded = open(session.store.shared)
        await ready(reloaded)
        expect(fieldPaths()).toContain(GRIN_PATH)
        expect(reloaded.service.undo(A).ok).toBe(true)
        expect(live().additionalAssets.map((row) => row[0])).toEqual(['smile1', 'grin'])
    })

    test('every save refused after the acknowledged delete, then overflow and a rename: the path stays, also after a reload', async () => {
        await ready()
        deleteGrin()
        await settle()
        session.store.fallback = 'unwritable'
        overflow()
        renameSmile()
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        expect(session.service.view(A).banner).toBe('unwritable')
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)

        const reloaded = open(session.store.shared)
        await ready(reloaded)
        expect(fieldPaths()).toContain(GRIN_PATH)
    })

    test('an insert and its undo are acknowledged, a rename clears the redo stack and its save is dropped: the path stays and after a reload Redo inserts the row', async () => {
        await ready()
        expect(session.service.assetInsert(A, 'additionalAssets', [['fresh', 'assets/fresh.png', 'png']]).ok).toBe(true)
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        expect(session.service.undo(A).ok).toBe(true)
        await settle()
        renameSmile()
        expect(session.service.view(A).undone).toHaveLength(0)
        expect(fieldPaths()).toContain('assets/fresh.png')

        const reloaded = open(session.store.shared)
        await ready(reloaded)
        expect(reloaded.service.redo(A).ok).toBe(true)
        expect(live().additionalAssets.some((row) => row[0] === 'fresh')).toBe(true)
    })

    test('the save of the record after the overflow is refused: the last acknowledged record still roots the path', async () => {
        await ready()
        deleteGrin()
        await settle()
        session.store.script = ['unwritable']
        overflow()
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)
    })

    test('a reload over a stored record that names the step roots its path before any save runs', async () => {
        await ready()
        deleteGrin()
        await settle()
        const reloaded = open(session.store.shared)
        await ready(reloaded)
        overflow(reloaded)
        renameSmile(reloaded)
        expect(reloaded.store.counts.save).toBe(0)
        expect(fieldPaths()).toContain(GRIN_PATH)
    })

    test('a save held in flight is acknowledged after the overflow: the record it carried roots the path, and the next acknowledged record without the step releases it', async () => {
        await ready()
        session.store.script = ['holdThenOk']
        deleteGrin()
        await settle()
        overflow()
        session.store.hold.release()
        await settle()
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)

        await session.clock.advance(SAVE_DEBOUNCE_MS)
        renameSmile()
        expect(fieldPaths()).not.toContain(GRIN_PATH)
    })

    test('a store that never answers keeps the path through the overflow', async () => {
        session.store.fallback = 'never'
        await ready()
        deleteGrin()
        await settle()
        overflow()
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)
    })

    test('a save that commits and then answers unwritable keeps the path until a later acknowledgement', async () => {
        await ready()
        session.store.script = ['storeThenUnwritable']
        deleteGrin()
        await settle()
        expect(session.service.view(A).banner).toBe('unwritable')
        overflow()
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)

        await session.clock.advance(SAVE_DEBOUNCE_MS)
        expect(session.service.view(A).banner).toBeNull()
        renameSmile()
        expect(fieldPaths()).not.toContain(GRIN_PATH)
    })

    test('two refused saves around the overflow, the first of them stored: the path stays, and a reload over the stored copy can undo', async () => {
        await ready()
        session.store.script = ['storeThenUnwritable', 'unwritable']
        deleteGrin()
        await settle()
        overflow()
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)

        const reloaded = open(session.store.shared)
        await ready(reloaded)
        expect(fieldPaths()).toContain(GRIN_PATH)
        expect(reloaded.service.undo(A).ok).toBe(true)
        expect(live().additionalAssets.map((row) => row[0])).toContain('grin')
    })

    test('memory, the acknowledged record and the unsettled saves all lack the step: the next asset write prunes the path', async () => {
        await ready()
        deleteGrin()
        await settle()
        const deleteStep = session.service.view(A).done[0].id
        overflow()
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        expect(session.store.answered.at(-1)?.stepIds).not.toContain(deleteStep)
        renameSmile()
        expect(fieldPaths()).not.toContain(GRIN_PATH)
        expect(fieldPaths()).toContain('assets/smile.png')
    })

    test('a history save that never ran leaves the path until the next asset write, which prunes it', async () => {
        await ready()
        session.store.fallback = 'unwritable'
        deleteGrin()
        await settle()
        expect(fieldPaths()).toContain(GRIN_PATH)

        const reloaded = open(session.store.shared)
        await ready(reloaded)
        expect(reloaded.service.view(A).done).toHaveLength(0)
        expect(fieldPaths()).toContain(GRIN_PATH)
        renameSmile(reloaded)
        expect(fieldPaths()).not.toContain(GRIN_PATH)
    })

    test('only steps that name an asset path are held while no save is acknowledged, so 200 coalesced saves hold exactly the delete step', async () => {
        const base = emptyRecord(A, 1)
        base.done = [{ id: 'base', at: 1, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'x' }, after: { had: true, value: 'd0' } }] }]
        seedOwner(session.store.shared, base, 'seed:1')
        session.store.fallback = 'unwritable'
        await ready()
        deleteGrin()
        await settle()
        let saves = session.store.answered.length
        for (let i = 0; saves < 200 && i < 3000; i++) {
            expect(session.service.editField(A, 'desc', 'text' + i).ok).toBe(true)
            await session.clock.advance(500)
            saves = session.store.answered.length
        }
        expect(saves).toBeGreaterThanOrEqual(200)
        expect(session.service.unsettledStepCountForTests(A)).toBe(1)
        expect(fieldPaths()).toContain(GRIN_PATH)
        expect(SAVE_MAX_WAIT_MS).toBeGreaterThan(500)
    })

    test('a step that moved without a write is a new step object, and the path stays rooted through the next acknowledgement', async () => {
        await ready()
        deleteGrin()
        await settle()
        live().additionalAssets.splice(1, 0, [...GRIN])
        expect(session.service.undo(A)).toEqual({ ok: true, already: 'undo' })
        expect(fieldPaths()).toContain(GRIN_PATH)
        await session.clock.advance(SAVE_DEBOUNCE_MS)
        renameSmile()
        expect(fieldPaths()).toContain(GRIN_PATH)
    })
})
