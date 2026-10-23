/**
 * TaskRateLimiter construction limits. The limiter gates task starts by both a
 * per-minute window and a concurrency cap, each checked independently, so a
 * concurrency cap above the per-minute count is a legal (if redundant) setting
 * that the HypaV3 settings page lets a user enter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskRateLimiter } from './taskRateLimiter'

describe('TaskRateLimiter options', () => {
    it('guard: defaults and equal limits construct', () => {
        expect(() => new TaskRateLimiter()).not.toThrow()
        expect(() => new TaskRateLimiter({ tasksPerMinute: 5, maxConcurrentTasks: 5 })).not.toThrow()
    })

    it('guard: tasks run to completion under equal limits', async () => {
        const limiter = new TaskRateLimiter({ tasksPerMinute: 5, maxConcurrentTasks: 5 })
        const batch = await limiter.executeBatch([async () => 1, async () => 2, async () => 3])
        expect(batch.allSucceeded).toBe(true)
        expect(batch.results.map((result) => result.data)).toEqual([1, 2, 3])
    })

    // regression reproducer: CHORE-10 V3-1, MC-712 2
    it('a concurrency cap above the per-minute count constructs without throwing', () => {
        expect(() => new TaskRateLimiter({ tasksPerMinute: 5, maxConcurrentTasks: 10 })).not.toThrow()
    })

    // regression reproducer: CHORE-10 V3-1, MC-712 2
    it('tasks run to completion when the concurrency cap is above the per-minute count', async () => {
        const limiter = new TaskRateLimiter({ tasksPerMinute: 5, maxConcurrentTasks: 10 })
        const batch = await limiter.executeBatch([async () => 1, async () => 2, async () => 3])
        expect(batch.allSucceeded).toBe(true)
    })
})

describe('TaskRateLimiter per-minute window with a higher concurrency cap', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    // regression reproducer: CHORE-10 V3-1, MC-712 2 (throws at construction before the fix)
    it('the per-minute count still gates task starts', async () => {
        vi.useFakeTimers()
        vi.spyOn(console, 'debug').mockImplementation(() => {})
        const limiter = new TaskRateLimiter({ tasksPerMinute: 1, maxConcurrentTasks: 10 })
        const started: number[] = []
        const make = (n: number) => async () => { started.push(n); return n }
        const pending = [limiter.executeTask(make(1)), limiter.executeTask(make(2))]
        await vi.advanceTimersByTimeAsync(30 * 1000)
        expect(started).toEqual([1])
        await vi.advanceTimersByTimeAsync(31 * 1000)
        expect(started).toEqual([1, 2])
        expect((await Promise.all(pending)).every((result) => result.success)).toBe(true)
    })
})
