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
import { connectHostBridge, gestureInsetLeft, hasOpenedFilesHost, hostChannelPresent, hostIme, hostRequest, hostPost, hostTouchExploration, keepAliveHost, openedFilesTake, replyNotificationsHost, subscribeAppUpdateProgress, systemBarsHost } from './hostBridge'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
    delete window.__risuTaniumHost
    delete window.__risuTaniumSystemBars
    delete window.__risuTaniumKeepAlive
    delete window.__risuTaniumReplyNotificationsHost
    delete window.__risuTaniumGestureInset
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumIme
    delete window.__risuTaniumAccessibility
    // Lets go of the last channel so the next case starts unbound.
    connectHostBridge()
    vi.restoreAllMocks()
})

describe('binding the channel', () => {
    // T23: the touch-exploration subscribe goes out once per channel object.
    test('the host is asked for the gesture inset, the keyboard state and touch exploration once per channel object, however often the adapter is used', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        connectHostBridge()
        systemBarsHost()
        gestureInsetLeft()
        hostIme()
        expect(fake.posted()).toEqual([
            { bridge: 'gestureInset', method: 'subscribe', args: [] },
            { bridge: 'ime', method: 'subscribe', args: [] },
            { bridge: 'accessibility', method: 'subscribe', args: [] },
        ])
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
        // Contract v2: the notice travels as a JSON string, because the host's command parser rejects nested values.
        ['startState', ['{"v":2,"state":"generating"}']],
        ['updateState', ['{"v":2,"state":"speaking"}']],
        ['stopAfterWithOutcome', [10000, '{"v":2,"state":"stopped"}']],
        // The page asks for the chat a notification tap named; the answer comes back through a window hook.
        ['requestOpenTarget', []],
    ] as const)('%s goes out as one message', (method, args) => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const host = keepAliveHost() as Record<string, (...values: unknown[]) => unknown>
        host[method](...args)
        expect(fake.postedTo('keepAlive', method)).toEqual([{ bridge: 'keepAlive', method, args }])
    })

    test('the v2 methods are present on the channel host, so the page uses contract v2', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const host = keepAliveHost()
        expect(typeof host?.startState).toBe('function')
        expect(typeof host?.updateState).toBe('function')
        expect(typeof host?.stopAfterWithOutcome).toBe('function')
        expect(typeof host?.requestOpenTarget).toBe('function')
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

// New-API tests: they name the reply-notification bridge this stage adds.
describe('the reply notifications over the channel', () => {
    test.each([
        ['refresh', []],
        ['enable', []],
        ['disable', []],
        ['notify', ['cha/chat', 'Title', 'Body', true]],
        ['notify', ['cha/chat', 'Title', 'Body', false]],
        ['notifyState', ['{"v":2,"key":"cha/chat","silent":true}']],
        ['armNative', [1234567, '{"v":1,"done":{},"failed":{},"closing":{}}']],
        ['cancel', ['cha/chat']],
    ] as const)('%s goes out as one message', (method, args) => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const host = replyNotificationsHost() as Record<string, (...values: unknown[]) => unknown>
        host[method](...args)
        expect(fake.postedTo('replyNotifications', method)).toEqual([{ bridge: 'replyNotifications', method, args }])
    })

    test('P2: openNotificationSettings is on the channel proxy and goes out as one message with no arguments', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const host = replyNotificationsHost()
        expect(typeof host?.openNotificationSettings).toBe('function')
        host?.openNotificationSettings?.()
        expect(fake.postedTo('replyNotifications', 'openNotificationSettings')).toEqual([
            { bridge: 'replyNotifications', method: 'openNotificationSettings', args: [] },
        ])
    })

    test('the channel wins over the separate host object', () => {
        const fake = createHostChannelFake()
        const legacy = { notify: vi.fn(), cancel: vi.fn() }
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumReplyNotificationsHost = legacy
        replyNotificationsHost()?.notify?.('k', 'T', 'B', true)
        replyNotificationsHost()?.cancel?.('k')
        expect(legacy.notify).not.toHaveBeenCalled()
        expect(legacy.cancel).not.toHaveBeenCalled()
        expect(fake.postedTo('replyNotifications', 'notify')).toHaveLength(1)
    })

    test('guard: without the channel the separate object is handed back unchanged, and nothing where there is no host', () => {
        expect(replyNotificationsHost()).toBeUndefined()
        const legacy = { notify: vi.fn() }
        window.__risuTaniumReplyNotificationsHost = legacy
        expect(replyNotificationsHost()).toBe(legacy)
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

describe('touch exploration (TalkBack)', () => {
    // T23/T25 channel half: unknown until the first push, booleans only, cleared on release; hostTouchExploration binds by itself.
    test('over the channel it is null until pushed, follows booleans and ignores anything else', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        expect(hostTouchExploration()).toBeNull()
        expect(fake.postedTo('accessibility', 'subscribe')).toHaveLength(1)
        fake.deliver('{"event":"touchExploration","enabled":true}')
        expect(hostTouchExploration()).toBe(true)
        fake.deliver('{"event":"touchExploration","enabled":"false"}')
        fake.deliver('{"event":"touchExploration","enabled":0}')
        fake.deliver('{"event":"touchExploration"}')
        expect(hostTouchExploration()).toBe(true)
        fake.deliver('{"event":"touchExploration","enabled":false}')
        expect(hostTouchExploration()).toBe(false)
    })

    test('hostTouchExploration alone binds the channel, as the other host getters do', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        hostTouchExploration()
        expect(fake.listeners()).toBe(1)
    })

    test('a replaced or released channel clears the value', () => {
        const first = createHostChannelFake()
        window.__risuTaniumHost = first.channel
        connectHostBridge()
        first.deliver('{"event":"touchExploration","enabled":true}')
        const second = createHostChannelFake()
        window.__risuTaniumHost = second.channel
        expect(hostTouchExploration()).toBeNull()
        second.deliver('{"event":"touchExploration","enabled":true}')
        delete window.__risuTaniumHost
        expect(hostTouchExploration()).toBeNull()
    })

    // T25: the separate object, read on each call and narrowed to a boolean.
    test('without a channel the separate object answers, narrowed to a boolean', () => {
        expect(hostTouchExploration()).toBeNull()
        let answer: unknown = true
        window.__risuTaniumAccessibility = { touchExploration: () => answer }
        expect(hostTouchExploration()).toBe(true)
        answer = false
        expect(hostTouchExploration()).toBe(false)
        answer = 'true'
        expect(hostTouchExploration()).toBeNull()
        window.__risuTaniumAccessibility = { touchExploration: () => { throw new Error('bridge failed') } }
        expect(hostTouchExploration()).toBeNull()
    })

    test('guard: with a channel the separate object is not consulted', () => {
        const touchExploration = vi.fn(() => true)
        window.__risuTaniumHost = createHostChannelFake().channel
        window.__risuTaniumAccessibility = { touchExploration }
        expect(hostTouchExploration()).toBeNull()
        expect(touchExploration).not.toHaveBeenCalled()
    })
})

describe('the keyboard state over the channel', () => {
    test('it is unknown until the host pushes, then the latest valid state reaches the reader and every subscriber', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const ime = hostIme()!
        const seen: Array<{ visible: boolean; height: number }> = []
        ime.subscribe((state) => seen.push(state))
        expect(ime.read()).toBeNull()
        fake.deliver('{"event":"ime","visible":true,"height":288}')
        expect(ime.read()).toEqual({ visible: true, height: 288 })
        fake.deliver('{"event":"ime","visible":false,"height":0}')
        expect(ime.read()).toEqual({ visible: false, height: 0 })
        expect(seen).toEqual([{ visible: true, height: 288 }, { visible: false, height: 0 }])
    })

    test('a malformed event changes nothing and notifies nobody', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const ime = hostIme()!
        const listener = vi.fn()
        ime.subscribe(listener)
        fake.deliver('{"event":"ime","visible":true,"height":288}')
        listener.mockClear()
        fake.deliver('{"event":"ime","visible":"yes","height":10}')
        fake.deliver('{"event":"ime","visible":true,"height":"10"}')
        fake.deliver('{"event":"ime","visible":true}')
        fake.deliver('{"event":"ime","visible":true,"height":-3}')
        fake.deliver('{"event":"ime","height":10}')
        expect(listener).not.toHaveBeenCalled()
        expect(ime.read()).toEqual({ visible: true, height: 288 })
    })

    test('an unsubscribed listener hears nothing further', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const ime = hostIme()!
        const listener = vi.fn()
        const stop = ime.subscribe(listener)
        stop()
        fake.deliver('{"event":"ime","visible":true,"height":288}')
        expect(listener).not.toHaveBeenCalled()
    })

    test('a replaced or released channel clears the state, so the caller falls back', () => {
        const first = createHostChannelFake()
        window.__risuTaniumHost = first.channel
        connectHostBridge()
        first.deliver('{"event":"ime","visible":true,"height":288}')
        expect(hostIme()!.read()).toEqual({ visible: true, height: 288 })

        const second = createHostChannelFake()
        window.__risuTaniumHost = second.channel
        expect(hostIme()!.read()).toBeNull()
        expect(second.postedTo('ime', 'subscribe')).toHaveLength(1)

        const held = hostIme()!
        second.deliver('{"event":"ime","visible":true,"height":100}')
        expect(held.read()).toEqual({ visible: true, height: 100 })
        delete window.__risuTaniumHost
        connectHostBridge()
        expect(held.read()).toBeNull()
        expect(hostIme()).toBeNull()
        window.__risuTaniumHost = second.channel
        expect(hostIme()!.read()).toBeNull()
    })

    test('a subscribe that throws is swallowed and the state stays unknown', () => {
        const fake = createHostChannelFake()
        fake.channel.postMessage.mockImplementation(() => { throw new Error('host failed') })
        window.__risuTaniumHost = fake.channel
        expect(hostIme()!.read()).toBeNull()
    })

    test('the channel wins over the separate host object, which is never read', () => {
        const fake = createHostChannelFake()
        const visible = vi.fn(() => true)
        window.__risuTaniumHost = fake.channel
        window.__risuTaniumIme = { visible, height: () => 50 }
        expect(hostIme()!.read()).toBeNull()
        expect(visible).not.toHaveBeenCalled()
    })
})

describe('the keyboard state without the channel', () => {
    test('guard: nothing is handed back where there is no host, or the object lacks its methods', () => {
        expect(hostIme()).toBeNull()
        window.__risuTaniumIme = { visible: () => true }
        expect(hostIme()).toBeNull()
    })

    test('the separate object is asked as methods, and a bad answer reads as unknown', () => {
        const bridge = {
            visible: vi.fn(function (this: unknown) { return this === bridge }),
            height: vi.fn(function (this: unknown) { return this === bridge ? 288 : -1 }),
        }
        window.__risuTaniumIme = bridge
        expect(hostIme()!.read()).toEqual({ visible: true, height: 288 })
        window.__risuTaniumIme = { visible: () => 'yes', height: () => 10 }
        expect(hostIme()!.read()).toBeNull()
        window.__risuTaniumIme = { visible: () => { throw new Error('bridge gone') }, height: () => 10 }
        expect(hostIme()!.read()).toBeNull()
    })

    test('a visual viewport resize re-reads the object and notifies, until unsubscribed', () => {
        let height = 0
        window.__risuTaniumIme = { visible: () => height > 0, height: () => height }
        const target = new EventTarget()
        Object.defineProperty(window, 'visualViewport', { value: target, configurable: true })
        try {
            const listener = vi.fn()
            const stop = hostIme()!.subscribe(listener)
            height = 288
            target.dispatchEvent(new Event('resize'))
            expect(listener).toHaveBeenCalledWith({ visible: true, height: 288 })
            stop()
            height = 0
            target.dispatchEvent(new Event('resize'))
            expect(listener).toHaveBeenCalledTimes(1)
        } finally {
            Reflect.deleteProperty(window, 'visualViewport')
        }
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

describe('the first request id of a fresh page load', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.resetModules()
    })

    const firstTakeIdWithRandom = async (random: number): Promise<number> => {
        vi.resetModules()
        vi.stubGlobal('crypto', { getRandomValues: (values: Uint32Array) => { values[0] = random; return values } })
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const fresh = await import('./hostBridge')
        void fresh.openedFilesTake()
        const id = fake.postedTo('openedFiles', 'take')[0].id as number
        delete window.__risuTaniumHost
        fresh.connectHostBridge()
        return id
    }

    test('two page loads with different random draws post different first ids, so a reply to an earlier document never matches', async () => {
        const first = await firstTakeIdWithRandom(5)
        const second = await firstTakeIdWithRandom(900)
        expect(first).toBe(1 + 5)
        expect(second).toBe(1 + 900)
    })

    test('the random part is limited to 30 bits so the counter has room to count', async () => {
        expect(await firstTakeIdWithRandom(0xffffffff)).toBe(1 + 0x3fffffff)
    })
})

describe('requests to the host that name their method in the reply', () => {
    const requestId = (fake: ReturnType<typeof createHostChannelFake>, n: number) => fake.postedTo('keyVault', 'wrap')[n].id as number
    const reply = (id: number, extra: Record<string, unknown> = {}) => JSON.stringify({ id, method: 'keyVault.wrap', vault: 'ok', value: 'v', ...extra })

    test('a take and a request that are pending together both settle when their replies arrive out of order', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const take = openedFilesTake()!
        const request = hostRequest('keyVault', 'wrap', ['SYNTH-KEY-1234'])!
        expect(requestId(fake, 0)).not.toBe(fake.postedTo('openedFiles', 'take')[0].id)
        fake.deliver(reply(requestId(fake, 0)))
        fake.deliver(JSON.stringify({ id: fake.postedTo('openedFiles', 'take')[0].id, result: [], through: 0 }))
        expect(await request.reply).toMatchObject({ vault: 'ok', value: 'v' })
        expect((await take).held).toBe(true)
        expect(fake.postedTo('keyVault', 'wrap')[0].args).toEqual(['SYNTH-KEY-1234'])
    })

    test('a reply that names another method is ignored and the request stays pending', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const request = hostRequest('keyVault', 'wrap', ['k'])!
        let settled = false
        void request.reply.then(() => { settled = true })
        fake.deliver(reply(requestId(fake, 0), { method: 'keyVault.unwrap' }))
        fake.deliver(JSON.stringify({ id: requestId(fake, 0), vault: 'ok', value: 'no method' }))
        await settle()
        expect(settled).toBe(false)
        fake.deliver(reply(requestId(fake, 0)))
        expect(await request.reply).toMatchObject({ value: 'v' })
    })

    test('a reply carrying a method and a take\'s id leaves the take pending', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        let settled = false
        void openedFilesTake()!.then(() => { settled = true })
        const takeId = fake.postedTo('openedFiles', 'take')[0].id as number
        fake.deliver(JSON.stringify({ id: takeId, method: 'keyVault.wrap', vault: 'ok', value: 'v', result: [], through: 3 }))
        await settle()
        expect(settled).toBe(false)
    })

    test('cancel forgets the request, so its late reply settles nothing', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const request = hostRequest('keyVault', 'wrap', ['k'])!
        let settled = false
        void request.reply.then(() => { settled = true })
        request.cancel()
        fake.deliver(reply(requestId(fake, 0)))
        await settle()
        expect(settled).toBe(false)
    })

    test('without a channel there is no request, and the channel is reported absent; releasing settles a pending request with null', async () => {
        expect(hostChannelPresent()).toBe(false)
        expect(hostRequest('keyVault', 'wrap', ['k'])).toBeUndefined()
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        expect(hostChannelPresent()).toBe(true)
        const request = hostRequest('keyVault', 'wrap', ['k'])!
        delete window.__risuTaniumHost
        connectHostBridge()
        expect(await request.reply).toBeNull()
    })

    test('a request whose message cannot be sent rejects and leaves nothing waiting', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        fake.channel.postMessage.mockImplementationOnce(() => { throw new Error('host failed') })
        await expect(hostRequest('keyVault', 'wrap', ['k'])!.reply).rejects.toThrow('host failed')
    })
})

describe('update download progress over the channel', () => {
    test('a listener gets a progress event whose fields are integers with 0 <= received <= total', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        const listener = vi.fn()
        subscribeAppUpdateProgress(listener)
        fake.deliver('{"event":"appUpdateProgress","received":5,"total":10}')
        fake.deliver('{"event":"appUpdateProgress","received":0,"total":0}')
        expect(listener.mock.calls.map((call) => call[0])).toEqual([{ received: 5, total: 10 }, { received: 0, total: 0 }])
    })

    test.each([
        ['received above total', '{"event":"appUpdateProgress","received":11,"total":10}'],
        ['a negative received', '{"event":"appUpdateProgress","received":-1,"total":10}'],
        ['a fractional received', '{"event":"appUpdateProgress","received":1.5,"total":10}'],
        ['a string received', '{"event":"appUpdateProgress","received":"5","total":10}'],
        ['a missing total', '{"event":"appUpdateProgress","received":5}'],
        ['a null total', '{"event":"appUpdateProgress","received":5,"total":null}'],
    ])('%s is not delivered', (_name, json) => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        const listener = vi.fn()
        subscribeAppUpdateProgress(listener)
        fake.deliver(json)
        expect(listener).not.toHaveBeenCalled()
    })

    test('unsubscribing stops the delivery', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        const listener = vi.fn()
        const stop = subscribeAppUpdateProgress(listener)
        fake.deliver('{"event":"appUpdateProgress","received":1,"total":2}')
        stop()
        fake.deliver('{"event":"appUpdateProgress","received":2,"total":2}')
        expect(listener).toHaveBeenCalledTimes(1)
    })

    test('an appUpdate.install reply never settles an appUpdate.check request with the same id', async () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        const request = hostRequest('appUpdate', 'check', [])
        const id = fake.postedTo('appUpdate', 'check')[0].id
        let settled = false
        void request?.reply.then(() => { settled = true })
        fake.deliver(JSON.stringify({ id, method: 'appUpdate.install', update: 'ok' }))
        await settle()
        expect(settled).toBe(false)
        fake.deliver(JSON.stringify({ id, method: 'appUpdate.check', update: 'disabled' }))
        await settle()
        expect(settled).toBe(true)
    })
})

describe('posting to the host without waiting for a reply', () => {
    test('hostPost sends bridge, method and args with no id key, and reports true', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        expect(hostPost('appUpdate', 'cancel', [])).toBe(true)
        const message = fake.postedTo('appUpdate', 'cancel')[0]
        expect(message).toEqual({ bridge: 'appUpdate', method: 'cancel', args: [] })
        expect('id' in message).toBe(false)
    })

    test('hostPost returns false when there is no channel', () => {
        expect(hostPost('appUpdate', 'cancel', [])).toBe(false)
    })

    test('hostPost returns false when the send throws', () => {
        const fake = createHostChannelFake()
        window.__risuTaniumHost = fake.channel
        connectHostBridge()
        fake.channel.postMessage.mockImplementation(() => { throw new Error('closed') })
        expect(hostPost('appUpdate', 'cancel', [])).toBe(false)
    })
})