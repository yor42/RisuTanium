import type { Database, StoredDatabase, botPreset } from 'src/ts/storage/database.svelte'
import { SECRET_FIELDS } from 'src/ts/secretFields'
import { PRESET_RECORD_FIELDS } from 'src/ts/storage/store2/fastForward/records'

/**
 * The field model of a settings-only `.rtb`: which database fields travel, what shape each must have, and which
 * preset fields are carried. Only a name in `SETTINGS_FIELDS` is ever written to or read from such a file; anything
 * else, including every credential, connection, endpoint and list that points into an excluded list, stays out
 * (MC-3359, MC-3361). The module holds no logic beyond the tables, so the write side and the read side cannot disagree.
 */

export type FieldKind = 'boolean' | 'number' | 'string' | 'array' | 'object'

/**
 * `number` is a finite number. `object` is non-null, not an array and plain. `nullable` says a top-level `null` is a
 * value the producers really store for the field, so it travels and is applied; every other `null` is not carried.
 */
export interface FieldRule {
    kind: FieldKind
    nullable: boolean
}

const bool: FieldRule = { kind: 'boolean', nullable: false }
const num: FieldRule = { kind: 'number', nullable: false }
const str: FieldRule = { kind: 'string', nullable: false }
const arr: FieldRule = { kind: 'array', nullable: false }
const obj: FieldRule = { kind: 'object', nullable: false }
const orNull = (rule: FieldRule): FieldRule => ({ kind: rule.kind, nullable: true })

/**
 * The preset fields the database fields below are copied to: the settings a bot preset holds, minus the fields that
 * name a connection, an endpoint or a plugin provider. Those stay the device's.
 */
export const PRESET_OMITTED_SOURCE_FIELDS = [
    'currentPluginProvider', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'koboldURL', 'proxyConnectionId',
] as const

type PresetOmittedSourceField = typeof PRESET_OMITTED_SOURCE_FIELDS[number]

/** A working preset field: the preset record's database fields without the omitted connection and endpoint ones. */
export type PresetWorkingField = Exclude<typeof PRESET_RECORD_FIELDS[number], PresetOmittedSourceField>

export const PRESET_WORKING_FIELDS: readonly PresetWorkingField[] = PRESET_RECORD_FIELDS.filter(
    (name): name is PresetWorkingField => !(PRESET_OMITTED_SOURCE_FIELDS as readonly string[]).includes(name),
)

const DISPLAY_FIELDS = [
    'theme', 'textTheme', 'customTextTheme', 'colorScheme', 'colorSchemeName', 'customColorScheme', 'textScreenColor',
    'textBorder', 'textScreenRounded', 'textScreenBorder', 'zoomsize', 'iconsize', 'roundIcons', 'fullScreen',
    'waifuWidth', 'waifuWidth2', 'assetWidth', 'animationSpeed', 'font', 'customFont', 'lineHeight', 'textAreaSize',
    'sideBarSize', 'textAreaTextSize', 'heightMode', 'classicMaxWidth', 'settingsCloseButtonSize',
    'hamburgerButtonBottom', 'newMessageButtonStyle', 'blockquoteStyling', 'customCSS', 'useLegacyGUI', 'betaMobileGUI',
    'menuSideBar', 'showMenuChatList', 'showMenuHypaMemoryModal', 'showFolderName', 'showSavingIcon', 'showMemoryLimit',
    'memoryLimitThickness', 'hideAllImages', 'hideApiKey', 'language', 'hideRealm', 'visibleModes', 'hideUnusedModes',
    'sendWithEnter', 'fixedChatTextarea', 'clickToEdit', 'enableBlockPartialEdit', 'enableDragPartialEdit',
    'longPressToPopupEditor', 'autoScrollToNewMessage', 'alwaysScrollToNewMessage', 'chatLoadInitialPages',
    'chatLoadAdditionalPages', 'streamingDisplayOptimizationMode', 'useChatSticker', 'useChatCopy',
    'useAdditionalAssetsPreview', 'imageCompression', 'playMessage', 'playMessageOnTranslateEnd', 'notification',
    'hotkeys', 'customQuotes', 'customQuotesData', 'unformatQuotes', 'enableScrollToActiveChar', 'enableBookmark',
    'showFirstMessagePages', 'showPromptComparison', 'promptDiffPrefs', 'requestInfoInsideChat',
    'promptInfoInsideChat', 'promptTextInfoInsideChat', 'sideMenuRerollButton', 'showUnrecommended',
    'showTranslationLoading', 'auxModelUnderModelSettings', 'disableAprilFools',
] as const satisfies readonly (keyof Database)[]

const GENERATION_FIELDS = [
    'jailbreakToggle', 'generationSeed', 'requestRetrys', 'useStreaming', 'swipe', 'instantRemove', 'useSayNothing',
    'autoContinueChat', 'autoContinueMinTokens', 'removeIncompleteResponse', 'chainOfThought',
    'doNotChangeSeperateModels', 'doNotChangeFallbackModels', 'seperateParametersByModel',
    'disableSeperateParameterChangeOnPresetChange', 'claudeCachingExperimental', 'claudeRetrivalCaching',
    'claude1HourCaching', 'claudeBatching', 'automaticCachePoint', 'geminiStream', 'streamGeminiThoughts',
    'openAIFlexProcessing', 'antiClaudeOverload', 'antiServerOverloads', 'openrouterMiddleOut', 'openrouterFallback',
    'ollamaModel', 'ollamaModelSource', 'ollamaInputMode', 'ollamaRequestFormat', 'ollamaModelName',
    'ollamaCloudModel', 'ollamaCloudModelName', 'ollamaThinkingMode', 'nanogptRequestModel',
    'nanogptRequestModelName', 'nanogptProvider', 'customTokenizer',
] as const satisfies readonly (keyof Database)[]

const TRANSLATOR_FIELDS = [
    'translator', 'translatorType', 'translatorInputLanguage', 'translatorPrompt', 'translatorMaxResponse',
    'translatorPresets', 'translatorPresetId', 'autoTranslate', 'htmlTranslation', 'noWaitForTranslate',
    'useAutoTranslateInput', 'combineTranslation', 'legacyTranslation', 'translateBeforeHTMLFormatting',
    'autoTranslateCachedOnly', 'useExperimentalGoogleTranslator',
] as const satisfies readonly (keyof Database)[]

const MEMORY_FIELDS = [
    'hypaMemory', 'hypav2', 'hypaV3', 'hypaV3Settings', 'hypaV3Presets', 'hypaV3PresetId', 'hypaModel',
    'hypaAllocatedTokens', 'hypaChunkSize', 'memoryAlgorithmType', 'supaModelType', 'maxSupaChunkSize',
    'removePunctuationHypa', 'supaMemoryPrompt', 'ltmEngine', 'ltmSettings',
] as const satisfies readonly (keyof Database)[]

const PRESET_LIST_FIELDS = ['botPresets', 'botPresetsId', 'presetFolders'] as const satisfies readonly (keyof Database)[]

/**
 * Every database field a settings-only `.rtb` may carry. A new `Database` field is excluded until it is added here
 * with its rule below.
 */
export const SETTINGS_FIELDS = [
    ...DISPLAY_FIELDS,
    ...PRESET_WORKING_FIELDS,
    ...GENERATION_FIELDS,
    ...TRANSLATOR_FIELDS,
    ...MEMORY_FIELDS,
    ...PRESET_LIST_FIELDS,
] as const satisfies readonly (keyof Database)[]

export type SettingsField = typeof SETTINGS_FIELDS[number]

/**
 * The rule of every allowed field, exhaustive by construction. The preset working fields that `setPreset` copies
 * carry the kind of the database field they are written to.
 */
export const SETTINGS_FIELD_RULES: Readonly<Record<SettingsField, FieldRule>> = {
    //#region display and interface
    theme: str, textTheme: str, customTextTheme: obj, colorScheme: obj, colorSchemeName: str, customColorScheme: obj,
    textScreenColor: str, textBorder: bool, textScreenRounded: bool, textScreenBorder: str, zoomsize: num, iconsize: num,
    roundIcons: bool, fullScreen: bool, waifuWidth: num, waifuWidth2: num, assetWidth: num, animationSpeed: num,
    font: str, customFont: str, lineHeight: num, textAreaSize: num, sideBarSize: num, textAreaTextSize: num,
    heightMode: str, classicMaxWidth: bool, settingsCloseButtonSize: num, hamburgerButtonBottom: bool,
    newMessageButtonStyle: str, blockquoteStyling: bool, customCSS: str, useLegacyGUI: bool, betaMobileGUI: bool,
    menuSideBar: bool, showMenuChatList: bool, showMenuHypaMemoryModal: bool, showFolderName: bool,
    showSavingIcon: bool, showMemoryLimit: bool, memoryLimitThickness: num, hideAllImages: bool, hideApiKey: bool,
    language: str, hideRealm: bool, visibleModes: arr, hideUnusedModes: bool, sendWithEnter: bool,
    fixedChatTextarea: bool, clickToEdit: bool, enableBlockPartialEdit: bool, enableDragPartialEdit: bool,
    longPressToPopupEditor: bool, autoScrollToNewMessage: bool, alwaysScrollToNewMessage: bool,
    chatLoadInitialPages: num, chatLoadAdditionalPages: num, streamingDisplayOptimizationMode: str,
    useChatSticker: bool, useChatCopy: bool, useAdditionalAssetsPreview: bool, imageCompression: bool,
    playMessage: bool, playMessageOnTranslateEnd: bool, notification: bool, hotkeys: arr, customQuotes: bool,
    customQuotesData: arr, unformatQuotes: bool, enableScrollToActiveChar: bool, enableBookmark: bool,
    showFirstMessagePages: bool, showPromptComparison: bool, promptDiffPrefs: obj, requestInfoInsideChat: bool,
    promptInfoInsideChat: bool, promptTextInfoInsideChat: bool, sideMenuRerollButton: bool, showUnrecommended: bool,
    showTranslationLoading: bool, auxModelUnderModelSettings: bool, disableAprilFools: bool,
    //#endregion

    //#region the working preset fields
    apiType: str, localNetworkMode: bool, localNetworkTimeoutSec: num, mainPrompt: str, jailbreak: str, globalNote: str,
    temperature: num, maxContext: num, maxResponse: num, frequencyPenalty: num, PresensePenalty: num,
    formatingOrder: arr, aiModel: str, subModel: str, promptPreprocess: bool, bias: arr, ooba: obj, ainconfig: obj,
    openrouterRequestModel: str, proxyRequestModel: str, NAIsettings: obj, autoSuggestPrompt: str,
    autoSuggestPrefix: str, autoSuggestClean: bool, promptTemplate: orNull(arr), NAIadventure: bool,
    NAIappendName: bool, localStopStrings: orNull(arr), customProxyRequestModel: str, top_p: num, reverseProxyOobaArgs: obj,
    promptSettings: obj, repetition_penalty: num, min_p: num, top_a: num, openrouterProvider: obj,
    useInstructPrompt: bool, customPromptTemplateToggle: str, templateDefaultVariables: str, moduleIntergration: str,
    top_k: num, instructChatTemplate: str, JinjaTemplate: str, jsonSchemaEnabled: bool, jsonSchema: str,
    strictJsonSchema: bool, extractJson: str, groupOtherBotRole: str, groupTemplate: str,
    seperateParametersEnabled: bool, customAPIFormat: num, systemContentReplacement: str, systemRoleReplacement: str,
    customFlags: arr, enableCustomFlags: bool, presetRegex: arr, reasoningEffort: num, thinkingTokens: orNull(num),
    thinkingType: str, deepseekThinkingType: str, adaptiveThinkingEffort: str, deepseekReasoningEffort: str,
    outputImageModal: bool, seperateModelsForAxModels: bool, seperateModels: obj, fallbackModels: obj,
    fallbackWhenBlankResponse: bool, seperateParameters: obj, modelTools: arr, verbosity: num, dynamicOutput: orNull(obj),
    //#endregion

    //#region chat and generation
    jailbreakToggle: bool, generationSeed: num, requestRetrys: num, useStreaming: bool, swipe: bool, instantRemove: bool,
    useSayNothing: bool, autoContinueChat: bool, autoContinueMinTokens: num, removeIncompleteResponse: bool,
    chainOfThought: bool, doNotChangeSeperateModels: bool, doNotChangeFallbackModels: bool,
    seperateParametersByModel: bool, disableSeperateParameterChangeOnPresetChange: bool,
    claudeCachingExperimental: bool, claudeRetrivalCaching: bool, claude1HourCaching: bool, claudeBatching: bool,
    automaticCachePoint: bool, geminiStream: bool, streamGeminiThoughts: bool, openAIFlexProcessing: bool,
    antiClaudeOverload: bool, antiServerOverloads: bool, openrouterMiddleOut: bool, openrouterFallback: bool,
    ollamaModel: str, ollamaModelSource: str, ollamaInputMode: str, ollamaRequestFormat: num, ollamaModelName: str,
    ollamaCloudModel: str, ollamaCloudModelName: str, ollamaThinkingMode: str, nanogptRequestModel: str,
    nanogptRequestModelName: str, nanogptProvider: str, customTokenizer: str,
    //#endregion

    //#region translator
    translator: str, translatorType: str, translatorInputLanguage: str, translatorPrompt: str,
    translatorMaxResponse: num, translatorPresets: arr, translatorPresetId: num, autoTranslate: bool,
    htmlTranslation: bool, noWaitForTranslate: bool, useAutoTranslateInput: bool, combineTranslation: bool,
    legacyTranslation: bool, translateBeforeHTMLFormatting: bool, autoTranslateCachedOnly: bool,
    useExperimentalGoogleTranslator: bool,
    //#endregion

    //#region memory and LTM
    hypaMemory: bool, hypav2: bool, hypaV3: bool, hypaV3Settings: obj, hypaV3Presets: arr, hypaV3PresetId: num,
    hypaModel: str, hypaAllocatedTokens: num, hypaChunkSize: num, memoryAlgorithmType: str, supaModelType: str,
    maxSupaChunkSize: num, removePunctuationHypa: bool, supaMemoryPrompt: str, ltmEngine: bool, ltmSettings: obj,
    //#endregion

    //#region presets
    botPresets: arr, botPresetsId: num, presetFolders: arr,
    //#endregion
}

/**
 * Fields a settings-only file never carries, by name; `SETTINGS_FIELDS` is the allowlist and this is its complement
 * for the tests and for documentation (anything not allowed is excluded, listed or not): credentials, connections,
 * endpoints, characters and their lists, plugins, loadouts, scripts, theme packs and custom GUI.
 */
const EXCLUDED_BY_NAME = [
    // connections and keys
    'connections', 'proxyConnectionId', 'customModels', 'authRefreshes', 'additionalParams', 'applyAdditionalParamsToAll',
    // URLs and endpoint settings
    'textgenWebUIStreamURL', 'textgenWebUIBlockingURL', 'koboldURL', 'ollamaURL', 'webUiUrl', 'voicevoxUrl',
    'comfyUiUrl', 'comfyConfig', 'NAIImgUrl', 'deeplOptions', 'deeplXOptions', 'hypaCustomSettings',
    'openaiCompatImage', 'wavespeedImage', 'vertexClientEmail', 'vertexRegion', 'requestLocation', 'hubServerType',
    // characters and personas
    'characters', 'characterOrder', 'loreBook', 'modules', 'enabledModules', 'personas', 'selectedPersona', 'username',
    'userIcon', 'userNote', 'personaPrompt',
    // plugins
    'plugins', 'pluginV2', 'currentPluginProvider', 'pluginCustomStorage', 'upstreamKvBlocks',
    // loadouts and scripts
    'loadouts', 'loadoutApplyOptions', 'lastLoadedLoadoutName', 'globalscript', 'globalChatVariables', 'trashOrigins',
    'blockedRealmCreators',
    // themes and GUI
    'themePacks', 'activeThemePack', 'themePackSchemeSnapshot', 'customBackground', 'customGUI', 'guiHTML',
    'customSidebarItems', 'taskPresets',
    // unsent message edits and long-chat hint flags
    'chatDrafts',
] as const satisfies readonly (keyof StoredDatabase)[]

/** The credential fields of the database: every `SECRET_FIELDS` entry that is not a look-alike flagged `notCredential`. */
const CREDENTIAL_FIELDS: readonly (keyof StoredDatabase)[] = SECRET_FIELDS
    .filter((entry) => entry.scope === 'database' && !('notCredential' in entry))
    .map((entry) => entry.field as keyof StoredDatabase)

export const EXCLUDED_FIELDS: readonly (keyof StoredDatabase)[] = [...new Set<keyof StoredDatabase>([
    ...CREDENTIAL_FIELDS,
    ...EXCLUDED_BY_NAME,
])]

/**
 * The rule of every preset field: a value rule, `omit` for a connection, endpoint, key or image field that is never
 * carried, or `meta` for the fork's own id, name, folder and hotkey slot. A new `botPreset` field is a build error
 * until it is classified here. A preset value is the database value under `PRESET_DB_ALIASES`; the nullable ones are
 * those `presetFromWorkingSettings` stores as `null`.
 */
export const PRESET_FIELD_RULE: { readonly [K in keyof botPreset]-?: FieldRule | 'omit' | 'meta' } = {
    name: 'meta', id: 'meta', folderId: 'meta', slot: 'meta',
    apiType: str, openAIKey: 'omit', localNetworkMode: bool, localNetworkTimeoutSec: num, mainPrompt: str,
    jailbreak: str, globalNote: str, temperature: num, maxContext: num, maxResponse: num, frequencyPenalty: num,
    PresensePenalty: num, formatingOrder: arr, aiModel: str, subModel: str, currentPluginProvider: 'omit',
    textgenWebUIStreamURL: 'omit', textgenWebUIBlockingURL: 'omit', forceReplaceUrl: 'omit', forceReplaceUrl2: 'omit',
    promptPreprocess: bool, bias: arr, proxyRequestModel: str, openrouterRequestModel: str, proxyKey: 'omit',
    proxyConnectionId: 'omit', ooba: obj, ainconfig: obj, koboldURL: 'omit', NAISettings: obj, autoSuggestPrompt: str,
    autoSuggestPrefix: str, autoSuggestClean: bool, promptTemplate: orNull(arr), NAIadventure: bool, NAIappendName: bool,
    localStopStrings: orNull(arr), customProxyRequestModel: str, reverseProxyOobaArgs: orNull(obj), top_p: num,
    promptSettings: orNull(obj), repetition_penalty: num, min_p: num, top_a: num, openrouterProvider: obj,
    useInstructPrompt: bool, customPromptTemplateToggle: str, templateDefaultVariables: str, moduleIntergration: str,
    top_k: num, instructChatTemplate: str, JinjaTemplate: str, jsonSchemaEnabled: bool, jsonSchema: str,
    strictJsonSchema: bool, extractJson: str, groupTemplate: str, groupOtherBotRole: str,
    seperateParametersEnabled: bool, seperateParameters: obj, customAPIFormat: num, systemContentReplacement: str,
    systemRoleReplacement: str, enableCustomFlags: bool, customFlags: arr, image: 'omit', regex: arr, reasonEffort: num,
    thinkingTokens: orNull(num), thinkingType: str, deepseekThinkingType: str, adaptiveThinkingEffort: str,
    deepseekReasoningEffort: str, outputImageModal: bool, seperateModelsForAxModels: bool, seperateModels: orNull(obj),
    modelTools: arr, fallbackModels: obj, fallbackWhenBlankResponse: bool, verbosity: num, dynamicOutput: orNull(obj),
}

/** A preset field whose database field has another name; every other preset field has the same name. */
export const PRESET_DB_ALIASES: Readonly<Record<string, keyof Database>> = {
    NAISettings: 'NAIsettings',
    regex: 'presetRegex',
    reasonEffort: 'reasoningEffort',
}

/** The database field a preset field is written to by `setPreset`. */
export function presetDbName(presetField: string): string {
    return Object.hasOwn(PRESET_DB_ALIASES, presetField) ? PRESET_DB_ALIASES[presetField] : presetField
}

/** The list fields and the index each is paired with; an index travels and applies only with its list. */
export const LIST_PAIRS = [
    { list: 'botPresets', index: 'botPresetsId' },
    { list: 'hypaV3Presets', index: 'hypaV3PresetId' },
    { list: 'translatorPresets', index: 'translatorPresetId' },
] as const satisfies readonly { list: SettingsField, index: SettingsField }[]

/** `presetFolders` has no index of its own; the bot preset list names a folder through each preset. */
export const LIST_FIELD_NAMES: readonly string[] = [
    ...LIST_PAIRS.flatMap((pair) => [pair.list, pair.index]),
    'presetFolders',
]

/**
 * The database fields `presetFromWorkingSettings` reads: the working preset fields plus the flag that decides
 * whether the separate models are saved. Never the omitted connection and endpoint fields.
 */
export const PRESET_SOURCE_FIELDS = [...PRESET_WORKING_FIELDS, 'doNotChangeSeperateModels'] as const

/** The keys whose values are checked more closely than their kind alone: a crafted value of the right kind could break boot. */
export const FALLBACK_MODEL_MEMBERS = ['model', 'memory', 'emotion', 'translate', 'otherAx'] as const

/** `fallbackModels` carries the model ids a request falls back to. Reference-free by the reference rule, plus this shape. */
export function isFallbackModelsShape(value: object): boolean {
    const record = value as Record<string, unknown>
    return FALLBACK_MODEL_MEMBERS.every((member) => {
        const entry = record[member]
        return entry === undefined || (Array.isArray(entry) && entry.every((item) => typeof item === 'string'))
    })
}

/** `hotkeys` rows are read as objects by the key handler; an element of any other kind could break it. */
export function isHotkeysShape(value: object): boolean {
    return Array.isArray(value) && value.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
}
