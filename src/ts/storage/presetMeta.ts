import { v4 as uuidv4 } from 'uuid'
import type { botPreset, Database, PresetFolder } from './database.svelte'

/**
 * Fork-only metadata a preset carries beside its settings: a stable id, the folder it sits in and its hotkey slot.
 * Every key rides the `.bin` untranslated; upstream reads none of them. Nothing here imports a value from
 * `database.svelte`, so it loads unchanged in every harness that replaces that module.
 */
export const PRESET_META_KEYS = ['id', 'folderId', 'slot'] as const

export type PresetMetaOwner = Pick<botPreset, 'id' | 'folderId' | 'slot'>

let presetIdsMinted = false

/**
 * Whether `assignPresetIds` changed anything since the last take, then clears the flag. The boot marks its write
 * on a true answer, so ids minted in memory are saved by the boot's normal save and stay the same on the next load.
 */
export function takePresetIdsMinted(): boolean {
    const minted = presetIdsMinted
    presetIdsMinted = false
    return minted
}

/** A uuid v4 from `uuid`, because `crypto.randomUUID` is absent on an insecure LAN http origin. */
export function newPresetId(): string {
    return uuidv4()
}

function isUsableId(id: unknown): id is string {
    return typeof id === 'string' && id !== ''
}

/**
 * Gives `p` a new id, drops its slot and keeps or drops its folder. Mutates and returns `p`: a creation site that
 * starts from a shared template or a foreign file must overwrite whatever meta that source carried.
 */
export function freshPresetMeta<T extends object>(p: T, options: { keepFolder: boolean }): T {
    Object.assign(p, { id: newPresetId() })
    Reflect.deleteProperty(p, 'slot')
    if (!options.keepFolder) {
        Reflect.deleteProperty(p, 'folderId')
    }
    return p
}

/**
 * After load the ids in `botPresets` are pairwise distinct strings. A missing or unusable id is minted. Entries that
 * share an id are all re-minted with their slot cleared (folder kept), because any keep-one rule could hand the
 * original's star, slot or loadout link to a copy that shares its id. The entry that is the sole holder of an id keeps
 * it. Returns whether anything changed and records that for `takePresetIdsMinted`.
 */
export function assignPresetIds(db: Pick<Database, 'botPresets'>): boolean {
    const presets = db.botPresets
    if (!Array.isArray(presets)) {
        return false
    }
    const holders = new Map<string, number>()
    for (const p of presets) {
        if (p && typeof p === 'object' && isUsableId(p.id)) {
            holders.set(p.id, (holders.get(p.id) ?? 0) + 1)
        }
    }
    let changed = false
    for (const p of presets) {
        if (!p || typeof p !== 'object') {
            continue
        }
        if (!isUsableId(p.id)) {
            p.id = newPresetId()
            changed = true
        }
        else if ((holders.get(p.id) ?? 0) > 1) {
            freshPresetMeta(p, { keepFolder: true })
            changed = true
        }
    }
    if (changed) {
        presetIdsMinted = true
    }
    return changed
}

/** `saved` with the meta `prev` held: a rebuild from the working settings never loses id, folder or slot. */
export function carryPresetMeta<T extends PresetMetaOwner>(saved: T, prev: PresetMetaOwner | undefined): T {
    if (!prev) {
        return saved
    }
    for (const key of PRESET_META_KEYS) {
        const value = prev[key]
        if (value !== undefined) {
            Object.assign(saved, { [key]: value })
        }
    }
    return saved
}

/** A copy of `p` without id, folder and slot: what a single-preset export carries. */
export function withoutPresetMeta<T extends object>(p: T): T {
    const copy = { ...p }
    for (const key of PRESET_META_KEYS) {
        Reflect.deleteProperty(copy, key)
    }
    return copy
}

/** The folder `p` sits in. A folder id that names no folder, or none at all, reads as no folder. */
export function presetFolderOf(db: Pick<Database, 'presetFolders'>, p: PresetMetaOwner): PresetFolder | null {
    if (!isUsableId(p.folderId)) {
        return null
    }
    return (db.presetFolders ?? []).find((folder) => folder.id === p.folderId) ?? null
}

/** Adds a folder (one level, no nesting) at the end of the folder list and returns its id. */
export function createPresetFolder(db: Pick<Database, 'presetFolders'>, name: string): string {
    const id = newPresetId()
    db.presetFolders ??= []
    db.presetFolders.push({ id, name })
    return id
}

export function renamePresetFolder(db: Pick<Database, 'presetFolders'>, id: string, name: string): boolean {
    const folder = (db.presetFolders ?? []).find((candidate) => candidate.id === id)
    if (!folder) {
        return false
    }
    folder.name = name
    return true
}

/** Removes the folder; every preset in it becomes folderless. */
export function deletePresetFolder(db: Pick<Database, 'presetFolders' | 'botPresets'>, id: string): boolean {
    const folders = db.presetFolders ?? []
    const at = folders.findIndex((candidate) => candidate.id === id)
    if (at === -1) {
        return false
    }
    folders.splice(at, 1)
    for (const p of db.botPresets) {
        if (p.folderId === id) {
            delete p.folderId
        }
    }
    return true
}

/** Puts the preset at `index` in the folder `folderId`, or in no folder when it is undefined or names no folder. */
export function movePresetToFolder(db: Pick<Database, 'presetFolders' | 'botPresets'>, index: number, folderId: string | undefined): boolean {
    const p = db.botPresets[index]
    if (!p) {
        return false
    }
    if (folderId !== undefined && !(db.presetFolders ?? []).some((folder) => folder.id === folderId)) {
        return false
    }
    if (folderId === undefined) {
        delete p.folderId
    }
    else {
        p.folderId = folderId
    }
    return true
}

export const PRESET_SLOT_COUNT = 9

const PRESET_SLOT_ACTION = /^presetSlot([1-9])$/

/** The hotkey action of slot `n` (1 to 9). */
export function presetSlotAction(n: number): string {
    return `presetSlot${n}`
}

/** The slot a hotkey action names (`presetSlot3` is 3), or null for any other action. */
export function presetSlotOf(action: string): number | null {
    const match = PRESET_SLOT_ACTION.exec(action)
    return match ? Number(match[1]) : null
}

function isValidSlot(slot: unknown): slot is number {
    return typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= PRESET_SLOT_COUNT
}

/**
 * The index of the first preset holding slot `n`, or -1. A slot value that is not an integer from 1 to 9 is ignored
 * on read and never rewritten, so Ctrl+n and the list badge always agree on one preset.
 */
export function presetIndexForSlot(presets: readonly PresetMetaOwner[], n: number): number {
    return presets.findIndex((p) => p && isValidSlot(p.slot) && p.slot === n)
}

/** The slot number the legacy list shows for entry `i`: n only when the Ctrl+n resolver lands on this entry. */
export function slotBadgeFor(presets: readonly PresetMetaOwner[], i: number): number | undefined {
    const slot = presets[i]?.slot
    if (!isValidSlot(slot)) {
        return undefined
    }
    return presetIndexForSlot(presets, slot) === i ? slot : undefined
}

/**
 * The one-time migration from the old position rule: presets 0..8 take slots 1..9. It runs only when no
 * `presetSlot*` row exists and no preset holds a valid slot, so a slot cleared on purpose is never refilled and
 * slots a person set are never overwritten. Returns whether it assigned anything.
 */
export function migratePresetSlots(db: { botPresets: PresetMetaOwner[], hotkeys?: readonly { action: string }[] }): boolean {
    if ((db.hotkeys ?? []).some((row) => presetSlotOf(row.action) !== null)) {
        return false
    }
    if (db.botPresets.some((p) => p && isValidSlot(p.slot))) {
        return false
    }
    const count = Math.min(db.botPresets.length, PRESET_SLOT_COUNT)
    for (let i = 0; i < count; i++) {
        db.botPresets[i].slot = i + 1
    }
    return count > 0
}

/** One preset's slot before and after an assignment. Steps name presets by id so an undo survives a reorder. */
export interface SlotStep {
    id: string
    before: number | undefined
    after: number | undefined
}

/**
 * Assigns slot `n` to the preset at `target`, or clears it for everyone when `target` is null. The first other
 * holder of `n` gets the target's old slot (the swap) or none, and every further holder gets none, so the target is
 * the only holder afterwards. Presets without an id are left alone.
 */
export function planSlotAssign(presets: readonly PresetMetaOwner[], n: number, target: number | null): SlotStep[] {
    const steps: SlotStep[] = []
    const add = (p: PresetMetaOwner, after: number | undefined) => {
        const before = isValidSlot(p.slot) ? p.slot : undefined
        if (isUsableId(p.id) && before !== after) {
            steps.push({ id: p.id, before, after })
        }
    }
    const holders: number[] = []
    presets.forEach((p, i) => {
        if (p && isValidSlot(p.slot) && p.slot === n) {
            holders.push(i)
        }
    })
    if (target === null) {
        holders.forEach((i) => add(presets[i], undefined))
        return steps
    }
    const mover = presets[target]
    if (!mover || !isUsableId(mover.id)) {
        return steps
    }
    const oldSlot = isValidSlot(mover.slot) ? mover.slot : undefined
    add(mover, n)
    let handedOver = false
    for (const i of holders) {
        if (i === target) {
            continue
        }
        add(presets[i], handedOver || oldSlot === n ? undefined : oldSlot)
        handedOver = true
    }
    return steps
}

/** Writes the `after` side of every step. Returns false, writing nothing, when a preset is gone. */
export function applySlotPlan(presets: readonly PresetMetaOwner[], plan: readonly SlotStep[]): boolean {
    const targets = plan.map((step) => presets.find((p) => p && p.id === step.id))
    if (targets.some((p) => !p)) {
        return false
    }
    plan.forEach((step, at) => writeSlot(targets[at]!, step.after))
    return true
}

export function writeSlot(p: PresetMetaOwner, slot: number | undefined): void {
    if (slot === undefined) {
        delete p.slot
    }
    else {
        p.slot = slot
    }
}

/** Moves a folder to position `toIndex` in the folder list (clamped). */
export function movePresetFolder(db: Pick<Database, 'presetFolders'>, id: string, toIndex: number): boolean {
    const folders = db.presetFolders ?? []
    const at = folders.findIndex((candidate) => candidate.id === id)
    if (at === -1) {
        return false
    }
    const [folder] = folders.splice(at, 1)
    folders.splice(Math.max(0, Math.min(toIndex, folders.length)), 0, folder)
    return true
}
