import type { JsonObject, JsonValue } from '../../blockFrame'
import type { ContentBody } from '../format'
import { CodecAssembleError } from './types'

/**
 * Bodies of the content units (types 4, 5, 6, 9, 11 to 14, 16 to 18). The
 * format module fixes only the frame and `{ v }`; the shapes here are this
 * build's choice and are amendable until the format freeze. Every body is
 * `{ v: 1, ... }` and holds fields verbatim, so a field the build does not know
 * travels in `f` (or the named bag) and comes back.
 */

/** Database fields that live outside the config root; every other field, known or not, is in it. */
export const CONFIG_PARTITIONED_FIELDS = [
    'characters', 'botPresets', 'plugins', 'pluginV2', 'modules', 'pluginCustomStorage', 'characterOrder', 'loadouts', 'statics',
] as const

/** The two plugin lists of a database; each plugin is one unit that names its list. */
export const PLUGIN_LISTS = ['plugins', 'pluginV2'] as const
export type PluginList = typeof PLUGIN_LISTS[number]

/** Character fields that live in the lore unit and in the scripts unit. */
export const LORE_FIELDS = ['globalLore'] as const
export const SCRIPT_FIELDS = ['customscript', 'triggerscript'] as const

/** Derived at load, never stored (see `RESIDUAL_NORMALISATIONS`). */
export const DERIVED_COLD_FIELDS = ['coldstorage', 'coldStoragedChats', 'coldVersion', 'coldChatCount'] as const
/** Volatile character fields, never stored. */
export const VOLATILE_CHARACTER_FIELDS = ['reloadKeys'] as const

/**
 * Character fields that change often and live in the shard entry instead of the
 * core, so a chat switch or a send rewrites a shard and not a core of up to
 * several MiB. A field moves only when its value fits the entry; any other value
 * stays in the core (see `splitMovedFields`).
 */
export const ENTRY_MOVED_FIELDS = ['lastInteraction', 'trashTime', 'chatPage', 'firstMsgIndex'] as const
/** Moved fields the entry cannot leave out: an absent one is recorded in the core's `a` list. */
export const ENTRY_REQUIRED_MOVED_FIELDS = ['chatPage', 'firstMsgIndex'] as const

export interface ConfigBody { v: 1, f: JsonObject }
export interface StaticsBody { v: 1, value?: JsonValue }
/** `chars` lists the entity id `u` of every character in `Database.characters` order. */
export interface OrderBody { v: 1, chars: string[], characterOrder?: JsonValue }
export interface LoadoutsBody { v: 1, items: JsonValue[] }
export interface PresetBody { v: 1, preset: JsonObject }
export interface PluginBody { v: 1, list: PluginList, plugin: JsonObject }
export interface PluginValueBody { v: 1, value: JsonValue }
export interface ModuleBody { v: 1, module: JsonObject }
/** `f` the character fields not held elsewhere; `a` the required moved fields the source did not have. */
export interface CharacterCoreBody { v: 1, f: JsonObject, a?: string[] }
export interface FieldBagBody { v: 1, f: JsonObject }

function field(body: ContentBody, name: string, where: string): JsonValue {
    const value = body[name]
    if (value === undefined) {
        throw new CodecAssembleError(`${where} has no "${name}".`)
    }
    return value
}

export function readObjectField(body: ContentBody, name: string, where: string): JsonObject {
    const value = field(body, name, where)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new CodecAssembleError(`${where}.${name} is not an object.`)
    }
    return value
}

export function readListField(body: ContentBody, name: string, where: string): JsonValue[] {
    const value = field(body, name, where)
    if (!Array.isArray(value)) {
        throw new CodecAssembleError(`${where}.${name} is not a list.`)
    }
    return value
}

export function readStringListField(body: ContentBody, name: string, where: string): string[] {
    return readListField(body, name, where).map((item, index) => {
        if (typeof item !== 'string') {
            throw new CodecAssembleError(`${where}.${name}[${index}] is not a string.`)
        }
        return item
    })
}

export function readStringField(body: ContentBody, name: string, where: string): string {
    const value = field(body, name, where)
    if (typeof value !== 'string') {
        throw new CodecAssembleError(`${where}.${name} is not a string.`)
    }
    return value
}

/** The `a` list of a character core: absent means none. */
export function readAbsentList(body: ContentBody, where: string): string[] {
    return body.a === undefined ? [] : readStringListField(body, 'a', where)
}
