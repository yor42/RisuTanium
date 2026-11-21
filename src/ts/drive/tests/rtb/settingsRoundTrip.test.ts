import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'

// The real `setDatabase`, `presetFromWorkingSettings` and `changeToPreset` run; only the modules whose import graph
// would start effects (the reactive stores and the global API) are replaced by plain stand-ins.
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

import { changeToPreset, presetFromWorkingSettings, type Database, type botPreset } from 'src/ts/storage/database.svelte'
import { createHypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import { PRESET_FIELD_RULE, SETTINGS_FIELDS } from 'src/ts/drive/rtb/settingsFields'
import { buildSettingsRecords, planSettingsMerge, readSettingsPayload, rebuildJson, type DeviceLists, type SettingsRead } from 'src/ts/drive/rtb/settingsPayload'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { craftedFile, SETTINGS_ROW, settingsFile } from './settingsFileKit'
import { realisticDb, sourceOf } from './settingsTestKit'

type Fields = Record<string, unknown>

const asRecord = (value: object): Fields => value as unknown as Fields
const preset = (fields: Fields): botPreset => fields as unknown as botPreset

const LISTS = new Set(['botPresets', 'botPresetsId', 'presetFolders', 'hypaV3Presets', 'hypaV3PresetId', 'translatorPresets', 'translatorPresetId'])

function deviceOf(over: Partial<DeviceLists> = {}): DeviceLists {
    return {
        botPresets: [], botPresetsId: 0, presetFolders: [], hypaV3Presets: [], hypaV3PresetId: 0,
        translatorPresets: [], translatorPresetId: 0, ...over,
    }
}

/** The settings of `db` written to a file, verified from the bytes and read back the way a restore reads them. */
async function throughFile(db: Database) {
    const built = buildSettingsRecords(sourceOf(db))
    const file = await settingsFile({ settings: built.records })
    const verdict = await verifyRtb(file.source)
    if (verdict.kind !== 'settings') {
        throw new Error(`the file verified as ${verdict.kind}`)
    }
    const read = readSettingsPayload(verdict.verified)
    if ('refused' in read) {
        throw new Error(read.refused)
    }
    return { built, read }
}

async function readCrafted(lines: string[]): Promise<SettingsRead | { refused: string }> {
    const file = await craftedFile({ entries: [{ name: 'settings/data.jsonl', body: `${lines.join('\n')}\n`, method: 8 }], defs: [SETTINGS_ROW] })
    const verdict = await verifyRtb(file.source)
    if (verdict.kind !== 'settings') {
        throw new Error(`the crafted file verified as ${verdict.kind}`)
    }
    return readSettingsPayload(verdict.verified)
}

function hasProtoKey(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasProtoKey)
    if (typeof value !== 'object' || value === null) return false
    return Object.keys(value).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')
        || Object.values(value).some(hasProtoKey)
}

describe('T25 (guard): a file written by the writer from the real producers reads back with nothing dropped', () => {
    function expectFieldsEqualSource(db: Database, read: SettingsRead) {
        const source = asRecord(db)
        const carried = read.fields as Fields
        for (const name of SETTINGS_FIELDS) {
            if (LISTS.has(name)) continue
            const value = rebuildJson(source[name])
            if (value === undefined) {
                expect(name in carried, name).toBe(false)
            } else {
                expect(carried[name], name).toEqual(value)
            }
        }
    }

    test('(i) a realistic database: no skipped value, no drop, every field equal to its source', async () => {
        const db = realisticDb()
        const { built, read } = await throughFile(db)
        expect(built.skipped).toEqual([])
        expect(read.dropped).toBe(0)
        expectFieldsEqualSource(db, read)
        expect(read.presets!.length).toBe(db.botPresets.length)
    })

    test('(ii) null templates and a saved second preset, then restored onto a device holding the same ids', async () => {
        const db = realisticDb()
        const record = asRecord(db)
        record.promptTemplate = null
        record.localStopStrings = null
        const second = presetFromWorkingSettings(db, 'Second', '')
        second.id = 'second-id'
        db.botPresets = [...db.botPresets, second]
        db.botPresets.forEach((entry, at) => { entry.id ??= `p${at}` })
        const { built, read } = await throughFile(db)
        expect(built.skipped).toEqual([])
        expect(read.dropped).toBe(0)
        expectFieldsEqualSource(db, read)
        const device = deviceOf({ botPresets: db.botPresets.map((entry) => preset({ ...asRecord(entry), promptTemplate: [{ type: 'plain', text: 'x' }] })) })
        const plan = planSettingsMerge(device, read)
        expect(asRecord(plan.botPresets!.find((entry) => entry.id === 'second-id')!).promptTemplate).toBeNull()
    })

    test('(iii) after a real changeToPreset to a preset with null settings', async () => {
        const db = realisticDb()
        const second = presetFromWorkingSettings(db, 'Second', '')
        second.id = 'second-id'
        db.botPresets = [...db.botPresets, second]
        db.botPresets.forEach((entry, at) => { entry.id ??= `p${at}` })
        changeToPreset(1, false)
        const { built, read } = await throughFile(db)
        expect(built.skipped).toEqual([])
        expect(read.dropped).toBe(0)
        expectFieldsEqualSource(db, read)
    })

    test('the lists travel through the file with their indices', async () => {
        const db = realisticDb()
        db.hypaV3Presets = [createHypaV3Preset('One', {}), createHypaV3Preset('Two', {})]
        db.hypaV3PresetId = 1
        db.translatorPresets = [{ name: 'T', prompt: 'p', maxResponse: 10 }]
        db.translatorPresetId = 0
        const { read } = await throughFile(db)
        expect(read.dropped).toBe(0)
        expect(read.hypa!.map((entry) => entry.name)).toEqual(['One', 'Two'])
        expect(read.hypaSelectionId).toBe(db.hypaV3Presets[1].id)
        expect(read.translatorSelection).toEqual({ name: 'T', prompt: 'p', maxResponse: 10 })
    })
})

describe('T19 and T26 (guard): a crafted file sets nothing outside the rules', () => {
    const SENTINEL = 'SENTINEL-s1c-4e2a'
    const omitted = Object.entries(PRESET_FIELD_RULE).filter(([, rule]) => rule === 'omit').map(([field]) => field)

    test('sentinels in every omitted preset field, connections, URLs, keys and prototype keys never reach the read', async () => {
        const filePreset: Fields = { id: 'a', name: 'A', temperature: 3, unknownField: SENTINEL }
        for (const field of omitted) filePreset[field] = SENTINEL
        const lines = [
            `{"k":"botPresets","j":[${JSON.stringify(filePreset).replace('{', '{"__proto__":{"polluted":"' + SENTINEL + '"},"ooba":{"__proto__":{"x":1},"constructor":{"y":1},"ok":1},')}]}`,
            `{"k":"connections","j":[{"id":"c","key":"${SENTINEL}"}]}`,
            `{"k":"ollamaURL","j":"https://${SENTINEL}.invalid"}`,
            `{"k":"openAIKey","j":"${SENTINEL}"}`,
            `{"k":"__proto__","j":{"polluted":"${SENTINEL}"}}`,
            `{"k":"theme","j":"customHTML"}`,
        ]
        const read = await readCrafted(lines)
        if ('refused' in read) throw new Error(read.refused)
        expect(omitted.length).toBe(10)
        expect(JSON.stringify(read)).not.toContain(SENTINEL)
        expect(hasProtoKey(read)).toBe(false)
        expect('theme' in read.fields).toBe(false)
        const plan = planSettingsMerge(deviceOf({ botPresets: [preset({ id: 'a', name: 'device', koboldURL: 'device-url' })] }), read)
        expect(asRecord(plan.botPresets![0]).koboldURL).toBe('device-url')
        expect(JSON.stringify(plan)).not.toContain(SENTINEL)
        expect(({} as Fields).polluted).toBeUndefined()
    })

    test('T26: a null where the setter dereferences is dropped, at the top level and in a same-id preset', async () => {
        const read = await readCrafted([
            '{"k":"NAIsettings","j":null}',
            '{"k":"botPresets","j":[{"id":"a","name":"A","NAISettings":null,"temperature":2}]}',
        ])
        if ('refused' in read) throw new Error(read.refused)
        expect('NAIsettings' in read.fields).toBe(false)
        expect(read.presets).toEqual([{ id: 'a', name: 'A', temperature: 2 }])
        expect(read.dropped).toBeGreaterThanOrEqual(2)
        const device = deviceOf({ botPresets: [preset({ id: 'a', name: 'device', NAISettings: { sampler: 1 } })] })
        const plan = planSettingsMerge(device, read)
        expect(asRecord(plan.botPresets![0]).NAISettings).toEqual({ sampler: 1 })
    })

    test('T9 at file level: a missing or repeated preset id refuses the whole file', async () => {
        const missing = await readCrafted(['{"k":"botPresets","j":[{"name":"no id"}]}'])
        expect('refused' in missing).toBe(true)
        const repeated = await readCrafted(['{"k":"botPresets","j":[{"id":"a"},{"id":"a"}]}'])
        expect('refused' in repeated).toBe(true)
    })

    test('T27 and T28 at file level: memory presets merge by id and translator presets append unless identical', async () => {
        const read = await readCrafted([
            '{"k":"hypaV3Presets","j":[{"id":"m1","name":"M1 file","settings":{"recentMemoryRatio":0.5}},{"id":"m3","name":"M3","settings":{}}]}',
            '{"k":"hypaV3PresetId","j":1}',
            '{"k":"translatorPresets","j":[{"name":"t1","prompt":"p","maxResponse":1},{"name":"t3","prompt":"q","maxResponse":2}]}',
            '{"k":"translatorPresetId","j":1}',
        ])
        if ('refused' in read) throw new Error(read.refused)
        const device = deviceOf({
            hypaV3Presets: [createHypaV3Preset('M1', {}), createHypaV3Preset('M2', {})].map((entry, at) => ({ ...entry, id: `m${at + 1}` })),
            hypaV3PresetId: 1,
            translatorPresets: [{ name: 't1', prompt: 'p', maxResponse: 1 }, { name: 't2', prompt: 'z', maxResponse: 3 }],
            translatorPresetId: 0,
        })
        const plan = planSettingsMerge(device, read)
        expect(plan.hypaV3Presets!.map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3'])
        expect(plan.hypaIndex).toBe(2)
        expect(plan.translatorPresets!.map((entry) => entry.name)).toEqual(['t1', 't2', 't3'])
        expect(plan.translatorIndex).toBe(2)
    })
})
