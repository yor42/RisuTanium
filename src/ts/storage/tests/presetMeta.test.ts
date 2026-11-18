// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

// The mirror's `setPreset` is the real one; only the modules its import graph would start effects in are replaced.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { setDatabase, setPreset, type botPreset, type Database } from 'src/ts/storage/database.svelte'
import {
    PRESET_META_KEYS, applySlotPlan, assignPresetIds, carryPresetMeta, createPresetFolder, deletePresetFolder, freshPresetMeta,
    migratePresetSlots, movePresetFolder, movePresetToFolder, planSlotAssign, presetFolderOf, presetIndexForSlot, renamePresetFolder,
    slotBadgeFor, takePresetIdsMinted, withoutPresetMeta,
} from 'src/ts/storage/presetMeta'
import {
    UPSTREAM_DEFAULT_HOTKEYS, setMirrorPresetApplier, upstreamChangeToPreset, upstreamCopyPreset, upstreamMovePreset,
} from 'src/ts/drive/tests/upstreamPresetMirror'

setMirrorPresetApplier(setPreset)

/** Presets `P0..P5` with ids, folders F1/F2 and slots 1..5 on P0..P4, as a fork profile holds them. */
function forkDb(): Database {
    const presets = [0, 1, 2, 3, 4, 5].map((n): botPreset => {
        const preset = { name: `P${n}`, temperature: n } as botPreset
        preset.id = `id-P${n}`
        if (n < 5) preset.slot = n + 1
        if (n === 0 || n === 1) preset.folderId = 'F1'
        if (n >= 2 && n <= 4) preset.folderId = 'F2'
        return preset
    })
    return {
        botPresets: presets,
        botPresetsId: 3,
        presetFolders: [{ id: 'F1', name: 'One' }, { id: 'F2', name: 'Two' }],
        NAIsettings: {},
        temperature: 3,
    } as unknown as Database
}

const ids = (db: Pick<Database, 'botPresets'>) => db.botPresets.map((p) => p.id)

beforeEach(() => {
    takePresetIdsMinted()
})

describe('assignPresetIds', () => {
    test('A1 (pure) an id-less list gets pairwise distinct string ids, and a second call keeps them', () => {
        const db = { botPresets: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as botPreset[] }
        expect(assignPresetIds(db)).toBe(true)
        const first = ids(db)
        expect(first.every((id) => typeof id === 'string' && id !== '')).toBe(true)
        expect(new Set(first).size).toBe(3)
        expect(assignPresetIds(db)).toBe(false)
        expect(ids(db)).toEqual(first)
    })

    test('A2 an upstream copy of a non-active entry leaves two holders of one id; both are re-minted, slots cleared, folder kept', () => {
        const db = forkDb()
        const source = db.botPresets.map((p) => ({ ...p }))
        // Upstream rebuilds the active P3 (no meta survives), then clones P4 with its meta, then the person moves the copy first.
        upstreamCopyPreset(db, 4)
        upstreamMovePreset(db, 6, 0)
        const copy = db.botPresets[0]
        const original = db.botPresets.find((p) => p.name === 'P4') as botPreset
        expect(copy.id).toBe('id-P4')
        expect(original.id).toBe('id-P4')
        const p3 = db.botPresets.find((p) => p.name === 'P3') as botPreset
        expect(p3.id).toBeUndefined()

        expect(assignPresetIds(db)).toBe(true)

        expect(new Set(ids(db)).size).toBe(7)
        expect(ids(db).every((id) => typeof id === 'string')).toBe(true)
        for (const holder of [copy, original]) {
            expect(holder.id).not.toBe('id-P4')
            expect(holder.slot).toBeUndefined()
            expect(holder.folderId).toBe('F2')
        }
        expect(p3.id).toMatch(/./)
        for (const name of ['P0', 'P1', 'P2', 'P5']) {
            const now = db.botPresets.find((p) => p.name === name) as botPreset
            const was = source.find((p) => p.name === name) as botPreset
            expect(now.id).toBe(was.id)
        }
    })

    test('A2 (a)/(b) the return value is true when only a shared pair was re-minted, and false once the pair is fixed', () => {
        const db = { botPresets: [{ name: 'a', id: 'x' }, { name: 'b', id: 'x' }, { name: 'c', id: 'y' }] as botPreset[] }
        expect(assignPresetIds(db)).toBe(true)
        expect(db.botPresets[2].id).toBe('y')
        expect(assignPresetIds(db)).toBe(false)
    })

    test('a sole holder of an id keeps its id, slot and folder whatever its name', () => {
        const db = { botPresets: [{ name: 'P4', id: 'k1' }, { name: 'P4 Copy', id: 'k2', slot: 5, folderId: 'F2' }] as botPreset[] }
        expect(assignPresetIds(db)).toBe(false)
        expect(db.botPresets[1]).toMatchObject({ id: 'k2', slot: 5, folderId: 'F2' })
    })

    test('A17 the mint flag follows the return value and is cleared by the take', () => {
        const idLess = { botPresets: [{ name: 'a' }] as botPreset[] }
        expect(assignPresetIds(idLess)).toBe(true)
        expect(takePresetIdsMinted()).toBe(true)
        expect(takePresetIdsMinted()).toBe(false)

        const distinct = { botPresets: [{ name: 'a', id: 'x' }, { name: 'b', id: 'y' }] as botPreset[] }
        expect(assignPresetIds(distinct)).toBe(false)
        expect(takePresetIdsMinted()).toBe(false)

        const shared = { botPresets: [{ name: 'a', id: 'x' }, { name: 'b', id: 'x' }, { name: 'c', id: 'y' }] as botPreset[] }
        expect(assignPresetIds(shared)).toBe(true)
        expect(takePresetIdsMinted()).toBe(true)
    })

    test('the list order is never changed', () => {
        const db = forkDb()
        const before = db.botPresets.map((p) => p.name)
        db.botPresets[2].id = db.botPresets[4].id
        assignPresetIds(db)
        expect(db.botPresets.map((p) => p.name)).toEqual(before)
    })
})

describe('preset meta helpers', () => {
    test('A3 (helper) carryPresetMeta keeps id, folder and slot of the entry a rebuild replaces', () => {
        const prev = { id: 'i', folderId: 'F1', slot: 4 } as botPreset
        const rebuilt = carryPresetMeta({ name: 'x' } as botPreset, prev)
        expect(rebuilt).toMatchObject({ id: 'i', folderId: 'F1', slot: 4 })
        expect(PRESET_META_KEYS).toEqual(['id', 'folderId', 'slot'])
    })

    test('A5 (helper) freshPresetMeta gives a new id, drops the slot and keeps the folder only when asked', () => {
        const kept = freshPresetMeta({ id: 'i', folderId: 'F1', slot: 3 } as botPreset, { keepFolder: true })
        expect(kept.id).not.toBe('i')
        expect(kept.slot).toBeUndefined()
        expect(kept.folderId).toBe('F1')
        const dropped = freshPresetMeta({ id: 'i', folderId: 'F1', slot: 3 } as botPreset, { keepFolder: false })
        expect(dropped.folderId).toBeUndefined()
        expect(Object.keys(dropped)).not.toContain('slot')
    })

    test('A7 (helper) withoutPresetMeta removes the three keys and leaves the source untouched', () => {
        const source = { name: 'n', id: 'i', folderId: 'F1', slot: 2 } as botPreset
        const bare = withoutPresetMeta(source)
        expect(bare).toEqual({ name: 'n' })
        expect(source.id).toBe('i')
    })
})

describe('A11 folders', () => {
    test('create, rename, move a preset in, move a folder, and delete a folder that moves its members to no folder', () => {
        const db = forkDb()
        const id = createPresetFolder(db, 'Three')
        expect(db.presetFolders?.map((f) => f.name)).toEqual(['One', 'Two', 'Three'])
        expect(renamePresetFolder(db, id, 'Third')).toBe(true)
        expect(movePresetToFolder(db, 5, id)).toBe(true)
        expect(db.botPresets[5].folderId).toBe(id)
        expect(presetFolderOf(db, db.botPresets[5])?.name).toBe('Third')
        expect(movePresetFolder(db, id, 0)).toBe(true)
        expect(db.presetFolders?.map((f) => f.name)).toEqual(['Third', 'One', 'Two'])

        expect(deletePresetFolder(db, 'F2')).toBe(true)
        expect(db.presetFolders?.map((f) => f.id)).toEqual([id, 'F1'])
        for (const n of [2, 3, 4]) {
            expect(db.botPresets[n].folderId).toBeUndefined()
        }
        expect(db.botPresets[0].folderId).toBe('F1')
        expect(deletePresetFolder(db, 'F2')).toBe(false)
    })

    test('a folder id that names no folder reads as none, and a move to a missing folder is refused', () => {
        const db = forkDb()
        db.botPresets[0].folderId = 'gone'
        expect(presetFolderOf(db, db.botPresets[0])).toBeNull()
        expect(presetFolderOf(db, { name: 'x' } as botPreset)).toBeNull()
        expect(movePresetToFolder(db, 0, 'gone')).toBe(false)
        expect(db.botPresets[0].folderId).toBe('gone')
        expect(movePresetToFolder(db, 0, undefined)).toBe(true)
        expect(db.botPresets[0].folderId).toBeUndefined()
    })

    test('folders are flat: the type has no parent and a folder id is never a preset id lookup', () => {
        const db = forkDb()
        const id = createPresetFolder(db, 'Flat')
        expect(Object.keys(db.presetFolders?.find((f) => f.id === id) ?? {}).sort()).toEqual(['id', 'name'])
    })
})

/** `count` presets named `P0..`, each with an id; `slots` maps a preset index to the slot it holds. */
function slotted(count: number, slots: Record<number, number> = {}): botPreset[] {
    return Array.from({ length: count }, (_, i): botPreset => {
        const preset = { name: `P${i}`, id: `id-${i}` } as botPreset
        if (slots[i] !== undefined) preset.slot = slots[i]
        return preset
    })
}

const slotOf = (db: Pick<Database, 'botPresets'>) => db.botPresets.map((p) => p.slot)
const slotRows = (db: Pick<Database, 'hotkeys'>) => db.hotkeys.filter((row) => row.action.startsWith('presetSlot')).map((row) => row.action)

describe('slot resolution', () => {
    test('a value that is not an integer from 1 to 9 is ignored, and the first valid holder of a slot wins', () => {
        const presets = slotted(6)
        for (const [i, bad] of [0, 10, 1.5, Number.NaN, -1].entries()) presets[i].slot = bad
        ;(presets[5] as { slot: unknown }).slot = '2'
        expect(presetIndexForSlot(presets, 2)).toBe(-1)
        presets[3].slot = 2
        presets[4].slot = 2
        expect(presetIndexForSlot(presets, 2)).toBe(3)
        expect(presets[0].slot).toBe(0)
    })

    test('L1 (pure) the badge is the slot exactly when the resolver lands on this entry', () => {
        const presets = slotted(4, { 0: 2, 1: 1, 3: 2 })
        expect([0, 1, 2, 3].map((i) => slotBadgeFor(presets, i))).toEqual([2, 1, undefined, undefined])
        presets[2].slot = 12
        expect(slotBadgeFor(presets, 2)).toBeUndefined()
    })
})

describe('migratePresetSlots', () => {
    test('B5 an upstream profile (upstream rows, no slots, 11 presets) gets slots 1..9 in list order and the slot rows after upstream\'s rows; a cleared slot stays empty', () => {
        const data = {
            botPresets: slotted(11).map((p) => ({ name: p.name })),
            botPresetsId: 0,
            hotkeys: structuredClone(UPSTREAM_DEFAULT_HOTKEYS),
        } as unknown as Database
        setDatabase(data)
        expect(slotOf(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, undefined, undefined])
        expect(data.hotkeys.slice(0, UPSTREAM_DEFAULT_HOTKEYS.length)).toEqual(UPSTREAM_DEFAULT_HOTKEYS)
        expect(slotRows(data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `presetSlot${n}`))
        delete data.botPresets[2].slot
        setDatabase(data)
        expect(slotOf(data)).toEqual([1, 2, undefined, 4, 5, 6, 7, 8, 9, undefined, undefined])
    })

    test('B6 (guard) rows absent and a preset already holding a slot: nothing is reassigned', () => {
        const presets = slotted(5, { 4: 2 })
        const data = { botPresets: presets, botPresetsId: 0, hotkeys: [] } as unknown as Database
        setDatabase(data)
        expect(slotOf(data)).toEqual([undefined, undefined, undefined, undefined, 2])
        expect(slotRows(data)).toHaveLength(9)
    })

    test('B15 rows present and no slot anywhere: the migration does not run, so a slot cleared on purpose is never refilled', () => {
        const db = { botPresets: slotted(4), hotkeys: [{ key: '1', ctrl: true, action: 'presetSlot1' }] }
        expect(migratePresetSlots(db)).toBe(false)
        expect(slotOf(db)).toEqual([undefined, undefined, undefined, undefined])
    })

    test('b3 slots present and rows absent: no migration, and the merge re-appends the default rows', () => {
        const presets = slotted(3, { 0: 1, 2: 3 })
        const data = { botPresets: presets, botPresetsId: 0, hotkeys: structuredClone(UPSTREAM_DEFAULT_HOTKEYS) } as unknown as Database
        setDatabase(data)
        expect(slotOf(data)).toEqual([1, undefined, 3])
        expect(slotRows(data)).toHaveLength(9)
    })

    test('a list of no presets assigns nothing, and the first nine take 1..9', () => {
        expect(migratePresetSlots({ botPresets: [] })).toBe(false)
        const db = { botPresets: slotted(12) }
        expect(migratePresetSlots(db)).toBe(true)
        expect(slotOf(db)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, undefined, undefined, undefined])
    })
})

describe('planSlotAssign and applySlotPlan', () => {
    test('B16 every other holder of a slot loses it: the first gets the mover\'s old slot, the rest none, and the mover resolves', () => {
        const presets = slotted(6, { 1: 2, 4: 2, 5: 6 })
        const plan = planSlotAssign(presets, 2, 5)
        expect(applySlotPlan(presets, plan)).toBe(true)
        expect(presetIndexForSlot(presets, 2)).toBe(5)
        expect(presets[1].slot).toBe(6)
        expect(presets[4].slot).toBeUndefined()
        expect(presets.filter((p) => p.slot === 2)).toHaveLength(1)
    })

    test('a swap hands the displaced preset the mover\'s old slot; a free slot just moves; None clears every holder', () => {
        const swap = slotted(3, { 0: 1, 1: 2 })
        applySlotPlan(swap, planSlotAssign(swap, 2, 0))
        expect(slotOf({ botPresets: swap })).toEqual([2, 1, undefined])

        const moved = slotted(3, { 0: 1 })
        applySlotPlan(moved, planSlotAssign(moved, 5, 0))
        expect(slotOf({ botPresets: moved })).toEqual([5, undefined, undefined])

        const cleared = slotted(3, { 0: 4, 2: 4 })
        applySlotPlan(cleared, planSlotAssign(cleared, 4, null))
        expect(slotOf({ botPresets: cleared })).toEqual([undefined, undefined, undefined])
    })

    test('assigning a slot to its only holder plans nothing, and a plan whose preset is gone writes nothing', () => {
        const presets = slotted(3, { 0: 1, 1: 2 })
        expect(planSlotAssign(presets, 1, 0)).toEqual([])
        const plan = planSlotAssign(presets, 2, 0)
        const trimmed = presets.filter((p) => p.id !== 'id-1')
        expect(applySlotPlan(trimmed, plan)).toBe(false)
        expect(slotOf({ botPresets: trimmed })).toEqual([1, undefined])
    })
})

describe('upstream steps leave the carry visible to the id pass', () => {
    test('a switch away from an entry loses its meta upstream, and the id pass then mints it a fresh one', () => {
        const db = forkDb()
        upstreamChangeToPreset(db, 1)
        const left = db.botPresets[3]
        expect(left.id).toBeUndefined()
        assignPresetIds(db)
        expect(typeof left.id).toBe('string')
    })
})
