// @vitest-environment jsdom

/**
 * `TriggerV2List.svelte` effect editors, first half (every effect type up to and excluding
 * `v2SetCharAt`): the visible label of an operand names the operand's text field (`aria-labelledby`, with
 * that label first in `aria-describedby`); the Value/Variable select beside it has no visible text of its
 * own and takes a screen-reader-only name built from `triggerInputLabels.operandType` and the same label
 * text (maintainer decision MC-2840). Selects with their own visible label are named by it. Each editor is
 * opened the way a user does: context menu on the effect row, then Edit. Mounts the REAL component with the
 * real shared inputs and Help; mocks follow `TriggerV2List.effectDisplaySink.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/process/triggers'), () => ({
    displayAllowList: ['v2GetDisplayState', 'v2SetDisplayState'],
    requestAllowList: ['v2GetRequestState'],
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
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

import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'
import { controlName, fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import type { triggerscript } from 'src/ts/process/triggers'
import TriggerV2List from './TriggerV2List.svelte'

const L = language.triggerInputLabels

let mountedTargets: HTMLElement[] = []
let mountedInstances: unknown[] = []

/** Mounts the list with one trigger holding `effects` and returns an opener for each effect's editor. */
function show(effects: Array<Record<string, unknown>>): (index: number) => HTMLElement {
    const value: triggerscript[] = [
        { comment: 'header', type: 'manual', conditions: [], effect: [] },
        {
            comment: 'trigger',
            type: 'manual',
            conditions: [],
            effect: effects.map((effect) => ({ indent: 0, ...effect }) as never),
        },
    ]
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(TriggerV2List, { target, props: { value } }))
    flushSync()
    target.querySelector<HTMLButtonElement>('button')!.click()
    flushSync()

    return (index) => {
        const back = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${language.settingsPage.back}"]`)
        if (back) {
            back.click()
            flushSync()
        }
        const row = document.body.querySelectorAll<HTMLButtonElement>('button.break-all')[index]
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }))
        flushSync()
        const edit = Array.from(document.body.querySelectorAll<HTMLButtonElement>('div.w-28 button'))
            .find((button) => button.textContent?.trim() === language.edit)!
        edit.click()
        flushSync()
        return document.body.querySelector('h2')!.parentElement!.parentElement as HTMLElement
    }
}

afterEach(async () => {
    for (const instance of mountedInstances) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.forEach((t) => t.remove())
    mountedInstances = []
    mountedTargets = []
    document.body.replaceChildren()
})

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

/** The screen-reader-only name of the Value/Variable select that sits under an operand label. */
const op = (label: string): string => fillLang(L.operandType, { label })

/** Out-of-scope unnamed controls in these editors: none. */
const KNOWN_UNNAMED: string[] = []

const TEXT_FIELDS = 'textarea, input[type="text"], input[type="password"], input:not([type]), [role="textbox"]'

/**
 * `selects` are the value controls (F1-F7 through the shared checker); `texts` are the names of the text
 * fields in document order, so an operand label wired to the wrong field fails by name, not only by count.
 */
function check(editor: HTMLElement, selects: FieldExpectation[], texts: string[]): void {
    expect(fieldNameProblems(editor, selects)).toEqual([])
    expect(Array.from(editor.querySelectorAll(TEXT_FIELDS)).map(controlName)).toEqual(texts)
    expect(unnamedControls(editor, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

describe('TriggerV2List effect editors (first half) name their value controls', () => {
    test('v2SetVar, v2If and v2IfAdvanced (plain, similarity and truthy branches)', () => {
        const open = show([
            { type: 'v2SetVar', operator: '=', var: '', value: '', valueType: 'value' },
            { type: 'v2If', condition: '=', targetType: 'value', target: '', source: '' },
            { type: 'v2IfAdvanced', condition: '=', targetType: 'value', target: '', sourceType: 'value', source: '' },
            { type: 'v2IfAdvanced', condition: '≡', targetType: 'value', target: 'true', sourceType: 'var', source: '' },
        ])
        check(open(0), names(L.operator, op(L.value)), [L.varName, L.value])
        check(open(1), names(L.condition, op(L.value)), [L.varName, L.value])
        check(open(2), names(op(L.operandA), L.condition, op(L.operandB)), [L.operandA, L.operandB])
        check(open(3), names(op(L.operandA), L.condition, L.operandB), [L.operandA])
    })

    test('v2RunTrigger, v2ConsoleLog, v2ShowAlert, v2RunLLM, v2CheckSimilarity', () => {
        const open = show([
            { type: 'v2RunTrigger', target: 'trigger' },
            { type: 'v2ConsoleLog', source: '', sourceType: 'value' },
            { type: 'v2ShowAlert', value: '', valueType: 'value' },
            { type: 'v2RunLLM', value: '', valueType: 'value', model: 'model', outputVar: '', streaming: false },
            { type: 'v2CheckSimilarity', source: '', sourceType: 'value', value: '', valueType: 'value', outputVar: '' },
        ])
        check(open(0), names(L.trigger), [])
        check(open(1), names(op(L.value)), [L.value])
        check(open(2), names(op(L.alertContent)), [L.alertContent])
        check(open(3), names(op(L.prompt), L.model), [L.prompt, L.outputVar])
        check(open(4), names(op(L.source), op(L.value)), [L.source, L.value, L.outputVar])
    })

    test('v2CutChat, v2Command, v2SystemPrompt, v2Impersonate, v2ModifyChat, v2LoopNTimes', () => {
        const open = show([
            { type: 'v2CutChat', start: '', startType: 'value', end: '', endType: 'value' },
            { type: 'v2Command', value: '', valueType: 'value' },
            { type: 'v2SystemPrompt', location: 'start', value: '', valueType: 'value' },
            { type: 'v2Impersonate', role: 'user', value: '', valueType: 'value' },
            { type: 'v2ModifyChat', index: '', indexType: 'value', value: '', valueType: 'value' },
            { type: 'v2LoopNTimes', value: '', valueType: 'value' },
        ])
        check(open(0), names(op(L.start), op(L.end)), [L.start, L.end])
        check(open(1), names(op(L.cmd)), [L.cmd])
        check(open(2), names(L.location, op(L.value)), [L.value])
        check(open(3), names(L.role, op(L.value)), [L.value])
        check(open(4), names(op(L.index), op(L.value)), [L.index, L.value])
        check(open(5), names(op(L.value)), [L.value])
    })

    test('message and lorebook effects', () => {
        const open = show([
            { type: 'v2GetLastMessage', outputVar: '' },
            { type: 'v2GetMessageAtIndex', index: '', indexType: 'value', outputVar: '' },
            { type: 'v2GetMessageCount', outputVar: '' },
            { type: 'v2ModifyLorebook', target: '', targetType: 'value', value: '', valueType: 'value' },
            { type: 'v2GetLorebook', target: '', targetType: 'value', outputVar: '' },
            { type: 'v2GetLorebookCountNew', outputVar: '' },
            { type: 'v2GetLorebookEntry', index: '', indexType: 'value', outputVar: '' },
            { type: 'v2SetLorebookActivation', index: '', indexType: 'value', value: false },
            { type: 'v2GetLorebookIndexViaName', name: '', nameType: 'value', outputVar: '' },
        ])
        check(open(0), names(), [L.outputVar])
        check(open(1), names(op(L.index)), [L.index, L.outputVar])
        check(open(2), names(), [L.outputVar])
        check(open(3), names(op(L.target), op(L.value)), [L.target, L.value])
        check(open(4), names(op(L.target)), [L.target, L.outputVar])
        check(open(5), names(), [L.outputVar])
        check(open(6), names(op(L.index)), [L.index, L.outputVar])
        check(open(7), names(op(L.index)), [L.index])
        check(open(8), names(op(L.name)), [L.name, L.outputVar])
    })

    test('v2Random, v2GetCharAt, v2GetCharCount, v2ImgGen, v2ToLowerCase, v2ToUpperCase', () => {
        const open = show([
            { type: 'v2Random', min: '', minType: 'value', max: '', maxType: 'value', outputVar: '' },
            { type: 'v2GetCharAt', source: '', sourceType: 'value', index: '', indexType: 'value', outputVar: '' },
            { type: 'v2GetCharCount', source: '', sourceType: 'value', outputVar: '' },
            { type: 'v2ImgGen', value: '', valueType: 'value', negValue: '', negValueType: 'value', outputVar: '' },
            { type: 'v2ToLowerCase', source: '', sourceType: 'value', outputVar: '' },
            { type: 'v2ToUpperCase', source: '', sourceType: 'value', outputVar: '' },
        ])
        check(open(0), names(op(L.min), op(L.max)), [L.min, L.max, L.outputVar])
        check(open(1), names(op(L.source), op(L.index)), [L.source, L.index, L.outputVar])
        check(open(2), names(op(L.source)), [L.source, L.outputVar])
        check(open(3), names(op(L.prompt), op(L.negPrompt)), [L.prompt, L.negPrompt, L.outputVar])
        check(open(4), names(op(L.source)), [L.source, L.outputVar])
        check(open(5), names(op(L.source)), [L.source, L.outputVar])
    })
})
