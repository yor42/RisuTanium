/**
 * The busy registry and the choke-point counters (`../memory/busyActions`).
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    anyChokePointInFlight, beginBusy, beginChokePoint, busyKinds, chokePointInFlight, getLastPluginActivityAt,
    isBusy, isPluginDevModeStarted, markPluginDevModeStarted, resetBusyActionsForTest, stampPluginActivity, withBusy,
} from '../memory/busyActions'

beforeEach(() => {
    resetBusyActionsForTest()
})

describe('the busy registry', () => {
    test('is idle until an action begins and idle again once it ends', () => {
        expect(isBusy()).toBe(false)
        const handle = beginBusy('import')
        expect(isBusy()).toBe(true)
        expect(busyKinds()).toEqual(['import'])
        handle.end()
        expect(isBusy()).toBe(false)
    })

    test('ending an entry twice does not end another entry of the same kind', () => {
        const first = beginBusy('import')
        beginBusy('import')
        first.end()
        first.end()
        expect(busyKinds()).toEqual(['import'])
        expect(isBusy()).toBe(true)
    })

    test('a refusal that excludes its own entry sees only the other entries', () => {
        const own = beginBusy('cleanup')
        expect(isBusy({ except: own })).toBe(false)
        const other = beginBusy('import')
        expect(isBusy({ except: own })).toBe(true)
        other.end()
        expect(isBusy({ except: own })).toBe(false)
        expect(isBusy()).toBe(true)
    })

    test('excluding an entry that has ended excludes nothing', () => {
        const ended = beginBusy('cleanup')
        ended.end()
        beginBusy('import')
        expect(isBusy({ except: ended })).toBe(true)
    })

    test('withBusy ends its entry when the work resolves and when it throws', async () => {
        let during: string[] = []
        await withBusy('export', async () => { during = busyKinds() })
        expect(during).toEqual(['export'])
        expect(isBusy()).toBe(false)

        await expect(withBusy('export', async () => { throw new Error('write failed') })).rejects.toThrow('write failed')
        expect(isBusy()).toBe(false)
    })
})

describe('the choke-point counters', () => {
    test('count writes in flight per point and end idempotently', () => {
        const endAsset = beginChokePoint('asset')
        const endAssetAgain = beginChokePoint('asset')
        const endInlay = beginChokePoint('inlay')
        expect(chokePointInFlight('asset')).toBe(2)
        expect(chokePointInFlight('inlay')).toBe(1)
        expect(anyChokePointInFlight()).toBe(true)

        endAsset()
        endAsset()
        expect(chokePointInFlight('asset')).toBe(1)
        endAssetAgain()
        endInlay()
        expect(anyChokePointInFlight()).toBe(false)
    })
})

describe('the plugin signals', () => {
    test('the last host call is stamped, and the dev-mode flag stays set once raised', () => {
        expect(getLastPluginActivityAt()).toBe(0)
        stampPluginActivity(1234)
        expect(getLastPluginActivityAt()).toBe(1234)

        expect(isPluginDevModeStarted()).toBe(false)
        markPluginDevModeStarted()
        expect(isPluginDevModeStarted()).toBe(true)
    })
})
