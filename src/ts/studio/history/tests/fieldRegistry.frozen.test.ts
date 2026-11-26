// Append-only guard of the persisted facts of every registered set path. A path new to older builds is refused whole by
// them, and an existing path's facts decide how records written earlier replay, so a row of FROZEN_FIELD_FACTS is
// never edited or removed: a later PR appends its own row (with its own readBack and whole-record refusal tests) and
// lifts the rule assertions (F-d′, F-e) only when it implements further nested containers or value kinds. F-e admits
// text, bool, `number`, `textList` and `biasList`; `biasList` has its own reader, writer, parse guard and structural
// comparison, and `number` (S4b) and `textList` (S4c) are carried by session-only paths alone. This table is a literal on purpose: deriving it from the registry would make the guard pass for any registry.
import { describe, expect, test } from 'vitest'
import { CONTAINER_SEEDS, FIELD_SPECS, type FieldFacts } from '../fieldRegistry'
import { RESTORE_PATH_ORDER } from '../historyModel'

const FROZEN_FIELD_FACTS: readonly (readonly [string, FieldFacts])[] = [
    ['desc', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: true }],
    ['firstMessage', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['exampleMessage', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['customModuleToggle', { value: 'text', holders: ['character', 'module'], absent: 'delete', editWhenAbsent: true }],
    ['hideChatIcon', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['risutanium_render_when_complete', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['note', { value: 'text', holders: ['chat'], absent: 'keep', editWhenAbsent: true }],
    ['systemPrompt', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['replaceGlobalNote', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['additionalText', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['personality', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['scenario', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['depth_prompt.prompt', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['additionalData.creator', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['additionalData.character_version', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['nickname', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['defaultVariables', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['translatorNote', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['moduleName', { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'name', keepForeign: true }],
    ['moduleDescription', { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'description', keepForeign: true }],
    ['moduleNamespace', { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'namespace', keepForeign: true }],
    ['moduleHideIcon', { value: 'bool', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'hideIcon', keepForeign: true }],
    ['moduleLowLevelAccess', { value: 'bool', holders: ['module'], absent: 'delete', editWhenAbsent: true, property: 'lowLevelAccess', keepForeign: true }],
    ['backgroundEmbedding', { value: 'text', holders: ['module'], absent: 'delete', editWhenAbsent: true, keepForeign: true }],
    // The preset advanced form's session-only paths (S4a): no builtin holder, listed by the preset session kind.
    ['presetName', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetMainPrompt', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetJailbreak', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetGlobalNote', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetPromptPreprocess', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetPostEndInnerFormat', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetSendChatAsSystem', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetSendName', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetTrimStartNewChat', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetUtilOverride', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetCustomChainOfThought', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetJsonSchemaEnabled', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetOutputImageModal', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetStrictJsonSchema', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetJsonSchema', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetExtractJson', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetGroupOtherBotRole', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetTemplateDefaultVariables', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAutoSuggestPrompt', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetGroupTemplate', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetSystemContentReplacement', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetSystemRoleReplacement', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFallbackWhenBlank', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetModuleIntegration', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetUseInstructPrompt', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAutoSuggestPrefix', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAutoSuggestClean', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicAutoAdjustSchema', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicMessages', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicMemory', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicResponseTiming', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicOutputPrompt', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicShowTypingEffect', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDynamicRequest', { value: 'bool', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['creatorNotes', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['removedQuotes', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['lowLevelAccess', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['utilityBot', { value: 'bool', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['escapeOutput', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['bias', { value: 'biasList', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    // The preset advanced form's model and parameter paths (S4b): session-only; the `number` rows are the first number kind.
    ['presetAiModel', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetSubModel', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAuxMemory', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAuxTranslate', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAuxEmotion', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAuxOtherAx', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetMaxContext', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetMaxResponse', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetThinkingType', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDeepseekThinkingType', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetThinkingTokens', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetAdaptiveThinkingEffort', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetDeepseekReasoningEffort', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetTemperature', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetTopK', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetMinP', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetTopA', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetRepetitionPenalty', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetReasonEffort', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetVerbosity', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetTopP', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFrequencyPenalty', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetPresencePenalty', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetMaxThoughtTagDepth', { value: 'number', holders: [], absent: 'keep', editWhenAbsent: true }],
    // The preset advanced form's list paths (S4c): session-only, no builtin holder.
    ['presetModelTools', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetLocalStopStrings', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetBias', { value: 'biasList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFormatingOrder', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFallbackModel', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFallbackMemory', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFallbackTranslate', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFallbackEmotion', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    ['presetFallbackOtherAx', { value: 'textList', holders: [], absent: 'keep', editWhenAbsent: true }],
    // The preset icon (S4d): session-only, no builtin holder.
    ['presetImage', { value: 'text', holders: [], absent: 'keep', editWhenAbsent: true }],
    // The lore plus setting (S7): a registry boolean on the character.
    ['lorePlus', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    // Studio S3a: the name and the Display form's paths, then the four newGenData keys.
    ['name', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['viewScreen', { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: false }],
    ['largePortrait', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['inlayViewScreen', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['prebuiltAssetCommand', { value: 'bool', holders: ['character'], absent: 'delete', editWhenAbsent: true, keepForeign: true }],
    ['prebuiltAssetStyle', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['newGenData.prompt', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['newGenData.negative', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['newGenData.instructions', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['newGenData.emotionInstructions', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true }],
    ['backgroundHTML', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true, keepForeign: true }],
    ['virtualscript', { value: 'text', holders: ['character'], absent: 'delete', editWhenAbsent: true, keepForeign: true }],
    // #729: unreadable character bias list repair row.
    ['biasFix', { value: 'biasList', holders: ['character'], absent: 'delete', editWhenAbsent: true, property: 'bias', keepForeign: true }],
]

// The containers a dotted path names, with the value an absent container reads as. An undo replays a seed reading, so
// the seeds are persisted facts.
const FROZEN_CONTAINER_SEEDS = {
    depth_prompt: { depth: 0, prompt: '' },
    additionalData: { tag: [], creator: '', character_version: '' },
    newGenData: { prompt: '', negative: '', instructions: '', emotionInstructions: '' },
}

describe('T-FZ: the persisted facts of the registered paths are frozen', () => {
    test('F-a: the registry holds exactly the frozen paths, in order', () => {
        expect(Object.keys(FIELD_SPECS)).toEqual(FROZEN_FIELD_FACTS.map(([path]) => path))
    })

    test('F-b: each registered entry holds exactly its frozen facts (no added, removed or changed fact)', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const [path, facts] of FROZEN_FIELD_FACTS) {
            expect(specs[path], path).toStrictEqual(facts)
        }
    })

    test('F-c: the restore order is the frozen paths followed by the list path', () => {
        expect(RESTORE_PATH_ORDER).toEqual([...FROZEN_FIELD_FACTS.map(([path]) => path), 'alternateGreetings'])
    })

    test('F-d′: a dotted path names one registered container and a key, is character-held only and has no property; no property has a dot', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const path of Object.keys(specs)) {
            expect(specs[path].property ?? '', path).not.toContain('.')
            if (!path.includes('.')) {
                continue
            }
            const parts = path.split('.')
            expect(parts, path).toHaveLength(2)
            expect(parts[0].length, path).toBeGreaterThan(0)
            expect(parts[1].length, path).toBeGreaterThan(0)
            expect(Object.keys(CONTAINER_SEEDS), path).toContain(parts[0])
            expect(specs[path].property, path).toBeUndefined()
            expect(specs[path].holders, path).toEqual(['character'])
        }
    })

    test('F-f: the container seeds are frozen, in key order', () => {
        expect(CONTAINER_SEEDS).toStrictEqual(FROZEN_CONTAINER_SEEDS)
        expect(Object.keys(CONTAINER_SEEDS)).toEqual(Object.keys(FROZEN_CONTAINER_SEEDS))
    })

    test('F-g: keepForeign is set on the module rows of S5 and on the character rows prebuiltAssetCommand, backgroundHTML, virtualscript and biasFix, and only with editWhenAbsent', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        const foreignPaths = Object.keys(specs).filter((path) => specs[path].keepForeign === true)
        expect(foreignPaths).toEqual(['moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding', 'prebuiltAssetCommand', 'backgroundHTML', 'virtualscript', 'biasFix'])
        const characterForeign = new Set(['prebuiltAssetCommand', 'backgroundHTML', 'virtualscript', 'biasFix'])
        for (const path of foreignPaths) {
            expect(specs[path].editWhenAbsent, path).toBe(true)
            expect(specs[path].holders, path).toEqual(characterForeign.has(path) ? ['character'] : ['module'])
        }
    })
    test('F-e: every value type is text, bool, number, textList or biasList; a number or textList path is session-only (no builtin holder)', () => {
        const specs: Record<string, FieldFacts> = FIELD_SPECS
        for (const path of Object.keys(specs)) {
            expect(['text', 'bool', 'number', 'textList', 'biasList'], path).toContain(specs[path].value)
            if (specs[path].value === 'number' || specs[path].value === 'textList') {
                expect(specs[path].holders, path).toEqual([])
            }
        }
    })
})
