// @vitest-environment jsdom
// T2-CN-3, T2-CN-4, T2-CN-6 (service leg): the real owner history service over the creator notes. An edit lands on the
// live character and records one `field` step; when the quote was dismissed (`removedQuotes: true`) the same step also
// clears that flag, so one undo restores both. A merge `textEdit` does not pass through the builder and leaves the flag
// alone. The service, the setters, the store double and the save marks are real; the clock is fake.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
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
const live = (): Record<string, unknown> => (DBState.db.characters as unknown as Record<string, unknown>[])[0]

function build(): OwnerHistoryService {
    return createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock: createFakeClock(1000),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
}

function seed(extra: Record<string, unknown>): void {
    DBState.db.characters = [
        { chaId: 'A', name: 'A', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', alternateGreetings: [], chats: [], chatPage: 0, ...extra },
    ] as unknown as typeof DBState.db.characters
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

describe('T2-CN-3: an edit of the creator notes clears a dismissed quote in the same step', () => {
    test('one step with two ops, and one undo restores the text and the flag', async () => {
        seed({ creatorNotes: 'c0', removedQuotes: true })
        const service = build()
        await service.whenReady(A)
        expect(service.editText(A, 'creatorNotes', 'c1', 'typing')).toEqual({ ok: true })
        expect(live().creatorNotes).toBe('c1')
        expect(live().removedQuotes).toBe(false)
        const steps = service.view(A).done
        expect(steps).toHaveLength(1)
        expect(steps[0].ops).toEqual([
            { op: 'set', path: 'creatorNotes', before: { had: true, value: 'c0' }, after: { had: true, value: 'c1' } },
            { op: 'set', path: 'removedQuotes', before: { had: true, value: true }, after: { had: true, value: false } },
        ])
        expect(service.undo(A).ok).toBe(true)
        expect(live().creatorNotes).toBe('c0')
        expect(live().removedQuotes).toBe(true)
        expect(service.redo(A).ok).toBe(true)
        expect(live().creatorNotes).toBe('c1')
        expect(live().removedQuotes).toBe(false)
    })

    test('the restore point names both paths', async () => {
        seed({ creatorNotes: 'c0', removedQuotes: true })
        const service = build()
        await service.whenReady(A)
        service.editText(A, 'creatorNotes', 'c1', 'single')
        const fields = service.view(A).restore?.fields ?? {}
        expect(fields.creatorNotes).toEqual({ before: { had: true, value: 'c0' }, last: { had: true, value: 'c1' } })
        expect(fields.removedQuotes).toEqual({ before: { had: true, value: true }, last: { had: true, value: false } })
    })
})

describe('T2-CN-4: no companion op unless the quote was dismissed', () => {
    test.each<[string, Record<string, unknown>, boolean]>([
        ['false', { removedQuotes: false }, true],
        ['absent', {}, false],
        ['not a boolean', { removedQuotes: 'yes' }, true],
    ])('removedQuotes %s: one op, and the flag is left as it was', async (_name, extra, present) => {
        seed({ creatorNotes: 'c0', ...extra })
        const service = build()
        await service.whenReady(A)
        expect(service.editText(A, 'creatorNotes', 'c1', 'single')).toEqual({ ok: true })
        expect(service.view(A).done[0].ops).toHaveLength(1)
        expect('removedQuotes' in live()).toBe(present)
        expect(live().removedQuotes).toBe(extra.removedQuotes)
        expect(service.undo(A).ok).toBe(true)
        expect(live().creatorNotes).toBe('c0')
        expect(live().removedQuotes).toBe(extra.removedQuotes)
    })
})

describe('T2-CN-6: a character without the creator notes key refuses the edit', () => {
    test('the service answers precondition and writes, marks and records nothing', async () => {
        seed({ removedQuotes: true })
        const service = build()
        await service.whenReady(A)
        expect(service.editText(A, 'creatorNotes', 'x', 'typing')).toEqual({ ok: false, reason: 'precondition' })
        expect('creatorNotes' in live()).toBe(false)
        expect(live().removedQuotes).toBe(true)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toHaveLength(0)
    })
})
