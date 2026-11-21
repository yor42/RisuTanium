import type { JsonObject, JsonValue } from '../../blockFrame'
import { isJsonObject, sameJsonValue } from '../codec'
import type { Decision } from './delta'

/**
 * The two records whose fields are copied from a list slot when the selection changes: the bot preset record and the
 * persona record. Each is the list, the selected index and the working fields; the rule below decides a peer's change
 * to a record whole, so a hand edit on either side still asks.
 */

/**
 * The database fields `setPreset` writes: the settings a bot preset copies into the working settings. With
 * `botPresetsId` and the list itself they make the preset record. Pinned to `setPreset` by a test, so a field it gains
 * is not merged field by field behind the record's back.
 */
export const PRESET_RECORD_FIELDS = [
    'apiType', 'localNetworkMode', 'localNetworkTimeoutSec', 'mainPrompt', 'jailbreak', 'globalNote', 'temperature',
    'maxContext', 'maxResponse', 'frequencyPenalty', 'PresensePenalty', 'formatingOrder', 'aiModel', 'subModel',
    'currentPluginProvider', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'promptPreprocess',
    'bias', 'koboldURL', 'proxyConnectionId', 'ooba', 'ainconfig', 'openrouterRequestModel', 'proxyRequestModel', 'NAIsettings',
    'autoSuggestPrompt', 'autoSuggestPrefix', 'autoSuggestClean', 'promptTemplate', 'NAIadventure', 'NAIappendName',
    'localStopStrings', 'customProxyRequestModel', 'reverseProxyOobaArgs', 'top_p', 'promptSettings', 'repetition_penalty',
    'min_p', 'top_a', 'openrouterProvider', 'useInstructPrompt', 'customPromptTemplateToggle', 'templateDefaultVariables',
    'moduleIntergration', 'top_k', 'instructChatTemplate', 'JinjaTemplate', 'jsonSchemaEnabled', 'jsonSchema',
    'strictJsonSchema', 'extractJson', 'groupOtherBotRole', 'groupTemplate', 'seperateParametersEnabled', 'customAPIFormat',
    'systemContentReplacement', 'systemRoleReplacement', 'customFlags', 'enableCustomFlags', 'presetRegex', 'reasoningEffort',
    'thinkingTokens', 'thinkingType', 'deepseekThinkingType', 'adaptiveThinkingEffort', 'deepseekReasoningEffort',
    'outputImageModal', 'seperateModelsForAxModels', 'seperateModels', 'fallbackModels', 'fallbackWhenBlankResponse',
    'seperateParameters', 'modelTools', 'verbosity', 'dynamicOutput',
] as const

/** The persona fields `changeUserPersona` copies from a slot, and `saveUserPersona` copies into one. */
export const PERSONA_RECORD_FIELDS = ['username', 'userIcon', 'personaPrompt', 'userNote'] as const

/** One side of a switchable record: the list, the selected index and the working fields (plain JSON, absent fields left out). */
export interface SwitchSide {
    list: readonly JsonValue[]
    id: JsonValue | undefined
    working: JsonObject
}

/** What a selection change does to the record; the preset record's is `setPreset` and `presetFromWorkingSettings`, in plain JSON. */
export interface SwitchOps {
    /** The slot after the working fields are saved into it (the save-on-switch of the slot being left). */
    saveInto(working: JsonObject, slot: JsonObject): JsonObject
    /** The working fields after the selection moves to `slot`, from the working fields before. */
    apply(working: JsonObject, slot: JsonObject): JsonObject
}

/** `base` with each patch field set, and a field whose value is undefined left out, as the plain JSON of the database leaves it. */
function withFields(base: JsonObject, patch: Readonly<Record<string, JsonValue | undefined>>): JsonObject {
    const out: JsonObject = { ...base }
    for (const [name, value] of Object.entries(patch)) {
        if (value === undefined) {
            delete out[name]
        } else {
            Object.defineProperty(out, name, { value, enumerable: true, writable: true, configurable: true })
        }
    }
    return out
}

/** The persona record's operations (persona.ts `saveUserPersona` and `changeUserPersona`). */
export const PERSONA_OPS: SwitchOps = {
    saveInto: (working, slot) => withFields(slot, {
        name: working.username, icon: working.userIcon, personaPrompt: working.personaPrompt, note: working.userNote,
    }),
    apply: (working, slot) => withFields(working, {
        personaPrompt: slot.personaPrompt, username: slot.name, userIcon: slot.icon, userNote: slot.note,
    }),
}

function sameSide(a: SwitchSide, b: SwitchSide): boolean {
    return sameJsonValue(a.list, b.list) && sameJsonValue(a.id, b.id) && sameJsonValue(a.working, b.working)
}

function slotAt(list: readonly JsonValue[], index: JsonValue | undefined): JsonObject | null {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= list.length) {
        return null
    }
    const slot = list[index]
    return isJsonObject(slot) ? slot : null
}

/**
 * Whether `side` is exactly what one selection change from `base` leaves: another slot selected, the list equal
 * everywhere except the slot that was left (which holds either its old content, or the base working fields saved into
 * it), and the working fields what the switch copies from the new slot.
 */
export function cleanSwitch(side: SwitchSide, base: SwitchSide, ops: SwitchOps): boolean {
    const left = slotAt(base.list, base.id)
    const entered = slotAt(side.list, side.id)
    if (left === null || entered === null || sameJsonValue(side.id, base.id) || side.list.length !== base.list.length) {
        return false
    }
    const leftAt = base.id as number
    for (let index = 0; index < base.list.length; index++) {
        if (index !== leftAt && !sameJsonValue(side.list[index], base.list[index])) {
            return false
        }
    }
    const after = side.list[leftAt]
    if (!sameJsonValue(after, left) && !(isJsonObject(after) && sameJsonValue(after, ops.saveInto(base.working, left)))) {
        return false
    }
    return sameJsonValue(side.working, ops.apply(base.working, entered))
}

/**
 * A switchable record, decided whole.
 * - Only the peer changed it: take it (view state: `defer` while a reply is being sent).
 * - Only this page changed it, or neither: keep.
 * - Both changed, and each is a clean selection change with the same resulting list: keep this page's (the last saved
 *   switch wins).
 * - Anything else, including a hand edit on either side: park.
 */
export function decideSwitch(base: SwitchSide, mine: SwitchSide, theirs: SwitchSide, ops: SwitchOps): Decision<SwitchSide> {
    const mineChanged = !sameSide(mine, base)
    if (sameSide(theirs, base)) {
        return { kind: 'keep' }
    }
    if (!mineChanged) {
        return { kind: 'take', value: theirs, defer: true }
    }
    if (cleanSwitch(mine, base, ops) && cleanSwitch(theirs, base, ops) && sameJsonValue(mine.list, theirs.list)) {
        return { kind: 'keep' }
    }
    return { kind: 'park', reason: 'both-changed' }
}

/** What one answer chooses. `both` keeps this page's version and keeps the peer's one too (a copy of a chat, or a restore point). */
export type ConflictChoice = 'mine' | 'theirs' | 'both'

/** What a conflict row names, as data: the dialog turns it into text in the person's language. */
export type ConflictLabel =
    | { kind: 'setting', name: string }
    | { kind: 'presets' | 'personas' | 'loadouts' }
    | { kind: 'core' | 'lore' | 'scripts' | 'whole' | 'deletedThere' | 'deletedHere', character: string }
    | { kind: 'chat' | 'chatDeletedThere' | 'chatDeletedHere', character: string, chat: string }

/** One record both sides changed (or one side removed and the other changed). */
export interface ConflictRecord {
    /** `config:<field>`, `presets`, `personas`, `loadouts`, `char:<chaId>:core|lore|scripts|whole|deletedThere|deletedHere`, `char:<chaId>:chat:<cid>[:deletedThere|:deletedHere]`. */
    id: string
    label: ConflictLabel
    /** Three choices, or two for a record one side deleted (keep the edited version, or take the deletion). */
    choices: readonly ConflictChoice[]
    /** What keep both does: a copy of the chat, or the peer's version kept as a restore point; null where it is not offered. */
    keepBoth: 'copy' | 'restore-point' | null
    preselect: ConflictChoice
    /** Content fingerprints of both sides: an answer applies only while both still match. */
    fingerprint: { mine: string, theirs: string }
    /** The reason the page parks with where it cannot ask. */
    legacy: string
}

export interface ConflictAnswer {
    choice: ConflictChoice
    fingerprint: { mine: string, theirs: string }
}

/** The answers of a resolution, by record id. */
export type ConflictAnswers = ReadonlyMap<string, ConflictAnswer>

/** A 53-bit content hash of a plain value's JSON text, for fingerprints of values that carry no unit digest. */
export function valueFingerprint(value: JsonValue | undefined): string {
    const text = value === undefined ? 'undefined' : JSON.stringify(value)
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index)
        h1 = Math.imul(h1 ^ code, 2654435761)
        h2 = Math.imul(h2 ^ code, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return `h:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}:${text.length}`
}

/**
 * The answer of `answers` that applies to `record`: the id matches and both fingerprints still equal the current ones.
 * A changed record is asked again.
 */
export function answerFor(answers: ConflictAnswers | undefined, record: ConflictRecord): ConflictChoice | undefined {
    const answer = answers?.get(record.id)
    if (answer === undefined || answer.fingerprint.mine !== record.fingerprint.mine || answer.fingerprint.theirs !== record.fingerprint.theirs) {
        return undefined
    }
    return record.choices.includes(answer.choice) ? answer.choice : undefined
}
