import { describe, expect, test } from 'vitest'
import type { ExportUnit } from 'src/ts/storage/store2/rtb/exportClosure'
import { createUnitBridge, RtbExportAbortedError } from 'src/ts/drive/rtb/unitBridge'

function unit(tail: string): ExportUnit {
    return { key: `store2/${tail}`, tail, type: 1 as ExportUnit['type'], bytes: new TextEncoder().encode(tail) }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createUnitBridge (T-S8-12, guard)', () => {
    test('the producer starts at the first next() and not before', async () => {
        let started = 0
        const bridge = createUnitBridge(() => {
            started++
        })
        const iterator = bridge.iterable[Symbol.asyncIterator]()
        await tick()
        expect(started).toBe(0)
        expect(bridge.started).toBe(false)
        const pending = iterator.next()
        await tick()
        expect(started).toBe(1)
        bridge.end()
        expect((await pending).done).toBe(true)
    })

    test('units arrive in order as {tail, frame}, and a push stays pending until the consumer takes its batch', async () => {
        let first: Promise<void> | null = null
        let firstResolved = false
        const bridge = createUnitBridge(() => {
            void (async () => {
                first = bridge.push([unit('a'), unit('b')])
                void first.then(() => { firstResolved = true })
                await first
                await bridge.push([unit('c')])
                bridge.end()
            })()
        })
        const iterator = bridge.iterable[Symbol.asyncIterator]()
        const pull = iterator.next()
        await tick()
        // The producer has pushed; the consumer's first next() takes the batch and so releases the push.
        expect((await pull).value?.tail).toBe('a')
        await tick()
        expect(firstResolved).toBe(true)
        const seen = ['a']
        for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
            seen.push(next.value.tail)
        }
        expect(seen).toEqual(['a', 'b', 'c'])
        expect(first).not.toBeNull()
    })

    test('a push does not resolve before the consumer pulls', async () => {
        let resolved = false
        const bridge = createUnitBridge(() => { })
        void bridge.push([unit('a')]).then(() => { resolved = true })
        await tick()
        expect(resolved).toBe(false)
        const iterator = bridge.iterable[Symbol.asyncIterator]()
        await iterator.next()
        await tick()
        expect(resolved).toBe(true)
        await iterator.return?.(undefined)
    })

    test('a second batch cannot be pushed while the first has not been taken', async () => {
        const bridge = createUnitBridge(() => { })
        const first = bridge.push([unit('a')])
        await expect(bridge.push([unit('b')])).rejects.toThrow(/before the previous one was taken/)
        bridge.abort()
        await expect(first).rejects.toBeInstanceOf(RtbExportAbortedError)
    })

    test('abort() rejects the pending push and every later one', async () => {
        const bridge = createUnitBridge(() => { })
        const pending = bridge.push([unit('a')])
        bridge.abort()
        await expect(pending).rejects.toBeInstanceOf(RtbExportAbortedError)
        await expect(bridge.push([unit('b')])).rejects.toBeInstanceOf(RtbExportAbortedError)
    })

    test('a consumer that stops early (return) rejects the pending and later pushes, also while holding a batch', async () => {
        let second: Promise<void> | null = null
        const bridge = createUnitBridge(() => {
            void (async () => {
                await bridge.push([unit('a'), unit('b')])
                second = bridge.push([unit('c')])
                second.catch(() => { })
            })()
        })
        const iterator = bridge.iterable[Symbol.asyncIterator]()
        expect((await iterator.next()).value?.tail).toBe('a')
        await tick()
        await iterator.return?.(undefined)
        await expect(second).rejects.toBeInstanceOf(RtbExportAbortedError)
        await expect(bridge.push([unit('d')])).rejects.toBeInstanceOf(RtbExportAbortedError)
    })

    test('a consumer that throws inside its loop ends the bridge the same way', async () => {
        let second: Promise<void> | null = null
        const bridge = createUnitBridge(() => {
            void (async () => {
                await bridge.push([unit('a')])
                second = bridge.push([unit('b')])
                second.catch(() => { })
            })()
        })
        await expect((async () => {
            for await (const entry of bridge.iterable) {
                await tick()
                throw new Error(`consumer failed at ${entry.tail}`)
            }
        })()).rejects.toThrow('consumer failed at a')
        await expect(second).rejects.toBeInstanceOf(RtbExportAbortedError)
    })

    test('a producer failure reaches the consumer, pending or not', async () => {
        const bridge = createUnitBridge(() => {
            void tick().then(() => bridge.fail(new Error('walk failed')))
        })
        await expect((async () => {
            for await (const entry of bridge.iterable) {
                void entry
            }
        })()).rejects.toThrow('walk failed')
    })
})
