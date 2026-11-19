import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { CharacterVerdict } from '../characterSaved'
import {
    configurePageState, consumeReply, heldReply, holdInflight, noteBodySource, noteBound, noteInvoked, notePageEnded, noteReplyPushed,
    noteTerminal, noteUnowned, ownsPushedReply, requestReconcile, resetPageStateForTests, setReconcileTrigger, settleNativeReplyInflight,
} from '../pageState'

/**
 * T10 (guard): the live push consumes only after a commit that covers the push's mark; an earlier snapshot's commit
 * does not, and the push itself requests no save. T11 (guard): the settle table. Mutants M15 (consume at the push), M16
 * (settle leaves the key inflight), M35 (settle consumes a done record never parsed), M37 (target read before the mark),
 * M41 (an unbound key invokes), M45 (settle consumes with no terminal knowledge).
 */

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'

function rig() {
    resetPageStateForTests()
    const callbacks = new Set<() => void>()
    const state = { committed: 0, marks: 0, verdict: 'saved' as CharacterVerdict, requests: 0 }
    const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
    const unreadable = vi.fn()
    configurePageState({
        store: { consume },
        waiter: {
            committedMarkCount: () => state.committed,
            markCount: () => state.marks,
            verdict: () => state.verdict,
            afterNextCommit: (callback) => { callbacks.add(callback) },
            markCharacter: () => { state.marks += 1 },
            requestSaveNow: () => { state.requests += 1; state.marks += 1 },
        },
        onUnreadable: unreadable,
    })
    const commit = async (covers: number) => {
        state.committed = Math.max(state.committed, covers)
        for (const callback of [...callbacks]) {
            callbacks.delete(callback)
            callback()
        }
        await Promise.resolve()
    }
    return { state, consume, unreadable, commit }
}

function granted(bound = true, invoked = true) {
    holdInflight(KEY)
    if (bound) { noteBound(KEY) }
    if (invoked) { noteInvoked(KEY) }
}

beforeEach(() => { resetPageStateForTests() })

describe('live push', () => {
    test('a commit whose snapshot precedes the push does not consume; the next covering commit does; no save is requested', async () => {
        const r = rig()
        granted()
        r.state.marks = 4
        // The page marks the character, then reads the count that the commit must cover.
        r.state.marks += 1
        noteReplyPushed(KEY, 'cha', r.state.marks)
        expect(heldReply(KEY)?.state).toBe('awaiting-save')
        await r.commit(4)
        expect(r.consume).not.toHaveBeenCalled()
        await r.commit(5)
        expect(r.consume).toHaveBeenCalledWith(KEY)
        expect(heldReply(KEY)).toBeUndefined()
        expect(r.state.requests).toBe(0)
    })

    test.each([
        ['an unbound key', () => granted(false, false)],
        ['a bound key never invoked', () => granted(true, false)],
        ['an invoked key never bound', () => granted(false, true)],
        ['an unowned key', () => { granted(); noteUnowned(KEY) }],
    ])('%s pushed is not watched and never consumed', async (_name, arrange) => {
        const r = rig()
        arrange()
        expect(ownsPushedReply(KEY)).toBe(false)
        noteReplyPushed(KEY, 'cha', 1)
        expect(heldReply(KEY)?.state).toBe('inflight')
        await r.commit(1)
        expect(r.consume).not.toHaveBeenCalled()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('a bound, invoked and owned key owns its pushed reply', () => {
        rig()
        granted()
        expect(ownsPushedReply(KEY)).toBe(true)
    })

    test('a key with no grant gets no waiter', async () => {
        const r = rig()
        noteReplyPushed(KEY, 'cha', 1)
        await r.commit(1)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })
})

describe('settleNativeReplyInflight', () => {
    test.each([
        ['an unbound key', () => granted(false, false)],
        ['a key never invoked', () => granted(true, false)],
        ['an unowned key', () => { granted(); noteUnowned(KEY) }],
        // The page's own end would consume a bound key, so this row fails if the bound check is dropped.
        ['a key invoked but never bound', () => { granted(false, true); notePageEnded(KEY) }],
    ])('%s is dropped without a consume', async (_name, arrange) => {
        const r = rig()
        arrange()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
    })

    test.each([
        ['a record body', () => noteBodySource(KEY, 'record')],
        ['a failed stamp', () => noteTerminal(KEY, { outcome: 'failed', stored: false })],
        ['a stopped stamp', () => noteTerminal(KEY, { outcome: 'stopped', stored: false })],
        ['a done body that was not stored', () => noteTerminal(KEY, { outcome: 'done', stored: false })],
        ['the page ending', () => notePageEnded(KEY)],
    ])('%s is consumed', async (_name, learn) => {
        const r = rig()
        granted()
        learn()
        await settleNativeReplyInflight(KEY)
        expect(r.consume).toHaveBeenCalledWith(KEY)
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('a page-ended key whose record Rust still writes keeps release for the next reconcile, without a note', async () => {
        const r = rig()
        granted()
        notePageEnded(KEY)
        r.consume.mockRejectedValueOnce(new Error('live: reply is still being received'))
        await settleNativeReplyInflight(KEY)
        expect(heldReply(KEY)?.state).toBe('release')
        expect(r.unreadable).not.toHaveBeenCalled()
    })

    test('a stored done record that was never parsed is dropped, and a reconcile is asked for', async () => {
        const r = rig()
        const trigger = vi.fn()
        setReconcileTrigger(trigger)
        granted()
        noteTerminal(KEY, { outcome: 'done', stored: true })
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)).toBeUndefined()
        expect(trigger).toHaveBeenCalledTimes(1)
    })

    test('a key already pushed is left to the waiter', async () => {
        const r = rig()
        granted()
        noteReplyPushed(KEY, 'cha', 1)
        notePageEnded(KEY)
        await settleNativeReplyInflight(KEY)
        expect(r.consume).not.toHaveBeenCalled()
        expect(heldReply(KEY)?.state).toBe('awaiting-save')
    })
})

describe('consumeReply', () => {
    test('an unreadable answer is reported and the entry dropped; another failure keeps the entry for a retry', async () => {
        const r = rig()
        granted()
        r.consume.mockRejectedValueOnce(new Error('unreadable: end.json is not JSON'))
        expect(await consumeReply(KEY)).toBe('unreadable')
        expect(r.unreadable).toHaveBeenCalledWith(KEY, 'end.json is not JSON')
        granted()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        r.consume.mockRejectedValueOnce(new Error('disk'))
        expect(await consumeReply(KEY)).toBe('error')
        expect(heldReply(KEY)?.state).toBe('release')
    })

    test('requestReconcile does nothing before the reconcile is installed', () => {
        expect(() => requestReconcile()).not.toThrow()
    })
})
