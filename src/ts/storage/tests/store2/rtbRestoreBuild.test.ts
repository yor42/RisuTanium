// @vitest-environment node
/**
 * The restore side of a `.rtb` file's store2 section (CHORE-128 S4): the plan, the table-driven Ref rewrite and the manifest
 * assembly. The frames a restore consumes are the real export walk's output over a store written by the real producer, in
 * both module index layouts; "planted" worlds hold frames another writer laid out differently.
 *
 * Labels: "guard" tests the new contract of `rtb/restoreBuild` (or the new parameter of `withReplacedRefs`); before those
 * exist its red run is the missing import or export (diagnostic), and its scratch mutant is what falsifies it.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { checkBuiltUnits, createKeyMint, type BuildContext, type BuiltCommit } from 'src/ts/storage/store2/commit'
import {
    encodeUnit, keyOfTail, readUnit, refOfFrame, REQ_MODULE_BUCKETS, unionReq, UNIT_TYPE,
    type ChatEntry, type Manifest, type Ref, type Shard, type UnitType,
} from 'src/ts/storage/store2/format'
import { createLeafFallback } from 'src/ts/storage/store2/leafFallback'
import { RefElementError, withReplacedRefs } from 'src/ts/storage/store2/recoveryPick'
import {
    omittedTailsOf, planRestore, RtbRestoreError, type RestorePlanInput, type RestoreRequest,
} from 'src/ts/storage/store2/rtb/restoreBuild'
import { buildSmall, type Obj } from './codecFixtures'
import { createClock, testEnv } from './commitFixtures'
import {
    assembleStore, captureExport, commitRestore, damagedFrame, FIXTURE_WALK_ROW_IDS, FIXTURE_WALK_TABLE, nonCanonicalFrame, rowsOf, rtbWorld, walkRefsOf,
    type Captured, type RtbWorld,
} from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

interface Held {
    world: RtbWorld
    cap: Captured
}

let plain1: Held
let plain2: Held
let planted: Held
let kept: Held

async function hold(world: RtbWorld, replace?: ReadonlyMap<string, Uint8Array | null>): Promise<Held> {
    return { world, cap: await captureExport(await world.open(replace)) }
}

beforeAll(async () => {
    plain1 = await hold(await rtbWorld({ layout: 1 }))
    plain2 = await hold(await rtbWorld({ layout: 2 }))
    planted = await hold(await rtbWorld({ layout: 1, nonCanonical: true }))
    kept = await hold(await rtbWorld({ layout: 1, keep: true }))
})

const NO_TARGET = { legacyKeep: null, req: [] as string[] }

function inputOf(cap: Captured, extra: Partial<RestorePlanInput> = {}): RestorePlanInput {
    return { frames: cap.frames, root: cap.root, omitted: omittedTailsOf(cap.omitted), target: NO_TARGET, ...extra }
}

function buildOf(request: RestoreRequest, context: Partial<BuildContext> = {}, seed = 9): { built: BuiltCommit, issued: Set<string> } {
    const { mint, issued } = createKeyMint(testEnv(createClock(), seed), null)
    return { built: request.build({ mint, seq: 7, now: 1_800_000_000_000, ...context }), issued }
}

function framesOf(built: BuiltCommit): { key: string, bytes: Uint8Array }[] {
    return [...built.units, { key: built.manifest.key, bytes: encodeUnit(UNIT_TYPE.manifest, built.manifest.body) }]
}

/** The walk-row Refs of a built commit that name a tail its mint did not issue: a backup tail left in a body. */
function foreignRefs(built: BuiltCommit, issued: ReadonlySet<string>): { row: string, tail: string }[] {
    return walkRefsOf(framesOf(built)).filter(ref => !issued.has(keyOfTail(ref.tail)))
}

function bodyOf<T>(bytes: Uint8Array, type: UnitType): T {
    const parsed = readUnit(bytes, type)
    if (parsed.status !== 'ok' && parsed.status !== 'stale') {
        throw new Error(`The unit does not parse: ${parsed.reason}`)
    }
    return parsed.value.body as unknown as T
}

const tag = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

function multiset(frames: Iterable<Uint8Array>): Map<string, number> {
    const counts = new Map<string, number>()
    for (const bytes of frames) {
        counts.set(tag(bytes), (counts.get(tag(bytes)) ?? 0) + 1)
    }
    return counts
}

function restoreFailure(run: () => unknown): RtbRestoreError {
    try {
        run()
    } catch (error) {
        expect(error).toBeInstanceOf(RtbRestoreError)
        return error as RtbRestoreError
    }
    throw new Error('The plan did not fail.')
}

function copyOf(cap: Captured): Captured {
    return { frames: new Map(cap.frames), root: cap.root, omitted: [...cap.omitted] }
}

/** Replaces the manifest frame of `cap` by one holding `change(body)`, under the same key, and points the root Ref at it. */
function reframeManifest(cap: Captured, change: (body: Manifest, frames: Map<string, Uint8Array>) => void): Captured {
    const next = copyOf(cap)
    const body = bodyOf<Manifest>(cap.frames.get(cap.root[0]) as Uint8Array, UNIT_TYPE.manifest)
    change(body, next.frames)
    const bytes = encodeUnit(UNIT_TYPE.manifest, body)
    next.frames.set(cap.root[0], bytes)
    next.root = refOfFrame(keyOfTail(cap.root[0]), bytes)
    return next
}

/** Replaces the first shard that lists an entity with a chat by one holding `change(shard)`, and re-frames the manifest to match. */
function reframeShard(cap: Captured, change: (shard: Shard) => void): Captured {
    return reframeManifest(cap, (manifest, frames) => {
        for (const [position, ref] of manifest.shards.entries()) {
            const shard = bodyOf<Shard>(cap.frames.get(ref[0]) as Uint8Array, UNIT_TYPE.shard)
            if (shard.entries.some(entry => entry.chats.length > 0)) {
                change(shard)
                const bytes = encodeUnit(UNIT_TYPE.shard, shard)
                frames.set(ref[0], bytes)
                manifest.shards[position] = refOfFrame(keyOfTail(ref[0]), bytes)
                return
            }
        }
        throw new Error('No shard lists a chat.')
    })
}

function chatEntryOf(shard: Shard): ChatEntry {
    const entry = shard.entries.find(candidate => candidate.chats.length > 0)
    if (entry === undefined) {
        throw new Error('No entity has a chat.')
    }
    return entry.chats[0]
}

describe('the round trip (T4-1, guard)', () => {
    test.each([
        ['layout 1', () => plain1],
        ['layout 2', () => plain2],
        ['layout 1, planted non-canonical frames', () => planted],
    ])('%s: every Ref is minted, every leaf keeps its stored bytes and the restored store assembles to the source', async (_name, held) => {
        const { world, cap } = held()
        const request = planRestore(inputOf(cap))
        const { built, issued } = buildOf(request)

        expect(checkBuiltUnits(built, issued, request.newUnits, false)).toBeNull()
        expect(request.newUnits).toBe(cap.frames.size)
        expect(foreignRefs(built, issued)).toEqual([])

        // A frame without a walkable Ref (a leaf, or a layout 2 module index root) travels as its stored bytes.
        const verbatim = [...cap.frames.values()].filter(bytes => bytes[5] !== UNIT_TYPE.manifest && walkRefsOf([{ bytes }]).length === 0)
        expect(verbatim.length).toBeGreaterThan(10)
        const builtBytes = multiset(built.units.map(unit => unit.bytes))
        for (const [stored, count] of multiset(verbatim)) {
            expect(builtBytes.get(stored) ?? 0, 'a verbatim frame is missing from the built units').toBeGreaterThanOrEqual(count)
        }
        // A parent is framed again over its new Refs.
        const rewritten = [...cap.frames.values()].filter(bytes => bytes[5] !== UNIT_TYPE.manifest && walkRefsOf([{ bytes }]).length > 0)
        for (const bytes of rewritten) {
            expect(builtBytes.has(tag(bytes)), 'a parent kept its backup bytes').toBe(false)
        }

        const restored = await commitRestore(request)
        expect(assembleStore(restored.units, restored.manifestKey)).toEqual(assembleStore(world.store, world.manifestKey))
    })

    // P6, a compatibility guard (passes before and after): a restore copies the chunk frames as stored, so the new-reply mark in a chat's last chunk survives.
    test('guard (P6): the new-reply mark of a chat is restored with the store', async () => {
        const database = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
        ;((database.characters as Obj[])[0].chats as Obj[])[0].unseenReply = 'reply'
        const world = await rtbWorld({ layout: 1, database })
        const cap = await captureExport(await world.open())

        const restored = await commitRestore(planRestore(inputOf(cap)))

        const characters = (assembleStore(restored.units, restored.manifestKey) as { characters: Obj[] }).characters
        expect((characters[0].chats as Obj[])[0].unseenReply).toBe('reply')
        expect((characters[1].chats as Obj[]).some(chat => 'unseenReply' in chat)).toBe(false)
    })

    test('the planted preset, chunk and v 2 list travel as stored, and their new Refs keep the old length, checksum and element 3', () => {
        const { world, cap } = planted
        const info = world.planted
        expect(info).not.toBeNull()
        const { built } = buildOf(planRestore(inputOf(cap)))
        const builtBytes = multiset(built.units.map(unit => unit.bytes))
        for (const key of [info?.presetKey, info?.chunkKey, info?.listKey] as string[]) {
            expect(builtBytes.get(tag(world.store.get(key) as Uint8Array)) ?? 0, `${key} was re-encoded`).toBeGreaterThanOrEqual(1)
        }

        const original = bodyOf<Shard>(world.store.get(info?.shardKey as string) as Uint8Array, UNIT_TYPE.shard)
        const shards = built.units.filter(unit => unit.bytes[5] === UNIT_TYPE.shard).map(unit => bodyOf<Shard>(unit.bytes, UNIT_TYPE.shard))
        const suffixes = (shard: Shard): string[] => shard.entries.flatMap(entry => [
            ...entry.chats.flatMap(chat => chat.chunks.map(ref => JSON.stringify(ref.slice(1)))),
            ...entry.al === null ? [] : [JSON.stringify(entry.al.slice(1))],
        ])
        const after = new Set(shards.flatMap(suffixes))
        for (const suffix of original.entries.length > 0 ? suffixes(original) : []) {
            expect(after.has(suffix), `the Ref suffix ${suffix} changed`).toBe(true)
        }
        expect(shards.some(shard => shard.entries.some(entry => entry.al !== null && entry.al[3] === 2))).toBe(true)
    })
})

describe('a parent that names nothing walkable (T4-1, guard)', () => {
    test('a layout 2 module index root laid out differently keeps its stored bytes', () => {
        let planted: Uint8Array = new Uint8Array(0)
        let original: Uint8Array = new Uint8Array(0)
        const cap = reframeManifest(plain2.cap, (manifest, frames) => {
            const tail = manifest.fixed.moduleIndex[0]
            original = frames.get(tail) as Uint8Array
            planted = nonCanonicalFrame(UNIT_TYPE.moduleIndex, bodyOf(original, UNIT_TYPE.moduleIndex))
            frames.set(tail, planted)
            manifest.fixed.moduleIndex = refOfFrame(keyOfTail(tail), planted)
        })
        expect(walkRefsOf([{ bytes: planted }])).toEqual([])
        expect(tag(planted)).not.toBe(tag(original))
        const { built } = buildOf(planRestore(inputOf(cap)))
        expect(multiset(built.units.map(unit => unit.bytes)).get(tag(planted)) ?? 0, 'the module index root was encoded again').toBe(1)
    })
})

describe('every walk row is rewritten (T4-3, guard)', () => {
    test.each(FIXTURE_WALK_ROW_IDS)('dropping %s from the table leaves a backup Ref behind, which an independent pass finds', (id) => {
        const held = rowsOf(plain1.world).has(id) ? plain1 : plain2
        expect(rowsOf(held.world).has(id), `no world populates ${id}`).toBe(true)
        const table = FIXTURE_WALK_TABLE.filter(row => `${row.type}:${row.path}` !== id)
        expect(table).toHaveLength(27)
        const { built, issued } = buildOf(planRestore(inputOf(held.cap, { table })))
        expect(foreignRefs(built, issued).map(ref => ref.row), `dropping ${id} goes unnoticed`).toContain(id)
    })

    test('with every row, no world leaves a backup Ref behind', () => {
        for (const { cap } of [plain1, plain2, planted]) {
            const { built, issued } = buildOf(planRestore(inputOf(cap)))
            expect(foreignRefs(built, issued)).toEqual([])
        }
    })
})

describe('unknown fields and Ref-shaped data (T4-4, guard)', () => {
    test('a Ref-shaped tuple in an unknown field is data; a chunk keeps its count and a 5-element suffix', () => {
        // Each tuple names a unit the file really holds and that is rewritten before its holder, so a rewrite that goes by shape would replace it.
        let tuple: (string | number)[] = []
        const shardOnly = reframeShard(plain1.cap, (shard) => {
            const entry = shard.entries.find(candidate => candidate.chats.length > 0)
            if (entry === undefined) {
                throw new Error('No entity has a chat.')
            }
            tuple = [entry.core[0], 3, 4, 5]
            Object.assign(shard, { shardExtra: tuple })
            Object.assign(entry, { entryExtra: tuple })
            const chunk = entry.chats[0].chunks[0]
            entry.chats[0].chunks[0] = [chunk[0], chunk[1], chunk[2], chunk[3], 'x', 9]
        })
        const manifestTuple = [bodyOf<Manifest>(plain1.cap.frames.get(plain1.cap.root[0]) as Uint8Array, UNIT_TYPE.manifest).fixed.presets[0][0], 6, 7]
        const cap = reframeManifest(shardOnly, (manifest) => {
            Object.assign(manifest.fixed, { fixedTuple: manifestTuple })
        })
        const { built } = buildOf(planRestore(inputOf(cap)))
        expect((built.manifest.body.fixed as unknown as Record<string, unknown>).fixedTuple).toEqual(manifestTuple)
        const shards = built.units.filter(unit => unit.bytes[5] === UNIT_TYPE.shard).map(unit => bodyOf<Shard>(unit.bytes, UNIT_TYPE.shard))
        const marked = shards.find(shard => 'shardExtra' in shard)
        expect(marked).toBeDefined()
        expect((marked as unknown as Record<string, unknown>).shardExtra).toEqual(tuple)
        const entry = (marked as Shard).entries.find(candidate => 'entryExtra' in candidate)
        expect((entry as unknown as Record<string, unknown>).entryExtra).toEqual(tuple)
        const chunk = (entry as Shard['entries'][number]).chats[0].chunks[0]
        expect(chunk).toHaveLength(6)
        expect(chunk.slice(3)).toEqual([chatCount(plain1.cap), 'x', 9])
    })
})

function chatCount(cap: Captured): number {
    const manifest = bodyOf<Manifest>(cap.frames.get(cap.root[0]) as Uint8Array, UNIT_TYPE.manifest)
    for (const ref of manifest.shards) {
        const shard = bodyOf<Shard>(cap.frames.get(ref[0]) as Uint8Array, UNIT_TYPE.shard)
        const entry = shard.entries.find(candidate => candidate.chats.length > 0)
        if (entry !== undefined) {
            return entry.chats[0].chunks[0][3]
        }
    }
    throw new Error('No chat.')
}

describe('withReplacedRefs (T4-5, guard)', () => {
    const replaced = new Map<string, Ref>([['1', ['new-one', 11, 12]], ['t', ['new-t', 21, 22]]])

    test('a position that is not a [string, number, number, ...] tuple throws RefElementError, not the missing-replacement error', () => {
        for (const config of [[1, 2, 3], ['t', 'x', 3], ['t', 2, 'y'], ['t', 2]]) {
            const body = { fixed: { config } } as never
            let thrown: unknown
            try {
                withReplacedRefs(UNIT_TYPE.manifest, body, replaced)
            } catch (error) {
                thrown = error
            }
            expect(thrown, JSON.stringify(config)).toBeInstanceOf(RefElementError)
            expect((thrown as Error).message).not.toMatch(/No replacement exists/)
        }
    })

    test('a well-formed tuple is replaced and its suffix is kept; a missing replacement still throws its own error', () => {
        const body = { fixed: { config: ['t', 2, 3, 7, 'x'] } } as never
        expect((withReplacedRefs(UNIT_TYPE.manifest, body, replaced) as unknown as { fixed: { config: unknown } }).fixed.config).toEqual(['new-t', 21, 22, 7, 'x'])
        expect(() => withReplacedRefs(UNIT_TYPE.manifest, { fixed: { config: ['zz', 2, 3] } } as never, replaced)).toThrow(/No replacement exists/)
        expect(() => withReplacedRefs(UNIT_TYPE.manifest, { fixed: { config: ['zz', 2, 3] } } as never, replaced)).not.toThrow(RefElementError)
    })

    test('the table parameter limits the rows that are visited', () => {
        const body = { fixed: { config: ['t', 2, 3], statics: ['unmapped', 1, 2] } } as never
        const only = FIXTURE_WALK_TABLE.filter(row => `${row.type}:${row.path}` === '2:fixed.config')
        expect(only).toHaveLength(1)
        const result = withReplacedRefs(UNIT_TYPE.manifest, body, replaced, only) as unknown as { fixed: { config: unknown, statics: unknown } }
        expect(result.fixed.config).toEqual(['new-t', 21, 22])
        expect(result.fixed.statics).toEqual(['unmapped', 1, 2])
    })
})

describe('the old-file keep list (T4-6, guard)', () => {
    const KEEP = { unit: ['k'.repeat(52), 40, 50] as Ref, v: 3, files: [{ key: 'database/database.bin', status: 'gone' as const }], keepExtra: { z: 1 } }

    function built(target: RestorePlanInput['target'], context: Partial<BuildContext> = {}): BuiltCommit {
        return buildOf(planRestore(inputOf(kept.cap, { target })), context).built
    }

    test('the backup keep list is never visited or copied; a null target leaves no keep', () => {
        const manifest = bodyOf<Manifest>(kept.world.store.get(kept.world.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        expect(manifest.fixed.legacyKeep).not.toBeNull()
        const request = planRestore(inputOf(kept.cap))
        expect(request.newUnits).toBe(kept.cap.frames.size)
        const result = buildOf(request).built
        expect(result.manifest.body.fixed.legacyKeep).toBeNull()
        expect(result.units.some(unit => unit.bytes[5] === UNIT_TYPE.legacyList)).toBe(false)
    })

    test('the target keep travels by value; a keep in the build context wins, a null one included', () => {
        const fromTarget = built({ legacyKeep: KEEP, req: [] })
        expect(fromTarget.manifest.body.fixed.legacyKeep).toEqual(KEEP)
        expect(fromTarget.manifest.body.fixed.legacyKeep).not.toBe(KEEP)
        const other = { ...KEEP, v: 9 }
        expect(built({ legacyKeep: KEEP, req: [] }, { legacyKeep: other }).manifest.body.fixed.legacyKeep).toEqual(other)
        expect(built({ legacyKeep: KEEP, req: [] }, { legacyKeep: null }).manifest.body.fixed.legacyKeep).toBeNull()
    })
})

describe('manifest provenance (T4-7, guard)', () => {
    function extras(cap: Captured): Captured {
        return reframeManifest(cap, (manifest) => {
            Object.assign(manifest, { topExtra: { a: 1 } })
            Object.assign(manifest.fixed, { fixedExtra: [1, 2] })
            Object.assign(manifest.fixed.pluginStorage, { storageExtra: 'value' })
            if (manifest.fixed.legacyKeep !== null) {
                Object.assign(manifest.fixed.legacyKeep, { keepExtra: true })
            }
        })
    }

    test('the backup keeps its unknown fields at the top, in fixed and in pluginStorage; the keep list is the target keep, with the backup keep fields gone', () => {
        const cap = extras(kept.cap)
        const target = { legacyKeep: { unit: ['t'.repeat(52), 1, 2] as Ref, v: 1, files: [], targetExtra: 1 }, req: [] as string[] }
        const body = buildOf(planRestore(inputOf(cap, { target }))).built.manifest.body as unknown as Record<string, unknown> & { fixed: Record<string, unknown> }
        expect(body.topExtra).toEqual({ a: 1 })
        expect(body.fixed.fixedExtra).toEqual([1, 2])
        expect((body.fixed.pluginStorage as Record<string, unknown>).storageExtra).toBe('value')
        expect(body.fixed.legacyKeep).toEqual(target.legacyKeep)
        expect(JSON.stringify(body.fixed.legacyKeep)).not.toContain('keepExtra')
    })

    test('req is the union of the backup and the target', () => {
        const cap = plain1.cap
        const backupReq = bodyOf<Manifest>(cap.frames.get(cap.root[0]) as Uint8Array, UNIT_TYPE.manifest).req
        expect(backupReq.length).toBeGreaterThan(0)
        expect(backupReq).not.toContain(REQ_MODULE_BUCKETS)
        const body = buildOf(planRestore(inputOf(cap, { target: { legacyKeep: null, req: [REQ_MODULE_BUCKETS] } }))).built.manifest.body
        expect(body.req).toEqual(unionReq(backupReq, [REQ_MODULE_BUCKETS]))
        expect(body.req).toContain(REQ_MODULE_BUCKETS)
        for (const token of backupReq) {
            expect(body.req).toContain(token)
        }
    })

    test('seq and createdAt are the attempt\'s, per build, never the backup\'s', () => {
        const request = planRestore(inputOf(plain1.cap))
        const first = buildOf(request, { seq: 11, now: 111 }).built.manifest.body
        const second = buildOf(request, { seq: 12, now: 222 }, 10).built.manifest.body
        expect([first.seq, first.createdAt]).toEqual([11, 111])
        expect([second.seq, second.createdAt]).toEqual([12, 222])
        const backup = bodyOf<Manifest>(plain1.cap.frames.get(plain1.cap.root[0]) as Uint8Array, UNIT_TYPE.manifest)
        expect(backup.seq).not.toBe(11)
        expect(backup.createdAt).not.toBe(111)
    })
})

describe('omitted units (T4-8, guard)', () => {
    let damaged: Held
    let presetTails: string[]
    let altTail: string
    let flagged: Parameters<typeof createLeafFallback>[0]

    beforeAll(async () => {
        const { world } = plain1
        const presetKeys = world.keysOfType(UNIT_TYPE.taskPreset)
        const altKeys = world.keysOfType(UNIT_TYPE.chatAlt)
        expect(presetKeys.length).toBeGreaterThanOrEqual(2)
        expect(altKeys.length).toBe(1)
        const replace = new Map<string, Uint8Array | null>([
            [presetKeys[0], damagedFrame(world.store.get(presetKeys[0]) as Uint8Array)],
            [altKeys[0], damagedFrame(world.store.get(altKeys[0]) as Uint8Array)],
        ])
        damaged = await hold(world, replace)
        presetTails = presetKeys.map(key => key.slice('store2/'.length))
        altTail = altKeys[0].slice('store2/'.length)
        const manifest = bodyOf<Manifest>(world.store.get(world.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        const position = (manifest.fixed.taskPresets ?? []).findIndex(ref => ref[0] === presetTails[0])
        let owner = { chaId: '', chatId: '' }
        for (const shardRef of manifest.shards) {
            for (const entry of bodyOf<Shard>(world.store.get(`store2/${shardRef[0]}`) as Uint8Array, UNIT_TYPE.shard).entries) {
                for (const chat of entry.chats) {
                    if ((chat.alt ?? []).some(ref => ref[0] === altTail)) {
                        owner = { chaId: entry.chaId, chatId: chat.cid }
                    }
                }
            }
        }
        flagged = [
            { kind: 'task-preset', position, key: presetKeys[0], why: 'damaged' },
            { kind: 'chat', chaId: owner.chaId, chatId: owner.chatId, part: 'alt', key: altKeys[0], why: 'damaged' },
        ]
    })

    test('the export omits the two units, and the restore removes them: the restored store assembles as the boot would assemble the source', async () => {
        expect(damaged.cap.omitted.map(entry => entry.name).sort()).toEqual([presetTails[0], altTail].sort())
        const request = planRestore(inputOf(damaged.cap))
        expect(request.newUnits).toBe(plain1.cap.frames.size - 2)
        const { built, issued } = buildOf(request)
        expect(checkBuiltUnits(built, issued, request.newUnits, false)).toBeNull()
        expect(built.manifest.body.fixed.taskPresets).toHaveLength(1)

        const restored = await commitRestore(request)
        const fallback = createLeafFallback(flagged, () => 0)
        const expected = assembleStore(plain1.world.store, plain1.world.manifestKey, {
            character: fallback.character, skipTaskPresets: fallback.skipTaskPresets,
        })
        expect(assembleStore(restored.units, restored.manifestKey)).toEqual(expected)
    })

    test('an emptied list loses its field: the sole alternatives unit and the last task preset', async () => {
        const shards = buildOf(planRestore(inputOf(damaged.cap))).built.units
            .filter(unit => unit.bytes[5] === UNIT_TYPE.shard).map(unit => bodyOf<Shard>(unit.bytes, UNIT_TYPE.shard))
        const chats = shards.flatMap(shard => shard.entries.flatMap(entry => entry.chats))
        expect(chats.length).toBeGreaterThan(0)
        for (const chat of chats) {
            expect('alt' in chat, 'an emptied alternatives list was left behind').toBe(false)
        }

        const both = new Map<string, Uint8Array | null>(presetTails.map(tail => [`store2/${tail}`, damagedFrame(plain1.world.store.get(`store2/${tail}`) as Uint8Array)]))
        const { cap } = await hold(plain1.world, both)
        expect(cap.omitted).toHaveLength(2)
        const manifest = buildOf(planRestore(inputOf(cap))).built.manifest.body
        expect('taskPresets' in manifest.fixed, 'an emptied task preset list was left behind').toBe(false)
    })

    test('a tail referenced outside the two O3 rows cannot be omitted', () => {
        const manifest = bodyOf<Manifest>(plain1.cap.frames.get(plain1.cap.root[0]) as Uint8Array, UNIT_TYPE.manifest)
        const presetTail = manifest.fixed.presets[0][0]
        const frames = new Map(plain1.cap.frames)
        frames.delete(presetTail)
        const error = restoreFailure(() => planRestore(inputOf(plain1.cap, { frames, omitted: new Set([presetTail]) })))
        expect(error.kind).toBe('omitted-outside-o3')
    })

    test('a frame that is neither present nor omitted is a missing frame', () => {
        const frames = new Map(plain1.cap.frames)
        frames.delete(presetTails[0])
        expect(restoreFailure(() => planRestore(inputOf(plain1.cap, { frames, omitted: new Set() }))).kind).toBe('missing-frame')
    })

    test('an omitted tail whose frame is in the file is damaged', () => {
        expect(restoreFailure(() => planRestore(inputOf(plain1.cap, { omitted: new Set([presetTails[0]]) }))).kind).toBe('omitted-tail-present')
    })

    test('only a unit entry with the reason damaged excuses a missing Ref', () => {
        const entries = [
            { kind: 'unit', name: presetTails[0], reason: 'unreadable' },
            { kind: 'side', name: presetTails[0], reason: 'damaged' },
            { kind: 'future', name: altTail, reason: 'damaged' },
            { kind: 'unit', name: altTail, reason: 'oversize' },
        ]
        expect(omittedTailsOf(entries).size).toBe(0)
        expect([...omittedTailsOf([...entries, { kind: 'unit', name: altTail, reason: 'damaged' }])]).toEqual([altTail])
        expect(damaged.cap.frames.has(presetTails[0])).toBe(false)
        expect(restoreFailure(() => planRestore(inputOf(damaged.cap, { omitted: omittedTailsOf(entries) }))).kind).toBe('missing-frame')
    })
})

describe('the plan and the mint (T4-9, T4-10, guard)', () => {
    test('two builds of one plan mint disjoint keys, pass the check and decode to equal content', () => {
        const request = planRestore(inputOf(plain1.cap))
        const first = buildOf(request, {}, 21)
        const second = buildOf(request, {}, 22)
        const keys = (built: BuiltCommit): string[] => framesOf(built).map(unit => unit.key)
        expect(keys(first.built).filter(key => keys(second.built).includes(key))).toEqual([])
        expect(checkBuiltUnits(first.built, first.issued, request.newUnits, false)).toBeNull()
        expect(checkBuiltUnits(second.built, second.issued, request.newUnits, false)).toBeNull()
        const stored = (built: BuiltCommit): Map<string, Uint8Array> => new Map(framesOf(built).map(unit => [unit.key, unit.bytes]))
        expect(assembleStore(stored(first.built), first.built.manifest.key)).toEqual(assembleStore(stored(second.built), second.built.manifest.key))
    })

    test('a tail named twice is minted once, and Refs that disagree on length, checksum or type are refused', () => {
        const duplicated = reframeShard(plain1.cap, (shard) => {
            const chunks = chatEntryOf(shard).chunks
            chunks.push([...chunks[0]] as typeof chunks[0])
        })
        const request = planRestore(inputOf(duplicated))
        const { built, issued } = buildOf(request)
        expect(request.newUnits).toBe(duplicated.frames.size)
        expect(checkBuiltUnits(built, issued, request.newUnits, false)).toBeNull()
        const shard = built.units.filter(unit => unit.bytes[5] === UNIT_TYPE.shard).map(unit => bodyOf<Shard>(unit.bytes, UNIT_TYPE.shard))
            .find(candidate => candidate.entries.some(entry => entry.chats.some(chat => chat.chunks.length >= 2 && chat.chunks[0][0] === chat.chunks[chat.chunks.length - 1][0])))
        expect(shard, 'the duplicate Ref was not carried to one new tail').toBeDefined()

        for (const change of [
            (ref: Ref): Ref => [ref[0], ref[1] + 1, ref[2], ...ref.slice(3)] as Ref,
            (ref: Ref): Ref => [ref[0], ref[1], ref[2] === 0 ? 1 : ref[2] - 1, ...ref.slice(3)] as Ref,
        ]) {
            const disagreeing = reframeShard(plain1.cap, (changed) => {
                const chunks = chatEntryOf(changed).chunks
                chunks.push(change(chunks[0]) as typeof chunks[0])
            })
            const error = restoreFailure(() => planRestore(inputOf(disagreeing)))
            expect(error.kind, error.message).toBe('conflict')
        }
        const typed = reframeShard(plain1.cap, (changed) => {
            const chat = chatEntryOf(changed)
            chat.core = [...chat.chunks[0]].slice(0, 3) as Ref
        })
        const typedError = restoreFailure(() => planRestore(inputOf(typed)))
        expect(typedError.kind, typedError.message).toBe('conflict')
    })
})
