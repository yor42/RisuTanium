// @vitest-environment jsdom
// T2-BI-2 to T2-BI-8 (S2c): the token bias list on the real owner history service, the real setters and the real save
// marks, over a `$state` character as the app holds it. The clock is fake. Fixtures are made the way their producers make
// them: rows pushed as `['', 0]`, `['tok', null]` as Svelte's number binding leaves an emptied cell, a non-array as an
// unchecked import writes it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))

const db = $state({ db: { characters: [] as Record<string, unknown>[], modules: [] } })
const selection = $state({ selId: 0 })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() { return db },
        get selIdState() { return selection },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { createLiveReader, resolveLiveTarget } from 'src/ts/studio/edit/studioSetters'
import { changedFieldTarget } from 'src/ts/studio/historyFocus'
import { readOwnerFields } from 'src/ts/studio/ownerFields'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { listChangedElsewhere } from '../historyModel'
import type { BiasRow } from '../fieldRegistry'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const A = characterOwnerKey('A')
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
const live = (): { bias: unknown; desc: string } => db.db.characters[0] as unknown as { bias: unknown; desc: string }
const rowsOf = (): unknown => JSON.parse(JSON.stringify(live().bias))

let clock: FakeClock

function build(): OwnerHistoryService {
    clock = createFakeClock(1000)
    return createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
}

async function ready(bias: unknown = [['a', 1], ['b', 2]]): Promise<OwnerHistoryService> {
    db.db.characters = [{ chaId: 'A', name: 'A', type: 'character', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', alternateGreetings: [], chats: [], chatPage: 0, bias, additionalAssets: [['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png']], emotionImages: [] }]
    const service = build()
    await service.whenReady(A)
    return service
}

beforeEach(() => {
    h.marks = 0
    tracker.character.length = 0
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    resetStudioScreenForTests()
    selection.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

const next = (...rows: BiasRow[]): BiasRow[] => rows

describe('T2-BI-2: edit, undo, redo, revert and restore of the bias list apply with structural equality', () => {
    test('an edit with a new list of equal rows lands, an undo and a redo go back and forth', async () => {
        const service = await ready()
        expect(service.editField(A, 'bias', next(['a', 1], ['b', 2], ['', 0]), { coalesceKey: null })).toEqual({ ok: true })
        expect(rowsOf()).toEqual([['a', 1], ['b', 2], ['', 0]])
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect(rowsOf()).toEqual([['a', 1], ['b', 2]])
        expect((await service.replay(A, { kind: 'redo' })).ok).toBe(true)
        expect(rowsOf()).toEqual([['a', 1], ['b', 2], ['', 0]])
    })

    test('a revert to an earlier step undoes the steps above it', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1], ['b', 2], ['c', 3]), { coalesceKey: null })
        service.editField(A, 'bias', next(['a', 1], ['b', 2], ['c', 3], ['d', 4]), { coalesceKey: null })
        const first = service.view(A).done[0].id
        const result = await service.replay(A, { kind: 'revert', stepId: first })
        expect(result.ok).toBe(true)
        expect(rowsOf()).toEqual([['a', 1], ['b', 2], ['c', 3]])
    })

    test('a restore point puts the earlier list back', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1]), { coalesceKey: null })
        expect(service.restore(A, new Set()).ok).toBe(true)
        expect(rowsOf()).toEqual([['a', 1], ['b', 2]])
    })
})

describe('T2-BI-3: an edit to an equal list is unchanged and records no step', () => {
    test('equal rows in a new array', async () => {
        const service = await ready()
        expect(service.editField(A, 'bias', next(['a', 1], ['b', 2]), { coalesceKey: null })).toEqual({ ok: true, unchanged: true })
        expect(service.view(A).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('a changed value is not unchanged', async () => {
        const service = await ready()
        expect(service.editField(A, 'bias', next(['a', 1], ['b', 3]), { coalesceKey: null })).toEqual({ ok: true })
        expect(service.view(A).done).toHaveLength(1)
    })
})

describe('T2-BI-4 (AS-C4): the live array and the stored steps share nothing', () => {
    test('the classic editor mutating a live row in place changes no stored op, and the undo then refuses', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1], ['b', 2], ['c', 3]), { coalesceKey: null })
        const stored = JSON.stringify(service.view(A).done)
        ;(live().bias as BiasRow[])[0][0] = 'mutated'
        ;(live().bias as BiasRow[]).push(['extra', 9])
        expect(JSON.stringify(service.view(A).done)).toBe(stored)
        const result = await service.replay(A, { kind: 'undo' })
        expect(result).toMatchObject({ ok: false, reason: 'precondition' })
    })

    test('the written list is not the array the caller passed', async () => {
        const service = await ready()
        const wanted = next(['a', 1], ['z', 5])
        service.editField(A, 'bias', wanted, { coalesceKey: null })
        wanted[0][0] = 'changed after the write'
        expect(rowsOf()).toEqual([['a', 1], ['z', 5]])
    })
})

describe('T2-BI-4b: a redo and an undo write copies too', () => {
    test('the list a redo writes is not the array its step holds', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1], ['b', 2], ['c', 3]), { coalesceKey: null })
        await service.replay(A, { kind: 'undo' })
        expect((await service.replay(A, { kind: 'redo' })).ok).toBe(true)
        const stored = JSON.stringify(service.view(A).done)
        ;(live().bias as BiasRow[])[0][0] = 'mutated after the redo'
        ;(live().bias as BiasRow[]).push(['extra', 1])
        expect(JSON.stringify(service.view(A).done)).toBe(stored)
    })
})

describe('T2-BI-1b: the edit entry refuses a list the parse guard would refuse', () => {
    test.each([
        ['a null cell', [['tok', null]]],
        ['a NaN value', [['tok', Number.NaN]]],
        ['a 3-tuple', [['tok', 1, 2]]],
        ['a non-array', 'x'],
    ])('%s is a precondition refusal and nothing is written', async (_name, bad) => {
        const service = await ready()
        const before = JSON.stringify(live().bias)
        expect(service.editField(A, 'bias', bad as never, { coalesceKey: null })).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(live().bias)).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
    })
})

describe('T2-BI-5: an op holds plain arrays', () => {
    test('structuredClone of a recorded op succeeds and shares no array with the live list', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1], ['b', 5]), { coalesceKey: null })
        const op = service.view(A).done[0].ops[0]
        expect(() => structuredClone(op)).not.toThrow()
        if (op.op !== 'set' || !op.after.had || !Array.isArray(op.after.value)) throw new Error('not a set of a list')
        const liveRows = live().bias as BiasRow[]
        expect(op.after.value).not.toBe(liveRows)
        for (const row of op.after.value as BiasRow[]) {
            expect(liveRows.includes(row)).toBe(false)
        }
    })
})

describe('T2-BI-6: token typing coalesces per row through the string key', () => {
    test('typing in row 0 is one step, another row starts a step, and the same row afterwards starts another', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a!', 1], ['b', 2]), { coalesceKey: 'bias:0:token' })
        service.editField(A, 'bias', next(['a!!', 1], ['b', 2]), { coalesceKey: 'bias:0:token' })
        expect(service.view(A).done).toHaveLength(1)
        service.editField(A, 'bias', next(['a!!', 1], ['b?', 2]), { coalesceKey: 'bias:1:token' })
        expect(service.view(A).done).toHaveLength(2)
        service.editField(A, 'bias', next(['a!!!', 1], ['b?', 2]), { coalesceKey: 'bias:0:token' })
        expect(service.view(A).done).toHaveLength(3)
    })

    test('closing the open step makes the next keystroke in the same row a new step', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a!', 1], ['b', 2]), { coalesceKey: 'bias:0:token' })
        service.closeOpenStep(A)
        service.editField(A, 'bias', next(['a!!', 1], ['b', 2]), { coalesceKey: 'bias:0:token' })
        expect(service.view(A).done).toHaveLength(2)
    })

    test('a null key is a step of its own, even right after typing in the same row', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a!', 1], ['b', 2]), { coalesceKey: 'bias:0:token' })
        service.editField(A, 'bias', next(['a!', 7], ['b', 2]), { coalesceKey: null })
        expect(service.view(A).done).toHaveLength(2)
    })
})

describe('T2-BI-7 (F3, E3): an unreadable live list reads as absent and is never edited or normalized', () => {
    test.each([
        ['a null cell', [['tok', null]]],
        ['a non-finite cell', [['tok', Number.NaN]]],
        ['a 3-tuple', [['tok', 1, 'extra']]],
        ['a non-array', 'x'],
    ])('%s: the reader reads absent, every bias edit is refused precondition and the bytes stay', async (_name, malformed) => {
        const service = await ready(malformed)
        const reader = createLiveReader((resolveLiveTarget(A) as { ok: true; target: Parameters<typeof createLiveReader>[0] }).target)
        expect(reader.field('bias')).toEqual({ had: false })
        const before = JSON.stringify(live().bias)
        for (const attempt of [next(['tok', 1]), next(), next(['', 0])]) {
            expect(service.editField(A, 'bias', attempt, { coalesceKey: null })).toEqual({ ok: false, reason: 'precondition' })
        }
        expect(JSON.stringify(live().bias)).toBe(before)
        expect(service.view(A).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test('an undo of an earlier bias step over a list that became unreadable writes nothing', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1]), { coalesceKey: null })
        live().bias = [['a', null]]
        const before = JSON.stringify(live().bias)
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(false)
        expect(JSON.stringify(live().bias)).toBe(before)
    })

    test('a restore point lists bias as changed elsewhere, and keeping it leaves the malformed bytes', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1]), { coalesceKey: null })
        live().bias = [['a', null]]
        const target = (resolveLiveTarget(A) as { ok: true; target: Parameters<typeof createLiveReader>[0] }).target
        const restore = service.view(A).restore
        expect(restore).not.toBeNull()
        expect(listChangedElsewhere(restore!, createLiveReader(target))).toEqual(['bias'])
        const before = JSON.stringify(live().bias)
        service.restore(A, new Set(['bias']))
        expect(JSON.stringify(live().bias)).toBe(before)
    })
})

describe('T2-BI-8 (F4): a list of reactive rows is cloned at the entry', () => {
    test('rows mapped from a $state array record plain copies', async () => {
        const service = await ready()
        const reactive = $state<BiasRow[]>([['a', 1], ['b', 2]])
        const wanted = reactive.map((row) => row)
        wanted.push(['c', 3])
        expect(service.editField(A, 'bias', wanted, { coalesceKey: null }).ok).toBe(true)
        const op = service.view(A).done[0].ops[0]
        expect(() => structuredClone(op)).not.toThrow()
        const restore = service.view(A).restore
        expect(() => structuredClone(restore)).not.toThrow()
        if (op.op !== 'set' || !op.after.had) throw new Error('not a set')
        expect((op.after.value as BiasRow[])[0]).not.toBe(wanted[0])
    })
})

describe('reportStep', () => {
    test('is opt-in: the id of the landed step comes back only when asked for', async () => {
        const service = await ready()
        expect(service.editField(A, 'bias', next(['a', 1]), { coalesceKey: null })).toEqual({ ok: true })
        const result = service.editField(A, 'bias', next(), { coalesceKey: null, reportStep: true })
        expect(result).toEqual({ ok: true, stepId: service.view(A).done.at(-1)!.id })
    })
})

describe('T2-FOC (AS-C5): the focus target after a history action', () => {
    test('(a) two reads of the owner fields with no change give no target, although the bias reader returns a fresh array', async () => {
        await ready()
        const first = readOwnerFields(A)
        const second = readOwnerFields(A)
        expect(first).not.toBeNull()
        expect(first!.bias).not.toBe(second!.bias)
        expect(changedFieldTarget(first!, second!)).toBeNull()
    })

    test('(b) undoing an asset row delete leaves focus alone (null target)', async () => {
        const service = await ready()
        expect(service.assetDelete(A, 'additionalAssets', [1]).ok).toBe(true)
        const before = readOwnerFields(A)
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        const after = readOwnerFields(A)
        expect(changedFieldTarget(before!, after!)).toBeNull()
    })

    test('(c) undoing a bias edit targets the bias list', async () => {
        const service = await ready()
        service.editField(A, 'bias', next(['a', 1]), { coalesceKey: null })
        const before = readOwnerFields(A)
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect(changedFieldTarget(before!, readOwnerFields(A)!)).toEqual({ kind: 'bias' })
    })
})