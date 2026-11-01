import { language } from 'src/lang'
import type { JsonObject } from '../../storage/blockFrame'
import { isJsonObject, toPlainJson } from '../../storage/store2/codec/normalize'

/**
 * A saved Utility task preset. These are the fields this build reads; the stored object is open, so a key it does not
 * know (a later build's) survives load, an edit of another field, a save and a page import. Nothing here rebuilds a
 * preset from this interface.
 */
export interface TaskPreset {
    id: string
    name: string
    instructions: string
    /** The model id the run is pinned to. */
    model: string
    /** A request value from 0 to 2; absent means the global setting. */
    temperature?: number
    /** The response token limit; absent means the global setting. */
    maxTokens?: number
}

export const TASK_PRESET_TEMPERATURE_MAX = 2

/**
 * The problems with the R1 fields of `value`, one message per problem; an empty list means usable. It reads only and
 * never builds a new object, so it cannot drop a key it does not know.
 */
export function validateTaskPreset(value: unknown): string[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [language.utility.problemNotObject]
    }
    const record = value as Record<string, unknown>
    const errors: string[] = []
    for (const name of ['id', 'name', 'instructions', 'model'] as const) {
        if (typeof record[name] !== 'string') {
            errors.push(language.utility.problemNotString(name))
        }
    }
    const temperature = record.temperature
    if (temperature !== undefined && (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > TASK_PRESET_TEMPERATURE_MAX)) {
        errors.push(language.utility.problemTemperature(TASK_PRESET_TEMPERATURE_MAX))
    }
    const maxTokens = record.maxTokens
    if (maxTokens !== undefined && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1)) {
        errors.push(language.utility.problemMaxTokens)
    }
    return errors
}

/**
 * The page's live task presets as plain objects for a `.bin` import. It reads through a reactive proxy and returns a
 * copy that is structured-cloneable, does not follow later edits and keeps every key. An absent or non-list value gives
 * none, and an item that is not an object is left out.
 */
export function importableTaskPresets(value: unknown): JsonObject[] {
    const plain = toPlainJson(value)
    if (!Array.isArray(plain)) {
        return []
    }
    return plain.filter(isJsonObject)
}
