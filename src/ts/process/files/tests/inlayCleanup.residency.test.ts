// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: undefined as undefined | Record<string, unknown>,
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
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
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    afterNextSaveCommit: vi.fn(),
    getSaveMarkCount: vi.fn(() => 0),
    isSaveClean: vi.fn(() => true),
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    removeInlayAsset: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleCharacter, assembleDatabase, stubFromEntry } from 'src/ts/storage/store2/codec'
import { keyOfRef, type ShardEntry } from 'src/ts/storage/store2/format'
import { previousOfTree } from 'src/ts/storage/store2/previousOfTree'
import { createResidency } from 'src/ts/storage/store2/residency'
import { registerResidency, resetResidencyForTest } from 'src/ts/storage/store2/residencyActive'
import { residentSetOf } from 'src/ts/storage/store2/residencyPolicy'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { queueInlayCleanupForCharacters, getInlayCleanupState } from 'src/ts/process/files/inlayCleanup'
import { removeInlayAsset } from 'src/ts/process/files/inlays'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest } from 'src/ts/storage/store2/bootActive'
import { getResidency } from 'src/ts/storage/store2/residencyActive'
import { resetStore2SaveForTest } from 'src/ts/storage/store2/saveActive'
import { bootThroughDispatch, createClock, seedTree, testEnv } from 'src/ts/storage/tests/store2SaveKit'
import { buildSmall, fakeLists, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

/**
 * The inlay clean-up over characters that a store2 page holds as stubs (W4-Q4). The clean-up reads each unloaded
 * character through the cold-storage reader, which answers from the residency; a character it cannot read whole makes
 * the set of kept inlays incomplete, so nothing is deleted. Each case but the last takes its candidates from a character
 * removed whole or from a stub read through the reader, asserts that the candidate set is not empty, and pairs a kept
 * inlay with one found unreferenced (or an unreadable stub with nothing deleted). A store2 page deletes no inlay at all
 * (`inlayCleanup.store2Refusal.test.ts`), so the unreferenced inlay is counted, not removed. The last case, labelled
 * `guard:`, has no candidates and passes without the redirect. The memory backend is a stand-in for the page's store.
 */

const NOW = 1_700_000_000_000
const token = (id: string) => `{{inlayed::${id}}}`
const X = 'aaaaaaaa-0000-4000-8000-0000000000a1'
const Y = 'aaaaaaaa-0000-4000-8000-0000000000a2'
const W = 'aaaaaaaa-0000-4000-8000-0000000000a3'
/** What the batch reports when a store2 page refuses to delete: the reader redirect is still exercised, the deletion is not. */
const STORE2_REFUSAL = 'inlay deletion is off on this page'

interface Page {
    memory: MemoryBackend
    /** The profile without the removed character: stubs of the others. */
    db: Database
    removed: Obj
    removedEntry: ShardEntry
    stubs: ShardEntry[]
    seeds: Database
}

/** `texts[i]` is appended to the first message of the first chat of character i. */
async function pageOf(texts: string[]): Promise<Page> {
    const memory = createMemoryBackend()
    const clock = createClock()
    const env = testEnv(clock, 4242)
    const source = { ...(buildSmall(3) as unknown as Obj), archiveCharacters: true } as unknown as Database
    texts.forEach((text, index) => {
        const message = (((source.characters[index] as unknown as Obj).chats as Obj[])[0].message as Obj[])[0]
        message.data = `${message.data as string} ${text}`
    })
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
    registerResidency(createResidency({ backend: memory, context }))
    const full = await readTreeBytes(memory, seeded.manifestKey)
    if (full.status !== 'ok') {
        throw new Error('The full read failed.')
    }
    // The removed character is the first of the fixture and the stub that shows an inlay the second.
    const entryOf = (index: number): ShardEntry => entries.find(entry => entry.chaId === (source.characters[index] as unknown as Obj).chaId) as ShardEntry
    const removedEntry = entryOf(0)
    const stubs = [entryOf(1), entryOf(2)]
    const removed = assembleCharacter(removedEntry, full.tree.source) as unknown as Obj
    db.characters = db.characters.filter(slot => slot.chaId !== removedEntry.chaId)
    h.db = db as unknown as Record<string, unknown>
    return { memory, db, removed, removedEntry, stubs, seeds: source }
}

let logs: Array<Record<string, unknown>> = []
let infoSpy: ReturnType<typeof vi.spyOn>

/** Queues the removal and waits for the batch to finish; returns what the batch logged. */
async function runCleanup(removed: Obj[]): Promise<Record<string, unknown>> {
    const before = logs.length
    queueInlayCleanupForCharacters(removed as never)
    await vi.waitFor(() => { expect(logs.length).toBe(before + 1) }, { timeout: 8000, interval: 20 })
    expect(getInlayCleanupState()).toEqual({ pending: 0, running: false })
    return logs[logs.length - 1]
}

const deleted = () => vi.mocked(removeInlayAsset).mock.calls.map(call => call[0])

function resetPage(): void {
    resetResidencyForTest()
    resetStore2SaveForTest()
    resetStore2BootForTest()
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
}

beforeEach(() => {
    logs = []
    vi.mocked(removeInlayAsset).mockClear()
    resetPage()
    infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
        if (args[0] === 'inlay cleanup') {
            logs.push({ ...(args[1] as Record<string, unknown>) })
        }
    })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME, mode: 'shared', clientId: 'this' }], pending: [] }) },
    })
})

afterEach(() => {
    resetPage()
    infoSpy.mockRestore()
    vi.restoreAllMocks()
})

describe('the clean-up reads an unloaded character through the reader', () => {
    test('an inlay that a stub still shows is kept, and one that nothing shows is found unreferenced but not deleted on a store2 page', async () => {
        // The removed character shows X and Y; the stub shows Y.
        const page = await pageOf([`${token(X)} ${token(Y)}`, token(Y), ''])

        const log = await runCleanup([page.removed])

        expect(log.candidates).toBe(2)
        expect(deleted()).toEqual([])
        expect(log).toMatchObject({ kept: 1, deleted: 0, skipped: STORE2_REFUSAL })
    })

    test('a stub purged from the trash gives its inlays as candidates, and another stub keeps the one it shows', async () => {
        const page = await pageOf([`${token(X)} ${token(Y)}`, token(Y), ''])
        const log = await runCleanup([stubFromEntry(page.removedEntry) as unknown as Obj])

        expect(log.candidates).toBe(2)
        expect(log.kept).toBe(1)
        expect(deleted()).toEqual([])
    })

    test('a stub with an absent chunk makes the walk incomplete: nothing is deleted although another of its chats is intact and shows the inlay', async () => {
        const page = await pageOf([`${token(X)} ${token(Y)}`, token(Y), ''])
        const damaged = page.stubs[0]
        expect(damaged.chats.length).toBeGreaterThan(1)
        page.memory.poke(keyOfRef(damaged.chats[1].chunks[0]), null)

        const log = await runCleanup([page.removed])

        expect(log.candidates).toBe(2)
        expect(deleted()).toEqual([])
        expect(log.skipped).toBe('a cold unit could not be read')
    })

    test('with no residency registered a stub cannot be read, so nothing is deleted', async () => {
        const page = await pageOf([`${token(X)} ${token(Y)}`, token(Y), ''])
        resetResidencyForTest()

        const log = await runCleanup([page.removed])

        expect(log.candidates).toBe(2)
        expect(deleted()).toEqual([])
        expect(log.skipped).toBe('a cold unit could not be read')
    })

    test('guard: a purged stub whose own units are damaged yields no candidates and deletes nothing', async () => {
        const page = await pageOf([`${token(X)} ${token(Y)}`, token(Y), ''])
        page.memory.poke(keyOfRef(page.removedEntry.chats[0].chunks[0]), null)

        const log = await runCleanup([stubFromEntry(page.removedEntry) as unknown as Obj])

        expect(deleted()).toEqual([])
        expect(log.candidates).toBe(0)
    })
})

describe('a summary of a store2 entity is never remembered (N4)', () => {
    test('an inlay that a stub came to show after an earlier run is kept by the next run', async () => {
        // Run 1: Y is a candidate, kept by the stub.
        const first = await pageOf([`${token(X)} ${token(Y)}`, token(Y), ''])
        const stubU = first.stubs[0].u
        expect((await runCleanup([first.removed])).kept).toBe(1)
        expect(deleted()).toEqual([])
        vi.mocked(removeInlayAsset).mockClear()
        resetResidencyForTest()

        // Run 2, the same entity with new content: it now shows W (and no longer Y); W is a candidate of the removed character.
        const second = await pageOf([`${token(X)} ${token(W)}`, token(W), ''])
        expect(second.stubs[0].u).toBe(stubU)
        const log = await runCleanup([second.removed])

        expect(log.candidates).toBe(2)
        expect(deleted()).toEqual([])
        expect(log).toMatchObject({ kept: 1, deleted: 0 })
    })
})

describe('the boot purge, with the residency registered as the boot registers it', () => {
    test('a trash-due stub purged while another stub shows an inlay keeps that inlay, and the candidates are not empty', async () => {
        // Three stubs: the purged one shows X and Y, the next shows Y only.
        const memory = createMemoryBackend()
        const source = { ...(buildSmall(3) as unknown as Obj), archiveCharacters: true } as unknown as Database
        const shown = [`${token(X)} ${token(Y)}`, token(Y), '']
        shown.forEach((text, index) => {
            const message = (((source.characters[index] as unknown as Obj).chats as Obj[])[0].message as Obj[])[0]
            message.data = `${message.data as string} ${text}`
        })
        await seedTree(memory, JSON.parse(JSON.stringify(source)) as Database, testEnv(createClock(), 4242), fakeLists)
        const boot = await bootThroughDispatch(memory)
        if (boot.result.kind !== 'store2') {
            throw new Error(`The boot answered ${boot.result.kind}.`)
        }
        expect(getResidency()).not.toBeNull()
        const stubs = boot.result.database.characters
        expect(stubs.every(slot => typeof slot.coldstorage === 'string')).toBe(true)
        h.db = boot.result.database as unknown as Record<string, unknown>
        const purged = stubs.find(slot => slot.chaId === (source.characters[0] as unknown as Obj).chaId) as unknown as Obj
        // `checkNewFormat` purges the trash-due stub and queues its clean-up; the other stubs stay in the list.
        h.db.characters = stubs.filter(slot => slot !== (purged as unknown))

        const log = await runCleanup([purged])

        expect(log.candidates).toBe(2)
        expect(deleted()).toEqual([])
        expect(log).toMatchObject({ kept: 1, deleted: 0, skipped: STORE2_REFUSAL })
    })
})
