// @vitest-environment happy-dom

/**
 * The page side of the Android host channel against a fake channel shaped like the injected object, and against the separate
 * host objects it falls back to. A passing test says nothing about the native listener or a real WebView.
 *
 * Tests starting `guard:` pass with or without the channel code (compatibility); every other test names a rule a mutation of
 * `hostBridge.ts` must break.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createHostChannelFake } from './hostChannelFake'
import { connectHostBridge, gestureInsetLeft, hasOpenedFilesHost, keepAliveHost, openedFilesTake, systemBarsHost } from './hostBridge'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
    delete window.__risuTaniumHost
    delete window.__risuTaniumSystemBars
    delete window.__risuTaniumKeepAlive
    delete window.__risuTaniumGestureInset
    delete window.__risuTaniumOpenedFilesHost
    // Lets go of the last channel so the next case starts unbound.
    connectHostBridge()
    vi.restoreAllMocks()
})

describe('binding the channel', () => {
    test('the host is asked for the gesture inset once per channel object, however often the adapter is used', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        connectHostBridge()
        systemBarsHost()
        gestureInsetLeft()
        expect(fake.posted()).toEqual([{ bridge: 'gestureInset', method: 'subscribe', args: [] }])
        expect(fake.listeners()).toBe(1)
    })

    test('a different channel object is bound anew: the old listener is detached, the new one subscribed, the inset back to 0', () => {
        const first = createHostChannelFake()
        window.__risuTaniumHost = first.channel
        connectHostBridge()
        first.deliver('{"event":"gestureInset","value":40}')
        expect(gestureInsetLeft()).toBe(40)

        const second = createHostChannelFake()
        window.__risuTaniumHost = second.channel
        expect(gestureInsetLeft()).toBe(0)
        expect(second.postedTo('gestureInset', 'subscribe')).toHaveLength(1)
        expect(first.listeners()).toBe(0)
        expect(second.listeners()).toBe(1)
    })

    test('a channel without addEventListener is listened to through onmessage', () => {
        const channel = { postMessage: vi.fn(), onmessage: null as ((event: { data: unknown }) => void) | null }
        window.__risuTaniumHost = channel
        expect(gestureInsetLeft()).toBe(0)
        expect(typeof channel.onmessage).toBe('function')
        channel.onmessage?.({ data: '{"event":"gestureInset","value":12}' })
        expect(gestureInsetLeft()).toBe(12)
    })

    test('a channel whose postMessage is not a function is treated as absent', () => {
        const legacy = { setBackground: vi.fn() }
        window.__risuTaniumSystemBars = legacy
        window.__risuTaniumHost = { postMessage: 5 } as unknown as Window['__risuTaniumHost']
        expect(systemBarsHost()).toBe(legacy)
        expect(hasOpenedFilesHost()).toBe(false)
    })

    test('a subscribe that throws is swallowed and the inset stays 0', () => {
        const fake = createHostChannelFake()
        fake.channel.postMessage.mockImplementation(() => { throw new Error('host failed') })
        window.__risuTaniumHost = fake.channel
        expect(() => connectHostBridge()).not.toThrow()
        expect(gestureInsetLeft()).toBe(0)
    })
})

describe('the system bars over the channel', () => {
    test('a colour goes out as one message', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        systemBarsHost()?.setBackground?.(1, 2, 3)
        expect(fake.postedTo('systemBars', 'setBackground')).toEqual([{ bridge: 'systemBars', method: 'setBackground', args: [1, 2, 3] }])
    })

    test('the channel wins over the separate host object', () => {
        const fake = createHostChannelFake()
        const setBackground = vi.fn()
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumSystemBars = { setBackground }
        systemBarsHost()?.setBackground?.(1, 2, 3)
        expect(fake.postedTo('systemBars', 'setBackground')).toHaveLength(1)
        expect(setBackground).not.toHaveBeenCalled()
    })
})

describe('the keep-alive service over the channel', () => {
    test.each([
        ['start', ['Title', 'Stop']],
        ['update', ['Title', 'Stop']],
        ['stop', []],
        ['stopAfter', [10000]],
        ['requestNotificationPermissionOnce', []],
    ] as const)('%s goes out as one message', (method, args) => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const host = keepAliveHost() as Record<string, (...values: unknown[]) => unknown>
        host[method](...args)
        expect(fake.postedTo('keepAlive', method)).toEqual([{ bridge: 'keepAlive', method, args }])
    })

    test('the channel wins over the separate host object', () => {
        const fake = createHostChannelFake()
        const legacy = { start: vi.fn(), stop: vi.fn() }
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumKeepAlive = legacy
        keepAliveHost()?.start?.('Title', 'Stop')
        keepAliveHost()?.stop?.()
        expect(legacy.start).not.toHaveBeenCalled()
        expect(legacy.stop).not.toHaveBeenCalled()
    })
})

describe('the gesture inset over the channel', () => {
    test('it is 0 until the host pushes, then the latest finite number', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        expect(gestureInsetLeft()).toBe(0)
        fake.deliver('{"event":"gestureInset","value":40}')
        expect(gestureInsetLeft()).toBe(40)
        fake.deliver('{"event":"gestureInset","value":"7"}')
        fake.deliver('{"event":"gestureInset"}')
        fake.deliver('not json')
        fake.deliver('[1]')
        fake.deliver('null')
        expect(gestureInsetLeft()).toBe(40)
        fake.deliver('{"event":"gestureInset","value":24.5}')
        expect(gestureInsetLeft()).toBe(24.5)
    })

    test('a message whose data is not a string is ignored', () => {
        const channel = { postMessage: vi.fn(), onmessage: null as ((event: { data: unknown }) => void) | null }
        window.__risuTaniumHost = channel
        gestureInsetLeft()
        channel.onmessage?.({ data: { event: 'gestureInset', value: 9 } })
        expect(gestureInsetLeft()).toBe(0)
    })

    test('the channel wins over the separate host object, which is never read', () => {
        const fake = createHostChannelFake()
        const left = vi.fn(() => 99)
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumGestureInset = { left }
        expect(gestureInsetLeft()).toBe(0)
        expect(left).not.toHaveBeenCalled()
    })
})

describe('taking the opened-files queue over the channel', () => {
    const idOf = (fake: ReturnType<typeof createHostChannelFake>, n: number) => fake.postedTo('openedFiles', 'take')[n].id as number

    test('a take carries an id and resolves with the reply re-serialised; confirm sends the reply\'s through', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        expect(hasOpenedFilesHost()).toBe(true)
        const pending = openedFilesTake()
        expect(pending).toBeDefined()
        fake.deliver(JSON.stringify({ id: idOf(fake, 0), result: [[{ uri: 'content://x/1', name: 'a.charx' }]], through: 7 }))
        const taken = await pending!
        expect(taken.held).toBe(true)
        expect(JSON.parse(taken.raw as string)).toEqual([[{ uri: 'content://x/1', name: 'a.charx' }]])
        expect(fake.postedTo('openedFiles', 'confirm')).toEqual([])
        taken.confirm()
        expect(fake.postedTo('openedFiles', 'confirm')).toEqual([{ bridge: 'openedFiles', method: 'confirm', args: [7] }])
    })

    test('replies that arrive out of order each resolve their own take', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const first = openedFilesTake()!
        const second = openedFilesTake()!
        expect(idOf(fake, 0)).not.toBe(idOf(fake, 1))
        fake.deliver(JSON.stringify({ id: idOf(fake, 1), result: [[{ uri: 'content://x/2', name: 'second' }]], through: 2 }))
        fake.deliver(JSON.stringify({ id: idOf(fake, 0), result: [[{ uri: 'content://x/1', name: 'first' }]], through: 1 }))
        expect(JSON.parse((await first).raw as string)[0][0].name).toBe('first')
        expect(JSON.parse((await second).raw as string)[0][0].name).toBe('second')
    })

    test('a reply for an unknown id, or one that is not a take reply, resolves nothing', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        let settled = false
        void openedFilesTake()!.then(() => { settled = true })
        fake.deliver(JSON.stringify({ id: idOf(fake, 0) + 100, result: [], through: 1 }))
        fake.deliver(JSON.stringify({ result: [], through: 1 }))
        await settle()
        expect(settled).toBe(false)
    })

    test('an empty reply (through 0) confirms nothing; a result that is not an array reads as empty', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const empty = openedFilesTake()!
        fake.deliver(JSON.stringify({ id: idOf(fake, 0), result: [], through: 0 }))
        const taken = await empty
        taken.confirm()
        expect(fake.postedTo('openedFiles', 'confirm')).toEqual([])

        const odd = openedFilesTake()!
        fake.deliver(JSON.stringify({ id: idOf(fake, 1), result: 'x', through: 3 }))
        expect((await odd).raw).toBe('[]')
    })

    test('a take pending on a channel that is replaced resolves empty and held nothing', async () => {
        const first = createHostChannelFake()
        window.__risuTaniumHost = first.channel
        const pending = openedFilesTake()!
        const second = createHostChannelFake()
        window.__risuTaniumHost = second.channel
        connectHostBridge()
        const taken = await pending
        expect(taken).toMatchObject({ raw: '[]', held: false })
        taken.confirm()
        expect(first.postedTo('openedFiles', 'confirm')).toEqual([])
        expect(second.postedTo('openedFiles', 'confirm')).toEqual([])
    })

    test('a take whose message cannot be sent rejects and leaves nothing waiting', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        fake.channel.postMessage.mockImplementationOnce(() => { throw new Error('host failed') })
        await expect(openedFilesTake()).rejects.toThrow('host failed')
    })

    test('a confirm that cannot be sent is logged, not thrown', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const pending = openedFilesTake()!
        fake.deliver(JSON.stringify({ id: idOf(fake, 0), result: [], through: 5 }))
        const taken = await pending
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        fake.channel.postMessage.mockImplementationOnce(() => { throw new Error('host failed') })
        expect(() => taken.confirm()).not.toThrow()
        expect(warn).toHaveBeenCalled()
    })

    test('the channel wins over the separate host object, which is never taken from', () => {
        const fake = createHostChannelFake()
        const take = vi.fn(() => '[]')
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumOpenedFilesHost = { take }
        void openedFilesTake()
        expect(take).not.toHaveBeenCalled()
        expect(fake.postedTo('openedFiles', 'take')).toHaveLength(1)
    })
})

describe('without the channel the separate host objects are used as they are', () => {
    test('guard: the system-bars and keep-alive objects are handed back unchanged', () => {
        const bars = { setBackground: vi.fn() }
        const keepAlive = { start: vi.fn() }
        window.__risuTaniumSystemBars = bars
        window.__risuTaniumKeepAlive = keepAlive
        expect(systemBarsHost()).toBe(bars)
        expect(keepAliveHost()).toBe(keepAlive)
    })

    test('guard: nothing is handed back where there is no host at all', () => {
        expect(systemBarsHost()).toBeUndefined()
        expect(keepAliveHost()).toBeUndefined()
        expect(gestureInsetLeft()).toBe(0)
        expect(hasOpenedFilesHost()).toBe(false)
        expect(openedFilesTake()).toBeUndefined()
    })

    test('guard: the gesture inset is asked of the object as a method, and a non-function reads as 0', () => {
        const bridge = { left: vi.fn(function (this: unknown) { return this === bridge ? 31 : -1 }) }
        window.__risuTaniumGestureInset = bridge
        expect(gestureInsetLeft()).toBe(31)
        window.__risuTaniumGestureInset = { left: 24 } as unknown as Window['__risuTaniumGestureInset']
        expect(gestureInsetLeft()).toBe(0)
    })

    test('guard: a take runs synchronously inside the call, holds nothing and confirms nothing', async () => {
        const host = { take: vi.fn(function (this: unknown) { return this === host ? '[[]]' : 'wrong receiver' }) }
        window.__risuTaniumOpenedFilesHost = host
        expect(hasOpenedFilesHost()).toBe(true)
        const pending = openedFilesTake()
        expect(host.take).toHaveBeenCalledTimes(1)
        const taken = await pending!
        expect(taken).toMatchObject({ raw: '[[]]', held: false })
        expect(() => taken.confirm()).not.toThrow()
    })

    test('guard: a take that throws throws inside the call', () => {
        window.__risuTaniumOpenedFilesHost = { take: () => { throw new Error('bridge gone') } }
        expect(() => openedFilesTake()).toThrow('bridge gone')
    })

    test('guard: a channel that goes away hands the callers back to the separate objects', () => {
        const fake = createHostChannelFake()
        const bars = { setBackground: vi.fn() }
        window.__risuTaniumSystemBars = bars
        window.__risuTaniumHost = fake.channel
        expect(systemBarsHost()).not.toBe(bars)
        delete window.__risuTaniumHost
        expect(systemBarsHost()).toBe(bars)
    })
})
