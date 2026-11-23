/**
 * The write FIFO and the message yield of the plugin write, on their own: the order writes land in, what a failing write
 * releases, and the one hand-on yield a landing posts only when another turn is queued behind it.
 * Labels: guard, new surface (the module did not exist before the change).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { pluginWriteLanding, pluginWriteYield, resetPluginWriteTurnsForTest, setPluginWriteYieldForTest, withWriteTurn, writesQueued } from '../pluginWriteTurns'

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function turns(count = 10): Promise<void> {
    for (let i = 0; i < count; i++) {
        await turn()
    }
}

function gate() {
    let open = () => {}
    const promise = new Promise<void>((resolve) => { open = resolve })
    return { promise, open }
}

// A turn still in flight is let to finish before the reset, so the queue count is never driven below zero.
afterEach(async () => {
    await turns(10)
    const turnsModule = await import('../pluginWriteTurns')
    turnsModule.resetPluginWriteTurnsForTest()
    turnsModule.setPluginWriteYieldForTest(null)
    vi.unstubAllGlobals()
})

describe('the plugin write yield', () => {
    test('P1: it is a message task, not the scheduler, and it waits behind a message posted before it', async () => {
        const schedulerYield = vi.fn(async () => {})
        vi.stubGlobal('scheduler', { yield: schedulerYield })
        const order: string[] = []
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
            order.push('message')
            channel.port1.close()
        }
        channel.port2.postMessage(0)

        await pluginWriteYield()
        order.push('yield done')

        expect(order).toEqual(['message', 'yield done'])
        expect(schedulerYield).not.toHaveBeenCalled()
    })
})

describe('the write FIFO', () => {
    test('P2: turns land in the order they were taken, a failing body releases the next, and the queue reports itself until the last hand-on', async () => {
        setPluginWriteYieldForTest({ yieldFn: async () => { await turn() }, skip: () => false })
        const order: string[] = []
        const gates = [gate(), gate(), gate()]
        const runs = gates.map((held, i) => withWriteTurn(`p${i}`, async () => {
            order.push(`start ${i}`)
            await held.promise
            order.push(`end ${i}`)
        }))
        await turns(3)
        expect(order).toEqual(['start 0'])
        expect(writesQueued()).toBe(true)

        for (const held of gates) {
            held.open()
            await turns(3)
        }
        await Promise.all(runs)
        expect(order).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2', 'end 2'])

        const failing = withWriteTurn('failing', async () => { throw new Error('boom') })
        const after = withWriteTurn('failing', async () => 'next')
        await expect(failing).rejects.toThrow('boom')
        await expect(after).resolves.toBe('next')
        await turns(5)
        expect(pluginWriteLanding('failing')).toBeNull()
        expect(writesQueued()).toBe(false)
    })
})

describe('the landing of a plugin', () => {
    test('P2b: the landing of an earlier write does not close the landing of a later write of the same plugin', async () => {
        setPluginWriteYieldForTest({ yieldFn: async () => { await turn() }, skip: () => false })
        const firstHeld = gate()
        const secondHeld = gate()
        const first = withWriteTurn('same', async () => { await firstHeld.promise })
        const second = withWriteTurn('same', async () => { await secondHeld.promise })
        await turns(2)
        firstHeld.open()
        await first
        await turns(2)

        expect(pluginWriteLanding('same')).not.toBeNull()
        secondHeld.open()
        await second
        expect(pluginWriteLanding('same')).toBeNull()
    })
})

describe('the hand-on yield', () => {
    function recordYields(skip: () => boolean = () => false) {
        const record = { count: 0 }
        setPluginWriteYieldForTest({ yieldFn: async () => { record.count += 1 }, skip })
        return record
    }

    test('P3: one yield follows a landing that has a turn queued behind it, none follows the last landing, and none on a hidden page', async () => {
        const record = recordYields()
        const held = gate()
        const first = withWriteTurn('a', async () => { await held.promise })
        const second = withWriteTurn('b', async () => {})
        await turns(2)
        held.open()
        await Promise.all([first, second])
        await turns(5)
        expect(record.count).toBe(1)

        record.count = 0
        await withWriteTurn('c', async () => {})
        await turns(5)
        expect(record.count).toBe(0)

        const hidden = recordYields(() => true)
        const heldHidden = gate()
        const one = withWriteTurn('d', async () => { await heldHidden.promise })
        const two = withWriteTurn('e', async () => {})
        await turns(2)
        heldHidden.open()
        await Promise.all([one, two])
        await turns(5)
        expect(hidden.count).toBe(0)
    })
})