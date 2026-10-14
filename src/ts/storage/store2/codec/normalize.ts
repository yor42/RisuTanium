import type { JsonObject, JsonValue } from '../../blockFrame'
import { CodecInputError } from './types'

/**
 * The residual normalisations of the codec. Each is applied once, when a live
 * value is split into units, and an assembled tree already satisfies it, so
 * splitting an assembled tree gives the same unit bytes (the stability the
 * format needs for "an unchanged unit writes nothing").
 */
export const RESIDUAL_NORMALISATIONS = {
    /** What `JSON.stringify` drops or rewrites: an `undefined`, function or symbol property is absent; in an array it becomes null; NaN and the infinities become null; -0 becomes 0; `toJSON` (a `Date`) is applied. */
    jsonPlain: 'json-plain',
    /** Never stored, always absent after assemble: chat `isStreaming` and `activeStreamingDisplayOptimizationMode`, and character `reloadKeys`. */
    volatileStripped: 'volatile-stripped',
    /** `coldstorage`, `coldStoragedChats`, `coldVersion`, `coldChatCount` on a character that is not a stub are not stored (they are derived at load). */
    derivedColdStripped: 'derived-cold-stripped',
    /** An absent or null list comes back as an empty one: character `chats`, a chat's `message`, `modules`, `loadouts`, `plugins`, `pluginV2`; an absent or null `pluginCustomStorage` comes back as `{}`. */
    absentListEmpty: 'absent-list-empty',
} as const

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Writes an own data property even for the key `__proto__`, which plain assignment would turn into a prototype change. */
export function defineOwn(target: JsonObject, key: string, value: JsonValue): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/**
 * The value as `JSON.parse(JSON.stringify(value))` would give it, without the
 * round trip through a string; `undefined` where JSON would omit the value. A
 * `bigint` and a cycle are refused, as `JSON.stringify` refuses them.
 */
export function toPlainJson(value: unknown): JsonValue | undefined {
    return plainValue(value, [], false)
}

function plainValue(value: unknown, ancestors: object[], skipToJson: boolean): JsonValue | undefined {
    if (value === null) {
        return null
    }
    switch (typeof value) {
        case 'boolean':
        case 'string':
            return value
        case 'number':
            return Number.isFinite(value) ? (value === 0 ? 0 : value) : null
        case 'undefined':
        case 'function':
        case 'symbol':
            return undefined
        case 'bigint':
            throw new CodecInputError('A bigint cannot be stored as JSON.')
        default:
            break
    }
    const source = value as object
    if (!skipToJson) {
        const toJson = (source as { toJSON?: unknown }).toJSON
        if (typeof toJson === 'function') {
            return plainValue(toJson.call(source), ancestors, true)
        }
    }
    if (source instanceof Number || source instanceof String || source instanceof Boolean) {
        return plainValue(source.valueOf(), ancestors, true)
    }
    if (ancestors.includes(source)) {
        throw new CodecInputError('A cyclic value cannot be stored as JSON.')
    }
    ancestors.push(source)
    let out: JsonValue
    if (Array.isArray(source)) {
        const list: JsonValue[] = []
        for (let i = 0; i < source.length; i++) {
            const item = plainValue(source[i], ancestors, false)
            list.push(item === undefined ? null : item)
        }
        out = list
    } else {
        const bag: JsonObject = {}
        const record = source as Record<string, unknown>
        for (const key of Object.keys(record)) {
            const item = plainValue(record[key], ancestors, false)
            if (item !== undefined) {
                defineOwn(bag, key, item)
            }
        }
        out = bag
    }
    ancestors.pop()
    return out
}

/** `source` as a plain JSON object, or a `CodecInputError` naming `where`. */
export function plainObject(value: unknown, where: string): JsonObject {
    const plain = toPlainJson(value)
    if (!isJsonObject(plain)) {
        throw new CodecInputError(`${where} is not an object.`)
    }
    return plain
}

/** An absent or null list is empty; anything else that is not a list is refused. */
export function listOrEmpty(value: unknown, where: string): unknown[] {
    if (value === undefined || value === null) {
        return []
    }
    if (!Array.isArray(value)) {
        throw new CodecInputError(`${where} is not a list.`)
    }
    return value
}

/** A copy of `source` without the named fields; every other field, known or not, is kept. */
export function omitFields(source: JsonObject, names: readonly string[]): JsonObject {
    const out: JsonObject = {}
    for (const key of Object.keys(source)) {
        if (!names.includes(key)) {
            defineOwn(out, key, source[key])
        }
    }
    return out
}

/** A copy of `source` with only the named fields that are present. */
export function pickFields(source: JsonObject, names: readonly string[]): JsonObject {
    const out: JsonObject = {}
    for (const key of names) {
        if (Object.hasOwn(source, key)) {
            defineOwn(out, key, source[key])
        }
    }
    return out
}

/** UTF-8 length of well-formed text (canonical JSON never holds a lone surrogate). */
export function utf8Length(text: string): number {
    let bytes = 0
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        if (unit < 0x80) {
            bytes += 1
        } else if (unit < 0x800) {
            bytes += 2
        } else if (unit >= 0xD800 && unit <= 0xDBFF) {
            bytes += 4
            i++
        } else {
            bytes += 3
        }
    }
    return bytes
}
