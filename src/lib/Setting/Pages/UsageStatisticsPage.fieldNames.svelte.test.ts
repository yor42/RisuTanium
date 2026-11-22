// @vitest-environment jsdom

/**
 * The price-override editor of the Statistics page names each price field through aria-labelledby to its visible
 * label, with that label first in aria-describedby. Kept in its own file so it can travel with the page's own merge.
 *
 * MOCKED: `stores.svelte` (a plain reactive `DBState`), the confirm dialog and the model-list lookup, as the sibling
 * page test does. The page, the shared inputs, the ledger and the model data service are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('../../../ts/stores.svelte')
})
vi.mock(import('../../../ts/alert'), () => ({ alertConfirm: vi.fn() }) as unknown as typeof import('../../../ts/alert'))
const workingModelList = vi.hoisted(() => () => ({ getModelInfo: (id: string) => ({ id, internalID: id, provider: 0 }) }))
vi.mock('../../../ts/model/modellist', workingModelList)

import { language } from '../../../lang'
import { parseLiteLLMDataset } from '../../../ts/model/modelData/litellmData'
import { resetModelDataForTests, seedLiteLLMForTests } from '../../../ts/model/modelData/modelDataService.svelte'
import { DBState } from '../../../ts/stores.svelte'
import { recordUsage } from '../../../ts/usage/usageLedger'
import { controlDescription, controlName, unnamedControls } from '../../a11yNames.test-helpers'
import UsageStatisticsPage from './UsageStatisticsPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

beforeEach(() => {
    resetModelDataForTests()
    seedLiteLLMForTests(parseLiteLLMDataset({
        'gpt-priced': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1000, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    }, 1))
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetModelDataForTests()
})

describe('UsageStatisticsPage price editor field names', () => {
    test('each price field is named by its label element, with the label first in the description', async () => {
        const statics: Record<string, number> = { messages: 0, imports: 0 }
        recordUsage(statics, { modelKey: 'gpt-priced', purpose: 'chat', reported: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimated: null }, new Date(2026, 5, 15))
        DBState.db = { statics, customModels: [] } as unknown as Database
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push(mount(UsageStatisticsPage, { target }))
        await vi.dynamicImportSettled()
        flushSync()
        const setPrice = [...target.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(language.usageStats.setPrice))!
        setPrice.click()
        flushSync()
        const inputs = [...target.querySelectorAll<HTMLInputElement>('[data-part="settings-usage-price-editor"] input[type="text"], [data-part="settings-usage-price-editor"] input:not([type])')]
        expect(inputs.length).toBeGreaterThan(0)
        for (const input of inputs) {
            const label = target.querySelector<HTMLElement>(`label[for="${input.id}"]`)!
            expect(label).not.toBeNull()
            expect(input.getAttribute('aria-labelledby')).toBe(label.id)
            expect(input.getAttribute('aria-describedby')!.split(' ')[0]).toBe(label.id)
            expect(controlName(input)).toBe(label.textContent!.trim())
            expect(controlDescription(input).startsWith(controlName(input))).toBe(true)
        }
        const editor = target.querySelector<HTMLElement>('[data-part="settings-usage-price-editor"]')!
        expect(unnamedControls(editor, { fields: true })).toEqual([])
    })
})
