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
    'currentPluginProvider', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'forceReplaceUrl', 'promptPreprocess',
    'bias', 'koboldURL', 'proxyKey', 'ooba', 'ainconfig', 'openrouterRequestModel', 'proxyRequestModel', 'NAIsettings',
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
