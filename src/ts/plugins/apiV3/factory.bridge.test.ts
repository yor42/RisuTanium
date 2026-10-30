// @vitest-environment jsdom

/**
 * The plugin sandbox bridge in `factory.ts`, both ends:
 *
 *  - host (`SandboxHost`): driven with synthetic `message` events whose `source`
 *    is the iframe window, because jsdom does not execute `srcdoc` scripts;
 *  - guest (`GUEST_BRIDGE_SCRIPT`): the script text is read back from the
 *    iframe `srcdoc` and evaluated against a fake window, so the real guest code
 *    runs with a controllable `FinalizationRegistry` and microtask queue.
 *
 * Labels: R = regression reproducer (fails on the pre-fix bridge), G =
 * compatibility guard (passes before and after).
 */
import v8 from 'node:v8'
import vm from 'node:vm'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const busy = vi.hoisted(() => ({ begun: 0, ended: 0 }))

vi.mock('src/ts/process/memory/busyActions', () => ({
    beginChokePoint: vi.fn(() => {
        busy.begun += 1
        let done = false
        return () => {
            if (done) return
            done = true
            busy.ended += 1
        }
    }),
}))

import { SandboxHost } from './factory'

//#region host driver

type Msg = Record<string, unknown>

type HostRig = {
    host: SandboxHost
    iframe: HTMLIFrameElement
    posted: Msg[]
    /** Delivers one guest message to the host handler and lets it settle. */
    send: (data: Msg) => Promise<void>
    /** Sends a request and returns the RESPONSE with the same reqId. */
    request: (data: Msg) => Promise<Msg>
}

let reqCounter = 0
const rigs: HostRig[] = []

function makeHostRig(api: Record<string, unknown>): HostRig {
    const host = new SandboxHost(api)
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.run(container, '')
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const win = iframe.contentWindow as Window
    const posted: Msg[] = []
    vi.spyOn(win, 'postMessage').mockImplementation(((message: Msg) => {
        posted.push(message)
    }) as unknown as typeof win.postMessage)

    const send = async (data: Msg) => {
        const event = new MessageEvent('message', { data })
        Object.defineProperty(event, 'source', { value: win })
        window.dispatchEvent(event)
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const request = async (data: Msg) => {
        const reqId = `req_${++reqCounter}`
        await send({ ...data, reqId })
        const response = posted.find((m) => m.type === 'RESPONSE' && m.reqId === reqId)
        if (!response) throw new Error('no RESPONSE posted for ' + reqId)
        return response
    }
    const rig = { host, iframe, posted, send, request }
    rigs.push(rig)
    return rig
}

type Remote = { __classType: 'REMOTE_REQUIRED', tag: string, ping(): string }

const makeRemote = (tag: string): Remote => ({
    __classType: 'REMOTE_REQUIRED',
    tag,
    ping() { return 'pong-' + tag },
})

const refIdOf = (response: Msg) => (response.result as { id: string }).id

// jsdom has no iframe `sandbox` token list; `run` only adds tokens to it.
if (!('sandbox' in HTMLIFrameElement.prototype)) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
        configurable: true,
        get() { return { add() {} } },
    })
}

beforeEach(() => {
    busy.begun = 0
    busy.ended = 0
    vi.stubGlobal('ImageBitmap', class {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    for (const rig of rigs.splice(0)) rig.host.terminate()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

//#endregion

describe('host bridge', () => {
    test('R3: remote references get distinct ids even when Math.random is constant', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5)
        let n = 0
        const rig = makeHostRig({ make: () => makeRemote('r' + (++n)) })

        const a = await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] })
        const b = await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] })

        expect(refIdOf(a)).not.toBe(refIdOf(b))
        const pa = await rig.request({ type: 'CALL_INSTANCE', id: refIdOf(a), method: 'ping', args: [] })
        const pb = await rig.request({ type: 'CALL_INSTANCE', id: refIdOf(b), method: 'ping', args: [] })
        expect(pa.result).toBe('pong-r1')
        expect(pb.result).toBe('pong-r2')
    })

    test('R4: a batched RELEASE_INSTANCE with ids releases every listed instance; a single id still releases', async () => {
        let n = 0
        const rig = makeHostRig({ make: () => makeRemote('r' + (++n)) })
        const a = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        const b = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        const c = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        const d = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))

        await rig.send({ type: 'RELEASE_INSTANCE', ids: [a, b] })
        await rig.send({ type: 'RELEASE_INSTANCE', id: c })

        for (const gone of [a, b, c]) {
            const r = await rig.request({ type: 'CALL_INSTANCE', id: gone, method: 'ping', args: [] })
            expect(r.error).toBe('Instance not found or released')
        }
        const alive = await rig.request({ type: 'CALL_INSTANCE', id: d, method: 'ping', args: [] })
        expect(alive.result).toBe('pong-r4')
    })

    test('R5: an unknown REMOTE_REF argument answers an error, never reaches the function, and balances the chokepoint', async () => {
        const target = vi.fn(() => 'ran')
        const rig = makeHostRig({ target })

        const response = await rig.request({
            type: 'CALL_ROOT',
            method: 'target',
            args: [{ __type: 'REMOTE_REF', id: 'ref_unknown' }],
        })

        expect(response.error).toBe('Instance not found or released')
        expect(target).not.toHaveBeenCalled()
        expect(busy.begun).toBeGreaterThan(0)
        expect(busy.ended).toBe(busy.begun)
    })

    test('R5 companion: a known REMOTE_REF argument still resolves to the instance', async () => {
        const received: unknown[] = []
        const remote = makeRemote('known')
        const rig = makeHostRig({
            make: () => remote,
            take: (arg: unknown) => { received.push(arg); return 'ok' },
        })
        const id = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))

        const response = await rig.request({ type: 'CALL_ROOT', method: 'take', args: [{ __type: 'REMOTE_REF', id }] })

        expect(response.result).toBe('ok')
        expect(received[0]).toBe(remote)
        expect(busy.ended).toBe(busy.begun)
    })

    test('RELEASE_INSTANCE does not touch the chokepoint', async () => {
        const rig = makeHostRig({})
        await rig.send({ type: 'RELEASE_INSTANCE', ids: ['ref_x'] })
        expect(busy.begun).toBe(0)
    })

    test('R6 (host half) / G-a: a callback wrapper posts plain-data arguments unchanged and remote objects as REMOTE_REF', async () => {
        let remoteArg: Remote | undefined
        const rig = makeHostRig({
            register: async (cb: (...args: unknown[]) => Promise<unknown>) => {
                remoteArg = makeRemote('cbarg')
                void cb('text', 5, { a: 1 }, remoteArg)
                return 'registered'
            },
        })

        await rig.request({ type: 'CALL_ROOT', method: 'register', args: [{ __type: 'CALLBACK_REF', id: 'cb_1' }] })

        const invoke = rig.posted.find((m) => m.type === 'INVOKE_CALLBACK') as { id: string, args: unknown[] }
        expect(invoke.id).toBe('cb_1')
        expect(invoke.args.slice(0, 3)).toEqual(['text', 5, { a: 1 }])
        expect(invoke.args[3]).toMatchObject({ __type: 'REMOTE_REF' })
        expect(invoke.args[3]).not.toHaveProperty('tag')
    })
})

//#region guest driver

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<void>

type Guest = {
    posted: Msg[]
    risuai: Record<string, (...args: unknown[]) => Promise<any>>
    deliver: (data: Msg) => Promise<void>
    registered: { target: unknown, held: unknown }[]
    runCleanup: (id: string) => void
    microtasks: (() => void)[]
    flushMicrotasks: () => void
}

function readGuestScript(): string {
    const host = new SandboxHost({})
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.run(container, '')
    const srcdoc = (container.querySelector('iframe') as HTMLIFrameElement).srcdoc
    host.terminate()
    const start = srcdoc.indexOf('await (async function() {')
    const endMarker = 'Object.freeze(window.postMessage);'
    const end = srcdoc.indexOf(endMarker)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    return srcdoc.slice(start, end + endMarker.length) + '\n})();'
}

/**
 * `collectable` makes the fake registry record only the held values, so the
 * test can observe garbage collection of a proxy; by default it keeps the
 * targets, which the registration assertions need.
 */
async function startGuest(options: { collectable?: boolean } = {}): Promise<Guest> {
    const script = readGuestScript()
    const handlers: ((event: Msg) => Promise<void>)[] = []
    const posted: Msg[] = []
    const registered: { target: unknown, held: unknown }[] = []
    const microtasks: (() => void)[] = []
    let cleanup: (held: unknown) => void = () => {}
    const parent = {
        postMessage: (message: Msg) => {
            posted.push(message)
            const reply = (result: unknown) => queueMicrotask(() => {
                void deliver({ type: 'RESPONSE', reqId: message.reqId, result })
            })
            if (message.type === 'CALL_ROOT' && message.method === '_getPropertiesForInitialization') reply({ list: [] })
            if (message.type === 'CALL_ROOT' && message.method === '_getAliases') reply({})
        },
    }
    const fakeWindow: Record<string, unknown> = {
        parent,
        postMessage: () => {},
        addEventListener: (type: string, handler: (event: Msg) => Promise<void>) => {
            if (type === 'message') handlers.push(handler)
        },
    }
    class FakeFinalizationRegistry {
        constructor(callback: (held: unknown) => void) { cleanup = callback }
        register(target: unknown, held: unknown) {
            registered.push({ target: options.collectable ? undefined : target, held })
        }
    }
    const deliver = async (data: Msg) => {
        for (const handler of handlers) await handler({ source: parent, data, ports: [] })
    }
    const run = new AsyncFunction('window', 'FinalizationRegistry', 'queueMicrotask', 'ImageBitmap', script)
    // The guest queues its own microtasks only for release flushes; the
    // initialization replies use the real queue.
    const realQueue = globalThis.queueMicrotask.bind(globalThis)
    let capture = false
    const fakeQueue = (fn: () => void) => {
        if (capture) microtasks.push(fn)
        else realQueue(fn)
    }
    const startup = run(fakeWindow, FakeFinalizationRegistry, fakeQueue, class {})
    await startup
    capture = true
    return {
        posted,
        risuai: (fakeWindow.risuai as Guest['risuai']),
        deliver,
        registered,
        runCleanup: (id) => cleanup(id),
        microtasks,
        flushMicrotasks: () => { for (const fn of microtasks.splice(0)) fn() },
    }
}

/** Starts a guest request and answers it with a REMOTE_REF; returns the proxy. */
async function receiveProxy(guest: Guest, refId: string) {
    const pending = guest.risuai.makeThing()
    const request = [...guest.posted].reverse().find((m) => m.type === 'CALL_ROOT' && m.method === 'makeThing')!
    await guest.deliver({ type: 'RESPONSE', reqId: request.reqId, result: { __type: 'REMOTE_REF', id: refId } })
    return await pending as Record<string, (...args: unknown[]) => Promise<unknown>> & { release: () => void }
}

//#endregion

describe('guest bridge', () => {
    test('R7: a REMOTE_REF callback argument reaches the callback as a proxy that addresses the host instance', async () => {
        const guest = await startGuest()
        const received: unknown[] = []
        void guest.risuai.watch((...args: unknown[]) => { received.push(...args) }).catch(() => {})
        const request = guest.posted.find((m) => m.type === 'CALL_ROOT' && m.method === 'watch')!
        const callbackId = ((request.args as Msg[])[0] as { id: string }).id

        await guest.deliver({ type: 'INVOKE_CALLBACK', id: callbackId, reqId: 'cbr', args: [{ __type: 'REMOTE_REF', id: 'ref_1' }] })

        expect(received).toHaveLength(1)
        expect(received[0]).not.toHaveProperty('__type')
        void (received[0] as Record<string, () => Promise<unknown>>).getTarget().catch(() => {})
        const call = guest.posted.find((m) => m.type === 'CALL_INSTANCE')!
        expect(call.id).toBe('ref_1')
        expect(call.method).toBe('getTarget')
    })

    test('G-a: plain-data callback arguments reach the guest callback unchanged', async () => {
        const guest = await startGuest()
        const received: unknown[] = []
        void guest.risuai.watch((...args: unknown[]) => { received.push(...args) }).catch(() => {})
        const request = guest.posted.find((m) => m.type === 'CALL_ROOT' && m.method === 'watch')!
        const callbackId = ((request.args as Msg[])[0] as { id: string }).id

        await guest.deliver({ type: 'INVOKE_CALLBACK', id: callbackId, reqId: 'cbr', args: ['s', 5, { a: [1, 2] }] })

        expect(received).toEqual(['s', 5, { a: [1, 2] }])
    })

    test('R8: cleanups of several proxies in one tick send one batched RELEASE_INSTANCE; the registry holds ids, not proxies', async () => {
        const guest = await startGuest()
        const p1 = await receiveProxy(guest, 'ref_1')
        const p2 = await receiveProxy(guest, 'ref_2')

        expect(guest.registered).toHaveLength(2)
        expect(guest.registered.map((r) => r.held)).toEqual(['ref_1', 'ref_2'])
        expect(guest.registered[0].target).not.toBe(guest.registered[0].held)
        void p1; void p2

        guest.runCleanup('ref_1')
        guest.runCleanup('ref_2')
        expect(guest.microtasks).toHaveLength(1)
        guest.flushMicrotasks()

        const releases = guest.posted.filter((m) => m.type === 'RELEASE_INSTANCE')
        expect(releases).toHaveLength(1)
        expect(releases[0].ids).toEqual(['ref_1', 'ref_2'])
    })

    test('R8 companions: a cleanup of an unrelated id never releases a live proxy; explicit release sends a single id', async () => {
        const guest = await startGuest()
        const p1 = await receiveProxy(guest, 'ref_1')

        guest.runCleanup('ref_other')
        guest.flushMicrotasks()
        const batch = guest.posted.filter((m) => m.type === 'RELEASE_INSTANCE')
        expect(batch).toHaveLength(1)
        expect(batch[0].ids).toEqual(['ref_other'])

        p1.release()
        const explicit = guest.posted.filter((m) => m.type === 'RELEASE_INSTANCE').pop()!
        expect(explicit.id).toBe('ref_1')
        expect(explicit.ids).toBeUndefined()
    })

    // A WeakRef target stays alive until the end of the job that created or
    // read it, so each round yields to a macrotask before collecting.
    const collect = async (ref: WeakRef<object>) => {
        for (let round = 0; round < 20 && ref.deref() !== undefined; round++) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            gc()
        }
    }
    const proxyWeakRef = async (guest: Guest, refId: string) => new WeakRef(await receiveProxy(guest, refId))
    const proxyWithMethod = async (guest: Guest, refId: string) => {
        const proxy = await receiveProxy(guest, refId)
        return { ref: new WeakRef(proxy), method: proxy.someMethod }
    }

    test('G-h: a guest proxy that nothing references is collectable', async () => {
        const guest = await startGuest({ collectable: true })
        const ref = await proxyWeakRef(guest, 'ref_h')

        await collect(ref)

        expect(ref.deref()).toBeUndefined()
    })

    test('G-i: a method extracted from a proxy keeps the proxy alive until the method is dropped', async () => {
        const guest = await startGuest({ collectable: true })
        let held: { ref: WeakRef<object>, method: (...args: unknown[]) => Promise<unknown> } | null = await proxyWithMethod(guest, 'ref_i')

        await collect(held.ref)
        expect(held.ref.deref()).toBeDefined()
        void held.method().catch(() => {})
        const call = guest.posted.find((m) => m.type === 'CALL_INSTANCE')!
        expect(call.id).toBe('ref_i')
        expect(call.method).toBe('someMethod')

        const ref = held.ref
        held = null
        await collect(ref)
        expect(ref.deref()).toBeUndefined()
    })

    test('G-b: a proxy passed as an argument is serialized back to its REMOTE_REF', async () => {
        const guest = await startGuest()
        const proxy = await receiveProxy(guest, 'ref_7')

        void guest.risuai.useThing(proxy).catch(() => {})

        const request = guest.posted.find((m) => m.type === 'CALL_ROOT' && m.method === 'useThing')!
        expect((request.args as Msg[])[0]).toEqual({ __type: 'REMOTE_REF', id: 'ref_7' })
    })
})
