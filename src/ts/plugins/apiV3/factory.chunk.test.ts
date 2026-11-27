// @vitest-environment jsdom

/**
 * Host side of the chunked plugin database write in `factory.ts` (`SandboxHost`): CHUNK_BEGIN, CHUNK_PIECE, CHUNK_END and
 * CHUNK_ABORT are driven with synthetic `message` events whose `source` is the iframe window, because jsdom does not
 * execute `srcdoc` scripts. The choke point counters are the real `busyActions`, and the write turn is the real
 * `withWriteTurn`.
 *
 * Labels: these are mutant-killing guards of the host protocol. Where the pre-change bridge ignores the chunk messages,
 * they fail on it; T5 ABORT is a compatibility guard that also passes there, because dropping nothing and answering
 * nothing is what the old bridge does with an unknown message too.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { chokePointInFlight } from 'src/ts/process/memory/busyActions'
import { SandboxHost } from './factory'
import { pluginCallGate, resetPluginWriteTurnsForTest, setPluginWriteYieldForTest, withWriteTurn, type CallGate } from '../pluginWriteTurns'

type Msg = Record<string, unknown>

type Rig = {
    host: SandboxHost
    posted: Msg[]
    send: (data: Msg) => Promise<void>
    /** Delivers one message event and returns at once, without letting any task run. */
    dispatch: (data: Msg) => void
}

const rigs: Rig[] = []
let counter = 0

function makeRig(api: Record<string, unknown>, callGate?: CallGate): Rig {
    const host = new SandboxHost(api, callGate)
    const container = document.createElement('div')
    document.body.appendChild(container)
    host.run(container, '')
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const win = iframe.contentWindow as Window
    const posted: Msg[] = []
    vi.spyOn(win, 'postMessage').mockImplementation(((message: Msg) => {
        posted.push(message)
    }) as unknown as typeof win.postMessage)
    const dispatch = (data: Msg) => {
        const event = new MessageEvent('message', { data })
        Object.defineProperty(event, 'source', { value: win })
        window.dispatchEvent(event)
    }
    const send = async (data: Msg) => {
        dispatch(data)
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const rig = { host, posted, send, dispatch }
    rigs.push(rig)
    return rig
}

// jsdom has no iframe `sandbox` token list; `run` only adds tokens to it.
if (!('sandbox' in HTMLIFrameElement.prototype)) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
        configurable: true,
        get() { return { add() {} } },
    })
}

beforeEach(() => {
    vi.stubGlobal('ImageBitmap', class {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    setPluginWriteYieldForTest({ yieldFn: () => new Promise<void>((resolve) => setTimeout(resolve, 0)), skip: () => false })
})

afterEach(() => {
    for (const rig of rigs.splice(0)) rig.host.terminate()
    resetPluginWriteTurnsForTest()
    setPluginWriteYieldForTest(null)
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const responseOf = (rig: Rig, reqId: string) => rig.posted.find((m) => m.type === 'RESPONSE' && m.reqId === reqId)
const bridgeInFlight = () => chokePointInFlight('pluginBridge')

type Entry = { key: string, split?: number, value?: unknown }

const begin = (reqId: string, layout: unknown, pieces: number, method: string = 'setDatabase'): Msg =>
    ({ type: 'CHUNK_BEGIN', reqId, method, pieces, layout })
const piece = (reqId: string, seq: number, slot: number, items: unknown): Msg =>
    ({ type: 'CHUNK_PIECE', reqId, seq, slot, items })
const end = (reqId: string): Msg => ({ type: 'CHUNK_END', reqId })
const nextReq = () => `chunk_req_${++counter}`

/** Opens a transfer of one split array `a` (declared `n` items) plus a layout value, in `pieces` pieces. */
async function open(rig: Rig, reqId: string, n: number, pieces: number) {
    await rig.send(begin(reqId, [{ key: 'v', value: 7 }, { key: 'a', split: n }], pieces))
}

describe('chunked write host', () => {
    test('T3: no API call before END, then exactly one call with the reassembled argument, one gate lookup and a write turn', async () => {
        const seen: unknown[] = []
        const setDatabase = vi.fn((arg: unknown) => withWriteTurn('P', async () => { seen.push(arg) }))
        const gate = vi.fn(pluginCallGate('P'))
        const rig = makeRig({ setDatabase }, gate)
        const id = nextReq()

        await rig.send(begin(id, [
            { key: '2', value: 'two' },
            { key: 'a', split: 3 },
            { key: '__proto__', value: { polluted: true } },
            { key: 'u', value: undefined },
            { key: '1', value: 'one' },
        ], 2))
        expect(bridgeInFlight()).toBe(1)
        await rig.send(piece(id, 0, 1, [{ n: 1 }, { n: 2 }]))
        await rig.send(piece(id, 1, 1, [{ n: 3 }]))
        expect(setDatabase).not.toHaveBeenCalled()
        expect(gate).not.toHaveBeenCalled()
        expect(bridgeInFlight()).toBe(1)

        await rig.send(end(id))
        await settle()

        expect(setDatabase).toHaveBeenCalledTimes(1)
        expect(gate).toHaveBeenCalledTimes(1)
        expect(gate).toHaveBeenCalledWith('CALL_ROOT', 'setDatabase')
        const arg = seen[0] as Record<string, unknown>
        // Integer-like keys sort first by language rule; the rest keep layout order.
        expect(Reflect.ownKeys(arg)).toEqual(['1', '2', 'a', '__proto__', 'u'])
        expect(Object.getOwnPropertyDescriptor(arg, '__proto__')?.value).toEqual({ polluted: true })
        expect(Object.getPrototypeOf(arg)).toBe(Object.prototype)
        expect(Object.prototype.hasOwnProperty.call(arg, 'u')).toBe(true)
        expect(arg.u).toBeUndefined()
        expect(arg.a).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
        expect(responseOf(rig, id)).toEqual({ type: 'RESPONSE', reqId: id })
        expect(bridgeInFlight()).toBe(0)
    })

    test('T3b: a write that fails after END answers an error RESPONSE and holds no choke point', async () => {
        const rig = makeRig({ setDatabase: async () => { throw new Error('refused') } })
        const id = nextReq()
        await open(rig, id, 1, 1)
        await rig.send(piece(id, 0, 1, ['x']))
        await rig.send(end(id))
        expect(responseOf(rig, id)?.error).toBe('refused')
        expect(bridgeInFlight()).toBe(0)
    })

    test('T4: a later read of the same plugin arrives after END and waits for the write to land', async () => {
        let open1 = () => {}
        const hold = new Promise<void>((resolve) => { open1 = resolve })
        const state = { marker: '' }
        const rig = makeRig({
            setDatabase: (arg: { v: string }) => withWriteTurn('P', async () => { await hold; state.marker = arg.v }),
            getDatabase: () => state.marker,
        }, pluginCallGate('P'))
        const id = nextReq()
        await rig.send(begin(id, [{ key: 'v', value: 'written' }, { key: 'a', split: 1 }], 1))
        await rig.send(piece(id, 0, 1, [1]))
        await rig.send(end(id))
        const readId = nextReq()
        await rig.send({ type: 'CALL_ROOT', method: 'getDatabase', args: [], reqId: readId })

        expect(responseOf(rig, readId)).toBeUndefined()
        open1()
        await settle()
        await settle()
        expect(responseOf(rig, readId)?.result).toBe('written')
    })

    test('T4x: another plugin\'s write between BEGIN and END lands first; the chunked write takes its place at END', async () => {
        const order: string[] = []
        const make = (name: string) => ({
            setDatabase: (arg: { v?: string }) => withWriteTurn(name, async () => { order.push(arg.v ?? name) }),
        })
        const p = makeRig(make('P'), pluginCallGate('P'))
        const q = makeRig(make('Q'), pluginCallGate('Q'))
        const id = nextReq()
        await p.send(begin(id, [{ key: 'v', value: 'P' }, { key: 'a', split: 2 }], 2))
        await p.send(piece(id, 0, 1, [1]))
        await q.send({ type: 'CALL_ROOT', method: 'setDatabase', args: [{ v: 'Q' }], reqId: nextReq() })
        await p.send(piece(id, 1, 1, [2]))
        await p.send(end(id))
        await settle()
        await settle()

        expect(order).toEqual(['Q', 'P'])
    })

    test('T4g: END and the next call of the same plugin, delivered back to back, take their gate turns in that order', async () => {
        const asked: string[] = []
        const inner = pluginCallGate('P')
        const gate: CallGate = (kind, method) => { asked.push(method); return inner(kind, method) }
        const rig = makeRig({ setDatabase: async () => {}, getDatabase: () => 'r' }, gate)
        const id = nextReq()
        await open(rig, id, 1, 1)
        await rig.send(piece(id, 0, 1, ['x']))

        rig.dispatch(end(id))
        rig.dispatch({ type: 'CALL_ROOT', method: 'getDatabase', args: [], reqId: nextReq() })

        expect(asked).toEqual(['setDatabase', 'getDatabase'])
        await settle()
    })

    test('T4h: a call the iframe sends between pieces runs at once without waiting for the transfer', async () => {
        const getDatabase = vi.fn(() => 'now')
        const rig = makeRig({ setDatabase: async () => {}, getDatabase }, pluginCallGate('P'))
        const id = nextReq()
        await open(rig, id, 2, 2)
        await rig.send(piece(id, 0, 1, [1]))
        const readId = nextReq()
        await rig.send({ type: 'CALL_ROOT', method: 'getDatabase', args: [], reqId: readId })

        expect(getDatabase).toHaveBeenCalledTimes(1)
        expect(responseOf(rig, readId)?.result).toBe('now')
        expect(bridgeInFlight()).toBe(1)
        await rig.send(piece(id, 1, 1, [2]))
        await rig.send(end(id))
        expect(bridgeInFlight()).toBe(0)
    })

    describe('T5: protocol abuse', () => {
        const goodLayout: Entry[] = [{ key: 'v', value: 1 }, { key: 'a', split: 2 }]
        const bigLayout = Array.from({ length: 4097 }, (_, i) => ({ key: 'k' + i, value: i }))

        // Each BEGIN is refused with an error RESPONSE to its own reqId and leaves nothing open.
        const badBegins: [string, (id: string) => Msg][] = [
            ['pieces 0', (id) => begin(id, goodLayout, 0)],
            ['pieces 4097', (id) => begin(id, goodLayout, 4097)],
            ['pieces fractional', (id) => begin(id, goodLayout, 1.5)],
            ['pieces not a number', (id) => ({ ...begin(id, goodLayout, 1), pieces: '1' })],
            ['layout not an array', (id) => begin(id, { key: 'a', split: 1 }, 1)],
            ['layout over 4096 entries', (id) => begin(id, bigLayout, 1)],
            ['layout entry not an object', (id) => begin(id, [null], 1)],
            ['layout key not a string', (id) => begin(id, [{ key: 5, split: 1 }], 1)],
            ['layout duplicate key', (id) => begin(id, [{ key: 'a', split: 1 }, { key: 'a', value: 1 }], 1)],
            ['split negative', (id) => begin(id, [{ key: 'a', split: -1 }], 1)],
            ['split fractional', (id) => begin(id, [{ key: 'a', split: 1.5 }], 1)],
            ['split 2^53', (id) => begin(id, [{ key: 'a', split: 2 ** 53 }], 1)],
            ['split not a number', (id) => begin(id, [{ key: 'a', split: '3' }], 1)],
            ['method not a write', (id) => begin(id, goodLayout, 1, 'getDatabase')],
            ['method absent', (id) => ({ ...begin(id, goodLayout, 1), method: undefined })],
        ]
        test.each(badBegins)('T5 BEGIN: %s', async (_name, make) => {
            const setDatabase = vi.fn(async () => {})
            const rig = makeRig({ setDatabase })
            const id = nextReq()
            await rig.send(make(id))

            expect(typeof responseOf(rig, id)?.error).toBe('string')
            expect(bridgeInFlight()).toBe(0)
            // Nothing is open: a piece and an END for that reqId are ignored.
            await rig.send(piece(id, 0, 1, [1]))
            await rig.send(end(id))
            expect(setDatabase).not.toHaveBeenCalled()
            expect(rig.posted).toHaveLength(1)
        })

        // Each piece or END fault fails the transfer once with an error RESPONSE and releases the choke point.
        const faults: [string, (id: string) => Msg[]][] = [
            ['seq not next', (id) => [piece(id, 1, 1, [1])]],
            ['seq not a number', (id) => [{ ...piece(id, 0, 1, [1]), seq: '0' }]],
            ['more pieces than declared', (id) => [piece(id, 0, 1, [1]), piece(id, 1, 1, [2]), piece(id, 2, 1, [])]],
            ['slot out of range', (id) => [piece(id, 0, 2, [1])]],
            ['slot negative', (id) => [piece(id, 0, -1, [1])]],
            ['slot fractional', (id) => [piece(id, 0, 1.5, [1])]],
            ['slot is not a split entry', (id) => [piece(id, 0, 0, [1])]],
            ['items not an array', (id) => [piece(id, 0, 1, { length: 1 })]],
            ['items overflow the declared length', (id) => [piece(id, 0, 1, [1, 2, 3])]],
            ['END before all pieces', (id) => [end(id)]],
            ['END with an incomplete array', (id) => [piece(id, 0, 1, [1]), end(id)]],
        ]
        test.each(faults)('T5 piece/END: %s', async (_name, make) => {
            const setDatabase = vi.fn(async () => {})
            const rig = makeRig({ setDatabase })
            const id = nextReq()
            // Two declared pieces for a two-item array: the faults above all break that contract once.
            await open(rig, id, 2, 2)
            for (const message of make(id)) await rig.send(message)

            const errors = rig.posted.filter((m) => m.type === 'RESPONSE' && m.reqId === id)
            expect(errors).toHaveLength(1)
            expect(typeof errors[0].error).toBe('string')
            expect(bridgeInFlight()).toBe(0)
            await rig.send(end(id))
            expect(setDatabase).not.toHaveBeenCalled()
        })

        test('T5 END before the declared pieces: a layout with no split array and a missing piece is refused', async () => {
            const setDatabase = vi.fn(async () => {})
            const rig = makeRig({ setDatabase })
            const id = nextReq()
            await rig.send(begin(id, [{ key: 'v', value: 1 }], 1))
            await rig.send(end(id))

            expect(typeof responseOf(rig, id)?.error).toBe('string')
            expect(setDatabase).not.toHaveBeenCalled()
            expect(bridgeInFlight()).toBe(0)
        })

        test('T5 len: a declared length of 2^53-1 is accepted without allocating, and a short END fails', async () => {
            const setDatabase = vi.fn(async () => {})
            const rig = makeRig({ setDatabase })
            const id = nextReq()
            await rig.send(begin(id, [{ key: 'a', split: 2 ** 53 - 1 }], 1))
            expect(responseOf(rig, id)).toBeUndefined()
            expect(bridgeInFlight()).toBe(1)
            await rig.send(piece(id, 0, 0, [1, 2, 3]))
            await rig.send(end(id))

            expect(typeof responseOf(rig, id)?.error).toBe('string')
            expect(setDatabase).not.toHaveBeenCalled()
            expect(bridgeInFlight()).toBe(0)
        })

        test('T5 unknown reqId: a piece, END or ABORT for another reqId changes nothing and the transfer completes', async () => {
            const seen: unknown[] = []
            const rig = makeRig({ setDatabase: async (arg: unknown) => { seen.push(arg) } })
            const id = nextReq()
            await open(rig, id, 1, 1)
            await rig.send(piece('other', 0, 1, [9]))
            await rig.send(end('other'))
            await rig.send({ type: 'CHUNK_ABORT', reqId: 'other' })
            expect(rig.posted).toHaveLength(0)
            expect(bridgeInFlight()).toBe(1)

            await rig.send(piece(id, 0, 1, [1]))
            await rig.send(end(id))
            expect(seen).toEqual([{ v: 7, a: [1] }])
        })

        test('T5 second BEGIN: refused with an error RESPONSE to the new reqId, and the open transfer is unharmed', async () => {
            const seen: unknown[] = []
            const rig = makeRig({ setDatabase: async (arg: unknown) => { seen.push(arg) } })
            const first = nextReq()
            const second = nextReq()
            await open(rig, first, 1, 1)
            await rig.send(begin(second, [{ key: 'z', value: 1 }], 1))

            expect(typeof responseOf(rig, second)?.error).toBe('string')
            expect(responseOf(rig, first)).toBeUndefined()
            expect(bridgeInFlight()).toBe(1)
            await rig.send(piece(first, 0, 1, [1]))
            await rig.send(end(first))
            expect(seen).toEqual([{ v: 7, a: [1] }])
        })

        test('T5 ABORT (compatibility guard, also passes on base): drops the open transfer without a RESPONSE and releases the choke point', async () => {
            const setDatabase = vi.fn(async () => {})
            const rig = makeRig({ setDatabase })
            const id = nextReq()
            await open(rig, id, 1, 1)
            await rig.send({ type: 'CHUNK_ABORT', reqId: id })

            expect(rig.posted).toHaveLength(0)
            expect(bridgeInFlight()).toBe(0)
            await rig.send(end(id))
            expect(setDatabase).not.toHaveBeenCalled()
        })
    })

    describe('T5i: idle', () => {
        test('a transfer is dropped after two consecutive quiet ticks, and a message from the iframe resets the count', async () => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
            const setDatabase = vi.fn(async () => {})
            const rig = makeRig({ setDatabase })
            const id = nextReq()
            await open(rig, id, 2, 2)

            vi.advanceTimersByTime(30000)
            expect(bridgeInFlight()).toBe(1)
            // Activity: the next tick only resets, so two further quiet ticks are needed.
            await rig.send(piece(id, 0, 1, [1]))
            vi.advanceTimersByTime(30000)
            expect(bridgeInFlight()).toBe(1)
            vi.advanceTimersByTime(30000)
            expect(bridgeInFlight()).toBe(1)
            expect(responseOf(rig, id)).toBeUndefined()
            vi.advanceTimersByTime(30000)

            expect(bridgeInFlight()).toBe(0)
            expect(typeof responseOf(rig, id)?.error).toBe('string')
            expect(vi.getTimerCount()).toBe(0)
            await rig.send(piece(id, 1, 1, [2]))
            await rig.send(end(id))
            expect(setDatabase).not.toHaveBeenCalled()
        })
    })

    describe('T5t: terminate', () => {
        test('terminating drops the transfer: no RESPONSE, no timer, choke point released', async () => {
            vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
            const rig = makeRig({ setDatabase: async () => {} })
            const id = nextReq()
            await open(rig, id, 1, 1)
            expect(bridgeInFlight()).toBe(1)
            expect(vi.getTimerCount()).toBe(1)

            rig.host.terminate()

            expect(bridgeInFlight()).toBe(0)
            expect(vi.getTimerCount()).toBe(0)
            expect(rig.posted).toHaveLength(0)
        })
    })
})
