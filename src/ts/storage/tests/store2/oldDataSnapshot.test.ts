// @vitest-environment node
/**
 * The deletion snapshot written by the installs: a conversion and a seed add one type 24 unit under the marker's staging
 * prefix, write it before the manifest, and point at it from the commit key in the final write. The planner decides the
 * kind from what the store holds, so every entry of both installs (first life, recovery fresh start) goes through the
 * same plan. Each test says what it is: reproducer or guard. Without the planner this file fails at import, which proves
 * nothing; the reproducers are red against a planner that takes the kind from the calling path or writes no snapshot.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The dispatch reaches the page store selection only through the legacy block owner it disables; the selection drags in
// the app's boot chain, which a protocol test must not load.
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => { throw new Error('The page store is not selected in this test.') },
    getAppStoreKind: async () => { throw new Error('The page store is not selected in this test.') },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type MemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot, type Store2BootUi, type Store2RecoveryRequest } from 'src/ts/storage/store2/bootDispatch'
import { seedStore2Profile, type SeedEntry } from 'src/ts/storage/store2/bootSeed'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant, installBuilt } from 'src/ts/storage/store2/firstLife'
import {
    COMMIT_KEY, parseStore2Key, readUnit, UNIT_TYPE, type CommitKey, type DeletionSnapshot, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import { gcPass } from 'src/ts/storage/store2/gc/pass'
import { convertLegacyProfile, convertLegacyWithout, type ConvertRequest, type LegacyDecoders } from 'src/ts/storage/store2/legacy/convert'
import type { ColdUnitRead } from 'src/ts/storage/store2/legacy/storeReader'
import { planOldDataDeletion, withSnapshot } from 'src/ts/storage/store2/oldData/plan'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { listRecoveryCandidates, runExit } from 'src/ts/storage/store2/recovery'
import { installPick, pickCandidate } from 'src/ts/storage/store2/recoveryPick'
import { resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { BootScreenModel } from 'src/ts/storage/store2/ui/bootText'
import { runRecovery, type RecoveryCalls, type RecoveryPort } from 'src/ts/storage/store2/ui/recoveryController'
import { createClock, createPeerDouble, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists, type Obj } from './codecFixtures'
import { createClock as fixtureClock, parsedCommit, peerWrite, seedStore, testEnv as fixtureEnv, treeRequest } from './commitFixtures'

// The page's unit naming reads the platform at load; this stands in for the browser and Node naming.
vi.mock('src/ts/process/coldUnitLocation', () => ({
    coldUnitKeyOfStoreKey: (key: string) => {
        const name = key.slice('coldstorage/'.length)
        return key.startsWith('coldstorage/') && !name.includes('/') ? name : null
    },
}))

const MAIN = 'database/database.bin'
const backupKey = (time: number) => `database/dbbackup-${time}.bin`
const CHAT_UNIT = '00000000-0000-4000-8000-0000000000c1'
const OTHER_UNIT = '00000000-0000-4000-8000-0000000000c2'
const THIRD_UNIT = '00000000-0000-4000-8000-0000000000c3'
const NOW = () => 1

const owner = freshOwnerId(testEnv(createClock(), 1))

type Tree = Database

function treeWithColdChat(unit: string): Tree {
    const tree = JSON.parse(JSON.stringify(buildSmall(1))) as { characters: Obj[] }
    tree.characters[0].chats = [{ id: 'cold-chat', message: [{ time: 1, data: coldStorageHeader + unit, role: 'char' }], note: '', name: '', localLore: [] }]
    return tree as unknown as Tree
}

/** A profile as the fork's block store left it next to the upstream main file: blocks, a pre-blocks file, cold units. */
function plantOldFiles(store: MemoryByteStore, extra: string[] = []): void {
    for (const key of [
        'blocks/head', 'blocks/000000000001-aaaaaaaa/root', 'blocks/000000000001-aaaaaaaa/f/config', 'database/database.pre-blocks.1',
        `coldstorage/${CHAT_UNIT}`, `coldstorage/${OTHER_UNIT}`, `coldstorage/${OTHER_UNIT}_accessMeta`, ...extra,
    ]) {
        store.files.set(key, new Uint8Array([1]))
    }
}

interface Rig {
    store: MemoryByteStore
    memory: MemoryBackend
    /** The keys putUnit was asked for, in order. */
    order: string[]
    backend: Store2Backend
    request: ConvertRequest
}

interface RigOptions {
    trees: Record<number, Tree | 'bad'>
    mainByte?: number
    backups?: Record<number, number>
    /** A unit whose flush the backend reports as not done: a type 24 unit when set. */
    unflushedSnapshot?: boolean
}

async function rig(options: RigOptions): Promise<Rig> {
    const store = createMemoryByteStore()
    if (options.mainByte !== undefined) {
        store.files.set(MAIN, new Uint8Array([options.mainByte, 2, 3]))
    }
    for (const [time, byte] of Object.entries(options.backups ?? {})) {
        store.files.set(backupKey(Number(time)), new Uint8Array([byte]))
    }
    const decoders: LegacyDecoders = {
        async strict(bytes) {
            const entry = options.trees[bytes[0]]
            if (entry === undefined || entry === 'bad') {
                throw new Error('The file does not decode.')
            }
            return JSON.parse(JSON.stringify(entry)) as Tree
        },
        async lenient() {
            throw new Error('not used')
        },
    }
    const memory = createMemoryBackend()
    const order: string[] = []
    const backend: Store2Backend = {
        ...memory,
        async putUnit(key, bytes) {
            order.push(key)
            const written = await memory.putUnit(key, bytes)
            const read = readUnit(bytes)
            if (options.unflushedSnapshot === true && read.status === 'ok' && read.value.type === UNIT_TYPE.deletionSnapshot) {
                return { ...written, flushed: false }
            }
            return written
        },
    }
    const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'convert' }, commitRead: await memory.readCommit(), startupClear: null })
    if (granted.status !== 'granted') {
        throw new Error('No first-life grant.')
    }
    const readColdStorageItem = async (key: string): Promise<ColdUnitRead> => key === CHAT_UNIT
        ? { status: 'ok', value: { message: [{ time: 1, data: 'restored', role: 'char' }] } }
        : { status: 'missing' }
    return {
        store, memory, order, backend,
        request: {
            store,
            listBackupTimes: async () => [...store.files.keys()]
                .map(key => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
                .filter((match): match is RegExpExecArray => match !== null)
                .map(match => Number(match[1]))
                .sort((a, b) => b - a),
            readColdStorageItem,
            backend,
            entry: { kind: 'first-life', grant: granted.grant },
            owner,
            lists: fakeLists,
            env: testEnv(createClock(), 4242),
            decoders,
            resolve: { newId: () => 'placeholder-chat', now: NOW },
        },
    }
}

const accept = {
    async confirmFromBackup() { return true },
    async confirmIncomplete() { return true },
    async confirmSkipped() { return true },
}

async function snapshotOf(backend: Store2Backend): Promise<{ pointer: SnapshotPointer, bytes: Uint8Array, body: DeletionSnapshot, key: CommitKey } | null> {
    const key = await parsedCommit(backend)
    if (key.snapshot === undefined) {
        return null
    }
    const bytes = (await backend.readUnits([key.snapshot.key])).get(key.snapshot.key)
    if (bytes === undefined || bytes === null) {
        throw new Error('The pointed unit is absent.')
    }
    const read = readUnit(bytes, UNIT_TYPE.deletionSnapshot)
    if (read.status !== 'ok') {
        throw new Error(`The pointed unit reads ${read.status}.`)
    }
    return { pointer: key.snapshot, bytes, body: read.value.body as DeletionSnapshot, key }
}

describe('a conversion writes the snapshot', () => {
    test('reproducer: the unit is staged under the marker, written before the manifest, and the final write points at it by key, digest and count', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        plantOldFiles(w.store)
        const result = await convertLegacyProfile(w.request, accept)
        expect(result.status).toBe('installed')
        if (result.status !== 'installed') {
            return
        }
        const found = await snapshotOf(w.memory)
        expect(found, 'the commit key names a snapshot').not.toBeNull()
        if (found === null) {
            return
        }
        expect(found.pointer.digest).toBe(unitDigest(found.bytes))
        expect(found.pointer.count).toBe(found.body.keys.length)
        expect(parseStore2Key(found.pointer.key)?.shape).toBe('staged-unit')
        expect(w.order.indexOf(found.pointer.key)).toBeGreaterThanOrEqual(0)
        expect(w.order.indexOf(found.pointer.key)).toBeLessThan(w.order.indexOf(result.manifestKey))
        expect(found.key.staging).toBeNull()
        expect(found.key.current?.key).toBe(result.manifestKey)
        // The unit sits under the same staging id the manifest does.
        const stagingOf = (key: string) => (parseStore2Key(key) as { stagingId: string }).stagingId
        expect(stagingOf(found.pointer.key)).toBe(stagingOf(result.manifestKey))
    })

    test('reproducer: an exclusion plan lists the unreferenced uuid unit and the fork-format files, and never the upstream files, a unit the main file or a backup references, or a companion', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT), 2: treeWithColdChat(OTHER_UNIT) }, mainByte: 1, backups: { 5: 2 } })
        plantOldFiles(w.store, [`coldstorage/${THIRD_UNIT}`])
        expect((await convertLegacyProfile(w.request, accept)).status).toBe('installed')
        const found = await snapshotOf(w.memory)
        expect(found?.body.kind).toBe('exclusion')
        expect(found?.body.keys).toEqual([
            `coldstorage/${THIRD_UNIT}`, 'database/database.pre-blocks.1', 'blocks/000000000001-aaaaaaaa/f/config', 'blocks/000000000001-aaaaaaaa/root', 'blocks/head',
        ])
        expect(found?.body.upstream).toEqual({ main: true, backups: [backupKey(5)] })
        // The old files themselves are untouched.
        expect(w.store.deletes).toEqual([])
        expect(w.store.writes).toEqual([])
    })

    test('reproducer: an old file that did not decode leaves the cold units out (fork-format-only)', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT), 2: 'bad' }, mainByte: 1, backups: { 5: 2 } })
        plantOldFiles(w.store)
        expect((await convertLegacyProfile(w.request, accept)).status).toBe('installed')
        const found = await snapshotOf(w.memory)
        expect(found?.body.kind).toBe('fork-format-only')
        expect(found?.body.keys.some(key => key.startsWith('coldstorage/'))).toBe(false)
        expect(found?.body.keys).toContain('blocks/head')
    })

    test('guard: a profile without a blocks/ key installs without a snapshot', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        w.store.files.set(`coldstorage/${OTHER_UNIT}`, new Uint8Array([1]))
        const result = await convertLegacyProfile(w.request, accept)
        expect(result.status).toBe('installed')
        expect((await parsedCommit(w.memory)).snapshot).toBeUndefined()
    })

    test('guard: a listing that fails does not stop the install; it goes on without a snapshot', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        plantOldFiles(w.store)
        w.store.list = async () => { throw new Error('list refused') }
        const result = await convertLegacyProfile(w.request, accept)
        expect(result.status).toBe('installed')
        expect((await parsedCommit(w.memory)).snapshot).toBeUndefined()
    })

    test('reproducer: a snapshot unit whose flush is not confirmed stops the install before the manifest and the final write', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1, unflushedSnapshot: true })
        plantOldFiles(w.store)
        const result = await convertLegacyProfile(w.request, accept)
        expect(result).toMatchObject({ status: 'blocked', reason: 'install-upload-failed' })
        const key = await parsedCommit(w.memory)
        expect(key.current).toBeNull()
        expect(key.staging).not.toBeNull()
        expect(key.snapshot).toBeUndefined()
        const manifests = w.order.filter(stored => parseStore2Key(stored)?.shape === 'staged-manifest')
        expect(manifests).toEqual([])
    })

    test('guard: the snapshot unit survives a collection pass (the mark keeps the pointed unit)', async () => {
        const w = await rig({ trees: { 1: treeWithColdChat(CHAT_UNIT) }, mainByte: 1 })
        plantOldFiles(w.store)
        expect((await convertLegacyProfile(w.request, accept)).status).toBe('installed')
        const found = await snapshotOf(w.memory)
        expect(found).not.toBeNull()
        const pass = await gcPass({ backend: w.memory, kind: 'indexeddb', idleReason: () => null })
        expect(pass.status).toBe('done')
        expect((await w.memory.readUnits([found?.pointer.key as string])).get(found?.pointer.key as string)).not.toBeNull()
    })
})

describe('a seed writes the snapshot from what the store holds', () => {
    async function seedOver(files: string[], oldFiles: boolean) {
        const store = createMemoryByteStore()
        for (const key of files) {
            store.files.set(key, new Uint8Array([1]))
        }
        const memory = createMemoryBackend()
        const grant = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'seed' }, commitRead: await memory.readCommit(), startupClear: null })
        if (grant.status !== 'granted') {
            throw new Error('No grant.')
        }
        const entry: SeedEntry = { kind: 'first-life', grant: grant.grant }
        const outcome = await seedStore2Profile(memory, entry, {
            owner, lists: fakeLists, env: testEnv(createClock(), 4711),
            oldData: oldFiles ? { store, listBackupTimes: async () => [] } : undefined,
        })
        return { store, memory, outcome }
    }

    test('reproducer: a fork-only profile (no main file, no backup) lists every cold unit but the companion', async () => {
        const { memory, outcome } = await seedOver(['blocks/head', 'blocks/000000000001-aaaaaaaa/root', `coldstorage/${CHAT_UNIT}`, `coldstorage/${CHAT_UNIT}_accessMeta`], true)
        expect(outcome.status).toBe('installed')
        const found = await snapshotOf(memory)
        expect(found?.body).toMatchObject({ kind: 'fork-only', upstream: { main: false, backups: [] } })
        expect(found?.body.keys).toEqual([`coldstorage/${CHAT_UNIT}`, 'blocks/000000000001-aaaaaaaa/root', 'blocks/head'])
    })

    test('reproducer (Gate 1 F1): a seed over a profile that holds database.bin lists no cold unit, whatever the entry', async () => {
        const { memory, outcome } = await seedOver([MAIN, 'blocks/head', `coldstorage/${CHAT_UNIT}`], true)
        expect(outcome.status).toBe('installed')
        const found = await snapshotOf(memory)
        expect(found?.body.kind).toBe('fork-format-only')
        expect(found?.body.keys).toEqual(['blocks/head'])
    })

    test('guard: a seed given no store to look at writes no snapshot', async () => {
        const { memory, outcome } = await seedOver(['blocks/head'], false)
        expect(outcome.status).toBe('installed')
        expect((await parsedCommit(memory)).snapshot).toBeUndefined()
    })

    test('reproducer (Gate 1 F1, recovery fresh start): the fenced exit entry plans from the store too, and a profile with database.bin gets no cold unit', async () => {
        const store = createMemoryByteStore()
        for (const key of [MAIN, 'blocks/head', `coldstorage/${CHAT_UNIT}`]) {
            store.files.set(key, new Uint8Array([1]))
        }
        const memory = createMemoryBackend()
        const clock = fixtureClock()
        await seedStore(memory, fixtureEnv(clock, 3))
        const outcome = await seedStore2Profile(memory, { kind: 'exit', commitRead: await memory.readCommit() }, {
            owner, lists: fakeLists, env: fixtureEnv(clock, 4), oldData: { store, listBackupTimes: async () => [] },
        })
        expect(outcome.status).toBe('installed')
        const found = await snapshotOf(memory)
        expect(found?.body.kind).toBe('fork-format-only')
        expect(found?.body.keys.some(key => key.startsWith('coldstorage/'))).toBe(false)
        expect(found?.key.staging).toBeNull()
    })
})

describe('the installer sets the pointer it was given', () => {
    test('reproducer: a new install\'s pointer replaces the pointer the recovery marker carried, and it names the new unit', async () => {
        const memory = createMemoryBackend()
        const clock = fixtureClock()
        const env = fixtureEnv(clock, 7)
        await seedStore(memory, env)
        const old: SnapshotPointer = { key: 'store2/g-abcdefghijklmnop-u0123456789abcdef', digest: '0123456789abcdef0123456789abcdef', count: 3 }
        await peerWrite(memory, env, { snapshot: old })
        const exit = await runExit(memory, await memory.readCommit(), { kind: 'import' }, { owner, env: fixtureEnv(clock, 8) })
        expect(exit.status).toBe('marked')
        if (exit.status !== 'marked') {
            return
        }
        expect((await parsedCommit(memory)).snapshot).toEqual(old)
        const plan = planOldDataDeletion(
            { mainFile: false, backups: [], listing: { blocks: ['blocks/head'], database: [], coldstorage: [] } }, null, () => null,
        )
        const result = await installBuilt(
            { backend: memory, env: fixtureEnv(clock, 9), marked: exit },
            { ...withSnapshot({ ...treeRequest(1, { tag: 'import' }), convertedFrom: 'seed' }, plan) },
        )
        expect(result.status).toBe('installed')
        const found = await snapshotOf(memory)
        expect(found?.pointer.key).not.toBe(old.key)
        expect(found?.body.keys).toEqual(['blocks/head'])
    })

    test('guard: an install built without a snapshot keeps carrying the pointer of the marker it stands on', async () => {
        const memory = createMemoryBackend()
        const clock = fixtureClock()
        const env = fixtureEnv(clock, 17)
        await seedStore(memory, env)
        const old: SnapshotPointer = { key: 'store2/g-abcdefghijklmnop-u0123456789abcdef', digest: '0123456789abcdef0123456789abcdef', count: 3 }
        await peerWrite(memory, env, { snapshot: old })
        const exit = await runExit(memory, await memory.readCommit(), { kind: 'import' }, { owner, env: fixtureEnv(clock, 18) })
        if (exit.status !== 'marked') {
            throw new Error('No marker.')
        }
        const result = await installBuilt({ backend: memory, env: fixtureEnv(clock, 19), marked: exit }, { ...withSnapshot({ ...treeRequest(1, { tag: 'import' }), convertedFrom: 'seed' }, null) })
        expect(result.status).toBe('installed')
        expect((await parsedCommit(memory)).snapshot).toEqual(old)
        expect(classifyCommitRead(await memory.readCommit()).status).toBe('parsed')
    })
})

describe('the callers hand the planner the page\'s store', () => {
    const DAMAGED_COMMIT = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63])

    beforeEach(() => {
        resetStore2SaveForTest()
        resetStore2BootForTest()
        resetPageBlockOwnerForTests()
        resetPageStorageModeForTests()
    })

    afterEach(() => {
        resetStore2SaveForTest()
        resetStore2BootForTest()
        resetPageBlockOwnerForTests()
        resetPageStorageModeForTests()
    })

    function ui(recovery: Store2BootUi['recovery'] = async () => { }): Store2BootUi {
        return {
            notice: () => { },
            blocked: async () => { },
            offerRestoreOrImport: async () => { },
            confirmConvert: async () => false,
            declined: async () => 'import',
            confirmConvertWithout: async () => 'decline',
            confirmFromBackup: async () => 'decline',
            confirmIncomplete: async () => false,
            confirmFlaggedOpen: async () => 'decline',
            foreignMarker: async () => 'wait',
            recovery,
            peer: createPeerDouble(),
        }
    }

    test('reproducer: the boot dispatch seeds a fork-only store with a snapshot taken from the page\'s own store', async () => {
        const store = createMemoryByteStore()
        for (const key of ['blocks/head', `coldstorage/${CHAT_UNIT}`]) {
            store.files.set(key, new Uint8Array([1]))
        }
        const memory = createMemoryBackend()
        const result = await dispatchStore2Boot(
            { store, upstreamMainFile: async () => false, listBackupTimes: async () => [], readColdStorageItem: async () => ({ status: 'missing' }) },
            { ui: ui(), kind: 'indexeddb', backend: async () => memory, keyEnv: testEnv(createClock(), 9001), lists: fakeLists },
        )
        expect(result.kind).toBe('store2')
        const found = await snapshotOf(memory)
        expect(found?.body).toMatchObject({ kind: 'fork-only', keys: [`coldstorage/${CHAT_UNIT}`, 'blocks/head'] })
    })

    test('reproducer (Gate 1 F1): the recovery screen\'s fresh start over a profile that holds database.bin writes a snapshot with no cold unit', async () => {
        const store = createMemoryByteStore()
        for (const key of [MAIN, 'blocks/head', `coldstorage/${CHAT_UNIT}`]) {
            store.files.set(key, new Uint8Array([1]))
        }
        const memory = createMemoryBackend()
        memory.poke(COMMIT_KEY, DAMAGED_COMMIT)
        const requests: Store2RecoveryRequest[] = []
        await dispatchStore2Boot(
            { store, upstreamMainFile: async () => true, listBackupTimes: async () => [], readColdStorageItem: async () => ({ status: 'missing' }) },
            { ui: ui(async (request) => { requests.push(request) }), kind: 'indexeddb', backend: async () => memory, keyEnv: testEnv(createClock(), 9002), lists: fakeLists },
        )
        expect(requests).toHaveLength(1)

        let pending: { model: BootScreenModel, resolve: (key: string) => void } | null = null
        let reloads = 0
        const port: RecoveryPort = {
            ask: (model) => new Promise<string>((resolve) => { pending = { model, resolve } }),
            show: () => { pending = null },
            terminal: () => { pending = null },
            reload: () => { reloads += 1 },
        }
        const press = async (key: string) => {
            await vi.waitFor(() => {
                const held = pending as { model: BootScreenModel } | null
                expect(held !== null && held.model.buttons.some((button) => button.key === key), `a screen with ${key}`).toBe(true)
            }, { timeout: 5000, interval: 2 })
            const held = pending as { resolve: (key: string) => void } | null
            pending = null
            held?.resolve(key)
        }
        const calls: RecoveryCalls = {
            listCandidates: listRecoveryCandidates,
            pick: pickCandidate,
            install: installPick,
            convert: convertLegacyProfile,
            convertWithout: convertLegacyWithout,
            seed: seedStore2Profile,
        }
        void runRecovery(requests[0], port, calls)
        await press('recoveryFreshOffer')
        await press('recoveryFreshGo')
        await vi.waitFor(() => expect(reloads).toBe(1), { timeout: 5000, interval: 2 })
        const found = await snapshotOf(memory)
        expect(found?.body.kind).toBe('fork-format-only')
        expect(found?.body.keys).toEqual(['blocks/head'])
    })
})
