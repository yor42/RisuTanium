// @vitest-environment happy-dom

/**
 * #929 S1b compatibility guards (all pass before and after the S1b change; none reproduces a defect). They pin the stored
 * shape the per-task modes key lives in:
 * - T-C6: a settings `.rtb` replaces the container whole, so a file container without the key over a device mix carries no
 *   key, and a file container dropped by the reference rule leaves the device container, key included, untouched;
 * - T-C7: a preset switch moves the container and the flag from the slot whole (unlocked) or keeps the device pair (locked),
 *   and the read rule settles a slot whose key disagrees with its flag.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

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

import { setPreset, type botPreset, type Database } from 'src/ts/storage/database.svelte'
import { effectiveTaskModes, TASK_MODES_KEY } from 'src/ts/storage/taskParameterModes'
import { planSettingsMerge, readSettingsPayload, type DeviceLists, type SettingsRead } from 'src/ts/drive/rtb/settingsPayload'
import { inputOf } from 'src/ts/drive/tests/rtb/settingsTestKit'

type Loose = Record<string, unknown>

const MIX = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }

function container(extra: Loose = {}): Loose {
    return { memory: { temperature: 11 }, emotion: {}, translate: {}, otherAx: {}, overrides: {}, ...extra }
}

function readOf(records: Loose): SettingsRead {
    const read = readSettingsPayload(inputOf(Object.entries(records).map(([key, value]) => ({ key, value }))))
    if ('refused' in read) {
        throw new Error(`refused: ${read.refused}`)
    }
    return read
}

function deviceOf(over: Partial<DeviceLists> = {}): DeviceLists {
    return { botPresets: [], botPresetsId: 0, presetFolders: [], hypaV3Presets: [], hypaV3PresetId: 0, translatorPresets: [], translatorPresetId: 0, ...over }
}

function containerOf(record: unknown): Loose {
    return (record as { seperateParameters: Loose }).seperateParameters
}

describe('T-C6 the settings .rtb replaces the container whole', () => {
    test('guard: a same-id slot takes the file container, so a file container without the key drops the device mix', () => {
        const device = { id: 'a', name: 'A', seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }) } as unknown as botPreset
        const read = readOf({ botPresets: [{ id: 'a', seperateParametersEnabled: true, seperateParameters: container({ memory: { temperature: 3 } }) }] })

        const plan = planSettingsMerge(deviceOf({ botPresets: [device] }), read)

        const merged = (plan.botPresets as botPreset[])[0]
        expect(containerOf(merged)).toEqual(container({ memory: { temperature: 3 } }))
        expect(containerOf(merged)).not.toHaveProperty(TASK_MODES_KEY)
        expect(effectiveTaskModes(merged)).toEqual({ memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' })
        expect(containerOf(device)).toHaveProperty(TASK_MODES_KEY)
    })

    test('guard: the working apply carries the file container whole, key included when the file has it', () => {
        const read = readOf({ seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }) })

        expect(read.fields.seperateParameters).toEqual(container({ taskModes: { ...MIX } }))
        const withoutKey = readOf({ seperateParametersEnabled: true, seperateParameters: container() })
        expect(withoutKey.fields.seperateParameters).toEqual(container())
    })

    test('guard: a file container the reference rule drops is not carried, so the device container and its key stay', () => {
        const read = readOf({ seperateParametersEnabled: true, seperateParameters: container({ overrides: { 'xcustom:::m1': { temperature: 1 } }, taskModes: { ...MIX } }) })

        expect(read.fields).not.toHaveProperty('seperateParameters')
        expect(read.dropped).toBeGreaterThan(0)
    })
})

describe('T-C7 a preset switch moves the container and the flag from the slot', () => {
    function working(extra: Loose = {}): Database {
        return { NAIsettings: {}, seperateParametersEnabled: true, seperateParameters: container({ taskModes: { ...MIX } }), ...extra } as unknown as Database
    }

    function slot(extra: Loose = {}): botPreset {
        return { name: 'S', seperateParametersEnabled: false, seperateParameters: container(), ...extra } as unknown as botPreset
    }

    test('guard: an unlocked switch to a slot without the key takes the slot container and flag, so the device key is gone', () => {
        const db = working()

        setPreset(db, slot())

        expect(db.seperateParametersEnabled).toBe(false)
        expect(containerOf(db)).toEqual(container())
        expect(containerOf(db)).not.toHaveProperty(TASK_MODES_KEY)
    })

    test('guard: a slot whose key disagrees with its flag is stored as it is and read by the flag', () => {
        const db = working({ seperateParametersEnabled: false, seperateParameters: container() })

        setPreset(db, slot({ seperateParametersEnabled: true, seperateParameters: container({ taskModes: { memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' } }) }))

        expect(db.seperateParametersEnabled).toBe(true)
        expect(containerOf(db)).toHaveProperty(TASK_MODES_KEY)
        expect(effectiveTaskModes(db)).toEqual({ memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' })
    })

    test('guard: a locked switch keeps the device container with its key and the device flag, whatever the slot holds', () => {
        const db = working({ disableSeperateParameterChangeOnPresetChange: true })

        setPreset(db, slot({ seperateParametersEnabled: true, seperateParameters: container({ taskModes: { memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' } }) }))

        expect(db.seperateParametersEnabled).toBe(true)
        expect(containerOf(db)).toEqual(container({ taskModes: { ...MIX } }))
    })
})
