import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    configurePageState, heldReply, holdInflight, noteBound, noteInvoked, noteUnowned, notePageEnded, noteReplyPushed, resetPageStateForTests,
    takeAnnounced,
} from '../pageState'
import { bindOwnedStream, createStreamProbe, endOwnedRead, forgetOwnedStream, resetOwnedStreamsForTests, retireFailedHead, settleOwnedStreamEnd } from '../ownedStream'
import { issueNativeReplyGrant } from '../grant'
import type { PumpProbe, ReplyStamp } from '../ownedBody'

const marks = vi.hoisted(() => ({ count: 0, charIds: [] as unknown[] }))

vi.mock(import('../../storage/characterSaveMarks'), async (importOriginal) => ({
    ...(await importOriginal()),
    markCharacterForSave: vi.fn((chaId: unknown) => {
        marks.count += 1
        marks.charIds.push(chaId)
    }),
}))

/**
 * P9, P10-AK, P10-R, P10-B (new rules): the per-reply facts of an owned stream. Every fact is keyed by the reply's key, so
 * ending, abandoning or forgetting one reply never touches another; a refused owner is never abandoned; the unit's settle
 * backstop ends only a key whose end the page never noted. Real pageState with a fake store and waiter.
 */

const K1 = '0b9c1a7e-0000-4000-8000-000000000001'
const K2 = '0b9c1a7e-0000-4000-8000-000000000002'

beforeEach(() => {
    marks.count = 0
    marks.charIds.length = 0
    resetPageStateForTests()
    resetOwnedStreamsForTests()
    configurePageState({
        store: { consume: vi.fn(async () => ({ result: 'removed' as const, flushed: true })) },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
})

/** A reply whose stream request is invoked and registered the way the call site and `fetchNative` do it. */
function register(key: string, owned: boolean | null = true) {
    holdInflight(key)
    noteBound(key)
    noteInvoked(key)
    const probe = createStreamProbe(key)
    const abandon = vi.fn()
    probe.owned = owned
    probe.abandon = abandon
    return { probe, abandon }
}

const failedStamp = (key: string, extra: Partial<ReplyStamp> = {}): ReplyStamp => ({ key, outcome: 'failed', stored: false, ...extra })

describe('P9: the stream probe feeds the reply facts', () => {
    test('an announced failed stamp sets the terminal knowledge and the announced fact; the head status fills a missing one', () => {
        const { probe } = register(K1)
        probe.head = { status: 429, headers: {} }
        probe.onStamp!(failedStamp(K1, { announced: true }))
        expect(heldReply(K1)?.terminal).toEqual({ outcome: 'failed', stored: false, status: 429 })
        expect(takeAnnounced([K1])).toBe(true)
    })

    test('an unannounced stamp sets the terminal knowledge and no announced fact', () => {
        const { probe } = register(K1)
        probe.onStamp!(failedStamp(K1))
        expect(heldReply(K1)?.terminal).toMatchObject({ outcome: 'failed' })
        expect(takeAnnounced([K1])).toBe(false)
    })

    test('a stamp of another key changes nothing, for either key', () => {
        const first = register(K1)
        register(K2)
        first.probe.onStamp!(failedStamp(K2, { announced: true }))
        expect(heldReply(K1)?.terminal).toBeUndefined()
        expect(heldReply(K2)?.terminal).toBeUndefined()
        expect(takeAnnounced([K1, K2])).toBe(false)
    })
})

describe('P10-AK: ending one reply never touches another', () => {
    test('endOwnedRead abandons only its own probe and leaves the other held entry as it was', () => {
        const one = register(K1)
        const two = register(K2)
        const before = structuredClone(heldReply(K2))

        endOwnedRead(K1)

        expect(one.abandon).toHaveBeenCalledTimes(1)
        expect(two.abandon).not.toHaveBeenCalled()
        expect(heldReply(K1)?.pageEnded).toBe(true)
        expect(heldReply(K2)).toEqual(before)
    })

    test('forgetOwnedStream leaves the other probe registered', () => {
        const one = register(K1)
        const two = register(K2)
        forgetOwnedStream(K1)
        endOwnedRead(K2)
        expect(two.abandon).toHaveBeenCalledTimes(1)
        expect(one.abandon).toHaveBeenCalledTimes(1)
        // K1's probe is gone: a later end of K1 only notes it.
        endOwnedRead(K1)
        expect(one.abandon).toHaveBeenCalledTimes(1)
    })

})

describe('P10-R: a refused owner is never abandoned', () => {
    test('owned false: pageEnded is noted and abandon is never called', () => {
        const refused = register(K1, false)
        endOwnedRead(K1)
        expect(heldReply(K1)?.pageEnded).toBe(true)
        expect(refused.abandon).not.toHaveBeenCalled()
    })

    test('owned null (not yet answered): abandon is called once', () => {
        const pending = register(K1, null)
        endOwnedRead(K1)
        expect(pending.abandon).toHaveBeenCalledTimes(1)
    })

    test('a key with no registered probe is only noted', () => {
        holdInflight(K1)
        endOwnedRead(K1)
        expect(heldReply(K1)?.pageEnded).toBe(true)
    })
})

describe('P10-B: the settle backstop', () => {
    test('an inflight key whose end was never noted is ended, and the entry is removed', () => {
        const one = register(K1)
        forgetOwnedStream(K1)
        expect(one.abandon).toHaveBeenCalledTimes(1)
        expect(heldReply(K1)?.pageEnded).toBe(true)
        forgetOwnedStream(K1)
        expect(one.abandon).toHaveBeenCalledTimes(1)
    })

    test('an awaiting-save key is not abandoned and the entry is removed', () => {
        const one = register(K1)
        noteReplyPushed(K1, 'cha', 1)
        expect(heldReply(K1)?.state).toBe('awaiting-save')
        forgetOwnedStream(K1)
        expect(one.abandon).not.toHaveBeenCalled()
        expect(heldReply(K1)?.pageEnded).toBeUndefined()
        endOwnedRead(K1)
        expect(one.abandon).not.toHaveBeenCalled()
    })

    test('an inflight key whose end the page already noted is not abandoned again, and the entry is removed', () => {
        const one = register(K1)
        notePageEnded(K1)
        forgetOwnedStream(K1)
        expect(one.abandon).not.toHaveBeenCalled()
        endOwnedRead(K1)
        expect(one.abandon).not.toHaveBeenCalled()
    })

    test('a key that was never registered does nothing and does not throw', () => {
        expect(() => forgetOwnedStream(K2)).not.toThrow()
        expect(heldReply(K2)).toBeUndefined()
    })
})

describe('settleOwnedStreamEnd: the stream branch ended', () => {
    test('a reply in memory on an owned key is marked first and awaited at the count read after the mark', () => {
        const one = register(K1)
        settleOwnedStreamEnd(K1, { chaId: 'cha', saveMarkCount: () => marks.count })
        expect(marks.charIds).toEqual(['cha'])
        expect(heldReply(K1)).toMatchObject({ state: 'awaiting-save', chaId: 'cha', target: 1 })
        expect(one.abandon).not.toHaveBeenCalled()
    })

    test('no reply in memory: the page end is noted and the native request abandoned once', () => {
        const one = register(K1)
        const two = register(K2)
        const before = structuredClone(heldReply(K2))
        settleOwnedStreamEnd(K1, null)
        expect(heldReply(K1)?.pageEnded).toBe(true)
        expect(heldReply(K1)?.state).toBe('inflight')
        expect(one.abandon).toHaveBeenCalledTimes(1)
        expect(marks.count).toBe(0)
        expect(two.abandon).not.toHaveBeenCalled()
        expect(heldReply(K2)).toEqual(before)
    })

    test('a reply in memory on a key that owns no record marks nothing and only ends the read', () => {
        const refused = register(K1, false)
        noteUnowned(K1)
        settleOwnedStreamEnd(K1, { chaId: 'cha', saveMarkCount: () => marks.count })
        expect(marks.count).toBe(0)
        expect(heldReply(K1)).toMatchObject({ state: 'inflight', pageEnded: true })
        expect(refused.abandon).not.toHaveBeenCalled()
    })
})

describe('U1: the shared call-site helpers of an owned stream request', () => {
    const base = { target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha', generationInfo: {}, promptInfo: {}, escape: false, requestedMs: 1 }
    const parse = { kind: 'openai-responses-stream', extractJson: null, jsonSchema: false } as const
    const request = (extra: Record<string, unknown> = {}) => ({ nativeReplyGrant: issueNativeReplyGrant(K1, base), chatId: K1, usageInputEstimate: 7, replyUsageModelKey: 'm', ...extra })

    test('bindOwnedStream registers the probe under the reply key, so ending the read abandons the native request', () => {
        const bound = bindOwnedStream(request(), parse)
        expect(bound?.owner.key).toBe(K1)
        const abandon = vi.fn()
        bound!.probe.owned = true
        bound!.probe.abandon = abandon
        endOwnedRead(K1)
        expect(abandon).toHaveBeenCalledTimes(1)
    })

    test('the abort listener ends only its own reply read', () => {
        const other = register(K2)
        const controller = new AbortController()
        const bound = bindOwnedStream(request({ abortSignal: controller.signal }), parse)
        const abandon = vi.fn()
        bound!.probe.owned = true
        bound!.probe.abandon = abandon
        controller.abort()
        expect(heldReply(K1)?.pageEnded).toBe(true)
        expect(abandon).toHaveBeenCalledTimes(1)
        expect(other.abandon).not.toHaveBeenCalled()
        expect(heldReply(K2)?.pageEnded).toBeUndefined()
    })

    test('a request of another reply, a missing estimate and no grant bind nothing', () => {
        expect(bindOwnedStream(request({ chatId: K2 }), parse)).toBeNull()
        expect(bindOwnedStream(request({ usageInputEstimate: undefined }), parse)).toBeNull()
        expect(bindOwnedStream({ chatId: K1, usageInputEstimate: 7 }, parse)).toBeNull()
    })

    test('retireFailedHead is false for an unannounced stamp, true for an announced failure and false for an announced done', async () => {
        const unannounced = register(K1)
        unannounced.probe.stamp = failedStamp(K1, { status: 429 })
        expect(await retireFailedHead(K1, unannounced.probe, 429)).toBe(false)

        const announced = register(K2)
        announced.probe.stamp = failedStamp(K2, { announced: true, status: 429 })
        expect(await retireFailedHead(K2, announced.probe, 429)).toBe(true)

        resetPageStateForTests()
        resetOwnedStreamsForTests()
        const done = register(K1)
        done.probe.stamp = { key: K1, outcome: 'done', stored: true, announced: true, status: 200 }
        expect(await retireFailedHead(K1, done.probe, 200)).toBe(false)
    })

    test('retireFailedHead reads the stamp after the record is removed, so a stamp learned during the removal counts', async () => {
        const holder: { probe: PumpProbe | null } = { probe: null }
        configurePageState({
            store: {
                consume: vi.fn(async () => {
                    holder.probe!.stamp = failedStamp(K1, { announced: true, status: 429 })
                    return { result: 'removed' as const, flushed: true }
                }),
            },
            waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
            onUnreadable: () => {},
        })
        const { probe } = register(K1)
        holder.probe = probe
        probe.stamp = failedStamp(K1, { status: 429 })
        expect(await retireFailedHead(K1, probe, 429)).toBe(true)
    })
})