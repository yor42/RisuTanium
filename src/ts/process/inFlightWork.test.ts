/**
 * The in-flight registry (`./inFlightWork`) and its mirror of the busy
 * registry (`./memory/busyActions`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    beginInFlight, inFlightChatTarget, inFlightKinds, inFlightSince, resetInFlightForTest, subscribeInFlight,
    takeRunOutcome, withInFlight,
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

describe('start times, the chat target and the run outcome', () => {
    // P6, new code: the notification's chronometer, deep link and Stopped/Failed notice read these.
    test('inFlightSince is the earliest live start of a kind, and null when none is live', () => {
        vi.setSystemTime(1000)
        expect(inFlightSince('tts')).toBeNull()
        const first = beginInFlight('tts')
        vi.setSystemTime(2500)
        beginInFlight('tts')
        expect(inFlightSince('tts')).toBe(1000)
        first()
        expect(inFlightSince('tts')).toBe(2500)
        expect(inFlightSince('chat')).toBeNull()
    })

    test('a chat token keeps the owner and chat ids and drops the speaking member', () => {
        beginInFlight('chat', { target: { chaId: 'g', chatId: 'c', memberChaId: 'm' } as { chaId: string, chatId: string } })
        expect(inFlightChatTarget()).toEqual({ chaId: 'g', chatId: 'c' })
        expect(Object.keys(inFlightChatTarget() ?? {})).toEqual(['chaId', 'chatId'])
    })

    test('the latest-begun live chat wins, and none gives null', () => {
        expect(inFlightChatTarget()).toBeNull()
        beginInFlight('chat')
        expect(inFlightChatTarget()).toBeNull()
        const older = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        const newer = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        expect(inFlightChatTarget()).toEqual({ chaId: 'b', chatId: '2' })
        newer()
        expect(inFlightChatTarget()).toEqual({ chaId: 'a', chatId: '1' })
        older()
    })

    test('a target on any other kind is not recorded', () => {
        beginInFlight('tts', { target: { chaId: 'a', chatId: '1' } })
        expect(inFlightChatTarget()).toBeNull()
    })

    test('a chat ended stopped or failed leaves a run outcome that is taken once', () => {
        const target = { chaId: 'a', chatId: '1' }
        beginInFlight('chat', { target })('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target })
        expect(takeRunOutcome()).toBeNull()
        beginInFlight('chat', { target })('failed')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target })
    })

    test('a chat ended with any other outcome, or none, clears the run outcome', () => {
        const target = { chaId: 'a', chatId: '1' }
        for (const outcome of ['reply', 'none', undefined] as const) {
            beginInFlight('chat', { target })('failed')
            beginInFlight('chat', { target })(outcome)
            expect(takeRunOutcome()).toBeNull()
        }
    })

    test('the run outcome keeps only the owner and chat ids of the ended chat', () => {
        const withMember = { chaId: 'g', chatId: 'c', memberChaId: 'm' } as { chaId: string, chatId: string }
        beginInFlight('chat', { target: withMember })('stopped')
        const outcome = takeRunOutcome()
        expect(outcome?.target).toEqual({ chaId: 'g', chatId: 'c' })
        expect(Object.keys(outcome?.target ?? {})).toEqual(['chaId', 'chatId'])
    })

    test('the last of two live chats to end describes the run', () => {
        const target = { chaId: 'a', chatId: '1' }
        const endFirst = beginInFlight('chat', { target })
        const endSecond = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        endFirst('failed')
        endSecond('reply')
        expect(takeRunOutcome()).toBeNull()

        const endThird = beginInFlight('chat', { target })
        const endFourth = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        endThird('reply')
        endFourth('failed')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: { chaId: 'b', chatId: '2' } })
    })

    test('only a chat sets the run outcome', () => {
        beginInFlight('tts')('stopped')
        beginInFlight('image')('failed')
        expect(takeRunOutcome()).toBeNull()
    })

    test('the outcome survives a save and is reset by every other begin', () => {
        beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })('stopped')
        beginInFlight('save')()
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target: { chaId: 'a', chatId: '1' } })
        beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })('failed')
        beginInFlight('translate')
        expect(takeRunOutcome()).toBeNull()
    })

    test('ending a chat twice records only the first end', () => {
        const end = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        end('stopped')
        end('reply')
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target: { chaId: 'a', chatId: '1' } })
    })

    test('the outcome is already set when the subscribers hear of the end', () => {
        const seen: Array<string | null> = []
        const end = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        const unsubscribe = subscribeInFlight(() => {
            if (inFlightKinds().length === 0) {
                seen.push(takeRunOutcome()?.outcome ?? null)
            }
        })
        end('failed')
        unsubscribe()
        expect(seen).toEqual(['failed'])
    })
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
