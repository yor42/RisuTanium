// @vitest-environment jsdom
// The module Low Level Access confirm guard through the real history service, history model and setters over the memory
// store double, on a reactive database with the real save-mark hook. The one risky-flag guard in `applyStudioWrite`
// applies the last-write rule to this path (a module is written as one copy assigned once): a direct turn-on, an undo, a
// redo, a revert and a restore that would turn the engine reading on are refused `riskyConfirm` naming the path, with
// nothing changed, unless the call's own `confirmed` names it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/alert', () => ({ alertSelect: vi.fn() }))

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
import type { RiskyAsk } from 'src/ts/studio/edit/riskyConfirm.svelte'
import { pinnedDesc, resolveRiskyRefusal } from 'src/ts/studio/edit/riskyReplay'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService, type RiskyPin, type StudioResult } from '../ownerHistory.svelte'
import { moduleOwnerKey, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

type Obj = Record<string, unknown>

const M1 = moduleOwnerKey('M1')
const LOW = 'moduleLowLevelAccess'
const CONFIRM = { confirmed: [LOW] } as const
const NEEDS = { ok: false, reason: 'riskyConfirm', paths: [LOW] } as const
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
const setLow = (value: boolean, options?: { confirmed: readonly (typeof LOW)[] }): StudioResult => {
    const result = harness.service.editField(M1, LOW, value, options)
    harness.clock.tick(2000)
    return result
}
const on = (): StudioResult => setLow(true, CONFIRM)
const text = (path: 'moduleName' | 'moduleDescription', value: string) => harness.service.editText(M1, path, value, 'single')
const topOf = (list: 'done' | 'undone'): string => harness.service.view(M1)[list].at(-1)?.id ?? ''
const pinOf = (result: StudioResult): RiskyPin | undefined => (result.ok === false ? result.pin : undefined)
// A question that is answered at once; `resolveRiskyRefusal` is the host's retry loop under test.
const answering = (answer: 'yes' | 'no'): ((owner: OwnerKey, paths: readonly string[]) => Pick<RiskyAsk, 'answer'>) => () => ({ answer: Promise.resolve(answer) })

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
        expect(setLow(true)).toEqual(NEEDS)
        expectUnchanged(before)
        expect(Object.hasOwn(slot(), 'lowLevelAccess')).toBe(false)
        expect(setLow(true, CONFIRM)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
        expect(setLow(false)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(false)
    })
})

describe('T5-GUARD-VALUE: the value intent passes the same guard as the field intent', () => {
    const setValue = (value: boolean, options?: { confirmed: readonly (typeof LOW)[] }): StudioResult => {
        const result = harness.service.editValue(M1, LOW, value, options)
        harness.clock.tick(2000)
        return result
    }

    test('refused without confirm with nothing written or recorded; lands with it; turning off never asks', async () => {
        await ready()
        tracker.modules = false
        const before = take()
        expect(setValue(true)).toEqual(NEEDS)
        expectUnchanged(before)
        expect(Object.hasOwn(slot(), 'lowLevelAccess')).toBe(false)
        expect(setValue(true, CONFIRM)).toEqual({ ok: true })
        expect(slot().lowLevelAccess).toBe(true)
        expect(harness.service.view(M1).done.length).toBe(before.doneIds.length + 1)
        expect(setValue(false)).toEqual({ ok: true })
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
        expect(refused).toEqual({ ...NEEDS, pin: { expectTop: turnOff } })
        expectUnchanged(before)
        const landed = await harness.service.replay(M1, { kind: 'undo', expectTop: turnOff, ...CONFIRM })
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
        expect(refused).toMatchObject({ ...NEEDS, pin: { expectTop: topOf('undone') } })
        expectUnchanged(before)
        expect(await harness.service.replay(M1, pinnedDesc({ kind: 'redo' }, [LOW], pinOf(refused)))).toMatchObject({ ok: true })
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
        // The retry is pinned to the step and every step above it.
        const done = harness.service.view(M1).done.map((step) => step.id)
        const expectIds = done.slice(done.indexOf(turnOn))
        expect(harness.service.revertTo(M1, turnOn)).toEqual({ ...NEEDS, pin: { expectIds } })
        expectUnchanged(before)
        expect(slot().name).toBe('N')
        expect(slot().lowLevelAccess).toBe(false)
        const refused = await harness.service.replay(M1, { kind: 'revert', stepId: turnOn })
        expect(refused).toEqual({ ...NEEDS, pin: { expectIds } })
        expect(await harness.service.replay(M1, pinnedDesc({ kind: 'revert', stepId: turnOn }, [LOW], pinOf(refused)))).toMatchObject({ ok: true })
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
        expect(harness.service.restore(M1, new Set())).toEqual(NEEDS)
        expectUnchanged(before)
        expect(slot().lowLevelAccess).toBe(false)
        expect(harness.service.restore(M1, new Set(), CONFIRM)).toMatchObject({ ok: true })
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
        expect(refused).toEqual({ ...NEEDS, pin: { expectTop: topOf('done') } })
        expectUnchanged(before)
        expect(await harness.service.replay(M1, pinnedDesc({ kind: 'undo' }, [LOW], pinOf(refused)))).toMatchObject({ ok: true })
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
    test('through the helper: a new edit landed while the question was open, so Turn on lands nothing', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        const first = await harness.service.replay(M1, { kind: 'undo' })
        expect(first).toMatchObject({ ok: false, reason: 'riskyConfirm' })
        let answer: (value: 'yes' | 'no') => void = () => {}
        const ask = () => ({
            answer: new Promise<'yes' | 'no'>((resolve) => {
                answer = resolve
            }),
        })
        const pending = resolveRiskyRefusal(M1, first, (confirmed, pin) => harness.service.replay(M1, pinnedDesc({ kind: 'undo' }, confirmed, pin)), () => true, ask)
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        const newest = topOf('done')
        answer('yes')
        expect(await pending).toEqual({ ok: false, reason: 'precondition', targetChanged: true })
        expect(slot().lowLevelAccess).toBe(false)
        expect(slot().name).toBe('N')
        expect(topOf('done')).toBe(newest)
    })

    test('a re-run that ignores the refusal\'s pin would undo the new top (the mutant the stale check kills)', async () => {
        await ready()
        expect(on()).toEqual({ ok: true })
        expect(setLow(false)).toEqual({ ok: true })
        const first = await harness.service.replay(M1, { kind: 'undo' })
        // The host's attempt ignores the pin, as the mutant does; the name step is on top now.
        expect(text('moduleName', 'N')).toEqual({ ok: true })
        const result = await resolveRiskyRefusal(M1, first, (confirmed) => harness.service.replay(M1, { kind: 'undo', confirmed }), () => true, answering('yes'))
        expect(result).toMatchObject({ ok: true })
        expect(slot().name).toBe('')
    })
})