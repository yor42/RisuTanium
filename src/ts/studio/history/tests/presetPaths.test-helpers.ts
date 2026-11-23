// The preset advanced form's session-only registry paths (stage S4a), in registry order: the literal the restore-order
// pins append after the stored kinds' paths. Only the preset session kind's set row holds them.
export const PRESET_FORM_PATHS = [
    'presetName',
    'presetMainPrompt',
    'presetJailbreak',
    'presetGlobalNote',
    'presetPromptPreprocess',
    'presetPostEndInnerFormat',
    'presetSendChatAsSystem',
    'presetSendName',
    'presetTrimStartNewChat',
    'presetUtilOverride',
    'presetCustomChainOfThought',
    'presetJsonSchemaEnabled',
    'presetOutputImageModal',
    'presetStrictJsonSchema',
    'presetJsonSchema',
    'presetExtractJson',
    'presetGroupOtherBotRole',
    'presetTemplateDefaultVariables',
    'presetAutoSuggestPrompt',
    'presetGroupTemplate',
    'presetSystemContentReplacement',
    'presetSystemRoleReplacement',
    'presetFallbackWhenBlank',
    'presetModuleIntegration',
    'presetUseInstructPrompt',
    'presetAutoSuggestPrefix',
    'presetAutoSuggestClean',
    'presetDynamicAutoAdjustSchema',
    'presetDynamicMessages',
    'presetDynamicMemory',
    'presetDynamicResponseTiming',
    'presetDynamicOutputPrompt',
    'presetDynamicShowTypingEffect',
    'presetDynamicRequest',
] as const

// The model and parameter paths (stage S4b), appended after every path above and after the stored kinds' later paths: the
// literal the restore-order pins end with (before the greeting list).
export const PRESET_S4B_PATHS = [
    'presetAiModel',
    'presetSubModel',
    'presetAuxMemory',
    'presetAuxTranslate',
    'presetAuxEmotion',
    'presetAuxOtherAx',
    'presetMaxContext',
    'presetMaxResponse',
    'presetThinkingType',
    'presetDeepseekThinkingType',
    'presetThinkingTokens',
    'presetAdaptiveThinkingEffort',
    'presetDeepseekReasoningEffort',
    'presetTemperature',
    'presetTopK',
    'presetMinP',
    'presetTopA',
    'presetRepetitionPenalty',
    'presetReasonEffort',
    'presetVerbosity',
    'presetTopP',
    'presetFrequencyPenalty',
    'presetPresencePenalty',
    'presetMaxThoughtTagDepth',
] as const

// The list paths (stage S4c), appended after every path above: the literal the restore-order pins end with (before the
// greeting list). The bias list is the only bias-list path; every other one carries a list of strings.
export const PRESET_S4C_PATHS = [
    'presetModelTools',
    'presetLocalStopStrings',
    'presetBias',
    'presetFormatingOrder',
    'presetFallbackModel',
    'presetFallbackMemory',
    'presetFallbackTranslate',
    'presetFallbackEmotion',
    'presetFallbackOtherAx',
] as const

// The icon path (stage S4d), appended after the S4c paths: the last literal the restore-order pins end with (before the
// greeting list).
export const PRESET_S4D_PATHS = ['presetImage'] as const

// The number ones of the S4b paths; every other S4b path carries text.
export const PRESET_S4B_NUMBER_PATHS = [
    'presetMaxContext',
    'presetMaxResponse',
    'presetThinkingTokens',
    'presetTemperature',
    'presetTopK',
    'presetMinP',
    'presetTopA',
    'presetRepetitionPenalty',
    'presetReasonEffort',
    'presetVerbosity',
    'presetTopP',
    'presetFrequencyPenalty',
    'presetPresencePenalty',
    'presetMaxThoughtTagDepth',
] as const

// The boolean ones of those paths.
export const PRESET_FORM_BOOLEAN_PATHS = [
    'presetPromptPreprocess',
    'presetSendChatAsSystem',
    'presetSendName',
    'presetTrimStartNewChat',
    'presetUtilOverride',
    'presetCustomChainOfThought',
    'presetJsonSchemaEnabled',
    'presetOutputImageModal',
    'presetStrictJsonSchema',
    'presetFallbackWhenBlank',
    'presetUseInstructPrompt',
    'presetAutoSuggestClean',
    'presetDynamicAutoAdjustSchema',
    'presetDynamicMessages',
    'presetDynamicMemory',
    'presetDynamicResponseTiming',
    'presetDynamicOutputPrompt',
    'presetDynamicShowTypingEffect',
    'presetDynamicRequest',
] as const
