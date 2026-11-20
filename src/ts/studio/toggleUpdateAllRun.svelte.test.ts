// @vitest-environment jsdom
// Class G (new-behaviour guard): the visit run of update all over a real `$state` root, the real save marks and the
// real owner history service (memory store). Nothing here is a regression reproducer: the run is new behaviour.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({ marks: 0, countMarks: true }))

vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: () => {} }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: () => {} }))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/process/moduleRefList', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    const { matchesModuleRef } = await import('src/ts/process/moduleRefs')
    return {
        moduleListOf: (ids: string[]) => {
            const wanted = new Set(ids)
            return ((DBState.db as unknown as Database).modules ?? []).filter((row) => matchesModuleRef(row, wanted))
        },
    }
})

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { createSaveAck, type SaveAck, type SaveAckDeps } from 'src/ts/studio/edit/saveAck.svelte'
import { registerStudioField } from 'src/ts/studio/fieldFlush'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import {
    resetStudioHistoryAccessorForTests, setStudioHistoryServiceForTests, setStudioModuleAckForTests, setStudioVisitAckForTests,
} from 'src/ts/studio/history/studioHistoryService.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import type { ToggleTarget } from 'src/ts/studio/toggleBuilder.svelte'
import type { Rename } from 'src/ts/studio/toggleUpdateAll'
import { buildUpdatePlan, currentUpdate, resetUpdateRunForTests, runUpdateAll, undoLastUpdate, type UpdateRunDeps } from './toggleUpdateAllRun.svelte'
import { createUpdateDbPort } from './edit/toggleUpdateAllDb'

const READ = '{{getglobalvar::toggle_a}}'
const A_TO_B: Rename[] = [{ from: 'a', to: 'b' }]
const CHARACTER: ToggleTarget = { kind: 'character', chaId: 'c1' }
const MODULE: ToggleTarget = { kind: 'module', moduleId: 'M1' }
const C1 = characterOwnerKey('c1')
const M1 = moduleOwnerKey('M1')

function characterRow(desc: string, firstMessage = '') {
    return { chaId: 'c1', name: 'c1', type: 'character', desc, firstMessage, alternateGreetings: [], globalLore: [], customscript: [], triggerscript: [], customModuleToggle: '', chats: [{ id: 'chat1', note: '', name: 'chat', message: [], localLore: [] }], chatPage: 0 }
}

function moduleRow(content: string): RisuModule {
    return { id: 'M1', name: 'M1', description: '', lorebook: [{ key: 'k', comment: 'c', content, mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }], regex: [], trigger: [], customModuleToggle: '' } as unknown as RisuModule
}

let tracker: toSaveType
let service: OwnerHistoryService
let closed: { owner: string, desc: string }[]

const live = () => DBState.db.characters[0] as unknown as ReturnType<typeof characterRow>
const lore = () => (DBState.db.modules[0] as RisuModule).lorebook?.[0].content

function seed(desc: string, moduleContent: string | null = null): void {
    DBState.db = {
        characters: [characterRow(desc)], modules: moduleContent === null ? [] : [moduleRow(moduleContent)], enabledModules: moduleContent === null ? [] : ['M1'],
        botPresets: [], botPresetsId: 0, personas: [], plugins: [], loadouts: [], moduleIntergration: '',
    } as unknown as Database
}

const production: UpdateRunDeps = { port: createUpdateDbPort, markCount: () => h.marks }

// The production port with every module write refused, as when the module left the list between plan and write.
const refusingModules: UpdateRunDeps = {
    port: () => {
        const real = createUpdateDbPort()
        return { ...real, write: (ref, writes) => (ref.kind === 'module' ? false : real.write(ref, writes)) }
    },
    markCount: () => h.marks,
}

function shown(target: ToggleTarget = CHARACTER, renames: Rename[] = A_TO_B, optIn: string[] = []): string {
    return buildUpdatePlan(target, 'c1', renames, new Set(optIn)).signature
}

function run(shownSignature: string, target: ToggleTarget = CHARACTER, renames: () => Rename[] = () => A_TO_B) {
    return runUpdateAll({ target, chaId: 'c1', renames, optIn: new Set(), shownSignature }, production)
}

beforeEach(async () => {
    h.marks = 0
    h.countMarks = true
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    resetUpdateRunForTests()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: () => { if (h.countMarks) h.marks += 1 } })
    seed(`start ${READ}`, `lore ${READ}`)
    selIdState.selId = 0
    studioScreen.chaId = 'c1'
    studioScreen.open = true
    studioScreen.visitId = 'v1'
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    closed = []
    const original = service.closeOpenStep.bind(service)
    vi.spyOn(service, 'closeOpenStep').mockImplementation((owner) => {
        closed.push({ owner, desc: live().desc })
        original(owner)
    })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(C1)
})

afterEach(() => {
    vi.restoreAllMocks()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    resetUpdateRunForTests()
})

describe('the run writes what was shown (R1, R1b, R1c, R2)', () => {
    test('a landed run writes the character and the module, and returns a token and the count', () => {
        const result = run(shown(MODULE), MODULE)
        expect(result).toMatchObject({ ok: true, count: 2 })
        expect(live().desc).toBe('start {{getglobalvar::toggle_b}}')
        expect(lore()).toBe('lore {{getglobalvar::toggle_b}}')
        expect(currentUpdate()?.count).toBe(2)
    })

    test('R1 an edit that moves a use between display and click is stale: no write, no step closed', () => {
        const signature = shown()
        live().desc = `inserted ${live().desc}`
        expect(run(signature)).toEqual({ ok: false, reason: 'stale' })
        expect(live().desc).toBe(`inserted start ${READ}`)
        expect(closed).toEqual([])
        expect(currentUpdate()).toBeNull()
    })

    test('R1b a same-length edit that moves no use is kept in the written text', () => {
        const signature = shown()
        live().desc = `begin ${READ}`.replace('begin', 'START')
        expect(live().desc.length).toBe(`start ${READ}`.length)
        expect(run(signature).ok).toBe(true)
        expect(live().desc).toBe('START {{getglobalvar::toggle_b}}')
    })

    test('R1c a second identical use inserted before the first is stale, so the run never writes a plan it did not show', () => {
        const signature = shown()
        // The copy lands exactly where the shown use was, so the shown offset still reads a key; only a fresh scan sees two uses.
        live().desc = `start ${READ}${READ}`
        expect(run(signature)).toEqual({ ok: false, reason: 'stale' })
        expect(live().desc).toBe(`start ${READ}${READ}`)
    })

    // Compatibility guard (passes before and after): a click that still carries the signature shown before a landed run
    // rescans in its own task and finds the post-write texts, so it writes and closes nothing.
    test('R1d the signature shown before a landed run is stale afterwards: no second write, no further step closed', () => {
        const signature = shown(MODULE)
        expect(run(signature, MODULE)).toMatchObject({ ok: true, count: 2 })
        const closedAfterFirst = closed.length
        const marksAfterFirst = h.marks
        expect(run(signature, MODULE)).toEqual({ ok: false, reason: 'stale' })
        expect(live().desc).toBe('start {{getglobalvar::toggle_b}}')
        expect(lore()).toBe('lore {{getglobalvar::toggle_b}}')
        expect(closed.length).toBe(closedAfterFirst)
        expect(h.marks).toBe(marksAfterFirst)
    })

    test('R2 the renames are read after the held fields are flushed', () => {
        let renames: Rename[] = A_TO_B
        const signature = shown()
        const stop = registerStudioField(() => { renames = [{ from: 'a', to: 'c' }] })
        try {
            expect(run(signature, CHARACTER, () => renames)).toEqual({ ok: false, reason: 'stale' })
        } finally {
            stop()
        }
        expect(live().desc).toBe(`start ${READ}`)
    })

    test('no service gives unavailable before anything runs', () => {
        setStudioHistoryServiceForTests(null)
        expect(run(shown())).toEqual({ ok: false, reason: 'unavailable' })
        expect(live().desc).toBe(`start ${READ}`)
    })
})

describe('open steps and history (DB4, DB4b, DB5)', () => {
    test('DB4 every written owner closes its open step after the compare and before its first write, in the owner key format', () => {
        const signature = shown(MODULE)
        closed = []
        expect(run(signature, MODULE).ok).toBe(true)
        expect(closed).toEqual([{ owner: C1, desc: `start ${READ}` }, { owner: M1, desc: `start ${READ}` }])
        const token = currentUpdate()?.token
        closed = []
        expect(undoLastUpdate(token, production).ok).toBe(true)
        expect(closed).toEqual([{ owner: C1, desc: 'start {{getglobalvar::toggle_b}}' }, { owner: M1, desc: 'start {{getglobalvar::toggle_b}}' }])
    })

    test('DB4b typing before and after the update stays in separate steps; one undo reverts only the later typing; Undo all then succeeds', () => {
        expect(service.editText(C1, 'desc', `typed ${READ}`, 'typing')).toMatchObject({ ok: true })
        expect(run(shown()).ok).toBe(true)
        expect(service.editText(C1, 'desc', `typed {{getglobalvar::toggle_b}}!`, 'typing')).toMatchObject({ ok: true })
        expect(service.view(C1).done).toHaveLength(2)
        expect(service.undo(C1)).toMatchObject({ ok: true })
        expect(live().desc).toBe('typed {{getglobalvar::toggle_b}}')
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: true })
        expect(live().desc).toBe(`typed ${READ}`)
    })

    test('DB5 a run and its undo add no history step and move none between done and undone', () => {
        expect(service.editText(C1, 'desc', `typed ${READ}`, 'single')).toMatchObject({ ok: true })
        const before = service.view(C1)
        const doneIds = before.done.map((step) => step.id)
        expect(run(shown()).ok).toBe(true)
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: true })
        const after = service.view(C1)
        expect(after.done.map((step) => step.id)).toEqual(doneIds)
        expect(after.undone).toEqual(before.undone)
    })
})

describe('Undo all (DB6)', () => {
    test('Undo restores every text once; a second Undo is gone', () => {
        const signature = shown(MODULE)
        const first = run(signature, MODULE)
        if (!first.ok) {
            throw new Error('run failed')
        }
        expect(undoLastUpdate(first.token, production)).toEqual({ ok: true })
        expect(live().desc).toBe(`start ${READ}`)
        expect(lore()).toBe(`lore ${READ}`)
        expect(undoLastUpdate(first.token, production)).toEqual({ ok: false, reason: 'gone' })
    })

    test('a changed field refuses the whole Undo, names its owner, and writes nothing; the update stays gone for retry', () => {
        expect(run(shown(MODULE), MODULE).ok).toBe(true)
        live().desc += ' edited'
        closed = []
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: false, reason: 'changed', owner: C1 })
        expect(lore()).toBe('lore {{getglobalvar::toggle_b}}')
        expect(currentUpdate()).toBeNull()
        expect(closed).toEqual([])
    })

    test('a new visit, a closed Studio and a stale token are gone with no write', () => {
        const first = run(shown())
        if (!first.ok) {
            throw new Error('run failed')
        }
        expect(undoLastUpdate(first.token + 1, production)).toEqual({ ok: false, reason: 'gone' })
        studioScreen.visitId = 'v2'
        expect(currentUpdate()).toBeNull()
        expect(undoLastUpdate(first.token, production)).toEqual({ ok: false, reason: 'gone' })
        expect(live().desc).toBe('start {{getglobalvar::toggle_b}}')
        studioScreen.visitId = 'v1'
        studioScreen.open = false
        expect(undoLastUpdate(first.token, production)).toEqual({ ok: false, reason: 'gone' })
    })

    test('a second run replaces the first: the first token is gone', () => {
        const first = run(shown())
        if (!first.ok) {
            throw new Error('run failed')
        }
        const second = run(shown(CHARACTER, [{ from: 'b', to: 'c' }]), CHARACTER, () => [{ from: 'b', to: 'c' }])
        if (!second.ok) {
            throw new Error('second run failed')
        }
        expect(undoLastUpdate(first.token, production)).toEqual({ ok: false, reason: 'gone' })
        expect(undoLastUpdate(second.token, production)).toEqual({ ok: true })
    })
})

describe('the save ack (DB8)', () => {
    function fakeAck(): { ack: SaveAck, noted: { chaId: string, before: number }[] } {
        const noted: { chaId: string, before: number }[] = []
        const deps: SaveAckDeps = {
            getMarkCount: () => h.marks,
            getCommittedMarkCount: () => 0,
            afterNextCommit: () => {},
            requestSaveNow: () => {},
            getPeerSaveCount: () => 0,
            onStopped: () => () => {},
            isStopped: () => false,
            subscribeFailure: () => () => {},
            currentFailure: () => null,
            frozenKeys: () => new Set<string>(),
            isCharacterUnsavable: () => false,
            onPassStart: () => () => {},
            visible: () => true,
            onVisibilityChange: () => () => {},
            clock: createFakeClock(),
        }
        const ack = createSaveAck(deps)
        const real = ack.noteEdit.bind(ack)
        vi.spyOn(ack, 'noteEdit').mockImplementation((chaId, before) => {
            noted.push({ chaId, before })
            real(chaId, before)
        })
        return { ack, noted }
    }

    test('(a) marks that are not counted turn the visit ack to failed after the run and after Undo', () => {
        const { ack, noted } = fakeAck()
        setStudioVisitAckForTests(ack)
        h.countMarks = false
        expect(run(shown()).ok).toBe(true)
        expect(noted).toEqual([{ chaId: 'c1', before: 0 }])
        expect(ack.state).toBe('failed')
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: true })
        expect(noted).toHaveLength(2)
    })

    test('(b) counted marks leave the ack pending, with the count read before the first write', () => {
        const { ack, noted } = fakeAck()
        setStudioVisitAckForTests(ack)
        h.marks = 7
        expect(run(shown()).ok).toBe(true)
        expect(noted).toEqual([{ chaId: 'c1', before: 7 }])
        expect(ack.state).toBe('pending')
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: true })
        // The run marked the character and the module, so the count Undo reads first is 9.
        expect(noted[1]).toEqual({ chaId: 'c1', before: 9 })
    })

    test('(c) a module-only write notes the module ack of the toggle owner and no character ack; Undo does the same', () => {
        seed('nothing here', `lore ${READ}`)
        const visit = fakeAck()
        const module = fakeAck()
        setStudioVisitAckForTests(visit.ack)
        setStudioModuleAckForTests(() => module.ack)
        expect(run(shown(MODULE), MODULE).ok).toBe(true)
        expect(module.noted).toEqual([{ chaId: 'M1', before: 0 }])
        expect(visit.noted).toEqual([])
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: true })
        expect(module.noted).toHaveLength(2)
        expect(visit.noted).toEqual([])
    })

    test('(d) a character toggle owner with only another module written notes no module ack', () => {
        seed('nothing here', `lore ${READ}`)
        const module = fakeAck()
        setStudioModuleAckForTests(() => module.ack)
        expect(run(shown(CHARACTER), CHARACTER).ok).toBe(true)
        expect(lore()).toBe('lore {{getglobalvar::toggle_b}}')
        expect(module.noted).toEqual([])
    })

    test('(e) a module toggle owner whose own text is untouched notes no ack when only another module is written', () => {
        seed('nothing here', 'lore plain')
        DBState.db.modules = [moduleRow('lore plain'), { ...moduleRow(`lore ${READ}`), id: 'M2', name: 'M2' } as RisuModule]
        DBState.db.enabledModules = ['M1', 'M2']
        const visit = fakeAck()
        const module = fakeAck()
        setStudioVisitAckForTests(visit.ack)
        setStudioModuleAckForTests(() => module.ack)
        const result = run(shown(MODULE), MODULE)
        expect(result).toMatchObject({ ok: true, count: 1 })
        expect((DBState.db.modules[1] as RisuModule).lorebook?.[0].content).toBe('lore {{getglobalvar::toggle_b}}')
        expect(module.noted).toEqual([])
        expect(visit.noted).toEqual([])
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: true })
        expect(module.noted).toEqual([])
        expect(visit.noted).toEqual([])
    })

    test('(f) a run whose write is refused reports failed with no token, no Undo and no ack, and puts every text back', () => {
        const visit = fakeAck()
        const module = fakeAck()
        setStudioVisitAckForTests(visit.ack)
        setStudioModuleAckForTests(() => module.ack)
        const result = runUpdateAll({ target: MODULE, chaId: 'c1', renames: () => A_TO_B, optIn: new Set(), shownSignature: shown(MODULE) }, refusingModules)
        expect(result).toEqual({ ok: false, reason: 'failed' })
        expect(currentUpdate()).toBeNull()
        expect(undoLastUpdate(undefined, production)).toEqual({ ok: false, reason: 'gone' })
        expect(live().desc).toBe(`start ${READ}`)
        expect(lore()).toBe(`lore ${READ}`)
        expect(visit.noted).toEqual([])
        expect(module.noted).toEqual([])
    })

    test('(g) an Undo whose write is refused reports failed, notes no ack, and leaves every text as the update wrote it', () => {
        expect(run(shown(MODULE), MODULE).ok).toBe(true)
        const visit = fakeAck()
        const module = fakeAck()
        setStudioVisitAckForTests(visit.ack)
        setStudioModuleAckForTests(() => module.ack)
        expect(undoLastUpdate(undefined, refusingModules)).toEqual({ ok: false, reason: 'failed' })
        expect(live().desc).toBe('start {{getglobalvar::toggle_b}}')
        expect(lore()).toBe('lore {{getglobalvar::toggle_b}}')
        expect(visit.noted).toEqual([])
        expect(module.noted).toEqual([])
        // The attempt spends the Undo: a failed Undo is not offered again.
        expect(currentUpdate()).toBeNull()
    })
})

describe('the toggle owner is judged by DD-117 like every other owner', () => {
    // Regression reproducer: the rename was undone after the list was shown, so the owner's live text defines the old
    // key again. The click must refuse as stale and rewrite nothing, not rewrite the owner's and the module's uses to a
    // key no toggle defines.
    test('a rename undone after the list was shown makes the click stale and writes nothing', () => {
        live().customModuleToggle = 'b=A'
        const signature = shown()
        live().customModuleToggle = 'a=A'
        expect(run(signature)).toEqual({ ok: false, reason: 'stale' })
        expect(live().desc).toBe(`start ${READ}`)
        expect(lore()).toBe(`lore ${READ}`)
        expect(currentUpdate()).toBeNull()
    })

    test('the toggle owner whose text defines the old key is skipped, and the rest of the plan still lists', () => {
        live().customModuleToggle = 'b=A\na=New'
        const plan = buildUpdatePlan(CHARACTER, 'c1', A_TO_B, new Set())
        expect(plan.skipped).toEqual([{ owner: C1, key: 'a', count: 1 }])
        expect(plan.writes.map((write) => write.owner)).toEqual([M1])
        expect(run(plan.signature)).toMatchObject({ ok: true, count: 1 })
        expect(live().desc).toBe(`start ${READ}`)
        expect(lore()).toBe('lore {{getglobalvar::toggle_b}}')
    })

    test('a module toggle owner is judged the same way, and another source that defines the old key is skipped', () => {
        const module = DBState.db.modules[0] as RisuModule
        module.customModuleToggle = 'a=A'
        live().customModuleToggle = 'a=A'
        const plan = buildUpdatePlan(MODULE, 'c1', A_TO_B, new Set())
        expect(plan.skipped.map((entry) => entry.owner).sort()).toEqual([C1, M1].sort())
        expect(plan.count).toBe(0)
    })
})

describe('a run that writes nothing keeps the Undo all of an earlier run', () => {
    test('a count 0 run is ok with count 0, writes and closes nothing, and leaves the earlier update undoable', () => {
        const first = run(shown())
        if (!first.ok) {
            throw new Error('run failed')
        }
        const none: Rename[] = [{ from: 'zz', to: 'yy' }]
        closed = []
        const noop = run(shown(CHARACTER, none), CHARACTER, () => none)
        expect(noop).toEqual({ ok: true, token: first.token, count: 0 })
        expect(closed).toEqual([])
        expect(currentUpdate()).toMatchObject({ token: first.token, count: 2 })
        expect(undoLastUpdate(first.token, production)).toEqual({ ok: true })
        expect(live().desc).toBe(`start ${READ}`)
    })

    test('with no earlier update a count 0 run leaves no update to undo', () => {
        const none: Rename[] = [{ from: 'zz', to: 'yy' }]
        expect(run(shown(CHARACTER, none), CHARACTER, () => none)).toMatchObject({ ok: true, count: 0 })
        expect(currentUpdate()).toBeNull()
    })
})
