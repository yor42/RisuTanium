import { describe, expect, test, vi } from 'vitest'
import { createMountHolders } from './chatMountHolders'

function openRun(holders: ReturnType<typeof createMountHolders<number>>, keys: number[]) {
    const destroy = vi.fn()
    const run = holders.begin()
    for (const key of keys) run.add(key)
    run.attach(destroy)
    run.finish()
    return destroy
}

describe('createMountHolders', () => {
    test('the holder is destroyed once, after its last member is released', () => {
        const holders = createMountHolders<number>()
        const destroy = openRun(holders, [1, 2, 3])

        holders.release(2)
        holders.release(1)
        expect(destroy).not.toHaveBeenCalled()

        holders.release(3)
        expect(destroy).toHaveBeenCalledTimes(1)
    })

    test('releasing a key twice, or an unknown key, is a no-op', () => {
        const holders = createMountHolders<number>()
        const destroy = openRun(holders, [1, 2])

        holders.release(1)
        holders.release(1)
        holders.release(42)
        expect(destroy).not.toHaveBeenCalled()

        holders.release(2)
        holders.release(2)
        expect(destroy).toHaveBeenCalledTimes(1)
    })

    test('runs are independent: releasing one run does not destroy another', () => {
        const holders = createMountHolders<number>()
        const first = openRun(holders, [1, 2])
        const second = openRun(holders, [3])

        holders.release(3)
        expect(second).toHaveBeenCalledTimes(1)
        expect(first).not.toHaveBeenCalled()
    })

    test('a key re-added by a later run moves to that run', () => {
        const holders = createMountHolders<number>()
        const first = openRun(holders, [1, 2])
        const second = openRun(holders, [1])

        expect(first).not.toHaveBeenCalled()
        holders.release(2)
        expect(first).toHaveBeenCalledTimes(1)
        expect(second).not.toHaveBeenCalled()
    })

    test('a run that mounted nothing is destroyed when it finishes', () => {
        const holders = createMountHolders<number>()
        const destroy = vi.fn()
        const run = holders.begin()
        run.attach(destroy)
        run.finish()
        expect(destroy).toHaveBeenCalledTimes(1)
    })

    test('members recorded before a failed run attach nothing to destroy are still released safely', () => {
        const holders = createMountHolders<number>()
        const run = holders.begin()
        run.add(1)
        run.finish()
        expect(() => holders.release(1)).not.toThrow()
    })

    test('destroyAll destroys every remaining holder once and is idempotent', () => {
        const holders = createMountHolders<number>()
        const first = openRun(holders, [1])
        const second = openRun(holders, [2, 3])
        holders.release(1)

        holders.destroyAll()
        holders.destroyAll()
        holders.release(2)

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
    })
})
