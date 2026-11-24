import { describe, expect, test } from 'vitest'
import type { triggerEffectV1, triggerEffectV2 } from '../../../process/triggers'
import { KNOWN_V2_TYPES, V1_EFFECT_TYPES } from '../../assets/referenceTargets'
import { effectKindOf, hasEngineCase, runsOnEveryTrigger } from '../triggerKinds'

// Complete and exact under the type check: a type added to or removed from the engine's unions fails `pnpm check` here.
const V2_TYPES: Record<triggerEffectV2['type'], true> = {
    v2Header: true,
    v2If: true,
    v2Else: true,
    v2EndIndent: true,
    v2SetVar: true,
    v2Loop: true,
    v2LoopNTimes: true,
    v2BreakLoop: true,
    v2RunTrigger: true,
    v2ConsoleLog: true,
    v2StopTrigger: true,
    v2CutChat: true,
    v2ModifyChat: true,
    v2SystemPrompt: true,
    v2Impersonate: true,
    v2Command: true,
    v2SendAIprompt: true,
    v2ImgGen: true,
    v2CheckSimilarity: true,
    v2RunLLM: true,
    v2ShowAlert: true,
    v2ExtractRegex: true,
    v2GetLastMessage: true,
    v2GetMessageAtIndex: true,
    v2GetMessageCount: true,
    v2ModifyLorebook: true,
    v2GetLorebook: true,
    v2GetLorebookCount: true,
    v2GetLorebookEntry: true,
    v2SetLorebookActivation: true,
    v2GetLorebookIndexViaName: true,
    v2Random: true,
    v2GetCharAt: true,
    v2GetCharCount: true,
    v2ToLowerCase: true,
    v2ToUpperCase: true,
    v2SetCharAt: true,
    v2SplitString: true,
    v2JoinArrayVar: true,
    v2GetCharacterDesc: true,
    v2SetCharacterDesc: true,
    v2GetPersonaDesc: true,
    v2SetPersonaDesc: true,
    v2MakeArrayVar: true,
    v2GetArrayVarLength: true,
    v2GetArrayVar: true,
    v2SetArrayVar: true,
    v2PushArrayVar: true,
    v2PopArrayVar: true,
    v2ShiftArrayVar: true,
    v2UnshiftArrayVar: true,
    v2SpliceArrayVar: true,
    v2SliceArrayVar: true,
    v2GetIndexOfValueInArrayVar: true,
    v2RemoveIndexFromArrayVar: true,
    v2ConcatString: true,
    v2GetLastUserMessage: true,
    v2GetLastCharMessage: true,
    v2GetFirstMessage: true,
    v2GetAlertInput: true,
    v2GetDisplayState: true,
    v2SetDisplayState: true,
    v2GetRequestState: true,
    v2GetRequestStateRole: true,
    v2SetRequestState: true,
    v2SetRequestStateRole: true,
    v2GetRequestStateLength: true,
    v2UpdateGUI: true,
    v2UpdateChatAt: true,
    v2Wait: true,
    v2IfAdvanced: true,
    v2QuickSearchChat: true,
    v2StopPromptSending: true,
    v2Tokenize: true,
    v2GetAllLorebooks: true,
    v2RegexTest: true,
    v2GetLorebookByName: true,
    v2GetLorebookByIndex: true,
    v2CreateLorebook: true,
    v2ModifyLorebookByIndex: true,
    v2DeleteLorebookByIndex: true,
    v2GetLorebookCountNew: true,
    v2SetLorebookAlwaysActive: true,
    v2GetAlertSelect: true,
    v2GetReplaceGlobalNote: true,
    v2SetReplaceGlobalNote: true,
    v2GetAuthorNote: true,
    v2SetAuthorNote: true,
    v2MakeDictVar: true,
    v2GetDictVar: true,
    v2SetDictVar: true,
    v2DeleteDictKey: true,
    v2HasDictKey: true,
    v2ClearDict: true,
    v2GetDictSize: true,
    v2GetDictKeys: true,
    v2GetDictValues: true,
    v2Calculate: true,
    v2ReplaceString: true,
    v2Comment: true,
    v2DeclareLocalVar: true,
};

const V1_TYPES: Record<triggerEffectV1['type'], true> = {
    cutchat: true,
    modifychat: true,
    runImgGen: true,
    extractRegex: true,
    runLLM: true,
    checkSimilarity: true,
    sendAIprompt: true,
    showAlert: true,
    setvar: true,
    systemprompt: true,
    impersonate: true,
    command: true,
    stop: true,
    runtrigger: true,
    runAxLLM: true,
};

const V2_NAMES = Object.keys(V2_TYPES)
const V1_NAMES = Object.keys(V1_TYPES)

describe('the engine type sets mirrored by the Studio', () => {
    test('compatibility guard (passes before and after): KNOWN_V2_TYPES is the 101 distinct V2 types of the union', () => {
        expect(KNOWN_V2_TYPES.length).toBe(101)
        expect(new Set(KNOWN_V2_TYPES).size).toBe(101)
        expect([...KNOWN_V2_TYPES].sort()).toEqual([...V2_NAMES].sort())
    })

    test('compatibility guard (passes before and after): V1_EFFECT_TYPES is the 15 V1 effect types of the union', () => {
        expect(V1_EFFECT_TYPES.size).toBe(15)
        expect([...V1_EFFECT_TYPES].sort()).toEqual([...V1_NAMES].sort())
    })
})

describe('hasEngineCase', () => {
    test('regression reproducer: holds for every one of the 101 V2 types', () => {
        const missing = V2_NAMES.filter((type) => !hasEngineCase(type))
        expect(missing).toEqual([])
    })

    test('regression reproducer: holds for every one of the 15 V1 types', () => {
        const missing = V1_NAMES.filter((type) => !hasEngineCase(type))
        expect(missing).toEqual([])
    })

    test('regression reproducer: holds for triggerlua', () => {
        expect(hasEngineCase('triggerlua')).toBe(true)
    })

    test.each(['triggercode', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'v2Made', 'setVar', 42, undefined, null, {}, ['setvar']])(
        'is false for %s: the legacy code type and anything the engine has no case for',
        (type) => {
            expect(hasEngineCase(type)).toBe(false)
        },
    )

    test('regression reproducer: exactly 117 types have a case', () => {
        const everything = new Set<string>([...V2_NAMES, ...V1_NAMES, 'triggerlua'])
        expect(everything.size).toBe(117)
        expect([...everything].filter(hasEngineCase).length).toBe(117)
    })
})

describe('effectKindOf', () => {
    test('regression reproducer: maps each class of effect type', () => {
        expect(V2_NAMES.filter((type) => effectKindOf(type) !== 'v2')).toEqual([])
        expect(V1_NAMES.filter((type) => effectKindOf(type) !== 'v1')).toEqual([])
        expect(effectKindOf('triggerlua')).toBe('lua')
        expect(effectKindOf('triggercode')).toBe('legacy')
    })

    test.each(['', 'constructor', '__proto__', 'toString', 'v2Made', 42, undefined, null, {}])(
        'compatibility guard (passes before and after): %s is of no class',
        (type) => {
            expect(effectKindOf(type)).toBe('unknown')
        },
    )
})

describe('runsOnEveryTrigger', () => {
    const row = (effect: unknown) => ({ comment: '', type: 'manual', conditions: [], effect })

    test('regression reproducer: holds when the first effect is Lua or legacy code', () => {
        expect(runsOnEveryTrigger(row([{ type: 'triggerlua', code: '' }]))).toBe(true)
        expect(runsOnEveryTrigger(row([{ type: 'triggercode', code: '' }, { type: 'setvar' }]))).toBe(true)
    })

    test('regression reproducer: an object-keyed or array-like effect is read at index 0 as the engine does', () => {
        expect(runsOnEveryTrigger(row({ 0: { type: 'triggerlua' } }))).toBe(true)
        expect(runsOnEveryTrigger(row({ 0: { type: 'triggerlua' }, length: 1 }))).toBe(true)
        expect(runsOnEveryTrigger(row({ 1: { type: 'triggerlua' } }))).toBe(false)
    })

    test('compatibility guard (passes before and after): does not hold for rows that do not start with code', () => {
        expect(runsOnEveryTrigger(row([{ type: 'setvar' }, { type: 'triggerlua', code: '' }]))).toBe(false)
        expect(runsOnEveryTrigger(row([]))).toBe(false)
        expect(runsOnEveryTrigger(row(undefined))).toBe(false)
        expect(runsOnEveryTrigger(row('triggerlua'))).toBe(false)
        expect(runsOnEveryTrigger(row(['triggerlua']))).toBe(false)
        expect(runsOnEveryTrigger(row([null]))).toBe(false)
        expect(runsOnEveryTrigger({ comment: '', type: 'manual', conditions: [] })).toBe(false)
        expect(runsOnEveryTrigger(null)).toBe(false)
        expect(runsOnEveryTrigger('triggerlua')).toBe(false)
        expect(runsOnEveryTrigger(undefined)).toBe(false)
    })
})
