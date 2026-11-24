// @vitest-environment jsdom

/**
 * TS10, defaults half: `v2DefaultEffect(type)` equals, key order included, the effect the real classic
 * `TriggerV2List` appends when a user opens the add picker, chooses the type and presses Save. The classic
 * component is mounted unchanged and driven live, so the goldens are recorded by the producer
 * (maintainer decision MC-329); nothing here is transcribed from classic source except the Else default, which
 * no picker category offers and which the oracle therefore copies.
 *
 * Titles saying "regression reproducer" fail against a Studio module that returns the wrong effect;
 * titles saying "compatibility guard" pass before and after and check the recorder itself.
 */
import { writable } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/process/triggers'), () => ({
    displayAllowList: ['v2GetDisplayState', 'v2SetDisplayState'],
    requestAllowList: ['v2GetRequestState', 'v2SetRequestState', 'v2GetRequestStateRole', 'v2SetRequestStateRole', 'v2GetRequestStateLength'],
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { showDeprecatedTriggerV2: true, showDeprecatedTriggerV1: true } as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        alertStore: writable({ type: 'none', msg: '' }),
        disableHighlight: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

import type { Component } from 'svelte'
import { language } from 'src/lang'
import TriggerV2List from 'src/lib/SideBars/Scripts/TriggerV2List.svelte'
import { V2_DEFAULT_TYPES, v2DefaultEffect, type V2DefaultType } from '../triggerV2Defaults'
import { CLASSIC_V2ELSE_DEFAULT } from './classicTriggerOracle'
import {
    categoryButtons, categoryLabelOf, chooseCategory, mountBound, openPicker, openV2Panel, pickAndSave, snapshotOf,
    typeButtons, typeLabelOf, unmountAll, v2ListWith, type V2EventKind,
} from './classicTriggerDriver.test-helpers.svelte'
import { exactEqual, firstDifference } from './triggerExactEqual.test-helpers'

/** The 12 categories of the classic add picker, in rendered order, with the 98 types each offers. */
const PICKER_TABLE: ReadonlyArray<readonly [string, readonly V2DefaultType[]]> = [
    ['Special', ['v2GetDisplayState', 'v2SetDisplayState', 'v2GetRequestState', 'v2SetRequestState', 'v2GetRequestStateRole', 'v2SetRequestStateRole', 'v2GetRequestStateLength']],
    ['Control', ['v2SetVar', 'v2DeclareLocalVar', 'v2Calculate', 'v2IfAdvanced', 'v2LoopNTimes', 'v2Loop', 'v2BreakLoop', 'v2Command', 'v2ConsoleLog', 'v2RunTrigger', 'v2StopTrigger', 'v2Comment']],
    ['Chat', ['v2CutChat', 'v2ModifyChat', 'v2Impersonate', 'v2GetLastMessage', 'v2GetLastUserMessage', 'v2GetLastCharMessage', 'v2GetMessageAtIndex', 'v2GetMessageCount', 'v2GetFirstMessage', 'v2QuickSearchChat']],
    ['Low Level', ['v2SendAIprompt', 'v2ImgGen', 'v2CheckSimilarity', 'v2RunLLM']],
    ['Alert', ['v2ShowAlert', 'v2GetAlertInput', 'v2GetAlertSelect']],
    ['Lorebook V2', ['v2GetAllLorebooks', 'v2GetLorebookByName', 'v2GetLorebookByIndex', 'v2CreateLorebook', 'v2ModifyLorebookByIndex', 'v2DeleteLorebookByIndex', 'v2GetLorebookCountNew', 'v2SetLorebookAlwaysActive']],
    ['String', ['v2RegexTest', 'v2ExtractRegex', 'v2GetCharAt', 'v2GetCharCount', 'v2ToLowerCase', 'v2ToUpperCase', 'v2SetCharAt', 'v2SplitString', 'v2ConcatString', 'v2ReplaceString']],
    ['Data', ['v2GetCharacterDesc', 'v2SetCharacterDesc', 'v2GetPersonaDesc', 'v2SetPersonaDesc', 'v2GetReplaceGlobalNote', 'v2SetReplaceGlobalNote', 'v2GetAuthorNote', 'v2SetAuthorNote']],
    ['Array', ['v2MakeArrayVar', 'v2GetArrayVarLength', 'v2GetArrayVar', 'v2SetArrayVar', 'v2PushArrayVar', 'v2PopArrayVar', 'v2ShiftArrayVar', 'v2UnshiftArrayVar', 'v2SpliceArrayVar', 'v2SliceArrayVar', 'v2GetIndexOfValueInArrayVar', 'v2RemoveIndexFromArrayVar', 'v2JoinArrayVar']],
    ['Dictionary', ['v2MakeDictVar', 'v2GetDictVar', 'v2SetDictVar', 'v2DeleteDictKey', 'v2HasDictKey', 'v2ClearDict', 'v2GetDictSize', 'v2GetDictKeys', 'v2GetDictValues']],
    ['Others', ['v2Random', 'v2UpdateGUI', 'v2SystemPrompt', 'v2UpdateChatAt', 'v2Wait', 'v2StopPromptSending', 'v2Tokenize']],
    ['Deprecated', ['v2If', 'v2ModifyLorebook', 'v2GetLorebook', 'v2GetLorebookCount', 'v2GetLorebookEntry', 'v2SetLorebookActivation', 'v2GetLorebookIndexViaName']],
]

const PICKABLE: V2DefaultType[] = PICKER_TABLE.flatMap(([, types]) => [...types])

/** What the picker offers for each kind of event: a manual event hides Special, display and request show only their own types. */
const DISPLAY_TYPES: readonly string[] = ['v2GetDisplayState', 'v2SetDisplayState']
const REQUEST_TYPES: readonly string[] = ['v2GetRequestState', 'v2SetRequestState', 'v2GetRequestStateRole', 'v2SetRequestStateRole', 'v2GetRequestStateLength']

function offeredFor(kind: V2EventKind): Array<readonly [string, readonly V2DefaultType[]]> {
    if (kind === 'manual') return PICKER_TABLE.filter(([category]) => category !== 'Special')
    const allowed = kind === 'display' ? DISPLAY_TYPES : REQUEST_TYPES
    return [['Special', PICKABLE.filter((type) => allowed.includes(type))]]
}

const recorded = new Map<string, unknown>()
const pickerProblems: string[] = []

async function recordKind(kind: V2EventKind): Promise<void> {
    await unmountAll()
    const list = mountBound(TriggerV2List as unknown as Component<never>, v2ListWith(kind), { lowLevelAble: true })
    await openV2Panel()
    const offered = offeredFor(kind)
    await openPicker()
    const labels = categoryButtons().map(categoryLabelOf)
    const expectedLabels = offered.map(([category]) => language.triggerCategories[category] || category)
    if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
        pickerProblems.push(`${kind}: categories ${JSON.stringify(labels)} != ${JSON.stringify(expectedLabels)}`)
    }
    for (let c = 0; c < offered.length; c++) {
        const [category, types] = offered[c]
        for (let t = 0; t < types.length; t++) {
            if (categoryButtons().length === 0) await openPicker()
            await chooseCategory(c)
            const renderedTypes = typeButtons().map(typeLabelOf)
            const expectedTypes = types.map((type) => String(language.triggerDesc[type]))
            if (JSON.stringify(renderedTypes) !== JSON.stringify(expectedTypes)) {
                pickerProblems.push(`${kind}/${category}: types ${JSON.stringify(renderedTypes)} != ${JSON.stringify(expectedTypes)}`)
                break
            }
            const effects = list.holder.value[1].effect
            const before = effects.length
            await pickAndSave(t)
            const after = list.holder.value[1].effect
            if (after.length <= before) {
                pickerProblems.push(`${kind}/${category}/${types[t]}: Save added no effect`)
                continue
            }
            recorded.set(types[t], snapshotOf(after[before]))
        }
    }
}

beforeAll(async () => {
    for (const kind of ['manual', 'display', 'request'] as const) {
        await recordKind(kind)
    }
}, 600_000)

afterAll(async () => {
    await unmountAll()
})

describe('TS10 defaults: the recorder reads the real classic picker', () => {
    test('compatibility guard (passes before and after): the picker renders the 12-category, 98-type table in order, with the triggerDesc texts', () => {
        expect(pickerProblems).toEqual([])
        expect(PICKABLE.length).toBe(98)
        expect(new Set(PICKABLE).size).toBe(98)
        expect(PICKER_TABLE.length).toBe(12)
    })

    test('compatibility guard (passes before and after): classic recorded one default for each of the 98 pickable types', () => {
        expect([...recorded.keys()].sort()).toEqual([...PICKABLE].sort())
    })

    test('compatibility guard (passes before and after): the recorded SetVar and IfAdvanced anchors have classic key order', () => {
        expect(firstDifference(recorded.get('v2SetVar'), {
            type: 'v2SetVar', operator: '=', var: '', value: '', valueType: 'value', indent: 0,
        })).toBeNull()
        expect(firstDifference(recorded.get('v2IfAdvanced'), {
            type: 'v2IfAdvanced', indent: 0, condition: '=', targetType: 'value', target: '', sourceType: 'value', source: '',
        })).toBeNull()
    })
})

describe('TS10 defaults: v2DefaultEffect equals what classic writes', () => {
    test('regression reproducer: the default types are the picker order, then v2Else', () => {
        expect([...V2_DEFAULT_TYPES]).toEqual([...PICKABLE, 'v2Else'])
    })

    test.each(PICKABLE)('regression reproducer: the default of %s equals classic\'s, key order included', (type) => {
        expect(firstDifference(v2DefaultEffect(type), recorded.get(type))).toBeNull()
    })

    test('regression reproducer: the default of v2Else equals the oracle copy of classic\'s Else default', () => {
        expect(firstDifference(v2DefaultEffect('v2Else'), CLASSIC_V2ELSE_DEFAULT)).toBeNull()
    })

    test('regression reproducer: every call returns a fresh object that shares nothing with an earlier result', () => {
        for (const type of [...PICKABLE, 'v2Else' as const]) {
            const first = v2DefaultEffect(type)
            const second = v2DefaultEffect(type)
            expect(first, type).not.toBe(second)
            expect(exactEqual(first, second), type).toBe(true)
            expect(Object.keys(first).length, type).toBeGreaterThan(0)
        }
    })
})
