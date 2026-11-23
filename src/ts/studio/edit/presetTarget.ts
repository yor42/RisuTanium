// The `preset` session owner: the toggle text and the advanced-form fields of one bot preset, addressed by its stable
// id. Each value lives in one of two copies: the active preset's is the working setting `db.<property>` (saveCurrentPreset
// rebuilds the slot from it and setPreset overwrites it), every other preset's is its own slot; the name is the one
// value that is always the slot's. Which copy is live is decided on every read and every write, never cached, so a
// reorder, a switch or a delete between two calls cannot send a value to the wrong copy. The table that names the
// properties and the absent rules is presetFields.ts.
// The history of this owner is memory-only, so nothing here marks a save beyond what the database write hook
// already reports for the assignments below.

import { DBState } from '../../stores.svelte'
import type { botPreset } from '../../storage/database.svelte'
import type { FieldValue, LiveReader, WriteOp } from '../history/historyModel'
import { sessionOwnerKey } from '../history/ownerPhase'
import { cloneValue, valueMatchesKind, valuesEqual } from '../history/fieldAccess'
import { freshPresetContainerSeed, isPresetContainerName, isPresetPath, PRESET_FIELDS, type PresetFieldSpec, type PresetPath } from './presetFields'
import type { SessionOwnerAdapter } from './sessionAdapters'

export function presetOwnerKey(id: string) {
    return sessionOwnerKey('preset', id)
}

// The name a list or a result line shows for the preset: its own name, or the id when it has none or is gone.
export function presetNameOf(id: string): string {
    const found = DBState.db.botPresets?.find((preset) => preset?.id === id)
    return typeof found?.name === 'string' && found.name !== '' ? found.name : id
}

type PresetResolution = { ok: true; slot: botPreset; active: boolean } | { ok: false; reason: 'gone' }

// Exactly one preset must hold the id: none is gone, and two holders leave no way to tell which one is meant.
function resolvePreset(id: string): PresetResolution {
    const presets = DBState.db.botPresets
    if (!Array.isArray(presets) || id === '') {
        return { ok: false, reason: 'gone' }
    }
    let found = -1
    for (let index = 0; index < presets.length; index++) {
        if (presets[index]?.id === id) {
            if (found !== -1) {
                return { ok: false, reason: 'gone' }
            }
            found = index
        }
    }
    if (found === -1) {
        return { ok: false, reason: 'gone' }
    }
    const activeId = DBState.db.botPresetsId
    return { ok: true, slot: presets[found], active: Number.isInteger(activeId) && found === activeId }
}

// A record whose properties are read and assigned by name: the table's property names are checked against `botPreset`
// and `Database` where the table is written, so the dynamic access below sits at one boundary.
type PropertyBag = Record<string, unknown>

function bagOf(holder: object): PropertyBag {
    return holder as PropertyBag
}

function isPlainObject(value: unknown): value is PropertyBag {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The object and the property that hold a field's value now: the working settings for the active preset (unless the
// field is slot only), the slot otherwise.
function homeOf(resolved: { slot: botPreset; active: boolean }, spec: PresetFieldSpec): { holder: PropertyBag; property: string } {
    if (resolved.active && spec.db !== 'slotOnly') {
        return { holder: bagOf(DBState.db), property: spec.db }
    }
    return { holder: bagOf(resolved.slot), property: spec.slot }
}

function readPath(resolved: { slot: botPreset; active: boolean }, path: PresetPath): FieldValue {
    const spec = PRESET_FIELDS[path]
    const { holder, property } = homeOf(resolved, spec)
    let raw: unknown = holder[property]
    if (spec.key !== undefined && raw !== undefined && raw !== null) {
        // A container that is not a plain object (an array, a string) holds none of its keys.
        if (!isPlainObject(raw)) {
            return { had: false }
        }
        raw = raw[spec.key]
    }
    // A list is read as a fresh plain copy: no history op ever holds the live array or a reactive proxy.
    if (valueMatchesKind(path, raw)) {
        return { had: true, value: cloneValue(raw) }
    }
    if (typeof spec.absent !== 'object') {
        return { had: false }
    }
    const fallback = spec.absent.default
    return { had: true, value: typeof fallback === 'object' ? [...fallback] : fallback }
}

// The value of a path as the live copy holds it, read now; a gone preset reads as absent, except the toggle text,
// which reads as an empty text that is present: the working setting defaults to '' and saveCurrentPreset writes
// `?? ''`, so that owner is never "absent" and a replayed edit never deletes the slot's key.
export function readPresetField(id: string, path: PresetPath): FieldValue {
    const resolved = resolvePreset(id)
    if (resolved.ok === false) {
        return path === 'customModuleToggle' ? { had: true, value: '' } : { had: false }
    }
    return readPath(resolved, path)
}

// The value a path holds in the live copy exactly as stored (not validated, not copied); undefined when the preset is
// gone or holds none. Only for showing a value the strict reader refuses; it is never written back.
export function presetStoredValue(id: string, path: PresetPath): unknown {
    const resolved = resolvePreset(id)
    if (resolved.ok === false) {
        return undefined
    }
    const spec = PRESET_FIELDS[path]
    const { holder, property } = homeOf(resolved, spec)
    const raw: unknown = holder[property]
    return spec.key !== undefined && isPlainObject(raw) ? raw[spec.key] : spec.key !== undefined ? undefined : raw
}

// The toggle text the builder shows: the live copy's, read on every call.
export function presetToggleText(id: string): string {
    const read = readPresetField(id, 'customModuleToggle')
    return read.had && typeof read.value === 'string' ? read.value : ''
}

// Whether exactly one preset holds the id, and whether that preset is the active one now; null when it is gone.
export function presetStateOf(id: string): { active: boolean } | null {
    const resolved = resolvePreset(id)
    return resolved.ok ? { active: resolved.active } : null
}

// The model the preset's own settings name: the working model for the active preset, else the slot's, else the
// working one (a switch keeps it when the slot has none). Null when the preset is gone.
export function presetEffectiveModel(id: string): string | null {
    const resolved = resolvePreset(id)
    if (resolved.ok === false) {
        return null
    }
    const own = resolved.active ? DBState.db.aiModel : resolved.slot.aiModel
    const model = typeof own === 'string' ? own : DBState.db.aiModel
    return typeof model === 'string' ? model : ''
}

// Whether the preset's prompt template is a list (the form shows the template note instead of the plain prompts).
export function presetHasTemplate(id: string): boolean {
    const resolved = resolvePreset(id)
    if (resolved.ok === false) {
        return false
    }
    return Array.isArray(resolved.active ? DBState.db.promptTemplate : resolved.slot.promptTemplate)
}

function presetReader(id: string): LiveReader {
    return {
        field: (path): FieldValue => (isPresetPath(path) ? readPresetField(id, path) : { had: false }),
        greetings: () => null,
        fmIndex: () => null,
    }
}

type PresetSet = { op: 'set'; path: PresetPath; value: FieldValue }

function asPresetSet(write: WriteOp): PresetSet | null {
    return write.op === 'set' && isPresetPath(write.path) ? { op: 'set', path: write.path, value: write.value } : null
}

// A container the key sits in, when it cannot be written into without loss: not absent and not a plain object.
function containerBlocked(resolved: { slot: botPreset; active: boolean }, spec: PresetFieldSpec): boolean {
    if (spec.key === undefined) {
        return false
    }
    const { holder, property } = homeOf(resolved, spec)
    const box = holder[property]
    return box !== undefined && box !== null && !isPlainObject(box)
}

// Whether one op may be assigned: a value of the path's kind, or the removal of a key whose absence is a state of its own.
function opAssignable(op: PresetSet, resolved: { slot: botPreset; active: boolean }): boolean {
    const spec = PRESET_FIELDS[op.path]
    if (containerBlocked(resolved, spec)) {
        return false
    }
    if (op.value.had) {
        return valueMatchesKind(op.path, op.value.value)
    }
    return typeof spec.absent !== 'object'
}

function assignOp(op: PresetSet, resolved: { slot: botPreset; active: boolean }): void {
    const spec = PRESET_FIELDS[op.path]
    const { holder, property } = homeOf(resolved, spec)
    if (spec.key === undefined) {
        if (op.value.had === true) {
            holder[property] = cloneValue(op.value.value)
        } else if (spec.unset === 'null') {
            holder[property] = null
        } else {
            delete holder[property]
        }
        return
    }
    const box = holder[property]
    if (op.value.had === true) {
        const wanted = op.value.value
        const live = readPath(resolved, op.path)
        // A container is never created for a value the live reading already holds.
        if (live.had && valuesEqual(live.value, wanted)) {
            return
        }
        if (isPlainObject(box)) {
            box[spec.key] = cloneValue(wanted)
        } else if (isPresetContainerName(property)) {
            const seed = freshPresetContainerSeed(property)
            seed[spec.key] = cloneValue(wanted)
            holder[property] = seed
        }
    } else if (isPlainObject(box)) {
        delete box[spec.key]
    }
}

export const presetAdapter: SessionOwnerAdapter = {
    resolve(id) {
        const resolved = resolvePreset(id)
        if (resolved.ok === false) {
            return { ok: false, reason: resolved.reason }
        }
        return { ok: true, target: { session: 'preset', id, reader: presetReader(id) } }
    },
    // A write the copy that is live now cannot take as a whole: the working copy never loses a required setting (a
    // `{ had: false }` write of a field whose slot absence means "keep the working value"), and a container that is
    // not a plain object is never written into.
    check(id, writes) {
        const resolved = resolvePreset(id)
        if (resolved.ok === false) {
            return 'ok'
        }
        for (const write of writes) {
            const op = asPresetSet(write)
            if (!op) {
                continue
            }
            const spec = PRESET_FIELDS[op.path]
            if (containerBlocked(resolved, spec) || (resolved.active && !op.value.had && spec.absent === 'keeps')) {
                return 'precondition'
            }
        }
        return 'ok'
    },
    // Only `set` ops of the table's paths are accepted, and the whole batch is checked before the first assignment.
    write(id, writes) {
        const resolved = resolvePreset(id)
        if (resolved.ok === false) {
            return false
        }
        const ops: PresetSet[] = []
        for (const write of writes) {
            const op = asPresetSet(write)
            if (!op || !opAssignable(op, resolved)) {
                return false
            }
            ops.push(op)
        }
        for (const op of ops) {
            assignOp(op, resolved)
        }
        return true
    },
}
