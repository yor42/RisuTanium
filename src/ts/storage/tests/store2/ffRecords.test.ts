// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { JsonObject, JsonValue } from '../../blockFrame'

// The real `setPreset` and `presetFromWorkingSettings` run; only the modules their import graph would start effects in are replaced.
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

import { presetFromWorkingSettings, setPreset, type botPreset, type Database } from '../../database.svelte'
import { toPlainJson } from '../../store2/codec'
import { PERSONA_OPS, PRESET_RECORD_FIELDS, cleanSwitch, decideSwitch, type SwitchOps, type SwitchSide } from '../../store2/fastForward/records'

/** The plain working settings are the fields of a database; the two functions under pin take a `Database`. */
function asDb(value: JsonObject | Record<string, unknown>): Database {
    return value as unknown as Database
}

function plain(value: unknown): JsonObject {
    const out = toPlainJson(value)
    if (typeof out !== 'object' || out === null || Array.isArray(out)) {
        throw new Error('not an object')
    }
    return out
}

function pickRecordFields(working: JsonObject): JsonObject {
    const out: JsonObject = {}
    for (const name of PRESET_RECORD_FIELDS) {
        if (Object.hasOwn(working, name)) {
            out[name] = working[name]
        }
    }
    return out
}

describe('guard (S0-4): PRESET_RECORD_FIELDS is the set of database fields setPreset writes', () => {
    function recordedWrites(flags: Record<string, boolean>): string[] {
        const written = new Set<string>()
        const db = new Proxy({ NAIsettings: {}, ...flags } as Record<string, unknown>, {
            set(target, name, value) {
                written.add(String(name))
                target[String(name)] = value
                return true
            },
        })
        setPreset(asDb(db), { name: 'p' } as botPreset)
        return [...written].sort()
    }

    test('with every conditional branch open, the writes are exactly the constant', () => {
        expect(recordedWrites({})).toEqual([...PRESET_RECORD_FIELDS].sort())
    })

    test('with the conditional branches closed, the writes are a subset of the constant', () => {
        const closed = recordedWrites({ doNotChangeSeperateModels: true, doNotChangeFallbackModels: true, disableSeperateParameterChangeOnPresetChange: true })
        expect(closed.length).toBeLessThan(PRESET_RECORD_FIELDS.length)
        expect(closed.every(name => (PRESET_RECORD_FIELDS as readonly string[]).includes(name) || name.startsWith('doNot') || name.startsWith('disable'))).toBe(true)
    })

    test('the constant has no repeated field', () => {
        expect(new Set(PRESET_RECORD_FIELDS).size).toBe(PRESET_RECORD_FIELDS.length)
    })
})

const PRESET_OPS: SwitchOps = {
    saveInto: (working, slot) => plain(presetFromWorkingSettings(asDb(structuredClone(working)), String(slot.name), typeof slot.image === 'string' ? slot.image : '')),
    apply: (working, slot) => {
        const copy = structuredClone(working) as Record<string, unknown>
        setPreset(asDb(copy), structuredClone(slot) as unknown as botPreset)
        return pickRecordFields(plain(copy))
    },
}

/** A starting working copy, and three presets that differ in the fields that matter to the rule. */
function fixture(ops: SwitchOps) {
    const seed: JsonObject = { NAIsettings: {}, temperature: 1, mainPrompt: 'seed' }
    const slots: JsonObject[] = [0, 1, 2].map(index => plain({ ...presetFromWorkingSettings(asDb({ ...structuredClone(seed), temperature: index + 1, mainPrompt: `prompt ${index}` }), `Preset ${index}`, ''), NAISettings: {} }))
    const working0 = ops.apply(seed, slots[0])
    const base: SwitchSide = { list: slots, id: 0, working: working0 }
    return { slots, base, ops }
}

/** One selection change from `from`: the slot left holds the working fields when `save`, then the working fields come from the new slot. */
function switched(from: SwitchSide, to: number, save: boolean, ops: SwitchOps): SwitchSide {
    const list = [...from.list]
    if (save) {
        list[from.id as number] = ops.saveInto(from.working, list[from.id as number] as JsonObject)
    }
    return { list, id: to, working: ops.apply(from.working, list[to] as JsonObject) }
}

function edited(side: SwitchSide, field: string, value: JsonValue): SwitchSide {
    return { ...side, working: { ...side.working, [field]: value } }
}

describe('guard (S0-1): the preset record', () => {
    const { base, ops } = fixture(PRESET_OPS)
    const savedEqualsOld = JSON.stringify(ops.saveInto(base.working, base.list[0] as JsonObject)) === JSON.stringify(base.list[0])

    test('neither side changed, or only this page did, keeps', () => {
        expect(decideSwitch(base, base, base, ops)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, switched(base, 1, true, ops), base, ops)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, edited(base, 'temperature', 9), base, ops)).toEqual({ kind: 'keep' })
    })

    test('only the peer changed: take it whole, as view state', () => {
        for (const theirs of [switched(base, 1, true, ops), switched(base, 2, false, ops), edited(base, 'temperature', 9)]) {
            expect(decideSwitch(base, base, theirs, ops)).toEqual({ kind: 'take', value: theirs, defer: true })
        }
    })

    test('both switched to different presets, each saving the base working copy: the last saved switch wins (keep)', () => {
        expect(decideSwitch(base, switched(base, 1, true, ops), switched(base, 2, true, ops), ops)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, switched(base, 2, true, ops), switched(base, 1, true, ops), ops)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, switched(base, 1, false, ops), switched(base, 2, false, ops), ops)).toEqual({ kind: 'keep' })
    })

    test('both switched, one saving and one not: keep only when the saved slot equals the old one', () => {
        const decided = decideSwitch(base, switched(base, 1, true, ops), switched(base, 2, false, ops), ops)
        expect(decided.kind).toBe(savedEqualsOld ? 'keep' : 'park')
    })

    test('a hand edit on either side parks, including one folded into the old slot by a switch', () => {
        const handEdited = edited(base, 'temperature', 9)
        expect(decideSwitch(base, handEdited, switched(base, 1, true, ops), ops).kind).toBe('park')
        expect(decideSwitch(base, switched(base, 1, true, ops), handEdited, ops).kind).toBe('park')
        expect(decideSwitch(base, handEdited, handEdited, ops).kind).toBe('park')
        const mineSwitchedAfterEdit = switched(handEdited, 1, true, ops)
        expect(decideSwitch(base, mineSwitchedAfterEdit, switched(base, 1, true, ops), ops).kind).toBe('park')
        expect(decideSwitch(base, switched(handEdited, 2, true, ops), switched(base, 2, true, ops), ops).kind).toBe('park')
    })

    test('a list change on either side parks', () => {
        const added: SwitchSide = { ...base, list: [...base.list, { name: 'new' }] }
        expect(decideSwitch(base, added, switched(base, 1, true, ops), ops).kind).toBe('park')
        expect(decideSwitch(base, switched(base, 1, true, ops), added, ops).kind).toBe('park')
        const renamed: SwitchSide = { ...base, list: base.list.map((slot, index) => (index === 2 ? { ...(slot as JsonObject), name: 'renamed' } : slot)) }
        expect(decideSwitch(base, renamed, switched(base, 1, true, ops), ops).kind).toBe('park')
    })

    test('cleanSwitch needs another slot, the list equal elsewhere and the working fields of the new slot', () => {
        expect(cleanSwitch(switched(base, 1, true, ops), base, ops)).toBe(true)
        expect(cleanSwitch(switched(base, 1, false, ops), base, ops)).toBe(true)
        expect(cleanSwitch(base, base, ops)).toBe(false)
        expect(cleanSwitch({ ...switched(base, 1, true, ops), id: 7 }, base, ops)).toBe(false)
        expect(cleanSwitch(edited(switched(base, 1, true, ops), 'temperature', 9), base, ops)).toBe(false)
        const otherSlotEdited = switched(base, 1, true, ops)
        otherSlotEdited.list = otherSlotEdited.list.map((slot, index) => (index === 2 ? { ...(slot as JsonObject), name: 'x' } : slot))
        expect(cleanSwitch(otherSlotEdited, base, ops)).toBe(false)
        const leftSlotEdited = switched(base, 1, true, ops)
        leftSlotEdited.list = leftSlotEdited.list.map((slot, index) => (index === 0 ? { ...(slot as JsonObject), name: 'hand edit' } : slot))
        expect(cleanSwitch(leftSlotEdited, base, ops)).toBe(false)
        expect(cleanSwitch(switched(base, 1, true, ops), { ...base, id: -1 }, ops)).toBe(false)
    })
})

describe('guard (S0-1): the persona record', () => {
    const slots: JsonObject[] = [0, 1, 2].map(index => ({ id: `p${index}`, name: `Persona ${index}`, icon: `icon-${index}`, personaPrompt: `prompt ${index}`, note: `note ${index}` }))
    const working = (slot: JsonObject): JsonObject => ({ username: slot.name, userIcon: slot.icon, personaPrompt: slot.personaPrompt, userNote: slot.note })
    const base: SwitchSide = { list: slots, id: 0, working: working(slots[0]) }
    const ops = PERSONA_OPS

    test('saving the working fields into the old slot touches only its four fields, and a switch copies the new slot\'s four', () => {
        const saved = ops.saveInto({ username: 'N', userIcon: 'I', personaPrompt: 'P', userNote: 'U' }, { ...slots[0], largePortrait: true })
        expect(saved).toEqual({ id: 'p0', name: 'N', icon: 'I', personaPrompt: 'P', note: 'U', largePortrait: true })
        expect(ops.apply({ username: 'N', userIcon: 'I', personaPrompt: 'P', userNote: 'U', other: 1 }, slots[1]))
            .toEqual({ username: 'Persona 1', userIcon: 'icon-1', personaPrompt: 'prompt 1', userNote: 'note 1', other: 1 })
        expect(ops.apply({ username: 'N' }, { id: 'x', name: 'Only name' })).toEqual({ username: 'Only name' })
    })

    function switchedPersona(from: SwitchSide, to: number, save: boolean): SwitchSide {
        return switched(from, to, save, ops)
    }

    test('the same decisions as the preset record', () => {
        expect(decideSwitch(base, base, base, ops)).toEqual({ kind: 'keep' })
        const theirs = switchedPersona(base, 1, true)
        expect(decideSwitch(base, base, theirs, ops)).toEqual({ kind: 'take', value: theirs, defer: true })
        expect(decideSwitch(base, switchedPersona(base, 2, true), theirs, ops)).toEqual({ kind: 'keep' })
        expect(decideSwitch(base, switchedPersona(base, 2, false), switchedPersona(base, 1, true), ops)).toEqual({ kind: 'keep' })
    })

    test('a renamed persona either side asks', () => {
        const renamed = edited(base, 'username', 'Hand edit')
        expect(decideSwitch(base, renamed, switchedPersona(base, 1, true), ops).kind).toBe('park')
        expect(decideSwitch(base, switchedPersona(renamed, 2, true), switchedPersona(base, 2, true), ops).kind).toBe('park')
        expect(decideSwitch(base, switchedPersona(base, 1, true), renamed, ops).kind).toBe('park')
    })
})
