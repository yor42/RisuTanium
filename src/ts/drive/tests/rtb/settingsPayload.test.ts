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
import { createHypaV3Preset, type HypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import type { TranslatorPreset } from 'src/ts/translator/presets'
import {
    PRESET_FIELD_RULE, PRESET_SOURCE_FIELDS, SETTINGS_FIELDS,
} from 'src/ts/drive/rtb/settingsFields'
import {
    buildSettingsRecords, checkField, planSettingsMerge, presetSourceOf, readSettingsPayload, rebuildJson,
    type DeviceLists, type SettingsRead,
} from 'src/ts/drive/rtb/settingsPayload'
import { UI_PREFS_KEYS } from 'src/ts/drive/rtb/sideStoreConfig'
import { inputOf, inputOfRaw, realisticDb, sourceOf } from './settingsTestKit'

type Fields = Record<string, unknown>

const asRecord = (value: object): Fields => value as unknown as Fields
const preset = (fields: Fields): botPreset => fields as unknown as botPreset

function readOf(records: Fields): SettingsRead {
    const read = readSettingsPayload(inputOf(Object.entries(records).map(([key, value]) => ({ key, value }))))
    if ('refused' in read) {
        throw new Error(`refused: ${read.refused}`)
    }
    return read
}

function deviceOf(over: Partial<DeviceLists> = {}): DeviceLists {
    return {
        botPresets: [], botPresetsId: 0, presetFolders: [], hypaV3Presets: [], hypaV3PresetId: 0,
        translatorPresets: [], translatorPresetId: 0, ...over,
    }
}

/** Every string in a value, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach((item) => strings(item, out))
    else if (typeof value === 'object' && value !== null) {
        for (const [key, item] of Object.entries(value)) { out.push(key); strings(item, out) }
    }
    return out
}

/** Whether any object at any depth has an own `__proto__`, `constructor` or `prototype` key. */
function hasProtoKey(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasProtoKey)
    if (typeof value !== 'object' || value === null) return false
    return Object.keys(value).some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')
        || Object.values(value).some(hasProtoKey)
}

describe('T7 (guard): present overwrites, absent keeps, unknown and wrong-kind never carried', () => {
    test('only allowlisted keys with the right kind are carried; the rest are counted', () => {
        const read = readOf({
            theme: 'dark', temperature: 55, zoomsize: 'big', connections: [{ id: 'c', key: 'sk-secret' }],
            openAIKey: 'sk-secret', notAField: 1, characters: [],
        })
        expect(read.fields).toEqual({ theme: 'dark', temperature: 55 })
        expect(read.dropped).toBe(5)
        expect(read.counts.fields).toBe(2)
        expect('fontSize' in read.fields).toBe(false)
    })

    test('a field the file lacks is absent from the carried fields, so the device keeps it', () => {
        const read = readOf({ theme: 'dark' })
        expect(Object.keys(read.fields)).toEqual(['theme'])
    })

    test('an index travels only with its list and only when in range', () => {
        expect(readOf({ botPresetsId: 0 }).selectionId).toBeUndefined()
        const list = [{ id: 'a', name: 'A' }]
        expect(readOf({ botPresets: list, botPresetsId: 0 }).selectionId).toBe('a')
        expect(readOf({ botPresets: list, botPresetsId: 1 }).selectionId).toBeUndefined()
        expect(readOf({ botPresets: list, botPresetsId: 0.5 }).selectionId).toBeUndefined()
        expect(readOf({ botPresets: list, botPresetsId: -1 }).selectionId).toBeUndefined()
        const read = readOf({ botPresets: list, botPresetsId: 0 })
        expect('botPresets' in read.fields || 'botPresetsId' in read.fields).toBe(false)
    })

    test('ui-prefs keep only the allowlisted keys with string values', () => {
        const input = inputOf([{ key: 'theme', value: 'dark' }], [
            { key: UI_PREFS_KEYS[0], value: 'x' }, { key: 'not.allowed', value: 'y' }, { key: UI_PREFS_KEYS[1], value: 3 },
        ])
        const read = readSettingsPayload(input)
        if ('refused' in read) throw new Error(read.refused)
        expect(read.uiPrefs).toEqual([{ key: UI_PREFS_KEYS[0], value: 'x' }])
        expect(read.dropped).toBe(2)
    })
})

describe('T9 (guard): a structurally bad file is refused whole', () => {
    const refusal = (records: Fields) => {
        const read = readSettingsPayload(inputOf(Object.entries(records).map(([key, value]) => ({ key, value }))))
        return 'refused' in read ? read.refused : null
    }

    test('missing, empty, repeated or non-string bot preset ids', () => {
        expect(refusal({ botPresets: [{ name: 'no id' }] })).not.toBeNull()
        expect(refusal({ botPresets: [{ id: '' }] })).not.toBeNull()
        expect(refusal({ botPresets: [{ id: 'a' }, { id: 'a' }] })).not.toBeNull()
        expect(refusal({ botPresets: [{ id: 3 }] })).not.toBeNull()
        expect(refusal({ botPresets: ['text'] })).not.toBeNull()
        expect(refusal({ botPresets: [{ id: 'a' }, { id: 'b' }] })).toBeNull()
    })

    test('missing or repeated memory preset ids', () => {
        expect(refusal({ hypaV3Presets: [{ name: 'x', settings: {} }] })).not.toBeNull()
        expect(refusal({ hypaV3Presets: [{ id: 'a', settings: {} }, { id: 'a', settings: {} }] })).not.toBeNull()
        expect(refusal({ hypaV3Presets: [{ id: 'a', settings: {} }] })).toBeNull()
    })

    test('bad folders', () => {
        expect(refusal({ presetFolders: [{ id: 'f' }] })).not.toBeNull()
        expect(refusal({ presetFolders: [{ id: 'f', name: 'a' }, { id: 'f', name: 'b' }] })).not.toBeNull()
        expect(refusal({ presetFolders: [{ id: 'f', name: 'a' }] })).toBeNull()
    })

    test('a repeated key', () => {
        const read = readSettingsPayload(inputOfRaw(['{"k":"theme","j":"a"}', '{"k":"theme","j":"b"}']))
        expect('refused' in read).toBe(true)
    })

    test('a list of the wrong kind is dropped, not refused', () => {
        const read = readOf({ botPresets: 'text', theme: 'dark' })
        expect(read.presets).toBeUndefined()
        expect(read.dropped).toBe(1)
    })
})

describe('T10 (guard): custom and plugin model references are never carried', () => {
    test('top-level fields, fallbackModels, preset fields and memory settings drop a reference and keep a catalog id', () => {
        const read = readOf({
            aiModel: 'xcustom:::m1', subModel: 'gpt-4o', ollamaModel: 'pluginmodel:::p1',
            fallbackModels: { model: ['gpt-4o', 'xcustom:::m1'], memory: [] },
            botPresets: [{ id: 'a', aiModel: 'xcustom:::m1', subModel: 'gpt-4o', fallbackModels: { model: ['pluginmodel:::p'] } }],
            hypaV3Presets: [{ id: 'h', name: 'H', settings: { summarizationModel: 'xcustom:::m1', maxChatsPerSummary: 9 } }],
        })
        expect(read.fields).toEqual({ subModel: 'gpt-4o' })
        expect(read.presets).toEqual([{ id: 'a', subModel: 'gpt-4o' }])
        expect(read.hypa).toEqual([{ id: 'h', name: 'H', settings: { maxChatsPerSummary: 9 } }])
        expect(read.dropped).toBe(6)
    })

    test('an object key that is a reference is also not carried', () => {
        const read = readOf({ seperateParameters: { overrides: { 'xcustom:::m1': { temperature: 1 } } } })
        expect(read.fields).toEqual({})
    })

    test('export leaves a referencing field out and names it', () => {
        const db = realisticDb()
        asRecord(db).aiModel = 'xcustom:::m1'
        asRecord(db).subModel = 'gpt-4o'
        const { records, skipped } = buildSettingsRecords(sourceOf(db))
        expect(skipped).toContain('aiModel')
        expect(records.some((record) => record.key === 'aiModel')).toBe(false)
        expect(records.find((record) => record.key === 'subModel')?.value).toBe('gpt-4o')
    })
})

describe('T19 (guard, pure part): a crafted file sets nothing outside the rules', () => {
    const SENTINEL = 'SENTINEL-7d1f'
    const omitted = Object.entries(PRESET_FIELD_RULE).filter(([, rule]) => rule === 'omit').map(([field]) => field)

    function craftedRead() {
        const filePreset: Fields = { id: 'a', name: 'A', temperature: 3, unknownField: SENTINEL }
        for (const field of omitted) filePreset[field] = SENTINEL
        const lines = [
            `{"k":"botPresets","j":[${JSON.stringify(filePreset).replace('{', '{"__proto__":{"polluted":"' + SENTINEL + '"},"ooba":{"__proto__":{"x":1},"constructor":{"y":1},"ok":1},')}]}`,
            `{"k":"connections","j":[{"id":"c","key":"${SENTINEL}"}]}`,
            `{"k":"ollamaURL","j":"https://${SENTINEL}.invalid"}`,
            `{"k":"openAIKey","j":"${SENTINEL}"}`,
            `{"k":"__proto__","j":{"polluted":"${SENTINEL}"}}`,
            `{"k":"constructor","j":"${SENTINEL}"}`,
            `{"k":"ainconfig","j":{"__proto__":{"p":1},"stoptokens":"x"}}`,
        ]
        const read = readSettingsPayload(inputOfRaw(lines))
        if ('refused' in read) throw new Error(read.refused)
        return read
    }

    test('no sentinel and no prototype key survives the read', () => {
        const read = craftedRead()
        expect(omitted.length).toBe(10)
        expect(JSON.stringify(read)).not.toContain(SENTINEL)
        expect(hasProtoKey(read)).toBe(false)
        expect(read.presets).toEqual([{ id: 'a', name: 'A', temperature: 3, ooba: { ok: 1 } }])
        expect(read.fields).toEqual({ ainconfig: { stoptokens: 'x' } })
    })

    test('merged objects have the plain prototype and no own prototype key', () => {
        const read = craftedRead()
        const device = deviceOf({ botPresets: [preset({ id: 'a', name: 'device', koboldURL: 'device-url', ooba: { mode: 'instruct' } })] })
        const plan = planSettingsMerge(device, read)
        const merged = asRecord(plan.botPresets![0])
        expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
        expect(hasProtoKey(plan)).toBe(false)
        expect(({} as Fields).polluted).toBeUndefined()
        expect(merged.koboldURL).toBe('device-url')
        expect(JSON.stringify(plan)).not.toContain(SENTINEL)
    })

    test('a decoded values list holding a key as a value is not misread as a field', () => {
        const read = readSettingsPayload({ values: [{ key: 'theme', value: { k: 'connections', j: [] } }] })
        if ('refused' in read) throw new Error(read.refused)
        expect(read.fields).toEqual({})
        expect(read.dropped).toBe(1)
    })
})

describe('T21 (guard): the customHTML theme is never carried', () => {
    test('export leaves the theme line out and names it; waifu is carried', () => {
        const db = realisticDb()
        db.theme = 'customHTML'
        let { records, skipped } = buildSettingsRecords(sourceOf(db))
        expect(records.some((record) => record.key === 'theme')).toBe(false)
        expect(skipped).toContain('theme')
        db.theme = 'waifu'
        ;({ records, skipped } = buildSettingsRecords(sourceOf(db)))
        expect(records.find((record) => record.key === 'theme')?.value).toBe('waifu')
        expect(skipped).not.toContain('theme')
    })

    test('a file carrying customHTML leaves the device theme alone and counts it', () => {
        const read = readOf({ theme: 'customHTML', textTheme: 'standard' })
        expect(read.fields).toEqual({ textTheme: 'standard' })
        expect(read.dropped).toBe(1)
        expect(readOf({ theme: 'waifu' }).fields).toEqual({ theme: 'waifu' })
    })
})

describe('T22 (guard): the export reads only allowlisted values', () => {
    test('every key asked of the source is allowlisted, never a character, URL or connection id', () => {
        const reads: string[] = []
        const db = realisticDb()
        buildSettingsRecords(sourceOf(db, reads))
        const allowed = new Set<string>(SETTINGS_FIELDS)
        expect(reads.filter((key) => !allowed.has(key))).toEqual([])
        for (const key of ['characters', 'koboldURL', 'proxyConnectionId', 'connections', 'currentPluginProvider', 'textgenWebUIStreamURL']) {
            expect(reads).not.toContain(key)
        }
    })

    test('presetSourceOf reads exactly the working preset fields', () => {
        const reads: string[] = []
        presetSourceOf(sourceOf(realisticDb(), reads))
        expect(reads.slice().sort()).toEqual([...PRESET_SOURCE_FIELDS].sort())
    })
})

describe('T24 and T26 (guard): a field the setter dereferences is never carried as null or the wrong kind', () => {
    test('a preset string NAISettings is dropped and counted, and the merged preset keeps the device value', () => {
        const read = readOf({ botPresets: [{ id: 'a', NAISettings: 'text', temperature: 4 }] })
        expect(read.presets).toEqual([{ id: 'a', temperature: 4 }])
        expect(read.dropped).toBe(1)
        const plan = planSettingsMerge(deviceOf({ botPresets: [preset({ id: 'a', NAISettings: { cfg: 1 }, temperature: 1 })] }), read)
        expect(plan.botPresets).toEqual([{ id: 'a', NAISettings: { cfg: 1 }, temperature: 4 }])
    })

    test('a top-level NAIsettings null, and a same-id preset NAISettings null, are dropped', () => {
        const read = readOf({
            NAIsettings: null,
            botPresets: [{ id: 'a', NAISettings: null }, { id: 'n' }], botPresetsId: 1,
        })
        expect(read.fields).toEqual({})
        expect(read.presets).toEqual([{ id: 'a' }, { id: 'n' }])
        expect(read.dropped).toBe(2)
        const plan = planSettingsMerge(deviceOf({ botPresets: [preset({ id: 'a', NAISettings: { cfg: 1 } })] }), read)
        expect(asRecord(plan.botPresets![0]).NAISettings).toEqual({ cfg: 1 })
        expect(asRecord(plan.botPresets![1]).NAISettings).toBeUndefined()
        expect(plan.counts.dropped).toBe(2)
    })

    test('the nullable fields keep a null that a same-id preset carries', () => {
        const read = readOf({ botPresets: [{ id: 'a', promptTemplate: null, seperateModels: null, localStopStrings: null }] })
        expect(read.presets).toEqual([{ id: 'a', promptTemplate: null, seperateModels: null, localStopStrings: null }])
        const plan = planSettingsMerge(deviceOf({ botPresets: [preset({ id: 'a', promptTemplate: [{ type: 'plain' }], seperateModels: { memory: 'm' } })] }), read)
        expect(asRecord(plan.botPresets![0]).promptTemplate).toBeNull()
        expect(asRecord(plan.botPresets![0]).seperateModels).toBeNull()
    })
})

describe('entry checks of fallbackModels and hotkeys (guard)', () => {
    test('fallbackModels must be an object of string arrays', () => {
        const good = { model: ['a'], memory: [], emotion: ['b'] }
        expect(checkField('fallbackModels', good).ok).toBe(true)
        expect(checkField('fallbackModels', { model: 'a' }).ok).toBe(false)
        expect(checkField('fallbackModels', { memory: [1] }).ok).toBe(false)
        expect(checkField('fallbackModels', { otherAx: [['a']] }).ok).toBe(false)
        expect(checkField('fallbackModels', ['a']).ok).toBe(false)
        const read = readOf({ fallbackModels: { translate: 7 }, botPresets: [{ id: 'a', fallbackModels: { model: [null] }, temperature: 2 }] })
        expect(read.fields).toEqual({})
        expect(read.presets).toEqual([{ id: 'a', temperature: 2 }])
    })

    test('hotkeys must be an array of plain objects', () => {
        expect(checkField('hotkeys', [{ key: 'a', action: 'b' }]).ok).toBe(true)
        expect(checkField('hotkeys', [1]).ok).toBe(false)
        expect(checkField('hotkeys', [null]).ok).toBe(false)
        expect(checkField('hotkeys', [[]]).ok).toBe(false)
        expect(checkField('hotkeys', 'x').ok).toBe(false)
        expect(readOf({ hotkeys: ['a'], theme: 'dark' }).fields).toEqual({ theme: 'dark' })
    })
})

describe('T8 (guard): bot presets and folders merge by id', () => {
    const deviceA = preset({
        id: 'a', name: 'A', temperature: 1, koboldURL: 'device-kobold', proxyConnectionId: 'device-conn', image: 'device-image',
        textgenWebUIStreamURL: 'device-stream', slot: 2,
    })
    const deviceX = preset({ id: 'x', name: 'X', temperature: 9 })

    test('a same id is overwritten field by field and keeps the device connection fields; a new id is appended with the file id', () => {
        const read = readOf({
            botPresets: [{ id: 'a', name: 'A file', temperature: 2, mainPrompt: 'file prompt' }, { id: 'n', name: 'N', temperature: 7 }],
            botPresetsId: 1,
        })
        const plan = planSettingsMerge(deviceOf({ botPresets: [deviceA, deviceX], botPresetsId: 1 }), read)
        expect(plan.botPresets).toEqual([
            { ...asRecord(deviceA), name: 'A file', temperature: 2, mainPrompt: 'file prompt' },
            deviceX,
            { id: 'n', name: 'N', temperature: 7 },
        ])
        expect(plan.selectedIndex).toBe(2)
        expect(plan.counts).toEqual({ fields: 0, presets: 2, memoryPresets: 0, translatorPresets: 0, dropped: 0 })
    })

    test('the device order stays, device-only presets stay, and the selection finds the merged position of a same id', () => {
        const read = readOf({ botPresets: [{ id: 'x', temperature: 3 }], botPresetsId: 0 })
        const plan = planSettingsMerge(deviceOf({ botPresets: [deviceA, deviceX] }), read)
        expect(plan.botPresets!.map((p) => p.id)).toEqual(['a', 'x'])
        expect(plan.selectedIndex).toBe(1)
        expect(asRecord(plan.botPresets![0])).toEqual(asRecord(deviceA))
    })

    test('without a usable selection there is no selected index', () => {
        const read = readOf({ botPresets: [{ id: 'n' }] })
        const plan = planSettingsMerge(deviceOf({ botPresets: [deviceA] }), read)
        expect(plan.selectedIndex).toBeUndefined()
        expect(plan.botPresets!.length).toBe(2)
    })

    test('a list the file lacks is not part of the plan', () => {
        const plan = planSettingsMerge(deviceOf({ botPresets: [deviceA] }), readOf({ theme: 'dark' }))
        expect(plan.botPresets).toBeUndefined()
        expect(plan.presetFolders).toBeUndefined()
        expect(plan.hypaV3Presets).toBeUndefined()
        expect(plan.translatorPresets).toBeUndefined()
    })

    test('the device side never refuses: a missing or malformed device list is an empty one', () => {
        const read = readOf({ botPresets: [{ id: 'n' }], botPresetsId: 0, hypaV3Presets: [{ id: 'h', settings: {} }], translatorPresets: [{ name: 'a', prompt: 'p', maxResponse: 1 }] })
        const broken = { botPresets: undefined, botPresetsId: undefined, hypaV3Presets: null, hypaV3PresetId: 'x', translatorPresets: 5, translatorPresetId: undefined } as unknown as DeviceLists
        const plan = planSettingsMerge(broken, read)
        expect(plan.botPresets!.map((p) => p.id)).toEqual(['n'])
        expect(plan.selectedIndex).toBe(0)
        expect(plan.hypaV3Presets!.map((p) => p.id)).toEqual(['h'])
        expect(plan.translatorPresets).toEqual([{ name: 'a', prompt: 'p', maxResponse: 1 }])
    })

    test('folders merge by id: a same id takes the file name, a new id is appended, device-only stay', () => {
        const read = readOf({ presetFolders: [{ id: 'f1', name: 'File one' }, { id: 'f3', name: 'Three' }] })
        const plan = planSettingsMerge(deviceOf({ presetFolders: [{ id: 'f1', name: 'One' }, { id: 'f2', name: 'Two' }] }), read)
        expect(plan.presetFolders).toEqual([{ id: 'f1', name: 'File one' }, { id: 'f2', name: 'Two' }, { id: 'f3', name: 'Three' }])
    })

    test('a preset meta field of the file overwrites the device value like any other field', () => {
        const read = readOf({ botPresets: [{ id: 'a', folderId: 'f9', slot: 4 }] })
        const plan = planSettingsMerge(deviceOf({ botPresets: [deviceA] }), read)
        expect(asRecord(plan.botPresets![0]).folderId).toBe('f9')
        expect(asRecord(plan.botPresets![0]).slot).toBe(4)
    })
})

describe('T27 (guard): memory presets merge by id', () => {
    function hypa(id: string, name: string, settings: Fields): HypaV3Preset {
        const made = createHypaV3Preset(name, settings)
        made.id = id
        return made
    }

    const deviceA = hypa('a', 'A', { maxChatsPerSummary: 3, summarizationPrompt: 'device prompt', summarizationModel: 'subModel' })
    const deviceB = hypa('b', 'B', {})

    test('a same id keeps what the file lacks, takes what it changes and drops a reference; a new id is appended', () => {
        const read = readOf({
            hypaV3Presets: [
                { id: 'a', name: 'A file', settings: { maxChatsPerSummary: 8, summarizationModel: 'xcustom:::m' } },
                { id: 'c', name: 'C', settings: { memoryTokensRatio: 0.3 } },
            ],
            hypaV3PresetId: 1,
        })
        const plan = planSettingsMerge(deviceOf({ hypaV3Presets: [deviceA, deviceB], hypaV3PresetId: 1 }), read)
        expect(plan.hypaV3Presets!.map((p) => p.id)).toEqual(['a', 'b', 'c'])
        const [a, b, c] = plan.hypaV3Presets!
        expect(a.name).toBe('A file')
        expect(a.settings.maxChatsPerSummary).toBe(8)
        expect(a.settings.summarizationPrompt).toBe('device prompt')
        expect(a.settings.summarizationModel).toBe('subModel')
        expect(b).toEqual(deviceB)
        expect(c.name).toBe('C')
        expect(c.settings.memoryTokensRatio).toBe(0.3)
        expect(c.settings.maxChatsPerSummary).toBe(createHypaV3Preset().settings.maxChatsPerSummary)
        expect(plan.hypaIndex).toBe(2)
        expect(plan.counts.memoryPresets).toBe(2)
        expect(plan.counts.dropped).toBe(1)
    })

    test('an out-of-range file index leaves the device index alone', () => {
        const read = readOf({ hypaV3Presets: [{ id: 'c', settings: {} }], hypaV3PresetId: 5 })
        const plan = planSettingsMerge(deviceOf({ hypaV3Presets: [deviceA, deviceB], hypaV3PresetId: 1 }), read)
        expect(plan.hypaIndex).toBeUndefined()
        expect(plan.hypaV3Presets!.length).toBe(3)
    })

    test('a setting of the wrong type or an unknown setting is dropped and counted', () => {
        const read = readOf({ hypaV3Presets: [{ id: 'c', name: 'C', settings: { maxChatsPerSummary: 'six', bogus: 1, alwaysToggleOn: true } }] })
        expect(read.hypa).toEqual([{ id: 'c', name: 'C', settings: { alwaysToggleOn: true } }])
        expect(read.dropped).toBe(2)
    })
})

describe('T28 (guard): translator presets are appended unless identical', () => {
    const t1: TranslatorPreset = { name: 't1', prompt: 'p1', maxResponse: 100 }
    const t2: TranslatorPreset = { name: 't2', prompt: 'p2', maxResponse: 200 }
    const t3: TranslatorPreset = { name: 't3', prompt: 'p3', maxResponse: 300 }

    test('an identical entry is not appended, a repeated new one is appended once, a bad one is counted', () => {
        const read = readOf({ translatorPresets: [t1, t3, t3, { name: 'bad' }], translatorPresetId: 1 })
        expect(read.translator).toEqual([t1, t3, t3])
        expect(read.dropped).toBe(1)
        const plan = planSettingsMerge(deviceOf({ translatorPresets: [t1, t2], translatorPresetId: 0 }), read)
        expect(plan.translatorPresets).toEqual([t1, t2, t3])
        expect(plan.translatorIndex).toBe(2)
        expect(plan.counts.translatorPresets).toBe(1)
        expect(plan.counts.dropped).toBe(1)
    })

    test('selecting an entry the device already holds points the index at it', () => {
        const read = readOf({ translatorPresets: [t1, t3], translatorPresetId: 0 })
        const plan = planSettingsMerge(deviceOf({ translatorPresets: [t2, t1], translatorPresetId: 0 }), read)
        expect(plan.translatorIndex).toBe(1)
        expect(plan.translatorPresets).toEqual([t2, t1, t3])
    })

    test('a renamed copy is a different entry and is appended', () => {
        const read = readOf({ translatorPresets: [{ ...t1, name: 'renamed' }] })
        const plan = planSettingsMerge(deviceOf({ translatorPresets: [t1] }), read)
        expect(plan.translatorPresets!.length).toBe(2)
    })

    test('an entry keeps exactly its three keys', () => {
        const read = readOf({ translatorPresets: [{ ...t1, extra: 'x', id: 'i' }] })
        expect(read.translator).toEqual([t1])
    })

    test('an index with no list, or out of range, changes nothing', () => {
        expect(readOf({ translatorPresetId: 1 }).translatorSelection).toBeUndefined()
        const read = readOf({ translatorPresets: [t1], translatorPresetId: 4 })
        expect(planSettingsMerge(deviceOf({ translatorPresets: [t2], translatorPresetId: 0 }), read).translatorIndex).toBeUndefined()
    })
})

describe('T29 (guard): the export skips what the reader would drop and never throws', () => {
    test('NaN, a string where a number belongs, an undefined member and a NaN inside an array', () => {
        const db = realisticDb()
        const record = asRecord(db)
        record.temperature = NaN
        record.top_p = 'high'
        record.bias = [['a', NaN]]
        record.ooba = { mode: 'instruct', dropped: undefined }
        const { records, skipped } = buildSettingsRecords(sourceOf(db))
        const byKey = new Map(records.map((entry) => [entry.key, entry.value]))
        expect(byKey.has('temperature')).toBe(false)
        expect(byKey.has('top_p')).toBe(false)
        expect(skipped).toEqual(expect.arrayContaining(['temperature', 'top_p']))
        expect(byKey.get('bias')).toEqual([['a', null]])
        expect(byKey.get('ooba')).toEqual({ mode: 'instruct' })
    })

    test('a preset field that fails is skipped by path and the preset stays', () => {
        const db = realisticDb()
        db.botPresets = [preset({ id: 'a', name: 'A', temperature: 'warm' })]
        db.botPresetsId = -1
        const { records, skipped } = buildSettingsRecords(sourceOf(db))
        expect(skipped).toContain('botPresets[0].temperature')
        expect(records.find((entry) => entry.key === 'botPresets')?.value).toEqual([{ id: 'a', name: 'A' }])
    })

    test('a preset list with a missing or repeated id is skipped whole, with its index', () => {
        const db = realisticDb()
        db.botPresets = [preset({ id: 'a' }), preset({ id: 'a' })]
        db.botPresetsId = 0
        const { records, skipped } = buildSettingsRecords(sourceOf(db))
        expect(skipped).toContain('botPresets')
        expect(records.some((entry) => entry.key === 'botPresets' || entry.key === 'botPresetsId')).toBe(false)
    })

    test('a translator index still names the same entry after a bad entry before it is left out', () => {
        const db = realisticDb()
        const t1 = { name: 't1', prompt: 'p1', maxResponse: 10 }
        const t2 = { name: 't2', prompt: 'p2', maxResponse: 20 }
        db.translatorPresets = [{ name: 'bad' } as unknown as TranslatorPreset, t1, t2]
        db.translatorPresetId = 2
        const { records, skipped } = buildSettingsRecords(sourceOf(db))
        expect(skipped).toEqual(['translatorPresets[0]'])
        expect(records.find((entry) => entry.key === 'translatorPresets')?.value).toEqual([t1, t2])
        expect(records.find((entry) => entry.key === 'translatorPresetId')?.value).toBe(1)
    })

    test('records are one per key, sorted, and each reads back', () => {
        const { records } = buildSettingsRecords(sourceOf(realisticDb()))
        const keys = records.map((entry) => entry.key)
        expect(keys).toEqual([...keys].sort())
        expect(new Set(keys).size).toBe(keys.length)
        expect(keys.length).toBeGreaterThan(100)
    })
})

describe('T25 (guard, pure part): a file written from the real producers reads back with nothing dropped', () => {
    function roundTrip(db: Database) {
        const built = buildSettingsRecords(sourceOf(db))
        expect(built.skipped).toEqual([])
        const read = readSettingsPayload(inputOf(built.records))
        if ('refused' in read) throw new Error(read.refused)
        expect(read.dropped).toBe(0)
        return { built, read }
    }

    function expectFieldsEqualSource(db: Database, read: SettingsRead) {
        const source = asRecord(db)
        const lists = new Set(['botPresets', 'botPresetsId', 'presetFolders', 'hypaV3Presets', 'hypaV3PresetId', 'translatorPresets', 'translatorPresetId'])
        const carried = read.fields as Fields
        for (const name of SETTINGS_FIELDS) {
            if (lists.has(name)) continue
            const value = rebuildJson(source[name])
            if (value === undefined) {
                expect(name in carried, name).toBe(false)
            } else {
                expect(carried[name], name).toEqual(value)
            }
        }
    }

    test('(i) a realistic database', () => {
        const db = realisticDb()
        const { read } = roundTrip(db)
        expectFieldsEqualSource(db, read)
        expect(read.presets!.length).toBe(db.botPresets.length)
        expect(read.counts.fields).toBeGreaterThan(100)
    })

    test('(ii) null templates, a saved second preset and doNotChangeSeperateModels', () => {
        const db = realisticDb()
        const record = asRecord(db)
        record.promptTemplate = null
        record.localStopStrings = null
        record.doNotChangeSeperateModels = true
        delete record.dynamicOutput
        const second = presetFromWorkingSettings(db, 'Second', '')
        second.id = 'second-id'
        db.botPresets = [...db.botPresets, second]
        db.botPresets.forEach((entry, at) => { entry.id ??= `p${at}` })
        const { read } = roundTrip(db)
        expectFieldsEqualSource(db, read)
        expect('dynamicOutput' in read.fields).toBe(false)
        const carried = read.presets!.find((entry) => entry.id === 'second-id')!
        expect(carried.promptTemplate).toBeNull()
        expect(carried.seperateModels).toBeNull()
        expect(carried.localStopStrings).toBeNull()
        // A device with the same ids and array templates takes the null the producer stored.
        const device = deviceOf({
            botPresets: db.botPresets.map((entry) => preset({ ...asRecord(entry), promptTemplate: [{ type: 'plain', text: 'x' }] })),
        })
        const plan = planSettingsMerge(device, read)
        expect(asRecord(plan.botPresets!.find((entry) => entry.id === 'second-id')!).promptTemplate).toBeNull()
    })

    test('(iii) after a real changeToPreset to a preset with null settings', () => {
        const db = realisticDb()
        const second = presetFromWorkingSettings(db, 'Second', '')
        second.id = 'second-id'
        db.botPresets = [...db.botPresets, second]
        db.botPresets.forEach((entry, at) => { entry.id ??= `p${at}` })
        asRecord(db).doNotChangeSeperateModels = false
        changeToPreset(1, false)
        const record = asRecord(db)
        expect(record.promptTemplate === null || record.thinkingTokens === null || record.dynamicOutput === null).toBe(true)
        const { read } = roundTrip(db)
        expectFieldsEqualSource(db, read)
        for (const name of ['promptTemplate', 'thinkingTokens', 'dynamicOutput']) {
            if (record[name] === null) {
                expect((read.fields as Fields)[name], name).toBeNull()
            }
        }
    })

    test('the selected preset carries the working fields, not the stored slot, and the database is not changed', () => {
        const db = realisticDb()
        db.botPresets = [preset({ id: 'a', name: 'A', temperature: 1 })]
        db.botPresetsId = 0
        db.temperature = 42
        const before = JSON.stringify(db)
        const { read } = roundTrip(db)
        expect(read.presets![0].temperature).toBe(42)
        expect(read.presets![0].id).toBe('a')
        expect(read.selectionId).toBe('a')
        expect(JSON.stringify(db)).toBe(before)
    })

    test('export never carries an omit field of a preset, a connection or a key', () => {
        const db = realisticDb()
        const SENTINEL = 'SENTINEL-export-3c9a'
        const record = asRecord(db)
        for (const name of ['koboldURL', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'currentPluginProvider', 'proxyConnectionId', 'openAIKey', 'proxyKey', 'ollamaURL', 'forceReplaceUrl']) {
            record[name] = SENTINEL
        }
        record.connections = [{ id: 'c', key: SENTINEL }]
        db.botPresets = [preset({ id: 'a', name: 'A', openAIKey: SENTINEL, proxyKey: SENTINEL, image: SENTINEL, koboldURL: SENTINEL, forceReplaceUrl: SENTINEL, forceReplaceUrl2: SENTINEL })]
        db.botPresetsId = 0
        const { records } = buildSettingsRecords(sourceOf(db))
        expect(JSON.stringify(records)).not.toContain(SENTINEL)
        expect(strings(records)).not.toContain('connections')
    })
})
