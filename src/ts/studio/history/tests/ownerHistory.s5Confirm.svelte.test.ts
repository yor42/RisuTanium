// @vitest-environment jsdom
// The Low Level Access confirm guard of Studio S5 through the real history service, history model and setters over the
// memory store double, on a reactive database with the real save-mark hook. One guard in `applyStudioWrite` reads the last
// planned `set` of the flag against the live engine reading: a direct turn-on, an undo, a redo, a revert and a restore that
// would turn the engine reading on are refused `confirm-low-level` with nothing changed, unless they carry the confirm.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0, ask: undefined as unknown as (name: string) => Promise<boolean> }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/alert', () => ({ alertSelect: vi.fn() }))

// The sheet's own state is not under test here: the helper's question is answered by the test.
vi.mock('src/ts/studio/studioScreen.svelte', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/studio/studioScreen.svelte')>()
    return { ...original, askStudioRisky: (name: string) => h.ask(name) }
})

// Filled by `beforeEach`.
const db = $state({ db: { characters: [], modules: [] } as { characters: Record<string, unknown>[]; modules: Record<string, unknown>[] } })

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        get DBState() {
            return db
        },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

import { applyModulePlacement } from 'src/ts/process/moduleDuplicates'
import type { RisuModule } from 'src/ts/process/modules'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { runWithLowLevelConfirm } from 'src/ts/studio/edit/lowLevelConfirm.svelte'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type StudioResult } from '../ownerHistory.svelte'
import { moduleOwnerKey, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

type Obj = Record<string, unknown>

const M1 = moduleOwnerKey('M1')
const LOW = 'moduleLowLevelAccess'
const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }

// Create: `{name: '', description: '', id}` (ModuleSettings' new module).
const createShaped = (): Obj => ({ name: '', description: '', id: 'M1' })

// Replace-imported: the incoming module is a `.risum` body placed by the import's own `applyModulePlacement` over the
// installed module's row, which keeps its id. The classic editor writes `lowLevelAccess: false`.
function replaceInPlace(incoming: Obj): void {
    applyModulePlacement(db.db.modules as unknown as RisuModule[], incoming as unknown as RisuModule, { choice: 'replace', targetId: 'M1' })
}
function replaceImported(incoming: Obj): Obj {
    const rows = [createShaped()] as unknown as RisuModule[]
    applyModulePlacement(rows, incoming as unknown as RisuModule, { choice: 'replace', targetId: 'M1' })
    return rows[0] as unknown as Obj
}

// Foreign-typed: the module object a `.risum` main block carries, holding values of other types than the editor writes.
const FOREIGN_BODY = '{"id":"zz","name":5,"description":"d","namespace":null,"hideIcon":{"x":1},"lowLevelAccess":1,"backgroundEmbedding":0}'
const foreignTyped = (): Obj => replaceImported(JSON.parse(FOREIGN_BODY) as Obj)

interface Harness {
    clock: FakeClock
    store: MemoryStudioStore
    service: OwnerHistoryService
    replaced: number
    noted: number
}

function build(): Harness {
    const clock = createFakeClock()
    const store = createMemoryStudioStore({})
    const built: Harness = { clock, store, replaced: 0, noted: 0, service: undefined as unknown as OwnerHistoryService }
    built.service = createOwnerHistoryService({
        store,
        claim: createClaimDouble(),
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
        onModuleSlotReplaced: () => {
            built.replaced += 1
        },
    })
    built.service.setModuleAck('M1', {
        noteEdit: () => {
            built.noted += 1
        },
    })
    return built
}

let harness: Harness
const put = (...modules: Obj[]): void => {
    db.db.modules = modules
}
const slot = (): Obj => db.db.modules[0]
const ready = (owner: OwnerKey = M1): Promise<void> => harness.service.whenReady(owner)
// Each action is followed by a pause longer than the typing window, so two edits of the flag are two steps.
const setLow = (value: boolean, confirm?: 'lowLevelOn'): StudioResult => {
    const result = harness.service.editField(M1, LOW, value, confirm)
    harness.clock.tick(2000)
    return result
}
const on = (): StudioResult => setLow(true, 'lowLevelOn')
const text = (path: 'moduleName' | 'moduleDescription', value: string) => harness.service.editText(M1, path, value, 'single')
const topOf = (list: 'done' | 'undone'): string => harness.service.view(M1)[list].at(-1)?.id ?? ''
const expectTopOf = (result: StudioResult): string | undefined => (result.ok === false ? result.expectTop : undefined)

interface Snapshot {
    slot: Obj
    json: string
    done: unknown
    undone: unknown
    restore: unknown
    doneIds: string[]
    undoneIds: string[]
    replaced: number
    noted: number
    dirty: boolean
}

// What a refused action must leave exactly as it was: the slot object, its content, the stacks, the restore point, the
// save machinery.
function take(): Snapshot {
    const view = harness.service.view(M1)
    return {
        slot: slot(),
        json: JSON.stringify(db.db.modules),
        done: view.done,
        undone: view.undone,
        restore: view.restore,
        doneIds: view.done.map((step) => step.id),
        undoneIds: view.undone.map((step) => step.id),
        replaced: harness.replaced,
        noted: harness.noted,
        dirty: tracker.modules,
    }
}

function expectUnchanged(before: Snapshot): void {
    const view = harness.service.view(M1)
    expect(slot()).toBe(before.slot)
    expect(JSON.stringify(db.db.modules)).toBe(before.json)
    expect(view.done).toBe(before.done)
    expect(view.undone).toBe(before.undone)
    expect(view.restore).toBe(before.restore)
    expect(view.done.map((step) => step.id)).toEqual(before.doneIds)
    expect(view.undone.map((step) => step.id)).toEqual(before.undoneIds)
    expect(harness.replaced).toBe(before.replaced)
    expect(harness.noted).toBe(before.noted)
    expect(tracker.modules).toBe(before.dirty)
}

beforeEach(() => {
    h.marks = 0
    h.ask = () => Promise.resolve(false)
    tracker.character.length = 0
    tracker.modules = false
    resetCharacterSaveMarksForTest()
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    resetStudioScreenForTests()
    db.db = { characters: [], modules: [createShaped()] }
    installDbWriteHook(db, { selectedChaId: () => null })
    harness = build()
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('T5-GUARD-DIRECT: a direct turn-on asks', () => {
    test('refused without confirm with nothing changed; lands with it; turning off never asks', async () => {
        await ready()
        tracker.modules = false
        const before = take()
        expect(setLow(true)).toEqual({ ok: false, reason: 'confirm-low-level' })
        expectUnchanged(before)
        expect(Object.hasOwn(slot(), 'lowLevelAccess')).toBe(false)
        expect(setLow(true, 'lowLevelOn')).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
        expect(setLow(false)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(false)
    })
})

describe('T5-GUARD-UNDO: a replay that turns the flag on asks, also after a replace-import (MC-3984)', () => {
    test('undo of a turn-off over a replace-imported module', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        const turnOff = topOf('done')
        replaceInPlace({ id: 'zz', name: '', description: '', lowLevelAccess: false, trigger: [{ comment: 'new', type: 'start', conditions: [], effect: [], lowLevelAccess: false }] })
        expect(slot().lowLevelAccess).toBe(false)
        tracker.modules = false
        const before = take()
        const refused = await harness.service.replay(M1, { kind: 'undo' })
        expect(refused).toEqual({ ok: false, reason: 'confirm-low-level', expectTop: turnOff })
        expectUnchanged(before)
        const landed = await harness.service.replay(M1, { kind: 'undo', expectTop: turnOff, confirm: 'lowLevelOn' })
        expect(landed).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
        expect(topOf('undone')).toBe(turnOff)
    })
})

describe('T5-GUARD-REDO: a redo that turns the flag on asks', () => {
    test('turn on, undo (no ask), redo refused, confirmed redo lands', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(await harness.service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true })
        const before = take()
        const refused = await harness.service.replay(M1, { kind: 'redo' })
        expect(refused).toMatchObject({ ok: false, reason: 'confirm-low-level', expectTop: topOf('undone') })
        expectUnchanged(before)
        expect(await harness.service.replay(M1, { kind: 'redo', expectTop: expectTopOf(refused), confirm: 'lowLevelOn' })).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
    })
})

describe('T5-GUARD-REVERT: a revert that crosses a turn-off asks and lands whole when confirmed', () => {
    test('refused whole: name and flag unchanged; confirmed, both land', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        const turnOn = topOf('done')
        expect(setLow(false)).toEqual({ ok: true })
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        const before = take()
        expect(harness.service.revertTo(M1, turnOn)).toEqual({ ok: false, reason: 'confirm-low-level' })
        expectUnchanged(before)
        expect(slot().name).toBe('N')
        expect(slot().lowLevelAccess).toBe(false)
        expect(await harness.service.replay(M1, { kind: 'revert', stepId: turnOn })).toEqual({ ok: false, reason: 'confirm-low-level' })
        expect(await harness.service.replay(M1, { kind: 'revert', stepId: turnOn, confirm: 'lowLevelOn' })).toMatchObject({ ok: true })
        expect(slot().name).toBe('')
        expect(slot().lowLevelAccess).toBe(true)
    })
})

describe('T5-GUARD-RESTORE: a restore whose before reads on asks', () => {
    test('refused with nothing changed; confirmed, it lands', async () => {
        put({ ...createShaped(), lowLevelAccess: true })
        await ready()
        expect(setLow(false)).toEqual({ ok: true })
        const before = take()
        expect(harness.service.restore(M1, new Set())).toEqual({ ok: false, reason: 'confirm-low-level' })
        expectUnchanged(before)
        expect(slot().lowLevelAccess).toBe(false)
        expect(harness.service.restore(M1, new Set(), 'lowLevelOn')).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
    })
})

describe('T5-GUARD-FOREIGN: the engine reading, not the stored type, decides', () => {
    test('(a) turning off a truthy foreign value never asks', async () => {
        put(foreignTyped())
        await ready()
        expect(setLow(false)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(false)
    })

    test('(b) undoing that turn-off asks, and confirmed it writes the stored 1 back', async () => {
        put(foreignTyped())
        await ready()
        expect(setLow(false)).toEqual({ ok: true })
        const before = take()
        const refused = await harness.service.replay(M1, { kind: 'undo' })
        expect(refused).toEqual({ ok: false, reason: 'confirm-low-level', expectTop: topOf('done') })
        expectUnchanged(before)
        expect(await harness.service.replay(M1, { kind: 'undo', expectTop: expectTopOf(refused), confirm: 'lowLevelOn' })).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(1)
    })

    test('(c) a direct true over a live 1 is on to on: no ask', async () => {
        put(foreignTyped())
        await ready()
        expect(setLow(true)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
    })

    test('(d) a module holding 0, turned on (confirmed) and undone: on to off, no ask', async () => {
        put({ ...createShaped(), lowLevelAccess: 0 })
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(await harness.service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(0)
    })

    test('(e) a restore from a live true to a recorded 1 is on to on: no ask', async () => {
        put({ ...createShaped(), lowLevelAccess: 1 })
        await ready()
        expect(setLow(false)).toEqual({ ok: true })
        expect(on()).toEqual({ ok: true })
        expect(harness.service.restore(M1, new Set())).toMatchObject({ ok: true })
        expect(slot().lowLevelAccess).toBe(1)
    })
})

describe('T5-GUARD-QUIET: what does not turn the engine reading on never asks', () => {
    test('(a) undo of a turn-on', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(await harness.service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(Object.hasOwn(slot(), 'lowLevelAccess')).toBe(false)
    })

    test('(b) a replay that does not touch the path', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        expect(await harness.service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true })
        expect(await harness.service.replay(M1, { kind: 'redo' })).toMatchObject({ ok: true })
        expect(slot().name).toBe('N')
    })

    test('(c) an already replay: the flag was set to true outside history', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        db.db.modules[0] = { ...slot(), lowLevelAccess: true }
        expect(await harness.service.replay(M1, { kind: 'undo' })).toMatchObject({ ok: true, already: 'undo' })
        expect(slot().lowLevelAccess).toBe(true)
    })

    test('(d) a partial replay whose turn-on op fails its precondition leaves the flag out of the writes', async () => {
        put({ ...createShaped(), name: 'B', lowLevelAccess: false })
        await ready()
        expect(text('moduleDescription', 'base')).toEqual({ ok: true })
        const base = topOf('done')
        expect(on()).toEqual({ ok: true })
        expect(text('moduleName', 'A')).toEqual({ ok: true })
        // On to off: the revert needs no ask. Its stored step holds the name and the flag.
        expect(harness.service.revertTo(M1, base)).toMatchObject({ ok: true })
        expect(slot().name).toBe('B')
        // A replace-import of the replace-imported producer: the same name and no flag key, so the flag reads absent.
        replaceInPlace({ id: 'zz', name: 'B', description: 'd' })
        expect(Object.hasOwn(slot(), 'lowLevelAccess')).toBe(false)
        const result = await harness.service.replay(M1, { kind: 'undo' })
        expect(result).toMatchObject({ ok: true })
        expect(slot().name).toBe('A')
        expect(Object.hasOwn(slot(), 'lowLevelAccess')).toBe(false)
    })

    test('(e) a multi-write revert whose last write is off against a live off lands with no ask', async () => {
        put({ ...createShaped(), name: 'A', lowLevelAccess: false })
        await ready()
        expect(text('moduleDescription', 'base')).toEqual({ ok: true })
        const base = topOf('done')
        expect(on()).toEqual({ ok: true })
        expect(text('moduleName', 'B')).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        expect(harness.service.revertTo(M1, base)).toMatchObject({ ok: true })
        expect(slot().name).toBe('A')
        expect(slot().lowLevelAccess).toBe(false)
    })
})

describe('T5-GUARD-STALE: a confirmed re-run of an undo checks that the stack did not move', () => {
    test('through the helper: a new edit landed while the sheet was open, so Turn on lands nothing', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        const first = await harness.service.replay(M1, { kind: 'undo' })
        expect(first).toMatchObject({ ok: false, reason: 'confirm-low-level' })
        let answer: (value: boolean) => void = () => {}
        h.ask = () => new Promise<boolean>((resolve) => {
            answer = resolve
        })
        const pending = runWithLowLevelConfirm(first, 'M', (confirm, expectTop) => harness.service.replay(M1, { kind: 'undo', expectTop, confirm }))
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        const newest = topOf('done')
        answer(true)
        expect(await pending).toEqual({ ok: false, reason: 'precondition', targetChanged: true })
        expect(slot().lowLevelAccess).toBe(false)
        expect(slot().name).toBe('N')
        expect(topOf('done')).toBe(newest)
    })

    test('a re-run without the refusal\'s expectTop would undo the new top (the mutant the stale check kills)', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        const first = await harness.service.replay(M1, { kind: 'undo' })
        h.ask = () => Promise.resolve(true)
        // The host's callback ignores expectTop, as the mutant does; the name step is on top now.
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        const result = await runWithLowLevelConfirm(first, 'M', (confirm) => harness.service.replay(M1, { kind: 'undo', confirm }))
        expect(result).toMatchObject({ ok: true })
        expect(slot().name).toBe('')
    })
})

describe('runWithLowLevelConfirm', () => {
    test('a result that is not the refusal comes back as it is, with no ask', async () => {
        const asked = vi.fn(() => Promise.resolve(true))
        h.ask = asked
        const landed: StudioResult = { ok: true }
        expect(await runWithLowLevelConfirm(landed, 'M', () => ({ ok: true, unchanged: true }))).toBe(landed)
        const other: StudioResult = { ok: false, reason: 'precondition' }
        expect(await runWithLowLevelConfirm(other, 'M', () => ({ ok: true }))).toBe(other)
        expect(asked).not.toHaveBeenCalled()
    })

    test('Cancel returns the refusal marked cancelled and never re-runs', async () => {
        h.ask = () => Promise.resolve(false)
        const rerun = vi.fn(() => ({ ok: true }) as StudioResult)
        const result = await runWithLowLevelConfirm({ ok: false, reason: 'confirm-low-level', expectTop: 's1' }, 'M', rerun)
        expect(result).toEqual({ ok: false, reason: 'confirm-low-level', cancelled: true })
        expect(rerun).not.toHaveBeenCalled()
    })

    test('Turn on re-runs once with the confirm and the refusal\'s expectTop', async () => {
        h.ask = () => Promise.resolve(true)
        const rerun = vi.fn(() => ({ ok: true }) as StudioResult)
        expect(await runWithLowLevelConfirm({ ok: false, reason: 'confirm-low-level', expectTop: 's1' }, 'M', rerun)).toEqual({ ok: true })
        expect(rerun).toHaveBeenCalledTimes(1)
        expect(rerun).toHaveBeenCalledWith('lowLevelOn', 's1')
    })
})
