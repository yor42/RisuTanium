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

// Captured at load so the injected spy still reaches the real clone after a test replaces the global.
const realStructuredClone = structuredClone
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<void>

type GuestEvent = { kind: 'post', message: Msg } | { kind: 'ping', n: number }

/**
 * Injectable stand-ins for the guest's bound globals: a message channel whose messages are tasks run by the test, a
 * `structuredClone` spy, a mutable `document` and a `setTimeout` that never fires, so a timer-based yield stalls.
 */
type FakeEnv = {
    tasks: (() => void)[]
    cloneCalls: unknown[]
    clone: (value: unknown, options?: StructuredSerializeOptions) => unknown
    MessageChannel: new () => { port1: { onmessage: ((event: { data: unknown }) => void) | null }, port2: { postMessage: (data: unknown) => void } }
    document: { visibilityState: string }
    setTimeout: (fn: () => void, ms?: number) => number
    timerCalls: number
}

function makeFakeEnv(): FakeEnv {
    const env: FakeEnv = {
        tasks: [],
        cloneCalls: [],
        clone: (value, options) => {
            env.cloneCalls.push(value)
            return realStructuredClone(value, options)
        },
        MessageChannel: class {
            port1: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null }
            port2 = { postMessage: (data: unknown) => { env.tasks.push(() => { this.port1.onmessage?.({ data }) }) } }
        },
        document: { visibilityState: 'visible' },
        setTimeout: () => { env.timerCalls += 1; return 0 },
        timerCalls: 0,
    }
    return env
}

type Guest = {
    posted: Msg[]
    /** Transfer lists of `posted`, in step. */
    transfers: Transferable[][]
    events: GuestEvent[]
    risuai: Record<string, (...args: unknown[]) => Promise<any>>
    deliver: (data: Msg) => Promise<void>
    registered: { target: unknown, held: unknown }[]
    runCleanup: (id: string) => void
    microtasks: (() => void)[]
    flushMicrotasks: () => void
    env: FakeEnv
    /** Makes a post throw when the predicate returns true for its message. */
    failPost: (predicate: ((message: Msg) => boolean) | null) => void
    /** Runs one queued task, then lets the microtasks it started settle. */
    runTask: () => Promise<void>
    /** Runs queued tasks (including those they queue) until none is left. */
    runAll: () => Promise<void>
    /** Queues a task that only records a ping in `events`. */
    ping: () => void
    /** Lets microtasks settle without running any queued task. */
    settle: () => Promise<void>
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

type GuestOptions = {
    /**
     * Makes the fake registry record only the held values, so the test can observe garbage collection of a proxy; by
     * default it keeps the targets, which the registration assertions need.
     */
    collectable?: boolean
    /** Scheduler and fakes for the bound globals; shadows them as parameters unless `shadow` is false. */
    env?: FakeEnv
    shadow?: boolean
    /** Receives every posted message with its transfer list, e.g. to relay it over a real channel. */
    forward?: (message: Msg, transfer: Transferable[]) => void
}

async function startGuest(options: GuestOptions = {}): Promise<Guest> {
    const script = readGuestScript()
    const handlers: ((event: Msg) => Promise<void>)[] = []
    const posted: Msg[] = []
    const transfers: Transferable[][] = []
    const events: GuestEvent[] = []
    const registered: { target: unknown, held: unknown }[] = []
    const microtasks: (() => void)[] = []
    const env = options.env ?? makeFakeEnv()
    let failPredicate: ((message: Msg) => boolean) | null = null
    let pings = 0
    let cleanup: (held: unknown) => void = () => {}
    const parent = {
        postMessage: (message: Msg, _target?: string, transfer: Transferable[] = []) => {
            if (failPredicate?.(message)) throw new Error('post failed')
            posted.push(message)
            transfers.push(transfer)
            events.push({ kind: 'post', message })
            options.forward?.(message, transfer)
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
    const shadow = options.env !== undefined && options.shadow !== false
    const names = ['window', 'FinalizationRegistry', 'queueMicrotask', 'ImageBitmap']
    const run = new AsyncFunction(...names, ...(shadow ? ['structuredClone', 'MessageChannel', 'document', 'setTimeout'] : []), script)
    // The guest queues its own microtasks only for release flushes; the
    // initialization replies use the real queue.
    const realQueue = globalThis.queueMicrotask.bind(globalThis)
    let capture = false
    const fakeQueue = (fn: () => void) => {
        if (capture) microtasks.push(fn)
        else realQueue(fn)
    }
    const startup = run(fakeWindow, FakeFinalizationRegistry, fakeQueue, class {}, ...(shadow ? [env.clone, env.MessageChannel, env.document, env.setTimeout] : []))
    await startup
    capture = true
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    const runTask = async () => {
        env.tasks.shift()?.()
        await settle()
    }
    return {
        posted,
        transfers,
        events,
        risuai: (fakeWindow.risuai as Guest['risuai']),
        deliver,
        registered,
        runCleanup: (id) => cleanup(id),
        microtasks,
        flushMicrotasks: () => { for (const fn of microtasks.splice(0)) fn() },
        env,
        failPost: (predicate) => { failPredicate = predicate },
        runTask,
        runAll: async () => {
            for (let guard = 0; env.tasks.length > 0; guard++) {
                if (guard > 10000) throw new Error('task loop did not end')
                await runTask()
            }
        },
        ping: () => {
            const n = ++pings
            env.tasks.push(() => { events.push({ kind: 'ping', n }) })
        },
        settle,
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

//#region guest chunked write

/**
 * Guest side of the chunked database write. Labels: R = regression reproducer (fails on the pre-change bridge), G =
 * guard. Most guards need a transfer in flight, which the pre-change bridge never starts, so they fail there at their
 * first transport assertion. Only T12, T15b and T18b also pass on the pre-change bridge, where their data is carried by a single
 * message; T2, T8b, T14, T15 and T16 first assert that a transfer exists, so they fail there. The single-message cases under T6 are compatibility guards that pass on both.
 * The guest runs with an injected task scheduler: a channel message, a ping and the test's own steps are separate
 * tasks, and the injected `setTimeout` never fires.
 */
describe('guest chunked write', () => {
    const PIECE = 1024 * 1024
    const KINDS = ['CHUNK_BEGIN', 'CHUNK_PIECE', 'CHUNK_END', 'CHUNK_ABORT']

    type Db = { meta: { title: string }, list: { id: string, text: string }[], [key: string]: unknown }

    const makeDb = (count = 60): Db => ({
        meta: { title: 'library' },
        list: Array.from({ length: count }, (_, i) => ({ id: 'c' + i, text: 'x'.repeat(100_000) })),
    })

    const types = (guest: Guest, from = 0) => guest.posted.slice(from).map((m) => m.type as string)
    const indexOfType = (guest: Guest, type: string, method?: string) =>
        guest.posted.findIndex((m) => m.type === type && (method === undefined || m.method === method))
    const encoded = (message: Msg) => JSON.stringify(message).length

    /** Starts a guest on the injected scheduler; `start` is the number of messages the bridge itself posted. */
    async function scheduled() {
        const env = makeFakeEnv()
        const guest = await startGuest({ env })
        return { guest, env, start: guest.posted.length }
    }

    /** Replays the guest's posts to a real host and returns what its `setDatabase` received. */
    async function landOnHost(guest: Guest, from: number) {
        const received: unknown[] = []
        const rig = makeHostRig({ setDatabase: (arg: unknown) => { received.push(arg) } })
        for (const message of guest.posted.slice(from)) await rig.send(message)
        return received
    }

    test('T1 (R): a write over the threshold starts with CHUNK_BEGIN and no message carries the whole argument', async () => {
        const { guest, start } = await scheduled()
        const db = makeDb(60)

        void guest.risuai.setDatabase(db).catch(() => {})
        await guest.runAll()

        const posts = guest.posted.slice(start)
        expect(posts[0].type).toBe('CHUNK_BEGIN')
        expect(Math.max(...posts.map(encoded))).toBeLessThan(2 * PIECE)
        expect(posts.some((m) => m.type === 'CALL_ROOT' && m.method === 'setDatabase')).toBe(false)
        expect(posts[posts.length - 1].type).toBe('CHUNK_END')
    })

    test('T1p (R): pieces post one per task turn, never in a burst and never through a timer', async () => {
        const { guest, env, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        expect(types(guest, start)).toEqual(['CHUNK_BEGIN'])
        // A fresh ping before every task: a piece posted in the same task as its predecessor has no ping between.
        for (let guard = 0; guard < 200 && !guest.posted.some((m) => m.type === 'CHUNK_END'); guard++) {
            guest.ping()
            await guest.runTask()
        }
        await guest.runAll()

        const log = guest.events.slice(guest.events.findIndex((e) => e.kind === 'post' && e.message.type === 'CHUNK_BEGIN'))
        const pieceIndexes = log.flatMap((e, i) => (e.kind === 'post' && e.message.type === 'CHUNK_PIECE' ? [i] : []))
        expect(pieceIndexes.length).toBeGreaterThanOrEqual(3)
        for (let k = 1; k < pieceIndexes.length; k++) {
            const between = log.slice(pieceIndexes[k - 1] + 1, pieceIndexes[k])
            expect(between.some((e) => e.kind === 'ping')).toBe(true)
        }
        expect(env.timerCalls).toBe(0)
    })

    test('T2 (G, compatibility guard of the chunked path, fails on base because no transfer starts there): the host receives a value equal to what a single message carries: key order, own __proto__, undefined, Date, integer-like key, shared objects inside one element', async () => {
        const { guest, start } = await scheduled()
        const db: Record<string, unknown> = {}
        const stamp = new Date(1_700_000_000_000)
        db.b = 'second'
        db['7'] = 'seven'
        db.list = Array.from({ length: 60 }, (_, i) => {
            const shared = { s: i }
            return { id: 'c' + i, text: 'x'.repeat(100_000), a: shared, b: shared, at: new Date(stamp.getTime() + i) }
        })
        Object.defineProperty(db, '__proto__', { value: { own: true }, enumerable: true, configurable: true, writable: true })
        db.u = undefined
        db.d = stamp
        const expected = structuredClone(db)

        void guest.risuai.setDatabase(db).catch(() => {})
        await guest.runAll()
        expect(guest.posted[start].type).toBe('CHUNK_BEGIN')
        expect(types(guest, start)).toContain('CHUNK_END')
        const [out] = await landOnHost(guest, start) as Record<string, any>[]

        expect(Reflect.ownKeys(out)).toEqual(Reflect.ownKeys(expected))
        expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ own: true })
        expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(out, 'u')).toBe(true)
        expect(out.d).toBeInstanceOf(Date)
        expect(out.d.getTime()).toBe(stamp.getTime())
        expect(out.list).toHaveLength(60)
        expect(out.list[3].a).toBe(out.list[3].b)
        expect(out.list[3].at).toBeInstanceOf(Date)
        expect(out.list[3].a.s).toBe(3)
        expect(out).toEqual(expected)
    })

    test('T4 (G): later reads and edits of the same plugin arrive after END', async () => {
        const { guest, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void guest.risuai.getDatabase().catch(() => {})
        void guest.risuai.setChar('c').catch(() => {})
        expect(types(guest, start)).toEqual(['CHUNK_BEGIN'])
        await guest.runAll()

        const end = indexOfType(guest, 'CHUNK_END')
        expect(end).toBeGreaterThan(-1)
        expect(indexOfType(guest, 'CALL_ROOT', 'getDatabase')).toBeGreaterThan(end)
        expect(indexOfType(guest, 'CALL_ROOT', 'setChar')).toBeGreaterThan(indexOfType(guest, 'CALL_ROOT', 'getDatabase'))
        const lastPiece = guest.posted.map((m) => m.type).lastIndexOf('CHUNK_PIECE')
        expect(end).toBeGreaterThan(lastPiece)
    })

    describe('T6: writes that take the single-message path unchanged', () => {
        const variants: [string, (db: Db) => void][] = [
            ['typed array', (db) => { (db.list[3] as Record<string, unknown>).t = new Uint8Array(4) }],
            ['Map', (db) => { (db.list[3] as Record<string, unknown>).m = new Map() }],
            ['Set', (db) => { (db.list[3] as Record<string, unknown>).m = new Set() }],
            ['sparse top-level array', (db) => { db.holes = [1, , 3] }],
            ['top-level array with a hole and an extra property', (db) => { const a = [1, , 3] as unknown[] & { x?: number }; a.x = 1; db.holey = a }],
            ['top-level array with an extra property', (db) => { const a = [1, 2] as unknown[] & { x?: number }; a.x = 1; db.extra = a }],
            ['class instance', (db) => { (db.list[3] as Record<string, unknown>).k = new (class Box {})() }],
            ['function', (db) => { (db.list[3] as Record<string, unknown>).f = () => 1 }],
            ['symbol', (db) => { (db.list[3] as Record<string, unknown>).y = Symbol('s') }],
            ['Error', (db) => { (db.list[3] as Record<string, unknown>).e = new Error('x') }],
            ['cross-element alias', (db) => { (db.list[5] as Record<string, unknown>).peer = db.list[2] }],
            ['element refers to a non-split top-level value (N1)', (db) => { (db.list[3] as Record<string, unknown>).meta = db.meta }],
            ['non-split value refers to an element', (db) => { db.pick = db.list[4] }],
            ['one array under two keys (T6b)', (db) => { db.list2 = db.list }],
            ['one array of primitives under two keys (T6b)', (db) => { db.names = ['a', 'b']; db.names2 = db.names }],
            ['element refers to an array of primitives (T6a)', (db) => { db.names = ['a', 'b']; (db.list[3] as Record<string, unknown>).names = db.names }],
            ['same element twice in a split array (T6c)', (db) => { db.list.push(db.list[0]) }],
            ['shared Date across elements', (db) => { const d = new Date(5); (db.list[1] as Record<string, unknown>).d = d; (db.list[8] as Record<string, unknown>).d = d }],
            ['non-split total over one piece (T6d)', (db) => { db.blob = 'z'.repeat(PIECE + 1) }],
            ['no top-level array', (db) => { db.single = { items: db.list }; db.list = 'gone' as unknown as Db['list'] }],
        ]

        test.each(variants)('%s', async (_name, mutate) => {
            const { guest, env, start } = await scheduled()
            const db = makeDb(60)
            mutate(db)

            void guest.risuai.setDatabase(db).catch(() => {})
            await guest.runAll()

            const posts = guest.posted.slice(start)
            expect(posts).toHaveLength(1)
            expect(posts[0].type).toBe('CALL_ROOT')
            expect(posts[0].method).toBe('setDatabase')
            expect((posts[0].args as unknown[])[0]).toBe(db)
            expect(env.cloneCalls).toHaveLength(0)
            expect(env.tasks).toHaveLength(0)
        })

        // The single-message path walks the cycle in collectTransferables and overflows the stack; the planner must hand
        // such a write to it untouched rather than chunk it, whether the cycle runs through the root, a split array, one
        // element or one non-split value.
        test.each([
            ['an element refers to the root (T6a)', (db: Db) => { (db.list[3] as Record<string, unknown>).root = db }],
            ['an element refers to a split array (T6a)', (db: Db) => { (db.list[3] as Record<string, unknown>).all = db.list }],
            ['an element refers to itself (F1)', (db: Db) => { const el = db.list[3] as Record<string, unknown>; el.self = el }],
            ['a nested object of an element refers back to the element (F1)', (db: Db) => { const el = db.list[3] as Record<string, unknown>; el.inner = { up: el } }],
            ['a non-split value refers to itself (F1)', (db: Db) => { (db.meta as Record<string, unknown>).self = db.meta }],
        ])('%s', async (_name, mutate) => {
            const { guest, env, start } = await scheduled()
            const db = makeDb(60)
            mutate(db)

            await expect(guest.risuai.setDatabase(db)).rejects.toBeInstanceOf(RangeError)

            expect(guest.posted.slice(start)).toEqual([])
            expect(types(guest, start).some((t) => KINDS.includes(t))).toBe(false)
            expect(env.cloneCalls).toHaveLength(0)
            expect(env.tasks).toHaveLength(0)
        })

        test('a write under the threshold and a write of another method are posted as one message', async () => {
            const { guest, env, start } = await scheduled()
            const small = { list: [{ id: 'a', text: 'x' }] }
            const big = makeDb(60)

            void guest.risuai.setDatabase(small).catch(() => {})
            void guest.risuai.setDatabaseLite(small).catch(() => {})
            void guest.risuai.otherWrite(big).catch(() => {})
            void guest.risuai.setDatabase(big, 2).catch(() => {})
            await guest.runAll()

            expect(types(guest, start)).toEqual(['CALL_ROOT', 'CALL_ROOT', 'CALL_ROOT', 'CALL_ROOT'])
            expect(env.cloneCalls).toHaveLength(0)
        })

        test('an eligible setDatabaseLite write is chunked with its own method', async () => {
            const { guest, start } = await scheduled()

            void guest.risuai.setDatabaseLite(makeDb(60)).catch(() => {})
            await guest.runAll()

            expect(guest.posted[start].type).toBe('CHUNK_BEGIN')
            expect(guest.posted[start].method).toBe('setDatabaseLite')
        })
    })

    test('T6n (G): a write a getter makes while the bridge is idle is posted before BEGIN without a clone; the getter is read twice', async () => {
        const { guest, env, start } = await scheduled()
        const db = makeDb(60)
        let reads = 0
        let clonesAtNestedPost = -1
        Object.defineProperty(db.list[10], 'probe', {
            enumerable: true,
            get() {
                reads += 1
                void guest.risuai.setDatabase({ nested: reads }).catch(() => {})
                if (clonesAtNestedPost < 0) clonesAtNestedPost = env.cloneCalls.length
                return 'p'
            },
        })

        void guest.risuai.setDatabase(db).catch(() => {})

        const nested = guest.posted.slice(start).filter((m) => m.type === 'CALL_ROOT' && m.method === 'setDatabase')
        expect(clonesAtNestedPost).toBe(0)
        expect(nested.length).toBe(2)
        expect(reads).toBe(2)
        expect(types(guest, start).filter((t) => t === 'CHUNK_BEGIN')).toHaveLength(1)
        expect(guest.posted.slice(start).findIndex((m) => m.type === 'CHUNK_BEGIN')).toBe(2)
    })

    test('T7 (G): the write is a call-time snapshot; edits after the call never reach the host', async () => {
        const { guest, start } = await scheduled()
        const db = makeDb(60)
        const expected = structuredClone(db)

        void guest.risuai.setDatabase(db).catch(() => {})
        db.list[0].text = 'mutated'
        db.list.push({ id: 'late', text: 'late' })
        db.meta.title = 'changed'
        await guest.runAll()
        const [out] = await landOnHost(guest, start)

        expect(out).toEqual(expected)
    })

    test('T7b (G): a call queued behind the transfer is a call-time snapshot too, not a reference', async () => {
        const { guest, start } = await scheduled()
        const arg = { v: 1, nested: { w: 1 } }

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void guest.risuai.other(arg).catch(() => {})
        arg.v = 2
        arg.nested.w = 2
        await guest.runAll()

        const call = guest.posted.slice(start).find((m) => m.type === 'CALL_ROOT' && m.method === 'other')!
        const sent = (call.args as Record<string, any>[])[0]
        expect(sent).toEqual({ v: 1, nested: { w: 1 } })
        expect(sent).not.toBe(arg)
    })

    test('T8 (G): a nested Proxy rejects the write as a single message would, and nothing is posted', async () => {
        const { guest, start } = await scheduled()
        const db = makeDb(60)
        ;(db.list[4] as Record<string, unknown>).p = new Proxy({}, {})

        const result = guest.risuai.setDatabase(db)
        await expect(result).rejects.toMatchObject({ name: 'DataCloneError' })

        expect(guest.posted.slice(start)).toEqual([])
        expect(guest.env.tasks).toHaveLength(0)

        // The failed preparation leaves the planner usable: the next valid large write is chunked again.
        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        expect(guest.posted[start].type).toBe('CHUNK_BEGIN')
    })

    test('T21 (G): an error RESPONSE that arrives with the last piece stops END', async () => {
        const env = makeFakeEnv()
        let pieces = -1
        let refuse: ((reqId: unknown) => void) | null = null
        const guest = await startGuest({
            env,
            // Runs inside the post of the last piece, so the refusal lands between that piece and END.
            forward: (message) => {
                if (message.type === 'CHUNK_BEGIN') pieces = message.pieces as number
                if (message.type === 'CHUNK_PIECE' && message.seq === pieces - 1) refuse?.(message.reqId)
            },
        })
        refuse = (reqId) => { void guest.deliver({ type: 'RESPONSE', reqId, error: 'refused' }) }
        const start = guest.posted.length

        const rejected = expect(guest.risuai.setDatabase(makeDb(60))).rejects.toThrow('refused')
        await guest.runAll()
        await rejected

        expect(types(guest, start)).toContain('CHUNK_PIECE')
        expect(types(guest, start)).not.toContain('CHUNK_END')
    })

    test('T8b (G, compatibility guard of the chunked path, fails on base because no transfer starts there, MC-4321): a top-level Proxy over the threshold writes the values its traps report', async () => {
        const { guest, start } = await scheduled()
        const db = makeDb(60)
        const root = new Proxy(db, {
            get: (target, key, receiver) => (key === 'meta' ? { title: 'trapped root' } : Reflect.get(target, key, receiver)),
        })
        const list = new Proxy(db.list, {
            get: (target, key, receiver) => (key === '0' ? { id: 'trapped', text: 't' } : Reflect.get(target, key, receiver)),
        })

        void guest.risuai.setDatabase(root).catch(() => {})
        await guest.runAll()
        expect(guest.posted[start].type).toBe('CHUNK_BEGIN')
        const [out] = await landOnHost(guest, start) as Db[]
        expect(out.meta).toEqual({ title: 'trapped root' })

        const second = guest.posted.length
        void guest.risuai.setDatabase({ list, tail: 'x' }).catch(() => {})
        await guest.runAll()
        expect(guest.posted[second].type).toBe('CHUNK_BEGIN')
        const [out2] = await landOnHost(guest, second) as Db[]
        expect(out2.list[0]).toEqual({ id: 'trapped', text: 't' })
        expect(out2.list).toHaveLength(60)
    })

    test('T9 (G): a hidden page posts BEGIN, every piece and END at once, with no task turn', async () => {
        const { guest, env, start } = await scheduled()
        env.document.visibilityState = 'hidden'

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})

        const posts = types(guest, start)
        expect(posts[0]).toBe('CHUNK_BEGIN')
        expect(posts[posts.length - 1]).toBe('CHUNK_END')
        expect(posts.filter((t) => t === 'CHUNK_PIECE').length).toBeGreaterThanOrEqual(3)
        expect(env.tasks).toHaveLength(0)
    })

    test('T9b (G): a page that becomes hidden mid-transfer posts the rest when the pending turn arrives', async () => {
        const { guest, env, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        await guest.runTask()
        expect(types(guest, start)).toEqual(['CHUNK_BEGIN', 'CHUNK_PIECE'])
        env.document.visibilityState = 'hidden'
        await guest.runTask()

        const posts = types(guest, start)
        expect(posts[posts.length - 1]).toBe('CHUNK_END')
        expect(env.tasks).toHaveLength(0)
    })

    test('T10 (G): a post that fails mid-transfer aborts it, rejects the write and still posts what was queued', async () => {
        const { guest, start } = await scheduled()
        guest.failPost((m) => m.type === 'CHUNK_PIECE' && m.seq === 1)

        const write = guest.risuai.setDatabase(makeDb(60))
        void guest.risuai.after().catch(() => {})
        const rejected = expect(write).rejects.toThrow('post failed')
        await guest.runAll()
        await rejected

        const posts = types(guest, start)
        expect(posts.slice(0, 3)).toEqual(['CHUNK_BEGIN', 'CHUNK_PIECE', 'CHUNK_ABORT'])
        expect(posts).not.toContain('CHUNK_END')
        expect(posts[3]).toBe('CALL_ROOT')
        expect(guest.posted[start + 3].method).toBe('after')
    })

    test('T11 (G): two writes never interleave on the wire', async () => {
        const { guest, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        await guest.runAll()

        const posts = types(guest, start)
        const firstEnd = posts.indexOf('CHUNK_END')
        const secondBegin = posts.indexOf('CHUNK_BEGIN', 1)
        expect(secondBegin).toBe(firstEnd + 1)
        expect(posts.filter((t) => t === 'CHUNK_BEGIN')).toHaveLength(2)
        expect(posts.filter((t) => t === 'CHUNK_END')).toHaveLength(2)
        const wire = guest.posted.slice(start).filter((m) => KINDS.includes(m.type as string))
        expect(new Set(wire.slice(0, firstEnd + 1).map((m) => m.reqId)).size).toBe(1)
        expect(new Set(wire.slice(firstEnd + 1).map((m) => m.reqId)).size).toBe(1)
    })

    test('T11b (G): a call a getter makes while the second write is prepared follows END of the first and precedes BEGIN of the second', async () => {
        const { guest, start } = await scheduled()
        const second = makeDb(60)
        let fired = false
        Object.defineProperty(second.list[7], 'probe', {
            enumerable: true,
            get() {
                if (!fired) {
                    fired = true
                    void guest.risuai.setChar('nested').catch(() => {})
                }
                return 'p'
            },
        })

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void guest.risuai.setDatabase(second).catch(() => {})
        await guest.runAll()

        const posts = guest.posted.slice(start).map((m) => (m.type === 'CALL_ROOT' ? 'CALL:' + m.method : (m.type as string)))
        const firstEnd = posts.indexOf('CHUNK_END')
        expect(posts[firstEnd + 1]).toBe('CALL:setChar')
        expect(posts[firstEnd + 2]).toBe('CHUNK_BEGIN')
    })

    test('T12 (G, compatibility guard, also passes on base): after END and the drain the next message is posted synchronously, with no clone', async () => {
        const { guest, env } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        await guest.runAll()
        const clones = env.cloneCalls.length
        const posted = guest.posted.length
        void guest.risuai.later().catch(() => {})

        expect(guest.posted.length).toBe(posted + 1)
        expect(guest.posted[posted].method).toBe('later')
        expect(env.cloneCalls).toHaveLength(clones)
    })

    test('T13 (G): a CALL_INSTANCE queued behind the transfer is followed by the release, and the host still finds the instance', async () => {
        const { guest } = await scheduled()
        const proxy = await receiveProxy(guest, 'ref_13')
        const from = guest.posted.length

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void proxy.work().catch(() => {})
        proxy.release()
        guest.runCleanup('ref_cleanup')
        guest.flushMicrotasks()
        await guest.runAll()

        const posts = guest.posted.slice(from).map((m) => m.type as string)
        const end = posts.indexOf('CHUNK_END')
        const call = posts.indexOf('CALL_INSTANCE')
        expect(end).toBeGreaterThan(-1)
        expect(call).toBeGreaterThan(end)
        expect(posts.indexOf('RELEASE_INSTANCE')).toBeGreaterThan(call)
        expect(posts.lastIndexOf('RELEASE_INSTANCE')).toBeGreaterThan(call)

        const working: string[] = []
        const rig = makeHostRig({ make: () => ({ __classType: 'REMOTE_REQUIRED', work: () => { working.push('ok'); return 1 } }) })
        const ref = refIdOf(await rig.request({ type: 'CALL_ROOT', method: 'make', args: [] }))
        for (const message of guest.posted.slice(from)) {
            if (message.type === 'CALL_INSTANCE') await rig.send({ ...message, id: ref })
            else if (message.type === 'RELEASE_INSTANCE' && message.id) await rig.send({ ...message, id: ref })
        }
        expect(working).toEqual(['ok'])
    })

    test('T14 (G, compatibility guard of the chunked path, fails on base because no transfer starts there): an AbortSignal call queued behind the transfer is followed by its ABORT, and the host aborts the controller', async () => {
        const { guest, start } = await scheduled()
        const controller = new AbortController()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void guest.risuai.watch({ signal: controller.signal }).catch(() => {})
        controller.abort()
        await guest.runAll()

        const call = indexOfType(guest, 'CALL_ROOT', 'watch')
        const abort = indexOfType(guest, 'ABORT_SIGNAL')
        expect(guest.posted[start].type).toBe('CHUNK_BEGIN')
        expect(indexOfType(guest, 'CHUNK_END')).toBeGreaterThan(-1)
        expect(call).toBeGreaterThan(indexOfType(guest, 'CHUNK_END'))
        expect(abort).toBeGreaterThan(call)

        // The signal was already aborted when serialized only if the abort came first; here it was live.
        // The call stays in flight, as an abortable request does, so its controller is still registered.
        const signals: AbortSignal[] = []
        const rig = makeHostRig({ watch: (opts: { signal: AbortSignal }) => { signals.push(opts.signal); return new Promise(() => {}) } })
        for (const message of guest.posted.slice(start)) {
            if (message.type === 'CALL_ROOT' && message.method === 'watch') await rig.send(message)
            if (message.type === 'ABORT_SIGNAL') await rig.send(message)
        }
        expect(signals).toHaveLength(1)
        expect(signals[0].aborted).toBe(true)
    })

    describe('with real channels', () => {
        type Received = { data: Msg, ports: unknown[] }

        function relay() {
            const channel = new MessageChannel()
            const received: Received[] = []
            channel.port2.onmessage = (event: MessageEvent) => {
                received.push({ data: event.data as Msg, ports: [...(event.ports ?? [])] })
            }
            const waitFor = async (predicate: () => boolean) => {
                for (let i = 0; i < 400 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5))
                expect(predicate()).toBe(true)
            }
            return { channel, received, waitFor, close: () => { channel.port1.close(); channel.port2.close() } }
        }

        const callbackIdOf = (guest: Guest, method: string) => {
            const request = guest.posted.find((m) => m.type === 'CALL_ROOT' && m.method === method)!
            return ((request.args as Msg[])[0] as { id: string }).id
        }

        test('T15 (G, compatibility guard of the chunked path, fails on base because no transfer starts there): a callback that returns a ReadableStream during a transfer sends CALLBACK_RETURN after END with its port in the transfer list, and the stream pulls', async () => {
            const r = relay()
            try {
                const guest = await startGuest({ forward: (message, transfer) => r.channel.port1.postMessage(message, transfer) })
                void guest.risuai.watch(() => new ReadableStream({
                    start(controller) { controller.enqueue('chunk'); controller.close() },
                })).catch(() => {})
                const id = callbackIdOf(guest, 'watch')

                void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
                await guest.deliver({ type: 'INVOKE_CALLBACK', id, reqId: 'cb15', args: [] })
                await r.waitFor(() => r.received.some((m) => m.data.type === 'CALLBACK_RETURN'))

                const order = r.received.map((m) => m.data.type as string)
                expect(order).toContain('CHUNK_BEGIN')
                expect(order).toContain('CHUNK_END')
                expect(order.indexOf('CALLBACK_RETURN')).toBeGreaterThan(order.indexOf('CHUNK_END'))
                const returned = r.received.find((m) => m.data.type === 'CALLBACK_RETURN')!
                expect(returned.ports).toHaveLength(1)
                const port = returned.ports[0] as MessagePort
                const chunks: unknown[] = []
                port.onmessage = (event: MessageEvent) => { chunks.push(event.data) }
                port.postMessage({ pull: true })
                await r.waitFor(() => chunks.length > 0)
                expect(chunks[0]).toEqual({ done: false, value: 'chunk' })
                port.close()
            } finally {
                r.close()
            }
        })

        test('T15b (G, compatibility guard, also passes on base): an ArrayBuffer returned during a transfer is detached at once, as a direct post would, and its bytes arrive intact', async () => {
            const r = relay()
            try {
                const guest = await startGuest({ forward: (message, transfer) => r.channel.port1.postMessage(message, transfer) })
                const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
                const buffer = bytes.buffer
                void guest.risuai.watch(() => ({ buf: buffer })).catch(() => {})
                const id = callbackIdOf(guest, 'watch')

                void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
                await guest.deliver({ type: 'INVOKE_CALLBACK', id, reqId: 'cb15b', args: [] })
                expect(buffer.byteLength).toBe(0)
                await r.waitFor(() => r.received.some((m) => m.data.type === 'CALLBACK_RETURN'))

                const returned = r.received.find((m) => m.data.type === 'CALLBACK_RETURN')!
                const result = returned.data.result as { buf: ArrayBuffer }
                expect([...new Uint8Array(result.buf)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
            } finally {
                r.close()
            }
        })

        test('N2 (G): a call made from inside a late-failure handler queues at the tail, behind entries already queued', async () => {
            const r = relay()
            try {
                const guest = await startGuest({ forward: (message, transfer) => r.channel.port1.postMessage(message, transfer) })
                let cancelled = false
                void guest.risuai.watch(() => new ReadableStream({
                    pull() {},
                    cancel() {
                        cancelled = true
                        void guest.risuai.fromCancel().catch(() => {})
                    },
                })).catch(() => {})
                const id = callbackIdOf(guest, 'watch')
                guest.failPost((m) => m.type === 'CALLBACK_RETURN' && m.result !== undefined)

                void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
                await guest.deliver({ type: 'INVOKE_CALLBACK', id, reqId: 'cbn2', args: [] })
                void guest.risuai.queuedBefore().catch(() => {})
                await r.waitFor(() => r.received.some((m) => m.data.method === 'fromCancel'))
                await r.waitFor(() => r.received.some((m) => m.data.type === 'CALLBACK_RETURN' && m.data.error !== undefined))

                const order = r.received.map((m) => (m.data.type === 'CALL_ROOT' ? 'CALL:' + m.data.method : (m.data.type as string)))
                expect(cancelled).toBe(true)
                expect(order.indexOf('CALL:queuedBefore')).toBeGreaterThan(order.indexOf('CHUNK_END'))
                expect(order.indexOf('CALL:fromCancel')).toBeGreaterThan(order.indexOf('CALL:queuedBefore'))
            } finally {
                r.close()
            }
        })
    })

    test('T16 (G, compatibility guard of the chunked path, fails on base because no transfer starts there): EXECUTE_CODE during a transfer answers after END and after the calls the code made', async () => {
        const { guest, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        await guest.deliver({ type: 'EXECUTE_CODE', reqId: 'exec16', code: 'void window.risuai.getDatabase(); return 1' })
        await guest.runAll()

        const order = guest.posted.slice(start).map((m) => (m.type === 'CALL_ROOT' ? 'CALL:' + m.method : (m.type as string)))
        const end = order.indexOf('CHUNK_END')
        expect(order[0]).toBe('CHUNK_BEGIN')
        expect(end).toBeGreaterThan(-1)
        expect(order.indexOf('CALL:getDatabase')).toBeGreaterThan(end)
        expect(order.indexOf('EXEC_RESULT')).toBeGreaterThan(order.indexOf('CALL:getDatabase'))
    })

    test('T17 (G): an argument that cannot be cloned fails at the call while a transfer pumps, and the rest is unharmed', async () => {
        const { guest, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        const bad = guest.risuai.other({ f: () => 1 })
        await expect(bad).rejects.toMatchObject({ name: 'DataCloneError' })
        void guest.risuai.good().catch(() => {})
        await guest.runAll()

        const order = guest.posted.slice(start).map((m) => (m.type === 'CALL_ROOT' ? 'CALL:' + m.method : (m.type as string)))
        expect(order).not.toContain('CALL:other')
        expect(order).toContain('CALL:good')
    })

    test('T17b (G): a callback result that cannot be cloned answers with the error CALLBACK_RETURN, at the tail', async () => {
        const { guest, start } = await scheduled()
        void guest.risuai.watch(() => ({ f: () => 1 })).catch(() => {})
        const request = guest.posted.find((m) => m.type === 'CALL_ROOT' && m.method === 'watch')!
        const id = ((request.args as Msg[])[0] as { id: string }).id

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        await guest.deliver({ type: 'INVOKE_CALLBACK', id, reqId: 'cb17', args: [] })
        await guest.runAll()

        const returned = guest.posted.slice(start).filter((m) => m.type === 'CALLBACK_RETURN')
        expect(returned).toHaveLength(1)
        expect(String(returned[0].error)).toContain('Failed to post message to parent')
        expect(indexOfType(guest, 'CALLBACK_RETURN')).toBeGreaterThan(indexOfType(guest, 'CHUNK_END'))
    })

    test('T18 (G): a post that throws for one queued entry rejects that call and the later entries still post', async () => {
        const { guest, start } = await scheduled()

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        const a = guest.risuai.first()
        const b = guest.risuai.second()
        const c = guest.risuai.third()
        void c.catch(() => {})
        guest.failPost((m) => m.type === 'CALL_ROOT' && m.method === 'second')
        const rejected = expect(b).rejects.toThrow('post failed')
        void a.catch(() => {})
        await guest.runAll()
        await rejected

        const methods = guest.posted.slice(start).filter((m) => m.type === 'CALL_ROOT').map((m) => m.method)
        expect(methods).toEqual(['first', 'third'])
        expect(types(guest, start)).toContain('CHUNK_END')
    })

    test('T18b (G, compatibility guard, also passes on base): a callback return that fails after queueing sends the error return', async () => {
        const { guest, start } = await scheduled()
        void guest.risuai.watch(() => 'value').catch(() => {})
        const request = guest.posted.find((m) => m.type === 'CALL_ROOT' && m.method === 'watch')!
        const id = ((request.args as Msg[])[0] as { id: string }).id
        guest.failPost((m) => m.type === 'CALLBACK_RETURN' && m.result === 'value')

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        await guest.deliver({ type: 'INVOKE_CALLBACK', id, reqId: 'cb18', args: [] })
        await guest.runAll()

        const returned = guest.posted.slice(start).filter((m) => m.type === 'CALLBACK_RETURN')
        expect(returned).toHaveLength(1)
        expect(String(returned[0].error)).toContain('post failed')
    })

    test('T19 (G): an error RESPONSE to BEGIN stops the pieces and END, and the next queued entry posts', async () => {
        const { guest, start } = await scheduled()

        const write = guest.risuai.setDatabase(makeDb(60))
        void guest.risuai.after().catch(() => {})
        const rejected = expect(write).rejects.toThrow('refused')
        const begin = guest.posted[start]
        expect(begin.type).toBe('CHUNK_BEGIN')
        await guest.deliver({ type: 'RESPONSE', reqId: begin.reqId, error: 'refused' })
        await guest.runAll()
        await rejected

        const posts = types(guest, start)
        expect(posts).toEqual(['CHUNK_BEGIN', 'CALL_ROOT'])
        expect(guest.posted[start + 1].method).toBe('after')
    })

    test('T20 (G): a plugin that replaces structuredClone and MessageChannel after the bridge started does not redirect the bridge', async () => {
        const env = makeFakeEnv()
        vi.stubGlobal('structuredClone', env.clone)
        vi.stubGlobal('MessageChannel', env.MessageChannel)
        const guest = await startGuest({ env, shadow: false })
        const start = guest.posted.length
        const hostile = vi.fn(() => { throw new Error('hostile') })
        vi.stubGlobal('structuredClone', hostile)
        vi.stubGlobal('MessageChannel', class { constructor() { throw new Error('hostile') } })

        void guest.risuai.setDatabase(makeDb(60)).catch(() => {})
        void guest.risuai.after().catch(() => {})
        await guest.runAll()

        expect(hostile).not.toHaveBeenCalled()
        expect(env.cloneCalls.length).toBeGreaterThan(0)
        expect(types(guest, start)[0]).toBe('CHUNK_BEGIN')
        expect(types(guest, start)).toContain('CHUNK_END')
        expect(types(guest, start)).toContain('CALL_ROOT')
    })
})

//#endregion
