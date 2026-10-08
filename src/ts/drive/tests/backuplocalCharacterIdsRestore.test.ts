// @vitest-environment happy-dom

/**
 * `LoadLocalBackup` (`src/ts/drive/backuplocal.ts`) makes the character list of
 * a restored backup one the save can hold before it installs it: entries that
 * are not characters are left out, a missing or unusable id is replaced with
 * the lists that named it following, and an archived character with an id that
 * cannot be saved takes back the id its unit records, or the restore is
 * refused by name and nothing changes.
 *
 * Drives the real `LoadLocalBackup` end to end over a hand-built backup byte
 * stream, as `backuplocalIdRepair.test.ts` does; the archived units are served
 * by a controllable `readColdStorageItem`.
 *
 * Title labels: (R) marks a reproducer that fails against a restore with no
 * repair; (G) marks a guard that passes with or without it.
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
const unitReader = vi.hoisted(() => vi.fn(async (_key: string): Promise<unknown> => ({ status: 'missing' })))
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

const alertErrorMock = vi.hoisted(() => vi.fn())
const alertNormalWaitMock = vi.hoisted(() => vi.fn(async (_message: string) => {}))
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
    alertError: alertErrorMock,
    alertNormalWait: alertNormalWaitMock,
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
    readColdStorageItem: unitReader,
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
import { language } from 'src/lang'
import { encodeRisuSaveLegacy } from '../../storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createForageBackedStore } from '../../storage/tests/forageBackedStore'
import { forageOverMap } from '../../storage/tests/appStoreMock'

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

/** A real happy-dom `File` over `bytes`: LoadLocalBackup reads it only through `.size` and `.slice()` (`slice().arrayBuffer()`: the entry walk, then one read per entry). */
function makeFakeFile(bytes: Uint8Array): File {
    return new File([asBlobPart(bytes)], 'backup.bin')
}

let capturedInput: HTMLInputElement | null = null
let createElementSpy: ReturnType<typeof vi.spyOn>
const fetchMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
    setDatabaseMock.mockReset()
    forageSetItemMock.mockClear()
    // The restore writes a block generation through the page's byte store; here it is an in-memory model on a desktop-kind page.
    injectRestoreStore(createForageBackedStore(forageOverMap(new Map())))
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

function backupOf(db: Record<string, unknown>): Uint8Array {
    return buildChunk('database.risudat', encodeRisuSaveLegacy(db as unknown as Database, 'noCompression'))
}

const stub = (chaId: unknown, name = 'Archived', unit = 'unit-1'): Record<string, unknown> => ({
    chaId, name, type: 'character', coldstorage: unit, chats: [], chatPage: 0,
})

function unitHolds(character: unknown): void {
    unitReader.mockImplementation(async () => ({ status: 'ok', value: { character } }))
}

function installed(): Database {
    return setDatabaseMock.mock.calls[0][0] as Database
}

beforeEach(() => {
    unitReader.mockReset().mockImplementation(async () => ({ status: 'missing' }))
    alertErrorMock.mockReset()
    alertNormalWaitMock.mockClear()
})

describe('an entry that is not a character (S9)', () => {
    test('(R) a number, null and a list in characters are left out of the installed database', async () => {
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), 5, null, [], makeCharacter('b', 'B')] }))

        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect((installed().characters as CharacterFixture[]).map((c) => c.chaId)).toEqual(['a', 'b'])
    })

    test('(G) a well-formed backup is installed with its characters unchanged', async () => {
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), makeCharacter('b', 'B')] }))

        expect((installed().characters as CharacterFixture[]).map((c) => c.chaId)).toEqual(['a', 'b'])
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})

describe('a character whose id cannot key a block (S9)', () => {
    test('(R) is installed with a new id, and the folder, the group, the loadout and its own speaker lines follow', async () => {
        const held = { ...makeCharacter('preset', 'Held'), chats: [{ id: 'c1', message: [{ role: 'char', data: 'hi', saying: 'preset' }, { role: 'user', data: 'yo', saying: 'preset' }] }] }
        await loadBackupBytes(backupOf({
            characters: [makeCharacter('a', 'A'), held, { chaId: 'g', name: 'Group', type: 'group', characters: ['a', 'preset'], chats: [] }],
            characterOrder: ['a', { id: 'F', name: 'F', data: ['preset'] }, 'g'],
            loadouts: [{ characterIds: ['preset'] }],
        }))

        const db = installed() as unknown as Record<string, unknown>
        const characters = db.characters as Array<Record<string, unknown>>
        const fresh = characters[1].chaId as string
        expect(fresh).not.toBe('preset')
        expect(characters[2].characters).toEqual(['a', fresh])
        expect(db.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: [fresh] }, 'g'])
        expect((db.loadouts as Array<{ characterIds: string[] }>)[0].characterIds).toEqual([fresh])
        const messages = (characters[1].chats as Array<{ message: Array<{ saying: string }> }>)[0].message
        expect(messages[0].saying).toBe(fresh)
        expect(messages[1].saying).toBe('preset')
    })
})

describe('an archived character with an id that cannot key a block (S9, D6, D8)', () => {
    test('(R) takes back the id its unit records, and the lists follow', async () => {
        unitHolds({ chaId: 'b', name: 'Real' })
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), stub('preset')], characterOrder: ['a', 'preset'] }))

        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        const db = installed() as unknown as Record<string, unknown>
        expect((db.characters as CharacterFixture[]).map((c) => c.chaId)).toEqual(['a', 'b'])
        expect(db.characterOrder).toEqual(['a', 'b'])
        expect(unitReader).toHaveBeenCalledWith('unit-1')
    })

    test.each([
        ['is missing', () => { unitReader.mockImplementation(async () => ({ status: 'missing' })) }],
        ['cannot be read', () => { unitReader.mockImplementation(async () => ({ status: 'error', error: new Error('unreadable') })) }],
        ['holds a list', () => unitHolds([])],
        ['holds a character with no id', () => unitHolds({ name: 'No id' })],
        ['holds an id that cannot be saved either', () => unitHolds({ chaId: 'config' })],
        ['holds an id another character has', () => unitHolds({ chaId: 'a' })],
    ])('(R) the restore is refused by name and nothing is installed when the unit %s', async (_label, arrange) => {
        arrange()
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), stub('preset', 'The Archived One')] }))

        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock.mock.calls[0][0]).toContain('The Archived One')
        expect(requiresFullEncoderReloadMock.state).toBe(false)
    })

    test('(G) an archived character with a usable id is never looked up, whatever its unit holds', async () => {
        unitHolds({ chaId: 'something-else' })
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), stub('mine')] }))

        expect((installed().characters as CharacterFixture[]).map((c) => c.chaId)).toEqual(['a', 'mine'])
        expect(unitReader).not.toHaveBeenCalled()
    })

    test('(R) a missing id takes the unit\'s id when the unit succeeds, and a new id, not a refusal, when it does not', async () => {
        unitHolds({ chaId: 'recovered' })
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), stub(undefined)] }))
        expect((installed().characters as CharacterFixture[]).map((c) => c.chaId)).toEqual(['a', 'recovered'])

        setDatabaseMock.mockClear()
        alertErrorMock.mockReset()
        unitReader.mockImplementation(async () => ({ status: 'missing' }))
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), stub('')] }))
        expect(alertErrorMock).not.toHaveBeenCalled()
        const ids = (installed().characters as CharacterFixture[]).map((c) => c.chaId)
        expect(ids[0]).toBe('a')
        expect(ids[1]).toMatch(/^[0-9a-f-]{36}$/)
    })
})

describe('a restore that repaired the character list says so once it has landed', () => {
    test('(R) a dropped entry is announced', async () => {
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), 5, makeCharacter('b', 'B')] }))

        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreRepairedNotice(1, 0, 0))
    })

    test('(R) a filled id and an id recovered from the archived data are announced together', async () => {
        unitHolds({ chaId: 'recovered' })
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), { ...makeCharacter('x', 'No id'), chaId: undefined }, stub('preset')] }))

        expect(alertNormalWaitMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).toHaveBeenCalledWith(language.restoreRepairedNotice(0, 1, 1))
    })

    test('(G) a clean restore shows no notice', async () => {
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), makeCharacter('b', 'B')] }))

        expect(setDatabaseMock).toHaveBeenCalledTimes(1)
        expect(alertNormalWaitMock).not.toHaveBeenCalled()
    })

    test('(G) a refused restore shows only the refusal, though entries were also dropped', async () => {
        await loadBackupBytes(backupOf({ characters: [makeCharacter('a', 'A'), 5, stub('preset', 'The Archived One')] }))

        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock.mock.calls[0][0]).toBe(language.restoreRefusedArchivedId('The Archived One'))
        expect(alertNormalWaitMock).not.toHaveBeenCalled()
    })
})