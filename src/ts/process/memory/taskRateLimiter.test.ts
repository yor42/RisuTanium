/**
 * TaskRateLimiter construction limits. The limiter gates task starts by both a
 * per-minute window and a concurrency cap, each checked independently, so a
 * concurrency cap above the per-minute count is a legal (if redundant) setting
 * that the HypaV3 settings page lets a user enter.
 */
import { describe, expect, it } from 'vitest'
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
    it.fails('a concurrency cap above the per-minute count constructs without throwing', () => {
        expect(() => new TaskRateLimiter({ tasksPerMinute: 5, maxConcurrentTasks: 10 })).not.toThrow()
    })

    // regression reproducer: CHORE-10 V3-1, MC-712 2
    it.fails('tasks run to completion when the concurrency cap is above the per-minute count', async () => {
        const limiter = new TaskRateLimiter({ tasksPerMinute: 5, maxConcurrentTasks: 10 })
        const batch = await limiter.executeBatch([async () => 1, async () => 2, async () => 3])
        expect(batch.allSucceeded).toBe(true)
    })
})
