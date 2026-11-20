// @vitest-environment jsdom

/**
 * The Statistics page: accessible tables built from the ledger, the estimated, unpriced, partly unpriced and overflow
 * labels, the month choice, and the price-override editor that writes `DBState.db.usagePriceOverrides`.
 *
 * MOCKED: `stores.svelte` (a plain reactive `DBState`) and the model-list lookup. The page, the shared inputs, the ledger,
 * the cost calculator and the model data service are real; catalog prices are seeded from the real LiteLLM parser. No
 * sanitizer or markdown is involved, so every assertion reads the rendered text and attributes directly.
 *
 * Labels: (G) guard over a new component. Backed by scratch mutants M6 (a missing price counted as 0) and M25 (unpriced
 * rendered as $0.0000).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
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
import { alertConfirm } from '../../../ts/alert'
import { parseLiteLLMDataset } from '../../../ts/model/modelData/litellmData'
import { resetModelDataForTests, seedLiteLLMForTests } from '../../../ts/model/modelData/modelDataService.svelte'
import { DBState } from '../../../ts/stores.svelte'
import { recordUsage } from '../../../ts/usage/usageLedger'
import type { UsageEntry } from '../../../ts/usage/usageTypes'
import SelectInput from '../../UI/GUI/SelectInput.svelte'
import UsageStatisticsPage from './UsageStatisticsPage.svelte'

const text = language.usageStats
const JUNE = new Date(2026, 5, 15)
const JULY = new Date(2026, 6, 2)
const mounted: Array<ReturnType<typeof mount>> = []

function entry(modelKey: string, purpose: UsageEntry['purpose'], input: number, output: number, cacheRead = 0): UsageEntry {
    return { modelKey, purpose, reported: { input, output, cacheRead, cacheWrite: 0 }, estimated: null }
}

function setLedger(...records: [UsageEntry, Date][]): void {
    const statics: Record<string, number> = { messages: 0, imports: 0 }
    for (const [item, when] of records) {
        recordUsage(statics, item, when)
    }
    DBState.db = { statics, customModels: [] } as unknown as Database
}

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(UsageStatisticsPage, { target }))
    flushSync()
    return target
}

/** Mounts the page and waits for the model list it loads on open, which its prices depend on. */
async function render(): Promise<HTMLElement> {
    const target = mountPage()
    await vi.dynamicImportSettled()
    flushSync()
    return target
}

function table(target: HTMLElement, part: string): HTMLTableElement {
    const found = target.querySelector<HTMLTableElement>(`table[data-part="${part}"]`)
    if (!found) throw new Error(`no table ${part}`)
    return found
}

function rowOf(root: HTMLElement, selector: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(selector)
    if (!found) throw new Error(`no row ${selector}`)
    return found
}

function press(target: HTMLElement, label: string): void {
    const button = [...target.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim().startsWith(label))
    if (!button) throw new Error(`no button ${label}`)
    button.click()
    flushSync()
}

function type(target: HTMLElement, id: string, value: string): void {
    const input = target.querySelector<HTMLInputElement>(`#${id}`)
    if (!input) throw new Error(`no input ${id}`)
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

const confirmMock = vi.mocked(alertConfirm)

beforeEach(() => {
    confirmMock.mockReset()
    resetModelDataForTests()
    seedLiteLLMForTests(parseLiteLLMDataset({
        'gpt-priced': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1000, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
    }, 1))
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetModelDataForTests()
})

describe('empty and populated page (G)', () => {
    test('an empty ledger shows the empty state and no table', async () => {
        setLedger()
        const target = await render()
        expect(target.textContent).toContain(text.empty)
        expect(target.querySelector('table')).toBeNull()
        expect(target.textContent).toContain(text.note)
    })

    test('no figures show before the model list has loaded, so no price comes from the wrong source', async () => {
        setLedger([entry('gpt-priced', 'chat', 1000, 500), JUNE])
        const target = mountPage()
        expect(target.querySelector('table')).toBeNull()
        await vi.dynamicImportSettled()
        flushSync()
        expect(target.querySelector('table')).not.toBeNull()
    })

    test('a model list that fails to load still shows the tables, unpriced, with no unhandled rejection', async () => {
        setLedger([entry('gpt-unknown', 'chat', 1000, 500), JUNE])
        const unhandled: unknown[] = []
        const record = (reason: unknown): void => { unhandled.push(reason) }
        process.on('unhandledRejection', record)
        vi.doMock('../../../ts/model/modellist', () => { throw new Error('model list chunk failed to load') })
        try {
            const target = await render()
            await new Promise((resolve) => setTimeout(resolve, 0))
            flushSync()
            const row = rowOf(table(target, 'usage-models'), '[data-model="gpt-unknown"]')
            expect(row.textContent).toContain(text.unpriced)
            expect(row.textContent).not.toContain('$')
            expect(unhandled).toEqual([])
        } finally {
            process.off('unhandledRejection', record)
            vi.doMock('../../../ts/model/modellist', workingModelList)
        }
    })

    test('catalog prices that load while the page is open replace "unpriced" without reopening it', async () => {
        resetModelDataForTests()
        setLedger([entry('gpt-priced', 'chat', 1000, 500), JUNE])
        const target = await render()
        expect(rowOf(table(target, 'usage-models'), '[data-model="gpt-priced"]').textContent).toContain(text.unpriced)
        seedLiteLLMForTests(parseLiteLLMDataset({
            'gpt-priced': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: 1000, input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
        }, 2))
        flushSync()
        const row = rowOf(table(target, 'usage-models'), '[data-model="gpt-priced"]')
        expect(row.textContent).toContain('$0.002')
        expect(row.textContent).not.toContain(text.unpriced)
    })

    test('the tables have captions and column headers with scope, and the purpose is named in words', async () => {
        setLedger([entry('gpt-priced', 'chat', 1000, 500), JUNE], [entry('gpt-priced', 'utility', 10, 5), JUNE])
        const target = await render()
        const tables = [...target.querySelectorAll('table')]
        expect(tables).toHaveLength(3)
        for (const one of tables) {
            expect(one.querySelector('caption')?.textContent?.trim(), 'caption').not.toBe('')
            const heads = [...one.querySelectorAll('thead th')]
            expect(heads.length).toBeGreaterThan(0)
            for (const head of heads) {
                expect(head.getAttribute('scope')).toBe('col')
            }
        }
        const purposes = table(target, 'usage-purposes')
        expect(rowOf(purposes, '[data-purpose="chat"]').textContent).toContain(text.purposeChat)
        expect(rowOf(purposes, '[data-purpose="utility"]').textContent).toContain(text.purposeUtility)
        expect(rowOf(table(target, 'usage-months'), 'tbody tr th[scope="row"]').textContent).toContain('2026-06')
    })

    test('a priced model shows its exact cost with no unpriced label', async () => {
        setLedger([entry('gpt-priced', 'chat', 1000, 500), JUNE])
        const target = await render()
        const row = rowOf(table(target, 'usage-models'), '[data-model="gpt-priced"]')
        expect(row.textContent).toContain('$0.002')
        expect(row.textContent).not.toContain(text.unpriced)
    })

    test('an unpriced model reads "unpriced" and never a dollar amount', async () => {
        setLedger([entry('gpt-unknown', 'chat', 1000, 500), JUNE])
        const target = await render()
        const row = rowOf(table(target, 'usage-models'), '[data-model="gpt-unknown"]')
        expect(row.textContent).toContain(text.unpriced)
        expect(row.textContent).not.toContain('$')
        expect(rowOf(table(target, 'usage-months'), 'tbody tr').textContent).not.toContain('$')
    })

    test('cache tokens with no cache price read "partly unpriced" next to the priced part', async () => {
        setLedger([entry('gpt-priced', 'chat', 1000, 500, 2000), JUNE])
        const target = await render()
        const row = rowOf(table(target, 'usage-models'), '[data-model="gpt-priced"]')
        expect(row.textContent).toContain('$0.002')
        expect(row.textContent).toContain(text.partlyUnpriced)
    })

    test('an attempt counted by estimate carries the estimated label, an exact one does not', async () => {
        setLedger([{ modelKey: 'gpt-priced', purpose: 'chat', reported: null, estimated: { input: 40, output: 20 } }, JUNE], [entry('gpt-priced', 'chat', 1, 1), JULY])
        const target = await render()
        const months = [...table(target, 'usage-months').querySelectorAll('tbody tr')]
        const june = months.find((row) => row.textContent?.includes('2026-06'))
        const july = months.find((row) => row.textContent?.includes('2026-07'))
        expect(june?.textContent).toContain(text.estimated)
        expect(july?.textContent).not.toContain(text.estimated)
    })

    test('the overflow row appears only when overflow counters exist', async () => {
        setLedger([entry('gpt-priced', 'chat', 1, 1), JUNE])
        expect((await render()).querySelector('[data-part="usage-overflow"]')).toBeNull()
        const statics = DBState.db.statics as unknown as Record<string, number>
        statics['u1|ovf|n'] = 4
        const target = await render()
        expect(rowOf(target, '[data-part="usage-overflow"]').textContent).toContain(text.overflow)
    })

    test('the month choice switches the By model breakdown', async () => {
        setLedger([entry('gpt-priced', 'chat', 1, 1), JUNE], [entry('gpt-unknown', 'chat', 1, 1), JULY])
        const target = await render()
        expect(target.querySelector('[data-model="gpt-unknown"]')).not.toBeNull()
        expect(target.querySelector('[data-model="gpt-priced"]')).toBeNull()
        const select = target.querySelector('select')
        expect(select?.closest('label')?.textContent).toContain(text.monthPick)
        select!.value = '2026-06'
        select!.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(target.querySelector('[data-model="gpt-priced"]')).not.toBeNull()
        expect(target.querySelector('[data-model="gpt-unknown"]')).toBeNull()
    })
})

describe('price override editor (G)', () => {
    function openEditor(target: HTMLElement): void {
        press(target, text.setPrice)
    }

    test('the four inputs are labelled and a price saves, changes the cost and persists on the profile', async () => {
        setLedger([entry('gpt-unknown', 'chat', 1000, 500), JUNE])
        const target = await render()
        openEditor(target)
        for (const [id, label] of [
            ['usage-price-input', text.priceInput], ['usage-price-output', text.priceOutput],
            ['usage-price-cacheRead', text.priceCacheRead], ['usage-price-cacheWrite', text.priceCacheWrite],
        ]) {
            expect(target.querySelector(`label[for="${id}"]`)?.textContent).toBe(label)
        }
        type(target, 'usage-price-input', '10')
        type(target, 'usage-price-output', '20')
        press(target, text.priceSave)
        expect(DBState.db.usagePriceOverrides).toEqual({ 'gpt-unknown': { input: '10', output: '20' } })
        const row = rowOf(table(target, 'usage-models'), '[data-model="gpt-unknown"]')
        expect(row.textContent).toContain('$0.02')
        expect(row.textContent).toContain(text.yourPrice)
        expect(target.querySelector('[data-part="usage-price-editor"]')).toBeNull()
    })

    test('opening the editor focuses its first input, and save or "Use catalog price" returns focus to the row\'s Set price button', async () => {
        setLedger([entry('gpt-unknown', 'chat', 1, 1), JUNE])
        const target = await render()
        const settle = async (): Promise<void> => { await tick(); flushSync() }
        openEditor(target)
        await settle()
        expect(document.activeElement?.id).toBe('usage-price-input')
        type(target, 'usage-price-input', '2')
        press(target, text.priceSave)
        await settle()
        const rowButton = rowOf(table(target, 'usage-models'), '[data-model="gpt-unknown"] button')
        expect(document.activeElement).toBe(rowButton)
        openEditor(target)
        await settle()
        press(target, text.priceClear)
        await settle()
        expect(document.activeElement).toBe(rowOf(table(target, 'usage-models'), '[data-model="gpt-unknown"] button'))
    })

    test('a negative, non-numeric or empty price is refused with a message and writes nothing', async () => {
        setLedger([entry('gpt-unknown', 'chat', 1000, 500), JUNE])
        const target = await render()
        openEditor(target)
        press(target, text.priceSave)
        expect(target.querySelector('[data-part="usage-price-invalid"]')?.textContent).toBe(text.priceInvalid)
        for (const bad of ['-1', 'abc', '1e3', '1,5']) {
            type(target, 'usage-price-input', bad)
            press(target, text.priceSave)
            expect(target.querySelector('[data-part="usage-price-invalid"]'), bad).not.toBeNull()
        }
        expect(DBState.db.usagePriceOverrides).toBeUndefined()
    })

    test('"Use catalog price" removes the override and the model goes back to its catalog cost', async () => {
        setLedger([entry('gpt-priced', 'chat', 1000, 500), JUNE])
        DBState.db.usagePriceOverrides = { 'gpt-priced': { input: '10', output: '20' } }
        const target = await render()
        expect(rowOf(table(target, 'usage-models'), '[data-model="gpt-priced"]').textContent).toContain('$0.02')
        openEditor(target)
        expect((target.querySelector('#usage-price-input') as HTMLInputElement).value).toBe('10')
        press(target, text.priceClear)
        expect(DBState.db.usagePriceOverrides).toBeUndefined()
        expect(rowOf(table(target, 'usage-models'), '[data-model="gpt-priced"]').textContent).toContain('$0.002')
    })

    test('a saved price keeps the other models\' overrides', async () => {
        setLedger([entry('gpt-unknown', 'chat', 1, 1), JUNE])
        DBState.db.usagePriceOverrides = { other: { input: '1' } }
        const target = await render()
        openEditor(target)
        type(target, 'usage-price-input', '2.5')
        press(target, text.priceSave)
        expect(DBState.db.usagePriceOverrides).toEqual({ other: { input: '1' }, 'gpt-unknown': { input: '2.5' } })
        openEditor(target)
        press(target, text.priceClear)
        expect(DBState.db.usagePriceOverrides).toEqual({ other: { input: '1' } })
    })
})

describe('clear and retention controls (G)', () => {
    const settle = async (): Promise<void> => {
        for (let i = 0; i < 4; i++) {
            await Promise.resolve()
            await tick()
            flushSync()
        }
    }

    /** Sets a select to `value` and fires its change event like a person choosing the option. */
    async function choose(select: HTMLSelectElement, value: string): Promise<void> {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        await settle()
    }

    const retentionSelect = (target: HTMLElement): HTMLSelectElement => rowOf(target, '[data-part="usage-manage"] select') as HTMLSelectElement
    const clearSelect = (target: HTMLElement): HTMLSelectElement => rowOf(target, '[data-part="usage-clear"] select') as HTMLSelectElement
    const statics = (): Record<string, unknown> => DBState.db.statics as unknown as Record<string, unknown>
    const hasMonth = (month: string): boolean => Object.keys(statics()).some((key) => key.startsWith(`u1|${month}|`))

    /** Every old month holds 3 models x 2 purposes x several counters, so its key count is far above its month count. */
    function oldMonths(): [UsageEntry, Date][] {
        const records: [UsageEntry, Date][] = []
        for (const when of [new Date(2026, 0, 5), new Date(2026, 1, 5)]) {
            for (const model of ['m1', 'm2', 'm3']) {
                for (const purpose of ['chat', 'utility'] as const) {
                    records.push([entry(model, purpose, 4, 2, 1), when])
                }
            }
        }
        return records
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(2026, 7, 20, 12, 0, 0))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    test('T-P1 clear all on yes removes the statistics, keeps messages, imports and prices, shows the empty page and focuses the notice', async () => {
        setLedger([entry('gpt-priced', 'chat', 1, 1), JUNE], [entry('gpt-priced', 'chat', 1, 1), JULY])
        statics()['u1|ovf|n'] = 4
        DBState.db.usagePriceOverrides = { 'gpt-priced': { input: '1' } }
        statics().messages = 7
        statics().imports = 2
        confirmMock.mockResolvedValue(true)
        const target = await render()

        press(target, text.clearButton)
        await settle()

        expect(Object.keys(statics()).filter((key) => key.startsWith('u1|'))).toEqual([])
        expect(statics().messages).toBe(7)
        expect(statics().imports).toBe(2)
        expect(DBState.db.usagePriceOverrides).toEqual({ 'gpt-priced': { input: '1' } })
        expect(target.querySelector('[data-part="usage-empty"]')).not.toBeNull()
        const notice = rowOf(target, '[data-part="usage-cleared"]')
        expect(notice.textContent).toBe(text.clearedNotice)
        expect(document.activeElement).toBe(notice)
    })

    test('T-P2 clear all on no changes nothing and asks once with the all-months text', async () => {
        setLedger([entry('gpt-priced', 'chat', 1, 1), JUNE])
        DBState.db.usagePriceOverrides = { 'gpt-priced': { input: '1' } }
        const before = structuredClone($state.snapshot(DBState.db.statics))
        confirmMock.mockResolvedValue(false)
        const target = await render()

        press(target, text.clearButton)
        await settle()

        expect(confirmMock).toHaveBeenCalledTimes(1)
        expect(confirmMock).toHaveBeenCalledWith(text.clearConfirmAll)
        expect($state.snapshot(DBState.db.statics)).toEqual(before)
        expect(DBState.db.usagePriceOverrides).toEqual({ 'gpt-priced': { input: '1' } })
        expect(target.querySelector('[data-part="usage-cleared"]')).toBeNull()
    })

    test('T-P3 clear before July removes June, keeps July, August and the overflow row, and does not offer the oldest month', async () => {
        const august = new Date(2026, 7, 3)
        setLedger([entry('gpt-priced', 'chat', 1, 1), JUNE], [entry('gpt-priced', 'chat', 1, 1), JULY], [entry('gpt-priced', 'chat', 1, 1), august])
        statics()['u1|ovf|n'] = 4
        confirmMock.mockResolvedValue(true)
        const target = await render()
        const select = clearSelect(target)
        expect([...select.options].map((option) => option.value)).toEqual(['all', 'before:2026-08', 'before:2026-07'])

        await choose(select, 'before:2026-07')
        press(target, text.clearButton)
        await settle()

        expect(confirmMock).toHaveBeenCalledWith(text.clearConfirmBefore('2026-07'))
        expect(hasMonth('2026-06')).toBe(false)
        expect(hasMonth('2026-07')).toBe(true)
        expect(hasMonth('2026-08')).toBe(true)
        expect(target.querySelector('[data-part="usage-overflow"]')).not.toBeNull()
    })

    test('T-P4 a period with no old month stores the number without asking; Off removes the field without asking; the select is labelled and shown on an empty page', async () => {
        setLedger()
        const target = await render()
        const select = retentionSelect(target)
        expect(select.closest('label')?.textContent).toContain(text.retentionLabel)
        expect(target.querySelector('[data-part="usage-clear"]')).toBeNull()

        await choose(select, '6')
        expect(DBState.db.usageRetentionMonths).toBe(6)
        await choose(select, 'off')
        expect('usageRetentionMonths' in DBState.db).toBe(false)
        expect(confirmMock).not.toHaveBeenCalled()
    })

    test('T-P5 a period that deletes months asks with the month count; decline keeps the setting and the select; accept stores it and prunes', async () => {
        setLedger(...oldMonths(), [entry('m1', 'chat', 1, 1), JULY], [entry('m1', 'chat', 1, 1), new Date(2026, 7, 3)])
        const keysBefore = Object.keys(statics()).length
        expect(keysBefore).toBeGreaterThan(20)
        const target = await render()
        const select = retentionSelect(target)

        confirmMock.mockResolvedValueOnce(false)
        await choose(select, '3')
        expect(confirmMock).toHaveBeenCalledTimes(1)
        expect(confirmMock).toHaveBeenCalledWith(text.retentionConfirm(3, 2))
        expect('usageRetentionMonths' in DBState.db).toBe(false)
        expect(Object.keys(statics())).toHaveLength(keysBefore)
        expect(select.value).toBe('off')

        confirmMock.mockResolvedValueOnce(true)
        await choose(select, '3')
        expect(DBState.db.usageRetentionMonths).toBe(3)
        expect(hasMonth('2026-01')).toBe(false)
        expect(hasMonth('2026-02')).toBe(false)
        expect(hasMonth('2026-07')).toBe(true)
        expect(hasMonth('2026-08')).toBe(true)
        expect(select.value).toBe('3')
    })

    test('T-P5b declining a shorter period keeps the stored period on the select and in the setting', async () => {
        setLedger(...oldMonths(), [entry('m1', 'chat', 1, 1), new Date(2026, 7, 3)])
        DBState.db.usageRetentionMonths = 12
        const target = await render()
        const select = retentionSelect(target)
        expect(select.value).toBe('12')

        confirmMock.mockResolvedValueOnce(false)
        await choose(select, '3')

        expect(DBState.db.usageRetentionMonths).toBe(12)
        expect(select.value).toBe('12')
        expect(hasMonth('2026-01')).toBe(true)
    })

    test('T-P5c a setting changed elsewhere while the page is open (peer fast-forward, import) shows on the select', async () => {
        setLedger([entry('m1', 'chat', 1, 1), new Date(2026, 7, 3)])
        const target = await render()
        const select = retentionSelect(target)
        expect(select.value).toBe('off')

        DBState.db.usageRetentionMonths = 12
        flushSync()

        expect(select.value).toBe('12')
    })

    test('T-P6 lengthening a period, and overflow alone, never ask', async () => {
        setLedger([entry('m1', 'chat', 1, 1), new Date(2026, 7, 3)])
        statics()['u1|ovf|n'] = 5
        DBState.db.usageRetentionMonths = 3
        const target = await render()
        const select = retentionSelect(target)

        await choose(select, '12')

        expect(DBState.db.usageRetentionMonths).toBe(12)
        expect(confirmMock).not.toHaveBeenCalled()
        expect(statics()['u1|ovf|n']).toBe(5)
    })

    test('T-P7 the retention select is described by its help text; a select without the prop has no aria-describedby', async () => {
        setLedger([entry('m1', 'chat', 1, 1), JUNE])
        const target = await render()
        const select = retentionSelect(target)
        const described = select.getAttribute('aria-describedby')
        expect(described).toBe('usage-retention-help')
        expect(target.querySelector(`#${described}`)?.textContent).toBe(text.retentionHelp)

        const plain = document.createElement('div')
        document.body.appendChild(plain)
        mounted.push(mount(SelectInput, { target: plain, props: { value: 'a' } }))
        flushSync()
        expect(plain.querySelector('select')?.hasAttribute('aria-describedby')).toBe(false)
    })
})
