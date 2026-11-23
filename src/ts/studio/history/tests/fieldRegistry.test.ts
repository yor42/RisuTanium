// The tables derived from the field registry and the strict reader's use of them. T-P1, T-P2 and T-P3 are
// compatibility guards: they pass on the hand-kept tables the registry replaced and must keep passing. T-L1 is a
// diagnostic of the new label accessor.
import { describe, expect, test } from 'vitest'
import { languageEnglish } from '../../../../lang/en'
import { fieldLabelKey } from '../fieldAccess'
import { FIELD_SPECS, type SetPath } from '../fieldRegistry'
import {
    BOOLEAN_SET_PATHS,
    CHARACTER_SET_PATHS,
    CHAT_SET_PATHS,
    parseOwnerRecord,
    RESTORE_PATH_ORDER,
    RESTORE_PATHS_BY_KIND,
    SET_PATHS_BY_KIND,
    TEXT_FIELD_PATHS,
    textPathsFor,
    type OwnerKind as AnyOwnerKind,
} from '../historyModel'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import type { SessionOwnerKind } from '../sessionKinds'
import { PRESET_FORM_BOOLEAN_PATHS, PRESET_FORM_PATHS } from './presetPaths.test-helpers'
import { createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

// The stored kinds: a session kind has no stored key, record or restore row.
type OwnerKind = Exclude<AnyOwnerKind, SessionOwnerKind>

const KEYS: Record<OwnerKind, StoredOwnerKey> = {
    character: characterOwnerKey('c1'),
    chat: chatOwnerKey('c1', 'chat1'),
    module: moduleOwnerKey('m1'),
}
const SET_PATH_OF_KIND: Record<OwnerKind, SetPath> = { character: 'desc', chat: 'note', module: 'customModuleToggle' }
const KINDS: readonly OwnerKind[] = ['character', 'chat', 'module']
const INHERITED_NAMES = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']

function rawRecord(kind: OwnerKind, over: { label?: unknown; path?: unknown; before?: unknown; after?: unknown; restore?: unknown }): unknown {
    const path = over.path ?? SET_PATH_OF_KIND[kind]
    return {
        ownerKey: KEYS[kind],
        touchedAt: 4,
        done: [
            {
                id: 'p:1',
                at: 1,
                label: over.label ?? { kind: 'field', field: SET_PATH_OF_KIND[kind] },
                ops: [{ op: 'set', path, before: over.before ?? { had: false }, after: over.after ?? { had: true, value: 'x' } }],
            },
        ],
        undone: [],
        deleted: [],
        restore: over.restore ?? null,
    }
}

describe('T-P1: the derived tables equal the literal lists (compatibility guard)', () => {
    test('set rows, restore rows, restore order, boolean paths, text paths per kind and the merge text paths', () => {
        const S5 = ['moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding']
        const S1 = ['systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'additionalData.creator', 'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote']
        const S2A = ['creatorNotes', 'removedQuotes']
        const S2B = ['lowLevelAccess', 'utilityBot', 'escapeOutput']
        const S2C = ['bias']
        expect(SET_PATHS_BY_KIND.character).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', ...S1, ...S2A, ...S2B, ...S2C])
        expect(SET_PATHS_BY_KIND.chat).toEqual(['note'])
        expect(SET_PATHS_BY_KIND.module).toEqual(['customModuleToggle', ...S5])
        expect(CHARACTER_SET_PATHS).toEqual(SET_PATHS_BY_KIND.character)
        expect(CHAT_SET_PATHS).toEqual(['note'])
        expect(RESTORE_PATHS_BY_KIND.character).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', ...S1, ...S2A, ...S2B, ...S2C, 'alternateGreetings'])
        expect(RESTORE_PATHS_BY_KIND.chat).toEqual(['note'])
        expect(RESTORE_PATHS_BY_KIND.module).toEqual(['customModuleToggle', ...S5])
        expect(RESTORE_PATH_ORDER).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note', ...S1, ...S5, ...PRESET_FORM_PATHS, ...S2A, ...S2B, ...S2C, 'alternateGreetings'])
        expect(BOOLEAN_SET_PATHS).toEqual(['hideChatIcon', 'risutanium_render_when_complete', 'moduleHideIcon', 'moduleLowLevelAccess', ...PRESET_FORM_BOOLEAN_PATHS, 'removedQuotes', ...S2B])
        expect(textPathsFor('character')).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', ...S1, 'creatorNotes'])
        expect(textPathsFor('chat')).toEqual(['note'])
        expect(textPathsFor('module')).toEqual(['customModuleToggle', 'moduleName', 'moduleDescription', 'moduleNamespace', 'backgroundEmbedding'])
        expect(TEXT_FIELD_PATHS).toEqual(['desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'defaultVariables', 'translatorNote', 'backgroundEmbedding', 'creatorNotes'])
    })

    test('no row combines keepForeign with a biasList value', () => {
        for (const [path, facts] of Object.entries(FIELD_SPECS)) {
            expect(facts.value === 'biasList' && 'keepForeign' in facts, path).toBe(false)
        }
    })
})

describe('T-P2: a name inherited from Object is no path (compatibility guard)', () => {
    // The label is the one place no other rule masks: Rule K refuses a set op outside the row and the restore keys are
    // matched against the row's array.
    test.each(KINDS)('%s: a field label, a set op path or a restore key named like an Object member refuses the record whole', (kind) => {
        expect(parseOwnerRecord(rawRecord(kind, {}), KEYS[kind]), 'the valid record reads').not.toBeNull()
        for (const name of INHERITED_NAMES) {
            expect(parseOwnerRecord(rawRecord(kind, { label: { kind: 'field', field: name } }), KEYS[kind]), `label ${name}`).toBeNull()
            expect(parseOwnerRecord(rawRecord(kind, { path: name }), KEYS[kind]), `set op ${name}`).toBeNull()
            const restore = { visitId: 'v1', at: 2, fields: { [name]: { before: { had: false }, last: { had: false } } } }
            expect(parseOwnerRecord(rawRecord(kind, { restore }), KEYS[kind]), `restore ${name}`).toBeNull()
        }
    })

    test('through the store: a stored step label edited to an Object member name reads unreadable', () => {
        const shared = new Map<string, string>()
        seedOwner(
            shared,
            { ownerKey: KEYS.character, touchedAt: 4, done: [{ id: 'p:1', at: 1, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'a' }, after: { had: true, value: 'b' } }] }], undone: [], deleted: [], restore: null },
            'w:1',
        )
        expect(storedRecord(shared, KEYS.character)).not.toBeNull()
        const edited = [...shared].filter(([, text]) => text.includes('"field":"desc"'))
        expect(edited.length).toBe(1)
        shared.set(edited[0][0], edited[0][1].replace('"field":"desc"', '"field":"toString"'))
        expect(storedRecord(shared, KEYS.character)).toBeNull()
        return createMemoryStudioStore({ shared }).load(KEYS.character).then((result) => expect(result).toEqual({ kind: 'unreadable' }))
    })
})

describe('T-P3: a value of the wrong type for a registered path refuses the record whole (compatibility guard)', () => {
    // The session-only paths (no builtin holder) have no stored record to refuse.
    const rows = Object.entries(FIELD_SPECS)
        .map(([path, facts]) => ({ path: path as SetPath, facts }))
        .filter(({ path }) => KINDS.some((candidate) => SET_PATHS_BY_KIND[candidate].includes(path)))

    test.each(rows)('$path', ({ path, facts }) => {
        const kind = KINDS.find((candidate) => SET_PATHS_BY_KIND[candidate].includes(path)) as OwnerKind
        const right = facts.value === 'bool' ? true : facts.value === 'biasList' ? [['tok', 5]] : 'x'
        const wrong = facts.value === 'bool' ? 'x' : facts.value === 'biasList' ? 'x' : true
        const restoreOf = (value: unknown): unknown => ({ visitId: 'v1', at: 2, fields: { [path]: { before: { had: false }, last: { had: true, value } } } })
        expect(parseOwnerRecord(rawRecord(kind, { path, label: { kind: 'field', field: path }, after: { had: true, value: right } }), KEYS[kind]), 'right set').not.toBeNull()
        expect(parseOwnerRecord(rawRecord(kind, { path, label: { kind: 'field', field: path }, after: { had: true, value: wrong } }), KEYS[kind]), 'wrong set').toBeNull()
        expect(parseOwnerRecord(rawRecord(kind, { path, label: { kind: 'field', field: path }, after: { had: true, value: right }, restore: restoreOf(right) }), KEYS[kind]), 'right restore').not.toBeNull()
        expect(parseOwnerRecord(rawRecord(kind, { path, label: { kind: 'field', field: path }, after: { had: true, value: right }, restore: restoreOf(wrong) }), KEYS[kind]), 'wrong restore').toBeNull()
    })
})

describe('T-L1: the label key of every registered path (diagnostic)', () => {
    const EXPECTED: Record<SetPath, string> = {
        desc: 'description',
        firstMessage: 'firstMessage',
        exampleMessage: 'exampleMessage',
        customModuleToggle: 'customPromptTemplateToggle',
        hideChatIcon: 'hideChatIcon',
        risutanium_render_when_complete: 'studioFormRenderWhenComplete',
        note: 'note',
        systemPrompt: 'systemPrompt',
        replaceGlobalNote: 'replaceGlobalNote',
        additionalText: 'additionalText',
        personality: 'personality',
        scenario: 'scenario',
        'depth_prompt.prompt': 'depthPrompt',
        'additionalData.creator': 'creator',
        'additionalData.character_version': 'CharVersion',
        nickname: 'nickname',
        defaultVariables: 'defaultVariables',
        translatorNote: 'translatorNote',
        moduleName: 'name',
        moduleDescription: 'description',
        moduleNamespace: 'namespace',
        moduleHideIcon: 'hideChatIcon',
        moduleLowLevelAccess: 'lowLevelAccess',
        backgroundEmbedding: 'backgroundHTML',
        presetName: 'name',
        presetMainPrompt: 'mainPrompt',
        presetJailbreak: 'jailbreakPrompt',
        presetGlobalNote: 'globalNote',
        presetPromptPreprocess: 'promptPreprocess',
        presetPostEndInnerFormat: 'postEndInnerFormat',
        presetSendChatAsSystem: 'sendChatAsSystem',
        presetSendName: 'formatGroupInSingle',
        presetTrimStartNewChat: 'trimStartNewChat',
        presetUtilOverride: 'utilOverride',
        presetCustomChainOfThought: 'customChainOfThought',
        presetJsonSchemaEnabled: 'enableJsonSchema',
        presetOutputImageModal: 'outputImageModal',
        presetStrictJsonSchema: 'strictJsonSchema',
        presetJsonSchema: 'jsonSchema',
        presetExtractJson: 'extractJson',
        presetGroupOtherBotRole: 'groupOtherBotRole',
        presetTemplateDefaultVariables: 'defaultVariables',
        presetAutoSuggestPrompt: 'autoSuggest',
        presetGroupTemplate: 'groupInnerFormat',
        presetSystemContentReplacement: 'systemContentReplacement',
        presetSystemRoleReplacement: 'systemRoleReplacement',
        presetFallbackWhenBlank: 'fallbackWhenBlankResponse',
        presetModuleIntegration: 'moduleIntergration',
        presetUseInstructPrompt: 'useInstructPrompt',
        presetAutoSuggestPrefix: 'studioPresetAutoSuggestPrefix',
        presetAutoSuggestClean: 'studioPresetAutoSuggestClean',
        presetDynamicAutoAdjustSchema: 'studioPresetDynamicAutoAdjustSchema',
        presetDynamicMessages: 'studioPresetDynamicMessages',
        presetDynamicMemory: 'studioPresetDynamicMemory',
        presetDynamicResponseTiming: 'studioPresetDynamicResponseTiming',
        presetDynamicOutputPrompt: 'studioPresetDynamicOutputPrompt',
        presetDynamicShowTypingEffect: 'studioPresetDynamicShowTypingEffect',
        presetDynamicRequest: 'studioPresetDynamicRequest',
        creatorNotes: 'creatorNotes',
        removedQuotes: 'studioFieldRemovedQuotes',
        lowLevelAccess: 'lowLevelAccess',
        utilityBot: 'utilityBot',
        escapeOutput: 'escapeOutput',
        bias: 'studioFieldBias',
    }

    test.each(Object.entries(EXPECTED))('%s', (path, key) => {
        expect(fieldLabelKey(path as SetPath)).toBe(key)
        expect(typeof (languageEnglish as Record<string, unknown>)[key]).toBe('string')
    })
})
