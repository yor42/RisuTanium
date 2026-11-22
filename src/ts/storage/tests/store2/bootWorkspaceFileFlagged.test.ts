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

import { FRAME_HEADER_BYTES, keyOfRef, readUnit, UNIT_TYPE, type WorkspaceRecord } from 'src/ts/storage/store2/format'
import type { Database } from 'src/ts/storage/database.svelte'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { createLeafFallback } from 'src/ts/storage/store2/leafFallback'
import { resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { flaggedLists } from 'src/ts/storage/store2/ui/bootText'
import { resetRetainedForTest } from 'src/ts/process/coldRetained'
import { bootThroughDispatch, createClock, seedTree, testEnv } from '../store2SaveKit'
import { asDatabase, buildSmall, fakeLists, type Obj } from './codecFixtures'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'

/**
 * A damaged workspace file unit is a flagged leaf (#202 S6b, T23a), not a structural finding: the boot read names it by
 * workspace and path, a continued open gives that file an entry without text and every other file its text, and the
 * next save carries the earlier unit, so the record keeps the Ref and the collection mark keeps the unit. A damaged
 * workspace record stays structural. Every case boots through the real dispatch over an in-memory backend.
 */

function file(id: string, path: string, text: string): Obj {
    return { id, path, text, size: new TextEncoder().encode(text).length, mtime: 5 }
}

function workspaces(): Obj[] {
    return [{ id: 'w1', name: 'First', createdAt: 1000, files: [file('f1', 'AGENTS.md', 'rules'), file('f2', 'notes/a.md', 'note')] }]
}

interface World {
    memory: MemoryBackend
    manifestKey: string
    keyOf: (identity: string) => string
}

async function seedWorld(): Promise<World> {
    const memory = createMemoryBackend()
    const source = asDatabase({ ...(buildSmall(1) as unknown as Obj), archiveCharacters: false, utilityWorkspaces: workspaces() })
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
    return {
        memory, manifestKey: seeded.manifestKey,
        keyOf: (identity) => {
            const unit = seeded.tree.units.find(candidate => candidate.identity === identity)
            if (unit === undefined) {
                throw new Error(`No unit ${identity} in the tree.`)
            }
            return unit.key
        },
    }
}

function damage(world: World, key: string): void {
    const bytes = new Uint8Array(world.memory.snapshot().get(key) as Uint8Array)
    bytes[FRAME_HEADER_BYTES + 1] ^= 0xff
    world.memory.poke(key, bytes)
}

function opened(result: Store2BootResult): Extract<Store2BootResult, { kind: 'store2' }> {
    if (result.kind !== 'store2') {
        throw new Error(`The boot answered ${result.kind}.`)
    }
    return result
}

type Files = Obj[]

function filesOf(database: Database): Files {
    return ((database as unknown as Obj).utilityWorkspaces as { files: Files }[])[0].files
}

function resetPage(): void {
    resetStore2SaveForTest()
    resetResidencyForTest()
    resetStore2BootForTest()
    resetPageStorageModeForTests()
    resetRetainedForTest()
}

beforeEach(() => {
    vi.clearAllMocks()
    resetPage()
})

afterEach(() => {
    resetPage()
})

describe('T23a: the read names a damaged workspace file and the open leaves it without text', () => {
    test('N: a damaged file is one flagged leaf named by workspace and path, and the read is ok', async () => {
        const world = await seedWorld()
        const key = world.keyOf('wsf:w1:f2')
        damage(world, key)
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status).toBe('ok')
        if (read.status !== 'ok') {
            return
        }
        expect(read.flagged).toEqual([{ kind: 'workspace-file', wsId: 'w1', path: 'notes/a.md', key, why: 'damaged' }])
        const fallback = createLeafFallback(read.flagged, () => 0)
        const lists = flaggedLists(fallback.items())
        expect(lists).toHaveLength(1)
        expect(lists[0].heading).toContain('w1')
        expect(lists[0].items).toHaveLength(1)
        expect(lists[0].items[0]).toContain('notes/a.md')
    })

    test('N: a missing file is flagged as missing', async () => {
        const world = await seedWorld()
        const key = world.keyOf('wsf:w1:f1')
        world.memory.poke(key, null)
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status === 'ok' && read.flagged.map(leaf => [leaf.kind, leaf.why])).toEqual([['workspace-file', 'missing']])
    })

    test('N: a damaged workspace record stays structural: no flag, row 6', async () => {
        const world = await seedWorld()
        const key = world.keyOf('ws:w1')
        damage(world, key)
        const read = await readTreeBytes(world.memory, world.manifestKey)
        expect(read.status).toBe('structure')
        expect(read.status === 'structure' && read.keys).toEqual([key])
    })

    test('N: the assembly gives the flagged file no text and every other file its text, with the file fields intact', async () => {
        const world = await seedWorld()
        damage(world, world.keyOf('wsf:w1:f2'))
        const read = await readTreeBytes(world.memory, world.manifestKey)
        if (read.status !== 'ok') {
            throw new Error(`The read is ${read.status}.`)
        }
        const fallback = createLeafFallback(read.flagged, () => 0)
        const database = assembleDatabase(read.tree.manifest, read.tree.source, { placeholderWorkspaceFiles: fallback.placeholderWorkspaceFiles })
        expect(filesOf(database)).toEqual([file('f1', 'AGENTS.md', 'rules'), { id: 'f2', path: 'notes/a.md', size: 4, mtime: 5 }])
        expect(Object.hasOwn(filesOf(database)[1], 'text')).toBe(false)
    })

    test('N: a continued boot opens the profile with the placeholder entry', async () => {
        const world = await seedWorld()
        damage(world, world.keyOf('wsf:w1:f2'))
        const boot = await bootThroughDispatch(world.memory, { flagged: 'continue' })
        const files = filesOf(opened(boot.result).database)
        expect(files.map(entry => entry.id)).toEqual(['f1', 'f2'])
        expect(files[0].text).toBe('rules')
        expect(Object.hasOwn(files[1], 'text')).toBe(false)
    })

    test('G: declining the question opens nothing', async () => {
        const world = await seedWorld()
        damage(world, world.keyOf('wsf:w1:f2'))
        const boot = await bootThroughDispatch(world.memory, { flagged: 'decline' })
        expect(boot.result.kind).toBe('stopped')
        expect(getActiveStore2Save()).toBeNull()
    })
})

describe('T23a: the next save keeps the damaged file\'s Ref and the mark keeps its unit', () => {
    async function savedAfterContinue(edit: (files: Files) => void) {
        const world = await seedWorld()
        const damagedKey = world.keyOf('wsf:w1:f2')
        const healthyKey = world.keyOf('wsf:w1:f1')
        damage(world, damagedKey)
        const boot = await bootThroughDispatch(world.memory, { flagged: 'continue' })
        const database = opened(boot.result).database
        edit(filesOf(database))
        const context = getActiveStore2Save()
        const committer = context?.session.committer
        if (context === null || context.encoder === undefined || committer === null || committer === undefined) {
            throw new Error('No save context.')
        }
        const plan = await context.encoder.plan(database, { marked: new Set<string>(), modules: false, whole: false })
        const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
        expect(result.status).toBe('committed')
        plan.acknowledge()
        const commit = classifyCommitRead(await world.memory.readCommit())
        if (commit.status !== 'parsed' || commit.value.current === null) {
            throw new Error('The commit key names no current tree.')
        }
        return { world, damagedKey, healthyKey, current: commit.value.current.key }
    }

    async function savedRecord(saved: { world: World, current: string }): Promise<WorkspaceRecord> {
        const read = await readTreeBytes(saved.world.memory, saved.current)
        if (read.status !== 'ok') {
            throw new Error(`The saved tree reads ${read.status}.`)
        }
        const ref = read.tree.manifest.fixed.workspaces?.[0]
        if (ref === undefined) {
            throw new Error('The saved manifest names no workspace.')
        }
        const parsed = readUnit(saved.world.memory.snapshot().get(keyOfRef(ref)) as Uint8Array, UNIT_TYPE.workspace)
        if (parsed.status !== 'ok') {
            throw new Error('The saved record does not read.')
        }
        return parsed.value.body as WorkspaceRecord
    }

    test('N: the record of the next save keeps the damaged file\'s Ref and names the healthy file\'s new text unit', async () => {
        const saved = await savedAfterContinue((files) => { files[0].text = 'edited' })
        const record = await savedRecord(saved)
        expect(record.files.map(entry => entry.id)).toEqual(['f1', 'f2'])
        expect(keyOfRef(record.files[1].ref)).toBe(saved.damagedKey)
        expect(keyOfRef(record.files[0].ref)).not.toBe(saved.healthyKey)
    })

    test('N: the mark keeps the damaged file\'s unit and the healthy file\'s new unit', async () => {
        const saved = await savedAfterContinue((files) => { files[0].text = 'edited' })
        const marked = await markLiveKeys(saved.world.memory, await saved.world.memory.readCommit())
        expect(marked.status).toBe('marked')
        if (marked.status === 'marked') {
            expect(marked.live.has(saved.damagedKey)).toBe(true)
            const record = await savedRecord(saved)
            expect(marked.live.has(keyOfRef(record.files[0].ref))).toBe(true)
        }
    })

    test('N: the saved tree still reads the file as damaged and every other file back', async () => {
        const saved = await savedAfterContinue((files) => { files[0].text = 'edited' })
        const read = await readTreeBytes(saved.world.memory, saved.current)
        if (read.status !== 'ok') {
            throw new Error(`The saved tree reads ${read.status}.`)
        }
        expect(read.flagged.map(leaf => leaf.key)).toEqual([saved.damagedKey])
        const fallback = createLeafFallback(read.flagged, () => 0)
        const database = assembleDatabase(read.tree.manifest, read.tree.source, { placeholderWorkspaceFiles: fallback.placeholderWorkspaceFiles })
        expect(filesOf(database)[0].text).toBe('edited')
    })
})
