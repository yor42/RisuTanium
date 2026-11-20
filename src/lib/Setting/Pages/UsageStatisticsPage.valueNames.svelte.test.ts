// @vitest-environment jsdom

/**
 * The Statistics page names its three selects (month, retention, clear scope) by the visible label text
 * inside each wrapping label, never by the wrapping label itself, with that text first in the
 * description; the retention select then hears its help text. Kept in its own file so it can travel with
 * the page's own merge.
 *
 * MOCKED: `stores.svelte` (a plain reactive `DBState`), the confirm dialog and the model-list lookup, as the sibling
 * page tests do. The page, the shared inputs, the ledger and the model data service are real.
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
import { fieldNameProblems, unnamedControls } from '../../a11yNames.test-helpers'
import UsageStatisticsPage from './UsageStatisticsPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

const KNOWN_UNNAMED: string[] = []

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

async function render(): Promise<HTMLElement> {
    const statics: Record<string, number> = { messages: 0, imports: 0 }
    recordUsage(statics, { modelKey: 'gpt-priced', purpose: 'chat', reported: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimated: null }, new Date(2026, 5, 15))
    recordUsage(statics, { modelKey: 'gpt-priced', purpose: 'chat', reported: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimated: null }, new Date(2026, 6, 2))
    DBState.db = { statics, customModels: [] } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(UsageStatisticsPage, { target }))
    await vi.dynamicImportSettled()
    flushSync()
    return target
}

describe('UsageStatisticsPage value-control names', () => {
    test('regression reproducer: the month, retention and clear-scope selects are named in source order', async () => {
        const target = await render()
        expect(fieldNameProblems(target, [
            { name: language.usageStats.monthPick },
            { name: language.usageStats.retentionLabel, help: language.usageStats.retentionHelp },
            { name: language.usageStats.clearScopeLabel },
        ])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
