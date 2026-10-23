// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The mocks are the boot suites' own (bootResidency.test.ts): the G9 block at the end boots through the real dispatch.
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { bootThroughDispatch, countedBackend, createClock, seedTree, testEnv } from '../store2SaveKit'
import { assembleDatabase, characterMatchesAcknowledged, previousFrom, stubFromEntry, unitMapSource, type PreviousEncoding, type ReusableUnit } from '../../store2/codec'
import { createKeyMint, type BuildContext } from '../../store2/commit'
import type { ShardEntry } from '../../store2/format'
import { createSaveEncoder, type SaveEncoder } from '../../store2/saveEncoder'
import { buildColdStub } from '../../../process/coldCharacter'
import type { character, Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The verdict the idle net's slot will rely on (`SaveEncoder.verdictOf`, `stubsNeedFullPass`, `unheldChaIds`), with no
 * save loop involved. Titles starting `equivalence`, `guard` or `reproducer` say which kind of evidence they are.
 */

const NOW = 1_700_000_000_000

afterEach(() => {
    vi.restoreAllMocks()
})

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Eight characters: 0 plain, 1 and 2 stamped with both moved fields, 3 a group, 4 and 5 sharing one id, 6 plain, 7 plain.
 * Built before the first encode, so the acknowledged encoding holds the shared id's handle `#1`.
 */
function fixtureDb(): Obj {
    const db = clone(buildSmall(8)) as unknown as Obj
    const slots = db.characters as Obj[]
    Object.assign(slots[1], { lastInteraction: 1000, trashTime: 2000 })
    Object.assign(slots[2], { lastInteraction: 3000, trashTime: 4000 })
    Object.assign(slots[3], { type: 'group', chaId: 'group-one', name: 'Group One', characters: ['m1', 'm2'], characterTalks: [0.5, 0.5], characterActive: [true, true] })
    slots[5].chaId = slots[4].chaId
    db.characterOrder = slots.map(slot => slot.chaId)
    return db
}

const SHARED = [4, 5]

interface Fixture {
    db: Obj
    previous: PreviousEncoding
    encoder: SaveEncoder
    /** The characters as the acknowledged encoding assembles them: the live state a tick would judge. */
    live(): Obj[]
    entries: ShardEntry[]
}

function fixture(): Fixture {
    const db = fixtureDb()
    const first = encodeWith(asDatabase(db))
    const previous = previousFrom(first)
    const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
    return {
        db,
        previous,
        encoder,
        live: () => clone(assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as Obj[]),
        entries: (previous.objects?.shards ?? []).flatMap(shard => shard.entries),
    }
}

function verdictOfSlot(encoder: SaveEncoder, slot: Obj): ReturnType<SaveEncoder['verdictOf']> {
    return encoder.verdictOf(slot as unknown as character)
}

function withCharacters(db: Obj, characters: Obj[]): Database {
    return asDatabase({ ...clone(db), characters })
}

/** Whether a full pass naming `chaId` over `characters` writes nothing. */
async function fullPassUnchanged(encoder: SaveEncoder, f: Fixture, characters: Obj[], chaId: string): Promise<boolean> {
    const plan = await encoder.plan(withCharacters(f.db, characters), { marked: new Set([chaId]), modules: false, whole: false })
    return plan.unchanged
}

interface Mutation {
    /** The shard entry field (or unit kind) the mutation changes. */
    field: string
    label: string
    /** Returns false when the character has nothing to change (a removal of an absent field). */
    apply(slot: Obj): boolean
}

const MUTATIONS: Mutation[] = [
    { field: 'name', label: 'name', apply: (slot) => { slot.name = `${String(slot.name)} edited`; return true } },
    { field: 'image', label: 'image', apply: (slot) => { slot.image = 'assets/an-image.png'; return true } },
    { field: 'creatorNotes', label: 'creatorNotes', apply: (slot) => { slot.creatorNotes = 'other notes'; return true } },
    { field: 'tags', label: 'tags', apply: (slot) => { slot.tags = ['other']; return slot.type !== 'group' } },
    { field: 'creator', label: 'creator', apply: (slot) => { slot.creator = 'someone else'; return slot.type !== 'group' } },
    { field: 'characters', label: 'a group\'s members', apply: (slot) => { if (slot.type !== 'group') { return false } (slot.characters as string[]).push('m3'); return true } },
    { field: 'chatPage', label: 'chatPage', apply: (slot) => { slot.chatPage = 2; return true } },
    { field: 'firstMsgIndex', label: 'firstMsgIndex', apply: (slot) => { slot.firstMsgIndex = 3; return true } },
    { field: 'lastInteraction', label: 'lastInteraction set or changed', apply: (slot) => { slot.lastInteraction = typeof slot.lastInteraction === 'number' ? slot.lastInteraction + 1 : 77; return true } },
    { field: 'lastInteraction', label: 'lastInteraction removed', apply: (slot) => { const had = 'lastInteraction' in slot; delete slot.lastInteraction; return had } },
    { field: 'lastInteraction', label: 'lastInteraction made unmovable', apply: (slot) => { slot.lastInteraction = 'soon'; return true } },
    { field: 'trashTime', label: 'trashTime set or changed', apply: (slot) => { slot.trashTime = typeof slot.trashTime === 'number' ? slot.trashTime + 1 : 88; return true } },
    { field: 'trashTime', label: 'trashTime removed', apply: (slot) => { const had = 'trashTime' in slot; delete slot.trashTime; return had } },
    { field: 'trashTime', label: 'trashTime made unmovable', apply: (slot) => { slot.trashTime = 'later'; return true } },
    { field: 'type', label: 'type', apply: (slot) => { slot.type = slot.type === 'group' ? 'character' : 'group'; return true } },
    { field: 'chaId', label: 'chaId', apply: (slot) => { slot.chaId = 'another-id'; return true } },
    { field: 'core', label: 'core unit', apply: (slot) => { slot.personality = 'edited personality'; return true } },
    { field: 'lore', label: 'lore unit', apply: (slot) => { ((slot.globalLore as Obj[])[0]).content = 'edited lore'; return true } },
    { field: 'scripts', label: 'scripts unit', apply: (slot) => { (slot.customscript as unknown[]).push({ comment: 'new', in: 'a', out: 'b', type: 'editinput' }); return true } },
    { field: 'al', label: 'asset list unit', apply: (slot) => { slot.additionalAssets = [['extra', `assets/${'b'.repeat(64)}.PNG`, 'png']]; return true } },
    { field: 'il', label: 'inlay list unit', apply: (slot) => { slot.chats = (slot.chats as Obj[]).map((chat, index) => (index === 1 ? { ...chat, message: [{ role: 'char', data: '{{inlay::0123abcd-0123-4123-a123-0123456789ab}}', time: 1 }] } : chat)); return true } },
    { field: 'chats', label: 'chat core unit', apply: (slot) => { (slot.chats as Obj[])[1].note = 'a note'; return true } },
    { field: 'chats', label: 'chat chunk unit', apply: (slot) => { (((slot.chats as Obj[])[0].message as Obj[])[0]).data = 'edited message'; return true } },
    { field: 'chats', label: 'an added chat', apply: (slot) => { (slot.chats as Obj[]).push({ ...(slot.chats as Obj[])[1], id: 'added-chat', name: 'Added' }); return true } },
    { field: 'chats', label: 'a removed chat', apply: (slot) => { (slot.chats as Obj[]).pop(); return true } },
    { field: 'chats', label: 'a pointer chat', apply: (slot) => { (slot.chats as Obj[])[0].message = [{ role: 'char', data: 'COLDSTORAGEkey', time: 1 }]; return true } },
]

/** The entry fields no live character can change: the entity id and the write-only display flag. */
const NOT_LIVE_FIELDS = ['u', 'dsp']

describe('equivalence: a clean verdict means a full pass naming the character plans nothing', () => {
    const TARGETS = [0, 1, 2, 3, 6]

    test('the unedited characters are clean, and a full pass over them plans unchanged', async () => {
        const f = fixture()
        const characters = f.live()
        for (const index of [...TARGETS, 7]) {
            expect(verdictOfSlot(f.encoder, characters[index]), `character ${index}`).toBe('clean')
            expect(await fullPassUnchanged(f.encoder, f, characters, String(characters[index].chaId)), `character ${index}`).toBe(true)
        }
    })

    test('every single-field mutation of each entry field and each unit kind is not clean', () => {
        const f = fixture()
        let applied = 0
        for (const index of TARGETS) {
            for (const mutation of MUTATIONS) {
                const characters = f.live()
                if (!mutation.apply(characters[index])) {
                    continue
                }
                applied++
                expect(verdictOfSlot(f.encoder, characters[index]), `character ${index}: ${mutation.label}`).not.toBe('clean')
            }
        }
        expect(applied).toBeGreaterThan(TARGETS.length * (MUTATIONS.length - 6))
    })

    test('whenever the verdict is clean for a mutation, a full pass plans unchanged; a dirty one plans a write', async () => {
        const f = fixture()
        let dirty = 0
        for (const index of TARGETS) {
            for (const mutation of MUTATIONS) {
                const characters = f.live()
                if (!mutation.apply(characters[index])) {
                    continue
                }
                const verdict = verdictOfSlot(f.encoder, characters[index])
                if (verdict === 'unknown') {
                    continue
                }
                const unchanged = await fullPassUnchanged(f.encoder, f, characters, String(characters[index].chaId))
                expect(unchanged, `character ${index}: ${mutation.label}`).toBe(verdict === 'clean')
                dirty += verdict === 'dirty' ? 1 : 0
            }
        }
        expect(dirty).toBeGreaterThan(TARGETS.length * 10)
    })

    test('the mutations cover every field of every acknowledged entry that a live character can change', () => {
        const f = fixture()
        const covered = new Set([...MUTATIONS.map(mutation => mutation.field), ...NOT_LIVE_FIELDS])
        const held = new Set(f.entries.flatMap(entry => Object.keys(entry)))
        expect([...held].filter(field => !covered.has(field))).toEqual([])
        expect(held.has('lastInteraction')).toBe(true)
        expect(held.has('trashTime')).toBe(true)
        expect(held.has('characters')).toBe(true)
    })

    test('a moved field set to the value the entry holds stays clean', async () => {
        const f = fixture()
        const characters = f.live()
        characters[1].lastInteraction = 1000
        characters[1].trashTime = 2000
        expect(verdictOfSlot(f.encoder, characters[1])).toBe('clean')
        expect(await fullPassUnchanged(f.encoder, f, characters, String(characters[1].chaId))).toBe(true)
    })

    test('a shared id, a digestless unit, a stub and a pointer chat are unknown, never clean', () => {
        const f = fixture()
        const characters = f.live()
        for (const index of SHARED) {
            expect(verdictOfSlot(f.encoder, characters[index]), `shared ${index}`).toBe('unknown')
        }
        const units = new Map<string, ReusableUnit>(f.previous.units)
        const u = f.previous.entities.get(`${String(characters[7].chaId)}#0`) as string
        const core = units.get(`char:${u}:core`) as ReusableUnit
        units.set(`char:${u}:core`, { key: core.key, type: core.type, ref: core.ref })
        const digestless = createSaveEncoder({ previous: { ...f.previous, units }, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        expect(verdictOfSlot(digestless, characters[7])).toBe('unknown')
        expect(verdictOfSlot(f.encoder, { ...characters[6], coldstorage: 'x' })).toBe('unknown')
        const pointer = f.live()[6]
        ;((pointer.chats as Obj[])[0].message as Obj[])[0] = { role: 'char', data: 'COLDSTORAGEkey', time: 1 }
        expect(verdictOfSlot(f.encoder, pointer)).toBe('unknown')
    })
})

describe('the moved-field compare of verdictOf', () => {
    test('reproducer: a character whose only change is lastInteraction or trashTime is dirty, where the primitive says clean', () => {
        const f = fixture()
        for (const field of ['lastInteraction', 'trashTime']) {
            const characters = f.live()
            characters[0][field] = 12345
            // The premise of the reproducer: the primitive alone leaves these two fields to the stub overlay.
            expect(characterMatchesAcknowledged(characters[0] as unknown as character, { env: seededEnv(5), lists: fakeLists, previous: f.previous }), field).toBe('clean')
            expect(verdictOfSlot(f.encoder, characters[0]), field).toBe('dirty')
        }
    })

    test('guard: an acknowledged value the codec does not move, unchanged live, stays clean and a pass plans unchanged', async () => {
        // Kills dropping the rule that a field compares only when the codec would move it: the entry holds no such field.
        const db = clone(buildSmall(3)) as unknown as Obj
        Object.assign((db.characters as Obj[])[0], { lastInteraction: 'soon', trashTime: 'later' })
        db.characterOrder = (db.characters as Obj[]).map(slot => slot.chaId)
        const first = encodeWith(asDatabase(db))
        const previous = previousFrom(first)
        const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        const characters = clone(assembleDatabase(first.manifest, unitMapSource(first.units)).characters as unknown as Obj[])
        expect(characters[0].lastInteraction).toBe('soon')
        expect(characters[0].trashTime).toBe('later')
        expect(verdictOfSlot(encoder, characters[0])).toBe('clean')
        const plan = await encoder.plan(asDatabase({ ...clone(db), characters }), { marked: new Set([String(characters[0].chaId)]), modules: false, whole: false })
        expect(plan.unchanged).toBe(true)
    })

    test('a removed lastInteraction or trashTime is dirty: the entry holds a field the pass would no longer write', () => {
        const f = fixture()
        for (const field of ['lastInteraction', 'trashTime']) {
            const characters = f.live()
            expect(field in characters[1]).toBe(true)
            delete characters[1][field]
            expect(verdictOfSlot(f.encoder, characters[1]), field).toBe('dirty')
        }
    })

    test('a value the codec does not move is expected absent from the entry', () => {
        const f = fixture()
        const characters = f.live()
        characters[0].lastInteraction = 'soon'
        expect(verdictOfSlot(f.encoder, characters[0])).toBe('dirty')
    })

    test('the comparison is Object.is on the value: a different number is dirty, the same one clean', () => {
        const f = fixture()
        const same = f.live()[2]
        expect(verdictOfSlot(f.encoder, same)).toBe('clean')
        const changed = f.live()[2]
        changed.trashTime = (changed.trashTime as number) + 1
        expect(verdictOfSlot(f.encoder, changed)).toBe('dirty')
    })
})

describe('verdictOf: the cases only a full pass can answer', () => {
    test('an attempt of unknown outcome that is pending makes every verdict unknown; resolving it restores them', async () => {
        const f = fixture()
        const characters = f.live()
        expect(verdictOfSlot(f.encoder, characters[0])).toBe('clean')
        const plan = await f.encoder.plan(withCharacters(f.db, characters), { marked: new Set([String(characters[0].chaId)]), modules: false, whole: false })
        const { mint } = createKeyMint(seededEnv(900), null)
        const context: BuildContext = { mint, seq: 2, now: NOW }
        await plan.commitRequest().build(context)
        plan.keepAsPending()
        expect(f.encoder.pendingKey).not.toBeNull()
        expect(verdictOfSlot(f.encoder, characters[0])).toBe('unknown')
        expect(f.encoder.adoptIfCurrent(f.encoder.pendingKey)).toBe(true)
        expect(verdictOfSlot(f.encoder, characters[0])).toBe('clean')
    })

    test('reproducer: a fault of the read (a throwing list derivation) is unknown and logged, not thrown', () => {
        const f = fixture()
        const fault = new Error('list derivation fault')
        const lists = { ...fakeLists, characterAssets: () => { throw fault } }
        const encoder = createSaveEncoder({ previous: f.previous, lists, env: seededEnv(5), now: () => NOW })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        // The premise of the reproducer: the primitive itself throws on this derivation.
        expect(() => characterMatchesAcknowledged(f.live()[0] as unknown as character, { env: seededEnv(5), lists, previous: f.previous })).toThrow(fault)
        expect(verdictOfSlot(encoder, f.live()[0])).toBe('unknown')
        expect(logged).toHaveBeenCalledTimes(1)
        expect(logged.mock.calls[0]).toContain(fault)
    })

    test('a fault of a moved-field read is unknown and logged too', () => {
        const f = fixture()
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        const characters = f.live()
        Object.defineProperty(characters[0], 'lastInteraction', { get() { throw new Error('getter fault') }, enumerable: false })
        expect(verdictOfSlot(f.encoder, characters[0])).toBe('unknown')
        expect(logged).toHaveBeenCalled()
    })
})

describe('unheldChaIds', () => {
    test('names a resident character the acknowledged encoding does not hold, and no held one', () => {
        const f = fixture()
        const characters = f.live()
        expect(f.encoder.unheldChaIds(withCharacters(f.db, characters))).toEqual([])
        characters.push({ ...characters[6], chaId: 'brand-new' })
        expect(f.encoder.unheldChaIds(withCharacters(f.db, characters))).toEqual(['brand-new'])
    })
})

describe('stubsNeedFullPass', () => {
    /** A database whose characters are the entries' own stubs, in the acknowledged order. */
    function stubbed(f: Fixture, edit: (stubs: Obj[]) => void = () => { }): Database {
        const stubs = f.entries.map(entry => stubFromEntry(entry) as unknown as Obj)
        edit(stubs)
        return asDatabase({ characters: stubs })
    }

    function stubFixture(): Fixture {
        const db = clone(buildSmall(4)) as unknown as Obj
        const first = encodeWith(asDatabase(db))
        const previous = previousFrom(first)
        return {
            db,
            previous,
            encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW }),
            live: () => [],
            entries: (previous.objects?.shards ?? []).flatMap(shard => shard.entries),
        }
    }

    test('guard (passes before and after): stubs the acknowledged entries stand for need no full pass', () => {
        const f = stubFixture()
        expect(f.encoder.stubsNeedFullPass(stubbed(f))).toBe(false)
        expect(f.encoder.stubsNeedFullPass(asDatabase({ characters: [] }))).toBe(false)
    })

    test('a resident character is no stub: it never makes the check true', () => {
        const f = stubFixture()
        expect(f.encoder.stubsNeedFullPass(withCharacters(f.db, clone(f.db.characters as Obj[])))).toBe(false)
    })

    test('a handle the encoding does not hold', () => {
        const f = stubFixture()
        expect(f.encoder.stubsNeedFullPass(stubbed(f, (stubs) => { stubs[1].chaId = 'not-held' }))).toBe(true)
    })

    test('a stub that names a unit other than its entry\'s', () => {
        const f = stubFixture()
        expect(f.encoder.stubsNeedFullPass(stubbed(f, (stubs) => { stubs[1].coldstorage = 'another-unit' }))).toBe(true)
    })

    test('guard on the pre-fix base (the savePassCompat stub-retry shape), and a killer of an overlay-only check', () => {
        const f = stubFixture()
        const resident = clone((f.db.characters as Obj[])[1])
        const stub = buildColdStub(resident as unknown as character, 'a-key-the-entry-does-not-name', ['chat-a']) as unknown as Obj
        const characters = clone(f.db.characters as Obj[])
        characters[1] = stub
        expect(f.encoder.stubsNeedFullPass(withCharacters(f.db, characters))).toBe(true)
    })

    test('a live duplicate of the id: the first holder is a stub, the second is resident', () => {
        const f = stubFixture()
        const stub = stubFromEntry(f.entries[1]) as unknown as Obj
        const duplicate = { ...clone((f.db.characters as Obj[])[2]), chaId: f.entries[1].chaId }
        const characters = [clone((f.db.characters as Obj[])[0]), stub, duplicate, clone((f.db.characters as Obj[])[3])]
        expect(f.encoder.stubsNeedFullPass(withCharacters(f.db, characters))).toBe(true)
    })

    test('an acknowledged handle with a suffix other than 0: the encoding holds the id twice, the live list once', () => {
        const db = fixtureDb()
        const previous = previousFrom(encodeWith(asDatabase(db)))
        const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        const entries = (previous.objects?.shards ?? []).flatMap(shard => shard.entries)
        const sharedId = String((db.characters as Obj[])[4].chaId)
        expect(previous.entities.has(`${sharedId}#1`)).toBe(true)
        const first = entries.find(entry => entry.chaId === sharedId) as ShardEntry
        const live = asDatabase({ characters: [stubFromEntry(first)] })
        expect(encoder.stubsNeedFullPass(live)).toBe(true)
    })

    test('an acknowledged entry that the shards no longer hold', () => {
        const f = stubFixture()
        const thin: PreviousEncoding = {
            ...f.previous,
            objects: { ...f.previous.objects, shards: (f.previous.objects?.shards ?? []).map(shard => ({ ...shard, entries: shard.entries.filter(entry => entry.chaId !== f.entries[1].chaId) })) },
        }
        const encoder = createSaveEncoder({ previous: thin, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })
        expect(encoder.stubsNeedFullPass(stubbed(f))).toBe(true)
        // A missing entry is answered by the check, not by the fault guard around it.
        expect(logged).not.toHaveBeenCalled()
        expect(createSaveEncoder({ previous: { ...f.previous, objects: undefined }, lists: fakeLists, env: seededEnv(5), now: () => NOW }).stubsNeedFullPass(stubbed(f))).toBe(true)
        expect(logged).toHaveBeenCalledTimes(1)
    })

    test.each([
        ['name', (stub: Obj) => { stub.name = 'Renamed' }],
        ['image', (stub: Obj) => { stub.image = 'assets/new.png' }],
        ['creatorNotes', (stub: Obj) => { stub.creatorNotes = 'new notes' }],
        ['lastInteraction', (stub: Obj) => { stub.lastInteraction = 5 }],
        ['trashTime', (stub: Obj) => { stub.trashTime = 6 }],
        ['tags', (stub: Obj) => { stub.tags = ['fresh'] }],
        ['creator', (stub: Obj) => { stub.creator = 'someone else' }],
    ])('a stub overlay that differs from the entry: %s', (_field, edit) => {
        const f = stubFixture()
        expect(f.encoder.stubsNeedFullPass(stubbed(f, (stubs) => { edit(stubs[2]) }))).toBe(true)
    })

    test('a group stub whose members changed, and a removed lastInteraction', () => {
        const db = fixtureDb()
        const previous = previousFrom(encodeWith(asDatabase(db)))
        const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(5), now: () => NOW })
        const entries = (previous.objects?.shards ?? []).flatMap(shard => shard.entries)
        const group = entries.find(entry => entry.chaId === 'group-one') as ShardEntry
        expect(encoder.stubsNeedFullPass(asDatabase({ characters: [stubFromEntry(group)] }))).toBe(false)
        const members = stubFromEntry(group) as unknown as Obj
        ;(members.characters as string[]).push('m3')
        expect(encoder.stubsNeedFullPass(asDatabase({ characters: [members] }))).toBe(true)
        const stamped = entries.find(entry => entry.lastInteraction !== undefined) as ShardEntry
        const removed = stubFromEntry(stamped) as unknown as Obj
        delete removed.lastInteraction
        expect(encoder.stubsNeedFullPass(asDatabase({ characters: [removed] }))).toBe(true)
    })
})

type Plain = Record<string, unknown>

async function bootOf(extra: Obj, edit: (characters: Plain[]) => void, count: number): ReturnType<typeof bootThroughDispatch> {
    const counted = countedBackend()
    const source = { ...(buildSmall(count) as unknown as Obj), ...extra } as unknown as Database
    edit(source.characters as unknown as Plain[])
    ;(source as unknown as Obj).characterOrder = (source.characters as unknown as Plain[]).map(slot => slot.chaId)
    await seedTree(counted.memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
    counted.reset()
    return bootThroughDispatch(counted.backend)
}

function bootedSlots(result: Store2BootResult): Plain[] {
    if (result.kind !== 'store2') {
        throw new Error(`The boot answered ${result.kind}.`)
    }
    return result.database.characters as unknown as Plain[]
}

function resetBootedPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

/**
 * G9 of CHORE-205 stage 1: the verdict of a character the real boot opened as resident. The acknowledged encoding is the
 * one `previousOfTree` builds over the boot's backend read; a resident's units were read, so they carry digests and the
 * verdict can answer. Every case boots through the real dispatch over an in-memory backend: it says nothing about the
 * real stores.
 */
describe('G9: a boot resident is judged against the acknowledged encoding the boot read', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        resetBootedPage()
        vi.spyOn(console, 'error').mockImplementation(() => { })
    })

    afterEach(() => {
        resetBootedPage()
    })

    test('with archiving off, every resident is clean as the boot assembled it, and an edit of it is dirty', async () => {
        const boot = await bootOf({ archiveCharacters: false }, () => { }, 3)
        const encoder = getActiveStore2Save()?.encoder
        expect(encoder).toBeDefined()
        const slots = bootedSlots(boot.result)
        expect(slots).toHaveLength(3)
        for (const slot of slots) {
            expect(slot.coldstorage).toBeUndefined()
            expect(encoder?.verdictOf(slot as unknown as character), String(slot.name)).toBe('clean')
        }
        slots[1].personality = 'edited after boot'
        expect(encoder?.verdictOf(slots[1] as unknown as character)).toBe('dirty')
    })

    test('with archiving on, the residents the policy keeps are clean, and the stubs need no full pass', async () => {
        const boot = await bootOf({ archiveCharacters: true }, (characters) => {
            characters[0].chaId = '§playground'
            characters[1].chaId = ''
            characters[2].chaId = 'preset'
        }, 5)
        const encoder = getActiveStore2Save()?.encoder
        const slots = bootedSlots(boot.result)
        const residents = slots.filter(slot => slot.coldstorage === undefined)
        const stubs = slots.filter(slot => slot.coldstorage !== undefined)
        expect(residents).toHaveLength(3)
        expect(stubs).toHaveLength(2)
        for (const slot of residents) {
            expect(encoder?.verdictOf(slot as unknown as character), String(slot.chaId)).toBe('clean')
        }
        expect(encoder?.stubsNeedFullPass({ characters: slots } as unknown as Database)).toBe(false)
        expect(encoder?.unheldChaIds({ characters: slots } as unknown as Database)).toEqual([])
    })

    test('a resident that shares its id with another is unknown, as the coverage table says', async () => {
        const boot = await bootOf({ archiveCharacters: true }, (characters) => {
            characters[0].chaId = 'twin'
            characters[1].chaId = 'twin'
        }, 3)
        const encoder = getActiveStore2Save()?.encoder
        const twins = bootedSlots(boot.result).filter(slot => slot.chaId === 'twin')
        expect(twins).toHaveLength(2)
        for (const slot of twins) {
            expect(encoder?.verdictOf(slot as unknown as character)).toBe('unknown')
        }
    })
})
