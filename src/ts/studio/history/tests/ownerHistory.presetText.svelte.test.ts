// @vitest-environment jsdom
// The preset owner through the real history service, the real history model and the real preset adapter over a
// real `$state` database and the real `changeToPreset`: every edit, undo, redo, revert and restore lands in the copy
// that is live at that moment (the working setting for the active preset, the slot for any other), a switch between
// two actions never strands a value, a keyless slot survives the round trip, and nothing about the owner reaches the
// store, the claim port or a save.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { presetOwnerKey } from 'src/ts/studio/edit/presetTarget'
import { keylessPreset, presetNamed, seedPresetDb, slotText } from 'src/ts/studio/edit/tests/presetFixture.test-helpers'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { isOpAllowedFor } from '../historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import { READY_DEADLINE_MS, SAVE_MAX_WAIT_MS, type OwnerKey } from '../ownerPhase'
import { createFakeClock, type FakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore, type MemoryStudioStore } from './studioStoreDoubles'

const PATH = 'customModuleToggle'

let clock: FakeClock
let store: MemoryStudioStore
let claim: ReturnType<typeof createClaimDouble>
let service: OwnerHistoryService
let ids: string[]
let keys: OwnerKey[]

function build(): void {
    clock = createFakeClock(1000)
    store = createMemoryStudioStore({ pageSession: 'p1' })
    claim = createClaimDouble()
    service = createOwnerHistoryService({
        store,
        claim,
        clock,
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
}

function seed(presets = [presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], active = 0, working = 'a=A'): void {
    ids = seedPresetDb(presets, active, working)
    keys = ids.map((id) => presetOwnerKey(id))
}

const edit = (index: number, value: string, mode: 'typing' | 'single' = 'single') => service.editText(keys[index], PATH, value, mode)
const working = (): unknown => DBState.db.customPromptTemplateToggle
const characters = (): string => JSON.stringify(DBState.db.characters)

beforeEach(() => {
    h.marks = 0
    resetStudioScreenForTests()
    seed()
    build()
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('T2: edits land in the live copy', () => {
    test('A1: editing the active preset changes the working setting and survives a switch away and back', () => {
        const resident = characters()
        expect(edit(0, 'a=edited')).toEqual({ ok: true })
        expect(working()).toBe('a=edited')
        expect(slotText(0)).toBe('a=A')
        changeToPreset(1)
        expect(working()).toBe('b=B')
        expect(slotText(0)).toBe('a=edited')
        changeToPreset(0)
        expect(working()).toBe('a=edited')
        expect(characters()).toBe(resident)
    })

    test('A2: editing an inactive preset changes its slot only, and switching to it shows the edit', () => {
        expect(edit(1, 'b=edited')).toEqual({ ok: true })
        expect(slotText(1)).toBe('b=edited')
        expect(working()).toBe('a=A')
        expect(slotText(0)).toBe('a=A')
        expect(slotText(2)).toBe('c=C')
        changeToPreset(1)
        expect(working()).toBe('b=edited')
    })

    test('A3/A4: a switch between the edit and its undo, redo and revert sends each write to the copy live then', () => {
        expect(edit(0, 'a=1')).toEqual({ ok: true })
        changeToPreset(1)
        // A is inactive now: its text is the slot, and B's working text is untouched.
        expect(edit(0, 'a=2')).toEqual({ ok: true })
        expect(slotText(0)).toBe('a=2')
        expect(working()).toBe('b=B')
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(slotText(0)).toBe('a=1')
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(slotText(0)).toBe('a=A')
        expect(working()).toBe('b=B')
        expect(service.redo(keys[0])).toEqual({ ok: true })
        expect(service.redo(keys[0])).toEqual({ ok: true })
        expect(slotText(0)).toBe('a=2')
        // Switch to A: the same steps now replay on the working setting.
        changeToPreset(0)
        expect(working()).toBe('a=2')
        const first = service.view(keys[0]).done[0].id
        expect(service.revertTo(keys[0], first)).toEqual({ ok: true })
        expect(working()).toBe('a=1')
        expect(slotText(1)).toBe('b=B')
        // The revert is a step of its own: undoing it brings the reverted text back.
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(working()).toBe('a=2')
        changeToPreset(2)
        expect(slotText(0)).toBe('a=2')
        expect(working()).toBe('c=C')
    })

    test('the restore point puts the text back in the copy live at the time', () => {
        expect(edit(0, 'a=1')).toEqual({ ok: true })
        changeToPreset(1)
        expect(edit(0, 'a=2')).toEqual({ ok: true })
        expect(service.view(keys[0]).restore).not.toBeNull()
        expect(service.restore(keys[0], new Set())).toMatchObject({ ok: true })
        expect(slotText(0)).toBe('a=A')
        expect(working()).toBe('b=B')
        changeToPreset(0)
        expect(working()).toBe('a=A')
    })

    test('typing steps of one path coalesce and a single step stays apart', () => {
        expect(edit(1, 'b=1', 'typing')).toEqual({ ok: true })
        expect(edit(1, 'b=12', 'typing')).toEqual({ ok: true })
        expect(service.view(keys[1]).done).toHaveLength(1)
        expect(edit(1, 'b=123', 'single')).toEqual({ ok: true })
        expect(service.view(keys[1]).done).toHaveLength(2)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(slotText(1)).toBe('b=12')
    })

    test('every other intent is refused and changes nothing', () => {
        const before = JSON.stringify(DBState.db)
        expect(service.editText(keys[1], 'desc', 'x')).toMatchObject({ ok: false })
        expect(service.editField(keys[1], 'desc', 'x')).toMatchObject({ ok: false })
        expect(service.greetingAdd(keys[1])).toMatchObject({ ok: false })
        expect(service.assetDelete(keys[1], 'additionalAssets', [0])).toEqual({ ok: false, reason: 'unknown' })
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('the preset kind allows a set of the toggle text and no other op', () => {
        const set = (path: string) => ({ op: 'set', path, before: { had: false }, after: { had: false } }) as never
        expect(isOpAllowedFor('preset', set(PATH))).toBe(true)
        expect(isOpAllowedFor('preset', set('desc'))).toBe(false)
        for (const op of ['listSet', 'listInsert', 'listRemove', 'chatFm', 'assetRowRemove', 'assetRowInsert', 'assetRowSet', 'assetFolderSet', 'assetFolderOrder', 'textEdit']) {
            expect(isOpAllowedFor('preset', { op } as never), op).toBe(false)
        }
    })

    test('a preset removed after an edit refuses undo as gone and changes no preset', () => {
        expect(edit(1, 'b=1')).toEqual({ ok: true })
        DBState.db.botPresets.splice(1, 1)
        const before = JSON.stringify(DBState.db)
        expect(service.undo(keys[1])).toEqual({ ok: false, reason: 'gone' })
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})

describe('T2k: a keyless slot through a switch', () => {
    function seedKeyless(): void {
        seed([presetNamed('Q', 'q=Q'), keylessPreset('K')], 0, 'q=Q')
        expect(Object.hasOwn(DBState.db.botPresets[1], 'customPromptTemplateToggle')).toBe(false)
    }

    test('edit while inactive, switch to it, undo, redo, switch back', () => {
        seedKeyless()
        expect(edit(1, 'x')).toEqual({ ok: true })
        expect(slotText(1)).toBe('x')
        changeToPreset(1)
        expect(working()).toBe('x')
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(working()).toBe('')
        expect(service.redo(keys[1])).toEqual({ ok: true })
        expect(working()).toBe('x')
        changeToPreset(0)
        expect(slotText(1)).toBe('x')
        expect(working()).toBe('q=Q')
    })

    test('an undo while still inactive writes an empty string and keeps the key', () => {
        seedKeyless()
        expect(edit(1, 'x')).toEqual({ ok: true })
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(Object.hasOwn(DBState.db.botPresets[1], 'customPromptTemplateToggle')).toBe(true)
        expect(slotText(1)).toBe('')
        expect(working()).toBe('q=Q')
    })

    test('the same through a revert to the first step', () => {
        seedKeyless()
        expect(edit(1, 'x')).toEqual({ ok: true })
        expect(edit(1, 'xy')).toEqual({ ok: true })
        changeToPreset(1)
        const first = service.view(keys[1]).done[0].id
        expect(service.revertTo(keys[1], first)).toEqual({ ok: true })
        expect(working()).toBe('x')
        changeToPreset(0)
        expect(slotText(1)).toBe('x')
        expect(working()).toBe('q=Q')
    })
})

describe('T3: nothing reaches the store, the claim port or a save', () => {
    test('past the save wait no open, load, save or claim happens, and the history stays in memory', async () => {
        service.useOwner(keys[1])
        expect(edit(1, 'b=1')).toEqual({ ok: true })
        expect(edit(1, 'b=2')).toEqual({ ok: true })
        await clock.advance(READY_DEADLINE_MS + SAVE_MAX_WAIT_MS + 10)
        expect(store.counts).toMatchObject({ open: 0, load: 0, save: 0 })
        expect(claim.calls).toEqual([])
        expect(clock.pendingTimers()).toBe(0)
    })

    test('use alone gives memory-only history for the session, not persisted and editable', () => {
        service.useOwner(keys[0])
        expect(service.view(keys[0])).toMatchObject({ phase: 'memoryOnly', banner: 'session', persisted: false, editable: true, restricted: false })
        expect(clock.pendingTimers()).toBe(0)
    })

    test('editing a preset that is gone and was never used is refused and leaves the owner unused', () => {
        const key = presetOwnerKey('no-such-preset')
        const before = JSON.stringify(DBState.db)
        expect(service.editText(key, PATH, 'x')).toEqual({ ok: false, reason: 'gone' })
        expect(service.view(key).phase).toBe('unused')
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('undo after the preset was deleted is refused as gone and writes nothing', () => {
        expect(edit(2, 'c=1')).toEqual({ ok: true })
        DBState.db.botPresets.splice(2, 1)
        const before = JSON.stringify(DBState.db)
        expect(service.undo(keys[2])).toEqual({ ok: false, reason: 'gone' })
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})
