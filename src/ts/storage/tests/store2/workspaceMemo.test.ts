// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Sha256 } from 'src/ts/assetHash'
import { previousFrom } from '../../store2/codec'
import { ChunkMemo, chunkMemoChargeOf } from '../../store2/codec/chunkMemo'
import { UNIT_TYPE, newManifestKey, newShardKey, newUnitKey } from '../../store2/format'
import { createSaveEncoder, type SaveEncoder, type SavePassRequest } from '../../store2/saveEncoder'
import type { Database } from '../../database.svelte'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The workspace file memo (#202 S1b): a file whose text is the remembered one and whose previous unit has the remembered
 * digest is taken without being framed or digested, and every adoption of an encoding prunes the memo to that encoding's
 * units. Labels: N new-rule test (proven by its scratch mutants), G guard (passes before and after).
 */

const NOW = 1_700_000_000_000
const BIG = 10_000
const FILE = UNIT_TYPE.workspaceFile

afterEach(() => {
    vi.restoreAllMocks()
})

/** Counts the SHA-256 updates of at least `minimum` bytes from now on. */
function digestSpy(minimum: number): { count: () => number, reset: () => void } {
    let calls = 0
    const original = Sha256.prototype.update
    vi.spyOn(Sha256.prototype, 'update').mockImplementation(function (this: Sha256, data: Uint8Array) {
        if (data.length >= minimum) {
            calls++
        }
        return original.call(this, data)
    })
    return { count: () => calls, reset: () => { calls = 0 } }
}

function mintOf(seed: number) {
    const env = seededEnv(seed)
    return { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) }
}

function file(id: string, path: string, text: string): Obj {
    return { id, path, text, size: new TextEncoder().encode(text).length, mtime: 5 }
}

const LONG = 'a'.repeat(30_000)

function dbWith(workspaces: Obj[]): Database {
    return asDatabase({ ...JSON.parse(JSON.stringify(buildSmall(1))) as Obj, utilityWorkspaces: workspaces })
}

const WS = (files: Obj[], id = 'w1'): Obj => ({ id, name: `W ${id}`, createdAt: 1, files })
const TWO = (second = 'note'): Obj[] => [file('f1', 'AGENTS.md', LONG), file('f2', 'notes/a.md', second)]

function encoderOf(db: Database): SaveEncoder {
    return createSaveEncoder({ previous: previousFrom(encodeWith(db)), lists: fakeLists, env: seededEnv(77), now: () => NOW })
}

interface Pass {
    /** SHA-256 updates of at least `BIG` bytes the plan made. */
    big: number
    /** The identities whose key changed on the acknowledged encoding. */
    written: string[]
}

let attempt = 0

/** One pass the way a committed attempt runs it: plan, build, acknowledge. */
async function commit(encoder: SaveEncoder, spy: { count: () => number, reset: () => void }, db: Database, extra: Partial<SavePassRequest> = {}): Promise<Pass> {
    const before = encoder.acknowledged()
    spy.reset()
    const plan = await encoder.plan(db, { marked: new Set(), modules: false, whole: false, ...extra })
    const big = spy.count()
    plan.commitRequest().build({ mint: mintOf(500 + ++attempt), seq: 2 + attempt, now: NOW })
    plan.acknowledge()
    const after = encoder.acknowledged()
    const written = [...after.units].filter(([identity, unit]) => before.units.get(identity)?.key !== unit.key).map(([identity]) => identity).sort()
    return { big, written }
}

describe('T3 workspace memo in the save encoder', () => {
    test('N: the first pass after boot digests every file; an unchanged pass digests none and writes no workspace unit', async () => {
        const db = dbWith([WS(TWO(LONG + 'b'))])
        const encoder = encoderOf(db)
        const spy = digestSpy(BIG)
        const first = await commit(encoder, spy, db)
        expect(first.big).toBeGreaterThanOrEqual(2)
        expect(encoder.workspaceMemoStats().entries).toBe(2)
        const second = await commit(encoder, spy, db)
        expect(second.big).toBe(0)
        expect(second.written.filter(identity => identity.startsWith('ws'))).toEqual([])
    })

    test('N: an edit digests only the edited file and writes that file and its record', async () => {
        const encoder = encoderOf(dbWith([WS(TWO())]))
        const spy = digestSpy(BIG)
        await commit(encoder, spy, dbWith([WS(TWO())]))
        const edited = await commit(encoder, spy, dbWith([WS(TWO('changed'))]))
        expect(edited.big).toBe(0)
        expect(edited.written.filter(identity => identity.startsWith('ws'))).toEqual(['ws:w1', 'wsf:w1:f2'])
        const long = await commit(encoder, spy, dbWith([WS([file('f1', 'AGENTS.md', LONG + 'x'), ...TWO('changed').slice(1)])]))
        expect(long.big).toBeGreaterThanOrEqual(1)
        expect(long.written.filter(identity => identity.startsWith('ws'))).toEqual(['ws:w1', 'wsf:w1:f1'])
    })

    test('N: an edit planned and built but never acknowledged is written by the next pass, not taken from the memo', async () => {
        const original = dbWith([WS(TWO())])
        const edited = dbWith([WS(TWO('changed'))])
        const encoder = encoderOf(original)
        const spy = digestSpy(BIG)
        await commit(encoder, spy, original)
        const failed = await encoder.plan(edited, { marked: new Set(), modules: false, whole: false })
        failed.commitRequest().build({ mint: mintOf(900), seq: 50, now: NOW })
        const retried = await commit(encoder, spy, edited)
        expect(retried.written.filter(identity => identity.startsWith('ws'))).toEqual(['ws:w1', 'wsf:w1:f2'])
    })

    test('N: rewriteAll digests every file again and writes none under the old key', async () => {
        const db = dbWith([WS(TWO())])
        const encoder = encoderOf(db)
        const spy = digestSpy(BIG)
        await commit(encoder, spy, db)
        const warm = await commit(encoder, spy, db)
        expect(warm.big).toBe(0)
        const all = await commit(encoder, spy, db, { rewriteAll: true })
        expect(all.big).toBeGreaterThanOrEqual(1)
        expect(all.written).toEqual(expect.arrayContaining(['ws:w1', 'wsf:w1:f1', 'wsf:w1:f2']))
    })

    test('N: a reboot keeps every key: an unchanged pass from the boot encoding writes no workspace unit', async () => {
        const db = dbWith([WS(TWO())])
        const tree = encodeWith(db)
        const encoder = createSaveEncoder({ previous: previousFrom(tree), lists: fakeLists, env: seededEnv(78), now: () => NOW })
        const pass = await commit(encoder, digestSpy(BIG), db)
        expect(pass.written.filter(identity => identity.startsWith('ws'))).toEqual([])
    })

    test('N: deleting a file, then a workspace, drops its entries at the adoption', async () => {
        const encoder = encoderOf(dbWith([WS(TWO()), WS([file('g1', 'x.md', 'xx')], 'w2')]))
        const spy = digestSpy(BIG)
        await commit(encoder, spy, dbWith([WS(TWO()), WS([file('g1', 'x.md', 'xx')], 'w2')]))
        expect(encoder.workspaceMemoStats().entries).toBe(3)
        await commit(encoder, spy, dbWith([WS([file('f1', 'AGENTS.md', LONG)]), WS([file('g1', 'x.md', 'xx')], 'w2')]))
        expect(encoder.workspaceMemoStats().entries).toBe(2)
        await commit(encoder, spy, dbWith([WS([file('f1', 'AGENTS.md', LONG)])]))
        expect(encoder.workspaceMemoStats()).toEqual({ entries: 1, charged: chunkMemoChargeOf(LONG) })
        await commit(encoder, spy, dbWith([]))
        expect(encoder.workspaceMemoStats()).toEqual({ entries: 0, charged: 0 })
    })

    test('N: adoption of a pending encoding and a fast-forward prune the memo the same way', async () => {
        const db = dbWith([WS(TWO())])
        const empty = dbWith([])
        const encoder = encoderOf(db)
        const spy = digestSpy(BIG)
        await commit(encoder, spy, db)
        expect(encoder.workspaceMemoStats().entries).toBe(2)

        const pending = await encoder.plan(empty, { marked: new Set(), modules: false, whole: false })
        pending.commitRequest().build({ mint: mintOf(901), seq: 60, now: NOW })
        pending.keepAsPending()
        expect(encoder.workspaceMemoStats().entries).toBe(2)
        expect(encoder.adoptIfCurrent(encoder.pendingKey as string)).toBe(true)
        expect(encoder.workspaceMemoStats().entries).toBe(0)

        const again = encoderOf(db)
        await commit(again, spy, db)
        expect(again.workspaceMemoStats().entries).toBe(2)
        again.fastForward(previousFrom(encodeWith(empty)))
        expect(again.workspaceMemoStats().entries).toBe(0)
    })

    test('N: a file the pass carried (no text) keeps its memo entry, because the adopted encoding still holds its unit', async () => {
        const db = dbWith([WS(TWO())])
        const encoder = encoderOf(db)
        const spy = digestSpy(BIG)
        await commit(encoder, spy, db)
        const noText = { ...file('f2', 'notes/a.md', 'note') }
        delete noText.text
        await commit(encoder, spy, dbWith([WS([file('f1', 'AGENTS.md', LONG), noText])]))
        expect(encoder.workspaceMemoStats().entries).toBe(2)
        const back = await commit(encoder, spy, db)
        expect(back.written.filter(identity => identity.startsWith('ws'))).toEqual([])
    })

    test('G: a store with no workspace has an empty memo and the same passes as before', async () => {
        const db = dbWith([])
        const encoder = encoderOf(db)
        await commit(encoder, digestSpy(BIG), db)
        expect(encoder.workspaceMemoStats()).toEqual({ entries: 0, charged: 0 })
    })
})

describe('T3c ChunkMemo.retainOnly', () => {
    const at = (workspace: string, file: string): string => `wsf:${workspace}:${file}`

    test('N: dropped entries give back their charge and their lookups; an emptied bucket is dropped', () => {
        const memo = new ChunkMemo()
        memo.remember(at('w1', 'a'), FILE, 'aaaa', 'd1')
        memo.remember(at('w1', 'b'), FILE, 'bbbbbb', 'd2')
        memo.remember(at('w2', 'c'), FILE, 'cc', 'd3')
        memo.retainOnly(identity => identity !== at('w1', 'b'))
        expect(memo.stats()).toEqual({ entries: 2, charged: chunkMemoChargeOf('aaaa') + chunkMemoChargeOf('cc') })
        expect(memo.digestOf(at('w1', 'b'), FILE, 'bbbbbb')).toBeUndefined()
        expect(memo.digestOf(at('w1', 'a'), FILE, 'aaaa')).toBe('d1')
        memo.retainOnly(identity => !identity.includes(':w2:'))
        expect(memo.stats()).toEqual({ entries: 1, charged: chunkMemoChargeOf('aaaa') })
        memo.retainOnly(() => false)
        expect(memo.stats()).toEqual({ entries: 0, charged: 0 })
    })

    test('N: the freed charge is available again under the caps', () => {
        const text = 'x'.repeat(500)
        const charge = chunkMemoChargeOf(text)
        const memo = new ChunkMemo(charge, charge * 2)
        expect(memo.remember(at('w1', 'a'), FILE, text, 'd')).toBe(true)
        expect(memo.remember(at('w2', 'a'), FILE, text, 'd')).toBe(true)
        memo.retainOnly(identity => identity === at('w2', 'a'))
        expect(memo.remember(at('w1', 'a'), FILE, text, 'd')).toBe(true)
        // Nothing was evicted to make room: the charge of the dropped entry had left the total.
        expect(memo.digestOf(at('w2', 'a'), FILE, text)).toBe('d')
        expect(memo.stats()).toEqual({ entries: 2, charged: charge * 2 })
    })

    test('N: the freed charge is available again in the same workspace under the per-workspace cap', () => {
        const text = 'x'.repeat(500)
        const charge = chunkMemoChargeOf(text)
        const memo = new ChunkMemo(charge * 2, charge * 10)
        expect(memo.remember(at('w1', 'a'), FILE, text, 'd')).toBe(true)
        expect(memo.remember(at('w1', 'b'), FILE, text, 'd')).toBe(true)
        expect(memo.remember(at('w1', 'c'), FILE, text, 'd')).toBe(false)
        memo.retainOnly(identity => identity !== at('w1', 'b'))
        expect(memo.remember(at('w1', 'c'), FILE, text, 'd')).toBe(true)
        expect(memo.stats()).toEqual({ entries: 2, charged: charge * 2 })
    })

    test('G: keeping everything changes nothing', () => {
        const memo = new ChunkMemo()
        memo.remember(at('w1', 'a'), FILE, 'aaaa', 'd1')
        const before = memo.stats()
        memo.retainOnly(() => true)
        expect(memo.stats()).toEqual(before)
    })
})
