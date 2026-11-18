import { v4 as uuidv4 } from 'uuid'
import type { Database } from '../../storage/database.svelte'
import { DEFAULT_RECENCY_HALF_LIFE_DAYS } from './hypaRecency'

export interface HypaV3Preset {
    id: string;
    name: string;
    settings: HypaV3Settings;
}

export interface HypaV3Settings {
    summarizationModel: string;
    summarizationPrompt: string;
    reSummarizationPrompt: string;
    memoryTokensRatio: number;
    extraSummarizationRatio: number;
    maxChatsPerSummary: number;
    recentMemoryRatio: number;
    similarMemoryRatio: number;
    enableSimilarityCorrection: boolean;
    preserveOrphanedMemory: boolean;
    processRegexScript: boolean;
    doNotSummarizeUserMessage: boolean;
    summaryChunkSeparator: string;
    enableRecencyWeighting: boolean;
    recencyHalfLifeDays: number;
    // Experimental
    useExperimentalImpl: boolean;
    summarizationRequestsPerMinute: number;
    summarizationMaxConcurrent: number;
    embeddingRequestsPerMinute: number;
    embeddingMaxConcurrent: number;
    alwaysToggleOn: boolean;
    queryChatCount: number;
}

type PresetFields = Pick<Database, 'hypaV3Presets' | 'hypaV3PresetId'>

/** Tolerance for float noise in ratio sums such as 0.8 + (1 - 0.8). */
const RATIO_EPSILON = 1e-9

/**
 * A new preset always gets a fresh id. The id is persisted with the preset and
 * nothing else refers to it, so it only has to be unique inside one list.
 */
export function createHypaV3Preset(
    name = "New Preset",
    existingSettings = {}
): HypaV3Preset {
    const settings: HypaV3Settings = {
        summarizationModel: "subModel",
        summarizationPrompt: "",
        reSummarizationPrompt: "",
        memoryTokensRatio: 0.2,
        extraSummarizationRatio: 0,
        maxChatsPerSummary: 6,
        recentMemoryRatio: 0.4,
        similarMemoryRatio: 0.4,
        enableSimilarityCorrection: false,
        preserveOrphanedMemory: false,
        processRegexScript: false,
        doNotSummarizeUserMessage: false,
        summaryChunkSeparator: "\\n\\n",
        enableRecencyWeighting: false,
        recencyHalfLifeDays: DEFAULT_RECENCY_HALF_LIFE_DAYS,
        // Experimental
        useExperimentalImpl: false,
        summarizationRequestsPerMinute: 20,
        summarizationMaxConcurrent: 1,
        embeddingRequestsPerMinute: 100,
        embeddingMaxConcurrent: 1,
        alwaysToggleOn: false,
        queryChatCount: 3,
    };

    if (
        existingSettings &&
        typeof existingSettings === "object" &&
        !Array.isArray(existingSettings)
    ) {
        for (const [key, value] of Object.entries(existingSettings)) {
            if (Object.hasOwn(settings, key) && typeof value === typeof settings[key]) {
                settings[key] = value;
            }
        }
    }

    return {
        id: uuidv4(),
        name,
        settings,
    };
}

/** An id not in `used`; a constant generator still terminates through the counter. */
function mintId(used: Set<string>): string {
    const base = uuidv4()
    let candidate = base
    for (let n = 1; used.has(candidate); n++) {
        candidate = `${base}-${n}`
    }
    return candidate
}

/**
 * Load-time normalization of the preset list; runs on every `setDatabase`.
 * Keeps order, keeps an existing unique non-empty id and mints the rest.
 * Repairs only what the runtime cannot use: an empty list (one Default preset)
 * and an active index that names no list element (0). An index that does name
 * an element, such as the string "1", becomes that element's number, so it
 * keeps pointing at the same preset. Idempotent.
 */
export function normalizeHypaV3Presets(
    data: Pick<Database, 'hypaV3Presets' | 'hypaV3PresetId' | 'hypaV3Settings' | 'supaMemoryPrompt'>
): void {
    if (!Array.isArray(data.hypaV3Presets) || data.hypaV3Presets.length === 0) {
        data.hypaV3Presets = [
            createHypaV3Preset("Default", {
                summarizationPrompt: data.supaMemoryPrompt ? data.supaMemoryPrompt : "",
                ...data.hypaV3Settings
            })
        ]
    }

    const used = new Set<string>()
    data.hypaV3Presets = data.hypaV3Presets.map((preset, i) => {
        const created = createHypaV3Preset(
            preset?.name || `Preset ${i + 1}`,
            preset?.settings || {}
        )
        const kept = preset?.id
        created.id = typeof kept === 'string' && kept !== '' && !used.has(kept)
            ? kept
            : mintId(used)
        used.add(created.id)
        return created
    })

    const length = data.hypaV3Presets.length
    const active = String(data.hypaV3PresetId)
    let resolved = 0
    for (let i = 0; i < length; i++) {
        if (String(i) === active) {
            resolved = i
            break
        }
    }
    if (data.hypaV3PresetId !== resolved) {
        data.hypaV3PresetId = resolved
    }
}

function indexOfPresetId(db: PresetFields, id: string | undefined): number {
    if (typeof id !== 'string' || id === '') return -1
    return db.hypaV3Presets.findIndex((preset) => preset.id === id)
}

function activeIndexOf(db: PresetFields): number {
    return Number(db.hypaV3PresetId)
}

export function findHypaV3Preset(db: PresetFields, id: string | undefined): HypaV3Preset | undefined {
    const index = indexOfPresetId(db, id)
    return index < 0 ? undefined : db.hypaV3Presets[index]
}

export function selectHypaV3Preset(db: PresetFields, id: string | undefined): boolean {
    const index = indexOfPresetId(db, id)
    if (index < 0) return false
    db.hypaV3PresetId = index
    return true
}

export function renameHypaV3Preset(db: PresetFields, id: string | undefined, name: string): boolean {
    const preset = findHypaV3Preset(db, id)
    if (!preset) return false
    preset.name = name
    return true
}

/** Appends a new default preset and selects it; a blank name is refused. */
export function addHypaV3Preset(db: PresetFields, name: string): HypaV3Preset | undefined {
    const trimmed = name.trim()
    if (trimmed === '') return undefined
    const preset = createHypaV3Preset(trimmed)
    db.hypaV3Presets.push(preset)
    db.hypaV3PresetId = db.hypaV3Presets.length - 1
    return preset
}

/** Independent copy (new id, own settings) appended after the last preset and selected. */
export function duplicateHypaV3Preset(db: PresetFields, id: string | undefined, name: string): HypaV3Preset | undefined {
    const source = findHypaV3Preset(db, id)
    const trimmed = name.trim()
    if (!source || trimmed === '') return undefined
    const copy = createHypaV3Preset(trimmed, source.settings)
    db.hypaV3Presets.push(copy)
    db.hypaV3PresetId = db.hypaV3Presets.length - 1
    return copy
}

/**
 * Removes the preset. The last preset is refused. Deleting the active preset
 * selects 0; deleting an earlier one shifts the index so the active preset
 * stays active.
 */
export function deleteHypaV3Preset(db: PresetFields, id: string | undefined): boolean {
    const index = indexOfPresetId(db, id)
    if (index < 0 || db.hypaV3Presets.length <= 1) return false
    const active = activeIndexOf(db)
    db.hypaV3Presets.splice(index, 1)
    if (index === active) {
        db.hypaV3PresetId = 0
    } else if (index < active) {
        db.hypaV3PresetId = active - 1
    }
    return true
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0
    return value > 1 ? 1 : value
}

export type HypaV3RatioEdit = 'recent' | 'similar' | 'memoryTokens'

type RatioFields = Pick<HypaV3Settings, 'recentMemoryRatio' | 'similarMemoryRatio' | 'memoryTokensRatio' | 'extraSummarizationRatio'>

function setIfChanged(settings: RatioFields, key: keyof RatioFields, value: number): void {
    if (settings[key] !== value) {
        settings[key] = value
    }
}

/**
 * Brings the ratios into their valid shape: each in [0,1] (NaN and negatives
 * become 0), recent + similar <= 1, extra <= 1 - memoryTokens. When the pair
 * exceeds 1 the ratio that was not edited yields; when `memoryTokens` was
 * edited neither pair member was, and similar yields. Extra always yields to
 * memoryTokens. A field is written only when its value changes, so effects
 * that call this settle.
 */
export function clampHypaV3Ratios(settings: RatioFields, edited: HypaV3RatioEdit): void {
    setIfChanged(settings, 'memoryTokensRatio', clamp01(settings.memoryTokensRatio))
    setIfChanged(settings, 'recentMemoryRatio', clamp01(settings.recentMemoryRatio))
    setIfChanged(settings, 'similarMemoryRatio', clamp01(settings.similarMemoryRatio))

    const recent = settings.recentMemoryRatio
    const similar = settings.similarMemoryRatio
    if (recent + similar > 1 + RATIO_EPSILON) {
        if (edited === 'similar') {
            setIfChanged(settings, 'recentMemoryRatio', 1 - similar)
        } else {
            setIfChanged(settings, 'similarMemoryRatio', 1 - recent)
        }
    }

    const cap = 1 - settings.memoryTokensRatio
    const extra = clamp01(settings.extraSummarizationRatio)
    setIfChanged(settings, 'extraSummarizationRatio', extra > cap + RATIO_EPSILON ? cap : extra)
}

export type HypaV3PresetFileResult =
    | { ok: true, preset: HypaV3Preset }
    | { ok: false, reason: 'broken' | 'foreign' }

function isPlainObject(value: object | string | number | boolean | null | undefined): value is Record<string, object | string | number | boolean | null | undefined> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads an exported preset file. `broken` means the JSON does not parse;
 * `foreign` means it is not a RisuAI preset export or holds no usable HypaV3
 * setting. The file's id is never used. Ratios are clamped with `similar` as
 * the edited field, which makes `recent` yield: a file has no edited field, so
 * this choice is arbitrary.
 */
export function parseHypaV3PresetFile(bytes: Uint8Array): HypaV3PresetFileResult {
    let parsed: object | null
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
        return { ok: false, reason: 'broken' }
    }
    if (!isPlainObject(parsed) || parsed.type !== 'risu') {
        return { ok: false, reason: 'foreign' }
    }
    const data = parsed.data
    if (!isPlainObject(data) || !isPlainObject(data.settings)) {
        return { ok: false, reason: 'foreign' }
    }
    const defaults: Record<string, string | number | boolean> = { ...createHypaV3Preset().settings }
    const usable = Object.entries(data.settings).some(
        ([key, value]) => Object.hasOwn(defaults, key) && typeof value === typeof defaults[key]
    )
    if (!usable) {
        return { ok: false, reason: 'foreign' }
    }
    const name = typeof data.name === 'string' && data.name !== '' ? data.name : 'Imported Preset'
    const preset = createHypaV3Preset(name, data.settings)
    clampHypaV3Ratios(preset.settings, 'similar')
    return { ok: true, preset }
}

/** The export file shape: never carries the preset id. */
export function hypaV3PresetFileOf(preset: HypaV3Preset): {
    type: 'risu', ver: 1, data: { name: string, settings: HypaV3Settings }
} {
    return {
        type: 'risu',
        ver: 1,
        data: { name: preset.name, settings: preset.settings },
    }
}
