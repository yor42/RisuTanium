// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { JsonObject, JsonValue } from '../../blockFrame'
import {
    classifyCharacter, classifyCharacterOrder, classifyConfig, classifyMembership, classifyMovedFields, classifyTrash, mergeStatics,
    type Member,
} from '../../store2/fastForward/delta'
import type { ShardEntry } from '../../store2/format'
import { mulberry32 } from './codecFixtures'

/**
 * The reference is written here from the product rules (MC-1963/1965/1968/1970), independent of the module under
 * test: it imports nothing from `fastForward/` but the functions it checks, and compares values through a canonical
 * string of its own.
 */

type Value = JsonValue | undefined

function canon(value: Value): string {
    if (value === undefined) {
        return 'undefined'
    }
    if (Array.isArray(value)) {
        return `[${value.map(canon).join(',')}]`
    }
    if (typeof value === 'object' && value !== null) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canon(value[key])}`).join(',')}}`
    }
    return JSON.stringify(value)
}

type Outcome = { kind: 'keep' } | { kind: 'take', value: string } | { kind: 'park' }

/** The three-way answer for one value. */
function reference(base: Value, mine: Value, theirs: Value): Outcome {
    const b = canon(base)
    const m = canon(mine)
    const t = canon(theirs)
    if (t === b) {
        return { kind: 'keep' }
    }
    if (m === b) {
        return { kind: 'take', value: t }
    }
    return m === t ? { kind: 'keep' } : { kind: 'park' }
}

const POOL: Value[] = [undefined, 0, 1, 2, 'a', 'b', true, null, [1], [1, 2], { x: 1 }, { x: 2 }, { x: 1, y: 2 }]

function pick<T>(rng: () => number, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)]
}

function objectOf(entries: [string, Value][]): JsonObject {
    const out: JsonObject = {}
    for (const [name, value] of entries) {
        if (value !== undefined) {
            out[name] = value
        }
    }
    return out
}

describe('guard (S0-1): config fields', () => {
    test('every field of a random triple follows the three-way reference; skipped fields are left to their record', () => {
        const rng = mulberry32(11)
        for (let round = 0; round < 300; round++) {
            const names = ['f1', 'f2', 'f3', 'f4', 'skipped']
            const base = objectOf(names.map(name => [name, pick(rng, POOL)]))
            const mine = objectOf(names.map(name => [name, rng() < 0.5 ? base[name] : pick(rng, POOL)]))
            const theirs = objectOf(names.map(name => [name, rng() < 0.5 ? base[name] : pick(rng, POOL)]))
            const decided = classifyConfig(base, mine, theirs, new Set(['skipped']))
            const take = new Map<string, Value>()
            const park: string[] = []
            for (const name of names.filter(item => item !== 'skipped')) {
                const outcome = reference(base[name], mine[name], theirs[name])
                if (outcome.kind === 'take') {
                    take.set(name, theirs[name])
                } else if (outcome.kind === 'park') {
                    park.push(name)
                }
            }
            expect([...decided.take.keys()].sort(), `round ${round}`).toEqual([...take.keys()].sort())
            for (const [name, value] of take) {
                expect(canon(decided.take.get(name)), `round ${round} ${name}`).toBe(canon(value))
            }
            expect([...decided.park].sort(), `round ${round}`).toEqual(park.sort())
        }
    })

    test('a removed field is taken as removed, and a field both sides added alike is kept', () => {
        const decided = classifyConfig({ gone: 1 }, { gone: 1 }, { added: 5 })
        expect(decided.take.has('gone')).toBe(true)
        expect(decided.take.get('gone')).toBeUndefined()
        expect(decided.take.get('added')).toBe(5)
        const same = classifyConfig({}, { a: 1 }, { a: 1 })
        expect(same.take.size).toBe(0)
        expect(same.park).toEqual([])
    })
})

describe('guard (S0-1): statics', () => {
    test('a key theirs changed while this page did not is theirs; the reverse is mine', () => {
        expect(mergeStatics({ n: 1 }, { n: 1 }, { n: 4 })).toEqual({ kind: 'take', value: { n: 4 } })
        expect(mergeStatics({ n: 1 }, { n: 4 }, { n: 1 })).toEqual({ kind: 'keep' })
    })

    test('a numeric key both sides changed is the peer value plus this page\'s change since the base', () => {
        expect(mergeStatics({ n: 10 }, { n: 13 }, { n: 15 })).toEqual({ kind: 'merge', value: { n: 18 } })
        expect(mergeStatics({ n: 10 }, { n: 7 }, { n: 15 })).toEqual({ kind: 'merge', value: { n: 12 } })
    })

    test('random numeric counters follow theirs + (mine - base) per key', () => {
        const rng = mulberry32(21)
        for (let round = 0; round < 200; round++) {
            const keys = ['a', 'b', 'c']
            const base = objectOf(keys.map(key => [key, rng() < 0.2 ? undefined : Math.floor(rng() * 20)]))
            const mine = objectOf(keys.map(key => [key, rng() < 0.4 ? base[key] : Math.floor(rng() * 20)]))
            const theirs = objectOf(keys.map(key => [key, rng() < 0.4 ? base[key] : Math.floor(rng() * 20)]))
            const expected: JsonObject = {}
            for (const key of keys) {
                const outcome = reference(base[key], mine[key], theirs[key])
                let value: Value
                if (outcome.kind === 'keep') {
                    value = mine[key]
                } else if (outcome.kind === 'take') {
                    value = theirs[key]
                } else {
                    value = Number(theirs[key] ?? 0) + (Number(mine[key] ?? 0) - Number(base[key] ?? 0))
                }
                if (value !== undefined) {
                    expected[key] = value
                }
            }
            const decided = mergeStatics(base, mine, theirs)
            const result = decided.kind === 'keep' ? mine : decided.kind === 'park' ? null : decided.value
            expect(canon(result as Value), `round ${round}`).toBe(canon(expected))
            if (canon(expected) === canon(mine)) {
                expect(decided.kind).toBe('keep')
            } else if (canon(expected) === canon(theirs)) {
                expect(decided.kind).toBe('take')
            } else {
                expect(decided.kind).toBe('merge')
            }
        }
    })

    test('a non-numeric key both sides changed parks; a non-object value falls back to the whole-value rule', () => {
        expect(mergeStatics({ s: 'a' }, { s: 'b' }, { s: 'c' }).kind).toBe('park')
        expect(mergeStatics({ s: 'a', n: 1 }, { s: 'b', n: 2 }, { s: 'a', n: 3 })).toEqual({ kind: 'merge', value: { s: 'b', n: 4 } })
        expect(mergeStatics(undefined, undefined, { n: 1 })).toEqual({ kind: 'take', value: { n: 1 } })
        expect(mergeStatics(3, 4, 5).kind).toBe('park')
    })
})

describe('guard (S0-1): moved fields', () => {
    const VALUES = [undefined, 1, 2, 3]

    test('lastInteraction is the maximum once theirs changed it', () => {
        for (const base of VALUES) {
            for (const mine of VALUES) {
                for (const theirs of VALUES) {
                    const decided = classifyMovedFields({ lastInteraction: base }, { lastInteraction: mine }, { lastInteraction: theirs }, { inUse: false, replyOwner: false }).lastInteraction
                    if (theirs === base) {
                        expect(decided).toEqual({ kind: 'keep' })
                        continue
                    }
                    const max = mine === undefined ? theirs : theirs === undefined ? mine : Math.max(mine, theirs)
                    const result = decided.kind === 'keep' ? mine : decided.kind === 'take' ? decided.value : 'invalid'
                    expect(result, `${base}/${mine}/${theirs}`).toBe(max)
                }
            }
        }
    })

    test('trashTime is three-way, and a change on an open character parks', () => {
        for (const base of VALUES) {
            for (const mine of VALUES) {
                for (const theirs of VALUES) {
                    const outcome = reference(base, mine, theirs)
                    const free = classifyMovedFields({ trashTime: base }, { trashTime: mine }, { trashTime: theirs }, { inUse: false, replyOwner: false }).trashTime
                    expect(free.kind, `${base}/${mine}/${theirs}`).toBe(outcome.kind)
                    const open = classifyMovedFields({ trashTime: base }, { trashTime: mine }, { trashTime: theirs }, { inUse: true, replyOwner: false }).trashTime
                    expect(open.kind, `open ${base}/${mine}/${theirs}`).toBe(theirs === base ? 'keep' : 'park')
                }
            }
        }
    })

    test('chatPage: theirs only is taken (deferred on a reply owner); both changed keeps this page\'s', () => {
        for (const base of VALUES) {
            for (const mine of VALUES) {
                for (const theirs of VALUES) {
                    for (const replyOwner of [false, true]) {
                        const decided = classifyMovedFields({ chatPage: base }, { chatPage: mine }, { chatPage: theirs }, { inUse: false, replyOwner }).chatPage
                        if (theirs === base || mine !== base) {
                            expect(decided.kind, `${base}/${mine}/${theirs}`).toBe('keep')
                        } else {
                            expect(decided).toEqual({ kind: 'take', value: theirs, defer: replyOwner })
                        }
                    }
                }
            }
        }
    })

    test('firstMsgIndex is three-way and parks when both changed', () => {
        for (const base of VALUES) {
            for (const mine of VALUES) {
                for (const theirs of VALUES) {
                    const decided = classifyMovedFields({ firstMsgIndex: base }, { firstMsgIndex: mine }, { firstMsgIndex: theirs }, { inUse: false, replyOwner: false }).firstMsgIndex
                    expect(decided.kind, `${base}/${mine}/${theirs}`).toBe(reference(base, mine, theirs).kind)
                }
            }
        }
    })
})

function ref(key: string): [string, number, number] {
    return [key, 10, 20]
}

function entryOf(u: string, overrides: Partial<ShardEntry> = {}): ShardEntry {
    return {
        u, type: 'character', name: `name ${u}`, chaId: `cha-${u}`, creatorNotes: '', chatPage: 0, firstMsgIndex: -1,
        core: ref(`core-${u}`), lore: null, scripts: null, al: [`al-${u}`, 1, 2, 1], il: null, dsp: true,
        chats: [{ cid: 'c1', core: ref(`chat-${u}`), chunks: [[`chunk-${u}`, 1, 2, 3]] }],
        ...overrides,
    }
}

describe('guard (S0-1): characters', () => {
    const base = entryOf('u1', { lastInteraction: 5 })
    const input = (over: Partial<Parameters<typeof classifyCharacter>[0]> = {}): Parameters<typeof classifyCharacter>[0] => ({
        base, theirs: base, bodyClean: true, inUse: false, replyOwner: false, shared: false, resident: false, mine: { lastInteraction: 5, chatPage: 0, firstMsgIndex: -1 }, ...over,
    })

    test('nothing changed is keep', () => {
        expect(classifyCharacter(input())).toEqual({ kind: 'keep' })
    })

    test('a body the peer changed, with a clean body here, is an install with the merged moved fields', () => {
        const theirs = entryOf('u1', { lastInteraction: 9, core: ref('core-new') })
        const decided = classifyCharacter(input({ theirs }))
        expect(decided.kind).toBe('install')
        if (decided.kind === 'install') {
            expect(decided.moved.lastInteraction).toEqual({ kind: 'take', value: 9 })
        }
    })

    test('each blocker of an install parks, and each is needed', () => {
        const theirs = entryOf('u1', { lastInteraction: 5, core: ref('core-new') })
        expect(classifyCharacter(input({ theirs, inUse: true }))).toEqual({ kind: 'park', reason: 'in-use' })
        expect(classifyCharacter(input({ theirs, bodyClean: false }))).toEqual({ kind: 'park', reason: 'body-dirty' })
        expect(classifyCharacter(input({ theirs, resident: true }))).toEqual({ kind: 'park', reason: 'resident-id' })
        expect(classifyCharacter(input({ theirs, shared: true }))).toEqual({ kind: 'park', reason: 'shared-id' })
        expect(classifyCharacter(input({ theirs, base: null }))).toEqual({ kind: 'park', reason: 'no-entry' })
        expect(classifyCharacter(input({ theirs: null }))).toEqual({ kind: 'park', reason: 'no-entry' })
        expect(classifyCharacter(input({ theirs, mine: { lastInteraction: 5, chatPage: 3, firstMsgIndex: -1 } }))).toEqual({ kind: 'park', reason: 'unsaved-view' })
        expect(classifyCharacter(input({ theirs, mine: { lastInteraction: 5, chatPage: 0, firstMsgIndex: 2 } }))).toEqual({ kind: 'park', reason: 'unsaved-view' })
    })

    test('a unit that moved inside a chat, or a new alternative, is a body change', () => {
        const chunk = entryOf('u1', { lastInteraction: 5, chats: [{ cid: 'c1', core: ref('chat-u1'), chunks: [['chunk-new', 1, 2, 3]] }] })
        expect(classifyCharacter(input({ theirs: chunk })).kind).toBe('install')
        const alt = entryOf('u1', { lastInteraction: 5, chats: [{ cid: 'c1', core: ref('chat-u1'), chunks: [['chunk-u1', 1, 2, 3]], alt: [['alt', 1, 2, 1]] }] })
        expect(classifyCharacter(input({ theirs: alt })).kind).toBe('install')
    })

    test('an entry-only change is field writes, with no swap, even when the body here is dirty or open', () => {
        const theirs = entryOf('u1', { lastInteraction: 9 })
        for (const flags of [{}, { bodyClean: false }, { inUse: true }]) {
            const decided = classifyCharacter(input({ theirs, ...flags }))
            expect(decided.kind).toBe('fields')
        }
    })

    test('a peer change to an entry field a pass rewrites from the character parks', () => {
        const theirs = entryOf('u1', { lastInteraction: 5, name: 'renamed' })
        expect(classifyCharacter(input({ theirs }))).toEqual({ kind: 'park', reason: 'entry-fields' })
    })

    test('a moved-field conflict inside an install parks', () => {
        const theirs = entryOf('u1', { lastInteraction: 5, core: ref('core-new'), firstMsgIndex: 4 })
        expect(classifyCharacter(input({ theirs, mine: { lastInteraction: 5, chatPage: 0, firstMsgIndex: -1 } })).kind).toBe('install')
        const baseMoved = entryOf('u1', { lastInteraction: 5, firstMsgIndex: -1 })
        const decided = classifyCharacter({ ...input({ theirs, base: baseMoved }), mine: { lastInteraction: 5, chatPage: 0, firstMsgIndex: 7 } })
        expect(decided.kind).toBe('park')
    })
})

describe('guard (S0-1): membership', () => {
    const member = (chaId: string, u = `u-${chaId}`): Member => ({ chaId, u })
    const base = [member('a'), member('b'), member('c')]
    const none = (): boolean => false

    test('theirs unchanged keeps whatever this page did', () => {
        expect(classifyMembership(base, [member('a')], base, none)).toEqual({ kind: 'keep' })
        expect(classifyMembership(base, [...base, member('z')], base, none)).toEqual({ kind: 'keep' })
    })

    test('theirs appended with new distinct ids, mine unchanged, is an append', () => {
        const decided = classifyMembership(base, base, [...base, member('d'), member('e')], none)
        expect(decided).toEqual({ kind: 'append', members: [member('d'), member('e')] })
    })

    test('every other shape of the peer\'s list parks', () => {
        const shapes: { label: string, theirs: Member[] }[] = [
            { label: 'a removal', theirs: [member('a'), member('c')] },
            { label: 'a reorder', theirs: [member('b'), member('a'), member('c'), member('d')] },
            { label: 'a re-minted u', theirs: [member('a'), member('b', 'u-other'), member('c'), member('d')] },
            { label: 'a re-minted u alone', theirs: [member('a', 'u-other'), member('b'), member('c')] },
            { label: 'an appended id the base holds', theirs: [...base, member('a', 'u-second')] },
            { label: 'a repeated appended id', theirs: [...base, member('d'), member('d', 'u-second')] },
            { label: 'an insertion in the middle', theirs: [member('a'), member('d'), member('b'), member('c')] },
        ]
        for (const shape of shapes) {
            expect(classifyMembership(base, base, shape.theirs, none).kind, shape.label).toBe('park')
        }
    })

    test('this page having changed its membership parks an appended peer list', () => {
        expect(classifyMembership(base, [member('a'), member('b')], [...base, member('d')], none).kind).toBe('park')
        expect(classifyMembership(base, [...base, member('z')], [...base, member('d')], none).kind).toBe('park')
    })

    test('an appended id the residency test makes resident parks', () => {
        expect(classifyMembership(base, base, [...base, member('d')], chaId => chaId === 'd')).toEqual({ kind: 'park', reason: 'resident-id' })
        expect(classifyMembership(base, base, [...base, member('d'), member('e')], chaId => chaId === 'e').kind).toBe('park')
    })
})

describe('guard (S0-1): characterOrder and the trash compound', () => {
    test('characterOrder follows its own three-way', () => {
        const rng = mulberry32(31)
        for (let round = 0; round < 100; round++) {
            const base = pick(rng, POOL)
            const mine = rng() < 0.5 ? base : pick(rng, POOL)
            const theirs = rng() < 0.5 ? base : pick(rng, POOL)
            expect(classifyCharacterOrder(base, mine, theirs).kind, `round ${round}`).toBe(reference(base, mine, theirs).kind)
        }
    })

    test('a peer trash merges with an unsaved edit here: each part follows its own rule', () => {
        const decided = classifyTrash({
            base: { trashTime: undefined, trashOrigins: { a: 1 }, characterOrder: ['x', 'y'] },
            mine: { trashTime: undefined, trashOrigins: { a: 1 }, characterOrder: ['x', 'y'] },
            theirs: { trashTime: 500, trashOrigins: { a: 1, y: 2 }, characterOrder: ['x'] },
            inUse: false,
        })
        expect(decided.trashTime).toEqual({ kind: 'take', value: 500 })
        expect(decided.trashOrigins).toEqual({ kind: 'take', value: { a: 1, y: 2 } })
        expect(decided.characterOrder).toEqual({ kind: 'take', value: ['x'] })
    })

    test('a trash here against an append there parks the order only', () => {
        const decided = classifyTrash({
            base: { trashTime: undefined, trashOrigins: {}, characterOrder: ['x', 'y'] },
            mine: { trashTime: 9, trashOrigins: { y: 1 }, characterOrder: ['x'] },
            theirs: { trashTime: undefined, trashOrigins: {}, characterOrder: ['x', 'y', 'z'] },
            inUse: false,
        })
        expect(decided.trashTime.kind).toBe('keep')
        expect(decided.trashOrigins.kind).toBe('keep')
        expect(decided.characterOrder.kind).toBe('park')
    })

    test('a peer trash of an open character parks its trashTime', () => {
        const decided = classifyTrash({
            base: { trashTime: undefined, trashOrigins: {}, characterOrder: [] },
            mine: { trashTime: undefined, trashOrigins: {}, characterOrder: [] },
            theirs: { trashTime: 5, trashOrigins: {}, characterOrder: [] },
            inUse: true,
        })
        expect(decided.trashTime).toEqual({ kind: 'park', reason: 'trash-in-use' })
    })
})
