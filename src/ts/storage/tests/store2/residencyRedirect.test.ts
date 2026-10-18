// @vitest-environment node
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

import { DBState } from 'src/ts/stores.svelte'
import { alertError } from 'src/ts/alert'
import { markIdentitySeen } from 'src/ts/storage/dbChangeEffects.svelte'
import { getAppStore } from 'src/ts/storage/store/appStore'
import type { Database, character } from 'src/ts/storage/database.svelte'
import {
    createMemoryBackend, type MemoryBackend, type Store2Backend,
} from 'src/ts/storage/store2/backend'
import {
    assembleCharacter, assembleDatabase, stubFromEntry, type UnitSource,
} from 'src/ts/storage/store2/codec'
import { FRAME_HEADER_BYTES, keyOfRef, randomId26, type ShardEntry } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency, type Residency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { residentSetOf } from 'src/ts/storage/store2/residencyPolicy'
import { createSaveEncoder, type SaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { createLegacyStoreReader } from 'src/ts/storage/store2/legacy/storeReader'
import {
    collectColdStorageBackupPayloads, getColdUnitStamp, hasColdUnitInStore, readColdStorageItem,
} from 'src/ts/process/coldstorage.svelte'
import { readColdCharacterCopy, restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import { readArchivedCharacter, restoreArchivedForWrite } from 'src/ts/process/coldCharacterAccess'
import { restoreColdCharacterByChaId } from 'src/ts/process/coldMemberRestore'
import { loadedRecordOf, resetRetainedForTest, retainedRecordOf } from 'src/ts/process/coldRetained'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The cold-storage reader over a store2 residency: `readColdStorageItem` of a store2 entity key, the restore facades
 * over it, and the places that must never see an entity as a legacy unit (the unit stamp and presence, the backup
 * collector). The memory backend is a stand-in: a pass here says nothing about the real stores.
 *
 * Titles starting `guard:` hold before and after the change. The other tests fail without the redirect, and the matching
 * mutant of each is listed in the hand-off.
 */

const NOW = 1_700_000_000_000

interface Booted {
    memory: MemoryBackend
    db: Database
    entries: ShardEntry[]
    stubs: ShardEntry[]
    encoder: SaveEncoder
    residency: Residency
    /** Every unit of the tree. */
    source: UnitSource
}

/** Boots a database the way a store2 page will: the policy decides who is resident, the others are stubs of their entries. */
async function bootOf(options: { backend?: (memory: MemoryBackend) => Store2Backend, characters?: number } = {}): Promise<Booted> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const source = { ...(buildSmall(options.characters ?? 4) as unknown as Obj), archiveCharacters: true } as unknown as Database
    const seeded = await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, env, fakeLists)
    let resident: ReadonlySet<string> = new Set()
    const read = await readTreeBytes(memory, seeded.manifestKey, {
        resident: (input) => {
            resident = residentSetOf(input)
            return resident
        },
    })
    if (read.status !== 'ok') {
        throw new Error(`The seeded tree read ${read.status}.`)
    }
    const db = assembleDatabase(read.tree.manifest, read.tree.source, {
        character: (entry, units) => (resident.has(entry.u) ? assembleCharacter(entry, units) : stubFromEntry(entry)),
    })
    const previous = previousOfTree(read.tree)
    const entries = (previous.objects?.shards ?? []).flatMap(shard => shard.entries)
    const context = { lists: fakeLists, env: seededEnv(77), encoder: createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW }) }
    const residency = createResidency({ backend: options.backend?.(memory) ?? memory, context })
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    return { memory, db, entries, stubs: entries.filter(entry => !resident.has(entry.u)), encoder: context.encoder, residency, source: full.tree.source }
}

/** Boots, registers the residency and makes the booted database the page's. */
async function pageOf(options: Parameters<typeof bootOf>[0] = {}): Promise<Booted> {
    const booted = await bootOf(options)
    registerResidency(booted.residency)
    ;(DBState as { db: unknown }).db = booted.db
    return booted
}

function slotOf(entry: ShardEntry): character {
    const slot = (DBState.db.characters as character[]).find(candidate => candidate.chaId === entry.chaId)
    if (slot === undefined) {
        throw new Error(`No character ${entry.chaId}.`)
    }
    return slot
}

function flipByte(memory: MemoryBackend, key: string): void {
    const bytes = new Uint8Array(memory.snapshot().get(key) as Uint8Array)
    bytes[FRAME_HEADER_BYTES + 1] ^= 0xff
    memory.poke(key, bytes)
}

beforeEach(() => {
    vi.clearAllMocks()
    resetResidencyForTest()
    resetRetainedForTest()
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    resetResidencyForTest()
    vi.restoreAllMocks()
})

describe('R2: a stub of a store2 entity is restored from its units', () => {
    test('the restore installs the whole character, hydrates its units, records the load and tells the identity tracker', async () => {
        const booted = await pageOf()
        const entry = booted.stubs[0]
        const stub = slotOf(entry)
        let indexAtMark = -2
        vi.mocked(markIdentitySeen).mockImplementation((object) => { indexAtMark = (DBState.db.characters as unknown[]).indexOf(object) })

        const outcome = await restoreColdCharacter(stub, { quiet: true })

        expect(outcome).toMatchObject({ status: 'restored', installedHere: true })
        const installed = slotOf(entry)
        expect(installed).not.toBe(stub)
        expect(installed.coldstorage).toBeUndefined()
        expect(installed.chats.length).toBe(entry.chats.length)
        expect(installed).toEqual(expect.objectContaining({ chaId: entry.chaId, name: entry.name }))
        expect(loadedRecordOf(installed)).toEqual({ chaId: entry.chaId, u: entry.u })
        expect(retainedRecordOf(installed)).toBeUndefined()
        // Hydrated in the step that installed it: the first pass over the loaded character reuses every unit.
        expect(booted.residency.verdict(installed)).toBe('clean')
        // The tracker is told in the same step, with the object as the list holds it.
        expect(markIdentitySeen).toHaveBeenCalledTimes(1)
        expect(indexAtMark).toBe((DBState.db.characters as unknown[]).indexOf(installed))
    })

    test('a copy read installs nothing, records no load, hydrates nothing and does not touch the tracker', async () => {
        const booted = await pageOf()
        const entry = booted.stubs[1]
        const stub = slotOf(entry)

        const copy = await readColdCharacterCopy(stub)

        expect(copy.status).toBe('ok')
        if (copy.status !== 'ok') {
            return
        }
        expect(slotOf(entry)).toBe(stub)
        expect(loadedRecordOf(copy.character)).toBeUndefined()
        expect(booted.residency.verdict(copy.character)).toBe('unknown')
        expect(markIdentitySeen).not.toHaveBeenCalled()
    })

    test('a character the page created has no load record, and neither has a stub', async () => {
        const booted = await pageOf()
        const created = { ...(assembleCharacter(booted.stubs[0], booted.source) as unknown as character), chaId: 'created-this-session' } as character
        ;(DBState.db.characters as character[]).push(created)

        expect(loadedRecordOf(created)).toBeUndefined()
        expect(loadedRecordOf(slotOf(booted.stubs[2]))).toBeUndefined()
    })

    test('a stub whose chunk is absent or flipped is refused as damaged and stays; a failing store is refused as unreadable', async () => {
        for (const damage of ['absent', 'flipped'] as const) {
            const booted = await pageOf()
            const entry = booted.stubs[0]
            const key = keyOfRef(entry.chats[0].chunks[0])
            if (damage === 'absent') {
                booted.memory.poke(key, null)
            } else {
                flipByte(booted.memory, key)
            }
            const stub = slotOf(entry)

            const outcome = await restoreColdCharacter(stub, { quiet: true })

            expect(outcome, damage).toEqual({ status: 'refused', reason: 'damaged' })
            expect(slotOf(entry), damage).toBe(stub)
            expect(loadedRecordOf(slotOf(entry)), damage).toBeUndefined()
            // The stub is carried: the next pass writes the manifest and nothing else.
            const pass = await booted.encoder.plan(booted.db, { marked: new Set([entry.chaId]), modules: false, whole: false })
            expect(pass.newUnits, damage).toBe(1)
            expect(pass.unchanged, damage).toBe(true)
        }

        const failing = await pageOf({ backend: memory => ({ ...memory, readUnits: async () => { throw new TypeError('the page lost its storage') } }) })
        const stub = slotOf(failing.stubs[0])
        expect(await restoreColdCharacter(stub, { quiet: true })).toEqual({ status: 'refused', reason: 'unreadable' })
        expect(slotOf(failing.stubs[0])).toBe(stub)
    })
})

describe('MC-146 over the store2 reader', () => {
    test('1: a plugin or MCP read of a damaged character fails the call with one alert naming it; an intact one is read whole', async () => {
        const booted = await pageOf()
        const [good, bad] = booted.stubs
        booted.memory.poke(keyOfRef(bad.chats[0].chunks[0]), null)

        const read = await readArchivedCharacter(slotOf(good))
        expect(read).toMatchObject({ status: 'ok' })
        expect(alertError).not.toHaveBeenCalled()

        const failed = await readArchivedCharacter(slotOf(bad))
        expect(failed).toMatchObject({ status: 'failed' })
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toContain(bad.name)

        vi.mocked(alertError).mockClear()
        const write = await restoreArchivedForWrite(bad.chaId)
        expect(write).toMatchObject({ status: 'failed' })
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(await restoreArchivedForWrite(good.chaId)).toMatchObject({ status: 'ready' })
    })

    test('2: a group turn restores an intact member and reports a damaged one by name, leaving its stub', async () => {
        const booted = await pageOf()
        const [good, bad] = booted.stubs
        booted.memory.poke(keyOfRef(bad.chats[0].chunks[0]), null)

        expect(await restoreColdCharacterByChaId(good.chaId)).toBe(true)
        expect(alertError).not.toHaveBeenCalled()
        const stub = slotOf(bad)
        expect(await restoreColdCharacterByChaId(bad.chaId)).toBe(false)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(String(vi.mocked(alertError).mock.calls[0][0])).toContain(bad.name)
        expect(slotOf(bad)).toBe(stub)
    })
})

describe('a store2 entity key never answers missing (B2)', () => {
    const damages: Array<[string, (booted: Booted, entry: ShardEntry) => void]> = [
        ['a unit that is absent', (booted, entry) => booted.memory.poke(keyOfRef(entry.core), null)],
        ['a chat chunk that is absent', (booted, entry) => booted.memory.poke(keyOfRef(entry.chats[0].chunks[0]), null)],
        ['a unit whose bytes are flipped', (booted, entry) => flipByte(booted.memory, keyOfRef(entry.core))],
    ]

    test.each(damages)('with a residency registered, %s answers error of kind damaged', async (_label, damage) => {
        const booted = await pageOf()
        const entry = booted.stubs[0]
        damage(booted, entry)
        const result = await readColdStorageItem(entry.u)
        expect(result.status).not.toBe('missing')
        expect(result).toMatchObject({ status: 'error', kind: 'damaged' })
    })

    test('with a residency registered, an entity the acknowledged encoding does not hold answers error of kind damaged', async () => {
        await pageOf()
        const result = await readColdStorageItem(randomId26(seededEnv(9)))
        expect(result.status).not.toBe('missing')
        expect(result).toMatchObject({ status: 'error', kind: 'damaged' })
    })

    test('with a residency registered, a failing store answers an error with no kind', async () => {
        const booted = await pageOf({ backend: memory => ({ ...memory, readUnits: async () => { throw new TypeError('the page lost its storage') } }) })
        const result = await readColdStorageItem(booted.stubs[0].u)
        expect(result.status).toBe('error')
        expect(result).not.toHaveProperty('kind')
    })

    test('with a residency registered, an intact entity answers its character whole', async () => {
        const booted = await pageOf()
        const entry = booted.stubs[0]
        const result = await readColdStorageItem(entry.u)
        expect(result).toMatchObject({ status: 'ok' })
        expect((result as { value: { character: Obj } }).value.character).toEqual(assembleCharacter(entry, booted.source))
    })

    test('without a residency, every entity key answers error of kind damaged, which the converter reads as a placeholder', async () => {
        const booted = await bootOf()
        for (const key of [booted.stubs[0].u, randomId26(seededEnv(10))]) {
            const result = await readColdStorageItem(key)
            expect(result.status).not.toBe('missing')
            expect(result).toMatchObject({ status: 'error', kind: 'damaged' })
            expect(await createLegacyStoreReader(readColdStorageItem).read(key)).toEqual({ status: 'unparsable' })
        }
    })

    test('guard: a legacy unit id still takes the legacy path and an absent one is missing', async () => {
        await pageOf()
        const result = await readColdStorageItem('aaaaaaaa-0000-4000-8000-000000000001')
        expect(result).toEqual({ status: 'missing' })
        expect(getAppStore).toHaveBeenCalled()
    })
})

describe('the clean-up summary cache never describes a store2 entity (N4)', () => {
    test('an entity has no write stamp and is never held as a unit file, and neither check opens the page store', async () => {
        const booted = await pageOf()
        const key = booted.stubs[0].u

        expect(getColdUnitStamp(key)).toBeNull()
        expect(await hasColdUnitInStore(key)).toBe(false)
        expect(getAppStore).not.toHaveBeenCalled()
    })

    test('guard: a legacy unit keeps its stamp', () => {
        expect(getColdUnitStamp('aaaaaaaa-0000-4000-8000-000000000001')).toBe(0)
    })
})

describe('the backup collector never reads or carries a store2 entity (belt)', () => {
    test('a root that is an entity is reported and not carried, although its units read whole', async () => {
        const booted = await pageOf()
        const entry = booted.stubs[0]

        const collected = await collectColdStorageBackupPayloads({ characters: [], pluginCustomStorage: {} }, {
            roots: [{ key: entry.u, kind: 'normal', owner: entry.name }],
        })

        expect(collected.payloads).toEqual([])
        expect(collected.missingKeys).toEqual([entry.u])
        expect(collected.owners?.get(entry.u)).toEqual([entry.name])
        expect(collected.settledKeys?.has(entry.u)).toBe(true)
    })

    test('a root the caller already settled is neither read nor reported twice', async () => {
        const reads = vi.fn()
        const booted = await pageOf({ backend: memory => ({ ...memory, readUnits: async (keys) => { reads(keys); return memory.readUnits(keys) } }) })
        const entry = booted.stubs[0]

        const collected = await collectColdStorageBackupPayloads({ characters: [], pluginCustomStorage: {} }, {
            roots: [{ key: entry.u, kind: 'normal' }],
            settledKeys: new Set([entry.u]),
        })

        expect(collected.payloads).toEqual([])
        expect(collected.missingKeys).toEqual([])
        expect(reads).not.toHaveBeenCalled()
    })
})
