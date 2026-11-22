// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { Database } from '../../database.svelte'
import { createMemoryBackend, type MemoryBackend } from '../../store2/backend'
import { assembleDatabase, CodecAssembleError, isWrittenUnit, previousFrom, type EncodedTree } from '../../store2/codec'
import { encodeUnit, FRAME_HEADER_BYTES, keyOfRef, readUnit, refOfFrame, UNIT_TYPE, type Manifest, type WorkspaceRecord } from '../../store2/format'
import { previousOfTree, type StoredTree } from '../../store2/previousOfTree'
import { readTreeBytes } from '../../store2/treeBytes'
import { crc32 } from '../../blockFrame'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { asDatabase, buildSmall, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The boot read of utility workspaces (#202 S1a-2): `readTreeBytes` reads every record and file of a stored tree as fixed
 * units, and `previousOfTree` registers them under the identities the encoder gives them, so the first save after a reboot
 * reuses every untouched workspace unit. Labels: R reproducer (fails on a base without the feature), G guard (passes before
 * and after), N new-rule test (proven by its scratch mutants).
 */

function file(id: string, path: string, text: string): Obj {
    return { id, path, text, size: new TextEncoder().encode(text).length, mtime: 5 }
}

function workspaces(): Obj[] {
    return [
        { id: 'w1', name: 'First', createdAt: 1000, files: [file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', 'note')] },
        { id: 'w2', name: 'Second', createdAt: 2000, files: [file('f3', 'x.txt', 'ex')] },
    ]
}

function profile(list: unknown = workspaces()): Database {
    return asDatabase({ ...buildSmall(2) as unknown as Obj, utilityWorkspaces: list })
}

interface World {
    memory: MemoryBackend
    tree: EncodedTree
    manifestKey: string
    stored: StoredTree
}

async function seedWorld(db: Database = profile()): Promise<World> {
    const memory = createMemoryBackend()
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(db)) as Database, testEnv(createClock(), 4242), fakeLists)
    const read = await readTreeBytes(memory, seeded.manifestKey)
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree reads ${read.status}.`)
    }
    return { memory, tree: seeded.tree, manifestKey: seeded.manifestKey, stored: read.tree }
}

function keyOfIdentity(world: World, identity: string): string {
    const unit = world.tree.units.find(candidate => candidate.identity === identity)
    if (unit === undefined) {
        throw new Error(`No unit ${identity} in the tree.`)
    }
    return unit.key
}

function flipped(bytes: Uint8Array, at: number): Uint8Array {
    const out = new Uint8Array(bytes)
    out[at] ^= 0xff
    return out
}

function tooNew(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes)
    out[4] = 9
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

const WORKSPACE_IDENTITIES = ['ws:w1', 'ws:w2', 'wsf:w1:f1', 'wsf:w1:f2', 'wsf:w2:f3']

describe('T3 reboot: the boot read carries the workspaces as the encoder named them', () => {
    test('R: the boot read assembles the workspaces back (records and files are read as part of the tree)', async () => {
        const world = await seedWorld()
        const assembled = assembleDatabase(world.stored.manifest, world.stored.source) as unknown as Obj
        expect(assembled.utilityWorkspaces).toEqual(workspaces())
    })

    test('R: previousOfTree registers every record and file under the encoder\'s identity, with the stored key, Ref and a digest', async () => {
        const world = await seedWorld()
        const read = previousOfTree(world.stored)
        const kept = previousFrom(world.tree)
        for (const identity of WORKSPACE_IDENTITIES) {
            const unit = read.units.get(identity)
            expect(unit, identity).toBeDefined()
            expect(unit?.key, identity).toBe(keyOfIdentity(world, identity))
            expect(unit?.digest, identity).toBeDefined()
            expect(unit, identity).toEqual(kept.units.get(identity))
        }
        expect(read.units.get('ws:w1')?.type).toBe(UNIT_TYPE.workspace)
        expect(read.units.get('wsf:w2:f3')?.type).toBe(UNIT_TYPE.workspaceFile)
    })

    test('R: a first pass over the booted previous reuses every workspace unit under the same key (reboot keeps keys)', async () => {
        const world = await seedWorld()
        const previous = previousOfTree(world.stored)
        const assembled = assembleDatabase(world.stored.manifest, world.stored.source)
        const next = encodeWith(assembled, { previous, seq: 2, env: seededEnv(2) })
        for (const identity of WORKSPACE_IDENTITIES) {
            const unit = next.units.find(candidate => candidate.identity === identity)
            expect(unit?.reused, identity).toBe(true)
            expect(unit?.key, identity).toBe(keyOfIdentity(world, identity))
        }
        expect(next.manifest.fixed.workspaces?.map(keyOfRef)).toEqual(world.tree.manifest.fixed.workspaces?.map(keyOfRef))
    })

    test('R: an edit of one file after the reboot rewrites that file and its record only', async () => {
        const world = await seedWorld()
        const previous = previousOfTree(world.stored)
        const assembled = assembleDatabase(world.stored.manifest, world.stored.source) as unknown as { utilityWorkspaces: { files: Obj[] }[] }
        assembled.utilityWorkspaces[0].files[1].text = 'edited'
        const next = encodeWith(assembled as unknown as Database, { previous, seq: 2, env: seededEnv(2) })
        const reusedOf = (identity: string) => next.units.find(candidate => candidate.identity === identity)?.reused
        expect(reusedOf('wsf:w1:f1')).toBe(true)
        expect(reusedOf('wsf:w2:f3')).toBe(true)
        expect(reusedOf('ws:w2')).toBe(true)
        expect(reusedOf('wsf:w1:f2')).toBe(false)
        expect(reusedOf('ws:w1')).toBe(false)
    })

    test('G: a store without workspaces registers none and its manifest names none', async () => {
        const world = await seedWorld(profile([]))
        expect(Object.hasOwn(world.stored.manifest.fixed, 'workspaces')).toBe(false)
        expect([...previousOfTree(world.stored).units.keys()].filter(identity => identity.startsWith('ws'))).toEqual([])
    })

    test('N: a file whose bytes the source lacks is registered by key and Ref without a digest, its neighbours keep theirs', async () => {
        const world = await seedWorld()
        const missing = keyOfIdentity(world, 'wsf:w1:f2')
        const source = { get: (key: string) => key === missing ? undefined : world.stored.source.get(key) }
        const read = previousOfTree({ ...world.stored, source })
        const unit = read.units.get('wsf:w1:f2')
        expect(unit?.key).toBe(missing)
        expect(unit?.ref).toEqual(previousFrom(world.tree).units.get('wsf:w1:f2')?.ref)
        expect(unit?.digest).toBeUndefined()
        expect(read.units.get('wsf:w1:f1')?.digest).toBeDefined()
        expect(read.units.get('ws:w1')?.digest).toBeDefined()
    })

    test('N: a record the source does not hold is refused, not skipped', async () => {
        const world = await seedWorld()
        const missing = keyOfIdentity(world, 'ws:w2')
        const source = { get: (key: string) => key === missing ? undefined : world.stored.source.get(key) }
        expect(() => previousOfTree({ ...world.stored, source })).toThrow(CodecAssembleError)
    })
})

describe('T3 boot: a record whose ids cannot name a unit is refused', () => {
    /** The stored tree with the record of `w1` replaced by `body`, framed and named by a Ref that matches it. */
    function withRecord(world: World, body: object): StoredTree {
        const key = keyOfIdentity(world, 'ws:w1')
        const bytes = encodeUnit(UNIT_TYPE.workspace, body as WorkspaceRecord)
        const manifest: Manifest = JSON.parse(JSON.stringify(world.stored.manifest))
        manifest.fixed.workspaces = (manifest.fixed.workspaces ?? []).map(ref => keyOfRef(ref) === key ? refOfFrame(key, bytes) : ref)
        return { ...world.stored, manifest, source: { get: (name: string) => name === key ? bytes : world.stored.source.get(name) } }
    }

    const fileEntry = (world: World, id: string) => {
        const record = bodyOfRecord(world)
        return { ...record.files[0], id }
    }

    function bodyOfRecord(world: World): WorkspaceRecord {
        const key = keyOfIdentity(world, 'ws:w1')
        const read = readUnit(world.stored.source.get(key) as Uint8Array, UNIT_TYPE.workspace)
        if (read.status !== 'ok') {
            throw new Error('The record does not read.')
        }
        return read.value.body as WorkspaceRecord
    }

    test('G: the same record re-framed under its own ids registers as it did', async () => {
        const world = await seedWorld()
        const record = bodyOfRecord(world)
        const previous = previousOfTree(withRecord(world, record))
        expect(previous.units.get('wsf:w1:f1')).toBeDefined()
    })

    test('N: a workspace id with a colon, an empty id and a non-string id are each refused', async () => {
        const world = await seedWorld()
        const record = bodyOfRecord(world)
        for (const id of ['a:b', '', 7]) {
            expect(() => previousOfTree(withRecord(world, { ...record, ws: { ...record.ws, id } })), String(id)).toThrow(CodecAssembleError)
        }
    })

    test('N: a file id with a colon, and a file id repeated within a workspace, are refused', async () => {
        const world = await seedWorld()
        const record = bodyOfRecord(world)
        expect(() => previousOfTree(withRecord(world, { ...record, files: [fileEntry(world, 'x:y')] }))).toThrow(CodecAssembleError)
        expect(() => previousOfTree(withRecord(world, { ...record, files: [record.files[0], record.files[0]] }))).toThrow(CodecAssembleError)
    })
})

describe('T3 boot: a damaged workspace record is a fixed-unit finding, a damaged file a flagged leaf', () => {
    const DAMAGES: { name: string, apply: (bytes: Uint8Array) => Uint8Array | null }[] = [
        { name: 'missing', apply: () => null },
        { name: 'a flipped payload byte', apply: bytes => flipped(bytes, FRAME_HEADER_BYTES + 1) },
        { name: 'a changed stored checksum', apply: bytes => flipped(bytes, bytes.length - 1) },
    ]

    for (const identity of ['wsf:w1:f2', 'wsf:w2:f3']) {
        for (const damage of DAMAGES) {
            test(`N: ${identity} ${damage.name} is a flagged workspace-file leaf with the workspace and path, and the read is ok`, async () => {
                const world = await seedWorld()
                const key = keyOfIdentity(world, identity)
                world.memory.poke(key, damage.apply(world.memory.snapshot().get(key) as Uint8Array))
                const read = await readTreeBytes(world.memory, world.manifestKey)
                expect(read.status).toBe('ok')
                if (read.status === 'ok') {
                    const [wsId, path] = identity === 'wsf:w1:f2' ? ['w1', 'notes/a.md'] : ['w2', 'x.txt']
                    expect(read.flagged).toEqual([{ kind: 'workspace-file', wsId, path, key, why: damage.name === 'missing' ? 'missing' : 'damaged' }])
                }
            })
        }
    }

    for (const identity of ['ws:w1']) {
        for (const damage of DAMAGES) {
            test(`N: ${identity} ${damage.name} makes the read structure and names the key`, async () => {
                const world = await seedWorld()
                const key = keyOfIdentity(world, identity)
                const original = world.memory.snapshot().get(key)
                world.memory.poke(key, damage.apply(original as Uint8Array))
                const read = await readTreeBytes(world.memory, world.manifestKey)
                expect(read.status).toBe('structure')
                if (read.status === 'structure') {
                    expect(read.keys).toContain(key)
                    // Only absent units: the read says so, as for any fixed unit.
                    expect(read.tree).toBe(damage.name === 'missing' ? 'missing' : 'damaged')
                }
            })
        }
    }

    test('N: a damaged record names no files, so its own finding stands alone', async () => {
        const world = await seedWorld()
        const key = keyOfIdentity(world, 'ws:w1')
        world.memory.poke(key, null)
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status === 'structure' && read.keys).toEqual([key])
    })

    test('N: a workspace unit in a newer frame format makes the read too-new, which wins', async () => {
        const world = await seedWorld()
        const key = keyOfIdentity(world, 'wsf:w1:f1')
        world.memory.poke(key, tooNew(world.memory.snapshot().get(key) as Uint8Array))
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status).toBe('too-new')
    })

    test('G: an undamaged tree with workspaces reads ok with nothing flagged', async () => {
        const world = await seedWorld()
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status).toBe('ok')
        expect(read.status === 'ok' && read.flagged).toEqual([])
    })
})

describe('T3c boot: a workspace record\'s unknown top-level fields are carried to the next record', () => {
    const FUTURE = { note: 'from a newer build', nested: { n: 1 } }

    /** The stored tree whose record of `w1` also holds `extra` at the top level. */
    function withExtras(world: World, extra: object): StoredTree {
        const key = keyOfIdentity(world, 'ws:w1')
        const record = readUnit(world.stored.source.get(key) as Uint8Array, UNIT_TYPE.workspace)
        if (record.status !== 'ok') {
            throw new Error('The record does not read.')
        }
        const bytes = encodeUnit(UNIT_TYPE.workspace, { ...extra, ...record.value.body } as WorkspaceRecord)
        const manifest: Manifest = JSON.parse(JSON.stringify(world.stored.manifest))
        manifest.fixed.workspaces = (manifest.fixed.workspaces ?? []).map(ref => keyOfRef(ref) === key ? refOfFrame(key, bytes) : ref)
        return { ...world.stored, manifest, source: { get: (name: string) => name === key ? bytes : world.stored.source.get(name) } }
    }

    function recordWritten(tree: EncodedTree, identity: string): Obj {
        const unit = tree.units.find(candidate => candidate.identity === identity)
        const read = unit === undefined || !isWrittenUnit(unit) ? undefined : readUnit(unit.bytes, UNIT_TYPE.workspace)
        if (read === undefined || read.status !== 'ok') {
            throw new Error(`No readable ${identity} record in the tree.`)
        }
        return read.value.body as unknown as Obj
    }

    function edited(world: World, stored: StoredTree): Database {
        const assembled = assembleDatabase(stored.manifest, stored.source) as unknown as { utilityWorkspaces: { files: Obj[] }[] }
        assembled.utilityWorkspaces[0].files[1].text = 'edited'
        return assembled as unknown as Database
    }

    test('N: the boot previous holds the extras by workspace id, and none for a record without any', async () => {
        const world = await seedWorld()
        const previous = previousOfTree(withExtras(world, FUTURE))
        expect([...(previous.objects?.workspaces ?? new Map()).keys()]).toEqual(['w1'])
        expect(previous.objects?.workspaces?.get('w1')).toEqual(FUTURE)
        expect(previousOfTree(world.stored).objects?.workspaces).toBeUndefined()
    })

    test('N: the record the next pass writes keeps the extras (boot path), and the other workspace gets none', async () => {
        const world = await seedWorld()
        const stored = withExtras(world, FUTURE)
        const next = encodeWith(edited(world, stored), { previous: previousOfTree(stored), seq: 2, env: seededEnv(2) })
        expect(recordWritten(next, 'ws:w1')).toMatchObject({ v: 1, ...FUTURE })
        expect([...(previousFrom(next).objects?.workspaces ?? new Map()).keys()]).toEqual(['w1'])
        expect(previousFrom(next).objects?.workspaces?.get('w1')).toEqual(FUTURE)
    })

    test('N: an extra named like a known field never overwrites it', async () => {
        const world = await seedWorld()
        const previous = previousOfTree(world.stored)
        previous.objects = { ...previous.objects, workspaces: new Map([['w1', { ...FUTURE, v: 99, ws: { id: 'x' }, files: [] }]]) }
        const assembled = assembleDatabase(world.stored.manifest, world.stored.source) as unknown as { utilityWorkspaces: { files: Obj[] }[] }
        assembled.utilityWorkspaces[0].files[1].text = 'edited'
        const next = encodeWith(assembled as unknown as Database, { previous, seq: 2, env: seededEnv(2) })
        const record = recordWritten(next, 'ws:w1')
        expect(record.v).toBe(1)
        expect((record.ws as Obj).id).toBe('w1')
        expect((record.files as unknown[]).length).toBe(2)
        expect(record.note).toBe(FUTURE.note)
    })

    test('N: a deleted workspace\'s extras do not come back when a workspace of that id is added again', async () => {
        const world = await seedWorld()
        const stored = withExtras(world, FUTURE)
        const fresh = JSON.parse(JSON.stringify(assembleDatabase(stored.manifest, stored.source))) as { utilityWorkspaces: Obj[] }
        const w1 = fresh.utilityWorkspaces[0]
        fresh.utilityWorkspaces = fresh.utilityWorkspaces.slice(1)
        const without = encodeWith(fresh as unknown as Database, { previous: previousOfTree(stored), seq: 2, env: seededEnv(2) })
        expect(previousFrom(without).objects?.workspaces?.has('w1') ?? false).toBe(false)
        fresh.utilityWorkspaces = [w1, ...fresh.utilityWorkspaces]
        const again = encodeWith(fresh as unknown as Database, { previous: previousFrom(without), seq: 3, env: seededEnv(3) })
        expect(Object.keys(recordWritten(again, 'ws:w1')).sort()).toEqual(['files', 'v', 'ws'])
    })
})