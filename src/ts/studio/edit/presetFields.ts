// The adapter table of the preset session owner: for every path of the preset kind's set row, which `botPreset` slot
// property and which working (`db`) property hold it, where it sits inside a container, what an absent value reads as,
// and which values the form may offer. The table is pure data plus pure functions; the routing between the slot
// and the working copy lives in presetTarget.ts.

import type { PromptSettings } from '../../process/prompt'
import type { Database, DynamicOutput, botPreset } from '../../storage/database.svelte'
import { valueMatchesKind } from '../history/fieldAccess'
import type { SESSION_OWNER_KINDS } from '../history/sessionKinds'

// Every path of the preset kind's set row; the table below holds exactly these (a missing or extra row fails
// `pnpm check`).
export type PresetPath = (typeof SESSION_OWNER_KINDS.preset.setPaths)[number]

// What a missing, null or wrong-typed value reads as:
// - `{ default }`: the constant `setPreset` assigns, so the form shows what switching to the preset produces.
// - `keeps`: `setPreset` keeps the working value (`?? db.x`), so the slot has no own value; reads not set. A
//   `{ had: false }` write onto the active copy is refused, because the working copy never loses a required setting.
// - `notSet`: a plain copy or an optional container key; the absence is the value (off) and may be written back.
export type PresetAbsent = { readonly default: string | boolean | number } | 'keeps' | 'notSet'

export type PresetContainerName = 'promptSettings' | 'dynamicOutput' | 'seperateModels'

// The numbers a form control may write to a number path. `disableable` admits classic's "off" sentinel on top of the
// range; `integer` refuses a fraction. Undo, redo and restore never check any of it.
export interface PresetNumberRange {
    readonly min?: number
    readonly max?: number
    readonly integer?: true
    readonly disableable?: true
}

// Classic's slider stores this number for "off".
export const DISABLED_NUMBER = -1000

export interface PresetFieldSpec {
    readonly value: 'text' | 'bool' | 'number'
    // The `botPreset` property of the slot (the container property for a container key).
    readonly slot: keyof botPreset
    // The working property of the active preset, or `slotOnly` for a value the working settings do not carry.
    readonly db: keyof Database | 'slotOnly'
    // The key inside the container named by `slot`; absent for a field of the preset itself.
    readonly key?: string
    readonly absent: PresetAbsent
    // The values the form offers for an enum; the writer accepts any value of the field's kind so that an imported
    // unknown value can be put back by an undo.
    readonly options?: readonly (string | number)[]
    readonly range?: PresetNumberRange
    // What a `{ had: false }` write leaves in the property: the key is deleted unless the producer writes `null`
    // (`setPreset` and the save do for the thinking token budget).
    readonly unset?: 'null'
}

interface PlainExtras {
    readonly options?: readonly (string | number)[]
    readonly range?: PresetNumberRange
    readonly unset?: 'null'
}

function plain<K extends keyof botPreset & keyof Database>(name: K, value: PresetFieldSpec['value'], absent: PresetAbsent, extras: PlainExtras = {}): PresetFieldSpec {
    return { value, slot: name, db: name, absent, ...extras }
}

function inPromptSettings(key: keyof PromptSettings & string, value: PresetFieldSpec['value'], absent: PresetAbsent, range?: PresetNumberRange): PresetFieldSpec {
    return { value, slot: 'promptSettings', db: 'promptSettings', key, absent, ...(range ? { range } : {}) }
}

function inDynamicOutput(key: keyof DynamicOutput & string): PresetFieldSpec {
    return { value: 'bool', slot: 'dynamicOutput', db: 'dynamicOutput', key, absent: 'notSet' }
}

function inSeperateModels(key: keyof Database['seperateModels'] & string): PresetFieldSpec {
    return { value: 'text', slot: 'seperateModels', db: 'seperateModels', key, absent: { default: '' } }
}

const REASON_EFFORTS = [-1, 0, 1, 2, 3] as const
const ADAPTIVE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export const PRESET_FIELDS: { readonly [P in PresetPath]: PresetFieldSpec } = {
    customModuleToggle: plain('customPromptTemplateToggle', 'text', { default: '' }),
    presetName: { value: 'text', slot: 'name', db: 'slotOnly', absent: { default: '' } },
    presetMainPrompt: plain('mainPrompt', 'text', 'keeps'),
    presetJailbreak: plain('jailbreak', 'text', 'keeps'),
    presetGlobalNote: plain('globalNote', 'text', 'keeps'),
    presetPromptPreprocess: plain('promptPreprocess', 'bool', 'keeps'),
    presetPostEndInnerFormat: inPromptSettings('postEndInnerFormat', 'text', { default: '' }),
    presetSendChatAsSystem: inPromptSettings('sendChatAsSystem', 'bool', { default: false }),
    presetSendName: inPromptSettings('sendName', 'bool', { default: false }),
    presetTrimStartNewChat: inPromptSettings('trimStartNewChat', 'bool', 'notSet'),
    presetUtilOverride: inPromptSettings('utilOverride', 'bool', { default: false }),
    presetCustomChainOfThought: inPromptSettings('customChainOfThought', 'bool', 'notSet'),
    presetJsonSchemaEnabled: plain('jsonSchemaEnabled', 'bool', { default: false }),
    presetOutputImageModal: plain('outputImageModal', 'bool', { default: false }),
    presetStrictJsonSchema: plain('strictJsonSchema', 'bool', { default: true }),
    presetJsonSchema: plain('jsonSchema', 'text', { default: '' }),
    presetExtractJson: plain('extractJson', 'text', { default: '' }),
    presetGroupOtherBotRole: plain('groupOtherBotRole', 'text', { default: 'user' }, { options: ['user', 'system', 'assistant'] }),
    presetTemplateDefaultVariables: plain('templateDefaultVariables', 'text', { default: '' }),
    presetAutoSuggestPrompt: plain('autoSuggestPrompt', 'text', 'keeps'),
    presetGroupTemplate: plain('groupTemplate', 'text', { default: '' }),
    presetSystemContentReplacement: plain('systemContentReplacement', 'text', { default: '' }),
    presetSystemRoleReplacement: plain('systemRoleReplacement', 'text', { default: 'user' }, { options: ['user', 'assistant'] }),
    presetFallbackWhenBlank: plain('fallbackWhenBlankResponse', 'bool', { default: false }),
    presetModuleIntegration: plain('moduleIntergration', 'text', { default: '' }),
    presetUseInstructPrompt: plain('useInstructPrompt', 'bool', { default: false }),
    presetAutoSuggestPrefix: plain('autoSuggestPrefix', 'text', 'keeps'),
    presetAutoSuggestClean: plain('autoSuggestClean', 'bool', 'keeps'),
    presetDynamicAutoAdjustSchema: inDynamicOutput('autoAdjustSchema'),
    presetDynamicMessages: inDynamicOutput('dynamicMessages'),
    presetDynamicMemory: inDynamicOutput('dynamicMemory'),
    presetDynamicResponseTiming: inDynamicOutput('dynamicResponseTiming'),
    presetDynamicOutputPrompt: inDynamicOutput('dynamicOutputPrompt'),
    presetDynamicShowTypingEffect: inDynamicOutput('showTypingEffect'),
    presetDynamicRequest: inDynamicOutput('dynamicRequest'),
    presetAiModel: plain('aiModel', 'text', 'keeps'),
    presetSubModel: plain('subModel', 'text', 'keeps'),
    presetAuxMemory: inSeperateModels('memory'),
    presetAuxTranslate: inSeperateModels('translate'),
    presetAuxEmotion: inSeperateModels('emotion'),
    presetAuxOtherAx: inSeperateModels('otherAx'),
    presetMaxContext: plain('maxContext', 'number', 'keeps', { range: { min: 0 } }),
    presetMaxResponse: plain('maxResponse', 'number', 'keeps', { range: { min: 0, max: 2048 } }),
    presetThinkingType: plain('thinkingType', 'text', { default: 'budget' }, { options: ['off', 'budget', 'adaptive'] }),
    presetDeepseekThinkingType: plain('deepseekThinkingType', 'text', { default: 'off' }, { options: ['off', 'enabled'] }),
    presetThinkingTokens: plain('thinkingTokens', 'number', 'notSet', { range: { min: -1, max: 64000, disableable: true }, unset: 'null' }),
    presetAdaptiveThinkingEffort: plain('adaptiveThinkingEffort', 'text', { default: 'high' }, { options: ADAPTIVE_EFFORTS }),
    presetDeepseekReasoningEffort: plain('deepseekReasoningEffort', 'text', { default: 'high' }, { options: ['high', 'max'] }),
    presetTemperature: plain('temperature', 'number', 'keeps', { range: { min: 0, max: 200, disableable: true } }),
    presetTopK: plain('top_k', 'number', 'keeps', { range: { min: 0, max: 100, disableable: true } }),
    presetMinP: plain('min_p', 'number', 'notSet', { range: { min: 0, max: 1, disableable: true } }),
    presetTopA: plain('top_a', 'number', 'notSet', { range: { min: 0, max: 1, disableable: true } }),
    presetRepetitionPenalty: plain('repetition_penalty', 'number', 'notSet', { range: { min: 0, max: 2, disableable: true } }),
    // The slot's `reasonEffort` is the working `reasoningEffort`.
    presetReasonEffort: { value: 'number', slot: 'reasonEffort', db: 'reasoningEffort', absent: { default: 0 }, options: REASON_EFFORTS },
    presetVerbosity: plain('verbosity', 'number', { default: 1 }, { options: [0, 1, 2] }),
    presetTopP: plain('top_p', 'number', { default: 1 }, { range: { min: 0, max: 1, disableable: true } }),
    presetFrequencyPenalty: plain('frequencyPenalty', 'number', 'keeps', { range: { min: 0, max: 200, disableable: true } }),
    presetPresencePenalty: plain('PresensePenalty', 'number', 'keeps', { range: { min: 0, max: 200, disableable: true } }),
    presetMaxThoughtTagDepth: inPromptSettings('maxThoughtTagDepth', 'number', { default: -1 }, { integer: true }),
}

// The value a container is created with by the first write into an absent or null one: what `setPreset` gives a slot
// without it (`dynamicOutput` is assigned as is there, so its created seed holds every key off).
const PRESET_CONTAINER_SEEDS = {
    promptSettings: { assistantPrefill: '', postEndInnerFormat: '', sendChatAsSystem: false, sendName: false, utilOverride: false, maxThoughtTagDepth: -1 },
    dynamicOutput: {
        autoAdjustSchema: false,
        dynamicMessages: false,
        dynamicMemory: false,
        dynamicResponseTiming: false,
        dynamicOutputPrompt: false,
        showTypingEffect: false,
        dynamicRequest: false,
    },
    seperateModels: { memory: '', emotion: '', translate: '', otherAx: '' },
} as const satisfies { promptSettings: PromptSettings; dynamicOutput: DynamicOutput; seperateModels: Database['seperateModels'] }

export function isPresetContainerName(name: string): name is PresetContainerName {
    return Object.hasOwn(PRESET_CONTAINER_SEEDS, name)
}

// A new copy on every call, so no two presets share a container.
export function freshPresetContainerSeed(name: PresetContainerName): Record<string, unknown> {
    return structuredClone(PRESET_CONTAINER_SEEDS[name]) as Record<string, unknown>
}

export function isPresetPath(path: string): path is PresetPath {
    return Object.hasOwn(PRESET_FIELDS, path)
}

function numberAllowed(range: PresetNumberRange | undefined, value: number): boolean {
    if (range === undefined) {
        return true
    }
    if (range.disableable === true && value === DISABLED_NUMBER) {
        return true
    }
    if (range.integer === true && !Number.isInteger(value)) {
        return false
    }
    return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max)
}

// Whether the form may write `value` to `path`: the field's kind, one of the offered options for an enum and a number
// inside the field's range. Undo, redo and restore never ask: a value that was read from a slot is put back exactly.
export function presetValueAllowed(path: PresetPath, value: unknown): boolean {
    if (!valueMatchesKind(path, value)) {
        return false
    }
    const spec = PRESET_FIELDS[path]
    if (spec.options !== undefined && (typeof value === 'string' || typeof value === 'number') && !spec.options.includes(value)) {
        return false
    }
    return typeof value !== 'number' || numberAllowed(spec.range, value)
}
