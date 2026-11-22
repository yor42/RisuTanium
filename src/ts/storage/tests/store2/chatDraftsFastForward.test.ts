// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

import type { Database } from 'src/ts/storage/database.svelte'
import { assembleDatabase, planScopedEncode, type PreviousEncoding } from 'src/ts/storage/store2/codec'
import type { JsonValue } from 'src/ts/storage/blockFrame'
import { createGuardB, type GuardEntry } from 'src/ts/storage/store2/fastForward/guard'
import { advancePrevious } from 'src/ts/storage/store2/fastForward/advancePrevious'
import { prepareFastForward, type Prepared } from 'src/ts/storage/store2/fastForward/prepare'
import { readPeerTree } from 'src/ts/storage/store2/fastForward/read'
import { defaultKeyEnv, encodeUnit, FRAME_HEADER_BYTES, keyOfRef, readUnit, refOfFrame, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { previousOfTree, type StoredTree } from 'src/ts/storage/store2/previousOfTree'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { fakeLists, seededEnv, type Obj } from './codecFixtures'
import { ffSetup, ffTeardown, ffWorld, testHost } from './ffFixtures'
import { parsedKey } from './lineFixtures'

/**
 * Kind 30 under the fast-forward (#272 S1, MC-3589 as amended by MC-3592): the set is one whole unit, taken from the peer
 * when this page's committed set is the base's, kept when the peer's is the base's, and parked when both changed. Every row of
 * the 3x2 absent/present matrix runs the real chain a loop runs: `readPeerTree`, `advancePrevious`, `prepareFastForward`, over a
 * memory backend written by the peer's real commits. Labels: PIN pins a rule of a unit that does not exist before the change
 * (its evidence is the scratch mutant that breaks it).
 */

const NOW = 1_700_000_000_000
const BH = '0123456789abcdef0123456789abcdef'

function entry(cha: string, chat: string, texts: string[] = []): Obj {
    return { cha, chat, drafts: texts.map((text, index) => ({ m: `id:${chat}${index}`, text, bh: BH, at: NOW + index })) }
}

const D1 = (): Obj[] => [entry('c1', 'k1', ['one'])]
const D2 = (): Obj[] => [entry('c1', 'k1', ['one']), entry('c2', 'k2', ['two'])]
const D3 = (): Obj[] => [entry('c1', 'k1', ['one edited here']), entry('c3', 'k3', ['three'])]

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

const draftsOf = (db: Database): unknown => (db as unknown as Obj).chatDrafts
const setDrafts = (db: Database, value: unknown): void => { (db as unknown as Obj).chatDrafts = clone(value) }
/** A peer commit that leaves the drafts alone. */
const elsewhere = (db: Database): void => { db.temperature = 31 }

interface Scenario {
    prepared: Prepared
    db: Database
    old: PreviousEncoding
    next: PreviousEncoding
    target: StoredTree
    world: Awaited<ReturnType<typeof ffWorld>>
}

async function treeOf(world: Awaited<ReturnType<typeof ffWorld>>): Promise<StoredTree> {
    const key = await parsedKey(world.memory)
    const read = await readTreeBytes(world.memory, key.current?.key ?? '')
    if (read.status !== 'ok') {
        throw new Error(`The tree read ${read.status}.`)
    }
    return read.tree
}

/** Boots a page on the base (`base` drafts, or none), lets `mine` change its database, has the peer commit `theirs`, and prepares. */
async function scenario(options: { base?: unknown, mine?: (db: Database) => void, theirs: (db: Database) => void }): Promise<Scenario> {
    const world = await ffWorld()
    if (options.base !== undefined) {
        await world.page.commitEdit(db => setDrafts(db, options.base))
    }
    const baseTree = await treeOf(world)
    const old = previousOfTree(baseTree)
    const db = assembleDatabase(baseTree.manifest, baseTree.source)
    options.mine?.(db)
    const edited = await world.page.commitEdit(options.theirs)
    const read = await readPeerTree(world.memory, edited.current?.key ?? '', old)
    if (read.status !== 'ok') {
        throw new Error(`The peer tree read ${read.status}.`)
    }
    const next = advancePrevious(old, read.tree)
    const { host } = testHost()
    const prepared = await prepareFastForward({
        db, old, target: read.tree, next, host, replyOwners: new Set(), env: defaultKeyEnv, lists: fakeLists,
    })
    return { prepared, db, old, next, target: read.tree, world }
}

function ready(prepared: Prepared): Extract<Prepared, { kind: 'ready' }> {
    if (prepared.kind !== 'ready') {
        throw new Error(`The prepare came to ${JSON.stringify(prepared)}.`)
    }
    return prepared
}

/** Applies every step of a ready result in order and requires each to verify, as the loop does. */
function applied(prepared: Prepared, db: Database): GuardEntry[] {
    const result = ready(prepared)
    for (const step of result.steps) {
        step.apply()
        expect(step.verify()).toBe(true)
    }
    return result.guard
}

const draftGuards = (guard: readonly GuardEntry[]): GuardEntry[] =>
    guard.filter(item => (item.kind === 'unit' ? item.identity === 'chatDrafts' : item.path === 'chatDrafts'))

beforeEach(() => { ffSetup() })
afterEach(() => { ffTeardown() })

describe('T1.13 the matrix of the draft set (B base, M mine, T theirs; - absent, + present, = as base, ~ changed)', () => {
    test('row 1 (B- M- T-): nothing to decide', async () => {
        const run = await scenario({ theirs: elsewhere })
        const guard = applied(run.prepared, run.db)
        expect(Object.hasOwn(run.db, 'chatDrafts')).toBe(false)
        expect(draftGuards(guard)).toEqual([])
    })

    test('row 2 (B- M- T+): theirs is taken, guarded by the live field', async () => {
        const run = await scenario({ theirs: db => setDrafts(db, D1()) })
        const guard = applied(run.prepared, run.db)
        expect(draftsOf(run.db)).toEqual(D1())
        expect(draftGuards(guard)).toEqual([{ kind: 'field', path: 'chatDrafts', before: undefined, expected: D1() }])
    })

    test('row 3 (B- M+ T-): mine is kept', async () => {
        const run = await scenario({ mine: db => setDrafts(db, D1()), theirs: elsewhere })
        const guard = applied(run.prepared, run.db)
        expect(draftsOf(run.db)).toEqual(D1())
        expect(draftGuards(guard)).toEqual([])
    })

    test('row 4 (B- M+ T+): both added a set, so the page parks', async () => {
        const run = await scenario({ mine: db => setDrafts(db, D1()), theirs: db => setDrafts(db, D2()) })
        expect(run.prepared).toEqual({ kind: 'park', reason: 'chat-drafts' })
    })

    test('row 5 (B+ M= T=): nothing to decide', async () => {
        const run = await scenario({ base: D1(), theirs: elsewhere })
        const guard = applied(run.prepared, run.db)
        expect(draftsOf(run.db)).toEqual(D1())
        expect(draftGuards(guard)).toEqual([])
    })

    test('row 6 (B+ M= T~): theirs is taken, guarded by the digest of the base unit', async () => {
        const run = await scenario({ base: D1(), theirs: db => setDrafts(db, D2()) })
        const guard = applied(run.prepared, run.db)
        expect(draftsOf(run.db)).toEqual(D2())
        const held = run.old.units.get('chatDrafts')
        expect(held?.digest).toBeDefined()
        expect(draftGuards(guard)).toEqual([{ kind: 'unit', identity: 'chatDrafts', digest: held?.digest }])
    })

    test('row 7 (B+ M= T-): the peer removed the last draft, so the field goes, guarded by the digest of the base unit', async () => {
        const run = await scenario({ base: D1(), theirs: (db) => { delete (db as unknown as Obj).chatDrafts } })
        const guard = applied(run.prepared, run.db)
        expect(Object.hasOwn(run.db, 'chatDrafts')).toBe(false)
        expect(draftGuards(guard)).toEqual([{ kind: 'unit', identity: 'chatDrafts', digest: run.old.units.get('chatDrafts')?.digest }])
    })

    test('row 8 (B+ M~ T=): mine is kept, whether this page changed the set or emptied it', async () => {
        const changed = await scenario({ base: D1(), mine: db => setDrafts(db, D3()), theirs: elsewhere })
        expect(draftGuards(applied(changed.prepared, changed.db))).toEqual([])
        expect(draftsOf(changed.db)).toEqual(D3())
        ffTeardown()
        ffSetup()
        const emptied = await scenario({ base: D1(), mine: (db) => { delete (db as unknown as Obj).chatDrafts }, theirs: elsewhere })
        expect(draftGuards(applied(emptied.prepared, emptied.db))).toEqual([])
        expect(Object.hasOwn(emptied.db, 'chatDrafts')).toBe(false)
    })

    test('row 9 (B+ M~ T~ or T-): both changed the set, so the page parks', async () => {
        const changed = await scenario({ base: D1(), mine: db => setDrafts(db, D3()), theirs: db => setDrafts(db, D2()) })
        expect(changed.prepared).toEqual({ kind: 'park', reason: 'chat-drafts' })
        ffTeardown()
        ffSetup()
        const removed = await scenario({ base: D1(), mine: db => setDrafts(db, D3()), theirs: (db) => { delete (db as unknown as Obj).chatDrafts } })
        expect(removed.prepared).toEqual({ kind: 'park', reason: 'chat-drafts' })
    })

    test('row 10 (B+ any T+ unreadable): a unit whose body is not a list parks as chat-drafts, a damaged frame parks as structure', async () => {
        const run = await scenario({ base: D1(), theirs: db => setDrafts(db, D2()) })
        const key = keyOfRef(run.target.manifest.fixed.chatDrafts ?? ['', 0, 0])
        const bad = encodeUnit(UNIT_TYPE.chatDrafts, { v: 1, chats: 'not a list' })
        const manifest: Manifest = clone(run.target.manifest)
        manifest.fixed.chatDrafts = refOfFrame(key, bad)
        const target: StoredTree = { ...run.target, manifest, source: { get: name => (name === key ? bad : run.target.source.get(name)) } }
        const { host } = testHost()
        const prepared = await prepareFastForward({
            db: run.db, old: run.old, target, next: advancePrevious(run.old, target), host, replyOwners: new Set(), env: defaultKeyEnv, lists: fakeLists,
        })
        expect(prepared).toEqual({ kind: 'park', reason: 'chat-drafts' })

        // A frame that fails its Ref never reaches the prepare: the peer read parks it first.
        const stored = run.world.memory.snapshot().get(key) as Uint8Array
        const flipped = new Uint8Array(stored)
        flipped[FRAME_HEADER_BYTES + 1] ^= 0xff
        run.world.memory.poke(key, flipped)
        const peerKey = (await parsedKey(run.world.memory)).current?.key ?? ''
        expect(await readPeerTree(run.world.memory, peerKey, run.old)).toMatchObject({ status: 'park', reason: 'structure' })
    })
})

describe('T1.13g Guard B over the entries a take arms', () => {
    const NO_LIVE = (): undefined => undefined

    test('PIN: with a base unit a stale writer that writes the pre-take unit back is a revert, one that writes the taken unit is not', async () => {
        const run = await scenario({ base: D1(), theirs: db => setDrafts(db, D2()) })
        const guard = createGuardB(() => 0)
        guard.arm(applied(run.prepared, run.db))
        const preTake = run.old.units.get('chatDrafts')?.digest ?? ''
        expect(guard.check(new Map([['chatDrafts', preTake]]), NO_LIVE)).not.toBeNull()
        expect(guard.check(new Map([['chatDrafts', run.next.units.get('chatDrafts')?.digest ?? '']]), NO_LIVE)).toBeNull()
    })

    test('PIN: without a base unit a stale writer that drops the taken set is a revert, one that holds it is not', async () => {
        const run = await scenario({ theirs: db => setDrafts(db, D1()) })
        const guard = createGuardB(() => 0)
        guard.arm(applied(run.prepared, run.db))
        expect(guard.check(new Map(), NO_LIVE)).not.toBeNull()
        expect(guard.check(new Map(), path => (path === 'chatDrafts' ? clone(D1()) as unknown as JsonValue : undefined))).toBeNull()
    })
})

describe('T1.13 the take keeps the acknowledged encoding whole', () => {
    test('PIN: after a take the advanced previous holds the peer unit with its digest, so the next pass reuses its key', async () => {
        const run = await scenario({ base: D1(), theirs: db => setDrafts(db, D2()) })
        applied(run.prepared, run.db)
        const peerKey = keyOfRef(run.target.manifest.fixed.chatDrafts ?? ['', 0, 0])
        expect(run.next.units.get('chatDrafts')?.key).toBe(peerKey)
        expect(run.next.units.get('chatDrafts')?.digest).toBeDefined()
        expect(run.next.objects?.chatDrafts).toEqual(D2())
        const plan = await planScopedEncode(
            run.db, { env: seededEnv(5), lists: fakeLists, seq: 9, createdAt: NOW, previous: run.next }, { modules: false, characters: new Set<string>() },
        )
        expect(plan.written.has('chatDrafts')).toBe(false)
    })

    test('PIN: a peer that removed the unit leaves no identity behind, so the old unit is not copied into the advanced previous', async () => {
        const run = await scenario({ base: D1(), theirs: (db) => { delete (db as unknown as Obj).chatDrafts } })
        expect(run.old.units.has('chatDrafts')).toBe(true)
        expect(run.next.units.has('chatDrafts')).toBe(false)
        expect(run.next.objects?.chatDrafts).toBeUndefined()
    })

    test('PIN: the unit the peer wrote reads back as the peer wrote it', async () => {
        const run = await scenario({ theirs: db => setDrafts(db, D2()) })
        const key = keyOfRef(run.target.manifest.fixed.chatDrafts ?? ['', 0, 0])
        const bytes = run.target.source.get(key)
        const read = bytes === undefined ? null : readUnit(bytes, UNIT_TYPE.chatDrafts)
        expect(read?.status).toBe('ok')
        expect(read?.status === 'ok' && JSON.parse(JSON.stringify(read.value.body))).toEqual({ v: 1, chats: D2() })
    })
})
