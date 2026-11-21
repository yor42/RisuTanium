// @vitest-environment jsdom

/**
 * `TriggerV1Data.svelte` value controls: the trigger type select and every select and number of a
 * condition or effect row are named through `aria-labelledby` by their visible label text, with that label
 * first in `aria-describedby`. A row label that also holds a remove button names its select by an inner
 * text span only. Row ids derive from the row index, so two rows never share a naming element. The
 * match-mode select of an "exists" condition has no visible text of its own and takes a screen-reader-only
 * name. Mounts the REAL component with the real shared inputs and Help; mocks follow
 * `TriggerScripts.names.svelte.test.ts`.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { triggerscript } from 'src/ts/storage/database.svelte'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { hotkeys: [], longPressToPopupEditor: false } },
    ReloadGUIPointer: writable(0),
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
vi.mock('src/ts/util', () => ({ sleep: vi.fn(async () => {}) }))
vi.mock('src/ts/platform', () => ({ isMobile: false }))
vi.mock('src/ts/hotkey', () => ({ hotkeyMatches: vi.fn(() => false) }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => false), alertMd: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ openURL: vi.fn() }))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from 'src/lib/a11yNames.test-helpers'
import TriggerV1Data from './TriggerV1Data.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function show(conditions: unknown[], effect: unknown[]): Promise<HTMLElement> {
    const value = { comment: 'Trigger', type: 'start', conditions, effect } as unknown as triggerscript
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(TriggerV1Data, { target, props: { value, idx: 0, lowLevelAble: true } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await tick()
    target.querySelector<HTMLButtonElement>('button.endflex')!.click()
    flushSync()
    await tick()
    flushSync()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const names = (...list: string[]): FieldExpectation[] => list.map((name) => ({ name }))

/** Out-of-scope unnamed controls on this page: none. */
const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
}

const TYPE = language.type
const EXISTS = { type: 'exists', value: '', type2: 'loose', depth: 3 }
const VAR = { type: 'var', var: '', value: '', operator: '=' }
const VALUE = { type: 'value', var: '', value: '', operator: '=' }

describe('TriggerV1Data trigger and condition value controls are named', () => {
    test('a trigger with no condition or effect names only its type select', async () => {
        check(await show([], []), names(TYPE))
    })

    test('an exists condition: type, match mode (screen-reader-only name) and search depth', async () => {
        check(await show([EXISTS], []), names(TYPE, TYPE, language.triggerMatchMode, language.searchDepth))
    })

    test('a variable condition: type and the operator select under the Value label', async () => {
        check(await show([VAR], []), names(TYPE, TYPE, language.value))
    })

    test('a value condition: type and the operator select under the Value label', async () => {
        check(await show([VALUE], []), names(TYPE, TYPE, language.value))
    })

    test('a truthy condition has the same controls: the text areas are not value controls', async () => {
        check(await show([{ ...VAR, operator: 'true' }], []), names(TYPE, TYPE, language.value))
    })

    test('three conditions keep row-unique naming elements', async () => {
        check(await show([EXISTS, VAR, VALUE], []), names(
            TYPE,
            TYPE, language.triggerMatchMode, language.searchDepth,
            TYPE, language.value,
            TYPE, language.value,
        ))
    })
})

describe('TriggerV1Data effect value controls are named', () => {
    test('a system prompt effect: type and location', async () => {
        check(await show([], [{ type: 'systemprompt', value: '', location: 'historyend' }]), names(TYPE, TYPE, language.location))
    })

    test('a set variable effect: type and operator', async () => {
        check(await show([], [{ type: 'setvar', var: '', value: '', operator: '=' }]), names(TYPE, TYPE, language.operator))
    })

    test('a show alert effect: type and alert type', async () => {
        check(await show([], [{ type: 'showAlert', alertType: 'normal', value: '', inputVar: '' }]), names(TYPE, TYPE, TYPE))
    })

    test('an impersonate effect: type and role', async () => {
        check(await show([], [{ type: 'impersonate', role: 'char', value: '' }]), names(TYPE, TYPE, language.role))
    })

    test('effects without a second select add only their type select', async () => {
        check(await show([], [
            { type: 'runtrigger', value: '' },
            { type: 'command', value: '' },
            { type: 'runLLM', value: '', inputVar: '' },
            { type: 'checkSimilarity', source: '', value: '', inputVar: '' },
            { type: 'extractRegex', value: '', regex: '', flags: '', inputVar: '', result: '' },
            { type: 'runImgGen', value: '', negValue: '', inputVar: '' },
            { type: 'cutchat', start: '', end: '' },
            { type: 'modifychat', value: '', index: '' },
            { type: 'runAxLLM', value: '', inputVar: '' },
            { type: 'stop' },
            { type: 'sendAIprompt' },
        ]), names(TYPE, ...Array(11).fill(TYPE)))
    })

    test('a mixed trigger keeps row-unique naming elements across conditions and effects', async () => {
        check(await show([EXISTS, VALUE], [
            { type: 'setvar', var: '', value: '', operator: '=' },
            { type: 'showAlert', alertType: 'normal', value: '', inputVar: '' },
            { type: 'impersonate', role: 'char', value: '' },
        ]), names(
            TYPE,
            TYPE, language.triggerMatchMode, language.searchDepth,
            TYPE, language.value,
            TYPE, language.operator,
            TYPE, TYPE,
            TYPE, language.role,
        ))
    })
})
