// @vitest-environment happy-dom

/**
 * MC-078. Every backup load -- the internal backup and `LoadLocalBackup`
 * (`src/ts/drive/backuplocal.ts`) -- repairs a missing or duplicate
 * `chaId`/chat id before installing the decoded database
 * (`repairDatabaseIds`, `src/ts/process/chatIds.ts`).
 * `LoadLocalBackup` is the one route this file pins directly: its own page
 * reload runs after `setDatabase` installs the decoded object, and the save
 * loop can run once in that window before boot's own repair (on the next
 * page load) would otherwise catch a duplicate the decoded backup carried.
 *
 * Drives the real `LoadLocalBackup` end to end: a fake `<input type=file>`
 * (captured off `document.createElement`, since happy-dom has no real file
 * picker) feeds it a real happy-dom `File`, built over a hand-built backup
 * byte stream holding a single `database.risudat` chunk, and read through
 * the file's own real `stream().getReader()` -- exactly the shape
 * `LoadLocalBackup`'s own chunked reader expects.
 * `decodeRisuSave`/`encodeRisuSaveLegacy` are the REAL `src/ts/storage/risuSave.ts`
 * functions, so the backup bytes this test builds and decodes are genuine.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from '../../storage/database.svelte'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => {}),
}))

const setDatabaseMock = vi.hoisted(() => vi.fn())
const duplicateFreeAtCall = vi.hoisted(() => ({ calls: [] as boolean[] }))

function hasNoDuplicateChaId(db: { characters?: { chaId?: string }[] } | undefined): boolean {
    const chaIds = (db?.characters ?? []).map((c) => c?.chaId)
    return new Set(chaIds).size === chaIds.length
}

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

const requiresFullEncoderReloadMock = vi.hoisted(() => ({ state: false }))
const forageSetItemMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock(import('../../globalApi.svelte'), () => ({
    LocalWriter: class {},
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: forageSetItemMock,
    },
    requiresFullEncoderReload: requiresFullEncoderReloadMock,
    dbWriteLock: { acquire: vi.fn(async () => vi.fn()) },
    // Granted immediately, standing in for "no other tab is open" -- this
    // suite is about chaId repair (MC-078), not the cross-tab guard, so a
    // caller reaching this export at all is not this file's concern.
    acquireExclusiveStorageMigrationLock: vi.fn(async () => (async () => {})),
    // `LoadLocalBackup()` imports `locksSupported` and `tabPresenceLockAcquired`
    // by name, and a module mock must provide every export its importers read.
    locksSupported: true,
    tabPresenceLockAcquired: Promise.resolve(),
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertStore: { set: vi.fn() },
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../characterCards'), () => ({
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../util'), () => ({
    decryptBuffer: vi.fn(),
    encryptBuffer: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: vi.fn(() => null),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
}) as unknown as typeof import('../../stores.svelte'))

//#endregion

import { LoadLocalBackup } from '../backuplocal'
import { forageStorage } from '../../globalApi.svelte'
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { injectAppStore } from '../../storage/store/appStore'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as CharacterFixture
}

/** Little-endian uint32, matching LoadLocalBackup's own chunk framing. */
function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` chunk, matching LoadLocalBackup's reader. */
function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBuf.length), offset); offset += 4
    out.set(nameBuf, offset); offset += nameBuf.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires; mirrors `asBuffer` in `src/ts/util.ts`. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

/** A real happy-dom `File` over `bytes`: LoadLocalBackup reads it through `.size`, `.slice()` (the marker walk) and `.stream()`. */
function makeFakeFile(bytes: Uint8Array): File {
    return new File([asBlobPart(bytes)], 'backup.bin')
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
const fetchMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
    setDatabaseMock.mockReset()
    forageSetItemMock.mockClear()
    // The restore writes the main file through the page's byte store; here it is the storage-object model above.
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
    requiresFullEncoderReloadMock.state = false
    duplicateFreeAtCall.calls.length = 0
    setDatabaseMock.mockImplementation((db: unknown) => {
        duplicateFreeAtCall.calls.push(hasNoDuplicateChaId(db as never))
    })

    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => ({ json: async () => ({ key: 'unused-test-key' }) }))
    vi.stubGlobal('fetch', fetchMock)

    capturedInput = null
    const realCreateElement = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
})

afterEach(() => {
    createElementSpy.mockRestore()
    vi.unstubAllGlobals()
})

/** Drives LoadLocalBackup() with `bytes` as the selected file's content, and awaits its onchange handler. */
async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    LoadLocalBackup()
    const input = capturedInput
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    const file = makeFakeFile(bytes)
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

describe('LoadLocalBackup repairs a duplicate or missing chaId before installing the restored database', () => {
    test('a decoded backup holding two characters with one chaId reaches setDatabase repaired', async () => {
        const charA = makeCharacter('dup-id', 'A from local backup')
        const charB = makeCharacter('dup-id', 'B from local backup')
        const backupDb = { characters: [charA, charB] } as unknown as Database
        const dbData = encodeRisuSaveLegacy(backupDb, 'noCompression')
        const bytes = buildChunk('database.risudat', dbData)

        await loadBackupBytes(bytes)

        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        const installed = setDatabaseMock.mock.calls[0][0] as Database
        expect(installed.characters.length).toBe(2)
        const chaIds = (installed.characters as CharacterFixture[]).map((c) => c.chaId)
        expect(new Set(chaIds).size).toBe(2)
        expect(requiresFullEncoderReloadMock.state).toBe(true)
    })

    test('setDatabase is called only after a duplicate chaId in the restored backup is already resolved', async () => {
        const charA = makeCharacter('dup-id-2', 'A from local backup')
        const charB = makeCharacter('dup-id-2', 'B from local backup')
        const backupDb = { characters: [charA, charB] } as unknown as Database
        const dbData = encodeRisuSaveLegacy(backupDb, 'noCompression')
        const bytes = buildChunk('database.risudat', dbData)

        await loadBackupBytes(bytes)

        // Recorded synchronously inside the setDatabase mock (see beforeEach),
        // at the moment setDatabase is called -- a repair that never ran, or
        // one that only ran after installation, both leave `false` here.
        expect(duplicateFreeAtCall.calls).toEqual([true])
    })
})
