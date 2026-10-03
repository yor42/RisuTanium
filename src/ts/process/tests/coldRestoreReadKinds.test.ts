/**
 * What the user is told when an archived character cannot be read back, for the
 * read that cannot succeed here (no storage on the page) and the read whose
 * bytes do not decode (damaged), against the read that may succeed later.
 *
 * The real reader (`../coldstorage.svelte`, with the real fflate decoder), the
 * real restore (`../coldCharacterRestore`), the real plugin and MCP access
 * functions (`../coldCharacterAccess`) and the real group-turn restore
 * (`../coldMemberRestore`) run over stand-ins for the storage underneath (an
 * page byte store per platform, and for the web an OPFS `navigator.storage`
 * holding legacy unit files) and a mocked alert. A pass here says nothing about a real browser, Node server or Tauri
 * file system, and `v3.svelte.ts` and the MCP modules are not driven: they
 * call `readArchivedCharacter` and `restoreArchivedForWrite`, which are.
 *
 * Invariants pinned here:
 * - A refused restore says why in words that fit: no storage here, a copy that
 *   cannot be read and may be damaged, a read that may work later ("try
 *   again"), or the data-loss text for a missing, mismatched or shared unit.
 *   No message for a no-storage or damaged read claims the data may be lost or
 *   asks for a retry, and none for a plain read error claims loss.
 * - Only the message and the reported reason differ: the stub stays in its
 *   slot untouched, nothing is installed, formatted or marked for save, and the
 *   stored bytes are not deleted.
 * - The unnamed and the named wording follow the same reason, through the
 *   restore, the plugin and MCP read, the plugin, MCP and group add-member
 *   write, and the group turn. Restoring every archived character for a plugin
 *   keeps its neutral notice whatever the reason.
 *
 * Tests whose title starts with "guard:" protect wording and statuses that
 * hold whatever the kind of the read (the try-again text, the data-loss text,
 * the unreadable status); the others pin what is specific to a no-storage or
 * damaged read.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { compressSync } from 'fflate'

//#region module mocks

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    /** The page store's content on each platform: `coldstorage/<key>` (`coldstorage/<key>.json` on the desktop). */
    units: { node: new Map<string, Uint8Array>(), tauri: new Map<string, Uint8Array>(), web: new Map<string, Uint8Array>() },
    /** While set, the page store cannot be opened, as when the browser has no usable IndexedDB. */
    storeUnavailable: false,
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const platform = () => h.platform.isNodeServer ? 'node' : h.platform.isTauri ? 'tauri' : 'web'
    const store = createForageBackedStore({
        getItem: async (key) => h.units[platform()].get(key) ?? null,
        setItem: async (key, value) => { h.units[platform()].set(key, value) },
        keys: async () => Array.from(h.units[platform()].keys()),
        removeItem: async (key) => { h.units[platform()].delete(key) },
    })
    return {
        getAppStore: async () => {
            if (h.storeUnavailable) {
                throw Object.assign(new Error('IndexedDB is not available in this browser.'), { name: 'AppStoreUnavailableError' })
            }
            return store
        },
    } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
    waitAlert: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { readColdCharacterCopy, restoreColdCharacter, type ColdRestoreFailure } from '../coldCharacterRestore'
import { alertNamedRestoreFailure, readArchivedCharacter, restoreArchivedForWrite } from '../coldCharacterAccess'
import { restoreColdCharacterByChaId } from '../coldMemberRestore'
import { restoreAllColdCharacters } from '../coldRestoreAll'
import { getCharacterForRead, recheckCharacterForWrite } from '../mcp/risuaccess/utils'
import { alertError } from 'src/ts/alert'
import { characterFormatUpdate } from 'src/ts/characters'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { DBState } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import type { Database, character } from 'src/ts/storage/database.svelte'

//#region stand-ins and fixtures

type Backend = 'opfs' | 'node' | 'tauri'
const BACKENDS: Backend[] = ['opfs', 'node', 'tauri']

class StandInNotFoundError extends Error {
    name = 'NotFoundError'
}

class StandInSecurityError extends Error {
    name = 'SecurityError'
}

class StandInNotReadableError extends Error {
    name = 'NotReadableError'
}

const opfsFiles = new Map<string, Uint8Array>()
let opfsFailure: Error | null = null

const opfsDirectory = {
    async getFileHandle(name: string) {
        if (opfsFailure) {
            throw opfsFailure
        }
        const bytes = opfsFiles.get(name)
        if (!bytes) {
            throw new StandInNotFoundError(`not found: ${name}`)
        }
        return {
            async getFile() {
                return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }
            },
        }
    },
}

const opfsStorage = { getDirectory: async () => opfsDirectory }

async function withNavigatorStorage<T>(storage: unknown, run: () => Promise<T>): Promise<T> {
    const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
    Object.defineProperty(navigator, 'storage', { configurable: true, value: storage })
    try {
        return await run()
    } finally {
        if (original) {
            Object.defineProperty(navigator, 'storage', original)
        } else {
            Reflect.deleteProperty(navigator, 'storage')
        }
    }
}

function selectBackend(backend: Backend): void {
    h.platform.isNodeServer = backend === 'node'
    h.platform.isTauri = backend === 'tauri'
}

/** Runs `run` while the page store cannot be opened. */
async function withStoreUnavailable<T>(run: () => Promise<T>): Promise<T> {
    h.storeUnavailable = true
    try {
        return await run()
    } finally {
        h.storeUnavailable = false
    }
}

/** Places a unit where the backend keeps it: the OPFS backend is a legacy unit file, the others the page store. */
function putBytes(backend: Backend, key: string, bytes: Uint8Array): void {
    if (backend === 'opfs') {
        opfsFiles.set('coldstorage_' + key + '.json', bytes)
    } else if (backend === 'node') {
        h.units.node.set('coldstorage/' + key, bytes)
    } else {
        h.units.tauri.set('coldstorage/' + key + '.json', bytes)
    }
}

function hasBytes(backend: Backend, key: string): boolean {
    if (backend === 'opfs') {
        return opfsFiles.has('coldstorage_' + key + '.json')
    }
    return backend === 'node' ? h.units.node.has('coldstorage/' + key) : h.units.tauri.has('coldstorage/' + key + '.json')
}

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

const LARGE_CHARACTER = { character: { chaId: 'member', name: 'Member', type: 'character', chats: [], desc: 'description '.repeat(400) } }

const DAMAGED_BYTES: Array<[string, () => Uint8Array]> = [
    ['a truncated compressed stream', () => { const whole = encodeUnit(LARGE_CHARACTER); return whole.slice(0, Math.floor(whole.length / 2)) }],
    ['bytes that are not compressed data', () => new Uint8Array([1, 2, 3, 4])],
    ['valid compression holding invalid JSON', () => compressSync(new TextEncoder().encode('{not valid json'))],
]

const UNIT = 'cold-key-member'
const NAME = 'Member Name'

function placeholder(chaId = 'member', key = UNIT, name = NAME): character {
    return {
        type: 'character',
        name,
        chaId,
        chats: [{ id: `${chaId}-placeholder-chat`, message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldstorage: key,
        coldStoragedChats: [],
    } as unknown as character
}

function installDb(characters: character[]): void {
    DBState.db = { characters } as unknown as Database
}

function slot(index: number): character {
    return DBState.db.characters[index] as unknown as character
}

function alerts(): string[] {
    return vi.mocked(alertError).mock.calls.map((args) => String(args[0]))
}

const TRY_AGAIN = /try again/i
const LOSS = /lost|permanently|missing or invalid/i
const NO_STORAGE_WORDING = /offers no storage/i
const DAMAGED_WORDING = /may be damaged/i

/** The wording for a page with no storage: it says so, asks for no retry and claims no loss. */
function expectNoStorageWording(text: string): void {
    expect(text).not.toMatch(TRY_AGAIN)
    expect(text).not.toMatch(LOSS)
    expect(text).toMatch(NO_STORAGE_WORDING)
}

/** The wording for a copy that cannot be read: it says it may be damaged, asks for no retry and claims no loss. */
function expectDamagedWording(text: string): void {
    expect(text).not.toMatch(TRY_AGAIN)
    expect(text).not.toMatch(LOSS)
    expect(text).toMatch(DAMAGED_WORDING)
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    selectBackend('opfs')
    opfsFiles.clear()
    opfsFailure = null
    for (const platform of ['node', 'tauri', 'web'] as const) {
        h.units[platform].clear()
    }
    h.storeUnavailable = false
    Object.defineProperty(navigator, 'storage', { configurable: true, value: opfsStorage })
    vi.mocked(alertError).mockClear()
    vi.mocked(characterFormatUpdate).mockClear()
    vi.mocked(markCharacterForSave).mockClear()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    consoleErrorSpy.mockRestore()
})

/** Every way the storage can be absent on this page: the page store cannot be opened. */
const NO_STORAGE: Array<[string]> = [
    ['the page store unavailable'],
]

/** The stub is where it was, still an archived placeholder, and nothing was installed, formatted or marked for save. */
function expectStubUntouched(stub: character): void {
    expect(DBState.db.characters).toHaveLength(1)
    expect(slot(0)).toBe(stub)
    expect(stub.coldstorage).toBe(UNIT)
    expect(stub.name).toBe(NAME)
    expect(vi.mocked(characterFormatUpdate)).not.toHaveBeenCalled()
    expect(vi.mocked(markCharacterForSave)).not.toHaveBeenCalled()
}

//#endregion

describe('opening an archived character with no storage on the page', () => {
    test.each(NO_STORAGE)('with %s the restore is refused as unavailable and says so, without claiming loss or asking for a retry', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, encodeUnit(LARGE_CHARACTER))

        const outcome = await withStoreUnavailable(() => restoreColdCharacter(stub))

        expect(outcome).toEqual({ status: 'refused', reason: 'unavailable' })
        expect(alerts()).toHaveLength(1)
        expectNoStorageWording(alerts()[0])
        expect(alerts()[0]).toBe(language.errors.coldStorageRestoreUnavailable)
        expectStubUntouched(stub)
        expect(hasBytes('opfs', UNIT)).toBe(true)
    })

    test('a quiet restore reports the reason and shows nothing', async () => {
        const stub = placeholder()
        installDb([stub])

        const outcome = await withStoreUnavailable(() => restoreColdCharacter(stub, { quiet: true }))

        expect(outcome).toEqual({ status: 'refused', reason: 'unavailable' })
        expect(alerts()).toEqual([])
        expectStubUntouched(stub)
    })

    test('the same refusal holds when the stub is found by its chaId after the read', async () => {
        const stub = placeholder()
        installDb([stub])

        const outcome = await withStoreUnavailable(() => restoreColdCharacter(stub, { byChaId: true }))

        expect(outcome).toEqual({ status: 'refused', reason: 'unavailable' })
        expect(alerts()).toHaveLength(1)
        expectNoStorageWording(alerts()[0])
        expect(alerts()).toEqual([language.errors.coldStorageRestoreUnavailable])
    })

    test('reading the archived character as a copy reports status unreadable with kind unavailable and installs nothing', async () => {
        const stub = placeholder()
        installDb([stub])

        const copy = await withStoreUnavailable(() => readColdCharacterCopy(stub))

        expect(copy).toMatchObject({ status: 'unreadable', kind: 'unavailable' })
        expect(alerts()).toEqual([])
        expectStubUntouched(stub)
    })

    test('guard: the copy of a no-storage read keeps the status unreadable that its consumers branch on', async () => {
        const stub = placeholder()
        installDb([stub])

        const copy = await withStoreUnavailable(() => readColdCharacterCopy(stub))

        expect(copy.status).toBe('unreadable')
        expect(copy).toHaveProperty('error')
    })
})

describe('opening an archived character whose copy does not decode', () => {
    for (const backend of BACKENDS) {
        test.each(DAMAGED_BYTES)(`on ${backend}: %s refuses the restore as damaged, says the copy may be damaged, and deletes nothing`, async (_label, makeBytes) => {
            selectBackend(backend)
            const stub = placeholder()
            installDb([stub])
            putBytes(backend, UNIT, makeBytes())

            const outcome = await restoreColdCharacter(stub)

            expect(outcome).toEqual({ status: 'refused', reason: 'damaged' })
            expect(alerts()).toHaveLength(1)
            expectDamagedWording(alerts()[0])
            expect(alerts()[0]).toBe(language.errors.coldStorageRestoreDamaged)
            expectStubUntouched(stub)
            expect(hasBytes(backend, UNIT)).toBe(true)
        })
    }

    test('a quiet restore reports the reason and shows nothing', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, new Uint8Array([1, 2, 3, 4]))

        const outcome = await restoreColdCharacter(stub, { quiet: true })

        expect(outcome).toEqual({ status: 'refused', reason: 'damaged' })
        expect(alerts()).toEqual([])
    })

    test('reading the archived character as a copy reports status unreadable with kind damaged and installs nothing', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, new Uint8Array([1, 2, 3, 4]))

        const copy = await readColdCharacterCopy(stub)

        expect(copy).toMatchObject({ status: 'unreadable', kind: 'damaged' })
        expect(alerts()).toEqual([])
        expectStubUntouched(stub)
    })

    test('guard: the copy of a damaged read keeps the status unreadable that its consumers branch on', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, new Uint8Array([1, 2, 3, 4]))

        const copy = await readColdCharacterCopy(stub)

        expect(copy.status).toBe('unreadable')
        expect(copy).toHaveProperty('error')
    })
})

describe('guard: a read that may work later keeps the retry wording, and the other refusals keep the data-loss wording', () => {
    test('guard: a getDirectory that rejects is unreadable and asks to try again', async () => {
        const stub = placeholder()
        installDb([stub])
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        const outcome = await withNavigatorStorage(rejecting, () => restoreColdCharacter(stub))

        expect(outcome).toEqual({ status: 'refused', reason: 'unreadable' })
        expect(alerts()).toEqual([language.errors.coldStorageRestoreUnreadable])
        expect(alerts()[0]).toMatch(TRY_AGAIN)
        expect(alerts()[0]).not.toMatch(LOSS)
        expectStubUntouched(stub)
    })

    test('guard: a file that cannot be read is unreadable and asks to try again', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, encodeUnit(LARGE_CHARACTER))
        opfsFailure = new StandInNotReadableError('the file could not be read')

        const outcome = await restoreColdCharacter(stub)

        expect(outcome).toEqual({ status: 'refused', reason: 'unreadable' })
        expect(alerts()).toEqual([language.errors.coldStorageRestoreUnreadable])
    })

    test.each(['node', 'tauri'] as const)('guard: with navigator.storage removed a good %s unit still restores', async (backend) => {
        selectBackend(backend)
        const stub = placeholder()
        installDb([stub])
        putBytes(backend, UNIT, encodeUnit(LARGE_CHARACTER))

        const outcome = await withNavigatorStorage(undefined, () => restoreColdCharacter(stub))

        expect(outcome.status).toBe('restored')
        expect(alerts()).toEqual([])
    })

    test('guard: a missing unit is refused as missing with the data-loss text', async () => {
        const stub = placeholder()
        installDb([stub])

        const outcome = await restoreColdCharacter(stub)

        expect(outcome).toEqual({ status: 'refused', reason: 'missing' })
        expect(alerts()).toEqual([language.errors.coldStorageRestoreFailed])
        expect(alerts()[0]).toMatch(LOSS)
    })

    test('guard: a unit holding another character is refused as mismatch with the data-loss text', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, encodeUnit({ character: { chaId: 'someone-else', name: 'Else', type: 'character', chats: [] } }))

        const outcome = await restoreColdCharacter(stub)

        expect(outcome).toEqual({ status: 'refused', reason: 'mismatch' })
        expect(alerts()).toEqual([language.errors.coldStorageRestoreFailed])
    })

    test('guard: a unit that decodes but holds no character is refused as missing with the data-loss text', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, encodeUnit({ somethingElse: true }))

        const outcome = await restoreColdCharacter(stub)

        expect(outcome).toEqual({ status: 'refused', reason: 'missing' })
        expect(alerts()).toEqual([language.errors.coldStorageRestoreFailed])
    })

    test('guard: a chaId held by two characters is refused as ambiguous with the data-loss text', async () => {
        const first = placeholder('member', 'cold-key-a')
        const second = placeholder('member', 'cold-key-b')
        installDb([first, second])
        putBytes('opfs', 'cold-key-a', encodeUnit(LARGE_CHARACTER))

        const outcome = await restoreColdCharacter(first, { byChaId: true })

        expect(outcome).toEqual({ status: 'refused', reason: 'ambiguous' })
        expect(alerts()).toEqual([language.errors.coldStorageRestoreFailed])
    })

    test('guard: the copy of a plain read error is status unreadable with no kind', async () => {
        const stub = placeholder()
        installDb([stub])
        opfsFailure = new StandInNotReadableError('the file could not be read')

        const copy = await readColdCharacterCopy(stub)

        expect(copy.status).toBe('unreadable')
        expect((copy as { kind?: unknown }).kind).toBeUndefined()
    })
})

describe('the named wording for a plugin or MCP read of an archived character', () => {
    test.each(NO_STORAGE)('with %s the read fails with the named no-storage text, shown once', async () => {
        const stub = placeholder()
        installDb([stub])

        const result = await withStoreUnavailable(() => readArchivedCharacter(stub))

        expect(result.status).toBe('failed')
        const message = (result as { message: string }).message
        expectNoStorageWording(message)
        expect(message).toContain(NAME)
        expect(message).toBe(language.errors.coldStorageNamedRestoreUnavailable(NAME))
        expect(alerts()).toEqual([message])
        expectStubUntouched(stub)
    })

    test.each(DAMAGED_BYTES)('%s fails with the named damaged text, shown once', async (_label, makeBytes) => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, makeBytes())

        const result = await readArchivedCharacter(stub)

        expect(result.status).toBe('failed')
        const message = (result as { message: string }).message
        expectDamagedWording(message)
        expect(message).toContain(NAME)
        expect(message).toBe(language.errors.coldStorageNamedRestoreDamaged(NAME))
        expect(alerts()).toEqual([message])
        expectStubUntouched(stub)
        expect(hasBytes('opfs', UNIT)).toBe(true)
    })

    test('guard: a getDirectory that rejects fails with the named try-again text', async () => {
        const stub = placeholder()
        installDb([stub])
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        const result = await withNavigatorStorage(rejecting, () => readArchivedCharacter(stub))

        expect(result).toEqual({ status: 'failed', message: language.errors.coldStorageNamedRestoreUnreadable(NAME) })
        expect((result as { message: string }).message).toMatch(TRY_AGAIN)
    })

    test('guard: a missing unit fails with the named data-loss text', async () => {
        const stub = placeholder()
        installDb([stub])

        const result = await readArchivedCharacter(stub)

        expect(result).toEqual({ status: 'failed', message: language.errors.coldStorageNamedRestoreFailed(NAME) })
    })

    test('guard: a stub with no name is named by the unknown-character text', async () => {
        const stub = placeholder('member', UNIT, '')
        installDb([stub])

        const result = await withStoreUnavailable(() => readArchivedCharacter(stub))

        expect((result as { message: string }).message).toContain(language.errors.coldStorageUnknownCharacterName)
    })
})

describe('the named wording for a plugin, MCP or group add-member write to an archived character', () => {
    test.each(NO_STORAGE)('with %s the restore for a write fails with the named no-storage text and leaves the stub', async () => {
        const stub = placeholder()
        installDb([stub])

        const result = await withStoreUnavailable(() => restoreArchivedForWrite('member'))

        expect(result.status).toBe('failed')
        expectNoStorageWording((result as { message: string }).message)
        expect(result).toEqual({ status: 'failed', message: language.errors.coldStorageNamedRestoreUnavailable(NAME) })
        expect(alerts()).toEqual([language.errors.coldStorageNamedRestoreUnavailable(NAME)])
        expectStubUntouched(stub)
    })

    test.each(DAMAGED_BYTES)('%s fails the restore for a write with the named damaged text and leaves the stub', async (_label, makeBytes) => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, makeBytes())

        const result = await restoreArchivedForWrite('member')

        expect(result.status).toBe('failed')
        expectDamagedWording((result as { message: string }).message)
        expect(result).toEqual({ status: 'failed', message: language.errors.coldStorageNamedRestoreDamaged(NAME) })
        expect(alerts()).toEqual([language.errors.coldStorageNamedRestoreDamaged(NAME)])
        expectStubUntouched(stub)
    })

    test('guard: a getDirectory that rejects fails the restore for a write with the named try-again text', async () => {
        const stub = placeholder()
        installDb([stub])
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        const result = await withNavigatorStorage(rejecting, () => restoreArchivedForWrite('member'))

        expect(result).toEqual({ status: 'failed', message: language.errors.coldStorageNamedRestoreUnreadable(NAME) })
    })

    test('guard: a character that is already full is returned without a read', async () => {
        const full = { ...placeholder(), coldstorage: undefined } as unknown as character
        installDb([full])

        const result = await withNavigatorStorage(undefined, () => restoreArchivedForWrite('member'))

        expect(result).toEqual({ status: 'ready', character: full, index: 0 })
        expect(alerts()).toEqual([])
    })
})

describe('the named wording when a group turn restores an archived member', () => {
    test.each(NO_STORAGE)('with %s the member is not restored, the named no-storage text is shown once and the stub stays', async () => {
        const stub = placeholder()
        installDb([stub])

        const restored = await withStoreUnavailable(() => restoreColdCharacterByChaId('member'))

        expect(restored).toBe(false)
        expect(alerts()).toHaveLength(1)
        expectNoStorageWording(alerts()[0])
        expect(alerts()).toEqual([language.errors.coldStorageNamedRestoreUnavailable(NAME)])
        expectStubUntouched(stub)
    })

    test.each(DAMAGED_BYTES)('%s: the member is not restored, the named damaged text is shown once and the stub stays', async (_label, makeBytes) => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, makeBytes())

        const restored = await restoreColdCharacterByChaId('member')

        expect(restored).toBe(false)
        expect(alerts()).toHaveLength(1)
        expectDamagedWording(alerts()[0])
        expect(alerts()).toEqual([language.errors.coldStorageNamedRestoreDamaged(NAME)])
        expectStubUntouched(stub)
    })

    test('guard: a getDirectory that rejects shows the named try-again text once', async () => {
        const stub = placeholder()
        installDb([stub])
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        const restored = await withNavigatorStorage(rejecting, () => restoreColdCharacterByChaId('member'))

        expect(restored).toBe(false)
        expect(alerts()).toEqual([language.errors.coldStorageNamedRestoreUnreadable(NAME)])
    })
})

describe('the MCP tools report the named wording when an archived character cannot be read or restored', () => {
    function toolContext(): Parameters<typeof recheckCharacterForWrite>[1] {
        return { subject: undefined, touched: new Set<string>() } as unknown as Parameters<typeof recheckCharacterForWrite>[1]
    }

    test.each(NO_STORAGE)('with %s a read tool throws the named no-storage text and the stub stays', async () => {
        const stub = placeholder()
        installDb([stub])

        const failure = await withStoreUnavailable(() => getCharacterForRead('member')).then(() => null, (error: unknown) => error as Error)

        expect(failure).toBeInstanceOf(Error)
        expectNoStorageWording((failure as Error).message)
        expect((failure as Error).message).toBe(language.errors.coldStorageNamedRestoreUnavailable(NAME))
        expectStubUntouched(stub)
    })

    test('a read tool throws the named damaged text for a copy that does not decode', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, new Uint8Array([1, 2, 3, 4]))

        const failure = await getCharacterForRead('member').then(() => null, (error: unknown) => error as Error)

        expect(failure).toBeInstanceOf(Error)
        expectDamagedWording((failure as Error).message)
        expect((failure as Error).message).toBe(language.errors.coldStorageNamedRestoreDamaged(NAME))
        expectStubUntouched(stub)
    })

    test('guard: a read tool throws the named try-again text when getDirectory rejects', async () => {
        const stub = placeholder()
        installDb([stub])
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        await expect(withNavigatorStorage(rejecting, () => getCharacterForRead('member'))).rejects.toThrow(language.errors.coldStorageNamedRestoreUnreadable(NAME))
    })

    test('a write tool throws the named no-storage text, leaves the stub and records nothing', async () => {
        const stub = placeholder()
        installDb([stub])
        const ctx = toolContext()

        const write = withStoreUnavailable(() => recheckCharacterForWrite('member', ctx, stub))

        await expect(write).rejects.toThrow(/offers no storage/i)
        expect(ctx.touched.size).toBe(0)
        expectStubUntouched(stub)
    })

    test('a write tool throws the named damaged text, leaves the stub and records nothing', async () => {
        const stub = placeholder()
        installDb([stub])
        putBytes('opfs', UNIT, new Uint8Array([1, 2, 3, 4]))
        const ctx = toolContext()

        await expect(recheckCharacterForWrite('member', ctx, stub)).rejects.toThrow(/may be damaged/i)
        expect(ctx.touched.size).toBe(0)
        expectStubUntouched(stub)
    })
})

describe('the message chosen for every restore failure reason', () => {
    type NamedExpectation = [ColdRestoreFailure, RegExp, () => string]
    const GUARDED_EXPECTATIONS: NamedExpectation[] = [
        ['missing', /permanently lost/i, () => language.errors.coldStorageNamedRestoreFailed(NAME)],
        ['mismatch', /permanently lost/i, () => language.errors.coldStorageNamedRestoreFailed(NAME)],
        ['ambiguous', /permanently lost/i, () => language.errors.coldStorageNamedRestoreFailed(NAME)],
        ['unreadable', TRY_AGAIN, () => language.errors.coldStorageNamedRestoreUnreadable(NAME)],
    ]
    const KIND_EXPECTATIONS: NamedExpectation[] = [
        ['unavailable', NO_STORAGE_WORDING, () => language.errors.coldStorageNamedRestoreUnavailable(NAME)],
        ['damaged', DAMAGED_WORDING, () => language.errors.coldStorageNamedRestoreDamaged(NAME)],
    ]
    const NAMED_EXPECTATIONS: NamedExpectation[] = [...GUARDED_EXPECTATIONS, ...KIND_EXPECTATIONS]

    test.each(GUARDED_EXPECTATIONS)('guard: the named alert for %s shows its own text and returns it', (reason, wording, expected) => {
        const failure = alertNamedRestoreFailure(placeholder(), reason)

        expect(failure.message).toMatch(wording)
        expect(failure).toEqual({ status: 'failed', message: expected() })
        expect(alerts()).toEqual([expected()])
    })

    test.each(KIND_EXPECTATIONS)('the named alert for %s shows its own text and returns it', (reason, wording, expected) => {
        const failure = alertNamedRestoreFailure(placeholder(), reason)

        expect(failure.message).toMatch(wording)
        expect(failure).toEqual({ status: 'failed', message: expected() })
        expect(alerts()).toEqual([expected()])
    })

    /** Every reason the union has: a reason added to the union fails the type check here until it is listed. */
    const EVERY_REASON = { missing: true, unreadable: true, unavailable: true, damaged: true, mismatch: true, ambiguous: true } satisfies Record<ColdRestoreFailure, true>
    const LOSS_REASONS: ColdRestoreFailure[] = ['missing', 'mismatch', 'ambiguous']

    test('no reason reaches the data-loss text by default: only missing, mismatch and ambiguous claim loss', () => {
        for (const reason of Object.keys(EVERY_REASON) as ColdRestoreFailure[]) {
            const { message } = alertNamedRestoreFailure(placeholder(), reason)

            expect(/permanently lost/i.test(message), `${reason} claims loss`).toBe(LOSS_REASONS.includes(reason))
        }
    })

    test('the six reasons produce exactly four distinct named texts, and only missing, mismatch and ambiguous share the data-loss text', () => {
        const texts = new Map<ColdRestoreFailure, string>()
        for (const [reason] of NAMED_EXPECTATIONS) {
            texts.set(reason, alertNamedRestoreFailure(placeholder(), reason).message)
        }

        expect(new Set(texts.values()).size).toBe(4)
        for (const [reason, text] of texts) {
            const claimsLoss = /permanently lost/i.test(text)
            expect(claimsLoss, `${reason} claims loss`).toBe(reason === 'missing' || reason === 'mismatch' || reason === 'ambiguous')
        }
    })
})

describe('restoring every archived character for a plugin keeps its neutral notice', () => {
    test.each(NO_STORAGE)('guard: with %s the characters stay archived and one notice names them, whatever the reason', async () => {
        const first = placeholder('first', 'cold-key-first', 'First')
        const second = placeholder('second', 'cold-key-second', 'Second')
        installDb([first, second])

        await withStoreUnavailable(() => restoreAllColdCharacters())

        expect(alerts()).toEqual([language.errors.coldStoragePluginRestoreIncomplete('First, Second')])
        expect(slot(0)).toBe(first)
        expect(slot(1)).toBe(second)
        expect(first.coldstorage).toBe('cold-key-first')
        expect(second.coldstorage).toBe('cold-key-second')
    })

    test('guard: damaged copies stay archived and one notice names them, whatever the reason', async () => {
        const first = placeholder('first', 'cold-key-first', 'First')
        const second = placeholder('second', 'cold-key-second', 'Second')
        installDb([first, second])
        putBytes('opfs', 'cold-key-first', new Uint8Array([1, 2, 3, 4]))
        putBytes('opfs', 'cold-key-second', compressSync(new TextEncoder().encode('{not valid json')))

        await restoreAllColdCharacters()

        expect(alerts()).toEqual([language.errors.coldStoragePluginRestoreIncomplete('First, Second')])
        expect(first.coldstorage).toBe('cold-key-first')
        expect(second.coldstorage).toBe('cold-key-second')
    })
})
