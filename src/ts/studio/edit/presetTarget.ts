// The `preset` session owner: the toggle text of one bot preset, addressed by its stable id. The text lives in
// one of two copies: the active preset's is the working setting `db.customPromptTemplateToggle` (saveCurrentPreset
// rebuilds the slot from it and setPreset overwrites it), every other preset's is its own slot. Which copy is
// live is decided on every read and every write, never cached, so a reorder, a switch or a delete between two
// calls cannot send a value to the wrong copy.
// The history of this owner is memory-only, so nothing here marks a save beyond what the database write hook
// already reports for the two assignments below.

import { DBState } from '../../stores.svelte'
import type { botPreset } from '../../storage/database.svelte'
import type { FieldValue, LiveReader, WriteOp } from '../history/historyModel'
import { sessionOwnerKey } from '../history/ownerPhase'
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

// The toggle text as the live copy holds it. A missing key, a non-string value or a gone preset reads as an empty
// string that is present: the working setting defaults to '' and saveCurrentPreset writes `?? ''`, so the owner is
// never "absent" and a replayed edit never deletes the slot's key.
function readToggleText(id: string): string {
    const resolved = resolvePreset(id)
    if (resolved.ok === false) {
        return ''
    }
    const value = resolved.active ? DBState.db.customPromptTemplateToggle : resolved.slot.customPromptTemplateToggle
    return typeof value === 'string' ? value : ''
}

function presetReader(id: string): LiveReader {
    return {
        field: (path): FieldValue => (path === 'customModuleToggle' ? { had: true, value: readToggleText(id) } : { had: false }),
        greetings: () => null,
        fmIndex: () => null,
    }
}

// One assignment to the live copy; false when the preset is gone and nothing was written.
function writeLivePreset(id: string, value: string): boolean {
    const resolved = resolvePreset(id)
    if (resolved.ok === false) {
        return false
    }
    if (resolved.active) {
        DBState.db.customPromptTemplateToggle = value
    } else {
        resolved.slot.customPromptTemplateToggle = value
    }
    return true
}

function isStringToggleSet(write: WriteOp): write is { op: 'set'; path: 'customModuleToggle'; value: { had: true; value: string } } {
    return write.op === 'set' && write.path === 'customModuleToggle' && write.value.had && typeof write.value.value === 'string'
}

export const presetAdapter: SessionOwnerAdapter = {
    resolve(id) {
        const resolved = resolvePreset(id)
        if (resolved.ok === false) {
            return { ok: false, reason: resolved.reason }
        }
        return { ok: true, target: { session: 'preset', id, reader: presetReader(id) } }
    },
    // Only a string `set` of the toggle text is accepted, and the whole batch is checked before the first write.
    write(id, writes) {
        if (!writes.every(isStringToggleSet)) {
            return false
        }
        for (const write of writes) {
            if (isStringToggleSet(write) && !writeLivePreset(id, write.value.value)) {
                return false
            }
        }
        return true
    },
}
