// The adapter table of the preset session owner: for every path of the preset kind's set row, which `botPreset` slot
// property and which working (`db`) property hold it, where it sits inside a container, what an absent value reads as,
// and which values the form may offer. The table is pure data plus two pure functions; the routing between the slot
// and the working copy lives in presetTarget.ts.

import type { PromptSettings } from '../../process/prompt'
import type { Database, DynamicOutput, botPreset } from '../../storage/database.svelte'
import type { SESSION_OWNER_KINDS } from '../history/sessionKinds'

// Every path of the preset kind's set row; the table below holds exactly these (a missing or extra row fails
// `pnpm check`).
export type PresetPath = (typeof SESSION_OWNER_KINDS.preset.setPaths)[number]

// What a missing, null or wrong-typed value reads as:
// - `{ default }`: the constant `setPreset` assigns, so the form shows what switching to the preset produces.
// - `keeps`: `setPreset` keeps the working value (`?? db.x`), so the slot has no own value; reads not set. A
//   `{ had: false }` write onto the active copy is refused, because the working copy never loses a required setting.
// - `notSet`: a plain copy or an optional container key; the absence is the value (off) and may be written back.
export type PresetAbsent = { readonly default: string | boolean } | 'keeps' | 'notSet'

export type PresetContainerName = 'promptSettings' | 'dynamicOutput'

export interface PresetFieldSpec {
    readonly value: 'text' | 'bool'
    // The `botPreset` property of the slot (the container property for a container key).
    readonly slot: keyof botPreset
    // The working property of the active preset, or `slotOnly` for a value the working settings do not carry.
    readonly db: keyof Database | 'slotOnly'
    // The key inside the container named by `slot`; absent for a field of the preset itself.
    readonly key?: string
    readonly absent: PresetAbsent
    // The values the form offers for an enum; the writer accepts any value of the field's kind so that an imported
    // unknown value can be put back by an undo.
    readonly options?: readonly string[]
}

function plain<K extends keyof botPreset & keyof Database>(name: K, value: 'text' | 'bool', absent: PresetAbsent, options?: readonly string[]): PresetFieldSpec {
    return { value, slot: name, db: name, absent, ...(options ? { options } : {}) }
}

function inPromptSettings(key: keyof PromptSettings & string, value: 'text' | 'bool', absent: PresetAbsent): PresetFieldSpec {
    return { value, slot: 'promptSettings', db: 'promptSettings', key, absent }
}

function inDynamicOutput(key: keyof DynamicOutput & string): PresetFieldSpec {
    return { value: 'bool', slot: 'dynamicOutput', db: 'dynamicOutput', key, absent: 'notSet' }
}

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
    presetGroupOtherBotRole: plain('groupOtherBotRole', 'text', { default: 'user' }, ['user', 'system', 'assistant']),
    presetTemplateDefaultVariables: plain('templateDefaultVariables', 'text', { default: '' }),
    presetAutoSuggestPrompt: plain('autoSuggestPrompt', 'text', 'keeps'),
    presetGroupTemplate: plain('groupTemplate', 'text', { default: '' }),
    presetSystemContentReplacement: plain('systemContentReplacement', 'text', { default: '' }),
    presetSystemRoleReplacement: plain('systemRoleReplacement', 'text', { default: 'user' }, ['user', 'assistant']),
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
} as const satisfies { promptSettings: PromptSettings; dynamicOutput: DynamicOutput }

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

// Whether the form may write `value` to `path`: the field's kind, and one of the offered options for an enum. Undo,
// redo and restore never ask: a value that was read from a slot is put back exactly.
export function presetValueAllowed(path: PresetPath, value: unknown): boolean {
    const spec = PRESET_FIELDS[path]
    if (spec.value === 'bool') {
        return typeof value === 'boolean'
    }
    return typeof value === 'string' && (spec.options === undefined || spec.options.includes(value))
}

// Whether the value has the kind the path carries.
export function presetValueHasKind(path: PresetPath, value: unknown): value is string | boolean {
    return typeof value === (PRESET_FIELDS[path].value === 'bool' ? 'boolean' : 'string')
}
