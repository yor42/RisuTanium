// @vitest-environment node
/**
 * The verification half of a `.rtb` restore (CHORE-128 S11, V), through `verifyRtb`. Files are written by the real
 * `writeRtb` over stores encoded by the real producer, a later writer's rows are made by re-packing a real file, and the
 * file is read back by the real classifier, container reader, block decoder and unit parser. Nothing here writes.
 *
 * Labels: every test is a compatibility guard of a new contract (no pre-fix base: main has no `.rtb` restore); each turns
 * red on a named scratch mutant, not on a pre-fix run. A mocked `readEntry` wrapper only records which entries are read.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { assetEntryName } from 'src/ts/drive/rtb/assetName'
import { inlayEntryNames } from 'src/ts/drive/rtb/inlayEntries'
import { SNIFF_BYTES } from 'src/ts/drive/rtb/sniff'
import { verifyRtb, type RtbVerdict, type VerifiedRtb, type VerifyOptions } from 'src/ts/drive/rtb/rtbVerify'
import { encodeBlock } from 'src/ts/drive/rtb/unitBlocks'
import { readDirectory } from 'src/ts/drive/rtb/zip64Reader'
import { encodeUnit, readUnit, refOfFrame, tailOfKey, UNIT_TYPE, type Manifest, type Shard, type UnitType } from 'src/ts/storage/store2/format'
import { damagedFrame, newerTypeFrame, nonCanonicalFrame, rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import {
    dataRangeOf, inlayFixture, loggedSource, reframedPayload, repackRtb, withBrokenCrc, withBrokenDeflate, writeRtbFile,
    type Amend,
} from './rtbRestoreFixtures'
import { decodeSegmentList, rangeSourceOfBytes, sparseSourceOfRuns } from './sparseSource'
import * as fs from 'node:fs'
import * as path from 'node:path'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const reads = vi.hoisted(() => ({ entries: [] as number[] }))
vi.mock('src/ts/drive/rtb/zip64Reader', async (importOriginal) => {
    const real = await importOriginal<typeof import('src/ts/drive/rtb/zip64Reader')>()
    return {
        ...real,
        readEntry: async (...args: Parameters<typeof real.readEntry>) => {
            reads.entries.push(args[2])
            return await real.readEntry(...args)
        },
    }
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const INLAY_ID = '0123abcd-0123-4123-a123-0123456789ab'

let world: RtbWorld
let staleWorld: RtbWorld
let plain: Uint8Array

beforeAll(async () => {
    world = await rtbWorld({ layout: 1 })
    staleWorld = await rtbWorld({ layout: 1, nonCanonical: true })
    plain = (await writeRtbFile({ world })).bytes
})

beforeEach(() => {
    reads.entries.length = 0
})

async function verify(bytes: Uint8Array, options: VerifyOptions = {}): Promise<RtbVerdict> {
    return await verifyRtb(rangeSourceOfBytes(bytes), options)
}

function verified(verdict: RtbVerdict): VerifiedRtb {
    if (verdict.kind !== 'ok') {
        throw new Error(`expected an accepted file, got ${JSON.stringify(verdict)}`)
    }
    return verdict.verified
}

async function namesOf(bytes: Uint8Array): Promise<string[]> {
    const walk = await readDirectory(rangeSourceOfBytes(bytes))
    const index = walk.index
    if (!index) {
        throw new Error('no index')
    }
    return Array.from({ length: index.count }, (_, i) => index.name(i))
}

function iterate<T>(items: readonly T[]): AsyncGenerator<T> {
    return (async function* () {
        yield* items
    })()
}

function manifestOf(world: RtbWorld, frame?: Uint8Array): Manifest {
    const parsed = readUnit(frame ?? world.store.get(world.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error('the manifest does not parse')
    }
    return JSON.parse(JSON.stringify(parsed.value.body)) as Manifest
}

/** The shard of `world` that names a chat chunk, re-framed after `change` edited its first chunk Ref, with the manifest that names the new shard. */
function plantChunkRef(world: RtbWorld, change: (ref: unknown[]) => unknown[]): Map<string, Uint8Array | null> {
    const manifest = manifestOf(world)
    for (const [position, shardRef] of manifest.shards.entries()) {
        const key = `store2/${shardRef[0]}`
        const parsed = readUnit(world.store.get(key) as Uint8Array, UNIT_TYPE.shard)
        if (parsed.status !== 'ok' && parsed.status !== 'stale') {
            continue
        }
        const shard = JSON.parse(JSON.stringify(parsed.value.body)) as Shard
        const entry = shard.entries.find((candidate) => candidate.chats.length > 0)
        if (entry === undefined) {
            continue
        }
        entry.chats[0].chunks[0] = change(entry.chats[0].chunks[0] as unknown[]) as never
        const frame = nonCanonicalFrame(UNIT_TYPE.shard, shard)
        manifest.shards[position] = refOfFrame(key, frame)
        return new Map([[key, frame], [world.manifestKey, encodeUnit(UNIT_TYPE.manifest, manifest)]])
    }
    throw new Error('the world has no shard with a chat')
}

function keyOf(world: RtbWorld, type: UnitType, nth = 0): string {
    return world.keysOfType(type)[nth]
}

function manifestEdit(edit: (manifest: Record<string, unknown>) => void): Amend {
    return { manifest: edit }
}

describe('the accepted file', () => {
    test('a real writer file verifies, keeps only numbers of its units, and reads each u/ block once (guard)', async () => {
        const walkBefore = await namesOf(plain)
        const blocks = walkBefore.filter((name) => name.startsWith('u/'))
        reads.entries.length = 0
        const ok = verified(await verify(plain))
        expect(ok.store2.tails.size).toBeGreaterThan(10)
        expect(ok.store2.omitted).toEqual([])
        expect(ok.store2.blocks.length).toBe(blocks.length)
        const blockReads = reads.entries.filter((i) => ok.store2.blocks.includes(i))
        expect(blockReads.length).toBe(blocks.length)
        expect(new Set(blockReads).size).toBe(blocks.length)
        // T17: nothing of a frame, a body or a listing is kept; the typed arrays stay far below the bound.
        for (const value of [ok.store2, ok.manifest, ok.rows, ok.inlays, ok.side, ok.notice]) {
            expect(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? 'BYTES' : item)).not.toContain('BYTES')
        }
        for (const info of ok.store2.tails.values()) {
            expect(Object.keys(info).sort()).toEqual(['block', 'crc', 'items', 'length', 'type'])
        }
        expect(ok.store2.blocks.byteLength).toBeLessThanOrEqual(9 * ok.index.count)
    })

    test('assets, inlays and the eight side sections are carried into the verdict (guard)', async () => {
        const file = await writeRtbFile({
            world,
            assets: { [`${'a1'.repeat(32)}.png`]: encoder.encode('asset') },
            inlays: [inlayFixture(INLAY_ID, 'inlay-bytes')],
            sides: { 'side.iris': { records: iterate([{ key: 'k1', value: { a: 1 } }]) } },
        })
        const ok = verified(await verify(file.bytes))
        expect(ok.inlays.map((pair) => pair.id)).toEqual([INLAY_ID])
        expect(ok.side.length).toBe(8)
        expect(ok.side.find((item) => item.action.id === 'side.iris')?.precheck).toBe('ok')
        expect(await namesOf(file.bytes)).toContain(assetEntryName(`${'a1'.repeat(32)}.png`))
    })
})

describe('refusals by site (T2)', () => {
    test('V.1 not an .rtb, and a sealed RTBX prefix (guard)', async () => {
        expect(await verify(encoder.encode('plain text '.repeat(20)))).toEqual({ kind: 'not-an-rtb' })
        const sealed = new Uint8Array(80)
        sealed.set([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 1, 0])
        expect(await verify(sealed)).toEqual({ kind: 'encrypted' })
    })

    test('V.1 damaged: a cut file, a section table that repeats a row, a non-canonical a/ name (guard)', async () => {
        expect((await verify(plain.slice(0, plain.length - 40))).kind).toBe('damaged')
        const repeated = await repackRtb(plain, manifestEdit((m) => { (m.sections as unknown[]).push((m.sections as unknown[])[0]) }))
        expect((await verify(repeated)).kind).toBe('damaged')
        const upper = await repackRtb(plain, {
            add: [{ name: 'a/Not-Canonical.png', bytes: encoder.encode('x'), method: 0 }],
        })
        expect(await verify(upper)).toMatchObject({ kind: 'damaged' })
    })

    test('V.2 meta.root: malformed, missing, the wrong unit and a wrong checksum are damaged (guard)', async () => {
        const store2Meta = (edit: (meta: Record<string, unknown>) => void): Amend => manifestEdit((m) => {
            edit(((m.sections as { id: string, meta: Record<string, unknown> }[]).find((row) => row.id === 'store2') as { meta: Record<string, unknown> }).meta)
        })
        expect((await verify(await repackRtb(plain, store2Meta((meta) => { meta.root = 'nope' })))).kind).toBe('damaged')
        expect((await verify(await repackRtb(plain, store2Meta((meta) => { delete meta.root })))).kind).toBe('damaged')
        expect((await verify(await repackRtb(plain, store2Meta((meta) => { meta.root = ['', 1, 1] })))).kind).toBe('damaged')
        const shardKey = keyOf(world, UNIT_TYPE.shard)
        const shardRef = refOfFrame(shardKey, world.store.get(shardKey) as Uint8Array)
        const wrongUnit = await writeRtbFile({ world, metaRoot: [shardRef[0], shardRef[1], shardRef[2]] })
        expect((await verify(wrongUnit.bytes)).kind).toBe('damaged')
        const own = refOfFrame(world.manifestKey, world.store.get(world.manifestKey) as Uint8Array)
        const wrongCrc = await writeRtbFile({ world, metaRoot: [own[0], own[1], own[2] ^ 1] })
        expect((await verify(wrongCrc.bytes)).kind).toBe('damaged')
    })

    test('V.3 damaged: a block checksum, a repeated tail across blocks, a damaged frame (guard)', async () => {
        const block = (await namesOf(plain)).find((name) => name.startsWith('u/')) as string
        expect((await verify(await withBrokenCrc(plain, block))).kind).toBe('damaged')

        const presetKey = keyOf(world, UNIT_TYPE.preset)
        const repeated = await repackRtb(plain, {
            add: [{ name: 'u/200/0.blk', bytes: encodeBlock([{ tail: tailOfKey(presetKey), frame: world.store.get(presetKey) as Uint8Array }]) }],
        })
        expect(await verify(repeated)).toMatchObject({ kind: 'damaged' })

        const damaged = await writeRtbFile({ world, replace: new Map([[keyOf(world, UNIT_TYPE.characterCore), damagedFrame(world.store.get(keyOf(world, UNIT_TYPE.characterCore)) as Uint8Array)]]) })
        expect(await verify(damaged.bytes)).toMatchObject({ kind: 'damaged' })
    })

    test('V.4 damaged: a missing unit, a unit of another length and a unit of the same length with another checksum (guard)', async () => {
        const coreKey = keyOf(world, UNIT_TYPE.characterCore)
        const missing = await writeRtbFile({ world, replace: new Map([[coreKey, null]]) })
        expect(await verify(missing.bytes)).toMatchObject({ kind: 'damaged' })

        const longer = await writeRtbFile({ world, replace: new Map([[coreKey, nonCanonicalFrame(UNIT_TYPE.characterCore, parsedBody(world, coreKey, UNIT_TYPE.characterCore))]]) })
        expect(await verify(longer.bytes)).toMatchObject({ kind: 'damaged' })

        const sameLength = reframedPayload(world.store.get(coreKey) as Uint8Array, (payload) => { payload[payload.length - 3] ^= 0x01 })
        const otherCrc = await writeRtbFile({ world, replace: new Map([[coreKey, sameLength]]) })
        expect(await verify(otherCrc.bytes)).toMatchObject({ kind: 'damaged' })
    })

    test('V.5 damaged: an inlay without its body, a meta whose len differs from the body, a meta at v 2 (guard)', async () => {
        const inlay = inlayFixture(INLAY_ID, 'inlay-bytes')
        const file = await writeRtbFile({ world, inlays: [inlay] })
        const names = inlayEntryNames(INLAY_ID)
        const orphan = await repackRtb(file.bytes, { remove: [names.bodyName] })
        expect((await verify(orphan)).kind).toBe('damaged')
        const meta = (over: Record<string, unknown>) => encoder.encode(JSON.stringify({ v: 1, repr: 'blob', mime: 'image/png', len: inlay.body.length, fields: {}, ...over }))
        expect((await verify(await repackRtb(file.bytes, { replace: { [names.metaName]: meta({ len: inlay.body.length + 1 }) } }))).kind).toBe('damaged')
        expect((await verify(await repackRtb(file.bytes, { replace: { [names.metaName]: meta({ v: 2 }) } }))).kind).toBe('damaged')
        expect((await verify(file.bytes)).kind).toBe('ok')
    })

    test('newer at V.1: an unknown required row and a manifest rtb above 1; at V.3: a unit type this build does not know (guard)', async () => {
        const required = await repackRtb(plain, {
            manifest: (m) => { (m.sections as unknown[]).push({ id: 'x-test.required', v: 1, required: true, prefix: 'x/req/', entries: 0, bytes: 0 }) },
        })
        expect(await verify(required)).toEqual({ kind: 'newer', item: { why: 'required-row', id: 'x-test.required', v: 1 } })
        const rtb2 = await repackRtb(plain, manifestEdit((m) => { m.rtb = 2 }))
        expect(await verify(rtb2)).toEqual({ kind: 'newer', item: { why: 'rtb', rtb: 2 } })
        const presetKey = keyOf(world, UNIT_TYPE.preset)
        const newer = await writeRtbFile({ world, replace: new Map([[presetKey, newerTypeFrame(world.store.get(presetKey) as Uint8Array)]]) })
        const verdict = await verify(newer.bytes)
        expect(verdict).toMatchObject({ kind: 'newer', item: { why: 'unit' } })
    })

    test('could not read: at the end records, in a block, in an inlay meta and in a side entry (guard)', async () => {
        const file = await writeRtbFile({
            world,
            inlays: [inlayFixture(INLAY_ID, 'inlay-bytes')],
            sides: { 'side.iris': { records: iterate([{ key: 'k1', value: { a: 1 } }]) } },
        })
        const size = file.bytes.length
        const cut = loggedSource(file.bytes, (offset, length) => offset + length === size)
        expect((await verifyRtb(cut.source)).kind).toBe('could-not-read')
        const names = await namesOf(file.bytes)
        for (const name of [names.find((n) => n.startsWith('u/')) as string, inlayEntryNames(INLAY_ID).metaName, 's/iris/data.jsonl']) {
            const range = await dataRangeOf(file.bytes, name)
            const log = loggedSource(file.bytes, (offset) => offset === range.start)
            expect((await verifyRtb(log.source)).kind, name).toBe('could-not-read')
        }
    })

    test('precedence: a newer unit later in unit order beats a damaged unit earlier (guard; MS15 fails it)', async () => {
        const coreKey = keyOf(world, UNIT_TYPE.characterCore)
        const presetKey = keyOf(world, UNIT_TYPE.preset)
        const file = await writeRtbFile({
            world,
            replace: new Map([
                [coreKey, damagedFrame(world.store.get(coreKey) as Uint8Array)],
                [presetKey, newerTypeFrame(world.store.get(presetKey) as Uint8Array)],
            ]),
        })
        expect(await verify(file.bytes)).toMatchObject({ kind: 'newer' })
    })
})

function parsedBody(world: RtbWorld, key: string, type: UnitType): object {
    const parsed = readUnit(world.store.get(key) as Uint8Array, type)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error('the unit does not parse')
    }
    return JSON.parse(JSON.stringify(parsed.value.body)) as object
}

describe('root req authority (T3)', () => {
    function withRootToken(): Map<string, Uint8Array | null> {
        const manifest = manifestOf(world)
        return new Map([[world.manifestKey, encodeUnit(UNIT_TYPE.manifest, { ...manifest, req: [...manifest.req, 'x-test'] })]])
    }

    test('a token only the root unit holds makes the file newer and the item names it; without it the file is accepted (guard; MS6 fails it)', async () => {
        const file = await writeRtbFile({ world, replace: withRootToken() })
        // meta.req holds known tokens only, so the file's manifest does not say it.
        expect(await verify(file.bytes)).toEqual({ kind: 'newer', item: { why: 'req', tokens: ['x-test'] } })
        expect((await verify(plain)).kind).toBe('ok')
    })
})

describe('Ref integrity of a file (T4)', () => {
    test('a chunk Ref with no count or a string count is refused by the shard parser; a wrong number by the closure walk (guard)', async () => {
        const missing = await writeRtbFile({ world, replace: plantChunkRef(world, (ref) => ref.slice(0, 3)) })
        const noCount = await verify(missing.bytes)
        expect(noCount.kind).toBe('damaged')
        const text = await writeRtbFile({ world, replace: plantChunkRef(world, (ref) => [ref[0], ref[1], ref[2], '2']) })
        expect((await verify(text.bytes)).kind).toBe('damaged')
        const wrong = await writeRtbFile({ world, replace: plantChunkRef(world, (ref) => [ref[0], ref[1], ref[2], 99]) })
        const verdict = await verify(wrong.bytes)
        expect(verdict.kind).toBe('damaged')
        expect(verdict.kind === 'damaged' && verdict.reason).toMatch(/different number of items/)
        // the unplanted shard passes: the same plant with the true count is accepted
        const honest = await writeRtbFile({ world, replace: plantChunkRef(world, (ref) => ref) })
        expect((await verify(honest.bytes)).kind).toBe('ok')
    })
})

describe('omitted units (T5)', () => {
    function omit(key: string, kind = 'unit'): { replace: Map<string, null>, omitted: { kind: string, name: string, reason: string }[] } {
        return { replace: new Map([[key, null]]), omitted: [{ kind, name: tailOfKey(key), reason: 'damaged' }] }
    }

    test('an omitted task preset (type 26 here: the manifest row) and an omitted alternatives unit are accepted and named (guard)', async () => {
        const preset = keyOf(world, UNIT_TYPE.taskPreset)
        const ok = verified(await verify((await writeRtbFile({ world, ...omit(preset) })).bytes))
        expect(ok.store2.omitted).toEqual([{ tail: tailOfKey(preset), row: '2:fixed.taskPresets[]' }])
        const alt = keyOf(world, UNIT_TYPE.chatAlt)
        const okAlt = verified(await verify((await writeRtbFile({ world, ...omit(alt) })).bytes))
        expect(okAlt.store2.omitted).toEqual([{ tail: tailOfKey(alt), row: '3:entries[].chats[].alt[]' }])
    })

    test('an omitted unit anywhere else, an omitted tail the file holds, and an entry of another kind excuse nothing (guard; MS8 fails the first)', async () => {
        const core = keyOf(world, UNIT_TYPE.characterCore)
        expect((await verify((await writeRtbFile({ world, ...omit(core) })).bytes)).kind).toBe('damaged')
        const preset = keyOf(world, UNIT_TYPE.taskPreset)
        const held = await writeRtbFile({ world, omitted: [{ kind: 'unit', name: tailOfKey(preset), reason: 'damaged' }] })
        expect((await verify(held.bytes)).kind).toBe('damaged')
        expect((await verify((await writeRtbFile({ world, ...omit(preset, 'x-test') })).bytes)).kind).toBe('damaged')
    })
})

describe('derived lists (T6)', () => {
    test('a list below this build\'s version is accepted, recorded as unreadable and never newer (guard)', async () => {
        const planted = staleWorld.planted as { listKey: string }
        const ok = verified(await verify((await writeRtbFile({ world: staleWorld })).bytes))
        expect(ok.store2.unreadableLists.map((list) => list.tail)).toContain(tailOfKey(planted.listKey))
        expect(ok.store2.unreadableLists.every((list) => list.type === UNIT_TYPE.assetList || list.type === UNIT_TYPE.inlayList)).toBe(true)
    })
})

describe('rows this reader does not know (T7)', () => {
    const unknownRow = (m: Record<string, unknown>): void => {
        (m.sections as unknown[]).push({ id: 'x-test.unknown', v: 1, required: false, prefix: 'x/unknown/', entries: 0, bytes: 0 })
    }
    const entry = { name: 'x/unknown/one', bytes: encoder.encode('unknown-entry-bytes'.repeat(40)) }

    test.each([
        ['intact', async (bytes: Uint8Array) => bytes],
        ['a broken checksum', async (bytes: Uint8Array) => await withBrokenCrc(bytes, entry.name)],
        ['a broken deflate stream', async (bytes: Uint8Array) => await withBrokenDeflate(bytes, entry.name)],
    ])('an unknown optional row with %s is accepted, named, and its data is never inflated (guard; any read of its entry fails it)', async (_label, damage) => {
        const file = await damage(await repackRtb(plain, { manifest: unknownRow, add: [entry] }))
        reads.entries.length = 0
        const ok = verified(await verify(file))
        const unknown = ok.index.find(entry.name)
        expect(unknown.length).toBe(1)
        expect(reads.entries.length).toBeGreaterThan(0)
        expect(reads.entries).not.toContain(unknown[0])
        expect(ok.notice.unknownOptionalRows).toContainEqual({ id: 'x-test.unknown', v: 1 })
    })

    test('side.iris at v 2 is an unknown optional row: its store is planned to be cleared as newer and its data is not read (guard)', async () => {
        const file = await repackRtb(plain, manifestEdit((m) => {
            const iris = (m.sections as { id: string, v: number }[]).find((row) => row.id === 'side.iris') as { v: number }
            iris.v = 2
        }))
        reads.entries.length = 0
        const ok = verified(await verify(file))
        const item = ok.side.find((side) => side.action.id === 'side.iris')
        expect(item?.action).toMatchObject({ kind: 'clear', status: 'newer', v: 2 })
        expect(reads.entries).not.toContain(ok.index.find('s/iris/data.jsonl')[0])
        expect(ok.notice.unknownOptionalRows).toContainEqual({ id: 'side.iris', v: 2 })
    })
})

describe('side sections (T15)', () => {
    const sides = (): Record<string, { records: AsyncIterable<{ key: string, value: unknown }> }> => ({
        'side.iris': { records: iterate([{ key: 'k1', value: { a: 1 } }]) },
    })

    test('a bad checksum under the cap is corrupt and not a refusal; over a lowered cap it is not checked (guard)', async () => {
        const file = await writeRtbFile({ world, sides: sides() })
        const broken = await withBrokenCrc(file.bytes, 's/iris/data.jsonl')
        const corrupt = verified(await verify(broken)).side.find((item) => item.action.id === 'side.iris')
        expect(corrupt?.precheck).toBe('corrupt')
        expect(corrupt?.reason).not.toBeNull()
        const skipped = verified(await verify(broken, { sideCheckCapBytes: 1 })).side.find((item) => item.action.id === 'side.iris')
        expect(skipped?.precheck).toBe('not-checked')
        const good = verified(await verify(file.bytes)).side.find((item) => item.action.id === 'side.iris')
        expect(good?.precheck).toBe('ok')
    })

    test('a row that is also omitted is left and named; an unreadable store that is omitted is left alone (guard)', async () => {
        const conflict = await writeRtbFile({ world, sides: sides(), omitted: [{ kind: 'side', name: 'side.iris', reason: 'unreadable' }] })
        expect(verified(await verify(conflict.bytes)).side.find((item) => item.action.id === 'side.iris')?.action).toMatchObject({ kind: 'leave', status: 'conflict' })
        const omitted = await writeRtbFile({ world, sides: { 'side.plugin-permissions': { unreadable: true } } })
        expect(verified(await verify(omitted.bytes)).side.find((item) => item.action.id === 'side.plugin-permissions')?.action).toMatchObject({ kind: 'leave', status: 'omitted', reason: 'unreadable' })
    })
})

describe('a file that is not an .rtb (T18)', () => {
    test('golden 4 is refused as not an .rtb after reading no more than the sniff reads (guard)', async () => {
        const golden = fs.readFileSync(path.join(process.cwd(), 'src/ts/drive/tests/rtbGoldens/v1-golden-boundary.rtbseg'))
        const source = sparseSourceOfRuns(decodeSegmentList(golden))
        const logged: { offset: number, length: number }[] = []
        const verdict = await verifyRtb({
            size: source.size,
            read: async (offset, length) => {
                logged.push({ offset, length })
                return await source.read(offset, length)
            },
        })
        expect(verdict).toEqual({ kind: 'not-an-rtb' })
        expect(logged.reduce((sum, item) => sum + item.length, 0)).toBeLessThanOrEqual(SNIFF_BYTES)
        expect(decoder.decode(golden.subarray(0, 8))).not.toBe('')
    })
})
