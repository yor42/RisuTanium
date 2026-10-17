/**
 * A strict decode of a save whose character lives in a remote file: when the store cannot be read, the decode rejects with
 * `RisuSaveReadError` (the original error as `cause`, its message kept), so a caller that falls back to another copy on a
 * decode failure can tell "the store failed" from "the file does not decode". A remote file the store simply does not hold
 * stays an ordinary decode failure. Platform boundaries are mocked as in the salvage tests.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const { cacheStore, remoteStore, faults } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    remoteStore: new Map<string, Uint8Array>(),
    faults: { failReads: false },
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { cacheStore.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { cacheStore.delete(key) }),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => Array.from(remoteStore.keys())),
        getItem: vi.fn(async (key: string) => {
            if (faults.failReads) {
                throw new Error('the disk failed')
            }
            return remoteStore.get(key) ?? null
        }),
        setItem: vi.fn(async (key: string, value: Uint8Array) => { remoteStore.set(key, value) }),
        removeItem: vi.fn(async (key: string) => { remoteStore.delete(key) }),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder, RisuSaveReadError, decodeRisuSave, type toSaveType } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { classifyCommitRead } from 'src/ts/storage/store2/commitKey'
import { firstLifeGrant } from 'src/ts/storage/store2/firstLife'
import { convertLegacyProfile } from 'src/ts/storage/store2/legacy/convert'
import { freshOwnerId } from 'src/ts/storage/store2/owner'
import { withRemoteCharacters } from './remoteFileFixture'
import { createClock, testEnv } from './store2SaveKit'
import { fakeLists } from './store2/codecFixtures'

beforeEach(() => {
    cacheStore.clear()
    remoteStore.clear()
    faults.failReads = false
})

const IDS = ['strict-0', 'strict-1']

function makeToSave(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

/** A block-format file of two characters that live in remote files. */
async function remoteFile(): Promise<Uint8Array> {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'Preset' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: IDS.map((chaId, index) => ({ chaId, type: 'character', name: `Character ${index}`, chats: [] })),
    } as unknown as Database
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, makeToSave())
    return withRemoteCharacters(new Uint8Array(encoder.encode()!), IDS, (key, bytes) => { remoteStore.set(key, bytes) })
}

describe('new behaviour: a strict decode that cannot read a remote file', () => {
    test('rejects with RisuSaveReadError, keeping the message and the original error as the cause', async () => {
        const file = await remoteFile()
        faults.failReads = true

        const outcome = await decodeRisuSave(file, { strict: true }).then(() => null, (error: unknown) => error)

        expect(outcome).toBeInstanceOf(RisuSaveReadError)
        const failure = outcome as RisuSaveReadError
        expect(failure.name).toBe('RisuSaveReadError')
        expect(failure.fileName).toMatch(/^remotes\//)
        expect(failure.cause).toBeInstanceOf(Error)
        expect(failure.message).toBe((failure.cause as Error).message)
        expect(failure.message).toContain('the disk failed')
    })

    test('a remote file the store does not hold is an ordinary decode failure, not a read failure (guard)', async () => {
        const file = await remoteFile()
        remoteStore.clear()

        const outcome = await decodeRisuSave(file, { strict: true }).then(() => null, (error: unknown) => error)

        expect(outcome).toBeInstanceOf(Error)
        expect(outcome).not.toBeInstanceOf(RisuSaveReadError)
        expect((outcome as Error).message).toContain('not found')
    })

    test('an intact file still decodes strictly (guard)', async () => {
        const tree = await decodeRisuSave(await remoteFile(), { strict: true }) as Database

        expect(tree.characters.map(character => character.chaId)).toEqual(IDS)
    })

    test('the lenient decode is unchanged: the unreadable character is left out, not rejected (guard)', async () => {
        const file = await remoteFile()
        faults.failReads = true

        const tree = await decodeRisuSave(file) as Database

        expect(tree.characters ?? []).toEqual([])
    })
})

describe('new behaviour: the conversion with the real decoder', () => {
    test('a main file whose remote read fails blocks the conversion: nothing is written and no backup is tried', async () => {
        const file = await remoteFile()
        faults.failReads = true
        const store = createMemoryByteStore()
        store.files.set('database/database.bin', file)
        store.files.set('database/dbbackup-100.bin', new Uint8Array([1]))
        const memory = createMemoryBackend()
        const granted = firstLifeGrant({ decision: { row: 1, mode: 'first-life', action: 'convert' }, commitRead: await memory.readCommit(), startupClear: null })
        if (granted.status !== 'granted') {
            throw new Error('No first-life grant.')
        }
        const reads: string[] = []
        const read = store.read.bind(store)
        store.read = async (key) => {
            reads.push(key)
            return read(key)
        }

        const result = await convertLegacyProfile({
            store,
            listBackupTimes: async () => [100],
            readColdStorageItem: async () => ({ status: 'missing' }),
            backend: memory,
            grant: granted.grant,
            owner: freshOwnerId(testEnv(createClock(), 1)),
            lists: fakeLists,
        }, { confirmIncomplete: async () => true, confirmFromBackup: async () => true })

        expect(result).toEqual({ status: 'blocked', reason: 'convert-read-failed', detail: expect.stringContaining('the disk failed') })
        expect(reads).toEqual(['database/database.bin'])
        expect(memory.snapshot().size).toBe(0)
        expect(classifyCommitRead(await memory.readCommit()).status).toBe('absent')
        expect(store.writes).toEqual([])
        expect(store.deletes).toEqual([])
    })
})
