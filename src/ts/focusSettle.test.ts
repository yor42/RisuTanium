// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFocusSettle } from './focusSettle'

const turn = () => new Promise<void>((resolve) => { queueMicrotask(resolve) })

afterEach(() => {
    vi.restoreAllMocks()
})

describe('createFocusSettle: one deferred run per burst', () => {
    test('(U1) schedules in one task make one run, and none runs synchronously', async () => {
        const run = vi.fn()
        const settle = createFocusSettle(run)

        settle.schedule()
        settle.schedule()
        settle.schedule()
        expect(run).not.toHaveBeenCalled()

        await turn()
        expect(run).toHaveBeenCalledTimes(1)

        settle.schedule()
        await turn()
        expect(run).toHaveBeenCalledTimes(2)
    })

    test('(U2) a dispose before the microtask drops the run, and a schedule after dispose never runs', async () => {
        const run = vi.fn()
        const settle = createFocusSettle(run)

        settle.schedule()
        settle.dispose()
        await turn()
        expect(run).not.toHaveBeenCalled()

        settle.schedule()
        await turn()
        expect(run).not.toHaveBeenCalled()

        settle.dispose()
        expect(run).not.toHaveBeenCalled()
    })

    test('(U3) a run that throws does not wedge later schedules, and a schedule inside a run gets a fresh turn', async () => {
        // The throwing microtask is reported to the process as an uncaught exception; the test observes it instead.
        const reported: unknown[] = []
        const onUncaught = (error: unknown) => { reported.push(error) }
        const listeners = process.listeners('uncaughtException')
        process.removeAllListeners('uncaughtException')
        process.on('uncaughtException', onUncaught)
        try {
            let calls = 0
            const settle = createFocusSettle(() => {
                calls++
                if (calls === 1) throw new Error('first run fails')
                if (calls === 2) settle.schedule()
            })

            settle.schedule()
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            expect(calls).toBe(1)
            expect(reported).toHaveLength(1)

            settle.schedule()
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            expect(calls).toBe(3)
        } finally {
            process.removeListener('uncaughtException', onUncaught)
            for (const listener of listeners) process.on('uncaughtException', listener)
        }
    })
})
