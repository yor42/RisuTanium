// @vitest-environment happy-dom

/**
 * `ModelDataRefresh.svelte` is the manual refresh button and status line of the model tab.
 * Mounts the REAL component over the REAL reactive service state (`modelDataStatus` and the
 * seeded snapshots), so the status line is checked against the same state the service writes:
 * mocking the service would only prove the mock.
 *
 * MOCKED: `modelDataStore`, the only module that reaches the page byte store and the network,
 * and `modellist`, whose list pass reads keys. `refreshAllNow` is a spy with the store's
 * contract: the data sources always refresh, the list pass runs only when the option callback
 * answers true at call time. `refreshModelDataNow` is a spy that the component must not call.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import {
    modelDataStatus,
    resetModelDataForTests,
    seedLiteLLMForTests,
    seedModelDataForTests,
} from 'src/ts/model/modelData/modelDataService.svelte'
import type { LiteLLMData } from 'src/ts/model/modelData/litellmData'
import type { OpenRouterData } from 'src/ts/model/modelData/openrouterData'

type Outcome = 'ok' | 'failed' | 'partial'

const mocks = vi.hoisted(() => ({
    refreshAll: vi.fn<(listPass: (isRegistryOn: () => boolean) => Promise<unknown>, isRegistryOn: () => boolean) => Promise<Outcome>>(),
    refreshLegacy: vi.fn<() => Promise<Outcome>>(),
    dataSources: vi.fn<() => void>(),
    listPass: vi.fn<(isRegistryOn: () => boolean) => Promise<Outcome>>(),
    dbState: { db: {} as { dynamicModelRegistry?: boolean } },
}))

vi.mock(import('src/ts/model/modelData/modelDataStore'), () => ({
    refreshAllNow: mocks.refreshAll,
    refreshModelDataNow: mocks.refreshLegacy,
    startModelData: vi.fn(),
}) as unknown as typeof import('src/ts/model/modelData/modelDataStore'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: mocks.dbState,
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/model/modellist'), () => ({
    refreshProviderLists: mocks.listPass,
}) as unknown as typeof import('src/ts/model/modellist'))

import ModelDataRefresh from './ModelDataRefresh.svelte'

const OPENROUTER_AT = Date.UTC(2026, 9, 11, 12, 0, 0)
const LITELLM_AT = OPENROUTER_AT + 86_400_000

function data(fetchedAt: number): OpenRouterData {
    return { v: 1, priceUnit: 'usd-per-token', fetchedAt, limits: {}, pricing: {} }
}

function litellm(fetchedAt: number): LiteLLMData {
    return { v: 1, fetchedAt, rows: {} }
}

function stamp(at: number): string {
    return new Date(at).toLocaleString()
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountIt(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModelDataRefresh, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function button(target: HTMLElement): HTMLButtonElement {
    return target.querySelector('button') as HTMLButtonElement
}

function status(target: HTMLElement): string {
    return target.querySelector('[data-testid="model-data-status"]')?.textContent ?? ''
}

function setOption(on: boolean): void {
    mocks.dbState.db = { dynamicModelRegistry: on }
}

beforeEach(() => {
    resetModelDataForTests()
    mocks.refreshAll.mockReset()
    mocks.refreshLegacy.mockReset()
    mocks.dataSources.mockReset()
    mocks.listPass.mockReset()
    mocks.listPass.mockResolvedValue('ok')
    mocks.refreshLegacy.mockResolvedValue('ok')
    mocks.refreshAll.mockImplementation(async (listPass, isRegistryOn) => {
        mocks.dataSources()
        if (isRegistryOn()) {
            await listPass(isRegistryOn)
        }
        return 'ok'
    })
    setOption(true)
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    resetModelDataForTests()
})

describe('the refresh button', () => {
    test('is enabled and labelled "Refresh model data" while idle', () => {
        const target = mountIt()
        expect(button(target).disabled).toBe(false)
        expect(button(target).textContent?.trim()).toBe(language.modelDataRefresh)
        expect(button(target).textContent?.trim()).toBe(languageEnglish.modelDataRefresh)
        expect(languageEnglish.modelDataRefresh).toBe('Refresh model data')
    })

    test('calls refreshAllNow exactly once per click with the list pass and an option callback', () => {
        const target = mountIt()
        button(target).click()
        flushSync()
        expect(mocks.refreshAll).toHaveBeenCalledTimes(1)
        expect(mocks.refreshAll).toHaveBeenCalledWith(mocks.listPass, expect.any(Function))
        button(target).click()
        flushSync()
        expect(mocks.refreshAll).toHaveBeenCalledTimes(2)
        expect(mocks.refreshLegacy).not.toHaveBeenCalled()
    })

    test('with the option on the list pass runs through refreshAllNow, and the data sources refresh', async () => {
        setOption(true)
        const target = mountIt()
        button(target).click()
        await vi.waitFor(() => expect(mocks.listPass).toHaveBeenCalledTimes(1))
        expect(mocks.dataSources).toHaveBeenCalledTimes(1)
        expect(mocks.refreshLegacy).not.toHaveBeenCalled()
    })

    test('reads the option at call time, not at mount', async () => {
        setOption(true)
        const target = mountIt()
        setOption(false)
        button(target).click()
        flushSync()
        await Promise.resolve()
        const isRegistryOn = mocks.refreshAll.mock.calls[0][1]
        expect(isRegistryOn()).toBe(false)
        expect(mocks.listPass).not.toHaveBeenCalled()
        setOption(true)
        expect(isRegistryOn()).toBe(true)
    })

    test('with the option off the list pass is not invoked and the data sources still refresh', async () => {
        setOption(false)
        const target = mountIt()
        button(target).click()
        await vi.waitFor(() => expect(mocks.dataSources).toHaveBeenCalledTimes(1))
        expect(mocks.listPass).not.toHaveBeenCalled()
        expect(mocks.refreshAll).toHaveBeenCalledTimes(1)
    })

    test('is disabled and relabelled while refreshing, and a click then does nothing', () => {
        modelDataStatus.refreshing = true
        const target = mountIt()
        expect(button(target).disabled).toBe(true)
        expect(button(target).textContent?.trim()).toBe(language.modelDataRefreshing)
        button(target).click()
        flushSync()
        expect(mocks.refreshAll).not.toHaveBeenCalled()
        expect(mocks.refreshLegacy).not.toHaveBeenCalled()
    })

    test('follows the refreshing flag after mount', () => {
        const target = mountIt()
        expect(button(target).disabled).toBe(false)
        modelDataStatus.refreshing = true
        flushSync()
        expect(button(target).disabled).toBe(true)
        expect(button(target).textContent?.trim()).toBe(language.modelDataRefreshing)
        modelDataStatus.refreshing = false
        flushSync()
        expect(button(target).disabled).toBe(false)
        expect(button(target).textContent?.trim()).toBe(language.modelDataRefresh)
    })

    test('attaches a rejection handler so a rejected refresh cannot escape the click handler', () => {
        const rejection = Promise.reject(new Error('boom'))
        const thenSpy = vi.spyOn(rejection, 'then')
        mocks.refreshAll.mockReturnValue(rejection)
        const target = mountIt()
        button(target).click()
        expect(mocks.refreshAll).toHaveBeenCalledTimes(1)
        expect(thenSpy).toHaveBeenCalledWith(undefined, expect.any(Function))
    })

    test('ignores a click that reaches the handler while refreshing', () => {
        const target = mountIt()
        modelDataStatus.refreshing = true
        // Re-enable the element behind the component's back: only the handler's own guard remains.
        button(target).disabled = false
        button(target).click()
        expect(mocks.refreshAll).not.toHaveBeenCalled()
    })
})

describe('the status line', () => {
    test('says the data was never downloaded when nothing is held', () => {
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusNever)
        expect(status(target)).toBe('Model data has not been downloaded yet')
    })

    test('says when the held data was updated', () => {
        seedModelDataForTests(data(OPENROUTER_AT))
        modelDataStatus.lastOutcome = 'ok'
        const target = mountIt()
        const time = stamp(OPENROUTER_AT)
        expect(status(target)).toBe(language.modelDataStatusUpdated(time))
        expect(status(target)).toContain(time)
        expect(status(target)).toContain('updated')
    })

    test('with held data but no finished attempt it still shows the updated time', () => {
        seedModelDataForTests(data(OPENROUTER_AT))
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusUpdated(stamp(OPENROUTER_AT)))
    })

    test('updated names the newest of the two source times', () => {
        seedModelDataForTests(data(OPENROUTER_AT))
        seedLiteLLMForTests(litellm(LITELLM_AT))
        modelDataStatus.lastOutcome = 'ok'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusUpdated(stamp(LITELLM_AT)))
        expect(status(target)).not.toContain(stamp(OPENROUTER_AT))
    })

    test('updated names the only time held when just LiteLLM has data', () => {
        seedLiteLLMForTests(litellm(LITELLM_AT))
        modelDataStatus.lastOutcome = 'ok'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusUpdated(stamp(LITELLM_AT)))
    })

    test('after a failed refresh with older data it names the time of the data shown', () => {
        seedModelDataForTests(data(OPENROUTER_AT))
        modelDataStatus.lastOutcome = 'failed'
        const target = mountIt()
        const time = stamp(OPENROUTER_AT)
        expect(status(target)).toBe(language.modelDataStatusFailed(time))
        expect(status(target)).toContain(time)
        expect(status(target)).toContain('Could not refresh')
    })

    test('failed names the oldest of the two source times', () => {
        seedModelDataForTests(data(OPENROUTER_AT))
        seedLiteLLMForTests(litellm(LITELLM_AT))
        modelDataStatus.lastOutcome = 'failed'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusFailed(stamp(OPENROUTER_AT)))
        expect(status(target)).not.toContain(stamp(LITELLM_AT))
    })

    test('failed names the only time held when just LiteLLM has data', () => {
        seedLiteLLMForTests(litellm(LITELLM_AT))
        modelDataStatus.lastOutcome = 'failed'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusFailed(stamp(LITELLM_AT)))
    })

    test('after a failed refresh with no data it says the download failed', () => {
        modelDataStatus.lastOutcome = 'failed'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusFailedEmpty)
        expect(status(target)).toBe('Could not download model data')
    })

    test('after a partial refresh it says some sources could not be updated and names no time', () => {
        seedModelDataForTests(data(OPENROUTER_AT))
        seedLiteLLMForTests(litellm(LITELLM_AT))
        modelDataStatus.lastOutcome = 'partial'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusPartial)
        expect(status(target)).toBe(languageEnglish.modelDataStatusPartial)
        expect(status(target)).not.toContain(stamp(OPENROUTER_AT))
        expect(status(target)).not.toContain(stamp(LITELLM_AT))
    })

    test('after a partial refresh with no data held it still says some sources could not be updated', () => {
        modelDataStatus.lastOutcome = 'partial'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusPartial)
    })

    test('updates after state changes post-mount', () => {
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusNever)

        modelDataStatus.lastOutcome = 'failed'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusFailedEmpty)

        seedModelDataForTests(data(OPENROUTER_AT))
        modelDataStatus.lastOutcome = 'ok'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusUpdated(stamp(OPENROUTER_AT)))

        const later = OPENROUTER_AT + 86_400_000
        seedModelDataForTests(data(later))
        modelDataStatus.lastOutcome = 'failed'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusFailed(stamp(later)))
    })

    test('follows a refresh that finishes after mount, through both sources and a partial outcome', () => {
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusNever)

        seedModelDataForTests(data(OPENROUTER_AT))
        modelDataStatus.lastOutcome = 'partial'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusPartial)

        seedLiteLLMForTests(litellm(LITELLM_AT))
        modelDataStatus.lastOutcome = 'ok'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusUpdated(stamp(LITELLM_AT)))
    })
})
