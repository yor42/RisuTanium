// @vitest-environment happy-dom

/**
 * `SettingNumber.svelte` shows the model's listed maximum next to the typed value
 * (`value / actual`) and, only when the value is strictly above it, a warning line under the
 * input. The typed value is never changed. A missing, zero, negative or non-finite figure is
 * "unknown": the template renders the same nodes as a number item without the option.
 *
 * C1-C7 render the REAL wrapper with a test-supplied `actualMax`. C8 renders the REAL
 * `params.maxContext` item from `basicParameterItems` with the real getter and the real
 * holder, then seeds the holder after mount. MOCKED: `platform` (a web build), `alert`
 * (`alertMd` only, used by `Help.svelte`), `stores.svelte` (a `$state` stand-in for
 * `DBState`) and two registry files this test does not use (`utils` imports them).
 *
 * Labels: (F) feature test that fails before the change on its own assertion (the element is
 * absent); (G) guard that passes before and after; (B) behaviour test whose mutant is
 * probably equivalent.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Component } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/setting/chatFormatSettingsData'), () => ({
    chatFormatSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/chatFormatSettingsData'))
vi.mock(import('src/ts/setting/displaySettingsData.svelte'), () => ({
    displaySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/displaySettingsData.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { OpenAIModels } from 'src/ts/model/providers/openai'
import { parseOpenRouterModels } from 'src/ts/model/modelData/openrouterData'
import { resetModelDataForTests, seedModelDataForTests } from 'src/ts/model/modelData/modelDataService.svelte'
import { basicParameterItems } from 'src/ts/setting/botSettingsParamsData'
import SettingNumber from './SettingNumber.svelte'
import fixture from 'src/ts/model/modelData/tests/openrouterRows.fixture.json'

type Wrapper = Component<{ item: SettingItem, ctx: SettingContext }>

const T = 1_800_000_000_000
const ACTUAL_ID = 'setting-actual-max'
const WARNING_ID = 'setting-actual-max-warning'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(wrapper: Wrapper, item: SettingItem, ctx: SettingContext): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(wrapper, { target, props: { item, ctx } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function itemWith(actualMax: () => number | undefined): SettingItem {
    return {
        id: 'test.maxContext',
        type: 'number',
        labelKey: 'maxContextSize',
        bindKey: 'maxContext',
        options: { min: 0, actualMax, actualMaxWarning: (max) => 'WARN ' + max },
    }
}

const plainItem: SettingItem = {
    id: 'test.maxContext',
    type: 'number',
    labelKey: 'maxContextSize',
    bindKey: 'maxContext',
    options: { min: 0 },
}

const emptyCtx = {} as unknown as SettingContext
const labelText = (target: HTMLElement) => target.querySelector('span')?.textContent?.trim()
const numberInputs = (target: HTMLElement) => target.querySelectorAll('input[type=number]')
const actualText = (target: HTMLElement) =>
    target.querySelector(`[data-testid="${ACTUAL_ID}"]`)?.textContent?.trim()
const warning = (target: HTMLElement) => target.querySelector(`[data-testid="${WARNING_ID}"]`)
const setMaxContext = (value: number) => {
    DBState.db.maxContext = value
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
    resetModelDataForTests()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    resetModelDataForTests()
})

describe('SettingNumber actual maximum', () => {
    test('(G) C1 without the option the label and input are unchanged', () => {
        setMaxContext(8000)
        const target = render(SettingNumber, plainItem, emptyCtx)
        expect(labelText(target)).toBe('Max Context Size')
        expect(target.querySelector(`[data-testid="${ACTUAL_ID}"]`)).toBeNull()
        expect(warning(target)).toBeNull()
        expect(numberInputs(target).length).toBe(1)
        expect((numberInputs(target)[0] as HTMLInputElement).value).toBe('8000')
    })

    test('(G) C2 an unknown (undefined) figure renders the same nodes as no option', () => {
        setMaxContext(8000)
        const target = render(SettingNumber, itemWith(() => undefined), emptyCtx)
        expect(labelText(target)).toBe('Max Context Size')
        expect(target.querySelector(`[data-testid="${ACTUAL_ID}"]`)).toBeNull()
        expect(warning(target)).toBeNull()
        expect(numberInputs(target).length).toBe(1)
        expect((numberInputs(target)[0] as HTMLInputElement).value).toBe('8000')
    })

    test('(F) C3 a value below the figure shows "value / actual" and no warning', () => {
        setMaxContext(8000)
        const target = render(SettingNumber, itemWith(() => 200000), emptyCtx)
        expect(actualText(target)).toBe('8,000 / 200,000')
        expect(warning(target)).toBeNull()
    })

    test('(F) C4 a value equal to the figure shows no warning (strictly above only)', () => {
        setMaxContext(200000)
        const target = render(SettingNumber, itemWith(() => 200000), emptyCtx)
        expect(actualText(target)).toBe('200,000 / 200,000')
        expect(warning(target)).toBeNull()
    })

    test('(F) C5 a value one above the figure warns and is never clamped', () => {
        setMaxContext(200001)
        const target = render(SettingNumber, itemWith(() => 200000), emptyCtx)
        const shown = warning(target)
        expect(shown).not.toBeNull()
        expect(shown?.textContent).toContain('200,000')
        expect(DBState.db.maxContext).toBe(200001)
        expect((numberInputs(target)[0] as HTMLInputElement).value).toBe('200001')
    })

    test('(B) C6 typing a value above the figure updates the suffix and shows the warning', () => {
        setMaxContext(8000)
        const target = render(SettingNumber, itemWith(() => 200000), emptyCtx)
        expect(warning(target)).toBeNull()
        const input = numberInputs(target)[0] as HTMLInputElement
        input.value = '300000'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        expect(actualText(target)).toBe('300,000 / 200,000')
        expect(warning(target)).not.toBeNull()
    })

    test.each([0, Number.NaN, -5])('(G) C7 a non-positive or non-finite figure (%s) is unknown: no suffix, no warning', (figure) => {
        setMaxContext(8000)
        const target = render(SettingNumber, itemWith(() => figure), emptyCtx)
        expect(target.querySelector(`[data-testid="${ACTUAL_ID}"]`)).toBeNull()
        expect(warning(target)).toBeNull()
    })

    test('(F) C8 the real maxContext item follows the holder: empty, seeded after mount, then replaced', () => {
        const item = basicParameterItems.find((i) => i.id === 'params.maxContext')
        const modelInfo = OpenAIModels.find((m) => m.internalID === 'gpt-4o')
        if (!item || !modelInfo) throw new Error('the real maxContext item or the gpt-4o entry is missing')
        setMaxContext(8000)
        const ctx = { db: DBState.db, modelInfo, subModelInfo: modelInfo } as unknown as SettingContext
        const target = render(SettingNumber, item, ctx)
        expect(target.querySelector(`[data-testid="${ACTUAL_ID}"]`)).toBeNull()

        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        flushSync()
        expect(actualText(target)).toBe('8,000 / 128,000')

        const replacement = parseOpenRouterModels({
            data: [{ id: 'openai/gpt-4o', context_length: 64000, pricing: { prompt: '0.0000025', completion: '0.00001' } }],
        }, T)
        seedModelDataForTests(replacement)
        flushSync()
        expect(actualText(target)).toBe('8,000 / 64,000')
    })
})
