// @vitest-environment jsdom

/**
 * `TriggerV2List.svelte` effect editors, second half (every effect type from `v2SetCharAt` to the end):
 * the visible label of an operand names the operand's text field (`aria-labelledby`); the Value/Variable
 * select beside it has no visible text of its own and takes a screen-reader-only name built from
 * `triggerInputLabels.operandType` and the same label text (maintainer decision MC-2840). Selects with their
 * own visible label are named by it. Each editor is opened the way a user does: context menu on the effect
 * row, then Edit. Mounts the REAL component with the real shared inputs and Help; mocks follow
 * `TriggerV2List.effectDisplaySink.svelte.test.ts`.
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

interface Row {
    effect: Record<string, unknown>
    selects: FieldExpectation[]
    texts: string[]
}

const row = (effect: Record<string, unknown>, selects: FieldExpectation[], texts: string[]): Row => ({ effect, selects, texts })

/**
 * `selects` are the value controls (F1-F7 through the shared checker); `texts` are the names of the text
 * fields in document order, so an operand label wired to the wrong field fails by name, not only by count.
 */
function checkRows(rows: Row[]): void {
    const open = show(rows.map((r) => r.effect))
    rows.forEach((r, index) => {
        const editor = open(index)
        const type = String(r.effect.type)
        expect(fieldNameProblems(editor, r.selects), type).toEqual([])
        expect(Array.from(editor.querySelectorAll(TEXT_FIELDS)).map(controlName), type).toEqual(r.texts)
        expect(unnamedControls(editor, { fields: true, values: true }), type).toEqual(KNOWN_UNNAMED)
    })
}

describe('TriggerV2List effect editors (second half) name their value controls', () => {
    test('string and description effects', () => {
        checkRows([
            row({ type: 'v2SetCharAt' }, names(op(L.source), op(L.index), op(L.value)), [L.source, L.index, L.value, L.outputVar]),
            row({ type: 'v2SplitString' }, names(op(L.source), op(L.delimiter)), [L.source, L.delimiter, L.outputVar]),
            row({ type: 'v2JoinArrayVar' }, names(op(L.var), op(L.delimiter)), [L.var, L.delimiter, L.outputVar]),
            row({ type: 'v2GetCharacterDesc' }, names(), [L.outputVar]),
            row({ type: 'v2SetCharacterDesc' }, names(op(L.value)), [L.value]),
            row({ type: 'v2GetPersonaDesc' }, names(), [L.outputVar]),
            row({ type: 'v2SetPersonaDesc' }, names(op(L.value)), [L.value]),
            row({ type: 'v2ExtractRegex' }, names(op(L.source), op(L.regex), op(L.resultFormat), op(L.flags)),
                [L.source, L.regex, L.resultFormat, L.flags, L.outputVar]),
        ])
    })

    test('array effects', () => {
        checkRows([
            row({ type: 'v2MakeArrayVar' }, names(), [L.var]),
            row({ type: 'v2GetArrayVarLength' }, names(), [L.var, L.outputVar]),
            row({ type: 'v2GetArrayVar' }, names(op(L.index)), [L.var, L.index, L.outputVar]),
            row({ type: 'v2SetArrayVar' }, names(op(L.index), op(L.value)), [L.var, L.index, L.value]),
            row({ type: 'v2PushArrayVar' }, names(op(L.value)), [L.var, L.value]),
            row({ type: 'v2PopArrayVar' }, names(), [L.var, L.outputVar]),
            row({ type: 'v2ShiftArrayVar' }, names(), [L.var, L.outputVar]),
            row({ type: 'v2UnshiftArrayVar' }, names(op(L.value)), [L.var, L.value]),
            row({ type: 'v2SpliceArrayVar' }, names(op(L.start), op(L.value)), [L.var, L.start, L.value]),
            row({ type: 'v2SliceArrayVar' }, names(op(L.start), op(L.end)), [L.var, L.start, L.end, L.outputVar]),
            row({ type: 'v2GetIndexOfValueInArrayVar' }, names(op(L.value)), [L.var, L.value, L.outputVar]),
            row({ type: 'v2RemoveIndexFromArrayVar' }, names(op(L.index)), [L.var, L.index]),
        ])
    })

    test('message, alert, display, request and search effects', () => {
        checkRows([
            row({ type: 'v2ConcatString' }, names(op('A'), op('B')), ['A', 'B', L.outputVar]),
            row({ type: 'v2GetLastUserMessage' }, names(), [L.outputVar]),
            row({ type: 'v2GetLastCharMessage' }, names(), [L.outputVar]),
            row({ type: 'v2GetFirstMessage' }, names(), [L.outputVar]),
            row({ type: 'v2GetAlertInput' }, names(op(L.alertContent)), [L.alertContent, L.outputVar]),
            row({ type: 'v2GetAlertSelect' }, names(op(L.alertContent), op(L.options)), [L.alertContent, L.options, L.outputVar]),
            row({ type: 'v2GetDisplayState' }, names(), [L.outputVar]),
            row({ type: 'v2SetDisplayState' }, names(op(L.value)), [L.value]),
            row({ type: 'v2Wait' }, names(op(L.value)), [L.value]),
            row({ type: 'v2GetRequestState' }, names(op(L.index)), [L.index, L.outputVar]),
            row({ type: 'v2GetRequestStateRole' }, names(op(L.index)), [L.index, L.outputVar]),
            row({ type: 'v2SetRequestState' }, names(op(L.index), op(L.value)), [L.index, L.value]),
            row({ type: 'v2SetRequestStateRole' }, names(op(L.index), op(L.value)), [L.index, L.value]),
            row({ type: 'v2GetRequestStateLength' }, names(), [L.outputVar]),
            row({ type: 'v2QuickSearchChat' }, names(op(language.value), language.condition, op(language.depth)),
                [language.value, language.depth, L.outputVar]),
            row({ type: 'v2Tokenize' }, names(op(L.value)), [L.value, L.outputVar]),
        ])
    })

    test('lorebook, regex, note, dictionary and misc effects', () => {
        checkRows([
            row({ type: 'v2GetAllLorebooks' }, names(), [L.outputVar]),
            row({ type: 'v2GetLorebookByName' }, names(op(L.name)), [L.name, L.outputVar]),
            row({ type: 'v2GetLorebookByIndex' }, names(op(L.index)), [L.index, L.outputVar]),
            row({ type: 'v2CreateLorebook' }, names(op(L.name), op(L.activationKeys), op(L.prompt), op(L.insertOrder)),
                [L.name, L.activationKeys, L.prompt, L.insertOrder]),
            row({ type: 'v2ModifyLorebookByIndex' }, names(op(L.index), op(L.name), op(L.activationKeys), op(L.prompt), op(L.insertOrder)),
                [L.index, L.name, L.activationKeys, L.prompt, L.insertOrder]),
            row({ type: 'v2DeleteLorebookByIndex' }, names(op(L.index)), [L.index]),
            row({ type: 'v2SetLorebookAlwaysActive', value: false }, names(op(L.index)), [L.index]),
            row({ type: 'v2UpdateChatAt' }, names(), [L.index]),
            row({ type: 'v2RegexTest' }, names(op(L.source), op(L.regex), op(L.flags)), [L.source, L.regex, L.flags, L.outputVar]),
            row({ type: 'v2GetReplaceGlobalNote' }, names(), [L.outputVar]),
            row({ type: 'v2SetReplaceGlobalNote' }, names(op(L.value)), [L.value]),
            row({ type: 'v2GetAuthorNote' }, names(), [L.outputVar]),
            row({ type: 'v2SetAuthorNote' }, names(op(L.value)), [L.value]),
        ])
    })

    test('dictionary, calculate, replace, comment and declare effects', () => {
        checkRows([
            row({ type: 'v2MakeDictVar' }, names(), [L.var]),
            row({ type: 'v2GetDictVar' }, names(op(L.var), op(L.key)), [L.var, L.key, L.outputVar]),
            row({ type: 'v2SetDictVar' }, names(op(L.var), op(L.key), op(L.value)), [L.var, L.key, L.value]),
            row({ type: 'v2DeleteDictKey' }, names(op(L.var), op(L.key)), [L.var, L.key]),
            row({ type: 'v2HasDictKey' }, names(op(L.var), op(L.key)), [L.var, L.key, L.outputVar]),
            row({ type: 'v2ClearDict' }, names(), [L.var]),
            row({ type: 'v2GetDictSize' }, names(op(L.var)), [L.var, L.outputVar]),
            row({ type: 'v2GetDictKeys' }, names(op(L.var)), [L.var, L.outputVar]),
            row({ type: 'v2GetDictValues' }, names(op(L.var)), [L.var, L.outputVar]),
            row({ type: 'v2Calculate' }, names(op(L.expression)), [L.expression, L.outputVar]),
            row({ type: 'v2ReplaceString' }, names(op(L.source), op(L.regex), op(L.resultFormat), op(L.replacement), op(L.flags)),
                [L.source, L.regex, L.resultFormat, L.replacement, L.flags, L.outputVar]),
            row({ type: 'v2Comment' }, names(), [L.value]),
            row({ type: 'v2DeclareLocalVar' }, names(op(L.value)), [L.varName, L.value]),
        ])
    })

    test('the trigger-type select is named by its visible "Trigger On" label', () => {
        show([])
        const selects = Array.from(document.body.querySelectorAll('select'))
        const triggerType = selects.filter((s) => Array.from(s.options).some((o) => o.value === 'manual'))
        expect(triggerType.length).toBe(1)
        expect(controlName(triggerType[0])).toBe(language.triggerOn)
        expect(unnamedControls(document.body, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('the add-effect picker names its narrow-screen category select', () => {
        show([])
        const add = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'))
            .filter((b) => b.textContent?.trim() === '...')
            .pop()!
        add.click()
        add.click()
        flushSync()
        const selects = Array.from(document.body.querySelectorAll('select'))
        expect(selects.map(controlName)).toContain(language.triggerEffectCategory)
        expect(unnamedControls(document.body, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
