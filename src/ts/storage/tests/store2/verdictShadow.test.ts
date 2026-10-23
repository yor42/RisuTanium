// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

import { proxy } from 'svelte/internal/client'
import type { JsonObject } from '../../blockFrame'
import type { Committer } from '../../store2/commit'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import {
    assembleDatabase, characterMatchesAcknowledged, characterMatchesAcknowledgedPlain, CodecInputError, normalizeCharacter,
    normalizeCharacterFromPlain, plainObject, previousFrom, StubRefusedError, stubFromEntry, unitMapSource, verdictBaseOf,
    type ListDerivation, type PreviousEncoding,
} from '../../store2/codec'
import type { ShardEntry } from '../../store2/format'
import { hydrateEntityDigests, previousOfTree } from '../../store2/previousOfTree'
import { createSaveEncoder, SHADOW_CHARACTER_CAP, SHADOW_TOTAL_BUDGET, shadowChargeOf, type SaveEncoder } from '../../store2/saveEncoder'
import {
    noteNetSlotBegin, noteNetSlotMs, startSavePass, type SavePassMeterHandle,
} from '../../store2/savePassMeter'
import { runStore2SaveLoop, type Store2LoopPort } from '../../store2/saveLoop'
import type { character, Database } from '../../database.svelte'
import type { toSaveType } from '../../risuSave'
import { until } from '../saveLoopWorld'
import { startStore2, type Store2Kit } from '../store2SaveKit'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The value shadow of the idle net's verdict (`SaveEncoder.verdictOf`, CHORE-205 stage 2b). Titles starting `reproducer`
 * fail on the base before the shadow; every other test is either a guard whose killer is a mutant of the shadow, named in
 * the hand-back, or a compatibility guard (for example the D2 split-equality test) that passes before and after the
 * shadow and has no killing mutant.
 */

const NOW = 1_700_000_000_000

type MeterGlobal = { __risuSavePassMeter?: SavePassMeterHandle }

beforeEach(() => {
    flag.measure = true
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (globalThis as MeterGlobal).__risuSavePassMeter
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

function asCharacter(slot: Obj): character {
    return slot as unknown as character
}

/** A list derivation that counts the character derivations it is asked for; with `fault.on` its answer differs from the acknowledged one. */
function countingLists(): { lists: ListDerivation, calls: { characters: number }, fault: { on: boolean } } {
    const calls = { characters: 0 }
    const fault = { on: false }
    const lists: ListDerivation = {
        ...fakeLists,
        characterAssets: (owner) => {
            calls.characters += 1
            const base = fakeLists.characterAssets(owner)
            return fault.on ? { ...base, l: [...base.l, 'a-name-the-acknowledged-list-lacks'] } : base
        },
    }
    return { lists, calls, fault }
}

/**
 * Eight characters: 0 plain, 1 and 2 stamped with both moved fields, 3 a group, 4 and 5 sharing one id, 6 plain, 7 plain.
 * Built before the first encode, so the acknowledged encoding holds the shared id's handle `#1`.
 */
function fixtureDb(count = 8): Obj {
    const db = clone(buildSmall(count)) as unknown as Obj
    const slots = db.characters as Obj[]
    if (count >= 8) {
        Object.assign(slots[1], { lastInteraction: 1000, trashTime: 2000 })
        Object.assign(slots[2], { lastInteraction: 3000, trashTime: 4000 })
        Object.assign(slots[3], { type: 'group', chaId: 'group-one', name: 'Group One', characters: ['m1', 'm2'], characterTalks: [0.5, 0.5], characterActive: [true, true] })
        slots[5].chaId = slots[4].chaId
        db.characterOrder = slots.map(slot => slot.chaId)
    }
    return db
}

const TARGETS = [0, 1, 2, 3, 6]
const SHARED = [4, 5]

interface Fixture {
    db: Obj
    previous: PreviousEncoding
    counting: ReturnType<typeof countingLists>
    encoder: SaveEncoder
    live(): Obj[]
    entries: ShardEntry[]
}

function fixtureFrom(db: Obj): Fixture {
    const first = encodeWith(asDatabase(db))
    const previous = previousFrom(first)
    const counting = countingLists()
    return {
        db,
        previous,
        counting,
        encoder: createSaveEncoder({ previous, lists: counting.lists, env: seededEnv(5), now: () => NOW }),
        live: () => clone(assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as Obj[]),
        entries: (previous.objects?.shards ?? []).flatMap(shard => shard.entries),
    }
}

function fixture(): Fixture {
    return fixtureFrom(fixtureDb())
}

/** What a shadow-free encoder says about the slot as it stands: the primitive and the moved-field compare, nothing remembered. */
function freshVerdict(f: Fixture, slot: Obj): ReturnType<SaveEncoder['verdictOf']> {
    return createSaveEncoder({ previous: f.previous, lists: fakeLists, env: seededEnv(5), now: () => NOW }).verdictOf(asCharacter(slot))
}

function withCharacters(db: Obj, characters: Obj[]): Database {
    return asDatabase({ ...clone(db), characters })
}

async function fullPassUnchanged(f: Fixture, characters: Obj[], chaId: string): Promise<boolean> {
    const encoder = createSaveEncoder({ previous: f.previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
    const plan = await encoder.plan(withCharacters(f.db, characters), { marked: new Set([chaId]), modules: false, whole: false })
    return plan.unchanged
}

/** Plans and acknowledges a pass naming `chaId`, so the encoder's acknowledged encoding is replaced. */
async function commitPass(f: Fixture, characters: Obj[], chaId: string): Promise<void> {
    const plan = await f.encoder.plan(withCharacters(f.db, characters), { marked: new Set([chaId]), modules: false, whole: false })
    const { mint } = createKeyMint(seededEnv(900), null)
    const context: BuildContext = { mint, seq: 2, now: NOW }
    await plan.commitRequest().build(context)
    plan.acknowledge()
}

describe('an unchanged resident is not derived again', () => {
    test('reproducer: the second visit of an unchanged resident derives no list and is still clean', () => {
        const f = fixture()
        const slot = f.live()[0]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        const afterFirst = f.counting.calls.characters
        expect(afterFirst).toBeGreaterThan(0)
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        expect(f.counting.calls.characters).toBe(afterFirst)
        // A character that is edited is judged again, not answered from the shadow.
        slot.personality = 'edited between visits'
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('dirty')
    })

    test('a fresh read of an equal character is a hit too: the shadow is a value, not an identity', () => {
        const f = fixture()
        expect(f.encoder.verdictOf(asCharacter(f.live()[0]))).toBe('clean')
        const afterFirst = f.counting.calls.characters
        expect(f.encoder.verdictOf(asCharacter(f.live()[0]))).toBe('clean')
        expect(f.counting.calls.characters).toBe(afterFirst)
        expect(f.encoder.shadowStats().entries).toBe(1)
    })

    test('each resident has its own shadow: visiting another one leaves the first a hit', () => {
        const f = fixture()
        const characters = f.live()
        for (const index of [0, 1, 6]) {
            expect(f.encoder.verdictOf(asCharacter(characters[index]))).toBe('clean')
        }
        expect(f.encoder.shadowStats().entries).toBe(3)
        const derived = f.counting.calls.characters
        for (const index of [6, 0, 1]) {
            expect(f.encoder.verdictOf(asCharacter(characters[index]))).toBe('clean')
        }
        expect(f.counting.calls.characters).toBe(derived)
    })
})

interface Mutation {
    label: string
    /** Returns false when the character has nothing to change. */
    apply(slot: Obj): boolean
}

const MUTATIONS: Mutation[] = [
    { label: 'name', apply: (slot) => { slot.name = `${String(slot.name)} edited`; return true } },
    { label: 'image', apply: (slot) => { slot.image = 'assets/an-image.png'; return true } },
    { label: 'creatorNotes', apply: (slot) => { slot.creatorNotes = 'other notes'; return true } },
    { label: 'tags', apply: (slot) => { slot.tags = ['other']; return slot.type !== 'group' } },
    { label: 'creator', apply: (slot) => { slot.creator = 'someone else'; return slot.type !== 'group' } },
    { label: 'a group\'s members', apply: (slot) => { if (slot.type !== 'group') { return false } (slot.characters as string[]).push('m3'); return true } },
    { label: 'chatPage', apply: (slot) => { slot.chatPage = 2; return true } },
    { label: 'firstMsgIndex', apply: (slot) => { slot.firstMsgIndex = 3; return true } },
    { label: 'lastInteraction set or changed', apply: (slot) => { slot.lastInteraction = typeof slot.lastInteraction === 'number' ? slot.lastInteraction + 1 : 77; return true } },
    { label: 'lastInteraction removed', apply: (slot) => { const had = 'lastInteraction' in slot; delete slot.lastInteraction; return had } },
    { label: 'lastInteraction made unmovable', apply: (slot) => { slot.lastInteraction = 'soon'; return true } },
    { label: 'trashTime set or changed', apply: (slot) => { slot.trashTime = typeof slot.trashTime === 'number' ? slot.trashTime + 1 : 88; return true } },
    { label: 'trashTime removed', apply: (slot) => { const had = 'trashTime' in slot; delete slot.trashTime; return had } },
    { label: 'trashTime made unmovable', apply: (slot) => { slot.trashTime = 'later'; return true } },
    { label: 'type', apply: (slot) => { slot.type = slot.type === 'group' ? 'character' : 'group'; return true } },
    { label: 'chaId', apply: (slot) => { slot.chaId = 'another-id'; return true } },
    { label: 'core unit', apply: (slot) => { slot.personality = 'edited personality'; return true } },
    { label: 'lore unit', apply: (slot) => { ((slot.globalLore as Obj[])[0]).content = 'edited lore'; return true } },
    { label: 'scripts unit', apply: (slot) => { (slot.customscript as unknown[]).push({ comment: 'new', in: 'a', out: 'b', type: 'editinput' }); return true } },
    { label: 'asset list unit', apply: (slot) => { slot.additionalAssets = [['extra', `assets/${'b'.repeat(64)}.PNG`, 'png']]; return true } },
    { label: 'inlay list unit', apply: (slot) => { slot.chats = (slot.chats as Obj[]).map((chat, index) => (index === 1 ? { ...chat, message: [{ role: 'char', data: '{{inlay::0123abcd-0123-4123-a123-0123456789ab}}', time: 1 }] } : chat)); return true } },
    { label: 'chat core unit', apply: (slot) => { (slot.chats as Obj[])[1].note = 'a note'; return true } },
    { label: 'chat chunk unit', apply: (slot) => { (((slot.chats as Obj[])[0].message as Obj[])[0]).data = 'edited message'; return true } },
    { label: 'an added chat', apply: (slot) => { (slot.chats as Obj[]).push({ ...(slot.chats as Obj[])[1], id: 'added-chat', name: 'Added' }); return true } },
    { label: 'a removed chat', apply: (slot) => { (slot.chats as Obj[]).pop(); return true } },
    { label: 'a chat turned into a pointer', apply: (slot) => { (slot.chats as Obj[])[0].message = [{ role: 'char', data: 'COLDSTORAGEkey', time: 1 }]; return true } },
    { label: 'a key added', apply: (slot) => { slot.aBrandNewKey = 'value'; return true } },
    { label: 'a key removed', apply: (slot) => { const had = 'personality' in slot; delete slot.personality; return had } },
    { label: 'chats reordered', apply: (slot) => { (slot.chats as Obj[]).reverse(); return true } },
    { label: 'an equal string replacing a string', apply: (slot) => { slot.name = [...String(slot.name)].join(''); return true } },
    { label: 'undefined where the key is absent', apply: (slot) => { slot.neverSetBefore = undefined; return true } },
    { label: 'undefined replacing a present key', apply: (slot) => { slot.personality = undefined; return true } },
    { label: 'minus zero over zero', apply: (slot) => { slot.chatPage = -0; return true } },
    { label: 'NaN over a number', apply: (slot) => { slot.chatPage = Number.NaN; return true } },
    { label: 'a toJSON giving another value', apply: (slot) => { slot.personality = { toJSON: () => 'a value from toJSON' }; return true } },
    { label: 'a toJSON giving the same value', apply: (slot) => { const same = slot.personality; slot.personality = { toJSON: () => same }; return true } },
    { label: 'the keys in another order', apply: (slot) => { for (const key of Object.keys(slot).reverse()) { const value = slot[key]; delete slot[key]; slot[key] = value } return true } },
    { label: 'a boxed type', apply: (slot) => { slot.type = new String(String(slot.type)); return true } },
    { label: 'a type with toJSON', apply: (slot) => { const type = slot.type; slot.type = { toJSON: () => type }; return true } },
    { label: 'a boxed group type', apply: (slot) => { slot.type = new String('group'); return true } },
]

describe('differential: the shadowed verdict equals the verdict of an encoder that remembers nothing', () => {
    for (const mode of ['plain object', 'Svelte proxy'] as const) {
        test(`every mutation of each target, edited in place on a ${mode}, gives the fresh verdict`, async () => {
            const f = fixture()
            let applied = 0
            let hitsAfterEdit = 0
            for (const index of TARGETS) {
                for (const mutation of MUTATIONS) {
                    const characters = f.live()
                    const subject = mode === 'Svelte proxy' ? proxy(characters[index]) : characters[index]
                    const encoder = createSaveEncoder({ previous: f.previous, lists: f.counting.lists, env: seededEnv(5), now: () => NOW })
                    expect(encoder.verdictOf(asCharacter(subject)), `character ${index} before ${mutation.label}`).toBe('clean')
                    expect(encoder.shadowStats().entries).toBe(1)
                    if (!mutation.apply(subject)) {
                        continue
                    }
                    applied++
                    const derived = f.counting.calls.characters
                    const verdict = encoder.verdictOf(asCharacter(subject))
                    hitsAfterEdit += f.counting.calls.characters === derived ? 1 : 0
                    const expected = freshVerdict(f, subject)
                    expect(verdict, `character ${index}: ${mutation.label}`).toBe(expected)
                    if (expected === 'clean') {
                        const edited = [...characters]
                        edited[index] = subject
                        expect(await fullPassUnchanged(f, edited, String(characters[index].chaId)), `character ${index}: ${mutation.label}`).toBe(true)
                    }
                }
            }
            expect(applied).toBeGreaterThan(TARGETS.length * (MUTATIONS.length - 12))
            // The edits that leave the value as it was are hits: the guard does not hide a shadow that never matches.
            expect(hitsAfterEdit).toBeGreaterThan(TARGETS.length)
        })
    }

    test('a shared id is unknown whether or not it was visited before, and nothing is held for it', () => {
        const f = fixture()
        const characters = f.live()
        for (const index of SHARED) {
            expect(f.encoder.verdictOf(asCharacter(characters[index])), `shared ${index}`).toBe('unknown')
            expect(f.encoder.verdictOf(asCharacter(characters[index])), `shared ${index}`).toBe('unknown')
        }
        expect(f.encoder.shadowStats().entries).toBe(0)
    })

    test('a boxed or toJSON type over an otherwise equal group is dirty, not a hit on the equal tree', () => {
        // `emitCharacter` reads `slot.type === 'group'` live: a boxed String is not 'group', so the entry would say 'character'.
        const f = fixture()
        for (const wrap of [(type: string) => new String(type), (type: string) => ({ toJSON: () => type })]) {
            const group = f.live()[3]
            expect(f.encoder.verdictOf(asCharacter(group))).toBe('clean')
            group.type = wrap('group')
            expect(f.encoder.verdictOf(asCharacter(group))).toBe('dirty')
            expect(freshVerdict(f, group)).toBe('dirty')
        }
    })

    test('a character that is dirty only by its moved fields stays dirty when its shadow is hit', () => {
        // The primitive leaves `lastInteraction` and `trashTime` to the stub overlay, so the shadow of such a character is
        // taken; the moved-field compare on the live slot is what answers `dirty` on every later visit.
        const f = fixture()
        for (const field of ['lastInteraction', 'trashTime']) {
            const slot = f.live()[0]
            slot[field] = 424242
            expect(f.encoder.verdictOf(asCharacter(slot)), field).toBe('dirty')
            expect(f.encoder.shadowStats().entries, field).toBe(1)
            const derived = f.counting.calls.characters
            expect(f.encoder.verdictOf(asCharacter(slot)), field).toBe('dirty')
            expect(f.counting.calls.characters, `${field}: the second visit is a hit`).toBe(derived)
            f.encoder.pruneShadows(new Set())
        }
    })

    test('a moved-field edit after a shadow is dirty on the next visit: the compare stays on the live slot', () => {
        const f = fixture()
        const slot = f.live()[1]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        for (const field of ['lastInteraction', 'trashTime']) {
            const original = slot[field]
            slot[field] = 123456
            expect(f.encoder.verdictOf(asCharacter(slot)), field).toBe('dirty')
            slot[field] = original
            expect(f.encoder.verdictOf(asCharacter(slot)), field).toBe('clean')
        }
    })
})

describe('D2: the pre-read entry point answers what the wrapper answers', () => {
    function plainVerdict(f: Fixture, slot: Obj): ReturnType<typeof characterMatchesAcknowledged> {
        const options = { env: seededEnv(5), lists: fakeLists, previous: f.previous }
        const base = verdictBaseOf(asCharacter(slot), f.previous)
        if (base === null) {
            return 'unknown'
        }
        let plain: JsonObject
        try {
            plain = plainObject(slot, 'characters[0]')
        } catch {
            return 'unknown'
        }
        return characterMatchesAcknowledgedPlain(asCharacter(slot), plain, base, options)
    }

    test('over every mutation of every target, the plain entry point and the wrapper agree', () => {
        const f = fixture()
        let compared = 0
        for (const index of [...TARGETS, ...SHARED, 7]) {
            for (const mutation of [{ label: 'unedited', apply: () => true }, ...MUTATIONS]) {
                const slot = f.live()[index]
                if (!mutation.apply(slot)) {
                    continue
                }
                const options = { env: seededEnv(5), lists: fakeLists, previous: f.previous }
                expect(plainVerdict(f, slot), `character ${index}: ${mutation.label}`).toBe(characterMatchesAcknowledged(asCharacter(slot), options))
                compared++
            }
        }
        expect(compared).toBeGreaterThan(200)
    })

    interface FaultCase {
        label: string
        make(): Obj
    }

    const FAULTS: FaultCase[] = [
        { label: 'a stub', make: () => ({ ...fixture().live()[0], coldstorage: 'a-unit' }) },
        { label: 'a chat that is a pointer', make: () => { const slot = fixture().live()[0]; (slot.chats as Obj[])[0].message = [{ role: 'char', data: 'COLDSTORAGEkey', time: 1 }]; return slot } },
        { label: 'a BigInt', make: () => ({ ...fixture().live()[0], personality: 10n }) },
        { label: 'a toJSON that throws', make: () => ({ ...fixture().live()[0], personality: { toJSON() { throw new Error('toJSON fault') } } }) },
        { label: 'a toJSON that gives a list', make: () => ({ toJSON: () => [1, 2] }) },
        { label: 'a cycle', make: () => { const slot = fixture().live()[0]; slot.self = slot; return slot } },
        { label: 'chats that are not a list', make: () => ({ ...fixture().live()[0], chats: 'not a list' }) },
    ]

    test.each(FAULTS.map(one => [one.label, one] as const))('%s: the wrapper, the plain entry point and the encoder agree, silently', (_label, one) => {
        const f = fixture()
        const slot = one.make()
        const chaId = String(f.live()[0].chaId)
        Object.defineProperty(slot, 'chaId', { value: chaId, enumerable: true, configurable: true, writable: true })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        expect(characterMatchesAcknowledged(asCharacter(slot), { env: seededEnv(5), lists: fakeLists, previous: f.previous })).toBe('unknown')
        expect(plainVerdict(f, slot)).toBe('unknown')
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('unknown')
        expect(logged).not.toHaveBeenCalled()
        expect(f.encoder.shadowStats().entries).toBe(0)
    })

    test.each(FAULTS.map(one => [one.label, one] as const))('%s: the split raises the error class that normalizeCharacter raises', (_label, one) => {
        const slot = one.make()
        const classOf = (work: () => unknown): string => {
            try {
                work()
                return 'none'
            } catch (error) {
                return error instanceof Error ? error.constructor.name : typeof error
            }
        }
        const viaWrapper = classOf(() => normalizeCharacter(asCharacter(slot), 0))
        const viaPlain = classOf(() => {
            const chaId = String((slot as { chaId?: unknown }).chaId ?? '')
            return normalizeCharacterFromPlain(asCharacter(slot), chaId, plainObject(slot, 'characters[0]'), 0)
        })
        if (slot.coldstorage !== undefined) {
            // A stub is refused by `normalizeCharacter` before the read; the split starts after the prologue has refused it.
            expect(viaWrapper).toBe(StubRefusedError.name)
            return
        }
        expect(viaPlain).toBe(viaWrapper)
        expect(['none', StubRefusedError.name, CodecInputError.name, 'Error', 'TypeError']).toContain(viaWrapper)
    })

    test('the split of a character is the same through the read and through the plain tree, over the corpus', () => {
        const f = fixture()
        for (const index of [...TARGETS, 7]) {
            const slot = f.live()[index]
            const viaRead = normalizeCharacter(asCharacter(slot), 0)
            const viaPlain = normalizeCharacterFromPlain(asCharacter(slot), String(slot.chaId), plainObject(slot, 'characters[0]'), 0)
            expect(JSON.stringify(viaPlain.split), `character ${index}`).toBe(JSON.stringify(viaRead.split))
            expect(JSON.stringify(viaPlain.listOwner), `character ${index}`).toBe(JSON.stringify(viaRead.listOwner))
        }
    })

    test('the plain entry point never writes into the tree it is given: a deeply frozen tree is judged', () => {
        const f = fixture()
        const options = { env: seededEnv(5), lists: fakeLists, previous: f.previous }
        const deepFreeze = <T>(value: T): T => {
            if (typeof value === 'object' && value !== null) {
                for (const child of Object.values(value)) {
                    deepFreeze(child)
                }
                Object.freeze(value)
            }
            return value
        }
        for (const index of [...TARGETS, 7]) {
            const slot = f.live()[index]
            const base = verdictBaseOf(asCharacter(slot), f.previous)
            expect(base).not.toBeNull()
            const frozen = deepFreeze(plainObject(slot, 'characters[0]'))
            if (base !== null) {
                expect(characterMatchesAcknowledgedPlain(asCharacter(slot), frozen, base, options), `character ${index}`).toBe(characterMatchesAcknowledged(asCharacter(slot), options))
            }
        }
    })
})

describe('T1: the shadows belong to one acknowledged encoding', () => {
    test('a committed pass makes the next visit full and the one after it a hit, whichever character the pass named', async () => {
        for (const named of [0, 6]) {
            const f = fixture()
            const characters = f.live()
            expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
            expect(f.encoder.shadowStats().entries).toBe(1)
            await commitPass(f, characters, String(characters[named].chaId))
            expect(f.encoder.shadowStats().entries, `pass naming ${named}`).toBe(0)
            const derived = f.counting.calls.characters
            expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
            expect(f.counting.calls.characters, `pass naming ${named}: the next visit is full`).toBeGreaterThan(derived)
            const full = f.counting.calls.characters
            expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
            expect(f.counting.calls.characters, `pass naming ${named}: the one after is a hit`).toBe(full)
        }
    })

    test('an adopted attempt makes the next visit full and the one after it a hit', async () => {
        const f = fixture()
        const characters = f.live()
        expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        const plan = await f.encoder.plan(withCharacters(f.db, characters), { marked: new Set([String(characters[6].chaId)]), modules: false, whole: false })
        const { mint } = createKeyMint(seededEnv(900), null)
        await plan.commitRequest().build({ mint, seq: 2, now: NOW })
        plan.keepAsPending()
        expect(f.encoder.shadowStats().entries, 'a pending attempt holds no shadow').toBe(0)
        expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('unknown')
        expect(f.encoder.shadowStats().entries).toBe(0)
        expect(f.encoder.adoptIfCurrent(f.encoder.pendingKey)).toBe(true)
        const derived = f.counting.calls.characters
        expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        expect(f.counting.calls.characters, 'the next visit is full').toBeGreaterThan(derived)
        const full = f.counting.calls.characters
        expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        expect(f.counting.calls.characters, 'the one after is a hit').toBe(full)
    })

    test('an adoption that does not match leaves the shadows where the pending attempt cleared them: none', async () => {
        const f = fixture()
        const characters = f.live()
        const plan = await f.encoder.plan(withCharacters(f.db, characters), { marked: new Set([String(characters[6].chaId)]), modules: false, whole: false })
        const { mint } = createKeyMint(seededEnv(900), null)
        await plan.commitRequest().build({ mint, seq: 2, now: NOW })
        plan.keepAsPending()
        expect(f.encoder.adoptIfCurrent('some-other-manifest')).toBe(false)
        expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('unknown')
        expect(f.encoder.shadowStats().entries).toBe(0)
    })

    test('with a pending attempt the verdict is unknown before anything of the slot is read', () => {
        const f = fixture()
        const slot = f.live()[0]
        let reads = 0
        const original = slot.personality
        Object.defineProperty(slot, 'personality', { get() { reads += 1; return original }, enumerable: true, configurable: true })
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        const readsOfAFullVisit = reads
        expect(readsOfAFullVisit).toBeGreaterThan(0)
        return (async () => {
            const characters = f.live()
            const plan = await f.encoder.plan(withCharacters(f.db, characters), { marked: new Set([String(characters[6].chaId)]), modules: false, whole: false })
            const { mint } = createKeyMint(seededEnv(900), null)
            await plan.commitRequest().build({ mint, seq: 2, now: NOW })
            plan.keepAsPending()
            reads = 0
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('unknown')
            expect(reads).toBe(0)
        })()
    })
})

describe('T2: a shadow is a copy', () => {
    test('editing the live character in place after the shadow was taken does not edit the shadow', () => {
        const f = fixture()
        const slot = f.live()[0]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        ;(((slot.chats as Obj[])[0].message as Obj[])[0]).data = 'edited in place'
        slot.globalLore = (slot.globalLore as Obj[]).map(entry => ({ ...entry, content: 'edited lore' }))
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('dirty')
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('dirty')
    })

    test('an edit and its undo: dirty while edited, clean again once restored', () => {
        const f = fixture()
        const slot = f.live()[0]
        const message = ((slot.chats as Obj[])[0].message as Obj[])[0]
        const original = message.data
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        message.data = 'edited in place'
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('dirty')
        message.data = original
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
    })
})

describe('what ends a shadow', () => {
    test('a non-clean verdict drops the character\'s shadow', () => {
        const f = fixture()
        const slot = f.live()[0]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        slot.personality = 'edited'
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('dirty')
        expect(f.encoder.shadowStats().entries).toBe(0)
    })

    test('a stub standing where the shadow was: unknown from the prologue, and the shadow is gone', () => {
        const f = fixture()
        const slot = f.live()[0]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        slot.coldstorage = 'a-unit'
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('unknown')
        expect(f.encoder.shadowStats().entries).toBe(0)
    })

    test('a chat turned into a pointer: unknown, silently, and the shadow is gone', () => {
        const f = fixture()
        const slot = f.live()[0]
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        ;(slot.chats as Obj[])[0].message = [{ role: 'char', data: 'COLDSTORAGEkey', time: 1 }]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('unknown')
        expect(f.encoder.shadowStats().entries).toBe(0)
        expect(logged).not.toHaveBeenCalled()
    })

    test('a clean character that admission refuses leaves no older shadow behind', () => {
        const f = fixture()
        const slot = f.live()[0]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        expect(f.encoder.shadowStats().entries).toBe(1)
        // A boxed `type` reads as the same string in the tree and in the entry, but is not a primitive to compare.
        slot.type = new String('character')
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        expect(f.encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
    })

    test('a fault of the moved-field read leaves no shadow of the clean primitive behind', () => {
        const f = fixture()
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        const slot = f.live()[0]
        Object.defineProperty(slot, 'lastInteraction', { get() { throw new Error('getter fault') }, enumerable: false })
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('unknown')
        expect(f.encoder.shadowStats().entries).toBe(0)
        expect(logged).toHaveBeenCalledTimes(1)
    })

    test('F1: a toJSON that starts throwing after the shadow was taken: unknown, silent, no shadow', () => {
        const f = fixture()
        const slot = f.live()[0]
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        slot.personality = { toJSON() { throw new Error('toJSON fault') } }
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('unknown')
        expect(f.encoder.shadowStats().entries).toBe(0)
        expect(logged).not.toHaveBeenCalled()
    })

    test('F1: a list derivation that starts throwing: unknown, logged once, no shadow, and the encoder keeps answering', () => {
        const f = fixture()
        const fault = new Error('list derivation fault')
        const lists: ListDerivation = { ...fakeLists, characterAssets: () => { throw fault } }
        const encoder = createSaveEncoder({ previous: f.previous, lists, env: seededEnv(5), now: () => NOW })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        expect(() => characterMatchesAcknowledged(asCharacter(f.live()[0]), { env: seededEnv(5), lists, previous: f.previous })).toThrow(fault)
        expect(encoder.verdictOf(asCharacter(f.live()[0]))).toBe('unknown')
        expect(logged).toHaveBeenCalledTimes(1)
        expect(encoder.shadowStats().entries).toBe(0)
        expect(f.encoder.verdictOf(asCharacter(f.live()[0]))).toBe('clean')
    })

    test('pruneShadows drops every shadow whose character is not a current resident, and no other', () => {
        const f = fixture()
        const characters = f.live()
        const ids = [0, 1, 6].map(index => String(characters[index].chaId))
        for (const index of [0, 1, 6]) {
            expect(f.encoder.verdictOf(asCharacter(characters[index]))).toBe('clean')
        }
        const before = f.encoder.shadowStats()
        expect(before.entries).toBe(3)
        f.encoder.pruneShadows(new Set([ids[0], ids[2], 'not-a-held-id']))
        expect(f.encoder.shadowStats().entries).toBe(2)
        expect(f.encoder.shadowStats().charged).toBeLessThan(before.charged)
        const derived = f.counting.calls.characters
        expect(f.encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        expect(f.encoder.verdictOf(asCharacter(characters[6]))).toBe('clean')
        expect(f.counting.calls.characters, 'the kept shadows are still hits').toBe(derived)
        f.encoder.pruneShadows(new Set())
        expect(f.encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
    })
})

describe('B1: the budget', () => {
    // The heap pinned per shadow, measured on desktop Node 64-bit with the shadow as the only holder of its strings
    // (CHORE-205 stage 2b sizing): one-byte and two-byte text, a few big strings and a many-node tree.
    const PINNED = [
        { shape: 'S14, one-byte text', ack: 1_442_214, strings: 2_263, containers: 1_092, pinned: 1_641_748 },
        { shape: 'S14, two-byte text', ack: 1_445_013, strings: 2_263, containers: 1_092, pinned: 3_016_616 },
        { shape: 'CSTR, one-byte text', ack: 3_157_225, strings: 2_459, containers: 29, pinned: 3_283_556 },
        { shape: 'CSTR, two-byte text', ack: 3_164_470, strings: 2_459, containers: 29, pinned: 6_404_682 },
        { shape: 'CNODE, many small strings', ack: 5_488_146, strings: 204_059, containers: 68_030, pinned: 23_580_512 },
    ]

    test.each(PINNED.map(one => [one.shape, one] as const))('the charge of %s is at least the heap it pins', (_shape, one) => {
        expect(shadowChargeOf(one.ack, one.strings, one.containers)).toBeGreaterThanOrEqual(one.pinned)
    })

    function framedBytesOf(entry: ShardEntry): number {
        const refs: Array<readonly unknown[] | null> = [entry.core, entry.lore, entry.scripts, entry.al, entry.il, ...entry.chats.flatMap(chat => [chat.core, ...chat.chunks])]
        return refs.reduce<number>((total, ref) => total + (ref === null ? 0 : (ref[1] as number)), 0)
    }

    function weigh(value: unknown): { strings: number, containers: number } {
        if (typeof value === 'string') {
            return { strings: 1, containers: 0 }
        }
        if (typeof value !== 'object' || value === null) {
            return { strings: 0, containers: 0 }
        }
        let strings = 0
        let containers = 1
        for (const child of Object.values(value)) {
            const one = weigh(child)
            strings += one.strings
            containers += one.containers
        }
        return { strings, containers }
    }

    test('a shadow is charged by the formula over its framed bytes, strings and containers, two-byte text included', () => {
        const db = fixtureDb(3)
        ;(db.characters as Obj[])[0].personality = 'It’s a “quoted” line, with a dash — in it. '.repeat(2_000)
        const f = fixtureFrom(db)
        const slot = f.live()[0]
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        const entry = f.entries.find(candidate => candidate.chaId === slot.chaId) as ShardEntry
        const { strings, containers } = weigh(slot)
        const charged = f.encoder.shadowStats().charged
        expect(charged).toBe(shadowChargeOf(framedBytesOf(entry), strings, containers))
        expect(charged).toBeGreaterThan(framedBytesOf(entry) * 2.2)
    })

    function nodeHeavy(count: number, nodes: number): Fixture {
        const db = fixtureDb(count)
        for (const slot of db.characters as Obj[]) {
            slot.junk = Array.from({ length: nodes }, (_, i) => ({ i }))
        }
        return fixtureFrom(db)
    }

    test('a character over the per-character cap is never stored and is derived on every visit', () => {
        const f = nodeHeavy(2, 90_000)
        const slot = f.live()[0]
        const entry = f.entries.find(candidate => candidate.chaId === slot.chaId) as ShardEntry
        // Costed by its containers: its framed bytes alone are a small part of the charge.
        expect(shadowChargeOf(framedBytesOf(entry), weigh(slot).strings, weigh(slot).containers)).toBeGreaterThan(SHADOW_CHARACTER_CAP)
        expect(framedBytesOf(entry) * 2.2).toBeLessThan(SHADOW_CHARACTER_CAP / 2)
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        expect(f.encoder.shadowStats().entries).toBe(0)
        const derived = f.counting.calls.characters
        expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        expect(f.counting.calls.characters).toBeGreaterThan(derived)
    })

    test('the total held never exceeds the budget, across admission and prune, and a refused character is derived each visit', () => {
        const f = nodeHeavy(5, 60_000)
        const characters = f.live()
        let admitted = 0
        const charges: number[] = []
        for (const slot of characters) {
            const before = f.encoder.shadowStats()
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
            const after = f.encoder.shadowStats()
            expect(after.charged).toBeLessThanOrEqual(SHADOW_TOTAL_BUDGET)
            if (after.entries > before.entries) {
                admitted++
                charges.push(after.charged - before.charged)
            }
        }
        expect(admitted).toBeGreaterThan(0)
        expect(admitted).toBeLessThan(characters.length)
        expect(f.encoder.shadowStats().charged).toBe(charges.reduce((total, one) => total + one, 0))
        // A refused character stays a full verdict while the others are hits.
        const refused = characters[characters.length - 1]
        const derived = f.counting.calls.characters
        expect(f.encoder.verdictOf(asCharacter(refused))).toBe('clean')
        expect(f.counting.calls.characters).toBeGreaterThan(derived)
        // Pruning gives the charge back one character at a time.
        const held = new Set(characters.slice(0, admitted).map(slot => String(slot.chaId)))
        const last = String(characters[admitted - 1].chaId)
        held.delete(last)
        f.encoder.pruneShadows(held)
        expect(f.encoder.shadowStats().entries).toBe(admitted - 1)
        expect(f.encoder.shadowStats().charged).toBe(charges.slice(0, admitted - 1).reduce((total, one) => total + one, 0))
        // The room that pruning freed is used by the next character that fits.
        expect(f.encoder.verdictOf(asCharacter(characters[admitted - 1]))).toBe('clean')
        expect(f.encoder.shadowStats().charged).toBeLessThanOrEqual(SHADOW_TOTAL_BUDGET)
    })
})

describe('G9b: a boot-shaped acknowledged encoding', () => {
    test('the first visit is full and clean, the second is a hit, and hydrating another entity\'s digests leaves it one', () => {
        const db = fixtureDb(3)
        const first = encodeWith(asDatabase(db))
        const stored = { manifestKey: first.manifestKey, manifest: first.manifest, source: unitMapSource(first.units) }
        const entries = (first.index.objects?.shards ?? []).flatMap(shard => shard.entries)
        // The boot read the units of the first character; the second one's units were not read, so they carry no digest.
        const characters = clone(assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as Obj[])
        const second = entries.find(candidate => candidate.chaId === characters[1].chaId) as ShardEntry
        const unread = new Set(first.units.filter(unit => unit.identity.includes(second.u) && !unit.identity.startsWith('shard')).map(unit => unit.key))
        const previous = previousOfTree({ ...stored, source: { get: key => (unread.has(key) ? undefined : stored.source.get(key)) } })
        const counting = countingLists()
        const encoder = createSaveEncoder({ previous, lists: counting.lists, env: seededEnv(5), now: () => NOW })
        expect(encoder.verdictOf(asCharacter(characters[1]))).toBe('unknown')
        expect(encoder.shadowStats().entries).toBe(0)
        expect(encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        const full = counting.calls.characters
        expect(encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        expect(counting.calls.characters, 'the second visit is a hit').toBe(full)
        hydrateEntityDigests(previous, second, stored.source)
        expect(encoder.verdictOf(asCharacter(characters[0]))).toBe('clean')
        expect(counting.calls.characters, 'the third, after the hydration, is still a hit').toBe(full)
        expect(encoder.verdictOf(asCharacter(characters[1]))).toBe('clean')
        expect(counting.calls.characters).toBeGreaterThan(full)
    })
})

// ---- the idle net: the prune sits before the empty-resident return ----

type Entry = Record<string, unknown>

interface World {
    kit: Store2Kit
    db: Database
    encoder: SaveEncoder
    clock: { now: number }
    start: number
    crashed: unknown[]
    stop(): void
    slotAt(offset: number): Promise<void>
}

const worlds: World[] = []

afterEach(() => {
    for (const world of worlds) {
        world.stop()
    }
    worlds.length = 0
})

async function startWorld(db: Database, lists?: ListDerivation): Promise<World> {
    const kit = await startStore2({ db, idleNet: { intervalMs: 1 }, lists })
    const encoder = createSaveEncoder({ previous: kit.context.previous, lists: kit.context.lists, env: kit.context.env })
    kit.context.encoder = encoder
    const counted = { reads: 0, sweeps: 0 }
    const real = kit.context.session.committer as Committer
    const counting: Committer = {
        ...real,
        async readCommit() {
            counted.reads += 1
            return real.readCommit()
        },
    }
    kit.context.session = { ...kit.context.session, committer: counting }
    let stopped = false
    let tail: Promise<void> = Promise.resolve()
    const clock = { now: 1_800_000_000_000 }
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    const state = { due: false, dirty: false }
    const world: World = {
        kit, db, encoder, clock, start: clock.now, crashed: [],
        stop() {
            stopped = true
        },
        async slotAt(offset) {
            const reads = counted.reads
            clock.now = world.start + offset
            await until(() => counted.reads > reads, `the slot at +${offset} ms to read the base`, 4000)
            const sweeps = counted.sweeps
            await until(() => counted.sweeps > sweeps, `the slot at +${offset} ms to end`, 4000)
        },
    }
    const idle = () => new Promise<void>((resolve) => {
        if (!stopped) {
            setTimeout(resolve, 2)
        }
    })
    const port: Store2LoopPort = {
        tracker,
        reloadFlag: { state: false },
        getDatabase: () => db,
        mergeBack(live, snapshot) {
            live.modules ||= snapshot.modules
        },
        liveCheck: () => {},
        sweep() {
            counted.sweeps += 1
        },
        isDue: () => state.due,
        isDirty: () => state.dirty,
        hasDrafts: () => false,
        beginIteration() {
            state.due = false
        },
        endIteration: () => {},
        snapshotTaken() {
            state.dirty = false
        },
        requestPass() {
            state.dirty = true
            state.due = true
        },
        unsavable: () => {},
        saved: () => {},
        broadcast: () => {},
        peerHeard: () => false,
        setStopped: () => {},
        reportFailure: () => 1,
        reportUncountedFailure: () => 1,
        async withWriteLock(work) {
            const before = tail
            let release: () => void = () => {}
            tail = new Promise<void>((resolve) => { release = resolve })
            await before
            try {
                return await work()
            } finally {
                release()
            }
        },
        wait: idle,
        sleep: () => idle(),
        sleepForever: () => new Promise<never>(() => {}),
        now: () => clock.now,
    }
    runStore2SaveLoop(kit.context, port).catch((error: unknown) => {
        world.crashed.push(error)
    })
    worlds.push(world)
    return world
}

function meterOf(): SavePassMeterHandle {
    const found = (globalThis as MeterGlobal).__risuSavePassMeter
    if (found === undefined) {
        throw new Error('The meter handle is not installed.')
    }
    return found
}

describe('the idle net releases a shadow whose character was put back', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        meterOf().reset()
    })

    test('the last resident put back: the next slot ends at noResident and the map is empty', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        await world.slotAt(2_000)
        expect(meterOf().verdicts().slotEnds.verdictClean).toBe(1)
        expect(world.encoder.shadowStats().entries).toBe(1)
        const entry = (world.encoder.acknowledged().objects?.shards ?? []).flatMap(shard => shard.entries).find(candidate => candidate.chaId === (db.characters as unknown as Entry[])[0].chaId) as ShardEntry
        ;(db.characters as unknown as Entry[])[0] = stubFromEntry(entry) as unknown as Entry
        await world.slotAt(4_000)
        expect(meterOf().verdicts().slotEnds.noResident).toBe(1)
        expect(world.encoder.shadowStats()).toEqual({ entries: 0, charged: 0 })
        expect(world.crashed).toEqual([])
    })

    test('one of two residents put back: the other keeps its shadow', async () => {
        const db = clone(buildSmall(2))
        const world = await startWorld(db)
        await world.slotAt(2_000)
        await world.slotAt(4_000)
        expect(world.encoder.shadowStats().entries).toBe(2)
        const entries = (world.encoder.acknowledged().objects?.shards ?? []).flatMap(shard => shard.entries)
        const putBack = entries.find(entry => entry.chaId === (db.characters as unknown as Entry[])[0].chaId) as ShardEntry
        ;(db.characters as unknown as Entry[])[0] = stubFromEntry(putBack) as unknown as Entry
        await world.slotAt(6_000)
        expect(world.encoder.shadowStats().entries).toBe(1)
        expect(world.crashed).toEqual([])
    })

    test('F1: a character whose toJSON starts throwing is unknown, holds no shadow, and the loop keeps ticking', async () => {
        const db = clone(buildSmall(1))
        const world = await startWorld(db)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await world.slotAt(2_000)
        expect(world.encoder.shadowStats().entries).toBe(1)
        ;(db.characters as unknown as Entry[])[0].personality = { toJSON() { throw new Error('toJSON fault') } }
        await world.slotAt(4_000)
        expect(meterOf().verdicts().slotEnds.verdictUnknown).toBe(1)
        expect(world.encoder.shadowStats().entries).toBe(0)
        await world.slotAt(6_000)
        expect(world.crashed).toEqual([])
    })
})

describe('M1: the measurement of the shadow', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        vi.spyOn(console, 'log').mockImplementation(() => {})
        startSavePass()
        meterOf().reset()
    })

    /** One begun and closed slot around a verdict, as the idle net records it. */
    function slotAround(work: () => void): ReturnType<SavePassMeterHandle['shadowSlots']>[number] {
        noteNetSlotBegin()
        work()
        noteNetSlotMs(1)
        const slots = meterOf().shadowSlots()
        return slots[slots.length - 1]
    }

    test('each path sets its tag: a miss, a hit, and none for the prologue, a pending attempt', async () => {
        const f = fixture()
        const characters = f.live()
        expect(slotAround(() => f.encoder.verdictOf(asCharacter(characters[0]))).verdictShadow).toBe('miss')
        expect(slotAround(() => f.encoder.verdictOf(asCharacter(characters[0]))).verdictShadow).toBe('hit')
        expect(slotAround(() => f.encoder.verdictOf(asCharacter(characters[4]))).verdictShadow).toBe('none')
        const plan = await f.encoder.plan(withCharacters(f.db, characters), { marked: new Set([String(characters[6].chaId)]), modules: false, whole: false })
        const { mint } = createKeyMint(seededEnv(900), null)
        await plan.commitRequest().build({ mint, seq: 2, now: NOW })
        plan.keepAsPending()
        expect(slotAround(() => f.encoder.verdictOf(asCharacter(characters[0]))).verdictShadow).toBe('none')
        const slots = meterOf().shadowSlots()
        expect(slots).toHaveLength(meterOf().verdicts().slotTimings.length)
        expect(meterOf().shadowTally()).toMatchObject({ shadowHits: 1, shadowMisses: 1 })
    })

    test('the tally counts refusals and the shadows dropped', async () => {
        const f = nodeHeavyOnce()
        const slot = f.live()[0]
        slotAround(() => f.encoder.verdictOf(asCharacter(slot)))
        expect(meterOf().shadowTally().shadowRefused).toBe(1)
        const g = fixture()
        const small = g.live()[0]
        slotAround(() => g.encoder.verdictOf(asCharacter(small)))
        small.personality = 'edited'
        slotAround(() => g.encoder.verdictOf(asCharacter(small)))
        expect(meterOf().shadowTally().shadowClears).toBe(1)
        slotAround(() => g.encoder.verdictOf(asCharacter(g.live()[1])))
        const characters = g.live()
        await commitPass(g, characters, String(characters[6].chaId))
        expect(meterOf().shadowTally().shadowClears).toBe(2)
    })

    function nodeHeavyOnce(): Fixture {
        const db = fixtureDb(2)
        ;(db.characters as Obj[])[0].junk = Array.from({ length: 90_000 }, (_, i) => ({ i }))
        return fixtureFrom(db)
    }

    test('every eighth hit is judged again by the full primitive; tagged slots are hits and carry their own time', () => {
        const f = fixture()
        const slot = f.live()[0]
        const records: Array<ReturnType<typeof slotAround>> = []
        for (let visit = 0; visit < 17; visit++) {
            records.push(slotAround(() => expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')))
        }
        expect(records[0].verdictShadow).toBe('miss')
        expect(records.slice(1).every(record => record.verdictShadow === 'hit')).toBe(true)
        const tripwired = records.map((record, index) => record.shadowTripwire ? index : -1).filter(index => index >= 0)
        // Hits are visits 1..16; the 8th and the 16th are re-judged.
        expect(tripwired).toEqual([8, 16])
        for (const index of tripwired) {
            expect(Number.isFinite(records[index].shadowTripwireMs)).toBe(true)
        }
        expect(records.filter(record => !record.shadowTripwire).every(record => record.shadowTripwireMs === null)).toBe(true)
        expect(meterOf().shadowTally()).toMatchObject({ shadowHits: 16, shadowMisses: 1, shadowTripwireRuns: 2, shadowDisagreements: 0 })
        // The visits derived once for the miss and once for each re-judging: nothing else.
        expect(f.counting.calls.characters).toBe(3)
    })

    test('the tripwire reads the live slot again: one read per visit, two on the eighth hit', () => {
        const f = fixture()
        const slot = f.live()[0]
        let reads = 0
        const held = slot.personality
        Object.defineProperty(slot, 'personality', {
            get() {
                reads++
                return held
            },
            set() {},
            enumerable: true,
            configurable: true,
        })
        const perVisit: number[] = []
        for (let visit = 0; visit < 10; visit++) {
            reads = 0
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
            perVisit.push(reads)
        }
        // Visit 0 is the miss, visits 1..7 are hits, visit 8 is the eighth hit and is judged again on the live slot.
        expect(perVisit).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 1])
    })

    test('a disagreement between the shadow and the full primitive is counted, answers the full verdict and drops the shadow', () => {
        const f = fixture()
        const slot = f.live()[0]
        // One miss and seven hits: the next visit is the eighth hit.
        for (let visit = 0; visit < 8; visit++) {
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        }
        // The premise of the shadow broken from outside the tree: the derivation now differs from the acknowledged list.
        f.counting.fault.on = true
        expect(slotAround(() => expect(f.encoder.verdictOf(asCharacter(slot))).toBe('dirty')).shadowTripwire).toBe(true)
        expect(meterOf().shadowTally()).toMatchObject({ shadowTripwireRuns: 1, shadowDisagreements: 1 })
        expect(f.encoder.shadowStats().entries).toBe(0)
    })

    test('with the build switch off nothing is recorded and the tripwire never runs', () => {
        flag.measure = false
        const f = fixture()
        const slot = f.live()[0]
        for (let visit = 0; visit < 20; visit++) {
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        }
        expect(meterOf().shadowTally()).toEqual({ shadowHits: 0, shadowMisses: 0, shadowRefused: 0, shadowClears: 0, shadowTripwireRuns: 0, shadowDisagreements: 0 })
        expect(f.counting.calls.characters).toBe(1)
    })

    test('with the run-time switch off nothing is recorded and the tripwire never runs', () => {
        vi.stubGlobal('localStorage', { getItem: () => null })
        const f = fixture()
        const slot = f.live()[0]
        for (let visit = 0; visit < 20; visit++) {
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        }
        expect(f.counting.calls.characters).toBe(1)
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-savepass' ? 'on' : null })
        expect(meterOf().shadowTally()).toEqual({ shadowHits: 0, shadowMisses: 0, shadowRefused: 0, shadowClears: 0, shadowTripwireRuns: 0, shadowDisagreements: 0 })
    })

    test('the tripwire\'s switch is the meter\'s, not the put-back tripwire\'s', () => {
        vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-tripwire' ? 'on' : null })
        const f = fixture()
        const slot = f.live()[0]
        for (let visit = 0; visit < 20; visit++) {
            expect(f.encoder.verdictOf(asCharacter(slot))).toBe('clean')
        }
        expect(f.counting.calls.characters).toBe(1)
    })
})
