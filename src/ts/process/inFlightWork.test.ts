/**
 * The in-flight registry (`./inFlightWork`) and its mirror of the busy
 * registry (`./memory/busyActions`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    beginInFlight, inFlightKinds, resetInFlightForTest, subscribeInFlight, withInFlight,
} from './inFlightWork'
import {
    beginBusy, beginChokePoint, resetBusyActionsForTest, withBusy,
} from './memory/busyActions'

beforeEach(() => {
    vi.useFakeTimers()
    resetInFlightForTest()
    resetBusyActionsForTest()
})

afterEach(() => {
    resetBusyActionsForTest()
    resetInFlightForTest()
    vi.useRealTimers()
})

describe('the registry', () => {
    test('is idle until a token begins and idle again once it ends', () => {
        expect(inFlightKinds()).toEqual([])
        const end = beginInFlight('chat')
        expect(inFlightKinds()).toEqual(['chat'])
        end()
        expect(inFlightKinds()).toEqual([])
    })

    test('ending twice does not end another token of the same kind', () => {
        const first = beginInFlight('request')
        beginInFlight('request')
        first()
        first()
        expect(inFlightKinds()).toEqual(['request'])
    })

    test('lists each kind once, in the order first begun', () => {
        beginInFlight('tts')
        beginInFlight('chat')
        beginInFlight('tts')
        expect(inFlightKinds()).toEqual(['tts', 'chat'])
    })

    test('subscribers hear every begin and end until they unsubscribe', () => {
        const heard: string[][] = []
        const unsubscribe = subscribeInFlight(() => { heard.push(inFlightKinds()) })
        const end = beginInFlight('image')
        end()
        end()
        expect(heard).toEqual([['image'], []])
        unsubscribe()
        beginInFlight('image')
        expect(heard).toHaveLength(2)
    })

    test('a failing subscriber does not break the begin or the other subscribers', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const heard = vi.fn()
        subscribeInFlight(() => { throw new Error('subscriber failed') })
        subscribeInFlight(heard)
        expect(() => beginInFlight('chat')).not.toThrow()
        expect(heard).toHaveBeenCalledTimes(1)
    })

    test('a token with a max age ends itself, logs, and notifies', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const heard = vi.fn()
        beginInFlight('tts', { maxAgeMs: 1000 })
        subscribeInFlight(heard)
        vi.advanceTimersByTime(999)
        expect(inFlightKinds()).toEqual(['tts'])
        vi.advanceTimersByTime(1)
        expect(inFlightKinds()).toEqual([])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(heard).toHaveBeenCalledTimes(1)
    })

    test('ending a token before its max age leaves no timer behind', () => {
        const end = beginInFlight('tts', { maxAgeMs: 1000 })
        end()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('a token without a max age is never released by time', () => {
        beginInFlight('chat')
        vi.advanceTimersByTime(24 * 60 * 60 * 1000)
        expect(inFlightKinds()).toEqual(['chat'])
    })

    test('withInFlight holds the token while the work runs and ends it on success and on throw', async () => {
        let during: string[] = []
        await withInFlight('translate', async () => { during = inFlightKinds() })
        expect(during).toEqual(['translate'])
        expect(inFlightKinds()).toEqual([])

        await expect(withInFlight('translate', async () => { throw new Error('failed') })).rejects.toThrow('failed')
        expect(inFlightKinds()).toEqual([])
    })
})

describe('the busy mirror', () => {
    test('a busy entry holds a busy token until it ends', () => {
        const handle = beginBusy('import')
        expect(inFlightKinds()).toEqual(['busy'])
        handle.end()
        expect(inFlightKinds()).toEqual([])
    })

    test('ending an entry twice does not end the token of another entry', () => {
        const first = beginBusy('import')
        beginBusy('export')
        first.end()
        first.end()
        expect(inFlightKinds()).toEqual(['busy'])
    })

    test('withBusy releases the token when the work throws', async () => {
        await expect(withBusy('export', async () => { throw new Error('write failed') })).rejects.toThrow('write failed')
        expect(inFlightKinds()).toEqual([])
    })

    test('the write choke points are not mirrored', () => {
        const end = beginChokePoint('asset')
        expect(inFlightKinds()).toEqual([])
        end()
    })

    test('a stale entry is released from the registry after two hours but stays busy', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        beginBusy('hypaBulk')
        vi.advanceTimersByTime(2 * 60 * 60 * 1000 - 1)
        expect(inFlightKinds()).toEqual(['busy'])
        vi.advanceTimersByTime(1)
        expect(inFlightKinds()).toEqual([])
    })

    test('resetting the busy registry also releases the mirrored tokens', () => {
        beginBusy('import')
        beginBusy('export')
        resetBusyActionsForTest()
        expect(inFlightKinds()).toEqual([])
        expect(vi.getTimerCount()).toBe(0)
    })
})
