import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const compare = vi.hoisted(() => ({ throws: false }))

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
// Passes every call through; while `compare.throws` is on, the compare of two draft lists fails the way an exhausted stack does.
vi.mock(import('src/ts/storage/store2/codec/normalize'), async (importOriginal) => {
    const actual = await importOriginal()
    const isDraftList = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'cha' in value[0]
    return {
        ...actual,
        sameJsonValue: (a: unknown, b: unknown): boolean => {
            if (compare.throws && isDraftList(a) && isDraftList(b)) {
                throw new RangeError('Maximum call stack size exceeded')
            }
            return actual.sameJsonValue(a, b)
        },
    }
})

import type { Database } from 'src/ts/storage/database.svelte'
import { Sha256 } from 'src/ts/assetHash'
import { DBState } from 'src/ts/stores.svelte'
import { draftContentOrphanGate } from 'src/ts/draftContentOrphanGate'
import { flushChatDrafts } from 'src/ts/chatDraftStore'
import type { MessageIdentity } from 'src/ts/draftContents'
import type { UnitWrite } from 'src/ts/storage/store2/backend/types'
import { previousFrom, unitDigest, unitsToWrite, type PreviousEncoding } from 'src/ts/storage/store2/codec'
import type { BuildContext, BuiltCommit } from 'src/ts/storage/store2/commit'
import { advancePrevious } from 'src/ts/storage/store2/fastForward/advancePrevious'
import { encodeUnit, keyOfRef, newManifestKey, newShardKey, newUnitKey, refOfFrame, UNIT_TYPE } from 'src/ts/storage/store2/format'
import { previousOfTree, type StoredTree } from 'src/ts/storage/store2/previousOfTree'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest, type SavePlan } from 'src/ts/storage/store2/saveEncoder'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, unitOf, type Obj } from './codecFixtures'

/**
 * The draft unit's encode memo (#609): an unchanged draft list takes the previous unit without canonical JSON, UTF-8,
 * framing or hashing, and every change of the canonical body is still written. Labels: R regression reproducer (fails on
 * the memo-less encoder through its count assertions only), G compatibility guard (passes with and without the memo).
 * A pass follows the save loop's protocol: an unchanged plan is neither built nor acknowledged; any other is built and
 * acknowledged unless the row simulates a failure.
 */

const NOW = 1_700_000_000_000
const BH = '0123456789abcdef0123456789abcdef'
/** The draft frame must stay above this many bytes so one hash or one UTF-8 conversion of it is countable. */
const FRAME_FLOOR = 10_000

interface Counts { hash: number, encode: number }
const ZERO: Counts = { hash: 0, encode: 0 }
const ONE: Counts = { hash: 1, encode: 1 }

const calls = { hash: 0, encode: 0 }
beforeEach(() => {
    calls.hash = 0
    calls.encode = 0
    const update = Sha256.prototype.update
    vi.spyOn(Sha256.prototype, 'update').mockImplementation(function (this: Sha256, data: Uint8Array) {
        if (data.length >= FRAME_FLOOR) calls.hash++
        return update.call(this, data)
    })
    const encode = globalThis.TextEncoder.prototype.encode
    vi.spyOn(globalThis.TextEncoder.prototype, 'encode').mockImplementation(function (this: TextEncoder, input?: string) {
        if (input !== undefined && input.length >= FRAME_FLOOR) calls.encode++
        return encode.call(this, input)
    })
})
afterEach(() => {
    compare.throws = false
    vi.restoreAllMocks()
})

function take(): Counts {
    const counts = { hash: calls.hash, encode: calls.encode }
    calls.hash = 0
    calls.encode = 0
    return counts
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}

/** Three entries of four 3 KB drafts: about 36 KB, so any delete or edit of one item leaves the frame above the floor. */
function draftsOf(fill = 'a'): Obj[] {
    return [0, 1, 2].map(e => ({
        cha: `c${e}`,
        chat: `k${e}`,
        shown: true,
        drafts: [0, 1, 2, 3].map(i => ({ m: `id:${e}${i}`, text: fill.repeat(3000) + i, bh: BH, at: NOW + i })),
    }))
}

const SMALL = JSON.stringify(buildSmall(1))

function dbOf(chatDrafts: unknown): Database {
    return asDatabase({ ...JSON.parse(SMALL) as Obj, ...(chatDrafts === undefined ? {} : { chatDrafts }) })
}

function liveOf(db: Database): Obj[] {
    return (db as unknown as Obj).chatDrafts as Obj[]
}

function setLive(db: Database, value: unknown): void {
    ;(db as unknown as Obj).chatDrafts = value
}

function stored(db: Database, previous: PreviousEncoding | null = null, seed = 1): StoredTree {
    const tree = encodeWith(db, { previous, env: seededEnv(seed) })
    const bytes = new Map(unitsToWrite(tree).map(unit => [unit.key, unit.bytes]))
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source: { get: key => bytes.get(key) } }
}

function createEncoder(previous: PreviousEncoding): SaveEncoder {
    return createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(78), now: () => 1 })
}

const REQUEST: SavePassRequest = { marked: new Set(), modules: false, whole: false }

let seq = 1
function buildContext(): BuildContext {
    seq++
    const env = seededEnv(seq + 900)
    return { mint: { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) }, seq, now: 1 }
}

interface Rig {
    encoder: SaveEncoder
    db: Database
    /** The list the database holds: a `$state` proxy when the rig was made reactive. */
    live: Obj[]
}

/** An encoder booted on the stored tree of `value`, over a database whose live list is `value` (a proxy, or the plain list). */
function boot(options: { reactive?: boolean, value?: Obj[] } = {}): Rig {
    const value = options.value ?? draftsOf()
    const encoder = createEncoder(previousOfTree(stored(dbOf(clone(value)))))
    const db = dbOf(undefined)
    const source = clone(value)
    const proxy = $state(source)
    expect(proxy).not.toBe(source)
    const live = options.reactive === false ? source : proxy
    setLive(db, live)
    return { encoder, db, live }
}

interface Pass {
    plan: SavePlan
    counts: Counts
    built: BuiltCommit | null
}

/** Plans once, counting the big hashes and UTF-8 conversions of the plan alone. */
async function pass(rig: Rig, options: { settle?: 'ack' | 'fail' | 'pending' | 'none', request?: Partial<SavePassRequest> } = {}): Promise<Pass> {
    take()
    const plan = await rig.encoder.plan(rig.db, { ...REQUEST, ...options.request })
    const counts = take()
    const settle = options.settle ?? 'ack'
    if (plan.unchanged || settle === 'none') {
        return { plan, counts, built: null }
    }
    const built = await plan.commitRequest().build(buildContext())
    if (settle === 'ack') {
        plan.acknowledge()
    } else if (settle === 'pending') {
        plan.keepAsPending()
    }
    return { plan, counts, built }
}

function draftKeyOf(encoder: SaveEncoder): string | undefined {
    return encoder.acknowledged().units.get('chatDrafts')?.key
}

function draftUnitOf(built: BuiltCommit | null): UnitWrite | undefined {
    const ref = built?.manifest.body.fixed.chatDrafts
    return ref === undefined ? undefined : built?.units.find(unit => unit.key === keyOfRef(ref))
}

/** The warm-up every row starts with: the first pass after boot frames the unit once, the next two take it (guard rows skip the count). */
async function warmUp(rig: Rig, counted = true): Promise<void> {
    const counts: Counts[] = []
    for (let i = 0; i < 3; i++) {
        const next = await pass(rig)
        expect(next.plan.unchanged).toBe(true)
        counts.push(next.counts)
    }
    if (counted) {
        expect.soft(counts).toEqual([ONE, ZERO, ZERO])
    }
}

/**
 * One mutation of a warm rig: the pass is not unchanged, writes the draft unit under a new key with exactly the bytes a full
 * encode of the live value produces, and the pass after the acknowledgement is unchanged and frames nothing.
 */
async function changeStep(rig: Rig, mutate: () => void): Promise<void> {
    const before = draftKeyOf(rig.encoder)
    mutate()
    const changed = await pass(rig)
    expect(changed.plan.unchanged).toBe(false)
    const unit = draftUnitOf(changed.built)
    expect(unit).toBeDefined()
    expect(unit?.key).not.toBe(before)
    expect(unit?.bytes).toEqual((unitOf(encodeWith(rig.db), 'chatDrafts') as { bytes: Uint8Array }).bytes)
    const next = await pass(rig)
    expect(next.plan.unchanged).toBe(true)
    expect.soft(next.counts).toEqual(ZERO)
}

describe('T1: every kind of change to the live list is written, and an unchanged list frames nothing', () => {
    test('T1a (R): an entry added, a draft added', async () => {
        const rig = boot()
        await warmUp(rig)
        await changeStep(rig, () => { rig.live.push({ cha: 'c9', chat: 'k9', drafts: [{ m: 'id:99', text: 'new', bh: BH, at: NOW }] }) })
        await changeStep(rig, () => { (rig.live[0].drafts as Obj[]).push({ m: 'id:05', text: 'more', bh: BH, at: NOW }) })
    })

    test('T1b (R): text at the same length, `at`, `bh`, the last entry and an entry key, edited in place', async () => {
        const rig = boot()
        await warmUp(rig)
        await changeStep(rig, () => { (rig.live[1].drafts as Obj[])[1].text = 'b'.repeat(3000) + '1' })
        await changeStep(rig, () => { (rig.live[1].drafts as Obj[])[1].at = NOW + 77 })
        await changeStep(rig, () => { (rig.live[1].drafts as Obj[])[1].bh = 'f'.repeat(32) })
        await changeStep(rig, () => { (rig.live[2].drafts as Obj[])[3].text = 'z'.repeat(3000) + '3' })
        await changeStep(rig, () => { rig.live[1].cha = 'moved' })
    })

    test('T1c (R): a draft deleted, an entry deleted', async () => {
        const rig = boot()
        await warmUp(rig)
        await changeStep(rig, () => { (rig.live[0].drafts as Obj[]).splice(0, 1) })
        await changeStep(rig, () => { rig.live.splice(2, 1) })
    })

    test('T1d (R): clearing by delete and by an empty list writes no unit, and a clear that is undone before a build keeps the key', async () => {
        for (const clear of [(db: Database) => { delete (db as unknown as Obj).chatDrafts }, (db: Database) => { setLive(db, []) }]) {
            const rig = boot()
            await warmUp(rig)
            clear(rig.db)
            const cleared = await pass(rig)
            expect(cleared.plan.unchanged).toBe(false)
            expect(cleared.built?.manifest.body.fixed.chatDrafts).toBeUndefined()
            expect(draftKeyOf(rig.encoder)).toBeUndefined()
            setLive(rig.db, rig.live)
            const restored = await pass(rig)
            expect(restored.plan.unchanged).toBe(false)
            expect(draftUnitOf(restored.built)).toBeDefined()
        }
        const rig = boot()
        await warmUp(rig)
        const key = draftKeyOf(rig.encoder)
        delete (rig.db as unknown as Obj).chatDrafts
        const cleared = await pass(rig, { settle: 'none' })
        expect(cleared.plan.unchanged).toBe(false)
        setLive(rig.db, rig.live)
        const undone = await pass(rig)
        expect(undone.plan.unchanged).toBe(true)
        expect(draftKeyOf(rig.encoder)).toBe(key)
        expect.soft(undone.counts).toEqual(ONE)
        const after = await pass(rig)
        expect.soft(after.counts).toEqual(ZERO)
    })

    test('T1f (R): a shown flag cleared, set, and a flag-only entry', async () => {
        const rig = boot()
        await warmUp(rig)
        await changeStep(rig, () => { delete rig.live[1].shown })
        await changeStep(rig, () => { rig.live[1].shown = true })
        await changeStep(rig, () => { rig.live.push({ cha: 'f', chat: 'f', shown: true }) })
    })

    test('T1g (R): entries reordered, drafts reordered', async () => {
        const rig = boot()
        await warmUp(rig)
        await changeStep(rig, () => { rig.live.reverse() })
        await changeStep(rig, () => { (rig.live[0].drafts as Obj[]).reverse() })
    })

    test('T1h (R): an unknown field added, a nested change of it', async () => {
        const rig = boot()
        await warmUp(rig)
        await changeStep(rig, () => { (rig.live[0].drafts as Obj[])[0].extra = { list: [1] } })
        await changeStep(rig, () => { ((((rig.live[0].drafts as Obj[])[0].extra) as Obj).list as number[])[0] = 2 })
    })

    test('T1 on a plain list: the same, with no proxy in between', async () => {
        const rig = boot({ reactive: false })
        await warmUp(rig)
        await changeStep(rig, () => { (rig.live[0].drafts as Obj[])[0].text = 'c'.repeat(3000) + '0' })
    })
})

describe('T1e (R): the 200-draft cap through the real gate and store', () => {
    function identity(key: string): MessageIdentity {
        return { kind: 'msg', chatKey: 'window', chatId: key, index: 0, persist: { chaId: 'cha', chatId: 'chat' } }
    }
    function enter(index: number): void {
        draftContentOrphanGate.set(identity(`m${String(index).padStart(3, '0')}`), `draft ${String(index).padStart(3, '0')} ${'x'.repeat(60)}`, 'base', NOW + index)
    }

    test('the 201st draft evicts the oldest, and the evicting pass writes bytes equal to a full encode', async () => {
        const db = dbOf(undefined)
        ;(DBState as { db: unknown }).db = db
        for (let index = 0; index < 200; index++) {
            enter(index)
        }
        flushChatDrafts()
        expect(JSON.stringify(liveOf(db)).length).toBeGreaterThan(FRAME_FLOOR)
        const encoder = createEncoder(previousOfTree(stored(clone(db))))
        const rig: Rig = { encoder, db, live: liveOf(db) }
        await warmUp(rig)

        enter(200)
        flushChatDrafts()
        const text = JSON.stringify(liveOf(db))
        expect(text).not.toContain('draft 000 ')
        expect(text).toContain('draft 200 ')
        const changed = await pass(rig)
        expect(changed.plan.unchanged).toBe(false)
        expect(draftUnitOf(changed.built)?.bytes).toEqual((unitOf(encodeWith(db), 'chatDrafts') as { bytes: Uint8Array }).bytes)
        const next = await pass(rig)
        expect(next.plan.unchanged).toBe(true)
        expect.soft(next.counts).toEqual(ZERO)
    })
})

describe('T2 (R): a fast-forward onto a peer commit', () => {
    test('a changed draft key frames once and then never; an unchanged key frames nothing', async () => {
        const base = stored(dbOf(draftsOf()))
        for (const peerChangesDrafts of [true, false]) {
            const rig: Rig = { encoder: createEncoder(previousOfTree(base)), db: dbOf(draftsOf()), live: [] }
            await pass(rig)
            const acknowledged = rig.encoder.acknowledged()
            const peerDb = dbOf(peerChangesDrafts ? draftsOf('b') : draftsOf())
            peerDb.temperature = 33
            const peer = stored(peerDb, acknowledged, 44)
            rig.encoder.fastForward(advancePrevious(acknowledged, peer))
            if (peerChangesDrafts) {
                setLive(rig.db, draftsOf('b'))
            }
            rig.db.temperature = 33
            const counts: Counts[] = []
            for (let i = 0; i < 3; i++) {
                const next = await pass(rig)
                expect(next.plan.unchanged).toBe(true)
                counts.push(next.counts)
            }
            expect.soft(counts, `peer changes drafts: ${peerChangesDrafts}`).toEqual(peerChangesDrafts ? [ONE, ZERO, ZERO] : [ZERO, ZERO, ZERO])
        }
    })
})

describe('T3 (R): the front verdict', () => {
    test('after boot it frames once, then the plan after it frames nothing', async () => {
        const rig = boot()
        const counts: Counts[] = []
        for (let i = 0; i < 3; i++) {
            take()
            expect(await rig.encoder.frontVerdictOf(rig.db)).toBe('clean')
            counts.push(take())
        }
        const next = await pass(rig)
        expect(next.plan.unchanged).toBe(true)
        expect.soft(counts).toEqual([ONE, ZERO, ZERO])
        expect.soft(next.counts).toEqual(ZERO)
    })

    test('after a plan the front verdict frames nothing', async () => {
        const rig = boot()
        const first = await pass(rig)
        expect(first.plan.unchanged).toBe(true)
        take()
        expect(await rig.encoder.frontVerdictOf(rig.db)).toBe('clean')
        expect.soft(take()).toEqual(ZERO)
    })
})

describe('T5 (R): commits that do not touch the drafts, and a rewrite of everything', () => {
    test('an unrelated commit and the pass after it frame nothing; rewriteAll frames once under a new key', async () => {
        const rig = boot()
        await warmUp(rig)
        const key = draftKeyOf(rig.encoder)
        rig.db.temperature = 31
        const unrelated = await pass(rig)
        expect(unrelated.plan.unchanged).toBe(false)
        expect.soft(unrelated.counts).toEqual(ZERO)
        const after = await pass(rig)
        expect(after.plan.unchanged).toBe(true)
        expect.soft(after.counts).toEqual(ZERO)
        expect(draftKeyOf(rig.encoder)).toBe(key)

        const rewrite = await pass(rig, { request: { rewriteAll: true } })
        expect(rewrite.plan.unchanged).toBe(false)
        expect.soft(rewrite.counts).toEqual(ONE)
        expect(draftKeyOf(rig.encoder)).not.toBe(key)
        const settled = await pass(rig)
        expect(settled.plan.unchanged).toBe(true)
        expect.soft(settled.counts).toEqual(ZERO)
    })
})

describe('T6 (G): a plan that is not acknowledged never lets a changed list be taken for the saved one', () => {
    test('a failed commit, then the retry, writes the edit', async () => {
        const rig = boot()
        await warmUp(rig, false)
        ;(rig.live[0].drafts as Obj[])[0].text = 'q'.repeat(3000) + '0'
        const failed = await pass(rig, { settle: 'fail' })
        expect(failed.plan.written.has('chatDrafts')).toBe(true)
        const retry = await pass(rig)
        expect(retry.plan.unchanged).toBe(false)
        expect(retry.plan.written.has('chatDrafts')).toBe(true)
        expect(draftUnitOf(retry.built)?.bytes).toEqual((unitOf(encodeWith(rig.db), 'chatDrafts') as { bytes: Uint8Array }).bytes)
    })

    test('a pending attempt, then the plan over the old base, writes the edit; the adoption then settles it', async () => {
        const rig = boot()
        await warmUp(rig, false)
        ;(rig.live[0].drafts as Obj[])[0].text = 'q'.repeat(3000) + '0'
        const pending = await pass(rig, { settle: 'pending' })
        expect(pending.plan.written.has('chatDrafts')).toBe(true)
        const key = rig.encoder.pendingKey
        const during = await rig.encoder.plan(rig.db, REQUEST)
        expect(during.unchanged).toBe(false)
        expect(during.written.has('chatDrafts')).toBe(true)
        expect(rig.encoder.adoptIfCurrent(key ?? '')).toBe(true)
        const after = await pass(rig)
        expect(after.plan.unchanged).toBe(true)
        expect(draftKeyOf(rig.encoder)).toBeDefined()
    })

    test('a failed edit that is then undone is unchanged and keeps the saved key', async () => {
        const rig = boot()
        await warmUp(rig, false)
        const key = draftKeyOf(rig.encoder)
        const text = (rig.live[0].drafts as Obj[])[0].text
        ;(rig.live[0].drafts as Obj[])[0].text = 'q'.repeat(3000) + '0'
        const failed = await pass(rig, { settle: 'fail' })
        expect(failed.plan.unchanged).toBe(false)
        ;(rig.live[0].drafts as Obj[])[0].text = text
        const undone = await pass(rig)
        expect(undone.plan.unchanged).toBe(true)
        expect(draftKeyOf(rig.encoder)).toBe(key)
    })
})

describe('T7 (G): a stored unit that is not the canonical frame of its list is rewritten', () => {
    test('a stored body with an extra field is written by two plans in a row', async () => {
        const tree = encodeWith(dbOf(draftsOf()))
        const unit = unitOf(tree, 'chatDrafts')
        const previous = previousFrom(tree)
        const extra = encodeUnit(UNIT_TYPE.chatDrafts, { v: 1, chats: draftsOf(), extra: 'kept by a newer build' })
        const units = new Map(previous.units)
        units.set('chatDrafts', { key: unit.key, type: UNIT_TYPE.chatDrafts, ref: refOfFrame(unit.key, extra), digest: unitDigest(extra) })
        const rig: Rig = { encoder: createEncoder({ ...previous, units }), db: dbOf(draftsOf()), live: [] }
        const first = await pass(rig, { settle: 'fail' })
        const second = await pass(rig, { settle: 'fail' })
        expect(first.plan.written.has('chatDrafts')).toBe(true)
        expect(second.plan.written.has('chatDrafts')).toBe(true)
    })
})

describe('T8 (G): a trailing hole fails the pass as it always did', () => {
    test.each([['plain', false], ['proxy', true]])('%s list: the canonical writer refuses it', async (_label, reactive) => {
        const rig = boot({ reactive })
        await warmUp(rig, false)
        rig.live.length++
        await expect(rig.encoder.plan(rig.db, REQUEST)).rejects.toThrow('A undefined is not JSON.')
    })
})

describe('T10 (G): a compare that throws counts as not equal', () => {
    test('the unchanged pass still plans, frames once and keeps the key; a changed pass still writes', async () => {
        const rig = boot()
        await warmUp(rig, false)
        const key = draftKeyOf(rig.encoder)
        compare.throws = true
        const unchanged = await pass(rig)
        expect(unchanged.plan.unchanged).toBe(true)
        expect.soft(unchanged.counts).toEqual(ONE)
        expect(draftKeyOf(rig.encoder)).toBe(key)
        await changeStepWithThrowingCompare(rig)
    })

    async function changeStepWithThrowingCompare(rig: Rig): Promise<void> {
        ;(rig.live[0].drafts as Obj[])[0].text = 'w'.repeat(3000) + '0'
        const changed = await pass(rig)
        expect(changed.plan.unchanged).toBe(false)
        expect(draftUnitOf(changed.built)?.bytes).toEqual((unitOf(encodeWith(rig.db), 'chatDrafts') as { bytes: Uint8Array }).bytes)
    }
})
