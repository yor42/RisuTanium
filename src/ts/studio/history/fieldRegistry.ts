// The one registry of the Studio set paths: the persisted facts of each path (FIELD_SPECS) and its presentation
// (FIELD_PRESENTATION). Every per-kind table, parser row, restore row, reader, writer, label and focus target derives
// from these two tables, so a new builtin-host field is one entry in each (plus its frozen row in the frozen-facts
// test). The module is pure: type-only imports, no behaviour. The functions that read the tables live in
// fieldAccess.ts.
//
// Rules for every later change (persisted facts):
// - A path is a stable history identity string. It is recorded in set ops, step labels and restore keys, and it is
//   never derived from the holder property and never required to equal it. Holder access goes only through
//   `propertyOf(path)`, which is `property` when given and the path otherwise. To move a field to another holder
//   property, set `property`; never rename the path.
// - A dot in a path or in a `property` is reserved for nested holder properties: a dotted path names container `a`,
//   key `b` (for example `depth_prompt.prompt`), is held by `character` only and gives no `property`. Its container
//   is one of CONTAINER_SEEDS, whose seeds are persisted facts (an undo replays a seed reading). An absent or null
//   container reads as its seed, so a restore point captures `''` for the three container paths of an absent
//   container. A `had: true` write creates the container from a fresh copy of the seed, and a container is never
//   deleted. A restore onto an existing container writes into it, and a restore whose live reading already equals
//   `before` writes nothing, so it creates no container. A session owner kind that lists a dotted path owns the seed
//   and container rule in its own adapter. The generic reader and writer support text, boolean
//   and bias-list values.
// - Never rename or remove a path, and never change an existing path's `value`, `absent`, `editWhenAbsent`,
//   `holders` or `property`: older builds refuse a record whole on a path they do not know, and the frozen-facts test
//   (append-only) pins every existing row. A path new to older builds is a widening they refuse whole.
// - `absent` is applied by the builtin-holder writers only. `editWhenAbsent` is enforced by the kind-independent edit
//   builder for every kind.
// - Adding an existing path to another builtin kind's row is a widening for older builds too.
// - `keepForeign` is set on new rows only, requires `editWhenAbsent: true`, and is never changed on an existing row: a
//   present value of another type is then recorded as a foreign reading and an undo writes it back, instead of the
//   value reading as absent. The frozen-facts test pins it with the other facts. It is never set on a `biasList`
//   row: a foreign reading is a boolean or text reading, and a bias list has no such reading.

import type { languageEnglish } from '../../../lang/en'
import type { Chat, character } from '../../storage/database.svelte'
import type { RisuModule } from '../../process/modules'

export type StringKeyOf<T> = { [K in keyof T]: T[K] extends string ? K : never }[keyof T] & string

export type Holder = 'character' | 'chat' | 'module'

// One token bias row: the token text and its bias value.
export type BiasRow = [string, number]

// The persisted facts of a path: frozen by the append-only guard.
export interface FieldFacts {
    value: 'text' | 'bool' | 'biasList'
    // The builtin owner kinds whose set row and restore row hold the path, and whose writers write it.
    holders: readonly Holder[]
    // What a builtin-holder writer does with `{ had: false }`: leave the key or delete it.
    absent: 'keep' | 'delete'
    // False: an edit whose live value is absent is refused `precondition` (an undo could not put the key back).
    editWhenAbsent: boolean
    // The holder property; absent means the path itself.
    property?: string
    // True: a present value of another type than `value` is read as a foreign value (kept as plain JSON) instead of as
    // absent. Absent means false.
    keepForeign?: boolean
}

export interface FieldPresentation {
    labelKey: StringKeyOf<typeof languageEnglish>
    // Where focus goes after a history action changed the path: the two special first message and example list
    // targets, an element named by its form and part, or nothing.
    // `byPath` narrows the element by its `data-path` attribute (the path itself), for parts that repeat per path.
    focus: 'firstMessage' | 'example' | { form: string; part: string; byPath?: true } | null
}

export const FIELD_SPECS = {
    desc: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: true },
    firstMessage: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    exampleMessage: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    customModuleToggle: { value: 'text', holders: ['character', 'module'], absent: 'delete', editWhenAbsent: true },
    hideChatIcon: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    risutanium_render_when_complete: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    note: { value: 'text', holders: ['chat'], absent: 'keep', editWhenAbsent: true },
    systemPrompt: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    replaceGlobalNote: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    additionalText: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    personality: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    scenario: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    'depth_prompt.prompt': { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    'additionalData.creator': { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    'additionalData.character_version': { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    nickname: { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    defaultVariables: { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    translatorNote: { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    moduleName: { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'name', keepForeign: true },
    moduleDescription: { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'description', keepForeign: true },
    moduleNamespace: { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'namespace', keepForeign: true },
    moduleHideIcon: { value: 'bool', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'hideIcon', keepForeign: true },
    moduleLowLevelAccess: { value: 'bool', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'lowLevelAccess', keepForeign: true },
    backgroundEmbedding: { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, keepForeign: true },
    // The preset advanced form's paths. `holders: []` makes each one session-only: no builtin kind's rows, readers or
    // writers include it, and only the preset session kind (sessionKinds.ts) lists it. Its `absent` is unused (that is
    // applied by builtin-holder writers only); the preset adapter owns the routing and the absent rules.
    presetName: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetMainPrompt: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetJailbreak: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetGlobalNote: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetPromptPreprocess: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetPostEndInnerFormat: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetSendChatAsSystem: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetSendName: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetTrimStartNewChat: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetUtilOverride: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetCustomChainOfThought: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetJsonSchemaEnabled: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetOutputImageModal: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetStrictJsonSchema: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetJsonSchema: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetExtractJson: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetGroupOtherBotRole: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetTemplateDefaultVariables: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetAutoSuggestPrompt: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetGroupTemplate: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetSystemContentReplacement: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetSystemRoleReplacement: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetFallbackWhenBlank: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetModuleIntegration: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetUseInstructPrompt: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetAutoSuggestPrefix: { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true },
    presetAutoSuggestClean: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicAutoAdjustSchema: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicMessages: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicMemory: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicResponseTiming: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicOutputPrompt: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicShowTypingEffect: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    presetDynamicRequest: { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true },
    creatorNotes: { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    removedQuotes: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    lowLevelAccess: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    utilityBot: { value: 'bool', holders: ['character'], absent: 'keep', editWhenAbsent: false },
    escapeOutput: { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true },
    bias: { value: 'biasList', holders: ['character'], absent: 'keep', editWhenAbsent: false },
} as const satisfies Record<string, FieldFacts>

// The containers a dotted path names, with the value an absent container reads as: the classic character select's own
// defaults. Frozen with the rows, because an undo replays a seed reading.
export const CONTAINER_SEEDS = {
    depth_prompt: { depth: 0, prompt: '' },
    additionalData: { tag: [], creator: '', character_version: '' },
} as const satisfies { [C in 'depth_prompt' | 'additionalData']: Required<NonNullable<character[C]>> }
export type ContainerName = keyof typeof CONTAINER_SEEDS

export type SetPath = keyof typeof FIELD_SPECS

export const FIELD_PRESENTATION: { readonly [P in SetPath]: FieldPresentation } = {
    desc: { labelKey: 'description', focus: { form: 'studio-character-form', part: 'studio-form-desc' } },
    firstMessage: { labelKey: 'firstMessage', focus: 'firstMessage' },
    exampleMessage: { labelKey: 'exampleMessage', focus: 'example' },
    customModuleToggle: { labelKey: 'customPromptTemplateToggle', focus: null },
    hideChatIcon: { labelKey: 'hideChatIcon', focus: { form: 'studio-character-form', part: 'studio-form-hide-icon' } },
    risutanium_render_when_complete: { labelKey: 'studioFormRenderWhenComplete', focus: { form: 'studio-character-form', part: 'studio-form-render-when-complete' } },
    note: { labelKey: 'note', focus: { form: 'studio-chat-note-form', part: 'studio-form-note' } },
    systemPrompt: { labelKey: 'systemPrompt', focus: { form: 'studio-advanced-form', part: 'studio-form-system-prompt' } },
    replaceGlobalNote: { labelKey: 'replaceGlobalNote', focus: { form: 'studio-advanced-form', part: 'studio-form-replace-global-note' } },
    additionalText: { labelKey: 'additionalText', focus: { form: 'studio-advanced-form', part: 'studio-form-additional-text' } },
    personality: { labelKey: 'personality', focus: { form: 'studio-advanced-form', part: 'studio-form-personality' } },
    scenario: { labelKey: 'scenario', focus: { form: 'studio-advanced-form', part: 'studio-form-scenario' } },
    'depth_prompt.prompt': { labelKey: 'depthPrompt', focus: { form: 'studio-advanced-form', part: 'studio-form-depth-prompt' } },
    'additionalData.creator': { labelKey: 'creator', focus: { form: 'studio-advanced-form', part: 'studio-form-creator' } },
    'additionalData.character_version': { labelKey: 'CharVersion', focus: { form: 'studio-advanced-form', part: 'studio-form-character-version' } },
    nickname: { labelKey: 'nickname', focus: { form: 'studio-advanced-form', part: 'studio-form-nickname' } },
    defaultVariables: { labelKey: 'defaultVariables', focus: { form: 'studio-advanced-form', part: 'studio-form-default-variables' } },
    translatorNote: { labelKey: 'translatorNote', focus: { form: 'studio-advanced-form', part: 'studio-form-translator-note' } },
    moduleName: { labelKey: 'name', focus: { form: 'studio-module-advanced-form', part: 'studio-module-name' } },
    moduleDescription: { labelKey: 'description', focus: { form: 'studio-module-advanced-form', part: 'studio-module-description' } },
    moduleNamespace: { labelKey: 'namespace', focus: { form: 'studio-module-advanced-form', part: 'studio-module-namespace' } },
    moduleHideIcon: { labelKey: 'hideChatIcon', focus: { form: 'studio-module-advanced-form', part: 'studio-module-hide-icon' } },
    moduleLowLevelAccess: { labelKey: 'lowLevelAccess', focus: { form: 'studio-module-advanced-form', part: 'studio-module-low-level' } },
    backgroundEmbedding: { labelKey: 'backgroundHTML', focus: { form: 'studio-module-html-form', part: 'studio-module-background' } },
    presetName: { labelKey: 'name', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetName' } },
    presetMainPrompt: { labelKey: 'mainPrompt', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetMainPrompt' } },
    presetJailbreak: { labelKey: 'jailbreakPrompt', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetJailbreak' } },
    presetGlobalNote: { labelKey: 'globalNote', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetGlobalNote' } },
    presetPromptPreprocess: { labelKey: 'promptPreprocess', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetPromptPreprocess' } },
    presetPostEndInnerFormat: { labelKey: 'postEndInnerFormat', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetPostEndInnerFormat' } },
    presetSendChatAsSystem: { labelKey: 'sendChatAsSystem', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetSendChatAsSystem' } },
    presetSendName: { labelKey: 'formatGroupInSingle', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetSendName' } },
    presetTrimStartNewChat: { labelKey: 'trimStartNewChat', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetTrimStartNewChat' } },
    presetUtilOverride: { labelKey: 'utilOverride', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetUtilOverride' } },
    presetCustomChainOfThought: { labelKey: 'customChainOfThought', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetCustomChainOfThought' } },
    presetJsonSchemaEnabled: { labelKey: 'enableJsonSchema', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetJsonSchemaEnabled' } },
    presetOutputImageModal: { labelKey: 'outputImageModal', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetOutputImageModal' } },
    presetStrictJsonSchema: { labelKey: 'strictJsonSchema', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetStrictJsonSchema' } },
    presetJsonSchema: { labelKey: 'jsonSchema', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetJsonSchema' } },
    presetExtractJson: { labelKey: 'extractJson', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetExtractJson' } },
    presetGroupOtherBotRole: { labelKey: 'groupOtherBotRole', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetGroupOtherBotRole' } },
    presetTemplateDefaultVariables: { labelKey: 'defaultVariables', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetTemplateDefaultVariables' } },
    presetAutoSuggestPrompt: { labelKey: 'autoSuggest', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetAutoSuggestPrompt' } },
    presetGroupTemplate: { labelKey: 'groupInnerFormat', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetGroupTemplate' } },
    presetSystemContentReplacement: { labelKey: 'systemContentReplacement', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetSystemContentReplacement' } },
    presetSystemRoleReplacement: { labelKey: 'systemRoleReplacement', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetSystemRoleReplacement' } },
    presetFallbackWhenBlank: { labelKey: 'fallbackWhenBlankResponse', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetFallbackWhenBlank' } },
    presetModuleIntegration: { labelKey: 'moduleIntergration', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetModuleIntegration' } },
    presetUseInstructPrompt: { labelKey: 'useInstructPrompt', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetUseInstructPrompt' } },
    presetAutoSuggestPrefix: { labelKey: 'studioPresetAutoSuggestPrefix', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetAutoSuggestPrefix' } },
    presetAutoSuggestClean: { labelKey: 'studioPresetAutoSuggestClean', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetAutoSuggestClean' } },
    presetDynamicAutoAdjustSchema: { labelKey: 'studioPresetDynamicAutoAdjustSchema', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicAutoAdjustSchema' } },
    presetDynamicMessages: { labelKey: 'studioPresetDynamicMessages', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicMessages' } },
    presetDynamicMemory: { labelKey: 'studioPresetDynamicMemory', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicMemory' } },
    presetDynamicResponseTiming: { labelKey: 'studioPresetDynamicResponseTiming', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicResponseTiming' } },
    presetDynamicOutputPrompt: { labelKey: 'studioPresetDynamicOutputPrompt', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicOutputPrompt' } },
    presetDynamicShowTypingEffect: { labelKey: 'studioPresetDynamicShowTypingEffect', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicShowTypingEffect' } },
    presetDynamicRequest: { labelKey: 'studioPresetDynamicRequest', focus: { form: 'studio-preset-advanced-form', part: 'studio-preset-presetDynamicRequest' } },
    creatorNotes: { labelKey: 'creatorNotes', focus: { form: 'studio-advanced-form', part: 'studio-form-creator-notes' } },
    removedQuotes: { labelKey: 'studioFieldRemovedQuotes', focus: { form: 'studio-advanced-form', part: 'studio-form-creator-notes' } },
    lowLevelAccess: { labelKey: 'lowLevelAccess', focus: { form: 'studio-risky', part: 'studio-risky-switch', byPath: true } },
    utilityBot: { labelKey: 'utilityBot', focus: { form: 'studio-risky', part: 'studio-risky-switch', byPath: true } },
    escapeOutput: { labelKey: 'escapeOutput', focus: { form: 'studio-risky', part: 'studio-risky-switch', byPath: true } },
    bias: { labelKey: 'studioFieldBias', focus: { form: 'studio-advanced-form', part: 'studio-form-bias' } },
}

// Compile-time check: every registered path's holder property (`property`, else the path) is a key of each listed
// holder's type, so a typo or a wrong holder fails `pnpm check` before it can write a stray key onto a character,
// chat or module.
interface HolderTypes {
    character: character
    chat: Chat
    module: RisuModule
}
type PropertyNameOf<Specs, P extends keyof Specs> = Specs[P] extends { readonly property: infer Q extends string } ? Q : P
type HoldersOf<Specs extends Record<string, FieldFacts>, P extends keyof Specs & string> = Specs[P]['holders'][number]
// The paths of `Specs` whose holder access does not exist. A flat path's property must be a key of each holder. A dotted
// path `A.B` must name a container `A` of CONTAINER_SEEDS and a key `B` of its seed whose type matches the value type,
// be held by `character` only and give no `property`.
export type MissingHolderPropertyOf<Specs extends Record<string, FieldFacts>> = {
    [P in keyof Specs & string]: P extends `${infer A}.${infer B}`
        ? A extends ContainerName
            ? B extends keyof (typeof CONTAINER_SEEDS)[A]
                ? HoldersOf<Specs, P> extends 'character'
                    ? Specs[P] extends { readonly property: string }
                        ? P
                        : Specs[P]['value'] extends 'text'
                          ? (typeof CONTAINER_SEEDS)[A][B] extends string
                              ? never
                              : P
                          : P
                    : P
                : P
            : P
        : { [H in HoldersOf<Specs, P>]: PropertyNameOf<Specs, P> extends keyof HolderTypes[H] ? never : P }[HoldersOf<Specs, P>]
}[keyof Specs & string]
export const HOLDER_PROPERTIES_EXIST: [MissingHolderPropertyOf<typeof FIELD_SPECS>] extends [never] ? true : never = true
