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
import { markPlainResult } from './pluginCopy.svelte'
import { pluginCallGate, resetPluginWriteTurnsForTest, setPluginWriteYieldForTest, withWriteTurn, type CallGate } from '../pluginWriteTurns'

//#region host driver

type Msg = Record<string, unknown>

type HostRig = {
    host: SandboxHost
    iframe: HTMLIFrameElement
    posted: Msg[]
    /** The transfer list of each posted message, in step with `posted`. */
    transfers: Transferable[][]
    /** Delivers one guest message to the host handler and lets it settle. */
    send: (data: Msg) => Promise<void>
    /** Sends a request and returns the RESPONSE with the same reqId. */
    request: (data: Msg) => Promise<Msg>
}

let reqCounter = 0
const rigs: HostRig[] = []

function makeHostRig(api: Record<string, unknown>, callGate?: CallGate): HostRig {
    const host = new SandboxHost(api, callGate)
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.run(container, '')
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const win = iframe.contentWindow as Window
    const posted: Msg[] = []
    const transfers: Transferable[][] = []
    vi.spyOn(win, 'postMessage').mockImplementation(((message: Msg, _target: string, transfer?: Transferable[]) => {
        posted.push(message)
        transfers.push(transfer ?? [])
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
    const rig = { host, iframe, posted, transfers, send, request }
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
    resetPluginWriteTurnsForTest()
    setPluginWriteYieldForTest(null)
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

//#endregion

describe('host bridge', () => {
    /**
     * U4 regression reproducer: a plain-HTTP origin has no `crypto.randomUUID`. `uuid` captures the native function when
     * it is first evaluated, so this proves `SandboxHost` no longer calls `crypto.randomUUID`; it does not prove the
     * library's own `getRandomValues` fallback.
     */
    test('U4: a host built without crypto.randomUUID uses one v4 nonce in the CSP and the script tag', () => {
        Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
        try {
            const rig = makeHostRig({})
            const srcdoc = rig.iframe.srcdoc
            const scriptNonce = /<script nonce="([^"]+)"/.exec(srcdoc)?.[1]

            expect(scriptNonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
            expect(srcdoc).toContain(`script-src 'nonce-${scriptNonce}'`)
            expect(rig.iframe.getAttribute('csp')).toContain(`'nonce-${scriptNonce}'`)
        } finally {
            delete (crypto as { randomUUID?: unknown }).randomUUID
        }
    })

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

    describe('response transfer walk and logging', () => {
        const walkCount = () => vi.spyOn(
            SandboxHost.prototype as unknown as { collectTransferables: (obj: unknown, into?: Transferable[]) => Transferable[] },
            'collectTransferables',
        )
        const responseTransfer = (rig: HostRig, response: Msg) => rig.transfers[rig.posted.indexOf(response)]

        test('R9: a marked plain result is posted with an empty transfer list, unwalked, and equal to the unmarked result', async () => {
            const data = () => ({ characters: [{ chaId: 'a', chats: [{ id: 'c0', message: [{ data: 'hi' }] }] }], lineHeight: 1.5 })
            const rig = makeHostRig({ marked: () => markPlainResult(data()), unmarked: () => data() })
            const walk = walkCount()

            const marked = await rig.request({ type: 'CALL_ROOT', method: 'marked', args: [] })
            expect(walk).not.toHaveBeenCalled()
            expect(responseTransfer(rig, marked)).toEqual([])

            const unmarked = await rig.request({ type: 'CALL_ROOT', method: 'unmarked', args: [] })
            expect(walk).toHaveBeenCalled()
            expect(marked.result).toEqual(unmarked.result)
            expect(marked.result).toEqual(data())
        })

        test('G-c: an unmarked result still transfers its buffers', async () => {
            const buffer = new ArrayBuffer(8)
            const rig = makeHostRig({ unmarked: () => ({ buf: buffer }) })

            const response = await rig.request({ type: 'CALL_ROOT', method: 'unmarked', args: [] })

            expect(responseTransfer(rig, response)).toEqual([buffer])
        })

        test('R10: the handler logs nothing for a request', async () => {
            const rig = makeHostRig({ plain: () => ({ a: 1 }) })
            vi.mocked(console.log).mockClear()

            await rig.request({ type: 'CALL_ROOT', method: 'plain', args: [] })
            await rig.request({ type: 'CALL_ROOT', method: 'missing', args: [] })

            expect(console.log).not.toHaveBeenCalled()
        })
    })
})

//#region same-plugin call gate

type Held = { promise: Promise<void>, open: () => void }

const held = (): Held => {
    let open = () => {}
    const promise = new Promise<void>((resolve) => { open = resolve })
    return { promise, open }
}

const settleTimers = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Sends a request with a fixed reqId and returns it; a held request has no RESPONSE yet. */
async function sendCall(rig: HostRig, data: Msg): Promise<string> {
    const reqId = `gate_req_${++reqCounter}`
    await rig.send({ ...data, reqId })
    return reqId
}

const responseOf = (rig: HostRig, reqId: string) => rig.posted.find((m) => m.type === 'RESPONSE' && m.reqId === reqId)

type TurnState = { marker: string, char: string }

/** Stand-in plugin API whose database write takes its turn through the production `withWriteTurn`. */
function turnApi(name: string, state: TurnState, holds: Record<string, Held>) {
    return {
        setDatabase: (marker: string, holdKey?: string, char?: string) => withWriteTurn(name, async () => {
            if (holdKey) await holds[holdKey].promise
            state.marker = marker
            if (char !== undefined) state.char = char
        }),
        getDatabase: () => state.marker,
        // Three awaited hops: a lower bound of the permission lookups before the real setChar edits the character.
        setChar: async (char: string) => {
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
            state.char = char
        },
    }
}

describe('same-plugin call gate', () => {
    beforeEach(() => {
        setPluginWriteYieldForTest({ yieldFn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)), skip: () => false })
    })

    test('G1: a gated call is not invoked until its gate resolves; the gate is asked once per call; callbacks, aborts and releases are processed meanwhile', async () => {
        const wait = held()
        const seen: string[] = []
        let n = 0
        const ping = vi.fn(() => 'pong')
        const gate = vi.fn<CallGate>((type, method) => (type === 'CALL_ROOT' && method === 'ping' ? wait.promise : null))
        const rig = makeHostRig({
            make: () => makeRemote('r' + (++n)),
            ping,
            register: async (cb: () => Promise<string>) => { void cb().then((v) => { seen.push(v) }); return 'registered' },
        }, gate)
        const id = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        await rig.request({ type: 'CALL_ROOT', method: 'register', args: [{ __type: 'CALLBACK_REF', id: 'cb_g1' }] })
        const invoke = rig.posted.find((m) => m.type === 'INVOKE_CALLBACK') as { reqId: string }
        gate.mockClear()

        const pingId = await sendCall(rig, { type: 'CALL_ROOT', method: 'ping', args: [] })

        expect(gate).toHaveBeenCalledTimes(1)
        expect(gate).toHaveBeenCalledWith('CALL_ROOT', 'ping')
        expect(ping).not.toHaveBeenCalled()
        expect(responseOf(rig, pingId)).toBeUndefined()

        await rig.send({ type: 'CALLBACK_RETURN', reqId: invoke.reqId, result: 'cbv' })
        await rig.send({ type: 'ABORT_SIGNAL', abortId: 'ab_unused' })
        await rig.send({ type: 'RELEASE_INSTANCE', id })
        const afterRelease = await rig.request({ type: 'CALL_INSTANCE', id, method: 'ping', args: [] })
        expect(seen).toEqual(['cbv'])
        expect(afterRelease.error).toBe('Instance not found or released')
        expect(ping).not.toHaveBeenCalled()

        wait.open()
        await settleTimers()
        expect(ping).toHaveBeenCalledTimes(1)
        expect(responseOf(rig, pingId)?.result).toBe('pong')
    })

    test('G3a: a RELEASE_INSTANCE that arrives while a CALL_INSTANCE is gated does not stop that call', async () => {
        let armed = false
        const wait = held()
        const gate: CallGate = () => (armed ? wait.promise : null)
        const rig = makeHostRig({ make: () => makeRemote('r1') }, gate)
        const id = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        armed = true

        const callId = await sendCall(rig, { type: 'CALL_INSTANCE', id, method: 'ping', args: [] })
        await rig.send({ type: 'RELEASE_INSTANCE', id })
        expect(responseOf(rig, callId)).toBeUndefined()
        wait.open()
        await settleTimers()
        armed = false

        expect(responseOf(rig, callId)?.error).toBeUndefined()
        expect(responseOf(rig, callId)?.result).toBe('pong-r1')
        const later = await rig.request({ type: 'CALL_INSTANCE', id, method: 'ping', args: [] })
        expect(later.error).toBe('Instance not found or released')
    })

    test('G3b: a REMOTE_REF argument resolved in the arrival task survives a RELEASE_INSTANCE that arrives while the call is gated', async () => {
        let armed = false
        const wait = held()
        const gate: CallGate = () => (armed ? wait.promise : null)
        const rig = makeHostRig({
            make: () => makeRemote('r1'),
            take: (arg: Remote) => arg.tag,
        }, gate)
        const id = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        armed = true

        const callId = await sendCall(rig, { type: 'CALL_ROOT', method: 'take', args: [{ __type: 'REMOTE_REF', id }] })
        await rig.send({ type: 'RELEASE_INSTANCE', id })
        expect(responseOf(rig, callId)).toBeUndefined()
        wait.open()
        await settleTimers()

        expect(responseOf(rig, callId)?.error).toBeUndefined()
        expect(responseOf(rig, callId)?.result).toBe('r1')
    })

    test('G3c: an ABORT_SIGNAL that arrives while a call is gated reaches the signal the member receives', async () => {
        let armed = false
        const wait = held()
        const gate: CallGate = () => (armed ? wait.promise : null)
        const seen: boolean[] = []
        const rig = makeHostRig({
            watch: (opts: { signal: AbortSignal }) => { seen.push(opts.signal.aborted); return 'watched' },
        }, gate)
        armed = true

        const callId = await sendCall(rig, {
            type: 'CALL_ROOT',
            method: 'watch',
            args: [{ signal: { __type: 'ABORT_SIGNAL_REF', abortId: 'ab1', aborted: false } }],
        })
        await rig.send({ type: 'ABORT_SIGNAL', abortId: 'ab1' })
        expect(seen).toEqual([])
        wait.open()
        await settleTimers()

        expect(seen).toEqual([true])
        expect(responseOf(rig, callId)?.result).toBe('watched')
    })

    test('R7b: a plugin\'s second write is not gated and keeps its arrival place before another plugin\'s write', async () => {
        const state: TurnState = { marker: '', char: '' }
        const holds = { w1: held() }
        const p = makeHostRig(turnApi('P', state, holds), pluginCallGate('P'))
        const q = makeHostRig(turnApi('Q', state, holds), pluginCallGate('Q'))

        const w1 = await sendCall(p, { type: 'CALL_ROOT', method: 'setDatabase', args: ['w1', 'w1'] })
        const w2 = await sendCall(p, { type: 'CALL_ROOT', method: 'setDatabase', args: ['w2'] })
        const w3 = await sendCall(q, { type: 'CALL_ROOT', method: 'setDatabase', args: ['w3'] })
        holds.w1.open()
        await settleTimers()
        await settleTimers()

        expect(responseOf(p, w1)).toBeDefined()
        expect(responseOf(p, w2)).toBeDefined()
        expect(responseOf(q, w3)).toBeDefined()
        expect(state.marker).toBe('w3')
    })

    test('R8b: a plugin\'s read and its character edit wait for its latest write, not an earlier one', async () => {
        const state: TurnState = { marker: '', char: '' }
        const holds = { w1: held(), w2: held() }
        const rig = makeHostRig(turnApi('P', state, holds), pluginCallGate('P'))

        await sendCall(rig, { type: 'CALL_ROOT', method: 'setDatabase', args: ['m1', 'w1'] })
        await sendCall(rig, { type: 'CALL_ROOT', method: 'setDatabase', args: ['m2', 'w2', 'fromW2'] })
        const read = await sendCall(rig, { type: 'CALL_ROOT', method: 'getDatabase', args: [] })
        const edit = await sendCall(rig, { type: 'CALL_ROOT', method: 'setChar', args: ['edit'] })

        holds.w1.open()
        await settleTimers()
        expect(responseOf(rig, read)).toBeUndefined()
        expect(responseOf(rig, edit)).toBeUndefined()

        holds.w2.open()
        await settleTimers()
        await settleTimers()

        expect(responseOf(rig, read)?.result).toBe('m2')
        expect(responseOf(rig, edit)).toBeDefined()
        expect(state.char).toBe('edit')
    })

    test('R8c: a gated call released by a landing finishes before the write queued behind that landing starts', async () => {
        const state: TurnState = { marker: '', char: '' }
        const holds = { w1: held() }
        const rig = makeHostRig(turnApi('P', state, holds), pluginCallGate('P'))

        await sendCall(rig, { type: 'CALL_ROOT', method: 'setDatabase', args: ['m1', 'w1'] })
        await sendCall(rig, { type: 'CALL_ROOT', method: 'setChar', args: ['X'] })
        await sendCall(rig, { type: 'CALL_ROOT', method: 'setDatabase', args: ['m2', undefined, 'Y'] })
        holds.w1.open()
        await settleTimers()
        await settleTimers()

        expect(state.char).toBe('Y')
    })

    test('R12b: a plugin\'s earlier write landing does not release a call gated on its later write', async () => {
        const state: TurnState = { marker: '', char: '' }
        const holds = { w1: held(), w2: held() }
        const rig = makeHostRig(turnApi('P', state, holds), pluginCallGate('P'))

        const w1 = await sendCall(rig, { type: 'CALL_ROOT', method: 'setDatabase', args: ['m1', 'w1'] })
        await sendCall(rig, { type: 'CALL_ROOT', method: 'setDatabase', args: ['m2', 'w2'] })
        holds.w1.open()
        await settleTimers()
        expect(responseOf(rig, w1)).toBeDefined()

        const read = await sendCall(rig, { type: 'CALL_ROOT', method: 'getDatabase', args: [] })
        await settleTimers()
        expect(responseOf(rig, read)).toBeUndefined()

        holds.w2.open()
        await settleTimers()
        await settleTimers()
        expect(responseOf(rig, read)?.result).toBe('m2')
    })
})

//#endregion
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
