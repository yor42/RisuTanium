// @vitest-environment node
/**
 * The raw-unit export of a `.rtb` file (CHORE-128 S3): which units the walk hands over, in which bytes, and which damage
 * it leaves out or refuses. The store is written by the real producer (`encodeDatabase` with the real list derivation) in
 * both module index layouts; "planted" worlds re-frame units the way another writer could lay them out.
 *
 * Labels: "guard" tests the new contract of `rtb/*`; before those modules exist its red run is the missing import
 * (diagnostic), and its scratch mutant is what falsifies it.
 */
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { Store2BackendFailureError, Store2NotBinaryError, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, keyOfTail, newManifestKey, readUnit, refOfFrame, REFS_TABLE, UNIT_TYPE,
    type Manifest, type Ref, type Shard, type UnitType,
} from 'src/ts/storage/store2/format'
import {
    exportClosure, ExportClosureError, type ExportClosure, type ExportClosureOptions, type ExportUnit,
} from 'src/ts/storage/store2/rtb/exportClosure'
import { O3_ROWS, rowId, WALK_TABLE } from 'src/ts/storage/store2/rtb/rows'
import { sameBytes } from './codecFixtures'
import {
    damagedFrame, FIXTURE_WALK_ROW_IDS, moveCurrent, newerTypeFrame, reachedTails, rowsOf, rtbWorld, CURRENT_AT,
    type RtbWorld,
} from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

const ALT_ROW = '3:entries[].chats[].alt[]'
const TASK_ROW = '2:fixed.taskPresets[]'

let plain1: RtbWorld
let plain2: RtbWorld
let planted: RtbWorld
let kept: RtbWorld

beforeAll(async () => {
    plain1 = await rtbWorld({ layout: 1 })
    plain2 = await rtbWorld({ layout: 2 })
    planted = await rtbWorld({ layout: 1, nonCanonical: true, keep: true })
    kept = await rtbWorld({ layout: 1, keep: true })
})

interface Run {
    closure: ExportClosure
    units: ExportUnit[]
}

async function run(backend: Store2Backend, extra: Partial<ExportClosureOptions> = {}): Promise<Run> {
    const units: ExportUnit[] = []
    const closure = await exportClosure(backend, { onUnits: async batch => { units.push(...batch) }, ...extra })
    return { closure, units }
}

async function failure(promise: Promise<unknown>): Promise<ExportClosureError> {
    try {
        await promise
    } catch (error) {
        expect(error).toBeInstanceOf(ExportClosureError)
        return error as ExportClosureError
    }
    throw new Error('The export did not fail.')
}

/** The backend with `readUnits` and `readCommit` wrapped; everything else is the inner backend's. */
function spied(inner: MemoryBackend, hooks: {
    readUnits?: (keys: readonly string[], read: () => ReturnType<Store2Backend['readUnits']>) => ReturnType<Store2Backend['readUnits']>
    readCommit?: (count: number, read: () => ReturnType<Store2Backend['readCommit']>) => ReturnType<Store2Backend['readCommit']>
}): Store2Backend {
    let commits = 0
    return {
        ...inner,
        readUnits: keys => hooks.readUnits === undefined ? inner.readUnits(keys) : hooks.readUnits(keys, () => inner.readUnits(keys)),
        readCommit: () => hooks.readCommit === undefined ? inner.readCommit() : hooks.readCommit(++commits, () => inner.readCommit()),
    }
}

const tailsOf = (units: readonly ExportUnit[]): string[] => units.map(unit => unit.tail).sort()

describe('the coverage precondition and the fixtures (T3-0, guard)', () => {
    test('the two producer worlds together populate every one of the 28 walk rows', () => {
        const union = new Set([...rowsOf(plain1), ...rowsOf(plain2)])
        const missing = FIXTURE_WALK_ROW_IDS.filter(id => !union.has(id))
        expect(FIXTURE_WALK_ROW_IDS).toHaveLength(28)
        expect(missing, `walk rows no world populates: ${missing.join(', ')}`).toEqual([])
    })

    test('layout 1 holds the three module index rows and layout 2 the bucket rows', () => {
        for (const id of ['10:entries[].unit', '10:entries[].al', '10:entries[].il']) {
            expect(rowsOf(plain1).has(id), id).toBe(true)
            expect(rowsOf(plain2).has(id), id).toBe(false)
        }
        for (const id of ['2:fixed.moduleBuckets[]', '27:entries[].unit', '27:entries[].al', '27:entries[].il']) {
            expect(rowsOf(plain2).has(id), id).toBe(true)
            expect(rowsOf(plain1).has(id), id).toBe(false)
        }
    })

    test('WALK_TABLE is the schema table without the commit rows and the keep list, and O3 names two of its rows', () => {
        expect(WALK_TABLE.map(rowId)).toEqual(FIXTURE_WALK_ROW_IDS)
        expect(O3_ROWS).toEqual([TASK_ROW, ALT_ROW])
        expect(REFS_TABLE.length - WALK_TABLE.length).toBe(4)
    })

    test('every planted frame is valid but not the canonical encoding of its own body', () => {
        const info = planted.planted
        expect(info).not.toBeNull()
        const check = (key: string, type: UnitType): void => {
            const bytes = planted.store.get(key) as Uint8Array
            const parsed = readUnit(bytes, type)
            expect(parsed.status === 'ok' || parsed.status === 'stale' || parsed.status === 'unreadable', key).toBe(true)
            if (parsed.status === 'ok') {
                expect(sameBytes(bytes, encodeUnit(type, parsed.value.body)), `${key} is canonical`).toBe(false)
            }
        }
        check(info?.presetKey as string, UNIT_TYPE.preset)
        check(info?.chunkKey as string, UNIT_TYPE.chatChunk)
        check(info?.shardKey as string, UNIT_TYPE.shard)
        check(planted.manifestKey, UNIT_TYPE.manifest)
        expect(readUnit(planted.store.get(info?.listKey as string) as Uint8Array, UNIT_TYPE.assetList).status).toBe('unreadable')
    })
})

describe('the closure (T3-1, guard)', () => {
    test.each([
        ['layout 1', () => plain1],
        ['layout 2', () => plain2],
        ['layout 1 with an old-file keep list', () => kept],
        ['layout 1, planted non-canonical frames and a keep list', () => planted],
    ])('%s: the emitted set is the independent walk over the 28 rows, once each, in the stored bytes', async (_label, pick) => {
        const world = pick()
        const { closure, units } = await run(await world.open())
        const expected = [...reachedTails(world)].sort()
        expect(tailsOf(units)).toEqual(expected)
        expect(units).toHaveLength(expected.length)
        expect(closure.units).toBe(expected.length)
        expect(units[0].key).toBe(world.manifestKey)
        for (const unit of units) {
            expect(sameBytes(unit.bytes, world.store.get(unit.key) as Uint8Array), unit.key).toBe(true)
            expect(unit.bytes[5]).toBe(unit.type)
        }
        expect(closure.omitted).toEqual([])
        expect(closure.manifestKey).toBe(world.manifestKey)
        expect(closure.root).toEqual(refOfFrame(world.manifestKey, world.store.get(world.manifestKey) as Uint8Array))
        expect(closure.committedAt).toBe(CURRENT_AT)
        expect(closure.req).toEqual((readUnit(world.store.get(world.manifestKey) as Uint8Array, UNIT_TYPE.manifest) as { value: { body: Manifest } }).value.body.req)
    })

    test('the old-file keep list is not part of the closure', async () => {
        const { units } = await run(await kept.open())
        expect(units.some(unit => unit.tail === kept.keepTail)).toBe(false)
    })

    test('the planted preset, chunk, shard and manifest frames and the version 2 list travel in the bytes the store holds', async () => {
        const info = planted.planted
        const { units } = await run(await planted.open())
        const byKey = new Map(units.map(unit => [unit.key, unit.bytes]))
        for (const key of [info?.presetKey, info?.chunkKey, info?.shardKey, info?.listKey, planted.manifestKey] as string[]) {
            expect(sameBytes(byKey.get(key) as Uint8Array, planted.store.get(key) as Uint8Array), key).toBe(true)
        }
    })
})

describe('one generated mutant per walk row (T3-2, guard)', () => {
    test.each(FIXTURE_WALK_ROW_IDS.map(id => [id] as const))('without the row %s the units reached only through it are not emitted', async (id) => {
        const world = rowsOf(plain1).has(id) ? plain1 : plain2
        const whole = tailsOf((await run(await world.open())).units)
        const table = WALK_TABLE.filter(row => rowId(row) !== id)
        const cut = tailsOf((await run(await world.open(), { table })).units)
        expect(cut, `dropping ${id} changed nothing: the row is not load-bearing`).not.toEqual(whole)
        expect(cut.length).toBeLessThan(whole.length)
    })

    test('a table that keeps the keep list and the commit rows reaches exactly the closure plus the keep tail', async () => {
        const wide = REFS_TABLE.filter(row => row.type !== UNIT_TYPE.commit)
        const without = tailsOf((await run(await kept.open())).units)
        const withKeep = tailsOf((await run(await kept.open(), { table: wide })).units)
        expect(withKeep).toEqual([...without, kept.keepTail as string].sort())
    })
})

describe('refRows (T3-3, guard)', () => {
    test('the ids are sorted, are walk rows, and equal the rows the independent walk found', async () => {
        for (const world of [plain1, plain2, kept]) {
            const { closure } = await run(await world.open())
            expect(closure.refRows).toEqual([...closure.refRows].sort())
            expect(closure.refRows.every(id => FIXTURE_WALK_ROW_IDS.includes(id))).toBe(true)
            expect(closure.refRows).toEqual([...rowsOf(world)].sort())
            expect(closure.refRows).not.toContain('2:fixed.legacyKeep.unit')
        }
    })

    test('a row whose only Ref was omitted is still listed', async () => {
        const altKey = plain1.keysOfType(UNIT_TYPE.chatAlt)[0]
        const { closure } = await run(await plain1.open(new Map([[altKey, damagedFrame(plain1.store.get(altKey) as Uint8Array)]])))
        expect(closure.omitted).toHaveLength(1)
        expect(closure.refRows).toContain(ALT_ROW)
    })
})

describe('what is left out and what fails (T3-4, T3-5, guard)', () => {
    const taskKey = (): string => plain1.keysOfType(UNIT_TYPE.taskPreset)[0]
    const altKey = (): string => plain1.keysOfType(UNIT_TYPE.chatAlt)[0]

    test.each([
        ['a damaged task preset', taskKey, TASK_ROW],
        ['a damaged chat alternatives unit', altKey, ALT_ROW],
    ])('%s is left out, named, and every other unit is emitted', async (_label, pick, row) => {
        const key = pick()
        const { closure, units } = await run(await plain1.open(new Map([[key, damagedFrame(plain1.store.get(key) as Uint8Array)]])))
        expect(closure.omitted).toEqual([{ kind: 'unit', name: key.slice('store2/'.length), reason: 'damaged', row }])
        expect(tailsOf(units)).toEqual([...reachedTails(plain1)].filter(tail => tail !== key.slice('store2/'.length)).sort())
    })

    test.each([
        ['a chat chunk', '3:entries[].chats[].chunks[]'],
        ['a character core', '3:entries[].core'],
        ['an asset list', '3:entries[].al'],
        ['a preset', '2:fixed.presets[]'],
    ])('a damaged %s fails the export and names the key and the row', async (_label, row) => {
        const key = keyOfTail((plain1.refsByRow.get(row) as string[])[0])
        const error = await failure(exportClosure(await plain1.open(new Map([[key, damagedFrame(plain1.store.get(key) as Uint8Array)]])), { onUnits: async () => {} }))
        expect(error.kind).toBe('damaged')
        expect(error.key).toBe(key)
        expect(error.row).toBe(row)
        expect(error.message).toContain(key)
        expect(error.message).toContain(row)
    })

    test('a task preset or alternatives unit of a newer format fails the export; it is never left out', async () => {
        for (const key of [taskKey(), altKey()]) {
            const error = await failure(exportClosure(await plain1.open(new Map([[key, newerTypeFrame(plain1.store.get(key) as Uint8Array)]])), { onUnits: async () => {} }))
            expect(error.kind, key).toBe('too-new')
            expect(error.key).toBe(key)
        }
    })

    test('a missing unit outside the O3 rows fails the export', async () => {
        const key = plain1.keysOfType(UNIT_TYPE.preset)[0]
        const error = await failure(exportClosure(await plain1.open(new Map([[key, null]])), { onUnits: async () => {} }))
        expect(error.kind).toBe('missing')
        expect(error.key).toBe(key)
    })

    test('a backend failure is "could not read", not an omission', async () => {
        const key = altKey()
        const backend = spied(await plain1.open(), {
            readUnits: async (keys, read) => {
                if (keys.includes(key)) {
                    throw new Store2BackendFailureError('the disk failed')
                }
                return read()
            },
        })
        const error = await failure(exportClosure(backend, { onUnits: async () => {} }))
        expect(error.kind).toBe('unreadable')
        expect(error.message).toContain('could not be read')
    })

    test('an absent task preset or alternatives unit while the commit key still names the manifest is left out (OQ1 option A)', async () => {
        for (const [key, row] of [[taskKey(), TASK_ROW], [altKey(), ALT_ROW]] as const) {
            const { closure } = await run(await plain1.open(new Map([[key, null]])))
            expect(closure.omitted).toEqual([{ kind: 'unit', name: key.slice('store2/'.length), reason: 'damaged', row }])
        }
    })
})

describe('the root (guard)', () => {
    test('an empty store, and a commit key without a current manifest, fail the export at the root', async () => {
        const empty = await plain1.open()
        const absent = spied(empty, { readCommit: async (_count, read) => ({ ...(await read()), bytes: null }) })
        expect((await failure(exportClosure(absent, { onUnits: async () => {} }))).kind).toBe('root')
        const missingManifest = await plain1.open(new Map([[plain1.manifestKey, null]]))
        expect((await failure(exportClosure(missingManifest, { onUnits: async () => {} }))).kind).toBe('root')
    })
})

describe('a unit named more than once (T3-6, guard)', () => {
    function reframed(world: RtbWorld, edit: (manifest: Manifest) => void, extra: Map<string, Uint8Array> = new Map()): Map<string, Uint8Array | null> {
        const parsed = readUnit(world.store.get(world.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        const body = JSON.parse(JSON.stringify((parsed as { value: { body: Manifest } }).value.body)) as Manifest
        edit(body)
        return new Map<string, Uint8Array | null>([[world.manifestKey, encodeUnit(UNIT_TYPE.manifest, body)], ...extra])
    }

    test('one parent naming a unit twice, and two shards naming the same units, emit each unit once', async () => {
        const twice = reframed(plain1, manifest => { manifest.fixed.presets.push([...manifest.fixed.presets[0]]) })
        const one = await run(await plain1.open(twice))
        expect(tailsOf(one.units)).toEqual([...reachedTails(plain1)].sort())

        const shards = (readUnit(plain1.store.get(plain1.manifestKey) as Uint8Array, UNIT_TYPE.manifest) as { value: { body: Manifest } }).value.body.shards
        const shard = shards
            .map(ref => (readUnit(plain1.store.get(keyOfTail(ref[0])) as Uint8Array, UNIT_TYPE.shard) as { value: { body: Shard } }).value.body)
            .find(candidate => candidate.entries.length > 0) as Shard
        expect(shard.entries.length).toBeGreaterThan(0)
        const second = JSON.parse(JSON.stringify(shard)) as Shard
        for (const entry of second.entries) {
            entry.u = `${entry.u}-copy`
        }
        const secondKey = `store2/s-${'0'.repeat(26)}`
        const secondBytes = encodeUnit(UNIT_TYPE.shard, second)
        const shared = reframed(plain1, manifest => {
            manifest.shards.push(refOfFrame(secondKey, secondBytes))
            manifest.shardCount = manifest.shards.length
        }, new Map([[secondKey, secondBytes]]))
        const both = await run(await plain1.open(shared))
        expect(tailsOf(both.units)).toEqual([...reachedTails(plain1), secondKey.slice('store2/'.length)].sort())
    })

    test.each([
        ['length', (ref: Ref): Ref => [ref[0], ref[1] + 1, ref[2]]],
        ['checksum', (ref: Ref): Ref => [ref[0], ref[1], ref[2] === 0 ? 1 : ref[2] - 1]],
    ])('two Refs to one unit that disagree on %s fail the export', async (_label, change) => {
        const world = reframed(plain1, manifest => {
            manifest.fixed.presets.push(change(manifest.fixed.presets[0]))
        })
        const error = await failure(exportClosure(await plain1.open(world), { onUnits: async () => {} }))
        expect(error.kind).toBe('conflict')
    })

    test('two Refs to one unit that disagree on its type fail the export', async () => {
        const world = reframed(plain1, manifest => { manifest.fixed.plugins.push([...manifest.fixed.presets[0]]) })
        const error = await failure(exportClosure(await plain1.open(world), { onUnits: async () => {} }))
        expect(error.kind).toBe('conflict')
    })
})

describe('a key that is not binary data (T3-7, guard)', () => {
    test('that one unit is damaged and left out; the rest of its batch is emitted', async () => {
        const key = plain1.keysOfType(UNIT_TYPE.chatAlt)[0]
        const backend = spied(await plain1.open(), {
            readUnits: async (keys, read) => {
                if (keys.includes(key)) {
                    throw new Store2NotBinaryError(key)
                }
                return read()
            },
        })
        const { closure, units } = await run(backend)
        expect(closure.omitted.map(entry => entry.name)).toEqual([key.slice('store2/'.length)])
        expect(tailsOf(units)).toEqual([...reachedTails(plain1)].filter(tail => tail !== key.slice('store2/'.length)).sort())
    })

    test('a non-binary key outside the O3 rows fails the export and names it', async () => {
        const key = plain1.keysOfType(UNIT_TYPE.characterCore)[0]
        const backend = spied(await plain1.open(), {
            readUnits: async (keys, read) => {
                if (keys.includes(key)) {
                    throw new Store2NotBinaryError(key)
                }
                return read()
            },
        })
        const error = await failure(exportClosure(backend, { onUnits: async () => {} }))
        expect(error.kind).toBe('damaged')
        expect(error.key).toBe(key)
    })
})

describe('the sink and the yield (T3-8, guard)', () => {
    test('no read starts while the sink of the previous batch is pending', async () => {
        let inSink = false
        const reads: string[][] = []
        const backend = spied(await plain1.open(), {
            readUnits: async (keys, read) => {
                if (inSink) {
                    reads.push([...keys])
                }
                return read()
            },
        })
        let batches = 0
        await exportClosure(backend, {
            onUnits: async () => {
                batches++
                inSink = true
                await new Promise(resolve => setTimeout(resolve, 2))
                inSink = false
            },
        })
        expect(batches).toBeGreaterThan(3)
        expect(reads).toEqual([])
    })

    test('the yield option is awaited between batches', async () => {
        let yields = 0
        await run(await plain1.open(), { yield: async () => { yields++ } })
        expect(yields).toBeGreaterThan(3)
    })
})

describe('the commit-key re-check (T3-11, guard)', () => {
    const altKey = (): string => plain1.keysOfType(UNIT_TYPE.chatAlt)[0]

    /** A backend that hides `key` and, with `move`, moves `current`, once the shard has been read. */
    async function racing(hide: string | null, move: boolean, readCommit?: (count: number) => void): Promise<Store2Backend> {
        const inner = await plain1.open()
        const shardKeys = new Set(plain1.keysOfType(UNIT_TYPE.shard))
        let triggered = false
        return spied(inner, {
            readUnits: async (keys, read) => {
                if (!triggered && keys.some(key => shardKeys.has(key))) {
                    triggered = true
                    const result = await read()
                    if (move) {
                        await moveCurrent(inner, newManifestKey(plain1.env), plain1.env)
                    }
                    return result
                }
                const result = await read()
                if (triggered && hide !== null && keys.includes(hide)) {
                    result.set(hide, null)
                }
                return result
            },
            readCommit: async (count, read) => {
                readCommit?.(count)
                return read()
            },
        })
    }

    test('an alternatives unit that vanished while current moved is "moved", and no omission is returned', async () => {
        const error = await failure(exportClosure(await racing(altKey(), true), { onUnits: async () => {} }))
        expect(error.kind).toBe('moved')
    })

    test('control: the same vanished unit with current unchanged is left out', async () => {
        const { closure } = await run(await racing(altKey(), false))
        expect(closure.omitted.map(entry => entry.row)).toEqual([ALT_ROW])
    })

    test('a damaged unit outside the O3 rows while current moved is "moved", not damaged', async () => {
        const key = plain1.keysOfType(UNIT_TYPE.characterCore)[0]
        const inner = await plain1.open(new Map([[key, damagedFrame(plain1.store.get(key) as Uint8Array)]]))
        const shardKeys = new Set(plain1.keysOfType(UNIT_TYPE.shard))
        let moved = false
        const backend = spied(inner, {
            readUnits: async (keys, read) => {
                if (!moved && keys.some(candidate => shardKeys.has(candidate))) {
                    moved = true
                    await moveCurrent(inner, newManifestKey(plain1.env), plain1.env)
                }
                return read()
            },
        })
        const error = await failure(exportClosure(backend, { onUnits: async () => {} }))
        expect(error.kind).toBe('moved')
    })

    test('a failed re-check read is "could not read", neither moved nor damaged', async () => {
        const inner = await plain1.open(new Map([[altKey(), damagedFrame(plain1.store.get(altKey()) as Uint8Array)]]))
        const backend = spied(inner, {
            readCommit: async (count, read) => {
                if (count > 1) {
                    throw new Store2BackendFailureError('the disk failed')
                }
                return read()
            },
        })
        const error = await failure(exportClosure(backend, { onUnits: async () => {} }))
        expect(error.kind).toBe('unreadable')
    })

    test('a walk with no finding reads the commit key once', async () => {
        let reads = 0
        await run(await racing(null, false, () => { reads++ }))
        expect(reads).toBe(1)
    })

    test('the commit key is read again through the same classification the boot uses', async () => {
        const backend = await plain1.open()
        expect(classifyCommitRead(await backend.readCommit())).toMatchObject({ status: 'parsed', value: { current: { key: plain1.manifestKey } } })
    })
})
