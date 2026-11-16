// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createGuardB, GUARD_B_MS, type GuardEntry } from 'src/ts/storage/store2/fastForward/guard'
import { realApply } from 'src/ts/storage/store2/fastForward/apply'
import type { Step } from 'src/ts/storage/store2/fastForward/prepare'
import { D1_STATUS_AFTER_MS, settledWhen } from 'src/ts/storage/store2/fastForward/defer'

/** Guard B's signature rules, check A's journal and the deferral timer, over plain values. */

const unit = (identity: string, digest: string): GuardEntry => ({ kind: 'unit', identity, digest })
const field = (path: string, before: number, expected: number): GuardEntry => ({ kind: 'field', path, before, expected })
const none = (): number | undefined => undefined

describe('guard B', () => {
    test('G8 a unit entry hits only when the plan writes that identity with the pre-take digest', () => {
        const guard = createGuardB(() => 0)
        guard.arm([unit('statics', 'old')])
        expect(guard.check(new Map([['statics', 'new']]), none)).toBeNull()
        expect(guard.check(new Map([['other', 'old']]), none)).toBeNull()
        expect(guard.check(new Map([['statics', 'old']]), none)?.entries).toEqual([unit('statics', 'old')])
    })

    test('G8b a field entry hits when the live value is the pre-take one and not the taken one', () => {
        const guard = createGuardB(() => 0)
        guard.arm([field('temperature', 1, 2)])
        expect(guard.check(new Map(), () => 2)).toBeNull()
        expect(guard.check(new Map(), () => 3)).toBeNull()
        expect(guard.check(new Map(), () => 1)?.entries).toEqual([field('temperature', 1, 2)])
    })

    test('G8c an entry expires after GUARD_B_MS unless a park pins it, and a later arm for the same path replaces it', () => {
        let at = 0
        const guard = createGuardB(() => at)
        guard.arm([field('a', 1, 2), field('b', 1, 2)])
        guard.pin([field('b', 1, 2)])
        at = GUARD_B_MS + 1
        expect(guard.check(new Map(), () => 1)?.entries).toEqual([field('b', 1, 2)])
        guard.arm([field('b', 5, 6)])
        expect(guard.check(new Map(), () => 1)).toBeNull()
        expect(guard.size()).toBe(1)
    })

    test('G8d disarm removes pinned entries', () => {
        const guard = createGuardB(() => 0)
        guard.arm([field('a', 1, 2)])
        guard.pin([field('a', 1, 2)])
        guard.disarm([field('a', 1, 2)])
        expect(guard.size()).toBe(0)
        expect(guard.check(new Map(), () => 1)).toBeNull()
    })
})

describe('check A (apply)', () => {
    function stepOver(state: { value: number }, write: number, verified: boolean): Step {
        return {
            apply() {
                const before = state.value
                state.value = write
                return () => { state.value = before }
            },
            verify: () => verified,
        }
    }

    test('G9 a failed check restores every write in reverse and reports it', () => {
        const state = { value: 1 }
        expect(realApply([stepOver(state, 2, true), stepOver(state, 3, false)])).toBe('check-failed')
        expect(state.value).toBe(1)
    })

    test('G9b a step that throws restores the earlier ones and rethrows', () => {
        const state = { value: 1 }
        const bad: Step = { apply() { throw new Error('write failed') }, verify: () => true }
        expect(() => realApply([stepOver(state, 2, true), bad])).toThrow('write failed')
        expect(state.value).toBe(1)
    })

    test('G9c verified steps stay applied and run their after hook once', () => {
        const state = { value: 1 }
        let afters = 0
        const step: Step = { ...stepOver(state, 2, true), after: () => { afters += 1 } }
        expect(realApply([step])).toBe('applied')
        expect(state.value).toBe(2)
        expect(afters).toBe(1)
    })
})

describe('deferral timer', () => {
    test('R9c settles when the condition holds, and tells the status once after the slow threshold', async () => {
        let at = 0
        let ready = false
        let slow = 0
        const settled = settledWhen(() => ready, { now: () => at, slowAfterMs: D1_STATUS_AFTER_MS, onSlow: () => { slow += 1 } })
        let done = false
        void settled.then(() => { done = true })
        at = D1_STATUS_AFTER_MS + 1
        await new Promise<void>(resolve => setTimeout(resolve, 2300))
        expect(done).toBe(false)
        expect(slow).toBe(1)
        ready = true
        await settled
        expect(done).toBe(true)
        expect(slow).toBe(1)
    }, 10_000)
})
