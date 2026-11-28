// @vitest-environment jsdom
// The regex list in the visit journal and the restore point, through the real service with a fake clock, the real memory
// store and field edits built by the regex builders (new behaviour, shown by the mutants M43 and M48-M51 of the S6a plan):
// (a)-(c) the restore line, its earlier-visit note and the stored steps, (e) the stored point holds no list, (f) a field
// edit fingerprints the edited row only, (g)-(h') the journal keeps one entry however the keystrokes arrive and every
// stored step keeps its own before and after, (i) a refused regex line never stops the lore line.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { regexFieldEdit, regexTypingKey } from 'src/ts/studio/edit/regexListOps'
import { COALESCE_MS } from '../historyModel'
import { fingerprintElement } from '../listFingerprint'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, SAVE_DEBOUNCE_MS } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, storedRecord, type MemoryStudioStore } from './studioStoreDoubles'
import { deleteRows, liveCharacter, makeCharacter, putCharacter, rows, textEdit, type LiveCharacter } from './objService.test-helpers'

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
// A pass-through spy: the anchor and fingerprint work of an edit stays real, and the test reads what was hashed.
vi.mock('../listFingerprint', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../listFingerprint')>()
    return { ...actual, fingerprintElement: vi.fn(actual.fingerprintElement) }
})

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const SIZE_BIG = 25_000

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

// The classic add shape, the `RegexData` shape and an upstream entry with an unknown key.
const regexList = (): Entry[] => [
    { comment: 'r0', in: 'a0', out: 'b0', type: 'editinput' },
    { comment: 'r1', in: 'a1', out: 'b1', type: 'editoutput', flag: 'g', ableFlag: true },
    { comment: 'r2', in: 'a2', out: 'b2', type: 'editdisplay', x_future: { a: 1 } },
]

async function start(list: Entry[] = regexList()): Promise<void> {
    const character: LiveCharacter = { ...makeCharacter({ globalLore: rows(3) }), customscript: list } as LiveCharacter
    putCharacter(character)
    clock = createFakeClock()
    visit = 'v1'
    service = createService()
    await service.whenReady(A)
}

beforeEach(() => {
    h.marks = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selIdState.selId = 0
    studioScreen.chaId = 'A'
    vi.mocked(fingerprintElement).mockClear()
})

afterEach(() => {
    DBState.db = { characters: [], modules: [] } as unknown as typeof DBState.db
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const regex = (): Entry[] => (liveCharacter() as unknown as { customscript: Entry[] }).customscript
const lore = (): Entry[] => liveCharacter().globalLore as Entry[]
const journal = (list: 'regex' | 'lore' = 'regex') => service.journalForTests(A).get(list) ?? []
const later = (): void => clock.tick(COALESCE_MS + 1)
const typing = (index: number, field: 'in' | 'out' | 'comment', text: string, token = 't1') =>
    service.objEdit(A, regexFieldEdit(index, field, text, regexTypingKey(token, index, field)).build)
const bigText = (marker: string, size = SIZE_BIG): string => marker + 'x'.repeat(size - marker.length)

// A distinct value of the same length: one character at a rotating position changes each time.
function valueAt(i: number): string {
    const position = i % SIZE_BIG
    const base = 'y'.repeat(SIZE_BIG)
    return base.slice(0, position) + String.fromCharCode(0x61 + (i % 20)) + base.slice(position + 1)
}

describe('T34 (a)-(c): the regex line, the earlier-visit note and the stored steps', () => {
    test('(a) a regex-only visit stores an empty-fields point, shows only the regex line and the line reverts it', async () => {
        await start()
        const before = JSON.stringify(regex())
        expect(typing(1, 'out', 'edited').ok).toBe(true)
        const view = service.view(A)
        expect(view.restore).not.toBeNull()
        expect(view.restore?.fields).toEqual({})
        expect(view.restoreLines).toEqual([{ list: 'regex', n: 1 }])
        expect(JSON.stringify(regex())).not.toBe(before)
        expect(service.restore(A, new Set(), { lines: ['regex'] })).toMatchObject({ ok: true })
        expect(JSON.stringify(regex())).toBe(before)
    })

    test('(b) a visit with a field edit and a regex edit shows both lines; Confirm restores both', async () => {
        await start()
        const before = JSON.stringify(regex())
        service.editText(A, 'desc', 'new description')
        expect(typing(0, 'comment', 'renamed').ok).toBe(true)
        const view = service.view(A)
        expect(Object.keys(view.restore?.fields ?? {})).toContain('desc')
        expect(view.restoreLines).toEqual([{ list: 'regex', n: 1 }])
        expect(service.restore(A, new Set(), { lines: ['regex'] })).toMatchObject({ ok: true })
        expect(liveCharacter().desc).toBe('d0')
        expect(JSON.stringify(regex())).toBe(before)
    })

    test('(c) after a reload the earlier visit shows its field rows and the regex note, no regex line; steps and deleted items remain', async () => {
        await start()
        service.editText(A, 'desc', 'new description')
        expect(typing(0, 'comment', 'renamed').ok).toBe(true)
        expect(service.objEdit(A, deleteRows([1], 'D1')).ok).toBe(true)
        const done = service.view(A).done.length
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        visit = 'v2'
        const reloaded = createService(new Map(store.shared))
        await reloaded.whenReady(A)
        const view = reloaded.view(A)
        expect(Object.keys(view.restore?.fields ?? {})).toContain('desc')
        expect(view.restoreLines).toEqual([])
        expect(view.restoreNotes).toEqual(expect.arrayContaining(['lore', 'regex']))
        expect(view.done).toHaveLength(done)
        expect(view.deleted).toHaveLength(1)
        expect(view.deleted[0]).toMatchObject({ id: 'D1', list: 'lore' })
    })
})

describe('T34 (e): the stored record never holds a regex list in its restore point', () => {
    test('the bytes read back hold no customscript path and none of the list\'s text', async () => {
        const list = regexList()
        list[0].in = 'MARK-IN-0'
        list[1].out = 'MARK-OUT-1'
        list[2].comment = 'MARK-COMMENT-2'
        await start(list)
        service.editText(A, 'desc', 'new description')
        expect(typing(0, 'out', 'edited out').ok).toBe(true)
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const stored = storedRecord(store.shared, A)
        expect(stored).not.toBeNull()
        const point = stored?.record.restore
        expect(point).not.toBeNull()
        expect(Object.keys(point?.fields ?? {})).toContain('desc')
        expect(Object.keys(point?.fields ?? {}).filter((path) => path.startsWith('customscript') || path.startsWith('regex'))).toEqual([])
        const text = JSON.stringify(point)
        for (const mark of ['MARK-IN-0', 'MARK-OUT-1', 'MARK-COMMENT-2', 'edited out', 'b0']) {
            expect(text).not.toContain(mark)
        }
    })
})

describe('T34 (f): a field edit of a 300 x 20 KB list fingerprints the edited row only', () => {
    test('every fingerprinted text of one edit carries the edited row\'s marker', async () => {
        const list: Entry[] = Array.from({ length: 300 }, (_, i) => ({ comment: `c${i}`, in: bigText(`<ROW${i}>`), out: `o${i}`, type: 'editinput' }))
        await start(list)
        vi.mocked(fingerprintElement).mockClear()
        expect(typing(150, 'out', 'edited out').ok).toBe(true)
        const texts = vi.mocked(fingerprintElement).mock.calls.map(([value]) => value).filter((value): value is string => typeof value === 'string' && value.length > 1000)
        expect(texts.length).toBeGreaterThan(0)
        for (const text of texts) {
            expect(text).toContain('<ROW150>')
        }
        expect(texts.length).toBeLessThanOrEqual(8)
    })
})

describe('T34 (g)-(h\'): the journal keeps one entry per row field run', () => {
    test('(g) 500 coalesced keystrokes into one out of a 25 KB entry leave one journal entry, and the line restores the visit start', async () => {
        await start([{ comment: 'big', in: 'a', out: 'y'.repeat(SIZE_BIG), type: 'editinput' }, ...regexList()])
        const before = JSON.stringify(regex())
        for (let i = 0; i < 500; i += 1) {
            expect(typing(0, 'out', valueAt(i)).ok).toBe(true)
        }
        expect(journal()).toHaveLength(1)
        expect(service.view(A).restoreLines).toEqual([{ list: 'regex', n: 1 }])
        expect(service.restore(A, new Set(), { lines: ['regex'] }).ok).toBe(true)
        expect(JSON.stringify(regex())).toBe(before)
    })

    test('(h) 500 writes, each more than COALESCE_MS apart, with one undo and redo among them, leave one journal entry', async () => {
        await start([{ comment: 'big', in: 'a', out: 'y'.repeat(SIZE_BIG), type: 'editinput' }, ...regexList()])
        for (let i = 0; i < 500; i += 1) {
            expect(typing(0, 'out', valueAt(i)).ok).toBe(true)
            later()
            if (i === 250) {
                expect(service.undo(A).ok).toBe(true)
                expect(service.redo(A).ok).toBe(true)
                expect(journal()).toHaveLength(1)
            }
        }
        expect(journal()).toHaveLength(1)
        expect(service.view(A).restoreLines).toEqual([{ list: 'regex', n: 1 }])
    })

    test('(h\') three writes to one out, each past COALESCE_MS: three undos restore each intermediate value; the stored steps keep their own before and after', async () => {
        await start()
        const values = ['b0', 'v1', 'v2', 'v3']
        for (const value of values.slice(1)) {
            expect(typing(0, 'out', value).ok).toBe(true)
            later()
        }
        const pairs = (steps: readonly { ops: readonly object[] }[]) =>
            steps.map((step) => {
                const op = step.ops[0] as { before: { value: string }; after: { value: string } }
                return [op.before.value, op.after.value]
            })
        const expected = [['b0', 'v1'], ['v1', 'v2'], ['v2', 'v3']]
        expect(pairs(service.view(A).done)).toEqual(expected)
        expect(journal()).toHaveLength(1)
        await clock.advance(SAVE_DEBOUNCE_MS + 1)
        const reloaded = createService(new Map(store.shared))
        await reloaded.whenReady(A)
        expect(pairs(reloaded.view(A).done)).toEqual(expected)
        for (const value of ['v2', 'v1', 'b0']) {
            expect(service.undo(A).ok).toBe(true)
            expect(regex()[0].out).toBe(value)
        }
    })
})

describe('T34 (i): a refused regex line does not stop the lore line, and the reverse', () => {
    async function twoLists(): Promise<{ regexBefore: string; loreBefore: string }> {
        await start()
        const regexBefore = JSON.stringify(regex())
        const loreBefore = JSON.stringify(lore())
        expect(service.objEdit(A, textEdit(0, 'comment', 'lore edit')).ok).toBe(true)
        expect(typing(0, 'out', 'regex edit').ok).toBe(true)
        expect(service.view(A).restoreLines).toEqual(expect.arrayContaining([{ list: 'lore', n: 1 }, { list: 'regex', n: 1 }]))
        return { regexBefore, loreBefore }
    }

    test('an outside change to the regex row refuses the regex line only; the lore line applies', async () => {
        const { loreBefore } = await twoLists()
        regex()[0].out = 'changed outside'
        const result = service.restore(A, new Set(), { lines: ['lore', 'regex'] })
        expect(result).toMatchObject({ ok: true, linesRefused: ['regex'] })
        expect(JSON.stringify(lore())).toBe(loreBefore)
        expect(regex()[0].out).toBe('changed outside')
    })

    test('an outside change to the lore row refuses the lore line only; the regex line applies', async () => {
        const { regexBefore } = await twoLists()
        lore()[0].comment = 'changed outside'
        const result = service.restore(A, new Set(), { lines: ['lore', 'regex'] })
        expect(result).toMatchObject({ ok: true, linesRefused: ['lore'] })
        expect(JSON.stringify(regex())).toBe(regexBefore)
        expect(lore()[0].comment).toBe('changed outside')
    })

    test('each list\'s line chosen alone applies its own list and leaves the other untouched', async () => {
        const { regexBefore, loreBefore } = await twoLists()
        expect(service.restore(A, new Set(), { lines: ['regex'] }).ok).toBe(true)
        expect(JSON.stringify(regex())).toBe(regexBefore)
        expect(lore()[0].comment).toBe('lore edit')
        expect(service.restore(A, new Set(), { lines: ['lore'] }).ok).toBe(true)
        expect(JSON.stringify(lore())).toBe(loreBefore)
    })
})
