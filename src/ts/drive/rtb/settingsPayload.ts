import type { JsonObject, JsonValue } from 'src/ts/storage/blockFrame'
import { savedPresetFor, type Database, type PresetFolder, type WorkingPresetSource, type botPreset } from 'src/ts/storage/database.svelte'
import { createHypaV3Preset, type HypaV3Preset } from 'src/ts/process/memory/hypaV3Presets'
import type { TranslatorPreset } from 'src/ts/translator/presets'
import {
    LIST_FIELD_NAMES, PRESET_FIELD_RULE, SETTINGS_FIELDS, SETTINGS_FIELD_RULES, isFallbackModelsShape, isHotkeysShape,
    presetDbName, type FieldKind, type FieldRule,
} from './settingsFields'
import { RtbSideValueError, SIDE_VALUE_MAX_DEPTH, encodeSideLine } from './sideLines'
import { UI_PREFS_KEYS } from './sideStoreConfig'

/**
 * The payload model of a settings-only `.rtb`: what a database becomes as `{key, value}` side lines, and what a file's
 * lines become again. Pure: nothing here writes the database, localStorage or a file. Every value that crosses the
 * file boundary, in either direction, goes through `rebuildJson` and `checkField`, so a file this build writes reads
 * back with nothing dropped, and a crafted file can set nothing outside `SETTINGS_FIELDS` and the preset rules.
 */

//#region value rebuild

const PROTO_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

class UnusableValue extends Error {}

function rebuild(value: unknown, path: Set<object>): JsonValue | undefined {
    switch (typeof value) {
        case 'boolean':
        case 'string':
            return value
        case 'number':
            return Number.isFinite(value) ? (value === 0 ? 0 : value) : null
        case 'object':
            break
        default:
            return undefined
    }
    if (value === null) {
        return null
    }
    if (path.has(value) || path.size >= SIDE_VALUE_MAX_DEPTH) {
        throw new UnusableValue()
    }
    path.add(value)
    let out: JsonValue
    if (Array.isArray(value)) {
        const items: JsonValue[] = []
        for (let i = 0; i < value.length; i++) {
            items.push(rebuild(value[i], path) ?? null)
        }
        out = items
    } else {
        const record = value as Record<string, unknown>
        const fields: JsonObject = {}
        for (const key of Object.keys(record)) {
            if (PROTO_KEYS.has(key)) {
                continue
            }
            const child = rebuild(record[key], path)
            if (child !== undefined) {
                fields[key] = child
            }
        }
        out = fields
    }
    path.delete(value)
    return out
}

/**
 * A fresh plain copy of `value` with the semantics of `JSON.parse(JSON.stringify(value))`: a non-finite number
 * becomes `null` and `-0` becomes `0`; `undefined`, functions and symbols are dropped from objects and become `null`
 * in arrays; methods are never called; `__proto__`, `constructor` and `prototype` keys are dropped at every depth.
 * A top-level value that rebuilds to nothing, is a non-finite number, is cyclic or nests deeper than a side line may
 * is `undefined`: the field is treated as absent.
 */
export function rebuildJson(value: unknown): JsonValue | undefined {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return undefined
    }
    try {
        return rebuild(value, new Set<object>())
    } catch (error) {
        if (error instanceof UnusableValue) {
            return undefined
        }
        throw error
    }
}

//#endregion

//#region field checks

const REFERENCE_PREFIXES = ['xcustom:::', 'pluginmodel:::'] as const

function isReference(text: string): boolean {
    return REFERENCE_PREFIXES.some((prefix) => text.startsWith(prefix))
}

/**
 * Whether a string at any depth, or an object key, is a reference to a custom or plugin model. Those lists never
 * travel, so a carried reference would dangle on the device it lands on.
 */
export function containsReference(value: JsonValue): boolean {
    if (typeof value === 'string') {
        return isReference(value)
    }
    if (Array.isArray(value)) {
        return value.some(containsReference)
    }
    if (typeof value === 'object' && value !== null) {
        return Object.keys(value).some((key) => isReference(key) || containsReference(value[key]))
    }
    return false
}

function isPlainJsonObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function kindHolds(kind: FieldKind, value: JsonValue): boolean {
    switch (kind) {
        case 'boolean':
            return typeof value === 'boolean'
        case 'number':
            return typeof value === 'number'
        case 'string':
            return typeof value === 'string'
        case 'array':
            return Array.isArray(value)
        case 'object':
            return isPlainJsonObject(value)
    }
}

export type FieldFailure = 'unknown' | 'unusable' | 'reference' | 'theme' | 'null' | 'kind' | 'shape'

export type FieldCheck = { ok: true, value: JsonValue } | { ok: false, reason: FieldFailure }

/** The rule, then the entry checks, for an already rebuilt value of the database field `name`. */
function checkRebuilt(name: string, rule: FieldRule, value: JsonValue): FieldCheck {
    if (value === null) {
        return rule.nullable ? { ok: true, value } : { ok: false, reason: 'null' }
    }
    if (containsReference(value)) {
        return { ok: false, reason: 'reference' }
    }
    if (name === 'theme' && value === 'customHTML') {
        return { ok: false, reason: 'theme' }
    }
    if (!kindHolds(rule.kind, value)) {
        return { ok: false, reason: 'kind' }
    }
    if (typeof value === 'object') {
        if (name === 'fallbackModels' && !isFallbackModelsShape(value)) {
            return { ok: false, reason: 'shape' }
        }
        if (name === 'hotkeys' && !isHotkeysShape(value)) {
            return { ok: false, reason: 'shape' }
        }
    }
    return { ok: true, value }
}

const FIELD_RULES: ReadonlyMap<string, FieldRule> = new Map(Object.entries(SETTINGS_FIELD_RULES))
const PRESET_RULES: ReadonlyMap<string, FieldRule | 'omit' | 'meta'> = new Map(Object.entries(PRESET_FIELD_RULE))
const LIST_FIELDS: ReadonlySet<string> = new Set(LIST_FIELD_NAMES)

/**
 * The one check export and read share: rebuild, then the reference rule, the theme rule, the kind with its
 * nullability and the entry checks of the field. A field outside `SETTINGS_FIELDS` is `unknown`.
 */
export function checkField(key: string, value: unknown): FieldCheck {
    const rule = FIELD_RULES.get(key)
    if (rule === undefined) {
        return { ok: false, reason: 'unknown' }
    }
    const rebuilt = rebuildJson(value)
    return rebuilt === undefined ? { ok: false, reason: 'unusable' } : checkRebuilt(key, rule, rebuilt)
}

//#endregion

//#region lists

type ListResult<T> = { ok: true, entries: T[], dropped: string[] } | { ok: false, reason: string }

function isUsableId(value: JsonValue | undefined): value is string {
    return typeof value === 'string' && value !== ''
}

/**
 * A preset rebuilt from the fields that pass their rule; the ids of the whole list must be non-empty and distinct. A
 * field with the `omit` rule is dropped and counted on read; the export, whose source is a real preset that holds those
 * fields, leaves them out without naming them (`omitSilently`).
 */
export function readBotPresets(list: readonly unknown[], omitSilently = false): ListResult<JsonObject> {
    const entries: JsonObject[] = []
    const dropped: string[] = []
    const ids = new Set<string>()
    for (let at = 0; at < list.length; at++) {
        const raw = rebuildJson(list[at])
        if (!isPlainJsonObject(raw)) {
            return { ok: false, reason: `bot preset ${at} is not an object` }
        }
        const id = raw.id
        if (!isUsableId(id) || ids.has(id)) {
            return { ok: false, reason: `bot preset ${at} has no usable distinct id` }
        }
        ids.add(id)
        const preset: JsonObject = {}
        for (const [field, value] of Object.entries(raw)) {
            const rule = PRESET_RULES.get(field)
            if (rule === 'omit' && omitSilently) {
                continue
            }
            if (rule === undefined || rule === 'omit') {
                dropped.push(`botPresets[${at}].${field}`)
            } else if (rule === 'meta') {
                const holds = field === 'slot' ? typeof value === 'number' : typeof value === 'string'
                if (holds) {
                    preset[field] = value
                } else {
                    dropped.push(`botPresets[${at}].${field}`)
                }
            } else {
                const checked = checkRebuilt(presetDbName(field), rule, value)
                if (checked.ok) {
                    preset[field] = checked.value
                } else {
                    dropped.push(`botPresets[${at}].${field}`)
                }
            }
        }
        entries.push(preset)
    }
    return { ok: true, entries, dropped }
}

export function readFolders(list: readonly unknown[]): ListResult<PresetFolder> {
    const entries: PresetFolder[] = []
    const ids = new Set<string>()
    for (let at = 0; at < list.length; at++) {
        const raw = rebuildJson(list[at])
        if (!isPlainJsonObject(raw) || !isUsableId(raw.id) || typeof raw.name !== 'string' || ids.has(raw.id)) {
            return { ok: false, reason: `preset folder ${at} is not a distinct {id, name}` }
        }
        ids.add(raw.id)
        entries.push({ id: raw.id, name: raw.name })
    }
    return { ok: true, entries, dropped: [] }
}

/** A memory preset as carried: its settings are the known keys whose value has the default's type. */
export interface MemoryPresetRead {
    id: string
    name?: string
    settings: Record<string, string | number | boolean>
}

const HYPA_DEFAULTS: Record<string, string | number | boolean> = { ...createHypaV3Preset().settings }

export function readMemoryPresets(list: readonly unknown[]): ListResult<MemoryPresetRead> {
    const entries: MemoryPresetRead[] = []
    const dropped: string[] = []
    const ids = new Set<string>()
    for (let at = 0; at < list.length; at++) {
        const raw = rebuildJson(list[at])
        if (!isPlainJsonObject(raw) || !isUsableId(raw.id) || ids.has(raw.id)) {
            return { ok: false, reason: `memory preset ${at} has no usable distinct id` }
        }
        ids.add(raw.id)
        const entry: MemoryPresetRead = { id: raw.id, settings: {} }
        if (typeof raw.name === 'string') {
            entry.name = raw.name
        } else if (raw.name !== undefined) {
            dropped.push(`hypaV3Presets[${at}].name`)
        }
        const settings = raw.settings
        if (!isPlainJsonObject(settings)) {
            dropped.push(`hypaV3Presets[${at}].settings`)
        } else {
            for (const [key, value] of Object.entries(settings)) {
                const known = Object.hasOwn(HYPA_DEFAULTS, key)
                if (known && typeof value === typeof HYPA_DEFAULTS[key] && !containsReference(value)) {
                    entry.settings[key] = value as string | number | boolean
                } else {
                    dropped.push(`hypaV3Presets[${at}].settings.${key}`)
                }
            }
        }
        entries.push(entry)
    }
    return { ok: true, entries, dropped }
}

/**
 * A translator preset is exactly `{name, prompt, maxResponse}`; a bad entry is dropped and the rest are kept. `from`
 * holds the list position each kept entry had, so an index into the list can be carried across the drops.
 */
export function readTranslatorPresets(list: readonly unknown[]): { entries: TranslatorPreset[], from: number[], dropped: string[] } {
    const entries: TranslatorPreset[] = []
    const from: number[] = []
    const dropped: string[] = []
    for (let at = 0; at < list.length; at++) {
        const raw = rebuildJson(list[at])
        if (isPlainJsonObject(raw) && typeof raw.name === 'string' && typeof raw.prompt === 'string' && typeof raw.maxResponse === 'number') {
            entries.push({ name: raw.name, prompt: raw.prompt, maxResponse: raw.maxResponse })
            from.push(at)
        } else {
            dropped.push(`translatorPresets[${at}]`)
        }
    }
    return { entries, from, dropped }
}

//#endregion

//#region export side

export interface SettingsRecord {
    key: string
    value: JsonValue
}

/**
 * Where the export reads database values from. The value is the database's, typed as the database holds it; a field
 * the database lacks reads as `undefined` and is skipped.
 */
export interface SettingsSource {
    get<K extends keyof Database>(key: K): Database[K]
}

/**
 * The working preset fields of `source` in the shape `presetFromWorkingSettings` reads. The connection and endpoint
 * fields stay absent, so nothing that could carry a key or an address is ever asked of the source.
 */
export function presetSourceOf(source: SettingsSource): WorkingPresetSource {
    return {
        apiType: source.get('apiType'),
        localNetworkMode: source.get('localNetworkMode'),
        localNetworkTimeoutSec: source.get('localNetworkTimeoutSec'),
        mainPrompt: source.get('mainPrompt'),
        jailbreak: source.get('jailbreak'),
        globalNote: source.get('globalNote'),
        temperature: source.get('temperature'),
        maxContext: source.get('maxContext'),
        maxResponse: source.get('maxResponse'),
        frequencyPenalty: source.get('frequencyPenalty'),
        PresensePenalty: source.get('PresensePenalty'),
        formatingOrder: source.get('formatingOrder'),
        aiModel: source.get('aiModel'),
        subModel: source.get('subModel'),
        promptPreprocess: source.get('promptPreprocess'),
        bias: source.get('bias'),
        ooba: source.get('ooba'),
        ainconfig: source.get('ainconfig'),
        openrouterRequestModel: source.get('openrouterRequestModel'),
        proxyRequestModel: source.get('proxyRequestModel'),
        NAIsettings: source.get('NAIsettings'),
        autoSuggestPrompt: source.get('autoSuggestPrompt'),
        autoSuggestPrefix: source.get('autoSuggestPrefix'),
        autoSuggestClean: source.get('autoSuggestClean'),
        promptTemplate: source.get('promptTemplate'),
        NAIadventure: source.get('NAIadventure'),
        NAIappendName: source.get('NAIappendName'),
        localStopStrings: source.get('localStopStrings'),
        customProxyRequestModel: source.get('customProxyRequestModel'),
        reverseProxyOobaArgs: source.get('reverseProxyOobaArgs'),
        top_p: source.get('top_p'),
        promptSettings: source.get('promptSettings'),
        repetition_penalty: source.get('repetition_penalty'),
        min_p: source.get('min_p'),
        top_a: source.get('top_a'),
        openrouterProvider: source.get('openrouterProvider'),
        useInstructPrompt: source.get('useInstructPrompt'),
        customPromptTemplateToggle: source.get('customPromptTemplateToggle'),
        templateDefaultVariables: source.get('templateDefaultVariables'),
        moduleIntergration: source.get('moduleIntergration'),
        top_k: source.get('top_k'),
        instructChatTemplate: source.get('instructChatTemplate'),
        JinjaTemplate: source.get('JinjaTemplate'),
        jsonSchemaEnabled: source.get('jsonSchemaEnabled'),
        jsonSchema: source.get('jsonSchema'),
        strictJsonSchema: source.get('strictJsonSchema'),
        extractJson: source.get('extractJson'),
        groupOtherBotRole: source.get('groupOtherBotRole'),
        groupTemplate: source.get('groupTemplate'),
        seperateParametersEnabled: source.get('seperateParametersEnabled'),
        customAPIFormat: source.get('customAPIFormat'),
        systemContentReplacement: source.get('systemContentReplacement'),
        systemRoleReplacement: source.get('systemRoleReplacement'),
        customFlags: source.get('customFlags'),
        enableCustomFlags: source.get('enableCustomFlags'),
        presetRegex: source.get('presetRegex'),
        reasoningEffort: source.get('reasoningEffort'),
        thinkingTokens: source.get('thinkingTokens'),
        thinkingType: source.get('thinkingType'),
        deepseekThinkingType: source.get('deepseekThinkingType'),
        adaptiveThinkingEffort: source.get('adaptiveThinkingEffort'),
        deepseekReasoningEffort: source.get('deepseekReasoningEffort'),
        outputImageModal: source.get('outputImageModal'),
        seperateModelsForAxModels: source.get('seperateModelsForAxModels'),
        seperateModels: source.get('seperateModels'),
        fallbackModels: source.get('fallbackModels'),
        fallbackWhenBlankResponse: source.get('fallbackWhenBlankResponse'),
        seperateParameters: source.get('seperateParameters'),
        modelTools: source.get('modelTools'),
        verbosity: source.get('verbosity'),
        dynamicOutput: source.get('dynamicOutput'),
        doNotChangeSeperateModels: source.get('doNotChangeSeperateModels'),
    }
}

function inRange(index: unknown, length: number): index is number {
    return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < length
}

/**
 * The records of a settings file, one per carried key and sorted by key, and the keys (or nested paths) that were left
 * out because they fail the reader's own check or a side line refuses them. Nothing throws and nothing is written.
 * The selected bot preset is the working settings as `saveCurrentPreset` would save them, without saving them.
 */
export function buildSettingsRecords(source: SettingsSource): { records: SettingsRecord[], skipped: string[] } {
    const records: SettingsRecord[] = []
    const skipped: string[] = []
    const add = (key: string, value: JsonValue): boolean => {
        try {
            encodeSideLine(key, value, [])
        } catch (error) {
            if (error instanceof RtbSideValueError) {
                skipped.push(key)
                return false
            }
            throw error
        }
        records.push({ key, value })
        return true
    }

    for (const key of SETTINGS_FIELDS) {
        if (LIST_FIELDS.has(key)) {
            continue
        }
        const raw: unknown = source.get(key)
        if (raw === undefined) {
            continue
        }
        const checked = checkField(key, raw)
        if (!checked.ok) {
            skipped.push(key)
        } else {
            add(key, checked.value)
        }
    }

    const botList = source.get('botPresets')
    if (Array.isArray(botList)) {
        const list: unknown[] = [...botList]
        const selected = source.get('botPresetsId')
        if (inRange(selected, list.length) && typeof list[selected] === 'object' && list[selected] !== null) {
            list[selected] = savedPresetFor(presetSourceOf(source), botList[selected])
        }
        const read = readBotPresets(list, true)
        if (read.ok && add('botPresets', read.entries)) {
            skipped.push(...read.dropped)
            if (inRange(selected, read.entries.length)) {
                add('botPresetsId', selected)
            }
        } else if (!read.ok) {
            skipped.push('botPresets')
        }
    }

    const folders = source.get('presetFolders')
    if (Array.isArray(folders)) {
        const read = readFolders(folders)
        if (!read.ok) {
            skipped.push('presetFolders')
        } else {
            add('presetFolders', read.entries.map((folder): JsonValue => ({ id: folder.id, name: folder.name })))
        }
    }

    const memory = source.get('hypaV3Presets')
    if (Array.isArray(memory)) {
        const read = readMemoryPresets(memory)
        if (!read.ok) {
            skipped.push('hypaV3Presets')
        } else if (add('hypaV3Presets', read.entries.map(memoryPresetJson))) {
            skipped.push(...read.dropped)
            const selected = source.get('hypaV3PresetId')
            if (inRange(selected, read.entries.length)) {
                add('hypaV3PresetId', selected)
            }
        }
    }

    const translator = source.get('translatorPresets')
    if (Array.isArray(translator)) {
        const read = readTranslatorPresets(translator)
        if (add('translatorPresets', read.entries.map((entry): JsonValue => ({ ...entry })))) {
            skipped.push(...read.dropped)
            const selected = source.get('translatorPresetId')
            const kept = typeof selected === 'number' ? read.from.indexOf(selected) : -1
            if (kept >= 0) {
                add('translatorPresetId', kept)
            }
        }
    }

    records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return { records, skipped }
}

function memoryPresetJson(preset: MemoryPresetRead): JsonValue {
    const out: JsonObject = { id: preset.id }
    if (preset.name !== undefined) {
        out.name = preset.name
    }
    out.settings = { ...preset.settings }
    return out
}

//#endregion

//#region read side

/** The decoded lines of a settings file: the `settings/data.jsonl` values and the `side.ui-prefs` values, if any. */
export interface SettingsPayloadInput {
    values: readonly { key: string, value: unknown }[]
    uiPrefs?: readonly { key: string, value: unknown }[] | null
}

export interface SettingsRead {
    /** The carried non-list fields, each already checked. Never holds a list or its index. */
    fields: Partial<Record<(typeof SETTINGS_FIELDS)[number], JsonValue>>
    presets?: JsonObject[]
    /** The id of the preset the file selects. */
    selectionId?: string
    folders?: PresetFolder[]
    hypa?: MemoryPresetRead[]
    hypaSelectionId?: string
    translator?: TranslatorPreset[]
    translatorSelection?: TranslatorPreset
    uiPrefs: { key: string, value: string }[]
    /** What the file holds, before any merge. */
    counts: { fields: number, presets: number, memoryPresets: number, translatorPresets: number }
    /** Values left out: unknown keys, failed checks, dropped preset and entry fields. */
    dropped: number
}

export type SettingsReadResult = SettingsRead | { refused: string }

const UI_PREFS_SET: ReadonlySet<string> = new Set(UI_PREFS_KEYS)

/**
 * Turns decoded lines into the carried values, or refuses the file: a repeated key, or a preset list whose ids are
 * missing or repeated, makes the file unusable as a whole. A field that fails its check is dropped and counted, so
 * the device keeps its own value.
 */
export function readSettingsPayload(input: SettingsPayloadInput): SettingsReadResult {
    const seen = new Set<string>()
    for (const { key } of input.values) {
        if (seen.has(key)) {
            return { refused: `the key ${JSON.stringify(key)} appears more than once` }
        }
        seen.add(key)
    }

    const fields: SettingsRead['fields'] = {}
    let dropped = 0
    let presets: JsonObject[] | undefined
    let folders: PresetFolder[] | undefined
    let hypa: MemoryPresetRead[] | undefined
    let translator: TranslatorPreset[] | undefined
    const indices = new Map<string, JsonValue>()

    for (const { key, value } of input.values) {
        const rule = FIELD_RULES.get(key)
        if (rule === undefined) {
            dropped++
            continue
        }
        if (!LIST_FIELDS.has(key)) {
            const checked = checkField(key, value)
            if (checked.ok) {
                fields[key as keyof SettingsRead['fields']] = checked.value
            } else {
                dropped++
            }
            continue
        }
        // A list is checked entry by entry below; the reference rule over the whole list would drop every preset
        // because one names a custom model.
        const list = rebuildJson(value)
        if (list === undefined || !kindHolds(rule.kind, list)) {
            dropped++
            continue
        }
        if (key === 'botPresetsId' || key === 'hypaV3PresetId' || key === 'translatorPresetId') {
            indices.set(key, list)
        } else if (Array.isArray(list)) {
            if (key === 'botPresets') {
                const read = readBotPresets(list)
                if (read.ok === false) {
                    return { refused: read.reason }
                }
                presets = read.entries
                dropped += read.dropped.length
            } else if (key === 'presetFolders') {
                const read = readFolders(list)
                if (read.ok === false) {
                    return { refused: read.reason }
                }
                folders = read.entries
            } else if (key === 'hypaV3Presets') {
                const read = readMemoryPresets(list)
                if (read.ok === false) {
                    return { refused: read.reason }
                }
                hypa = read.entries
                dropped += read.dropped.length
            } else {
                const read = readTranslatorPresets(list)
                translator = read.entries
                dropped += read.dropped.length
            }
        }
    }

    const botIndex = indices.get('botPresetsId')
    const hypaIndex = indices.get('hypaV3PresetId')
    const translatorIndex = indices.get('translatorPresetId')
    const uiPrefs: SettingsRead['uiPrefs'] = []
    for (const { key, value } of input.uiPrefs ?? []) {
        if (UI_PREFS_SET.has(key) && typeof value === 'string') {
            uiPrefs.push({ key, value })
        } else {
            dropped++
        }
    }

    const result: SettingsRead = {
        fields,
        uiPrefs,
        counts: {
            fields: Object.keys(fields).length,
            presets: presets?.length ?? 0,
            memoryPresets: hypa?.length ?? 0,
            translatorPresets: translator?.length ?? 0,
        },
        dropped,
    }
    if (presets) {
        result.presets = presets
        if (presets && inRange(botIndex, presets.length)) {
            const id = presets[botIndex].id
            if (typeof id === 'string') {
                result.selectionId = id
            }
        }
    }
    if (folders) {
        result.folders = folders
    }
    if (hypa) {
        result.hypa = hypa
        if (inRange(hypaIndex, hypa.length)) {
            result.hypaSelectionId = hypa[hypaIndex].id
        }
    }
    if (translator) {
        result.translator = translator
        if (inRange(translatorIndex, translator.length)) {
            result.translatorSelection = translator[translatorIndex]
        }
    }
    return result
}

//#endregion

//#region merge

/** The device's seven list and index values, the only database values a restore plan reads. */
export interface DeviceLists {
    botPresets: readonly botPreset[]
    botPresetsId: number
    presetFolders?: readonly PresetFolder[]
    hypaV3Presets: readonly HypaV3Preset[]
    hypaV3PresetId: number
    translatorPresets: readonly TranslatorPreset[]
    translatorPresetId: number
}

export const DEVICE_LIST_KEYS = [
    'botPresets', 'botPresetsId', 'presetFolders', 'hypaV3Presets', 'hypaV3PresetId', 'translatorPresets', 'translatorPresetId',
] as const satisfies readonly (keyof Database)[]

export interface SettingsMergePlan {
    botPresets?: botPreset[]
    /** The merged position of the file's selected preset. */
    selectedIndex?: number
    presetFolders?: PresetFolder[]
    hypaV3Presets?: HypaV3Preset[]
    hypaIndex?: number
    translatorPresets?: TranslatorPreset[]
    translatorIndex?: number
    counts: { fields: number, presets: number, memoryPresets: number, translatorPresets: number, dropped: number }
}

function listOf<T>(value: readonly T[] | undefined): T[] {
    return Array.isArray(value) ? [...value] : []
}

/**
 * The preset a merged JSON object stands for. Every field of it passed its preset rule on read, or is the device's own
 * preset, so this is the one place a preset's JSON is given the preset type.
 */
function asBotPreset(preset: JsonObject): botPreset {
    return preset as unknown as botPreset
}

function sameTranslator(a: TranslatorPreset, b: TranslatorPreset): boolean {
    return a.name === b.name && a.prompt === b.prompt && a.maxResponse === b.maxResponse
}

/**
 * The lists after the file is merged into the device's: a same-id preset takes the file's fields over the device's,
 * a new id is appended with the file's id, and a device-only entry stays. Each index is remapped to the merged position
 * of the file's selection; without one the device's index stays, which merging by replacing and appending keeps valid.
 * The device side never refuses: a missing or malformed device list is an empty one.
 */
export function planSettingsMerge(device: DeviceLists, read: SettingsRead): SettingsMergePlan {
    const plan: SettingsMergePlan = {
        counts: {
            fields: read.counts.fields,
            presets: read.counts.presets,
            memoryPresets: read.counts.memoryPresets,
            translatorPresets: 0,
            dropped: read.dropped,
        },
    }

    if (read.presets) {
        const merged: botPreset[] = listOf(device.botPresets)
        for (const file of read.presets) {
            const at = merged.findIndex((preset) => preset?.id === file.id)
            if (at < 0) {
                merged.push(asBotPreset(file))
                continue
            }
            const base = rebuildJson(merged[at])
            const next: JsonObject = isPlainJsonObject(base) ? base : {}
            for (const [field, value] of Object.entries(file)) {
                next[field] = value
            }
            merged[at] = asBotPreset(next)
        }
        plan.botPresets = merged
        if (read.selectionId !== undefined) {
            const at = merged.findIndex((preset) => preset?.id === read.selectionId)
            if (at >= 0) {
                plan.selectedIndex = at
            }
        }
    }

    if (read.folders) {
        const merged: PresetFolder[] = listOf(device.presetFolders).map((folder) => ({ ...folder }))
        for (const file of read.folders) {
            const at = merged.findIndex((folder) => folder?.id === file.id)
            if (at < 0) {
                merged.push({ ...file })
            } else {
                merged[at] = { ...merged[at], name: file.name }
            }
        }
        plan.presetFolders = merged
    }

    if (read.hypa) {
        const merged: HypaV3Preset[] = listOf(device.hypaV3Presets)
        for (const file of read.hypa) {
            const at = merged.findIndex((preset) => preset?.id === file.id)
            const base = at < 0 ? undefined : merged[at]
            const settings: Record<string, string | number | boolean> = { ...base?.settings }
            for (const [key, value] of Object.entries(file.settings)) {
                settings[key] = value
            }
            const next = createHypaV3Preset(file.name ?? base?.name, settings)
            next.id = file.id
            if (at < 0) {
                merged.push(next)
            } else {
                merged[at] = next
            }
        }
        plan.hypaV3Presets = merged
        if (read.hypaSelectionId !== undefined) {
            const at = merged.findIndex((preset) => preset.id === read.hypaSelectionId)
            if (at >= 0) {
                plan.hypaIndex = at
            }
        }
    }

    if (read.translator) {
        const merged: TranslatorPreset[] = listOf(device.translatorPresets)
        let added = 0
        for (const file of read.translator) {
            if (!merged.some((entry) => entry && sameTranslator(entry, file))) {
                merged.push({ ...file })
                added++
            }
        }
        plan.translatorPresets = merged
        plan.counts.translatorPresets = added
        if (read.translatorSelection !== undefined) {
            const selection = read.translatorSelection
            const at = merged.findIndex((entry) => entry && sameTranslator(entry, selection))
            if (at >= 0) {
                plan.translatorIndex = at
            }
        }
    }

    return plan
}

//#endregion
