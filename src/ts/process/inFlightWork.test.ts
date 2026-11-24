/**
 * The in-flight registry (`./inFlightWork`) and its mirror of the busy
 * registry (`./memory/busyActions`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    beginInFlight, inFlightChatCount, inFlightChatTarget, inFlightKinds, inFlightSince, resetInFlightForTest, subscribeInFlight,
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
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target, count: 1 })
        expect(takeRunOutcome()).toBeNull()
        beginInFlight('chat', { target })('failed')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target, count: 1 })
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

    test('a failed chat is not erased by the other chat ending with a reply, in either order', () => {
        const a = { chaId: 'a', chatId: '1' }
        const b = { chaId: 'b', chatId: '2' }
        const endA = beginInFlight('chat', { target: a })
        const endB = beginInFlight('chat', { target: b })
        endA('failed')
        endB('reply')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: a, count: 1 })

        const endC = beginInFlight('chat', { target: a })
        const endD = beginInFlight('chat', { target: b })
        endC('reply')
        endD('failed')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: b, count: 1 })
        expect(takeRunOutcome()).toBeNull()
    })

    test('two chats that both reply leave no outcome', () => {
        const endA = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        const endB = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        endA('reply')
        endB('none')
        expect(takeRunOutcome()).toBeNull()
    })

    test('two stopped chats give a count and no target', () => {
        const endA = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        const endB = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        endA('stopped')
        endB('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target: null, count: 2 })
    })

    test('two failed chats and a stopped one count only the failed ones', () => {
        const ends = ['a', 'b', 'c'].map((id) => beginInFlight('chat', { target: { chaId: id, chatId: '1' } }))
        ends[0]('failed')
        ends[1]('failed')
        ends[2]('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: null, count: 2 })
    })

    test('one failed chat is named whatever stopped, in either order of ending', () => {
        const a = { chaId: 'a', chatId: '1' }
        const b = { chaId: 'b', chatId: '2' }
        const c = { chaId: 'c', chatId: '3' }
        const endA = beginInFlight('chat', { target: a })
        const endB = beginInFlight('chat', { target: b })
        endA('failed')
        endB('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: a, count: 1 })

        const endC = beginInFlight('chat', { target: a })
        const endD = beginInFlight('chat', { target: b })
        endD('stopped')
        endC('failed')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: a, count: 1 })

        const ends = [a, b, c].map((target) => beginInFlight('chat', { target }))
        ends[0]('failed')
        ends[1]('stopped')
        ends[2]('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: a, count: 1 })
    })

    test('a failed chat without a target still counts as one failure with no target', () => {
        const endA = beginInFlight('chat')
        const endB = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        endA('failed')
        endB('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: null, count: 1 })
    })

    test('a failure survives another kind beginning and ending while a chat is live', () => {
        const target = { chaId: 'a', chatId: '1' }
        const endTts = beginInFlight('tts')
        beginInFlight('chat', { target })('failed')
        beginInFlight('translate')()
        endTts()
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target, count: 1 })
    })

    test('a chat that begins again replaces only its own outcome', () => {
        const a = { chaId: 'a', chatId: '1' }
        const b = { chaId: 'b', chatId: '2' }
        const endA = beginInFlight('chat', { target: a })
        const endB = beginInFlight('chat', { target: b })
        endA('failed')
        beginInFlight('chat', { target: a })('reply')
        endB('reply')
        expect(takeRunOutcome()).toBeNull()

        const endC = beginInFlight('chat', { target: a })
        const endD = beginInFlight('chat', { target: b })
        endC('failed')
        const endE = beginInFlight('chat', { target: b })
        endD('reply')
        endE('reply')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: a, count: 1 })
    })

    test('a begin with nothing live clears a leftover outcome nobody took', () => {
        beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })('stopped')
        beginInFlight('image')
        expect(takeRunOutcome()).toBeNull()
    })

    test('inFlightChatCount counts distinct targets and a token without one once', () => {
        expect(inFlightChatCount()).toBe(0)
        const first = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        expect(inFlightChatCount()).toBe(1)
        const again = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        expect(inFlightChatCount()).toBe(1)
        const second = beginInFlight('chat', { target: { chaId: 'b', chatId: '2' } })
        expect(inFlightChatCount()).toBe(2)
        beginInFlight('tts')
        expect(inFlightChatCount()).toBe(2)
        const bare = beginInFlight('chat')
        expect(inFlightChatCount()).toBe(3)
        bare()
        second()
        again()
        expect(inFlightChatCount()).toBe(1)
        first()
        expect(inFlightChatCount()).toBe(0)
    })

    test('two chats of one character are two chats: counted twice and each outcome kept apart', () => {
        const one = { chaId: 'a', chatId: '1' }
        const two = { chaId: 'a', chatId: '2' }
        const endOne = beginInFlight('chat', { target: one })
        const endTwo = beginInFlight('chat', { target: two })
        expect(inFlightChatCount()).toBe(2)
        endOne('failed')
        endTwo('stopped')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: one, count: 1 })

        const endThree = beginInFlight('chat', { target: one })
        const endFour = beginInFlight('chat', { target: two })
        endThree('failed')
        endFour('failed')
        expect(takeRunOutcome()).toEqual({ outcome: 'failed', target: null, count: 2 })
    })

    test('only a chat sets the run outcome', () => {
        beginInFlight('tts')('stopped')
        beginInFlight('image')('failed')
        expect(takeRunOutcome()).toBeNull()
    })

    test('the outcome survives a save and is reset by every other begin', () => {
        beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })('stopped')
        beginInFlight('save')()
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target: { chaId: 'a', chatId: '1' }, count: 1 })
        beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })('failed')
        beginInFlight('translate')
        expect(takeRunOutcome()).toBeNull()
    })

    test('ending a chat twice records only the first end', () => {
        const end = beginInFlight('chat', { target: { chaId: 'a', chatId: '1' } })
        end('stopped')
        end('reply')
        expect(takeRunOutcome()).toEqual({ outcome: 'stopped', target: { chaId: 'a', chatId: '1' }, count: 1 })
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
