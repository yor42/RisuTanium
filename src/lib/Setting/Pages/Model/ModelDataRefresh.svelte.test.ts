// @vitest-environment happy-dom

/**
 * `ModelDataRefresh.svelte` is the manual refresh button and status line of the model tab.
 * Mounts the REAL component over the REAL reactive service state (`modelDataStatus` and the
 * seeded snapshot), so the status line is checked against the same state the service writes:
 * mocking the service would only prove the mock.
 *
 * MOCKED: `modelDataStore`, the only module that reaches the page byte store and the network;
 * `refreshModelDataNow` is a spy.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import {
    modelDataStatus,
    resetModelDataForTests,
    seedModelDataForTests,
} from 'src/ts/model/modelData/modelDataService.svelte'
import type { OpenRouterData } from 'src/ts/model/modelData/openrouterData'

const refreshSpy = vi.hoisted(() => vi.fn<() => Promise<'ok' | 'failed'>>())

vi.mock(import('src/ts/model/modelData/modelDataStore'), () => ({
    refreshModelDataNow: refreshSpy,
    startModelData: vi.fn(),
}) as unknown as typeof import('src/ts/model/modelData/modelDataStore'))

import ModelDataRefresh from './ModelDataRefresh.svelte'

const FETCHED_AT = Date.UTC(2026, 9, 11, 12, 0, 0)

function data(fetchedAt: number): OpenRouterData {
    return { v: 1, priceUnit: 'usd-per-token', fetchedAt, limits: {}, pricing: {} }
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

beforeEach(() => {
    resetModelDataForTests()
    refreshSpy.mockReset()
    refreshSpy.mockResolvedValue('ok')
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
    })

    test('calls refreshModelDataNow exactly once per click', () => {
        const target = mountIt()
        button(target).click()
        flushSync()
        expect(refreshSpy).toHaveBeenCalledTimes(1)
        expect(refreshSpy).toHaveBeenCalledWith()
        button(target).click()
        flushSync()
        expect(refreshSpy).toHaveBeenCalledTimes(2)
    })

    test('is disabled and relabelled while refreshing, and a click then does nothing', () => {
        modelDataStatus.refreshing = true
        const target = mountIt()
        expect(button(target).disabled).toBe(true)
        expect(button(target).textContent?.trim()).toBe(language.modelDataRefreshing)
        button(target).click()
        flushSync()
        expect(refreshSpy).not.toHaveBeenCalled()
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
        refreshSpy.mockReturnValue(rejection)
        const target = mountIt()
        button(target).click()
        expect(refreshSpy).toHaveBeenCalledTimes(1)
        expect(thenSpy).toHaveBeenCalledWith(undefined, expect.any(Function))
    })

    test('ignores a click that reaches the handler while refreshing', () => {
        const target = mountIt()
        modelDataStatus.refreshing = true
        // Re-enable the element behind the component's back: only the handler's own guard remains.
        button(target).disabled = false
        button(target).click()
        expect(refreshSpy).not.toHaveBeenCalled()
    })
})

describe('the status line', () => {
    test('says the data was never downloaded when nothing is held', () => {
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusNever)
        expect(status(target)).toBe('Model data has not been downloaded yet')
    })

    test('says when the held data was updated', () => {
        seedModelDataForTests(data(FETCHED_AT))
        modelDataStatus.lastOutcome = 'ok'
        const target = mountIt()
        const time = new Date(FETCHED_AT).toLocaleString()
        expect(status(target)).toBe(language.modelDataStatusUpdated(time))
        expect(status(target)).toContain(time)
        expect(status(target)).toContain('updated')
    })

    test('with held data but no finished attempt it still shows the updated time', () => {
        seedModelDataForTests(data(FETCHED_AT))
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusUpdated(new Date(FETCHED_AT).toLocaleString()))
    })

    test('after a failed refresh with older data it names the time of the data shown', () => {
        seedModelDataForTests(data(FETCHED_AT))
        modelDataStatus.lastOutcome = 'failed'
        const target = mountIt()
        const time = new Date(FETCHED_AT).toLocaleString()
        expect(status(target)).toBe(language.modelDataStatusFailed(time))
        expect(status(target)).toContain(time)
        expect(status(target)).toContain('Could not refresh')
    })

    test('after a failed refresh with no data it says the download failed', () => {
        modelDataStatus.lastOutcome = 'failed'
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusFailedEmpty)
        expect(status(target)).toBe('Could not download model data')
    })

    test('updates after state changes post-mount', () => {
        const target = mountIt()
        expect(status(target)).toBe(language.modelDataStatusNever)

        modelDataStatus.lastOutcome = 'failed'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusFailedEmpty)

        seedModelDataForTests(data(FETCHED_AT))
        modelDataStatus.lastOutcome = 'ok'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusUpdated(new Date(FETCHED_AT).toLocaleString()))

        const later = FETCHED_AT + 86_400_000
        seedModelDataForTests(data(later))
        modelDataStatus.lastOutcome = 'failed'
        flushSync()
        expect(status(target)).toBe(language.modelDataStatusFailed(new Date(later).toLocaleString()))
    })
})
