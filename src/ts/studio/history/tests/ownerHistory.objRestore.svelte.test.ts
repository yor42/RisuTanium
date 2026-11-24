// @vitest-environment jsdom
// The visit journal, the restore point's creation and visibility rules and the restore line, through the real service
// with a fake clock and an injected visit id.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { hashPath } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { COALESCE_MS } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import type { ObjFamilyOp } from '../objectListOps'
import { characterOwnerKey, chatOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'
import { clone, deleteRows, liveCharacter, makeCharacter, putCharacter, rows, textEdit, type LiveCharacter } from './objService.test-helpers'

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

const A = characterOwnerKey('A')
const C1 = chatOwnerKey('A', 'c1')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
let clock: FakeClock
let store: MemoryStudioStore
let service: OwnerHistoryService
let visit = 'v1'

let sessions = 0

// Each service of one test is its own page session, so step ids never collide across a reload.
function createService(shared?: Map<string, string>): OwnerHistoryService {
    store = createMemoryStudioStore({ shared })
    sessions += 1
    return createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: `p${sessions}`,
        getVisitId: () => visit,
        registerLeaveFlush: () => () => {},
    })
}

async function start(character: LiveCharacter = makeCharacter({ globalLore: rows(3), chats: [{ id: 'c1', note: '', fmIndex: -1, localLore: rows(2) }] })): Promise<void> {
    putCharacter(character)
    clock = createFakeClock()
    visit = 'v1'
    service = createService()
    await service.whenReady(A)
    await service.whenReady(C1)
}

beforeEach(() => {
    h.marks = 0
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

const lore = (): Record<string, unknown>[] => liveCharacter().globalLore as Record<string, unknown>[]
const journal = (owner = A) => service.journalForTests(owner).get('lore') ?? []
const later = (): void => clock.tick(COALESCE_MS + 1)
const comments = (): unknown[] => lore().map((entry) => entry.comment)

describe('T53: the visit journal merges a row and field run', () => {
    test('(a)(d) typing steps separated by long pauses merge into one entry whatever the pause', async () => {
        await start()
        for (const value of ['a', 'ab', 'abc', 'abcd', 'abcde']) {
            expect(service.objEdit(A, textEdit(0, 'content', value)).ok).toBe(true)
            later()
        }
        expect(service.view(A).done).toHaveLength(5)
        expect(journal()).toHaveLength(1)
        expect(service.view(A).restoreLines).toEqual([{ list: 'lore', n: 1 }])
        const [merged] = journal()[0].ops
        expect(merged).toMatchObject({ op: 'objSet', field: 'content', before: { had: true, value: 'body 0' }, after: { had: true, value: 'abcde' } })
    })

    test('(b) edits of two fields of one row alternate without merging', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'content', 'x'))
        later()
        service.objEdit(A, textEdit(0, 'comment', 'y'))
        later()
        service.objEdit(A, textEdit(0, 'content', 'z'))
        expect(journal()).toHaveLength(3)
    })

    test('(c) a run that returns to its first value is netted out and counts nothing', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'other'))
        later()
        service.objEdit(A, textEdit(0, 'comment', 'Row 0'))
        expect(journal()).toHaveLength(0)
        expect(service.view(A).restoreLines).toEqual([])
    })

    test('(e) an outside change between two edits breaks the merge', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'content', 'a'))
        later()
        ;(lore()[0] as Record<string, unknown>).secondkey = 'outside too'
        service.objEdit(A, textEdit(0, 'content', 'b'))
        expect(journal()).toHaveLength(2)
    })

    test('(f) edits of two rows do not merge', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'content', 'a'))
        later()
        service.objEdit(A, textEdit(1, 'content', 'a'))
        expect(journal()).toHaveLength(2)
    })

    test('(g) every recorded step keeps the ops it had right after its commit', async () => {
        await start()
        const copies: ObjFamilyOp[][] = []
        for (const value of ['a', 'ab', 'abc']) {
            service.objEdit(A, textEdit(0, 'content', value))
            copies.push(clone(service.view(A).done.at(-1)?.ops ?? []) as ObjFamilyOp[])
            later()
        }
        expect(service.view(A).done.map((step) => step.ops)).toEqual(copies)
    })

    test('T-JO: the character and its chat keep separate journals and lines', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'char edit'))
        service.objEdit(C1, textEdit(0, 'comment', 'chat edit'))
        expect(service.view(A).restoreLines).toEqual([{ list: 'lore', n: 1 }])
        expect(service.view(C1).restoreLines).toEqual([{ list: 'lore', n: 1 }])
        expect(service.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(comments()[0]).toBe('Row 0')
        expect((liveCharacter().chats[0].localLore as { comment: string }[])[0].comment).toBe('chat edit')
        expect(service.view(C1).restoreLines).toEqual([{ list: 'lore', n: 1 }])
    })
})

describe('T38: the restore point and its line', () => {
    test('(a)(h) a lore-only visit shows the section with no fields and the line reverts it', async () => {
        await start()
        const before = JSON.stringify(lore())
        service.objEdit(A, textEdit(1, 'comment', 'edited'))
        const view = service.view(A)
        expect(view.restore).not.toBeNull()
        expect(view.restore?.fields).toEqual({})
        expect(view.restoreLines).toEqual([{ list: 'lore', n: 1 }])
        expect(service.restore(A, new Set(), { lines: ['lore'] })).toMatchObject({ ok: true })
        expect(JSON.stringify(lore())).toBe(before)
    })

    test('(c) the point holds no lore path and no list copy', async () => {
        await start()
        service.editText(A, 'desc', 'new description')
        service.objEdit(A, textEdit(0, 'content', 'secret body'))
        const point = service.view(A).restore
        expect(Object.keys(point?.fields ?? {}).filter((path) => path.startsWith('lore/') || path === 'globalLore')).toEqual([])
        expect(JSON.stringify(point)).not.toContain('secret body')
        expect(JSON.stringify(point)).not.toContain('Row 2')
    })

    test('(b) undoing an earlier visit\'s lore step is journaled, and the line returns the list to the visit start', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'visit one'))
        visit = 'v2'
        const startOfVisit = JSON.stringify(lore())
        service.editText(A, 'desc', 'second visit')
        expect(service.undo(A).ok).toBe(true)
        expect(service.undo(A).ok).toBe(true)
        expect(comments()[0]).toBe('Row 0')
        expect(service.view(A).restoreLines).toEqual([{ list: 'lore', n: 1 }])
        expect(service.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(JSON.stringify(lore())).toBe(startOfVisit)
    })

    test('(d) an outside change refuses only the list line; the field writes land', async () => {
        await start()
        service.editText(A, 'desc', 'edited desc')
        service.objEdit(A, textEdit(0, 'content', 'edited body'))
        lore()[0].content = 'changed outside'
        const result = service.restore(A, new Set(), { lines: ['lore'] })
        expect(result).toMatchObject({ ok: true, linesRefused: ['lore'] })
        expect(liveCharacter().desc).toBe('d0')
        expect(lore()[0].content).toBe('changed outside')
    })

    test('(e) delete then Restore from History: the line returns the entries and the listing to the start', async () => {
        await start()
        const before = JSON.stringify(lore())
        service.objEdit(A, deleteRows([1], 'D1'))
        expect(service.restoreDeleted(A, 'D1').ok).toBe(true)
        expect(service.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(JSON.stringify(lore())).toBe(before)
        expect(service.view(A).deleted).toEqual([])
        // The line's own inserts and removes do not merge with the journal, so only the reset empties it.
        expect(service.view(A).restoreLines).toEqual([])
    })

    test('(f) a new visit releases the journal at the first view', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'x'))
        expect(service.journalForTests(A).size).toBe(1)
        visit = 'v2'
        expect(service.view(A).restoreLines).toEqual([])
        expect(service.journalForTests(A).size).toBe(0)
    })

    test('(g) a lore-only visit replaces the earlier point: no fields, and Confirm reverts only lore', async () => {
        await start()
        service.editText(A, 'desc', 'first visit edit')
        visit = 'v2'
        service.objEdit(A, textEdit(0, 'comment', 'second visit'))
        const view = service.view(A)
        expect(view.restore?.fields).toEqual({})
        expect(view.restore?.visitId).toBe('v2')
        expect(service.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(comments()[0]).toBe('Row 0')
        expect(liveCharacter().desc).toBe('first visit edit')
    })

    test('(i) a new service over the stored record: an earlier visit\'s empty point is hidden, its field point shows with a note', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'x'))
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        visit = 'v2'
        let reloaded = createService(new Map(store.shared))
        await reloaded.whenReady(A)
        expect(reloaded.view(A).restore).toBeNull()
        expect(reloaded.view(A).restoreNotes).toEqual([])
        service = reloaded
        service.editText(A, 'desc', 'with a field')
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        visit = 'v3'
        reloaded = createService(new Map(store.shared))
        await reloaded.whenReady(A)
        const view = reloaded.view(A)
        expect(Object.keys(view.restore?.fields ?? {})).toContain('desc')
        expect(view.restoreLines).toEqual([])
        expect(view.restoreNotes).toEqual(['lore'])
    })

    test('(j) a replay-only visit leaves the point as it was and offers no line', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'x'))
        visit = 'v2'
        expect(service.undo(A).ok).toBe(true)
        const view = service.view(A)
        expect(view.restore).toBeNull()
        expect(view.restoreLines).toEqual([])
    })

    test('(k) after the line the journal is empty, and undoing its step gives one entry again', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'x'))
        expect(service.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(service.view(A).restoreLines).toEqual([])
        expect(service.undo(A).ok).toBe(true)
        expect(service.view(A).restoreLines).toEqual([{ list: 'lore', n: 1 }])
    })

    test('lines asked for without this visit\'s point are refused', async () => {
        await start()
        service.objEdit(A, textEdit(0, 'comment', 'x'))
        visit = 'v2'
        expect(service.restore(A, new Set(), { lines: ['lore'] })).toEqual({ ok: false, reason: 'precondition' })
    })

    // Compatibility guard: it passes before and after the object-list work, since an asset step never starts a point.
    test('(l) an asset step creates no restore point and no line', async () => {
        const assets = [['a0', hashPath('x', 'png'), 'png'], ['a1', hashPath('y', 'png'), 'png']]
        await start({ ...makeCharacter({ globalLore: rows(1) }), additionalAssets: assets } as LiveCharacter)
        expect(service.assetRename(A, 'additionalAssets', 1, 'wave2').ok).toBe(true)
        expect(service.view(A).done).toHaveLength(1)
        const view = service.view(A)
        expect(view.restore).toBeNull()
        expect(view.restoreLines).toEqual([])
        expect(view.restoreNotes).toEqual([])
    })
})
