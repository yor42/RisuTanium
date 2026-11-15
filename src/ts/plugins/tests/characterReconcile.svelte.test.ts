/**
 * `characterReconcile`: strict compare of a plugin's incoming characters against the live reactive ones, and the
 * keep decision built on it.
 *
 * Test kinds: "guard:" rows pass before and after any change to the setter and pin the module contract; every
 * other row names the mutant of the module it kills. Live trees are real Svelte `$state` proxies, so the proxy
 * reads (prototype, own keys, nested proxies) are the production ones. The oracle rows draw random mutations from
 * a seeded generator; a failure message carries the seed and iteration (set RECONCILE_SEED to replay).
 */
import { describe, expect, test } from 'vitest'
import { reconcileCharacters, sameStoredValue } from '../characterReconcile'
import { keepLiveAlt, withoutAlt } from '../chatAltBridge'
import { sameJsonValue, toPlainJson } from '../../storage/store2/codec/normalize'

type Entry = Record<string, unknown>

function live<T>(value: T): T {
    const state = $state(value)
    return state
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const SEED = Number(process.env.RECONCILE_SEED ?? 20261114)

const rec = (id: string, p: string | null, a: number): Entry => ({ m: { role: 'char', data: id, chatId: id }, p, a })

function chat(chaId: string, n: number, withAlt: boolean): Entry {
    const id = `${chaId}-chat${n}`
    return {
        id,
        name: `Chat ${n}`,
        note: '',
        fmIndex: -1,
        message: [
            { role: 'user', data: `hello ${n}`, chatId: `${id}-m1`, time: 0 },
            { role: 'char', data: `reply ${n}`, chatId: `${id}-m2`, time: 1700000000000 + n },
        ],
        ...(withAlt ? { alt: [rec(`${id}-m2`, `${id}-m1`, 1), rec(`${id}-m3`, null, 0)] } : {}),
    }
}

function character(chaId: string, withAlt = true): Entry {
    return {
        chaId,
        name: `Name ${chaId}`,
        type: 'character',
        coldstorage: false,
        tags: ['a', 'b'],
        desc: 'a description',
        created: new Date(5).toISOString(),
        seed: 0,
        ratio: 0.5,
        flag: true,
        nothing: null,
        additionalData: { creator: 'maker' },
        chats: [chat(chaId, 1, withAlt), chat(chaId, 2, false)],
    }
}

/** What the V3 bridge delivers for an unchanged character: a structured clone without `alt`, before `keepLiveAlt`. */
function bridgeCopy(chaId: string): Entry {
    const copy = structuredClone(character(chaId))
    withoutAlt(copy as { chats?: { alt?: unknown }[] })
    return copy
}

class Holder {
    x = 1
}

function reverseKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(reverseKeys)
    }
    if (typeof value === 'object' && value !== null) {
        const out: Entry = {}
        for (const key of Object.keys(value).reverse()) {
            out[key] = reverseKeys((value as Entry)[key])
        }
        return out
    }
    return value
}

describe('sameStoredValue: pitfalls that must be different', () => {
    test('A1 a Date is different from a Date holding the same time', () => {
        expect(sameStoredValue({ d: new Date(0) }, live({ d: new Date(0) }))).toBe(false)
    })

    test('A2 a Date is different from its ISO string', () => {
        expect(sameStoredValue({ d: new Date(0) }, live({ d: new Date(0).toISOString() }))).toBe(false)
    })

    test('A3 a boxed string is different from a boxed string of the same text', () => {
        expect(sameStoredValue({ s: new String('x') }, live({ s: new String('x') }))).toBe(false)
    })

    test('A4 a boxed type is different from the primitive it unboxes to', () => {
        expect(sameStoredValue({ type: new String('group') }, live({ type: 'group' }))).toBe(false)
        expect(sameStoredValue({ type: 'group' }, live({ type: new String('group') }))).toBe(false)
    })

    test('A5 a boxed false is different from a boxed false', () => {
        expect(sameStoredValue({ coldstorage: new Boolean(false) }, live({ coldstorage: new Boolean(false) }))).toBe(false)
    })

    test('A6 a boxed tag is different from a boxed tag and from the plain tag', () => {
        expect(sameStoredValue({ tags: [new String('a')] }, live({ tags: [new String('a')] }))).toBe(false)
        expect(sameStoredValue({ tags: [new String('a')] }, live({ tags: ['a'] }))).toBe(false)
    })

    test('A7 an own non-enumerable toJSON is different from an object without one', () => {
        const incoming = {}
        Object.defineProperty(incoming, 'toJSON', { value: () => 1, enumerable: false })
        expect(sameStoredValue(incoming, live({}))).toBe(false)
    })

    test('A8 an inherited toJSON (prototype that is not Object.prototype) is different from a plain empty object', () => {
        expect(sameStoredValue(Object.create({ toJSON: () => 1 }), live({}))).toBe(false)
    })

    test('A9 a class instance is different from a plain object with the same fields', () => {
        expect(sameStoredValue(new Holder(), live({ x: 1 }))).toBe(false)
    })

    test('A10 an array shorter than the live one is different, trailing undefined included', () => {
        expect(sameStoredValue([1], live([1, undefined]))).toBe(false)
        expect(sameStoredValue([1, undefined], live([1]))).toBe(false)
    })

    test('A11 an extra key on either side is different', () => {
        expect(sameStoredValue({ x: 1, y: 2 }, live({ x: 1 }))).toBe(false)
        expect(sameStoredValue({ x: 1 }, live({ x: 1, y: 2 }))).toBe(false)
    })

    test('A12 a changed message text is different', () => {
        const incoming = bridgeCopy('a')
        ;((incoming.chats as Entry[])[0].message as Entry[])[1].data = 'changed'
        expect(sameStoredValue(incoming, live(character('a', false)))).toBe(false)
    })

    test('A13 a non-enumerable incoming key does not stand in for an enumerable live key', () => {
        const incoming = { y: 1 }
        Object.defineProperty(incoming, 'x', { value: 1, enumerable: false })
        expect(sameStoredValue(incoming, live({ x: 1 }))).toBe(false)
    })

    test('guard: undefined against an absent key, and -0 against 0, are strict (over-mark; open pending the plugin-rewrite measurement)', () => {
        expect(sameStoredValue({ a: undefined }, live({}))).toBe(false)
        expect(sameStoredValue({}, live({ a: undefined }))).toBe(false)
        expect(sameStoredValue({ n: -0 }, live({ n: 0 }))).toBe(false)
    })

    test('guard: functions, symbols and bigints are different from themselves', () => {
        const fn = () => 1
        expect(sameStoredValue({ f: fn }, live({ f: fn }))).toBe(false)
        expect(sameStoredValue({ s: Symbol.for('x') }, live({ s: Symbol.for('x') }))).toBe(false)
        expect(sameStoredValue({ b: 1n }, live({ b: 1n }))).toBe(false)
    })

    test('guard: nesting past the depth cap is different, nesting under it is equal', () => {
        const nest = (depth: number): Entry => {
            const root: Entry = {}
            let cursor = root
            for (let i = 0; i < depth; i++) {
                const next: Entry = {}
                cursor.n = next
                cursor = next
            }
            return root
        }
        expect(sameStoredValue(nest(100), live(nest(100)))).toBe(true)
        expect(sameStoredValue(nest(300), live(nest(300)))).toBe(false)
    })
})

describe('sameStoredValue: what must be equal', () => {
    test('O2a an unchanged bridge copy with the live alt kept is equal', () => {
        const liveList = live([character('a')])
        const incoming = [bridgeCopy('a')]
        keepLiveAlt(liveList, incoming)
        expect(sameStoredValue(incoming[0], liveList[0])).toBe(true)
    })

    test('O2b reversed key order is equal', () => {
        const liveList = live([character('a')])
        const incoming = [reverseKeys(bridgeCopy('a')) as Entry]
        keepLiveAlt(liveList, incoming)
        expect(sameStoredValue(incoming[0], liveList[0])).toBe(true)
    })

    test('O2c a shared object is equal by reference, and an unshared equal copy of it is equal too', () => {
        const liveList = live([character('a')])
        const liveAlt = (liveList[0].chats as Entry[])[0].alt
        const shared = bridgeCopy('a')
        ;(shared.chats as Entry[])[0].alt = liveAlt
        expect(sameStoredValue(shared, liveList[0])).toBe(true)
        const unshared = bridgeCopy('a')
        ;(unshared.chats as Entry[])[0].alt = structuredClone($state.snapshot(liveAlt))
        expect(sameStoredValue(unshared, liveList[0])).toBe(true)
    })
})

describe('reconcileCharacters', () => {
    function pair(): { liveList: Entry[], incoming: Entry[] } {
        const liveList = live([character('a'), character('b'), character('c')])
        const incoming = [bridgeCopy('a'), bridgeCopy('b'), bridgeCopy('c')]
        keepLiveAlt(liveList, incoming)
        return { liveList, incoming }
    }

    test('an unchanged list keeps every live proxy and reports every slot', () => {
        const { liveList, incoming } = pair()
        const result = reconcileCharacters(liveList, incoming)
        expect(result).not.toBeNull()
        expect([...result!.keptSlots]).toEqual([0, 1, 2])
        result!.characters.forEach((element, i) => {
            expect(element).toBe(liveList[i])
        })
    })

    test('a changed element is installed as given and is not in the kept slots', () => {
        const { liveList, incoming } = pair()
        incoming[1].desc = 'edited'
        const result = reconcileCharacters(liveList, incoming)!
        expect([...result.keptSlots]).toEqual([0, 2])
        expect(result.characters[1]).toBe(incoming[1])
        expect(result.characters[0]).toBe(liveList[0])
    })

    test('M10 the kept element is the live proxy, not the incoming object', () => {
        const { liveList, incoming } = pair()
        const result = reconcileCharacters(liveList, incoming)!
        expect(result.characters[0]).not.toBe(incoming[0])
        expect(result.characters[0]).toBe(liveList[0])
    })

    test('M7 an incoming element that is a live element is never kept, and its neighbours still are', () => {
        const { liveList, incoming } = pair()
        incoming[0] = liveList[0]
        const result = reconcileCharacters(liveList, incoming)!
        expect([...result.keptSlots]).toEqual([1, 2])
        expect(result.characters[0]).toBe(liveList[0])
    })

    test('M7 a live element placed at another slot is not kept at either slot it touches', () => {
        const { liveList, incoming } = pair()
        incoming[1] = liveList[1]
        const result = reconcileCharacters(liveList, incoming)!
        expect(result.keptSlots.has(1)).toBe(false)
    })

    test('M8 a reorder of an odd-length list returns null although the middle slot is unchanged', () => {
        const { liveList, incoming } = pair()
        expect(reconcileCharacters(liveList, [incoming[2], incoming[1], incoming[0]])).toBeNull()
    })

    test('M9 a length change returns null: an append and a removal at the end', () => {
        const { liveList, incoming } = pair()
        expect(reconcileCharacters(liveList, [...incoming, bridgeCopy('d')])).toBeNull()
        expect(reconcileCharacters(liveList, incoming.slice(0, 2))).toBeNull()
    })

    test('an insert or a delete in the middle returns null', () => {
        const { liveList, incoming } = pair()
        expect(reconcileCharacters(liveList, [incoming[0], bridgeCopy('x'), incoming[1], incoming[2]])).toBeNull()
        expect(reconcileCharacters(liveList, [incoming[0], incoming[2]])).toBeNull()
    })

    test('an unusable or different chaId at any slot returns null', () => {
        const { liveList, incoming } = pair()
        incoming[2].chaId = 'other'
        expect(reconcileCharacters(liveList, incoming)).toBeNull()
        const missing = pair()
        delete missing.incoming[0].chaId
        expect(reconcileCharacters(missing.liveList, missing.incoming)).toBeNull()
        const empty = pair()
        empty.incoming[1].chaId = ''
        expect(reconcileCharacters(empty.liveList, empty.incoming)).toBeNull()
        const liveEmpty = live([{ ...character('a'), chaId: '' }])
        expect(reconcileCharacters(liveEmpty, [{ ...bridgeCopy('a'), chaId: '' }])).toBeNull()
    })

    test('the same array, a non-array and nothing kept return null', () => {
        const { liveList, incoming } = pair()
        expect(reconcileCharacters(liveList, liveList)).toBeNull()
        expect(reconcileCharacters(liveList, undefined)).toBeNull()
        expect(reconcileCharacters(undefined, incoming)).toBeNull()
        expect(reconcileCharacters(liveList, null)).toBeNull()
        incoming.forEach((element, i) => {
            element.desc = `edited ${i}`
        })
        expect(reconcileCharacters(liveList, incoming)).toBeNull()
    })

    test('M11 an exception while comparing returns null instead of a partial result', () => {
        const { liveList, incoming } = pair()
        Object.defineProperty(incoming[1], 'desc', {
            enumerable: true,
            get() {
                throw new Error('getter fault')
            },
        })
        expect(reconcileCharacters(liveList, incoming)).toBeNull()
    })

    test('M12 an unchanged deep character is kept: the depth cap does not reject ordinary nesting', () => {
        const { liveList, incoming } = pair()
        expect(reconcileCharacters(liveList, incoming)!.keptSlots.size).toBe(3)
    })

    test('guard: reading never writes to either list or any element', () => {
        const { liveList, incoming } = pair()
        const before = JSON.stringify([$state.snapshot(liveList), incoming])
        const liveCopy = [...liveList]
        const incomingCopy = [...incoming]
        reconcileCharacters(liveList, incoming)
        expect(JSON.stringify([$state.snapshot(liveList), incoming])).toBe(before)
        expect(liveList.every((element, i) => element === liveCopy[i])).toBe(true)
        expect(incoming.every((element, i) => element === incomingCopy[i])).toBe(true)
    })
})

type Container = Record<string, unknown>

interface Node {
    parent: Container | null
    key: string
    value: unknown
    parentIsArray: boolean
}

function collect(incoming: unknown, liveValue: unknown, parent: Container | null, key: string, out: Node[]): void {
    const isObject = typeof incoming === 'object' && incoming !== null
    if (isObject && incoming === liveValue) {
        return
    }
    out.push({ parent, key, value: incoming, parentIsArray: Array.isArray(parent) })
    if (!isObject) {
        return
    }
    const here = incoming as Container
    const there = (typeof liveValue === 'object' && liveValue !== null ? liveValue : {}) as Container
    for (const child of Object.keys(here)) {
        collect(here[child], there[child], here, child, out)
    }
}

type Mutation = (nodes: Node[], rng: () => number) => boolean

function choose<T>(items: T[], rng: () => number): T {
    return items[Math.floor(rng() * items.length)]
}

function onLeaf(accept: (value: unknown) => boolean, apply: (node: Node & { parent: Container }, rng: () => number) => void): Mutation {
    return (nodes, rng) => {
        const candidates = nodes.filter((n): n is Node & { parent: Container } => n.parent !== null && accept(n.value))
        if (candidates.length === 0) {
            return false
        }
        apply(choose(candidates, rng), rng)
        return true
    }
}

const isString = (v: unknown): boolean => typeof v === 'string'
const isNumber = (v: unknown): boolean => typeof v === 'number'
const isPrimitiveLeaf = (v: unknown): boolean => v !== null && typeof v !== 'object' && v !== undefined

function arrays(nodes: Node[]): Node[] {
    return nodes.filter((n) => Array.isArray(n.value) && (n.value as unknown[]).length > 0)
}

const MUTATIONS: Record<string, Mutation> = {
    string: onLeaf(isString, (n) => { n.parent[n.key] = `${n.value as string}x` }),
    number: onLeaf(isNumber, (n) => { n.parent[n.key] = (n.value as number) + 1 }),
    negativeZero: onLeaf((v) => Object.is(v, 0), (n) => { n.parent[n.key] = -0 }),
    nan: onLeaf(isNumber, (n) => { n.parent[n.key] = NaN }),
    boolean: onLeaf((v) => typeof v === 'boolean', (n) => { n.parent[n.key] = !(n.value as boolean) }),
    toNull: onLeaf(isPrimitiveLeaf, (n) => { n.parent[n.key] = null }),
    boxed: onLeaf(isPrimitiveLeaf, (n) => {
        const v = n.value
        n.parent[n.key] = typeof v === 'string' ? new String(v) : typeof v === 'number' ? new Number(v) : new Boolean(v as boolean)
    }),
    toJSON: onLeaf(isPrimitiveLeaf, (n) => {
        const v = n.value
        n.parent[n.key] = { toJSON: () => v }
    }),
    date: (nodes) => {
        const target = nodes.find((n) => n.key === 'created' && n.parent !== null)
        if (!target?.parent) {
            return false
        }
        target.parent[target.key] = new Date(target.value as string)
        return true
    },
    boxedType: (nodes) => {
        const root = nodes[0].value as Container
        root.type = new String(root.type as string)
        return true
    },
    boxedTag: (nodes) => {
        const tags = (nodes[0].value as Container).tags as unknown[]
        tags[0] = new String(tags[0] as string)
        return true
    },
    deleteKey: (nodes, rng) => {
        const candidates = nodes.filter((n) => n.parent !== null && !n.parentIsArray)
        if (candidates.length === 0) {
            return false
        }
        const n = choose(candidates, rng)
        delete n.parent![n.key]
        return true
    },
    addKey: (nodes, rng) => {
        const candidates = nodes.filter((n) => typeof n.value === 'object' && n.value !== null && !Array.isArray(n.value))
        const n = choose(candidates, rng)
        ;(n.value as Container).addedKey = 1
        return true
    },
    undefinedValue: (nodes, rng) => {
        const candidates = nodes.filter((n) => n.parent !== null && !n.parentIsArray && n.value !== undefined)
        const n = choose(candidates, rng)
        n.parent![n.key] = undefined
        return true
    },
    push: (nodes, rng) => {
        const list = choose(nodes.filter((n) => Array.isArray(n.value)), rng).value as unknown[]
        list.push(1)
        return true
    },
    pop: (nodes, rng) => {
        const candidates = arrays(nodes)
        if (candidates.length === 0) {
            return false
        }
        ;(choose(candidates, rng).value as unknown[]).pop()
        return true
    },
    splice: (nodes, rng) => {
        const list = choose(nodes.filter((n) => Array.isArray(n.value)), rng).value as unknown[]
        list.splice(Math.floor(rng() * (list.length + 1)), 0, 'inserted')
        return true
    },
    swap: (nodes, rng) => {
        const candidates = arrays(nodes).filter((n) => {
            const list = n.value as unknown[]
            return list.some((item) => JSON.stringify(item) !== JSON.stringify(list[0]))
        })
        if (candidates.length === 0) {
            return false
        }
        const list = choose(candidates, rng).value as unknown[]
        const j = list.findIndex((item) => JSON.stringify(item) !== JSON.stringify(list[0]))
        ;[list[0], list[j]] = [list[j], list[0]]
        return true
    },
    hole: (nodes, rng) => {
        const candidates = arrays(nodes)
        if (candidates.length === 0) {
            return false
        }
        const list = choose(candidates, rng).value as unknown[]
        delete list[Math.floor(rng() * list.length)]
        return true
    },
}

const ALL_MUTATION_NAMES = Object.keys(MUTATIONS)
// A holey array reaches `keepLiveAlt` only before it runs, where its path walk would throw; holes are drawn after it.
const REALISTIC_MUTATION_NAMES = ALL_MUTATION_NAMES.filter((name) => name !== 'hole')

describe('oracle: every random mutation is judged different', () => {
    function runOracle(mode: 'realistic' | 'adversarial', iterations: number): Record<string, number> {
        const rng = mulberry32(SEED + (mode === 'realistic' ? 1 : 2))
        const applied: Record<string, number> = {}
        for (let i = 0; i < iterations; i++) {
            const liveList = live([character('a')])
            const incoming = [bridgeCopy('a')]
            const where = `seed=${SEED} mode=${mode} iteration=${i}`
            if (mode === 'adversarial') {
                keepLiveAlt(liveList, incoming)
                if (rng() < 0.5) {
                    for (const chatEntry of incoming[0].chats as Entry[]) {
                        if (chatEntry.alt !== undefined) {
                            chatEntry.alt = structuredClone($state.snapshot(chatEntry.alt))
                        }
                    }
                }
            }
            const nodes: Node[] = []
            collect(incoming[0], liveList[0], null, '', nodes)
            let kind = ''
            for (let attempt = 0; attempt < 40; attempt++) {
                const name = choose(mode === 'realistic' ? REALISTIC_MUTATION_NAMES : ALL_MUTATION_NAMES, rng)
                if (MUTATIONS[name](nodes, rng)) {
                    kind = name
                    break
                }
            }
            expect(kind, `no mutation applied: ${where}`).not.toBe('')
            applied[kind] = (applied[kind] ?? 0) + 1
            if (mode === 'realistic') {
                keepLiveAlt(liveList, incoming)
            }
            expect(sameStoredValue(incoming[0], liveList[0]), `${where} kind=${kind}`).toBe(false)
        }
        return applied
    }

    test('O1 realistic: mutate the bridge copy, then keepLiveAlt', () => {
        const applied = runOracle('realistic', 2000)
        for (const name of REALISTIC_MUTATION_NAMES) {
            expect(applied[name] ?? 0, `seed=${SEED} kind ${name} never applied`).toBeGreaterThan(0)
        }
    })

    test('O1 adversarial: mutate after keepLiveAlt, with the live alt kept or replaced by an edited unshared copy', () => {
        const applied = runOracle('adversarial', 2000)
        for (const name of ALL_MUTATION_NAMES) {
            expect(applied[name] ?? 0, `seed=${SEED} kind ${name} never applied`).toBeGreaterThan(0)
        }
    })

    test('O1 soundness: an unmutated equal answer always matches the plain JSON trees', () => {
        const rng = mulberry32(SEED + 3)
        for (let i = 0; i < 200; i++) {
            const liveList = live([character('a')])
            const incoming = [rng() < 0.5 ? (reverseKeys(bridgeCopy('a')) as Entry) : bridgeCopy('a')]
            keepLiveAlt(liveList, incoming)
            const same = sameStoredValue(incoming[0], liveList[0])
            expect(same, `seed=${SEED} iteration=${i}`).toBe(true)
            expect(sameJsonValue(toPlainJson(incoming[0]), toPlainJson($state.snapshot(liveList[0]))), `seed=${SEED} iteration=${i}`).toBe(true)
        }
    })
})
