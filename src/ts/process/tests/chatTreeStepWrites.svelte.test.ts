import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Chat, ChatAlt, Message } from '../../storage/database.svelte'
import { detachTail, endTarget, switchTo } from '../chatTree'

// switchTo writes `chat.message` and `chat.alt` once each. In-place splice and push writes through the
// reactive proxy mark every dependent of every touched index separately, so the cost of a step would grow with
// the length of the departing and arriving chains. The tree must still end byte for byte as the in-place
// sequence left it, with the same message and record identities.

function message(id: string, role: 'user' | 'char', time: number): Message {
    return { role, data: `data ${id}`, chatId: id, time }
}

function chain(prefix: string, length: number, firstTime: number): Message[] {
    const out: Message[] = []
    for (let k = 1; k <= length; k++) {
        out.push(message(`${prefix}${k}`, k % 2 === 1 ? 'char' : 'user', firstTime + k))
    }
    return out
}

// Built with the real producers: a path is pushed in send order, `detachTail` cuts the long chain off at
// position 1, and a short chain is then sent. The branch fields hold live state that the cut parks.
function branchedChat(tail: number, short: number): Chat {
    const chat: Chat = {
        message: [message('r0', 'user', 1), ...chain('a', tail, 100)],
        note: '',
        name: 'chat',
        localLore: [],
    }
    chat.lastMemory = 'a1'
    chat.scriptstate = { visits: 1 }
    detachTail(chat, 1)
    chat.message.push(...chain('b', short, 1000))
    return chat
}

type Snapshotter = (chat: Chat) => string

// The steps cover next (short to long), prev (long to short, the arriving records hold the highest stamp),
// next again, and the end control, an arrival with nothing departing that restores a parked memory.
function runSteps(chat: Chat, snapshot: Snapshotter): string[] {
    const out: string[] = []
    const record = (done: boolean) => out.push(`${done}|${snapshot(chat)}`)
    record(switchTo(chat, 1, 'a1'))
    record(switchTo(chat, 1, 'b1'))
    record(switchTo(chat, 1, 'a1'))
    record(detachTail(chat, 3))
    const end = endTarget(chat)
    expect(end).not.toBeNull()
    record(switchTo(chat, chat.message.length, end ?? ''))
    return out
}

const plainSnapshot: Snapshotter = (chat) => JSON.stringify(chat)
const stateSnapshot: Snapshotter = (chat) => JSON.stringify($state.snapshot(chat))

function reactive(chat: Chat): Chat {
    const state = $state(chat)
    return state
}

function digest(lines: string[]): string {
    return createHash('sha256').update(lines.join('\n')).digest('hex')
}

// Written by running the in-place switchTo of 2bd895e9c over the same steps: one SHA-256 per step
// (the step result and the whole chat JSON), then one over all steps of the long chain.
const GOLDEN_SMALL_STEPS: string[] = [
    'd96d56b839c1cbe0c83a0634a466fa8206ef43818255d0874883897073880fae',
    '38059db237b5f4ca47fcb18d0d4462fecddaadf6d16658c7b4e3d65c76fe8e22',
    'd96d56b839c1cbe0c83a0634a466fa8206ef43818255d0874883897073880fae',
    '868e3746f5cead662116d65ffe89778055f2ffb02513abe9f789ff0568d9ec77',
    'd96d56b839c1cbe0c83a0634a466fa8206ef43818255d0874883897073880fae',
]
const GOLDEN_LONG_DIGEST = 'b2bc7732cf5bc3d2d4dd353b7f45214717ff06ec579ca6c7c281660f84448f44'

describe('switchTo result equals the in-place sequence', () => {
    it('matches the base results for a plain chat and a reactive chat (chain 5 against 3)', () => {
        const plain = runSteps(branchedChat(5, 3), plainSnapshot)
        const state = runSteps(reactive(branchedChat(5, 3)), stateSnapshot)
        expect(plain.map((line) => digest([line]))).toEqual(GOLDEN_SMALL_STEPS)
        expect(state.map((line) => digest([line]))).toEqual(GOLDEN_SMALL_STEPS)
    })

    it('matches the base digest for a long chain (60 against 4)', () => {
        const plain = runSteps(branchedChat(60, 4), plainSnapshot)
        const state = runSteps(reactive(branchedChat(60, 4)), stateSnapshot)
        expect(digest(plain)).toBe(GOLDEN_LONG_DIGEST)
        expect(digest(state)).toBe(GOLDEN_LONG_DIGEST)
    })
})

describe('switchTo keeps message and record identity', () => {
    it('hands the same message and record proxies to the new containers', () => {
        const chat = reactive(branchedChat(6, 3))
        const before = [...chat.message]
        const records = [...(chat.alt ?? [])]
        const arrivingMessages = records.map((record) => record.m)
        expect(records.length).toBe(6)

        expect(switchTo(chat, 1, 'a1')).toBe(true)

        // Messages before the position stay the very same elements.
        expect(chat.message[0]).toBe(before[0])
        // The arriving chain is made of the former records' messages.
        expect(chat.message.length).toBe(7)
        for (let k = 0; k < 6; k++) {
            expect(chat.message[1 + k]).toBe(arrivingMessages[k])
        }
        // The departed messages are now held by the records, in order.
        const departed = (chat.alt ?? []).map((record) => record.m)
        expect(departed).toHaveLength(3)
        for (let k = 0; k < 3; k++) {
            expect(departed[k]).toBe(before[1 + k])
        }
    })

    it('keeps the records that did not arrive as the same elements', () => {
        const chat = reactive(branchedChat(6, 3))
        // A third branch at position 1: the b chain is cut off into records and stays in alt while the
        // a chain arrives.
        expect(detachTail(chat, 1)).toBe(true)
        chat.message.push(...chain('c', 2, 3000))
        const kept: ChatAlt[] = (chat.alt ?? []).slice(6)
        expect(kept.map((record) => record.m.chatId)).toEqual(['b1', 'b2', 'b3'])

        expect(switchTo(chat, 1, 'a1')).toBe(true)

        const alt = chat.alt ?? []
        expect(alt.map((record) => record.m.chatId)).toEqual(['b1', 'b2', 'b3', 'c1', 'c2'])
        for (let k = 0; k < 3; k++) {
            expect(alt[k]).toBe(kept[k])
        }
    })
})

// A recursive proxy that forwards to the target and counts every set and delete on any array or object.
// A value written through it is unwrapped element by element and deeply, so the plain chat underneath
// never holds a wrapper.
function countingChat(chat: Chat): { chat: Chat; writes: () => number; indexWrites: () => number } {
    let writes = 0
    let indexWrites = 0
    const wrappers = new WeakMap<object, object>()
    const targets = new WeakMap<object, object>()

    function unwrapDeep(value: unknown): unknown {
        if (typeof value !== 'object' || value === null) {
            return value
        }
        const target = targets.get(value)
        if (target !== undefined) {
            return target
        }
        if (Array.isArray(value)) {
            return value.map(unwrapDeep)
        }
        const copy: Record<string, unknown> = {}
        for (const [key, entry] of Object.entries(value)) {
            copy[key] = unwrapDeep(entry)
        }
        return copy
    }

    function count(key: string | symbol): void {
        writes++
        if (typeof key === 'string' && /^\d+$/.test(key)) {
            indexWrites++
        }
    }

    function wrap<T extends object>(value: T): T {
        const known = wrappers.get(value)
        if (known !== undefined) {
            return known as T
        }
        const proxy = new Proxy(value, {
            get(target, key, receiver) {
                const read: unknown = Reflect.get(target, key, receiver)
                return typeof read === 'object' && read !== null ? wrap(read) : read
            },
            set(target, key, written) {
                count(key)
                return Reflect.set(target, key, unwrapDeep(written))
            },
            deleteProperty(target, key) {
                count(key)
                return Reflect.deleteProperty(target, key)
            },
        })
        wrappers.set(value, proxy)
        targets.set(proxy, value)
        return proxy
    }

    return { chat: wrap(chat), writes: () => writes, indexWrites: () => indexWrites }
}

type Case = 'next' | 'prev' | 'end'

// Counts the writes one switchTo makes on a chat of the given shape.
function writesOfOneStep(kind: Case, tail: number): { writes: number; indexWrites: number; done: boolean } {
    const plain = branchedChat(tail, 3)
    let position = 1
    let head = 'a1'
    if (kind === 'prev') {
        expect(switchTo(plain, 1, 'a1')).toBe(true)
        head = 'b1'
    } else if (kind === 'end') {
        expect(switchTo(plain, 1, 'a1')).toBe(true)
        expect(detachTail(plain, 3)).toBe(true)
        position = plain.message.length
        head = endTarget(plain) ?? ''
    }
    const counted = countingChat(plain)
    const done = switchTo(counted.chat, position, head)
    return { writes: counted.writes(), indexWrites: counted.indexWrites(), done }
}

describe('switchTo write count', () => {
    for (const kind of ['next', 'prev', 'end'] as const) {
        it(`writes a bounded number of times for ${kind}, independent of the chain length`, () => {
            const results = [10, 100, 300].map((tail) => writesOfOneStep(kind, tail))
            for (const result of results) {
                expect(result.done).toBe(true)
                expect(result.indexWrites).toBeLessThanOrEqual(12)
                expect(result.writes).toBeLessThanOrEqual(12)
            }
            expect(results[1].writes).toBe(results[0].writes)
            expect(results[2].writes).toBe(results[0].writes)
        })
    }
})
