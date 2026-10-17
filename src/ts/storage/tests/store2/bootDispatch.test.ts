// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// The dispatch reaches the page store selection only through the legacy block owner it disables; the selection drags in
// the app's boot chain, which a protocol test must not load.
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => { throw new Error('The page store is not selected in this test.') },
    getAppStoreKind: async () => { throw new Error('The page store is not selected in this test.') },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { crc32 } from 'src/ts/storage/blockFrame'
import type { Database } from 'src/ts/storage/database.svelte'
import { getPageBlockOwner, resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { getPageStorageMode, resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { GuardedOperations } from 'src/ts/storage/store/contract'
import {
    createMemoryBackend, Store2BackendFailureError, Store2UnknownOutcomeError,
    type MemoryBackend, type Store2Backend, type Store2WriteResult,
} from 'src/ts/storage/store2/backend'
import { getStore2BootSession, resetStore2BootForTest, type Store2BootNotice, type Store2BootResult } from 'src/ts/storage/store2/bootActive'
import { dispatchStore2Boot, type Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import { assembleDatabase, encodeScoped, unitMapSource, type EncodedTree, type ListDerivation } from 'src/ts/storage/store2/codec'
import { firstCommitKey, nextCommitKey, classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import {
    encodeUnit, FRAME_HEADER_BYTES, keyOfRef, newManifestKey, newStagingId, stagingPrefix, UNIT_TYPE,
    type KeyEnv, type Manifest, type Ref, type ShardEntry, type StagingLabel,
} from 'src/ts/storage/store2/format'
import { COMMIT_KEY, FENCE_KEY } from 'src/ts/storage/store2/format/keys'
import { freshOwnerId, isOwnerId, type Staging } from 'src/ts/storage/store2/owner'
import { OWNER_KEY } from 'src/ts/storage/store2/ownerStore'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { getActiveStore2Save, resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import type { Store2Session } from 'src/ts/storage/store2/session'
import { createClock, createPeerDouble, seedTree, testEnv, type PeerDouble } from '../store2SaveKit'
import { buildSmall, chat, fakeLists, message, mulberry32, prosePool, type Obj } from './codecFixtures'

/**
 * The store2 boot dispatch (`store2/bootDispatch.ts`), one test per row of the boot table: the action, exactly what it
 * writes (nothing, except where a row says otherwise) and what it shows. The backend is the memory backend behind a
 * logging wrapper; the page store is a recording byte store that holds the legacy files (the main file and a numbered
 * backup set of 21, so a listing that prunes has something to delete). Labels: new behaviour.
 */

// ---- the tree ----

interface World {
    memory: MemoryBackend
    db: Database
    tree: EncodedTree
    manifestKey: string
    env: KeyEnv
}

function richProfile(): Database {
    const db = buildSmall(3) as unknown as Obj
    const rng = mulberry32(77)
    const pool = prosePool(rng, 20, 100, 400)
    const long = chat(rng, 2, Array.from({ length: 4 }, (_, i) => message(rng, pool, i, 90_000)))
    long.scriptstate = { visits: 3 }
    const inlay = chat(rng, 3, [{ role: 'char', data: 'see {{inlay::0123abcd-0123-4123-a123-0123456789ab}}', time: 1 }])
    const first = (db.characters as Obj[])[0]
    first.chats = [...(first.chats as Obj[]), long, inlay]
    return db as unknown as Database
}

async function seedWorld(db: Database = buildSmall(2)): Promise<World> {
    const memory = createMemoryBackend()
    const env = testEnv(createClock(), 4242)
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(db)) as Database, env, fakeLists)
    return { memory, db, tree: seeded.tree, manifestKey: seeded.manifestKey, env }
}

function stored(world: World, key: string): Uint8Array {
    const bytes = world.memory.snapshot().get(key)
    if (bytes === undefined) {
        throw new Error(`No unit ${key} in the store.`)
    }
    return bytes
}

function entryBody(world: World): ShardEntry[] {
    return world.tree.manifest.shards.flatMap(ref => {
        const unit = world.tree.units.find(candidate => candidate.key === keyOfRef(ref))
        if (unit === undefined) {
            throw new Error('A shard is not in the encoded tree.')
        }
        const payload = unit.bytes.subarray(FRAME_HEADER_BYTES, unit.bytes.length - 4)
        return (JSON.parse(new TextDecoder().decode(payload)) as { entries: ShardEntry[] }).entries
    })
}

/** One unit of every leaf kind of the first character (of a rich profile). */
function leafKeys(world: World): [label: string, key: string][] {
    const chaId = String((world.db as unknown as { characters: Obj[] }).characters[0].chaId)
    const entry = entryBody(world).find(candidate => candidate.chaId === chaId) as ShardEntry
    const long = entry.chats[2]
    return [
        ['character core', keyOfRef(entry.core)],
        ['lore', keyOfRef(entry.lore as Ref)],
        ['scripts', keyOfRef(entry.scripts as Ref)],
        ['character asset list', keyOfRef(entry.al)],
        ['character inlay list', keyOfRef(entry.il as Ref)],
        ['chat core', keyOfRef(entry.chats[0].core)],
        ['non-tail chunk', keyOfRef(long.chunks[0])],
        ['tail chunk', keyOfRef(long.chunks[long.chunks.length - 1])],
    ]
}

function flipPayload(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes)
    out[FRAME_HEADER_BYTES + 1] ^= 0xff
    return out
}

function tooNewFrame(bytes: Uint8Array): Uint8Array {
    const out = new Uint8Array(bytes)
    out[4] = 9
    new DataView(out.buffer, out.byteOffset + 12, 4).setUint32(0, crc32(out.subarray(0, 12)), true)
    return out
}

// ---- the rig ----

interface UiDouble extends Store2BootUi {
    notices: Store2BootNotice[]
    blockedWith: { reason: string, detail: string }[]
    offered: (readonly number[])[]
    recoveries: { decision: Parameters<Store2BootUi['recovery']>[0]['decision'], session: Store2Session }[]
    foreignAsked: Staging[]
    foreignAnswer: 'wait' | 'clear'
    /** The flagged-open prompts asked, each with whether the save context was already active when it was asked. */
    flaggedAsked: { items: readonly FlaggedItem[], activeAtPrompt: boolean }[]
    flaggedAnswer: 'continue' | 'decline' | 'earlier' | 'never'
    peer: PeerDouble
}

function uiDouble(): UiDouble {
    const ui: UiDouble = {
        notices: [],
        blockedWith: [],
        offered: [],
        recoveries: [],
        foreignAsked: [],
        foreignAnswer: 'wait',
        flaggedAsked: [],
        flaggedAnswer: 'continue',
        peer: createPeerDouble(),
        notice(notice) { ui.notices.push(notice) },
        async blocked(blocked) { ui.blockedWith.push(blocked) },
        async offerRestoreOrImport(backups) { ui.offered.push(backups) },
        async confirmFlaggedOpen(items) {
            ui.flaggedAsked.push({ items, activeAtPrompt: getActiveStore2Save() !== null })
            if (ui.flaggedAnswer === 'never') {
                return new Promise<never>(() => { })
            }
            return ui.flaggedAnswer
        },
        async foreignMarker(marker) {
            ui.foreignAsked.push(marker)
            return ui.foreignAnswer
        },
        async recovery(request) { ui.recoveries.push(request) },
    }
    return ui
}

interface BackendHooks {
    beforeReadUnits?: (call: number, keys: readonly string[]) => void | Promise<void>
    afterReadUnits?: (call: number, keys: readonly string[]) => void | Promise<void>
    beforeCasCommit?: (call: number) => void | Promise<void>
    beforeReadCommit?: (call: number) => void | Promise<void>
    afterListStore2?: (call: number) => void | Promise<void>
    /** Every write result carries `flushed: true`, as a Tauri backend that confirms its flushes does. */
    flushed?: boolean
    failCountAndList?: boolean
}

interface Logged {
    backend: Store2Backend
    /** Every write call the page made, in order. */
    writes: string[]
    calls: { readUnits: number, readCommit: number, casCommit: number, listStore2: number }
}

function logged(memory: MemoryBackend, hooks: BackendHooks = {}): Logged {
    const writes: string[] = []
    const calls = { readUnits: 0, readCommit: 0, casCommit: 0, listStore2: 0 }
    const confirm = (result: Store2WriteResult): Store2WriteResult => hooks.flushed === true ? { flushed: true } : result
    const backend: Store2Backend = {
        ...memory,
        async readUnits(keys) {
            calls.readUnits += 1
            await hooks.beforeReadUnits?.(calls.readUnits, keys)
            const out = await memory.readUnits(keys)
            await hooks.afterReadUnits?.(calls.readUnits, keys)
            return out
        },
        async readCommit() {
            calls.readCommit += 1
            await hooks.beforeReadCommit?.(calls.readCommit)
            return memory.readCommit()
        },
        async countPrefix(prefix) {
            if (hooks.failCountAndList === true) {
                throw new Store2BackendFailureError('the count failed')
            }
            return memory.countPrefix(prefix)
        },
        async listStore2() {
            if (hooks.failCountAndList === true) {
                throw new Store2BackendFailureError('the listing failed')
            }
            calls.listStore2 += 1
            const out = await memory.listStore2()
            await hooks.afterListStore2?.(calls.listStore2)
            return out
        },
        async casCommit(expected, next) {
            calls.casCommit += 1
            await hooks.beforeCasCommit?.(calls.casCommit)
            writes.push('casCommit')
            return confirm(await memory.casCommit(expected, next))
        },
        async casFence(expected, next) {
            writes.push('casFence')
            return confirm(await memory.casFence(expected, next))
        },
        async commitOrdinary(expected, units, next) {
            writes.push('commitOrdinary')
            return confirm(await memory.commitOrdinary(expected, units, next))
        },
        async putUnit(key, bytes) {
            writes.push(`putUnit ${key}`)
            return confirm(await memory.putUnit(key, bytes))
        },
        async removeBatch(keys, expectedCommit, expectedFence) {
            writes.push('removeBatch')
            return confirm(await memory.removeBatch(keys, expectedCommit, expectedFence))
        },
    }
    return { backend, writes, calls }
}

const BACKUP_TIMES = Array.from({ length: 21 }, (_, i) => 1_700_000_000_000 + i * 1000)

interface Rig {
    memory: MemoryBackend
    store: MemoryByteStore
    ui: UiDouble
    logs: Logged[]
    /** Sessions the dispatch opened (one backend per round). */
    rounds(): number
    dispatch(): Promise<Store2BootResult>
    /** Every write the page made to the backend or the page store, the owner id excepted. */
    allWrites(): string[]
}

interface RigOptions {
    kind?: AppStoreKind
    memory?: MemoryBackend
    /** Whether the upstream main file exists; a function lets a test make the check fail. */
    mainFile?: boolean | (() => Promise<boolean>)
    backups?: readonly number[] | 'unlistable'
    hooks?: BackendHooks | ((round: number) => BackendHooks)
    lists?: ListDerivation
    maxRounds?: number
    keyEnv?: KeyEnv
}

function rig(options: RigOptions = {}): Rig {
    const memory = options.memory ?? createMemoryBackend()
    const store = createMemoryByteStore()
    const backups = options.backups ?? BACKUP_TIMES
    if (backups !== 'unlistable') {
        for (const time of backups) {
            store.files.set(`database/dbbackup-${time}.bin`, new Uint8Array([1]))
        }
    }
    const mainFile = options.mainFile ?? false
    if (mainFile === true) {
        store.files.set('database/database.bin', new Uint8Array([1, 2, 3]))
    }
    const ui = uiDouble()
    const logs: Logged[] = []
    const dispatch = () => dispatchStore2Boot({
        store,
        upstreamMainFile: typeof mainFile === 'function' ? mainFile : async () => mainFile,
        listBackupTimes: async () => {
            if (backups === 'unlistable') {
                throw new Error('the backup listing failed')
            }
            const times: number[] = []
            for (const key of await store.list('database/dbbackup-')) {
                times.push(Number(/dbbackup-(\d+)\.bin$/.exec(key)?.[1]))
            }
            return times.sort((a, b) => b - a)
        },
    }, {
        ui,
        kind: options.kind ?? 'indexeddb',
        backend: async () => {
            const hooks = typeof options.hooks === 'function' ? options.hooks(logs.length + 1) : options.hooks
            const entry = logged(memory, hooks)
            logs.push(entry)
            return entry.backend
        },
        keyEnv: options.keyEnv ?? testEnv(createClock(), 9001),
        lists: options.lists ?? fakeLists,
        maxRounds: options.maxRounds,
    })
    return {
        memory,
        store,
        ui,
        logs,
        rounds: () => logs.length,
        dispatch,
        allWrites: () => [
            ...logs.flatMap(entry => entry.writes),
            ...store.writes.filter(key => key !== OWNER_KEY).map(key => `store write ${key}`),
            ...store.deletes.map(key => `store delete ${key}`),
        ],
    }
}

async function putCommitKey(memory: MemoryBackend, bytes: Uint8Array | null): Promise<void> {
    memory.poke(COMMIT_KEY, bytes)
}

function stagingOf(label: StagingLabel, owner: string): Staging {
    return { owner, prefix: stagingPrefix(newStagingId(testEnv(createClock(), 5))), startedAt: 1_700_000_000_000, label }
}

async function markerKey(label: StagingLabel, owner: string): Promise<Uint8Array> {
    return encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: stagingOf(label, owner) }, testEnv(createClock(), 6)))
}

async function currentKey(memory: MemoryBackend) {
    const read = classifyCommitRead(await memory.readCommit())
    if (read.status !== 'parsed') {
        throw new Error(`The commit key is ${read.status}.`)
    }
    return read.value
}

function expectStoreResult(result: Store2BootResult): Extract<Store2BootResult, { kind: 'store2' }> {
    expect(result.kind).toBe('store2')
    if (result.kind !== 'store2') {
        throw new Error(`The dispatch answered ${result.kind}.`)
    }
    return result
}

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

// ---- row 5: a normal store2 profile ----

describe('new behaviour: row 5, a normal store2 profile', () => {
    test('it opens: the database is the assembly of the stored tree, the save context holds the newest session, the mode is store2', async () => {
        const world = await seedWorld()
        const test = rig({ memory: world.memory })
        const result = expectStoreResult(await test.dispatch())

        const stored = world.memory.snapshot()
        expect(result.database).toEqual(assembleDatabase(world.tree.manifest, { get: key => stored.get(key) }))
        const active = getActiveStore2Save()
        expect(active).not.toBeNull()
        expect(active?.session).toBe(result.session)
        expect(active?.peer).toBe(test.ui.peer)
        expect(active?.lists).toBe(fakeLists)
        expect(active?.previous.units.size).toBeGreaterThan(0)
        expect(getStore2BootSession()).toBe(result.session)
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        expect(test.rounds()).toBe(1)
    })

    test('it writes nothing: no backend write, no store write, no store delete (21 numbered backups stand)', async () => {
        const world = await seedWorld()
        const test = rig({ memory: world.memory })
        const before = world.memory.snapshot()
        expectStoreResult(await test.dispatch())
        expect(test.allWrites()).toEqual([])
        expect(test.store.writes).toEqual([])
        expect(test.store.deletes).toEqual([])
        expect([...world.memory.snapshot().keys()]).toEqual([...before.keys()])
        expect(test.store.lists).toEqual([])
    })

    test('the first save over the opened database changes nothing: every unit the boot read is unchanged', async () => {
        const world = await seedWorld()
        const test = rig({ memory: world.memory })
        const result = expectStoreResult(await test.dispatch())
        const active = getActiveStore2Save()
        if (active === null) {
            throw new Error('No save context.')
        }
        const encoder = createSaveEncoder({ previous: active.previous, lists: fakeLists, env: testEnv(createClock(), 321) })
        const plan = await encoder.plan(result.database, { marked: new Set(), modules: true, whole: true })
        expect(plan.unchanged).toBe(true)
    })

    test('the legacy block owner is disabled for the page: no later caller can build one', async () => {
        const world = await seedWorld()
        expectStoreResult(await rig({ memory: world.memory }).dispatch())
        expect(await getPageBlockOwner()).toBeNull()
    })

    test('a standing fence that parses is carried without a notice', async () => {
        const world = await seedWorld()
        world.memory.poke(FENCE_KEY, encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [] }))
        const test = rig({ memory: world.memory })
        const result = expectStoreResult(await test.dispatch())
        expect(result.notices).toEqual([])
        expect(test.ui.notices).toEqual([])
    })

    test('a fence that cannot be understood opens the profile and tells the user that clean-up is blocked', async () => {
        const world = await seedWorld()
        world.memory.poke(FENCE_KEY, new Uint8Array([9, 9, 9]))
        const test = rig({ memory: world.memory })
        const result = expectStoreResult(await test.dispatch())
        expect(test.ui.notices).toEqual([{ name: 'cleanup-blocked' }])
        expect(result.notices).toEqual([{ name: 'cleanup-blocked' }])
        expect(test.allWrites()).toEqual([])
    })

    test('a Tauri page whose commit key could not be flushed opens and says so', async () => {
        const world = await seedWorld()
        const test = rig({ memory: world.memory, kind: 'tauri', hooks: { flushed: false } })
        // The memory backend reports no flush at all, so the boot re-flush cannot confirm one.
        const result = expectStoreResult(await test.dispatch())
        expect(test.ui.notices.map(notice => notice.name)).toContain('reflush-failed')
        expect(result.session.notice?.reason).toBe('reflush-failed')
    })
})

// ---- row 3: too new ----

describe('new behaviour: row 3, a format this build does not understand', () => {
    test('a too-new commit key stops the boot: read-only mode, the notice, nothing loaded, nothing written', async () => {
        const world = await seedWorld()
        const bytes = tooNewFrame(stored(world, COMMIT_KEY))
        world.memory.poke(COMMIT_KEY, bytes)
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'too-new', source: 'commit-key' })])
        expect(getPageStorageMode()).toEqual({ kind: 'read-only' })
        expect(getActiveStore2Save()).toBeNull()
        expect(test.allWrites()).toEqual([])
        expect(test.ui.recoveries).toEqual([])
    })

    test('a too-new fence stops the boot the same way', async () => {
        const world = await seedWorld()
        world.memory.poke(FENCE_KEY, tooNewFrame(encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: 1, priorCommits: [], keys: [] })))
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'too-new', source: 'fence' })])
        expect(getActiveStore2Save()).toBeNull()
    })

    test('a too-new unit of the tree stops the boot with the tree as its source: never flagged, never the recovery screen', async () => {
        const world = await seedWorld(richProfile())
        const key = leafKeys(world)[0][1]
        world.memory.poke(key, tooNewFrame(stored(world, key)))
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'too-new', source: 'tree' })])
        expect(getPageStorageMode()).toEqual({ kind: 'read-only' })
        expect(test.ui.recoveries).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
        expect(test.allWrites()).toEqual([])
    })
})

// ---- the flagged-leaf confirm gate and the structure route ----

describe('new behaviour: row 5 with a damaged or missing leaf, the confirm gate', () => {
    const KINDS = [0, 1, 2, 3, 4, 5, 6, 7]

    test.each(KINDS)('leaf case %i, continue: the profile opens after the question, the other characters are as stored and nothing is written', async (index) => {
        const world = await seedWorld(richProfile())
        const [label, key] = leafKeys(world)[index]
        world.memory.poke(key, flipPayload(stored(world, key)))
        const test = rig({ memory: world.memory })
        const result = expectStoreResult(await test.dispatch())
        expect(test.ui.flaggedAsked, label).toHaveLength(1)
        expect(test.ui.flaggedAsked[0].items.map(item => item.key)).toEqual([key])
        expect(test.ui.flaggedAsked[0].items[0].name).toBe('Small 0')
        expect(test.ui.flaggedAsked[0].activeAtPrompt, 'the save loop is not active while the question is open').toBe(false)
        expect(getActiveStore2Save()?.session).toBe(result.session)
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        expect(test.ui.recoveries).toEqual([])
        expect(test.ui.blockedWith).toEqual([])
        expect(test.ui.notices).toEqual([])
        expect(test.allWrites()).toEqual([])
        const intact = assembleDatabase(world.tree.manifest, unitMapSource(world.tree.units)) as unknown as { characters: Obj[] }
        const opened = result.database as unknown as { characters: Obj[] }
        expect(opened.characters).toHaveLength(intact.characters.length)
        expect(opened.characters.slice(1)).toEqual(intact.characters.slice(1))
    })

    test('a missing leaf is the same question', async () => {
        const world = await seedWorld(richProfile())
        const key = leafKeys(world)[6][1]
        world.memory.poke(key, null)
        const test = rig({ memory: world.memory })
        expectStoreResult(await test.dispatch())
        expect(test.ui.flaggedAsked.map(asked => asked.items.map(item => [item.key, item.why]))).toEqual([[[key, 'missing']]])
    })

    test('decline: stopped, nothing opened, nothing written, the save loop never active, and the question comes again at the next start', async () => {
        const world = await seedWorld(richProfile())
        const key = leafKeys(world)[2][1]
        world.memory.poke(key, flipPayload(stored(world, key)))
        const test = rig({ memory: world.memory })
        test.ui.flaggedAnswer = 'decline'
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.flaggedAsked).toHaveLength(1)
        expect(getActiveStore2Save()).toBeNull()
        expect(getPageStorageMode()).not.toEqual({ kind: 'store2' })
        expect(test.ui.recoveries).toEqual([])
        expect(test.ui.blockedWith).toEqual([])
        expect(test.allWrites()).toEqual([])
        expect(test.store.writes.filter(written => written !== OWNER_KEY)).toEqual([])
        expect(test.store.deletes).toEqual([])
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.flaggedAsked).toHaveLength(2)
        expect(test.allWrites()).toEqual([])
    })

    test('earlier: the recovery screen gets the current session before anything is written, then the boot stops without opening or activating anything', async () => {
        const world = await seedWorld(richProfile())
        const key = leafKeys(world)[6][1]
        world.memory.poke(key, flipPayload(stored(world, key)))
        const test = rig({ memory: world.memory })
        test.ui.flaggedAnswer = 'earlier'
        let writesAtRecovery = -1
        let activeAtRecovery = true
        test.ui.recovery = async (request) => {
            writesAtRecovery = test.allWrites().length
            activeAtRecovery = getActiveStore2Save() !== null
            test.ui.recoveries.push(request)
        }
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.recoveries).toHaveLength(1)
        const request = test.ui.recoveries[0]
        expect(request.decision).toEqual({ row: 6, mode: 'recovery', tree: 'damaged', keys: [key] })
        expect(request.session, 'the session the tree was read with, not a re-opened one').toBe(getStore2BootSession())
        expect(test.rounds()).toBe(1)
        expect(writesAtRecovery).toBe(0)
        expect(activeAtRecovery).toBe(false)
        expect(getActiveStore2Save()).toBeNull()
        expect(getPageStorageMode()).not.toEqual({ kind: 'store2' })
        expect(test.allWrites()).toEqual([])
    })

    test('earlier over a missing unit names the tree as missing', async () => {
        const world = await seedWorld(richProfile())
        const key = leafKeys(world)[6][1]
        world.memory.poke(key, null)
        const test = rig({ memory: world.memory })
        test.ui.flaggedAnswer = 'earlier'
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.recoveries[0].decision).toEqual({ row: 6, mode: 'recovery', tree: 'missing', keys: [key] })
    })

    test('a question that is never answered leaves the profile closed: with the idle interval long past, nothing is written and the save loop is not active', async () => {
        vi.useFakeTimers()
        try {
            const world = await seedWorld(richProfile())
            const key = leafKeys(world)[0][1]
            world.memory.poke(key, flipPayload(stored(world, key)))
            const test = rig({ memory: world.memory })
            test.ui.flaggedAnswer = 'never'
            void test.dispatch()
            await vi.advanceTimersByTimeAsync(10_000)
            expect(test.ui.flaggedAsked).toHaveLength(1)
            expect(getActiveStore2Save()).toBeNull()
            expect(test.allWrites()).toEqual([])
        } finally {
            vi.useRealTimers()
        }
    })

    test('after continue the first save rewrites the flagged chunk of the long chat and nothing outside that chat, and the stored tree still names the damaged key', async () => {
        const world = await seedWorld(richProfile())
        const [, key] = leafKeys(world)[6]
        world.memory.poke(key, flipPayload(stored(world, key)))
        const test = rig({ memory: world.memory })
        const result = expectStoreResult(await test.dispatch())
        const active = getActiveStore2Save()
        if (active === null) {
            throw new Error('No save context.')
        }
        const chaIds = (result.database as unknown as { characters: Obj[] }).characters.map(one => String(one.chaId))
        const next = await encodeScoped(result.database, {
            env: testEnv(createClock(), 777), lists: fakeLists, seq: 2, createdAt: 1_700_000_000_000, previous: active.previous,
        }, { modules: false, characters: new Set(chaIds) })
        const first = entryBody(world).find(entry => entry.chaId === chaIds[0]) as ShardEntry
        const prefix = `chat:${first.u}:${first.chats[2].cid}:`
        const storedKeys = new Set(world.tree.units.map(unit => unit.key))
        const rewritten = next.units.filter(unit => !storedKeys.has(unit.key)).map(unit => unit.identity)
        const chunks = rewritten.filter(identity => identity.startsWith(`${prefix}chunk:`))
        // The chunk holding the load-error message is rewritten; how many follow it depends on how the messages re-pack.
        expect(chunks.length).toBeGreaterThan(0)
        expect(chunks.length).toBeLessThanOrEqual(first.chats[2].chunks.length)
        expect(next.units.map(unit => unit.key)).not.toContain(key)
        expect(rewritten.filter(identity => identity.startsWith('chat:') && !identity.startsWith(prefix))).toEqual([])
        expect(rewritten.filter(identity => identity.startsWith('char:') || identity.startsWith('al:') || identity.startsWith('il:'))).toEqual([])
    })
})

describe('new behaviour: a tree with a leaf that fails the unit check is not a recovery, a backend failure is not a flag', () => {
    test('a too-new leaf and a damaged leaf in one read: the too-new unit wins and the question is never asked', async () => {
        const world = await seedWorld(richProfile())
        const keys = leafKeys(world)
        world.memory.poke(keys[0][1], tooNewFrame(stored(world, keys[0][1])))
        world.memory.poke(keys[6][1], flipPayload(stored(world, keys[6][1])))
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'too-new', source: 'tree' })])
        expect(test.ui.flaggedAsked).toEqual([])
    })
})
describe('new behaviour: the re-read of the commit key before a finding is acted on', () => {
    test('a structure failure goes to the recovery screen only after the commit key is read again unchanged', async () => {
        const world = await seedWorld()
        const key = keyOfRef(world.tree.manifest.fixed.order)
        world.memory.poke(key, flipPayload(stored(world, key)))
        let readsAtRecovery = -1
        const test = rig({ memory: world.memory })
        test.ui.recovery = async (request) => {
            readsAtRecovery = test.logs[0].calls.readCommit
            test.ui.recoveries.push(request)
        }
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.recoveries).toHaveLength(1)
        const request = test.ui.recoveries[0]
        expect(request.decision).toMatchObject({ row: 6, mode: 'recovery', tree: 'damaged', keys: [key] })
        expect(request.session).toBe(getStore2BootSession())
        // The session read the commit key once to classify, and treeBytes read it again before the recovery screen.
        expect(readsAtRecovery).toBeGreaterThanOrEqual(2)
        expect(test.allWrites()).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
    })

    test('a missing fixed unit is a recovery request for a missing tree', async () => {
        const world = await seedWorld()
        const key = keyOfRef(world.tree.manifest.fixed.loadouts)
        world.memory.poke(key, null)
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.recoveries[0].decision).toMatchObject({ row: 6, tree: 'missing', keys: [key] })
    })

    test('a backend failure while the leaves are read is a block, never a flag and never an absent unit', async () => {
        const world = await seedWorld(richProfile())
        const leaf = leafKeys(world)[0][1]
        const test = rig({
            memory: world.memory,
            hooks: { beforeReadUnits: (_call, keys) => { if (keys.includes(leaf)) { throw new Store2BackendFailureError('the disk went away') } } },
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([{ reason: 'tree-unreadable', detail: 'the disk went away' }])
        expect(test.ui.notices).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
        expect(test.allWrites()).toEqual([])
    })

    test('a commit key that moved after the reads is classified again, not acted on: the new state is what is shown', async () => {
        const world = await seedWorld(richProfile())
        const leaf = leafKeys(world)[0][1]
        world.memory.poke(leaf, null)
        let moved = false
        const test = rig({
            memory: world.memory,
            hooks: round => round === 1
                ? { afterReadUnits: async (_call, keys) => {
                    if (!moved && keys.includes(leaf)) {
                        moved = true
                        const key = await currentKey(world.memory)
                        world.memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, nextCommitKey(key, { current: null })))
                    }
                } }
                : {},
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.rounds()).toBe(2)
        // The second round finds a commit key with no current manifest and no marker: row 7.
        expect(test.ui.recoveries.map(request => request.decision.row)).toEqual([7])
        expect(test.ui.notices).toEqual([])
        expect(test.allWrites()).toEqual([])
    })

    test('a commit key that cannot be read again is a named block: never moved, never damage, never the recovery screen', async () => {
        const world = await seedWorld(richProfile())
        const leaf = leafKeys(world)[0][1]
        world.memory.poke(leaf, null)
        let armed = false
        const test = rig({
            memory: world.memory,
            hooks: {
                afterReadUnits: (_call, keys) => { if (keys.includes(leaf)) { armed = true } },
                beforeReadCommit: () => { if (armed) { throw new Store2BackendFailureError('the commit key is unreadable') } },
            },
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'commit-key-unreadable' })])
        expect(test.ui.recoveries).toEqual([])
        expect(test.ui.notices).toEqual([])
        expect(test.rounds()).toBe(1)
        expect(test.allWrites()).toEqual([])
    })

    /** An order unit that names an entity no shard lists: every unit passes its own check, the tree does not assemble. */
    function makeUnassemblable(world: World): void {
        const orderKey = keyOfRef(world.tree.manifest.fixed.order)
        const orderUnit = world.tree.units.find(unit => unit.key === orderKey)
        if (orderUnit === undefined) {
            throw new Error('No order unit.')
        }
        const payload = JSON.parse(new TextDecoder().decode(orderUnit.bytes.subarray(FRAME_HEADER_BYTES, orderUnit.bytes.length - 4))) as { chars: string[] }
        payload.chars = [...payload.chars, 'an-entity-no-shard-lists']
        const rewritten = encodeUnit(UNIT_TYPE.order, payload)
        const manifest: Manifest = structuredClone(world.tree.manifest)
        manifest.fixed.order = [manifest.fixed.order[0], rewritten.length, new DataView(rewritten.buffer, rewritten.byteOffset + rewritten.length - 4, 4).getUint32(0, true)]
        world.memory.poke(orderKey, rewritten)
        world.memory.poke(world.manifestKey, encodeUnit(UNIT_TYPE.manifest, manifest))
    }

    test('an unflagged corruption found only by assembly is a block, not an error that reaches the generic catch', async () => {
        const world = await seedWorld()
        makeUnassemblable(world)
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'assemble-failed' })])
        expect(getActiveStore2Save()).toBeNull()
        expect(test.allWrites()).toEqual([])
    })

    test('the same with a flagged leaf, so the fallback assembles: still a block, the question is never asked and the loop never starts', async () => {
        const world = await seedWorld(richProfile())
        const leaf = leafKeys(world)[6][1]
        world.memory.poke(leaf, flipPayload(stored(world, leaf)))
        makeUnassemblable(world)
        const test = rig({ memory: world.memory })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'assemble-failed' })])
        expect(test.ui.flaggedAsked).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
        expect(test.allWrites()).toEqual([])
    })
})

// ---- rows 2, 4, 6, 7, 8, 10, 11: the recovery screen ----

describe('new behaviour: the recovery rows hand the whole current session to the recovery screen and write nothing', () => {
    const OWNER = freshOwnerId(testEnv(createClock(), 31))

    const cases: [string, number, () => Promise<{ memory: MemoryBackend, mainFile?: boolean }>][] = [
        ['row 2: units but no commit key', 2, async () => {
            const world = await seedWorld()
            await putCommitKey(world.memory, null)
            return { memory: world.memory }
        }],
        ['row 4: a commit key that is damaged', 4, async () => {
            const world = await seedWorld()
            await putCommitKey(world.memory, flipPayload(stored(world, COMMIT_KEY)))
            return { memory: world.memory }
        }],
        ['row 6: the current manifest is gone', 6, async () => {
            const world = await seedWorld()
            world.memory.poke(world.manifestKey, null)
            return { memory: world.memory }
        }],
        ['row 7: a commit key with no current manifest and no marker', 7, async () => {
            const memory = createMemoryBackend()
            await putCommitKey(memory, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: null })))
            return { memory }
        }],
        ['row 8: a recovery marker', 8, async () => {
            const memory = createMemoryBackend()
            await putCommitKey(memory, await markerKey('recovery', OWNER))
            return { memory }
        }],
        ['row 10: a convert marker and no main file', 10, async () => {
            const memory = createMemoryBackend()
            await putCommitKey(memory, await markerKey('convert', OWNER))
            return { memory, mainFile: false }
        }],
        ['row 11: an import marker', 11, async () => {
            const memory = createMemoryBackend()
            await putCommitKey(memory, await markerKey('import', OWNER))
            return { memory }
        }],
        ['row 11: a restore marker', 11, async () => {
            const memory = createMemoryBackend()
            await putCommitKey(memory, await markerKey('restore', OWNER))
            return { memory }
        }],
        ['row 11: a bulk marker', 11, async () => {
            const memory = createMemoryBackend()
            await putCommitKey(memory, await markerKey('bulk', OWNER))
            return { memory }
        }],
    ]

    test.each(cases)('%s', async (_label, row, arrange) => {
        const { memory, mainFile } = await arrange()
        const before = memory.snapshot()
        const test = rig({ memory, mainFile })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.recoveries).toHaveLength(1)
        expect(test.ui.recoveries[0].decision.row).toBe(row)
        expect(test.ui.recoveries[0].session).toBe(getStore2BootSession())
        expect(test.ui.blockedWith).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
        expect(test.allWrites()).toEqual([])
        expect([...memory.snapshot().entries()].map(([key, bytes]) => [key, [...bytes]])).toEqual([...before.entries()].map(([key, bytes]) => [key, [...bytes]]))
    })
})

// ---- row 1: first life ----

describe('new behaviour: row 1, a store with no commit key and no unit', () => {
    test('with no main file and no numbered backup it seeds an empty profile and opens it', async () => {
        const test = rig({ backups: [] })
        const result = expectStoreResult(await test.dispatch())
        expect(result.database).toMatchObject({ characters: [], botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {} })
        expect(test.ui.notices).toEqual([{ name: 'seeded' }])
        const key = await currentKey(test.memory)
        expect(key.current).not.toBeNull()
        expect(key.staging).toBeNull()
        expect(key.convertedFrom).toBe('seed')
        expect(getActiveStore2Save()?.session).toBe(result.session)
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        // The marker, the staged units and the one final compare-and-write; the legacy store is untouched.
        expect(test.store.writes).toEqual([])
        expect(test.store.deletes).toEqual([])
        expect(test.logs[0].writes[0]).toBe('casCommit')
        expect(test.logs[0].writes.filter(write => write === 'casCommit')).toHaveLength(2)
        expect(test.logs[0].writes.slice(1, -1).every(write => write.startsWith('putUnit store2/g-'))).toBe(true)
    })

    test('a Tauri install whose final write reports no confirmed flush is flushed again once, and an unconfirmed result is told', async () => {
        // The memory backend reports no flush at all (undefined), which is not a confirmation.
        const test = rig({ backups: [], kind: 'tauri' })
        const result = expectStoreResult(await test.dispatch())
        expect(test.ui.notices.map(notice => notice.name)).toEqual(['flush-unconfirmed', 'seeded'])
        const writes = test.logs[0].writes
        const commitWrites = writes.filter(write => write === 'casCommit').length
        // The marker, the final write, and the re-flush's rewrites of the same bytes.
        expect(commitWrites).toBeGreaterThan(2)
        expect(result.session.idleReason).not.toBeNull()
    })

    test('a Tauri install whose writes are all confirmed flushed is not flushed again and says nothing about it', async () => {
        const test = rig({ backups: [], kind: 'tauri', hooks: { flushed: true } })
        const result = expectStoreResult(await test.dispatch())
        expect(test.ui.notices).toEqual([{ name: 'seeded' }])
        expect(test.logs[0].writes.filter(write => write === 'casCommit')).toHaveLength(2)
        expect(result.session.idleReason).toBeNull()
    })

    test('a final write whose outcome cannot be read back is a block: the next boot decides', async () => {
        let lost = false
        const test = rig({
            backups: [],
            hooks: {
                beforeCasCommit: (call) => { if (call === 2) { lost = true; throw new Store2UnknownOutcomeError('the answer was lost') } },
                beforeReadCommit: () => { if (lost) { throw new Store2BackendFailureError('the read back failed') } },
            },
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'install-unknown' })])
        expect(getActiveStore2Save()).toBeNull()
        expect(test.ui.notices).toEqual([])
    })

    test('a final write that lost to a peer is classified again, and the peer\'s state is what is shown', async () => {
        const memory = createMemoryBackend()
        const test = rig({
            memory,
            backups: [],
            hooks: round => round === 1
                ? { beforeCasCommit: (call) => {
                    if (call === 2) {
                        const missing = newManifestKey(testEnv(createClock(), 909))
                        memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: { key: missing, at: 1 }, staging: null }, testEnv(createClock(), 910))))
                    }
                } }
                : {},
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.rounds()).toBe(2)
        expect(test.ui.recoveries.map(request => request.decision.row)).toEqual([6])
        expect(test.ui.notices).toEqual([])
    })

    test('with numbered backups it never seeds: the backups are offered and nothing is written', async () => {
        const test = rig({ backups: BACKUP_TIMES })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.offered).toEqual([[...BACKUP_TIMES].sort((a, b) => b - a)])
        expect(test.allWrites()).toEqual([])
        expect(test.store.deletes).toEqual([])
        expect(test.store.files.size).toBe(BACKUP_TIMES.length)
        expect((await test.memory.readCommit()).bytes).toBeNull()
        expect(getActiveStore2Save()).toBeNull()
    })

    test('a backup listing that fails is a block, never read as no backups, and nothing is seeded', async () => {
        const test = rig({ backups: 'unlistable' })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([{ reason: 'backups-unlistable', detail: 'the backup listing failed' }])
        expect(test.allWrites()).toEqual([])
        expect(test.ui.offered).toEqual([])
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('with a main file the conversion is not available yet: the notice, a stop, and nothing written', async () => {
        const test = rig({ mainFile: true })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([{ name: 'convert-unavailable' }])
        expect(test.allWrites()).toEqual([])
        expect(test.store.files.get('database/database.bin')).toEqual(new Uint8Array([1, 2, 3]))
        expect((await test.memory.readCommit()).bytes).toBeNull()
        expect(getActiveStore2Save()).toBeNull()
    })

    test('a Tauri page that declines to convert writes nothing but its owner id, which is well formed', async () => {
        const test = rig({ mainFile: true, kind: 'tauri', hooks: { flushed: true } })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.allWrites()).toEqual([])
        expect(test.store.writes).toEqual([OWNER_KEY])
        expect(isOwnerId(new TextDecoder().decode(test.store.files.get(OWNER_KEY)))).toBe(true)
        expect([...test.store.files.keys()].filter(key => key !== OWNER_KEY && !key.startsWith('database/')).length).toBe(0)
        expect((await test.memory.readCommit()).bytes).toBeNull()
    })

    test('a store2 listing that fails is a block: presence unknown, never read as empty', async () => {
        const test = rig({ hooks: { failCountAndList: true } })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'presence-unknown' })])
        expect(test.allWrites()).toEqual([])
    })

    test('a main file check that fails is a block, never read as absent', async () => {
        const test = rig({ mainFile: async () => { throw new Error('cannot tell') } })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'main-file-unknown' })])
        expect(test.allWrites()).toEqual([])
        expect(test.ui.notices).toEqual([])
    })

    test('a unit that appears after the page looked is never seeded over: the boot is classified again and ends at the recovery screen', async () => {
        // Presence is read twice (by the session and by the marker write); a peer's unit shows up between them.
        const memory = createMemoryBackend()
        const test = rig({
            memory,
            backups: [],
            hooks: round => round === 1
                ? { afterListStore2: (call) => { if (call === 1) { memory.poke('store2/a-unit-a-peer-wrote', new Uint8Array([1])) } } }
                : {},
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.rounds()).toBe(2)
        expect(test.ui.recoveries.map(request => request.decision.row)).toEqual([2])
        expect(test.logs.flatMap(entry => entry.writes)).toEqual([])
    })

    test('a store that keeps moving is classified at most three times and then blocks by name', async () => {
        // Two commit keys name two manifests over the same units, and every round's look at the tree finds the other one.
        const world = await seedWorld(richProfile())
        const memory = world.memory
        const leaf = leafKeys(world)[0][1]
        memory.poke(leaf, null)
        const second = newManifestKey(testEnv(createClock(), 808))
        memory.poke(second, stored(world, world.manifestKey))
        const base = await currentKey(memory)
        const naming = (key: string) => encodeUnit(UNIT_TYPE.commit, nextCommitKey(base, { current: { key, at: 1 } }))
        let named = world.manifestKey
        const test = rig({
            memory,
            hooks: round => {
                if (round > 8) {
                    throw new Error('the dispatch kept opening sessions')
                }
                return { afterReadUnits: (_call, keys) => {
                    if (keys.includes(leaf)) {
                        named = named === world.manifestKey ? second : world.manifestKey
                        memory.poke(COMMIT_KEY, naming(named))
                    }
                } }
            },
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.rounds()).toBe(3)
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'reclassify-exhausted' })])
        expect(test.ui.notices).toEqual([])
        expect(test.allWrites()).toEqual([])
        expect(getActiveStore2Save()).toBeNull()
    })
})

// ---- row 9: a marker that was left standing ----

describe('new behaviour: row 9, a seed or convert marker that was left standing', () => {
    const device = freshOwnerId(testEnv(createClock(), 1234))

    function tauriRig(memory: MemoryBackend, options: RigOptions = {}): Rig {
        const test = rig({ memory, kind: 'tauri', hooks: { flushed: true }, backups: [], ...options })
        test.store.files.set(OWNER_KEY, new TextEncoder().encode(device))
        return test
    }

    test('this device\'s own seed marker is cleared and the seed re-runs in the same boot', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', device))
        const test = tauriRig(memory)
        const result = expectStoreResult(await test.dispatch())
        expect(result.database).toMatchObject({ characters: [] })
        const key = await currentKey(memory)
        expect(key.current).not.toBeNull()
        expect(key.staging).toBeNull()
        expect(test.store.writes).toEqual([])
    })

    test('this device\'s own convert marker is cleared and the conversion, which is not available yet, stops with nothing else written', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('convert', device))
        const test = tauriRig(memory, { mainFile: true })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([{ name: 'convert-unavailable' }])
        const key = await currentKey(memory)
        // Row 7 now: no current manifest and no marker, so the next start shows the recovery screen.
        expect(key.current).toBeNull()
        expect(key.staging).toBeNull()
        // The boot re-flush rewrites the commit key with the bytes it holds, then the start-up clear writes the cleared key.
        expect(test.logs[0].writes).toEqual(['casCommit', 'casCommit'])
    })

    test('an own marker whose clear came to nothing or lost to a peer is classified again', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', device))
        const test = tauriRig(memory, {
            hooks: round => round === 1
                ? { flushed: true, beforeCasCommit: async (call) => {
                    // Call 1 is the boot re-flush; call 2 is the start-up clear. A peer clears the marker first, so the clear loses.
                    if (call === 2) {
                        memory.poke(COMMIT_KEY, encodeUnit(UNIT_TYPE.commit, firstCommitKey({ current: null, staging: null }, testEnv(createClock(), 77))))
                    }
                } }
                : { flushed: true },
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.rounds()).toBe(2)
        expect(test.ui.recoveries.map(request => request.decision.row)).toEqual([7])
    })

    test('an own marker that cannot be cleared blocks and re-runs nothing', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', device))
        const before = (await memory.readCommit()).bytes
        const test = tauriRig(memory, {
            // Call 1 is the boot re-flush; call 2 is the start-up clear.
            hooks: { flushed: true, beforeCasCommit: (call) => { if (call === 2) { throw new Store2BackendFailureError('the write was refused') } } },
        })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'own-marker-not-cleared' })])
        expect((await memory.readCommit()).bytes).toEqual(before)
        expect(getActiveStore2Save()).toBeNull()
    })

    test('an own marker on a Tauri page whose re-flush failed is not cleared (no clear ran): it blocks, says why, and writes nothing', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', device))
        const before = (await memory.readCommit()).bytes
        // The boot re-flush needs a confirmed flush; this backend never confirms one.
        const test = tauriRig(memory, { hooks: { flushed: false } })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices.map(notice => notice.name)).toEqual(['reflush-failed'])
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'own-marker-not-cleared' })])
        expect((await memory.readCommit()).bytes).toEqual(before)
    })

    test('a marker of another owner is put to the user: "wait" leaves it and stops', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', freshOwnerId(testEnv(createClock(), 55))))
        const before = (await memory.readCommit()).bytes
        const test = rig({ memory, backups: [] })
        test.ui.foreignAnswer = 'wait'
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.foreignAsked).toHaveLength(1)
        expect(test.ui.foreignAsked[0].label).toBe('seed')
        expect(test.allWrites()).toEqual([])
        expect((await memory.readCommit()).bytes).toEqual(before)
    })

    test('a marker of another owner is cleared on "clear" and the boot is classified again: it lands on row 7', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', freshOwnerId(testEnv(createClock(), 56))))
        const test = rig({ memory, backups: [] })
        test.ui.foreignAnswer = 'clear'
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.rounds()).toBe(2)
        expect(test.ui.recoveries.map(request => request.decision.row)).toEqual([7])
        const key = await currentKey(memory)
        expect(key.current).toBeNull()
        expect(key.staging).toBeNull()
        expect(test.logs.flatMap(entry => entry.writes)).toEqual(['casCommit'])
    })

    test('a web page whose reload gave it a fresh owner id meets its own earlier marker as a foreign one', async () => {
        const memory = createMemoryBackend()
        await putCommitKey(memory, await markerKey('seed', device))
        const test = rig({ memory, kind: 'indexeddb', backups: [] })
        await test.dispatch()
        expect(test.ui.foreignAsked).toHaveLength(1)
    })
})

// ---- the page whose store2 backend is not available ----

describe('new behaviour: a page that cannot write the store2 backend', () => {
    function guarded(capable: boolean): GuardedOperations {
        const refuse = async () => { throw new Error('not used') }
        return {
            probe: async () => ({ checkOnly: capable, retire: capable, pieces: false }),
            writeChecked: refuse,
            removeChecked: refuse,
            retireChecked: refuse,
        }
    }

    function unavailableRig(kind: AppStoreKind, options: RigOptions & { capable?: boolean | 'none' } = {}): Rig {
        const mainFile = options.mainFile ?? true
        const test = rig({ ...options, kind, mainFile })
        const dispatch = () => dispatchStore2Boot({
            store: test.store,
            upstreamMainFile: typeof mainFile === 'function' ? mainFile : async () => mainFile,
            listBackupTimes: async () => [...BACKUP_TIMES],
        }, { ui: test.ui, kind })
        if (options.capable !== 'none') {
            test.store.guarded = guarded(options.capable === true)
        }
        return { ...test, dispatch }
    }

    test('the transitional OPFS page hands the legacy profile back read-only without a store2 read or notice', async () => {
        const test = unavailableRig('opfs-transitional')
        expect(await test.dispatch()).toEqual({ kind: 'legacy-readonly', reason: 'opfs-transitional' })
        expect(test.ui.notices).toEqual([])
        expect(test.store.reads).toEqual([])
        expect(await getPageBlockOwner()).toBeNull()
    })

    test('a Node server without the check-only route, with no store2 commit key and a main file, is read-only legacy with its named notice and no block owner', async () => {
        const test = unavailableRig('node', { capable: false })
        expect(await test.dispatch()).toEqual({ kind: 'legacy-readonly', reason: 'server-capability' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'server-capability' })])
        expect(await getPageBlockOwner()).toBeNull()
        expect(test.store.reads).toContain('store2-commit')
        expect(test.store.writes).toEqual([])
        expect(test.store.deletes).toEqual([])
    })

    test('a Node page with no guarded operations at all is unavailable, with the other named notice', async () => {
        const test = unavailableRig('node', { capable: 'none' })
        expect(await test.dispatch()).toEqual({ kind: 'legacy-readonly', reason: 'backend-unavailable' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
    })

    test('a store2 commit key that is present blocks: the profile is store2 and this page cannot write it. No data is loaded', async () => {
        const test = unavailableRig('node', { capable: false })
        test.store.files.set('store2-commit', new Uint8Array([1]))
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.notices).toEqual([expect.objectContaining({ name: 'server-capability' })])
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'store2-profile-unwritable' })])
        expect(getActiveStore2Save()).toBeNull()
    })

    test('a store2 commit key whose bytes do not parse still counts as present', async () => {
        const test = unavailableRig('node', { capable: false })
        test.store.files.set('store2-commit', new Uint8Array(0))
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'store2-profile-unwritable' })])
    })

    test('a store2 commit key that cannot be read blocks, never read as absent', async () => {
        const test = unavailableRig('node', { capable: false })
        test.store.failRead = key => key === 'store2-commit' ? new Error('the read failed') : null
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'commit-key-unreadable' })])
    })

    test('no store2 commit key and no main file blocks: there is no profile to read and this page cannot create one', async () => {
        const test = unavailableRig('node', { capable: false, mainFile: false })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'no-profile-unwritable' })])
    })

    test('a main file check that fails blocks, never read as absent', async () => {
        const test = unavailableRig('node', { capable: false, mainFile: async () => { throw new Error('cannot tell') } })
        expect(await test.dispatch()).toEqual({ kind: 'stopped' })
        expect(test.ui.blockedWith).toEqual([expect.objectContaining({ reason: 'main-file-unknown' })])
    })
})
