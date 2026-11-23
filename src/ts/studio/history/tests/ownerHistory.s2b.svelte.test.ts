// @vitest-environment jsdom
// T2-RF-1 to T2-RF-8 and T2-RF-10: the risky-flag gate of the real owner history service. Nothing turns a flag from
// not-on to on unless the call names that flag as confirmed; a refused call writes, marks and records nothing; a
// retry is pinned to the target the refused call found; confirmation never outlives its call. The service, the setters,
// the store double and the save marks are real; the clock is fake.
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
        { chaId: 'A', name: 'A', desc: 'd0', firstMessage: 'f0', exampleMessage: 'e0', systemPrompt: 's0', alternateGreetings: [], chats: [], chatPage: 0, ...extra },
    ] as unknown as typeof DBState.db.characters
}

async function ready(extra: Record<string, unknown>): Promise<OwnerHistoryService> {
    seed(extra)
    const service = build()
    await service.whenReady(A)
    return service
}

const topId = (service: OwnerHistoryService, list: 'done' | 'undone'): string | undefined => service.view(A)[list].at(-1)?.id

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

describe('T2-RF-1: an unconfirmed turn-on is refused and leaves everything as it was', () => {
    test('editField true over false, over an absent optional flag and over an absent required flag', async () => {
        const service = await ready({ utilityBot: false })
        expect(service.editField(A, 'utilityBot', true)).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['utilityBot'] })
        expect(service.editField(A, 'lowLevelAccess', true)).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['lowLevelAccess'] })
        expect(service.editField(A, 'escapeOutput', true)).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['escapeOutput'] })
        expect(live().utilityBot).toBe(false)
        expect('lowLevelAccess' in live()).toBe(false)
        expect('escapeOutput' in live()).toBe(false)
        expect(h.marks).toBe(0)
        expect(service.view(A).done).toHaveLength(0)
    })

    test('a refusal leaves the open step as it is', async () => {
        const service = await ready({ utilityBot: false })
        expect(service.editText(A, 'systemPrompt', 's1', 'typing').ok).toBe(true)
        expect(service.editField(A, 'utilityBot', true).ok).toBe(false)
        expect(service.editText(A, 'systemPrompt', 's2', 'typing').ok).toBe(true)
        expect(service.view(A).done).toHaveLength(1)
    })

    test('a confirmed call lands as one step, and the flag turns off without a question', async () => {
        const service = await ready({ utilityBot: false })
        expect(service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null })).toEqual({ ok: true })
        expect(live().utilityBot).toBe(true)
        expect(service.view(A).done).toHaveLength(1)
        expect(service.editField(A, 'utilityBot', false, { coalesceKey: null })).toEqual({ ok: true })
        expect(live().utilityBot).toBe(false)
    })
})

describe('T2-RF-2: a redo of a turn-on asks, pinned to the step it would replay', () => {
    test('the refusal names the path and the top of undone; the pinned confirmed retry applies', async () => {
        const service = await ready({})
        expect(service.editField(A, 'lowLevelAccess', true, { confirmed: ['lowLevelAccess'], coalesceKey: null }).ok).toBe(true)
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect('lowLevelAccess' in live()).toBe(false)
        const stepId = topId(service, 'undone')!
        const refused = await service.replay(A, { kind: 'redo' })
        expect(refused).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['lowLevelAccess'], pin: { expectTop: stepId } })
        expect('lowLevelAccess' in live()).toBe(false)
        expect(topId(service, 'undone')).toBe(stepId)
        expect((await service.replay(A, { kind: 'redo', expectTop: stepId, confirmed: ['lowLevelAccess'] })).ok).toBe(true)
        expect(live().lowLevelAccess).toBe(true)
    })
})

describe('T2-RF-3: undoing a turn-on and replaying over a flag already on never ask', () => {
    test('an undo of a turn-on lands', async () => {
        const service = await ready({ utilityBot: false })
        service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null })
        expect((await service.replay(A, { kind: 'undo' })).ok).toBe(true)
        expect(live().utilityBot).toBe(false)
    })

    test('an undo of a turn-off over a flag that is on again is `already`, not a refusal', async () => {
        const service = await ready({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        live().utilityBot = true
        expect(await service.replay(A, { kind: 'undo' })).toEqual({ ok: true, already: 'undo' })
    })

    test('a redo of a turn-on over a flag that is on is `already`, not a refusal', async () => {
        const service = await ready({ utilityBot: false })
        service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null })
        await service.replay(A, { kind: 'undo' })
        live().utilityBot = true
        expect(await service.replay(A, { kind: 'redo' })).toEqual({ ok: true, already: 'redo' })
    })
})

describe('T2-RF-4: a revert across a turn-off asks, pinned to the step and every step above it', () => {
    test('the refusal carries expectIds; the retry with them and the confirmation applies', async () => {
        const service = await ready({ utilityBot: true })
        service.editText(A, 'desc', 'd1', 'single')
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        service.editText(A, 'systemPrompt', 's1', 'single')
        const done = service.view(A).done.map((step) => step.id)
        const refused = await service.replay(A, { kind: 'revert', stepId: done[0] })
        expect(refused).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['utilityBot'], pin: { expectIds: done } })
        expect(live().utilityBot).toBe(false)
        expect(live().systemPrompt).toBe('s1')
        const retried = await service.replay(A, { kind: 'revert', stepId: done[0], expectIds: done, confirmed: ['utilityBot'] })
        expect(retried.ok).toBe(true)
        expect(live().utilityBot).toBe(true)
        expect(live().systemPrompt).toBe('s0')
    })
})

describe('T2-RF-5: a restore point that turns a flag on asks', () => {
    test('refused without the confirmation, applied with it', async () => {
        const service = await ready({ utilityBot: true })
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        const keep = new Set<never>()
        const refused = service.restore(A, keep)
        expect(refused).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['utilityBot'] })
        expect(live().utilityBot).toBe(false)
        expect(service.restore(A, keep, { confirmed: ['utilityBot'] }).ok).toBe(true)
        expect(live().utilityBot).toBe(true)
    })
})

describe('T2-RF-6: confirming one path admits no other', () => {
    test('a revert that turns two flags on names only the one left unconfirmed', async () => {
        const service = await ready({ utilityBot: true, lowLevelAccess: true })
        service.editText(A, 'desc', 'd1', 'single')
        service.editField(A, 'utilityBot', false, { coalesceKey: null })
        service.editField(A, 'lowLevelAccess', false, { coalesceKey: null })
        const done = service.view(A).done.map((step) => step.id)
        const first = await service.replay(A, { kind: 'revert', stepId: done[0] })
        expect(first).toMatchObject({ ok: false, reason: 'riskyConfirm' })
        expect([...(first.ok === false ? (first.paths ?? []) : [])].sort()).toEqual(['lowLevelAccess', 'utilityBot'])
        const partial = await service.replay(A, { kind: 'revert', stepId: done[0], expectIds: done, confirmed: ['utilityBot'] })
        expect(partial).toMatchObject({ ok: false, reason: 'riskyConfirm', paths: ['lowLevelAccess'] })
        expect(live().utilityBot).toBe(false)
        expect(live().lowLevelAccess).toBe(false)
        expect((await service.replay(A, { kind: 'revert', stepId: done[0], expectIds: done, confirmed: ['utilityBot', 'lowLevelAccess'] })).ok).toBe(true)
        expect(live().utilityBot).toBe(true)
        expect(live().lowLevelAccess).toBe(true)
    })
})

describe('T2-RF-7: a step that lands during the question makes the retry `targetChanged`', () => {
    test('a redo (a); an undo of a turn-off (b); a revert (c)', async () => {
        const redo = await ready({ utilityBot: false })
        redo.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null })
        await redo.replay(A, { kind: 'undo' })
        const redoRefusal = await redo.replay(A, { kind: 'redo' })
        expect(redoRefusal.ok).toBe(false)
        redo.editText(A, 'systemPrompt', 'typed', 'single')
        const stale = redoRefusal.ok === false ? redoRefusal.pin : undefined
        expect(await redo.replay(A, { kind: 'redo', ...(stale && 'expectTop' in stale ? { expectTop: stale.expectTop } : {}), confirmed: ['utilityBot'] })).toEqual({ ok: false, reason: 'precondition', targetChanged: true })
        expect(live().utilityBot).toBe(false)

        const undo = await ready({ utilityBot: true })
        undo.editField(A, 'utilityBot', false, { coalesceKey: null })
        const undoRefusal = await undo.replay(A, { kind: 'undo' })
        expect(undoRefusal.ok).toBe(false)
        undo.editText(A, 'systemPrompt', 'typed', 'single')
        const landed = topId(undo, 'done')
        const undoPin = undoRefusal.ok === false ? undoRefusal.pin : undefined
        expect(await undo.replay(A, { kind: 'undo', ...(undoPin && 'expectTop' in undoPin ? { expectTop: undoPin.expectTop } : {}), confirmed: ['utilityBot'] })).toEqual({ ok: false, reason: 'precondition', targetChanged: true })
        expect(topId(undo, 'done')).toBe(landed)
        expect(live().systemPrompt).toBe('typed')
        expect(live().utilityBot).toBe(false)

        const revert = await ready({ utilityBot: true })
        revert.editText(A, 'desc', 'd1', 'single')
        revert.editField(A, 'utilityBot', false, { coalesceKey: null })
        const first = revert.view(A).done[0].id
        const revertRefusal = await revert.replay(A, { kind: 'revert', stepId: first })
        expect(revertRefusal.ok).toBe(false)
        revert.editText(A, 'systemPrompt', 'typed', 'single')
        const revertLanded = topId(revert, 'done')
        const revertPin = revertRefusal.ok === false ? revertRefusal.pin : undefined
        expect(await revert.replay(A, { kind: 'revert', stepId: first, ...(revertPin && 'expectIds' in revertPin ? { expectIds: revertPin.expectIds } : {}), confirmed: ['utilityBot'] })).toEqual({ ok: false, reason: 'precondition', targetChanged: true })
        expect(topId(revert, 'done')).toBe(revertLanded)
        expect(live().systemPrompt).toBe('typed')
    })
})

describe('T2-RF-8: confirmation never outlives its call', () => {
    test('after a confirmed edit and a turn-off, a third unconfirmed turn-on is refused', async () => {
        const service = await ready({ utilityBot: false })
        expect(service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null }).ok).toBe(true)
        expect(service.editField(A, 'utilityBot', false, { coalesceKey: null }).ok).toBe(true)
        expect(service.editField(A, 'utilityBot', true, { coalesceKey: null })).toMatchObject({ ok: false, reason: 'riskyConfirm' })
        expect(live().utilityBot).toBe(false)
    })

    test('after a confirmed redo and an undo, an unconfirmed redo is refused', async () => {
        const service = await ready({ utilityBot: false })
        service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null })
        await service.replay(A, { kind: 'undo' })
        expect((await service.replay(A, { kind: 'redo', confirmed: ['utilityBot'] })).ok).toBe(true)
        await service.replay(A, { kind: 'undo' })
        expect(await service.replay(A, { kind: 'redo' })).toMatchObject({ ok: false, reason: 'riskyConfirm' })
        expect(live().utilityBot).toBe(false)
    })
})

describe('U-1: a character revert whose writes turn the flag on and later off still asks (compatibility guard: passes before and after the unification)', () => {
    // Character writes land in place one at a time, so the intermediate turn-on is live whatever the last write says.
    test('the refusal carries the pin and changes nothing; the confirmed pinned retry lands whole', async () => {
        const service = await ready({ utilityBot: false })
        service.editText(A, 'desc', 'd1', 'single')
        const base = topId(service, 'done')!
        expect(service.editField(A, 'utilityBot', true, { confirmed: ['utilityBot'], coalesceKey: null }).ok).toBe(true)
        service.editText(A, 'systemPrompt', 's1', 'single')
        expect(service.editField(A, 'utilityBot', false, { coalesceKey: null }).ok).toBe(true)
        const done = service.view(A).done.map((step) => step.id)
        const refused = await service.replay(A, { kind: 'revert', stepId: base })
        expect(refused).toEqual({ ok: false, reason: 'riskyConfirm', paths: ['utilityBot'], pin: { expectIds: done } })
        expect(live().utilityBot).toBe(false)
        expect(live().systemPrompt).toBe('s1')
        expect(service.view(A).done.map((step) => step.id)).toEqual(done)
        expect((await service.replay(A, { kind: 'revert', stepId: base, expectIds: done, confirmed: ['utilityBot'] })).ok).toBe(true)
        expect(live().utilityBot).toBe(false)
        expect(live().systemPrompt).toBe('s0')
    })
})

describe('U-3: the value intent passes the same guard as the field intent, for each character flag', () => {
    const flags = ['lowLevelAccess', 'utilityBot', 'escapeOutput'] as const

    // Each flag is stored as false: an absent required flag (`utilityBot`) is refused `precondition` in planning, before the guard runs; an absent optional flag reaches the guard.
    const stored = { lowLevelAccess: false, utilityBot: false, escapeOutput: false }

    test.each(flags)('%s: refused without a pin and with nothing written, recorded or marked', async (path) => {
        const service = await ready(stored)
        expect(service.editValue(A, path, true)).toEqual({ ok: false, reason: 'riskyConfirm', paths: [path] })
        expect(live()[path]).toBe(false)
        expect(service.view(A).done).toHaveLength(0)
        expect(h.marks).toBe(0)
    })

    test.each(flags)('%s: lands when confirmed', async (path) => {
        const service = await ready(stored)
        expect(service.editValue(A, path, true, { confirmed: [path] })).toEqual({ ok: true })
        expect(live()[path]).toBe(true)
    })

    test.each(flags)('%s: still refused when another risky path is confirmed', async (path) => {
        const other = flags.find((candidate) => candidate !== path)!
        const service = await ready(stored)
        expect(service.editValue(A, path, true, { confirmed: [other] })).toEqual({ ok: false, reason: 'riskyConfirm', paths: [path] })
        expect(live()[path]).toBe(false)
    })
})

describe('T2-RF-10: a write that holds no flag passes the gate unchanged (compatibility guard: passes before and after)', () => {
    test('a text edit, an undo and a redo land with no confirmation', async () => {
        const service = await ready({})
        expect(service.editText(A, 'systemPrompt', 's1', 'single')).toEqual({ ok: true })
        expect(service.undo(A).ok).toBe(true)
        expect(service.redo(A).ok).toBe(true)
        expect(live().systemPrompt).toBe('s1')
    })
})

describe('T2-CK: the open-step key of an edit', () => {
    test('a string key joins the typing of its own key only, and null makes a step of its own', async () => {
        const service = await ready({})
        expect(service.editField(A, 'desc', 'a', { coalesceKey: 'row:1' }).ok).toBe(true)
        expect(service.editField(A, 'desc', 'ab', { coalesceKey: 'row:1' }).ok).toBe(true)
        expect(service.view(A).done).toHaveLength(1)
        expect(service.editField(A, 'desc', 'abc', { coalesceKey: 'row:2' }).ok).toBe(true)
        expect(service.view(A).done).toHaveLength(2)
        expect(service.editField(A, 'desc', 'abcd', { coalesceKey: null }).ok).toBe(true)
        expect(service.editField(A, 'desc', 'abcde', { coalesceKey: null }).ok).toBe(true)
        expect(service.view(A).done).toHaveLength(4)
        expect(service.editField(A, 'desc', 'abcdef').ok).toBe(true)
        expect(service.editField(A, 'desc', 'abcdefg').ok).toBe(true)
        expect(service.view(A).done).toHaveLength(5)
    })
})