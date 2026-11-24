// @vitest-environment jsdom

/**
 * TS10, templates half: every template of `triggerTemplates.ts` equals, key order included, what the real
 * classic editors write when a user switches the trigger mode, adds an event, a V1 row, a V1 condition or effect,
 * or changes the type of a V1 condition or effect. `TriggerList`, `TriggerV2List`, `TriggerV1List` and
 * `TriggerV1Data` are mounted unchanged and driven live (maintainer decision MC-329).
 *
 * Titles saying "regression reproducer" fail against a Studio module that returns the wrong value;
 * titles saying "compatibility guard" pass before and after and check the recorder itself.
 */
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/process/triggers'), () => ({
    displayAllowList: ['v2GetDisplayState', 'v2SetDisplayState'],
    requestAllowList: ['v2GetRequestState'],
}) as unknown as typeof import('src/ts/process/triggers'))
vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { hotkeys: [], longPressToPopupEditor: false, showDeprecatedTriggerV1: true, showDeprecatedTriggerV2: true } },
    selIdState: { selId: 0 },
    ReloadGUIPointer: writable(0),
    alertStore: writable({ type: 'none', msg: '' }),
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
}))
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/util', () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: { delay: 300, delayOnTouchOnly: true, filter: '.no-sort', onMove: () => true },
}))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true), alertMd: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ openURL: vi.fn() }))
vi.mock('sortablejs', () => ({ default: { create: () => ({ destroy() {} }) } }))

import type { Component } from 'svelte'
import { language } from 'src/lang'
import TriggerList from 'src/lib/SideBars/Scripts/TriggerList.svelte'
import TriggerV1Data from 'src/lib/SideBars/Scripts/TriggerV1Data.svelte'
import TriggerV1List from 'src/lib/SideBars/Scripts/TriggerV1List.svelte'
import TriggerV2List from 'src/lib/SideBars/Scripts/TriggerV2List.svelte'
import type { triggerCondition, triggerEffectV1, triggerscript } from '../../../process/triggers'
import {
    modeTemplate, v1ConditionTemplate, v1ConditionTypeTemplate, v1EffectTemplate, v1EffectTypeTemplate, v1RowTemplate,
    v2EventTemplate, type TriggerListMode,
} from '../triggerTemplates'
import {
    buttonByLabel, buttonByText, changeV1Type, clickV1Add, mountBound, openV1Row, openV2Panel, settle, snapshotOf,
    unmountAll, v2ListWith,
} from './classicTriggerDriver.test-helpers.svelte'
import { firstDifference } from './triggerExactEqual.test-helpers'

afterEach(async () => {
    await unmountAll()
})

const asComponent = (component: unknown) => component as Component<never>

//#region mode templates

const v1Row = (comment: string): triggerscript => ({ comment, type: 'start', conditions: [], effect: [] })
const v2Rows = (): triggerscript[] => v2ListWith('manual')

async function switchMode(initial: triggerscript[], button: 'V1' | 'V2' | 'Lua'): Promise<triggerscript[]> {
    await unmountAll()
    const list = mountBound(asComponent(TriggerList), initial, { lowLevelAble: true })
    await settle()
    buttonByText(button).click()
    await settle(60)
    return snapshotOf(list.holder.value)
}

describe('TS10 templates: the trigger-mode switch', () => {
    test('compatibility guard (passes before and after): classic writes the V2 and Lua shapes of the classic source', async () => {
        expect(await switchMode([v1Row('x')], 'V2')).toEqual([
            { comment: '', type: 'manual', conditions: [], effect: [{ type: 'v2Header', code: '', indent: 0 }] },
            { comment: 'New Event', type: 'manual', conditions: [], effect: [] },
        ])
        expect(await switchMode([v1Row('x')], 'Lua')).toEqual([
            { comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: '' }] },
        ])
    })

    test('regression reproducer: the V2 template equals the list classic writes when switching a V1 list to V2', async () => {
        expect(firstDifference(modeTemplate('v2'), await switchMode([v1Row('x')], 'V2'))).toBeNull()
    })

    test('regression reproducer: the Lua template equals the list classic writes from a V1 list', async () => {
        expect(firstDifference(modeTemplate('lua'), await switchMode([v1Row('x')], 'Lua'))).toBeNull()
    })

    test('regression reproducer: the Lua template equals the list classic writes from an empty list', async () => {
        expect(firstDifference(modeTemplate('lua'), await switchMode([], 'Lua'))).toBeNull()
    })

    test('compatibility guard (passes before and after): the V1 template equals the list classic writes when switching a V2 list to V1', async () => {
        expect(firstDifference(modeTemplate('v1'), await switchMode(v2Rows(), 'V1'))).toBeNull()
    })

    test('regression reproducer: each call returns a fresh list', () => {
        for (const mode of ['v1', 'v2', 'lua'] as TriggerListMode[]) {
            const first = modeTemplate(mode)
            const second = modeTemplate(mode)
            expect(first).not.toBe(second)
            expect(first.length, mode).toBe(mode === 'v1' ? 0 : mode === 'v2' ? 2 : 1)
            expect(firstDifference(first, second), mode).toBeNull()
        }
    })
})

//#endregion

//#region V2 event, V1 row

describe('TS10 templates: added rows', () => {
    test('regression reproducer: the V2 Add event template equals the event classic appends', async () => {
        const list = mountBound(asComponent(TriggerV2List), v2ListWith('manual'), { lowLevelAble: true })
        await openV2Panel()
        buttonByLabel(language.add).click()
        await settle()
        const rows = snapshotOf(list.holder.value)
        expect(rows.length).toBe(3)
        expect(firstDifference(v2EventTemplate(), rows[2])).toBeNull()
    })

    test('regression reproducer: the V1 row template equals the row classic appends', async () => {
        const list = mountBound(asComponent(TriggerV1List), [] as triggerscript[], { lowLevelAble: true })
        await settle()
        buttonByLabel(language.add).click()
        await settle()
        const rows = snapshotOf(list.holder.value)
        expect(rows.length).toBe(1)
        expect(firstDifference(v1RowTemplate(), rows[0])).toBeNull()
    })
})

//#endregion

//#region V1 data rows

type RowType = triggerscript['type']

function v1DataRow(type: RowType, conditions: unknown[] = [], effect: unknown[] = []): triggerscript {
    return { comment: 'Trigger', type, conditions, effect } as unknown as triggerscript
}

async function openV1Data(row: triggerscript) {
    const list = mountBound(asComponent(TriggerV1Data), row, { lowLevelAble: true, idx: 0 })
    await settle()
    await openV1Row()
    return list
}

describe('TS10 templates: V1 conditions and effects', () => {
    test('regression reproducer: the condition template equals the condition classic adds', async () => {
        const list = await openV1Data(v1DataRow('start'))
        await clickV1Add(0)
        const added = snapshotOf(list.holder.value).conditions
        expect(added.length).toBe(1)
        expect(firstDifference(v1ConditionTemplate(), added[0])).toBeNull()
    })

    test.each(['start', 'output', 'input', 'manual', 'display', 'request'] as RowType[])(
        'regression reproducer: the effect template of a %s row equals the effect classic adds',
        async (rowType) => {
            const list = await openV1Data(v1DataRow(rowType))
            await clickV1Add(1)
            const added = snapshotOf(list.holder.value).effect
            expect(added.length).toBe(1)
            expect(firstDifference(v1EffectTemplate(rowType), added[0])).toBeNull()
        },
    )

    test('compatibility guard (passes before and after): a row type with no option still adds a V1 effect, because the add writes by the stored type', async () => {
        const list = await openV1Data(v1DataRow('display'))
        await clickV1Add(1)
        expect(snapshotOf(list.holder.value).effect[0]).toEqual({ type: 'setvar', var: '', value: '', operator: '=' })
        expect(snapshotOf(list.holder.value).type).toBe('display')
    })
})

const CONDITION_TARGETS: Array<triggerCondition['type']> = ['value', 'exists', 'var', 'chatindex']
const EFFECT_TARGETS: Array<triggerEffectV1['type']> = [
    'setvar', 'impersonate', 'command', 'systemprompt', 'stop', 'runtrigger', 'runLLM', 'checkSimilarity', 'showAlert',
    'sendAIprompt', 'extractRegex', 'runImgGen', 'cutchat', 'modifychat', 'runAxLLM',
]

describe('TS10 templates: V1 type changes', () => {
    test.each(CONDITION_TARGETS)('regression reproducer: the condition type template of %s equals the condition classic writes, old keys dropped', async (target) => {
        const source = target === 'chatindex'
            ? { type: 'value', var: 'a', value: 'b', operator: '=', unknownKey: 'kept?' }
            : { type: 'chatindex', value: 'b', operator: '=', unknownKey: 'kept?' }
        const list = await openV1Data(v1DataRow('start', [source]))
        await changeV1Type('c', 0, target)
        const written = snapshotOf(list.holder.value).conditions[0]
        expect(firstDifference(v1ConditionTypeTemplate(target), written)).toBeNull()
        expect(Object.keys(written)).not.toContain('unknownKey')
    })

    test.each(EFFECT_TARGETS)('regression reproducer: the effect type template of %s equals the effect classic writes, old keys dropped', async (target) => {
        const source = target === 'command'
            ? { type: 'stop', unknownKey: 'kept?' }
            : { type: 'command', value: 'v', unknownKey: 'kept?' }
        const list = await openV1Data(v1DataRow('start', [], [source]))
        await changeV1Type('e', 0, target)
        const written = snapshotOf(list.holder.value).effect[0]
        expect(firstDifference(v1EffectTypeTemplate(target), written)).toBeNull()
        expect(Object.keys(written)).not.toContain('unknownKey')
    })

    test('regression reproducer: every call returns a fresh object', () => {
        for (const target of CONDITION_TARGETS) {
            expect(v1ConditionTypeTemplate(target)).not.toBe(v1ConditionTypeTemplate(target))
        }
        for (const target of EFFECT_TARGETS) {
            expect(v1EffectTypeTemplate(target)).not.toBe(v1EffectTypeTemplate(target))
        }
        expect(v1ConditionTemplate()).not.toBe(v1ConditionTemplate())
        expect(v1RowTemplate()).not.toBe(v1RowTemplate())
        expect(v2EventTemplate()).not.toBe(v2EventTemplate())
        expect(Object.keys(v1RowTemplate()).length).toBe(4)
    })
})

//#endregion
