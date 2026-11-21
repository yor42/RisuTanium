// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import type { JsonObject } from '../../blockFrame'
import type { Database } from '../../database.svelte'
import { createMemoryBackend, type Store2Backend } from '../../store2/backend'
import { readBaseContentIndex } from '../../store2/baseContent'
import { classifyBoot } from '../../store2/boot'
import { assembleDatabase, CodecInputError, planScopedEncode, previousFrom, type EncodedTree } from '../../store2/codec'
import { checkTree, createKeyMint, DESCENT } from '../../store2/commit'
import { classifyCommitRead, firstCommitKey } from '../../store2/commitKey'
import { readFenceVerdict } from '../../store2/fence'
import {
    encodeUnit, FRAME_HEADER_BYTES, keyOfRef, KNOWN_REQ, PARENT_UNIT_TYPES, parseManifest, parseUnitBody, readUnit, refsOf, REFS_TABLE,
    UNIT_TYPE, type Manifest, type WorkspaceRecord,
} from '../../store2/format'
import { markLiveKeys } from '../../store2/gc/mark'
import { pickCandidate, PATH_TYPES, unmappedRefPaths } from '../../store2/recoveryPick'
import { WALK_PARENT_TYPES } from '../../store2/rtb/rows'
import { readTree, TREE_READ_TYPES } from '../../store2/tree'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { asDatabase, bodyOf, buildSmall, bytesOf, encodeWith, fakeLists, seededEnv, unitOf, type Obj } from './codecFixtures'
import { bytesToHex, GOLDEN_VECTORS, hexToBytes } from './goldenVectors'
import { captureExport, rtbWorld, type RtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

/**
 * Utility workspaces in the store2 format (#202 S1a-1): a workspace is a type 28 record named by `fixed.workspaces`, each of
 * its files a type 29 unit named by the record; the `utility-workspaces` token marks a store that has held one. Literals
 * (28, 29, 'utility-workspaces') are used where a reproducer must fail on a base that has neither the types nor the
 * constants. Labels: R reproducer (fails on the base), G guard (passes before and after), N new-rule test (proven by its
 * scratch mutants).
 */

const TOKEN = 'utility-workspaces'
const WS_TYPE = 28
const FILE_TYPE = 29

function file(id: string, path: string, text: string, extra: Obj = {}): Obj {
    return { id, path, text, size: new TextEncoder().encode(text).length, mtime: 5, ...extra }
}

function workspace(id: string, files: Obj[], extra: Obj = {}): Obj {
    return { id, name: `Workspace ${id}`, createdAt: 1000, files, ...extra }
}

function withWorkspaces(list: unknown, characters = 2): Database {
    return asDatabase({ ...buildSmall(characters) as unknown as Obj, utilityWorkspaces: list })
}

const TWO_FILES = (): Obj[] => [workspace('w1', [file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', 'note')])]

function assemble(tree: EncodedTree, ...earlier: EncodedTree[]): Database {
    const bytes = new Map<string, Uint8Array>()
    for (const one of [...earlier, tree]) {
        for (const unit of one.units) {
            if (unit.reused === false) {
                bytes.set(unit.key, unit.bytes)
            }
        }
    }
    return assembleDatabase(tree.manifest, { get: key => bytes.get(key) })
}

function recordBodyOf(tree: EncodedTree, id: string): WorkspaceRecord {
    return bodyOf(unitOf(tree, `ws:${id}`)) as unknown as WorkspaceRecord
}

describe('T1 workspaces: encode and assemble', () => {
    test('R: a workspace is a type 28 record over type 29 file units, named by fixed.workspaces, not a config field', () => {
        const tree = encodeWith(withWorkspaces(TWO_FILES()))
        const config = bodyOf(unitOf(tree, 'config')).f as JsonObject
        expect(config.utilityWorkspaces).toBeUndefined()
        const named = (tree.manifest.fixed as unknown as { workspaces?: unknown[] }).workspaces
        expect(named).toHaveLength(1)
        expect(unitOf(tree, 'ws:w1').type).toBe(WS_TYPE)
        expect(unitOf(tree, 'wsf:w1:f1').type).toBe(FILE_TYPE)
        expect(unitOf(tree, 'wsf:w1:f2').type).toBe(FILE_TYPE)
        expect(tree.manifest.req).toEqual([TOKEN])
        expect(bodyOf(unitOf(tree, 'wsf:w1:f1'))).toEqual({ v: 1, text: 'rules' })
        const record = recordBodyOf(tree, 'w1')
        expect(record.ws).toEqual({ id: 'w1', name: 'Workspace w1', createdAt: 1000 })
        expect(record.files.map(entry => [entry.id, entry.path, entry.size, entry.mtime])).toEqual([['f1', 'AGENTS.md', 5, 5], ['f2', 'notes/a.md', 4, 5]])
        expect(JSON.stringify(record)).not.toContain('rules')
    })

    test('G: the workspaces round trip deep-equal, unknown record and file fields included', () => {
        const input = withWorkspaces([
            workspace('w1', [file('f1', 'AGENTS.md', 'rules', { futureFile: { n: [1] } })], { futureWs: 'kept' }),
            workspace('w2', []),
        ])
        const tree = encodeWith(input)
        expect(assemble(tree).utilityWorkspaces).toEqual(input.utilityWorkspaces)
    })

    test('N: an unchanged re-encode reuses every unit; a rename rewrites only the record; a text edit rewrites its file and the record', () => {
        const first = encodeWith(withWorkspaces(TWO_FILES()))
        const same = encodeWith(assemble(first), { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        for (const identity of ['ws:w1', 'wsf:w1:f1', 'wsf:w1:f2']) {
            expect(unitOf(same, identity).reused, identity).toBe(true)
            expect(unitOf(same, identity).key).toBe(unitOf(first, identity).key)
        }

        const renamed = assemble(first)
        ;(renamed.utilityWorkspaces as unknown as Obj[] as { files: Obj[] }[])[0].files[0].path = 'docs/AGENTS.md'
        const afterRename = encodeWith(renamed, { previous: previousFrom(first), seq: 2, env: seededEnv(3) })
        expect(unitOf(afterRename, 'wsf:w1:f1').reused).toBe(true)
        expect(unitOf(afterRename, 'wsf:w1:f1').key).toBe(unitOf(first, 'wsf:w1:f1').key)
        expect(unitOf(afterRename, 'ws:w1').reused).toBe(false)

        const edited = assemble(first)
        ;(edited.utilityWorkspaces as unknown as Obj[] as { files: Obj[] }[])[0].files[1].text = 'changed'
        const afterEdit = encodeWith(edited, { previous: previousFrom(first), seq: 2, env: seededEnv(4) })
        expect(unitOf(afterEdit, 'wsf:w1:f1').reused).toBe(true)
        expect(unitOf(afterEdit, 'wsf:w1:f2').reused).toBe(false)
        expect(unitOf(afterEdit, 'ws:w1').reused).toBe(false)
    })

    test('R: deleting the last workspace omits the field and keeps the token; a store without any has neither', () => {
        const first = encodeWith(withWorkspaces(TWO_FILES()))
        const emptied = encodeWith(withWorkspaces([]), { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        expect(Object.hasOwn(emptied.manifest.fixed, 'workspaces')).toBe(false)
        expect(emptied.manifest.req).toEqual([TOKEN])
        expect(Object.hasOwn(assemble(emptied, first), 'utilityWorkspaces')).toBe(false)

        const never = encodeWith(buildSmall(2))
        expect(Object.hasOwn(never.manifest.fixed, 'workspaces')).toBe(false)
        expect(never.manifest.req).toEqual([])
        expect(Object.hasOwn(assemble(never), 'utilityWorkspaces')).toBe(false)
    })

    test('N: a file with no text, a repeated id, an id holding ":" and a non-list are refused', () => {
        const noText = workspace('w1', [{ id: 'f1', path: 'a.md', size: 3, mtime: 1 }])
        expect(() => encodeWith(withWorkspaces([noText]))).toThrow(CodecInputError)
        expect(() => encodeWith(withWorkspaces([workspace('w1', []), workspace('w1', [])]))).toThrow(CodecInputError)
        expect(() => encodeWith(withWorkspaces([workspace('w:1', [])]))).toThrow(CodecInputError)
        expect(() => encodeWith(withWorkspaces([workspace('w1', [file('f:1', 'a.md', 'x')])]))).toThrow(CodecInputError)
        expect(() => encodeWith(withWorkspaces([workspace('w1', [file('f1', 'a.md', 'x'), file('f1', 'b.md', 'y')])]))).toThrow(CodecInputError)
        expect(() => encodeWith(withWorkspaces('not a list'))).toThrow(CodecInputError)
    })
})

describe('T2b workspaces: commit order and the tree check', () => {
    test('N: every file unit precedes its record, and the record precedes the manifest', () => {
        const tree = encodeWith(withWorkspaces(TWO_FILES()))
        const order = tree.units.map(unit => unit.identity)
        const record = order.indexOf('ws:w1')
        expect(record).toBeGreaterThan(order.indexOf('wsf:w1:f1'))
        expect(record).toBeGreaterThan(order.indexOf('wsf:w1:f2'))
        expect(order.indexOf('manifest')).toBeGreaterThan(record)
    })

    test('N: a finalized scoped plan names the real file keys in the record, writes only the files as leaves, and checkTree is complete over it', async () => {
        const now = 1_700_000_000_000
        const plan = await planScopedEncode(
            withWorkspaces(TWO_FILES()), { env: seededEnv(2), lists: fakeLists, seq: 1, createdAt: now }, { modules: true, characters: 'all' },
        )
        expect(plan.written.has('wsf:w1:f1')).toBe(true)
        expect(plan.written.has('ws:w1')).toBe(false)
        const tree = plan.finalize({ mint: createKeyMint(seededEnv(60), null).mint, seq: 1, now })
        const record = recordBodyOf(tree, 'w1')
        expect(record.files.map(entry => `store2/${entry.ref[0]}`)).toEqual([unitOf(tree, 'wsf:w1:f1').key, unitOf(tree, 'wsf:w1:f2').key])
        const backend = createMemoryBackend()
        await plant(backend, tree)
        expect((await checkTree(backend, tree.manifestKey)).status).toBe('complete')
    })

    test('N: checkTree is complete over a stored tree and incomplete when a file unit or the record is missing', async () => {
        for (const lost of ['wsf:w1:f2', 'ws:w1']) {
            const backend = createMemoryBackend()
            const seeded = await seedTree(backend, withWorkspaces(TWO_FILES()), testEnv(createClock(), 31), fakeLists)
            expect((await checkTree(backend, seeded.manifestKey)).status).toBe('complete')
            const unit = unitOf(seeded.tree, lost)
            backend.poke(unit.key, null)
            const check = await checkTree(backend, seeded.manifestKey)
            expect(check.status, lost).toBe('incomplete')
            expect(check.status === 'incomplete' && check.missing).toContain(unit.key)
        }
    })
})

/** The commit key naming `current`, with `retained` manifests, over `backend`. */
async function publish(backend: Store2Backend, current: string, retained: string[] = []): Promise<ReturnType<Store2Backend['readCommit']>> {
    const key = firstCommitKey({
        current: { key: current, at: 1 }, retained: retained.map(retainedKey => ({ key: retainedKey, at: 1 })), pins: [], staging: null,
    }, testEnv(createClock(), 5))
    await backend.casCommit((await backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, key))
    return backend.readCommit()
}

async function plant(backend: Store2Backend, tree: EncodedTree): Promise<void> {
    for (const unit of tree.units) {
        if (unit.reused === false) {
            await backend.putUnit(unit.key, unit.bytes)
        }
    }
}

describe('T2 workspaces: the production mark', () => {
    test('R: the files named only through a workspace record are live; a deleted file is live only while a retained manifest names it', async () => {
        const backend = createMemoryBackend()
        const first = encodeWith(withWorkspaces(TWO_FILES()), { env: seededEnv(41) })
        const slimmed = assemble(first)
        ;(slimmed.utilityWorkspaces as unknown as Obj[] as { files: Obj[] }[])[0].files.pop()
        const second = encodeWith(slimmed, { previous: previousFrom(first), seq: 2, env: seededEnv(42) })
        await plant(backend, first)
        await plant(backend, second)
        const f1 = unitOf(second, 'wsf:w1:f1').key
        const f2 = unitOf(first, 'wsf:w1:f2').key
        expect(unitOf(second, 'wsf:w1:f1').key).toBe(unitOf(first, 'wsf:w1:f1').key)

        const both = await markLiveKeys(backend, await publish(backend, second.manifestKey, [first.manifestKey]))
        expect(both.status).toBe('marked')
        expect(both.status === 'marked' && both.live.has(f1) && both.live.has(f2)).toBe(true)
        expect(both.status === 'marked' && both.live.has(unitOf(second, 'ws:w1').key)).toBe(true)

        // Once the first manifest leaves the commit key, nothing names the deleted file: a sweep may age it out.
        const aged = await markLiveKeys(backend, await publish(backend, second.manifestKey))
        expect(aged.status).toBe('marked')
        expect(aged.status === 'marked' && aged.live.has(f1)).toBe(true)
        expect(aged.status === 'marked' && aged.live.has(f2)).toBe(false)
    })
})

describe('T23b workspaces: a damaged record takes the structural path', () => {
    test('G: a damaged record reads as damaged, classifies as boot row 6 and the mark refuses; a damaged file is a leaf', async () => {
        const backend = createMemoryBackend()
        const seeded = await seedTree(backend, withWorkspaces(TWO_FILES()), testEnv(createClock(), 51), fakeLists)
        const damage = (key: string): void => {
            const flipped = new Uint8Array(backend.snapshot().get(key) as Uint8Array)
            flipped[FRAME_HEADER_BYTES + 1] ^= 0xff
            backend.poke(key, flipped)
        }

        damage(unitOf(seeded.tree, 'wsf:w1:f2').key)
        const leafRead = await readTree(backend, seeded.manifestKey)
        expect(leafRead.status).toBe('ok')

        const recordKey = unitOf(seeded.tree, 'ws:w1').key
        damage(recordKey)
        const read = await readTree(backend, seeded.manifestKey)
        expect(read.status).toBe('damaged')
        expect(read.status === 'damaged' && read.keys).toContain(recordKey)
        const decision = classifyBoot({
            commit: classifyCommitRead(await backend.readCommit()),
            fence: await readFenceVerdict(backend),
            presence: null,
            tree: read,
            upstreamMainFile: false,
            ownerId: 'z'.repeat(26),
            deviceOwner: false,
        })
        expect(decision).toMatchObject({ row: 6, mode: 'recovery', tree: 'damaged' })
        const marked = await markLiveKeys(backend, await backend.readCommit())
        expect(marked.status).toBe('refused')
        expect(marked.status === 'refused' && marked.reason).toBe('closure-not-ok')
    })
})

describe('T4 workspaces: the .rtb export closure', () => {
    test('R: the export carries the record and every file unit, and the walk rows are populated', async () => {
        const world: RtbWorld = await rtbWorld({ layout: 1 })
        const captured = await captureExport(await world.open())
        const fileTails = world.keysOfType(FILE_TYPE).map(key => key.slice('store2/'.length))
        const recordTails = world.keysOfType(WS_TYPE).map(key => key.slice('store2/'.length))
        expect(fileTails).toHaveLength(2)
        expect(recordTails).toHaveLength(1)
        for (const tail of [...fileTails, ...recordTails]) {
            expect(captured.frames.has(tail), tail).toBe(true)
        }
        expect(world.refsByRow.has('2:fixed.workspaces[]')).toBe(true)
        expect(world.refsByRow.has('28:files[].ref')).toBe(true)
    })
})

describe('T4b workspaces: recovery', () => {
    test('N: a candidate whose file unit is missing is invalid and names it; checkTree agrees', async () => {
        const backend = createMemoryBackend()
        const clock = createClock()
        await seedTree(backend, buildSmall(2), testEnv(clock, 61), fakeLists)
        const candidate = encodeWith(withWorkspaces(TWO_FILES()), { seq: 5, env: seededEnv(62) })
        const lost = unitOf(candidate, 'wsf:w1:f1').key
        for (const unit of candidate.units) {
            if (unit.key !== lost) {
                await backend.putUnit(unit.key, bytesOf(unit))
            }
        }

        const picked = await pickCandidate(backend, await backend.readCommit(), candidate.manifestKey, {
            owner: 'a'.repeat(26),
            env: testEnv(clock, 63),
            assetsPresent: async keys => new Set(keys),
            inlaysPresent: async keys => new Set(keys),
            inlayPrefixesPresent: async prefixes => new Set(prefixes),
        })
        expect(picked.status).toBe('invalid')
        expect(picked.status === 'invalid' && picked.problem).toMatchObject({ kind: 'missing' })
        expect(JSON.stringify(picked.status === 'invalid' ? picked.problem : null)).toContain(lost)
        const check = await checkTree(backend, candidate.manifestKey)
        expect(check.status === 'incomplete' && check.missing).toContain(lost)
    })
})

describe('T5 workspaces: the requirement token', () => {
    test('G + N: the token is in the key set, is written with the first workspace, and a build that knows it reads the manifest', () => {
        expect(KNOWN_REQ.has(TOKEN)).toBe(true)
        const tree = encodeWith(withWorkspaces(TWO_FILES()))
        const parsed = parseManifest(JSON.parse(JSON.stringify(tree.manifest)))
        expect(parsed.status).toBe('ok')
        expect(parsed.status === 'ok' && parsed.value.req).toContain(TOKEN)
    })

    test('G: a manifest that also lists a token this build does not know is too-new, so an older build stays read-only with the bytes kept', () => {
        const tree = encodeWith(withWorkspaces(TWO_FILES()))
        const future = JSON.parse(JSON.stringify(tree.manifest)) as Manifest
        future.req = [TOKEN, 'utility-workspaces-next']
        expect(parseManifest(future as unknown as JsonObject).status).toBe('too-new')
    })

    test('N: the token is never lowered by a later write, whether the list empties or the field is absent', () => {
        const first = encodeWith(withWorkspaces(TWO_FILES()))
        const later = encodeWith(buildSmall(2), { previous: previousFrom(first), seq: 2, env: seededEnv(2) })
        expect(later.manifest.req).toContain(TOKEN)
    })
})

describe('T6b workspaces: the derived parent set and the tables', () => {
    test('N: the parent set is every row type except the commit key and the manifest, and the walks share it', () => {
        const derived = new Set(REFS_TABLE.map(row => row.type).filter(type => type !== UNIT_TYPE.commit && type !== UNIT_TYPE.manifest))
        expect([...PARENT_UNIT_TYPES].sort((a, b) => a - b)).toEqual([...derived].sort((a, b) => a - b))
        expect([...PARENT_UNIT_TYPES].sort((a, b) => a - b)).toEqual([
            UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.pluginStorageBucket, UNIT_TYPE.moduleBucket, UNIT_TYPE.workspace,
        ].sort((a, b) => a - b))
        expect(WALK_PARENT_TYPES).toBe(PARENT_UNIT_TYPES)
    })

    test('N: the workspace positions are in every manifest descent table and both recovery path rows', () => {
        expect(TREE_READ_TYPES['fixed.workspaces[]']).toBe(WS_TYPE)
        expect(DESCENT['fixed.workspaces[]']).toBe(WS_TYPE)
        expect(PATH_TYPES['fixed.workspaces[]']).toBe(WS_TYPE)
        expect(PATH_TYPES['files[].ref']).toBe(FILE_TYPE)
        expect(unmappedRefPaths()).toEqual([])
    })

    test('N: the base content index descends into a workspace record and indexes its file units by digest', async () => {
        const backend = createMemoryBackend()
        const seeded = await seedTree(backend, withWorkspaces(TWO_FILES()), testEnv(createClock(), 71), fakeLists)
        const index = await readBaseContentIndex(backend, await backend.readCommit())
        for (const identity of ['wsf:w1:f1', 'wsf:w1:f2', 'ws:w1']) {
            const unit = unitOf(seeded.tree, identity)
            expect(index.units.get(unit.digest)?.map(candidate => candidate.key), identity).toEqual([unit.key])
        }
    })

    test('N: the record names its files through exactly the files[].ref row', () => {
        const tree = encodeWith(withWorkspaces(TWO_FILES()))
        const targets = refsOf(UNIT_TYPE.workspace, recordBodyOf(tree, 'w1'))
        expect(targets.map(target => target.path)).toEqual(['files[].ref', 'files[].ref'])
        expect(targets.map(target => `store2/${target.tail}`).sort()).toEqual([unitOf(tree, 'wsf:w1:f1').key, unitOf(tree, 'wsf:w1:f2').key].sort())
        expect(refsOf(UNIT_TYPE.manifest, tree.manifest).filter(target => target.path === 'fixed.workspaces[]')).toHaveLength(1)
    })
})

describe('T6 golden vectors of the workspace kind', () => {
    const byId = (id: string) => {
        const found = GOLDEN_VECTORS.find(vector => vector.id === id)
        if (found === undefined) {
            throw new Error(`No golden vector ${id}.`)
        }
        return found
    }

    test('N: the record vector keeps the fields this build does not know through a parse and a re-encode to the committed bytes', () => {
        const read = readUnit(hexToBytes(byId('type-28-workspace').hex), UNIT_TYPE.workspace)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const body = JSON.parse(JSON.stringify(read.value.body)) as WorkspaceRecord & { files: { future?: unknown }[] }
        expect(body.ws).toMatchObject({ id: 'w1', unknownKey: true })
        expect(body.files[0].future).toEqual({ k: 1 })
        expect(bytesToHex(encodeUnit(UNIT_TYPE.workspace, read.value.body))).toBe(byId('type-28-workspace').hex)
        expect(refsOf(UNIT_TYPE.workspace, read.value.body).map(target => target.path)).toEqual(['files[].ref'])
    })

    test('N: the file vector is exactly the text, and a body version above 1 is too-new, below 1 damaged', () => {
        const read = readUnit(hexToBytes(byId('type-29-workspace-file').hex), UNIT_TYPE.workspaceFile)
        expect(read.status).toBe('ok')
        expect(read.status === 'ok' && JSON.parse(JSON.stringify(read.value.body))).toEqual({ v: 1, text: '# Notes\nline' })
        expect(parseUnitBody(UNIT_TYPE.workspaceFile, { v: 2, text: '' }).status).toBe('too-new')
        expect(parseUnitBody(UNIT_TYPE.workspaceFile, { v: 0, text: '' }).status).toBe('damaged')
    })

    test('N: the manifest vector names its record by fixed.workspaces and carries the token', () => {
        const read = readUnit(hexToBytes(byId('manifest-workspaces').hex), UNIT_TYPE.manifest)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        const manifest = read.value.body as Manifest
        expect(manifest.req).toEqual([TOKEN])
        expect(manifest.fixed.workspaces).toHaveLength(1)
        expect(keyOfRef(manifest.fixed.workspaces?.[0] ?? ['', 0, 0])).toContain('u-cccc')
    })
})
