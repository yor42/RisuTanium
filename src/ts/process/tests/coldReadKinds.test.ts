/**
 * Telling an archived read that cannot succeed here apart from one that may
 * succeed later: `readColdStorageItem`, `preLoadChat` and
 * `retryLegacyColdChatLoad` in `../coldstorage.svelte`, run for real over the
 * real fflate decoder, with only the storage underneath replaced by stand-ins
 * (an OPFS `navigator.storage`, a Node `getItem`, a Tauri `readFile`). A pass
 * here says nothing about a real browser, Node server or Tauri file system.
 *
 * Invariants pinned here:
 * - A read stays `status: 'error'` whatever its cause; the cause travels
 *   beside it as `kind`. `'unavailable'` is set only on the OPFS branch, only
 *   when `navigator.storage` or its `getDirectory` function does not exist.
 *   `getDirectory` that exists and rejects is a plain read error, and the Node
 *   and Tauri branches never look at `navigator.storage`.
 * - `kind: 'damaged'` is set when the bytes were obtained but do not decode:
 *   truncated or garbage compression, valid compression holding invalid JSON,
 *   or, on the browser-storage and desktop paths, nothing at all. The Node
 *   storage reads an empty body as an absent unit, so there it is missing.
 * - `preLoadChat` and `retryLegacyColdChatLoad` resolve `'unavailable'` or
 *   `'damaged'` for those reads, and `'damaged'` for a decoded value that is
 *   not a chat. A plain read error stays `'error'`, a missing unit `'missing'`.
 *   None of them mutates the chat or rejects. The legacy side-field merge
 *   failure stays `'error'`: the merge can fail from the live chat as well.
 * - `collectColdStorageBackupPayloads` takes the same branch for a no-storage,
 *   a damaged and a plain-error read of the same unit.
 * - A key that cannot become a storage name (`isSafeColdStorageKey`) reads as
 *   an error of kind `damaged` on every backend, even where the backend would
 *   report the spliced name as absent (a `/` on Tauri, an over-long name on
 *   the Node server). The key rule itself is pinned in
 *   `coldStorageKeyRule.test.ts`.
 *
 * Tests whose title starts with "guard:" protect behaviour that holds whatever
 * the kind of the read (status, untouched chat, left-out unit); the others pin
 * the kind itself and what is shown for it.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import { compressSync } from 'fflate'

//#region module mocks

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    node: new Map<string, Uint8Array>(),
    nodeFailure: null as Error | null,
    tauri: new Map<string, Uint8Array>(),
    tauriFailure: null as Error | null,
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        realStorage: {
            getItem: async (key: string) => {
                if (h.nodeFailure) {
                    throw h.nodeFailure
                }
                // The real server answers a file name longer than the file
                // system allows (the key travels hex-encoded, 255 bytes at
                // most) with an empty 200, exactly as it does for a name that
                // is absent.
                if (new TextEncoder().encode(key).length * 2 > 255) {
                    return null
                }
                const bytes = h.node.get(key)
                return bytes && bytes.length > 0 ? bytes : null
            },
        },
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: async (path: string) => {
        if (h.tauriFailure) {
            throw h.tauriFailure
        }
        const bytes = h.tauri.get(path)
        if (!bytes) {
            throw new Error(`No such file or directory (os error 2): ${path}`)
        }
        return bytes
    },
    exists: async (path: string) => h.tauri.has(path),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

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
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import {
    collectColdStorageBackupPayloads,
    coldStorageHeader,
    preLoadChat,
    readColdStorageItem,
    retryLegacyColdChatLoad,
} from '../coldstorage.svelte'
import { formatColdStorageLoadError } from '../coldstorageData'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'

//#region stand-ins and fixtures

type Backend = 'opfs' | 'node' | 'tauri'
const BACKENDS: Backend[] = ['opfs', 'node', 'tauri']

class StandInNotFoundError extends Error {
    name = 'NotFoundError'
}

class StandInNotReadableError extends Error {
    name = 'NotReadableError'
}

class StandInSecurityError extends Error {
    name = 'SecurityError'
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

/**
 * Runs `run` with `navigator.storage` set to `storage` (`undefined` removes it
 * for the reader) and puts the previous own property back afterwards.
 */
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

function putBytes(backend: Backend, key: string, bytes: Uint8Array): void {
    if (backend === 'opfs') {
        opfsFiles.set('coldstorage_' + key + '.json', bytes)
    } else if (backend === 'node') {
        h.node.set('coldstorage/' + key, bytes)
    } else {
        h.tauri.set('./coldstorage/' + key + '.json', bytes)
    }
}

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

const LARGE_UNIT = { message: [{ time: 1, data: 'archived text '.repeat(400), role: 'user' }], localLore: [] }

const EMPTY_UNIT_LABEL = 'no bytes at all'

/** Bytes that are not a usable unit, by how they fail. */
const DAMAGED_BYTES: Array<[string, () => Uint8Array]> = [
    ['a truncated compressed stream', () => { const whole = encodeUnit(LARGE_UNIT); return whole.slice(0, Math.floor(whole.length / 2)) }],
    ['bytes that are not compressed data', () => new Uint8Array([1, 2, 3, 4])],
    ['valid compression holding invalid JSON', () => compressSync(new TextEncoder().encode('{not valid json'))],
    [EMPTY_UNIT_LABEL, () => new Uint8Array(0)],
]

/** The fixtures a backend can hand the reader as stored bytes: the Node storage never returns an empty body. */
function damagedBytesFor(backend: Backend): Array<[string, () => Uint8Array]> {
    return backend === 'node' ? DAMAGED_BYTES.filter(([label]) => label !== EMPTY_UNIT_LABEL) : DAMAGED_BYTES
}

type ReadResult = Awaited<ReturnType<typeof readColdStorageItem>>

function kindOf(result: ReadResult): unknown {
    return result.status === 'error' ? (result as { kind?: unknown }).kind : undefined
}

type Chat = { id: string, message: Array<{ time: number, data: string, role: string }>, note: string, name: string, localLore: unknown[], isStreaming?: boolean, hypaV2Data?: unknown, hypaV3Data?: unknown, scriptstate?: unknown, lastDate?: number }

function pointerChat(key: string): Chat {
    return { id: 'chat-0', message: [{ time: 1, data: coldStorageHeader + key, role: 'char' }], note: '', name: '', localLore: [] }
}

function errorTextChat(key: string): Chat {
    return { id: 'chat-0', message: [{ time: 1, data: formatColdStorageLoadError(key), role: 'char' }], note: '', name: '', localLore: [] }
}

function installChat(chat: Chat): Chat {
    DBState.db = { characters: [{ chaId: 'cha-1', name: 'Alice', type: 'character', chatPage: 0, chats: [chat] }] } as unknown as Database
    selectedCharID.set(0)
    return chat
}

function snapshot(chat: Chat): string {
    return JSON.stringify(chat)
}

const GOOD_CHAT_UNIT = {
    message: [{ time: 1, data: 'archived', role: 'user' }],
    hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
    hypaV3Data: { summaries: [] },
    scriptstate: {},
    localLore: [],
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    selectBackend('opfs')
    opfsFiles.clear()
    opfsFailure = null
    h.node.clear()
    h.nodeFailure = null
    h.tauri.clear()
    h.tauriFailure = null
    Object.defineProperty(navigator, 'storage', { configurable: true, value: opfsStorage })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    consoleErrorSpy.mockRestore()
    selectedCharID.set(-1)
})

//#endregion

describe('a read on a page with no storage for archived data', () => {
    test('with navigator.storage removed the read is an error of kind unavailable', async () => {
        const result = await withNavigatorStorage(undefined, () => readColdStorageItem('any-key'))

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('unavailable')
    })

    test('with navigator.storage present but without getDirectory the read is an error of kind unavailable', async () => {
        const result = await withNavigatorStorage({}, () => readColdStorageItem('any-key'))

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('unavailable')
    })

    test('with getDirectory present but not a function the read is an error of kind unavailable', async () => {
        const result = await withNavigatorStorage({ getDirectory: 'not a function' }, () => readColdStorageItem('any-key'))

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('unavailable')
    })

    test('guard: the no-storage read stays status error, never missing and never ok', async () => {
        const result = await withNavigatorStorage(undefined, () => readColdStorageItem('any-key'))

        expect(result.status).toBe('error')
        expect(result.status).not.toBe('missing')
        expect(result).toHaveProperty('error')
    })

    test('guard: a getDirectory that exists and rejects is a plain read error with no kind', async () => {
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        const result = await withNavigatorStorage(rejecting, () => readColdStorageItem('any-key'))

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBeUndefined()
    })

    test.each(['node', 'tauri'] as const)('guard: the %s backend reads without navigator.storage and never reports the page as having no storage', async (backend) => {
        selectBackend(backend)
        putBytes(backend, 'unit-key', encodeUnit({ character: { chaId: 'a' } }))

        const result = await withNavigatorStorage(undefined, () => readColdStorageItem('unit-key'))

        expect(result).toEqual({ status: 'ok', value: { character: { chaId: 'a' } } })
    })

    test.each(['node', 'tauri'] as const)('guard: a failing %s read with navigator.storage removed is a plain read error with no kind', async (backend) => {
        selectBackend(backend)
        h.nodeFailure = new Error('server answered 500')
        h.tauriFailure = new Error('permission denied')

        const result = await withNavigatorStorage(undefined, () => readColdStorageItem('unit-key'))

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBeUndefined()
    })

    test('guard: with storage present an absent file is missing and a stored unit is ok', async () => {
        opfsFiles.set('coldstorage_stored.json', encodeUnit({ character: { chaId: 'a' } }))

        expect(await readColdStorageItem('absent')).toEqual({ status: 'missing' })
        expect(await readColdStorageItem('stored')).toEqual({ status: 'ok', value: { character: { chaId: 'a' } } })
    })

    test('guard: a file that cannot be read is a plain read error with no kind', async () => {
        opfsFailure = new StandInNotReadableError('the file could not be read')

        const result = await readColdStorageItem('unit-key')

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBeUndefined()
    })
})

describe('a read whose bytes were obtained but do not decode', () => {
    for (const backend of BACKENDS) {
        test.each(damagedBytesFor(backend))(`on ${backend}: %s is an error of kind damaged`, async (_label, makeBytes) => {
            selectBackend(backend)
            putBytes(backend, 'unit-key', makeBytes())

            const result = await readColdStorageItem('unit-key')

            expect(result.status).toBe('error')
            expect(kindOf(result)).toBe('damaged')
        })
    }

    test.each(DAMAGED_BYTES)('guard: %s keeps status error and carries the decoder\'s error', async (_label, makeBytes) => {
        putBytes('opfs', 'unit-key', makeBytes())

        const result = await readColdStorageItem('unit-key')

        expect(result.status).toBe('error')
        expect(result).toHaveProperty('error')
        expect((result as { error: unknown }).error).toBeTruthy()
    })

    test('guard: on node a zero-length unit is missing, because the Node storage reads an empty body as absent', async () => {
        selectBackend('node')
        putBytes('node', 'unit-key', new Uint8Array(0))

        expect(await readColdStorageItem('unit-key')).toEqual({ status: 'missing' })
    })

    test.each(BACKENDS)('guard: on %s a unit that decodes is ok', async (backend) => {
        selectBackend(backend)
        putBytes(backend, 'unit-key', encodeUnit({ character: { chaId: 'a' } }))

        expect(await readColdStorageItem('unit-key')).toEqual({ status: 'ok', value: { character: { chaId: 'a' } } })
    })
})

describe('preLoadChat on a pointer chat', () => {
    test('with no storage it resolves unavailable and leaves the chat untouched', async () => {
        const chat = installChat(pointerChat('chat-unit'))
        const before = snapshot(chat)

        const result = await withNavigatorStorage(undefined, () => preLoadChat(0, 0))

        expect(result).toBe('unavailable')
        expect(snapshot(chat)).toBe(before)
    })

    for (const backend of BACKENDS) {
        test.each(damagedBytesFor(backend))(`on ${backend}: %s resolves damaged and leaves the chat untouched`, async (_label, makeBytes) => {
            selectBackend(backend)
            putBytes(backend, 'chat-unit', makeBytes())
            const chat = installChat(pointerChat('chat-unit'))
            const before = snapshot(chat)

            const result = await preLoadChat(0, 0)

            expect(result).toBe('damaged')
            expect(snapshot(chat)).toBe(before)
        })
    }

    test.each([
        ['{message: string}', { message: 'not-an-array' }],
        ['{character: {...}} with no message array', { character: { chaId: 'someone' } }],
        ['null', null],
        ['a number', 42],
    ])('a decoded value of shape %s resolves damaged and leaves the chat untouched', async (_label, value) => {
        putBytes('opfs', 'chat-unit', encodeUnit(value))
        const chat = installChat(pointerChat('chat-unit'))
        const before = snapshot(chat)

        const result = await preLoadChat(0, 0)

        expect(result).toBe('damaged')
        expect(snapshot(chat)).toBe(before)
    })

    test('guard: a file that cannot be read resolves error and leaves the chat untouched', async () => {
        putBytes('opfs', 'chat-unit', encodeUnit(GOOD_CHAT_UNIT))
        opfsFailure = new StandInNotReadableError('the file could not be read')
        const chat = installChat(pointerChat('chat-unit'))
        const before = snapshot(chat)

        expect(await preLoadChat(0, 0)).toBe('error')
        expect(snapshot(chat)).toBe(before)
    })

    test('guard: a getDirectory that rejects resolves error and leaves the chat untouched', async () => {
        const chat = installChat(pointerChat('chat-unit'))
        const before = snapshot(chat)
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }

        const result = await withNavigatorStorage(rejecting, () => preLoadChat(0, 0))

        expect(result).toBe('error')
        expect(snapshot(chat)).toBe(before)
    })

    test('guard: an absent unit resolves missing and a good unit resolves ok with the archived messages', async () => {
        const absent = installChat(pointerChat('absent-unit'))
        const before = snapshot(absent)
        expect(await preLoadChat(0, 0)).toBe('missing')
        expect(snapshot(absent)).toBe(before)

        putBytes('opfs', 'chat-unit', encodeUnit(GOOD_CHAT_UNIT))
        const chat = installChat(pointerChat('chat-unit'))
        expect(await preLoadChat(0, 0)).toBe('ok')
        expect(chat.message.map((m) => m.data)).toEqual(['archived'])
    })

    test('never rejects for a no-storage or damaged read', async () => {
        installChat(pointerChat('chat-unit'))
        putBytes('opfs', 'chat-unit', new Uint8Array([1, 2, 3, 4]))

        await expect(preLoadChat(0, 0)).resolves.toBe('damaged')
        await expect(withNavigatorStorage(undefined, () => preLoadChat(0, 0))).resolves.toBe('unavailable')
    })
})

describe('retryLegacyColdChatLoad on a chat holding the legacy error text', () => {
    test('with no storage it resolves unavailable and leaves the chat untouched', async () => {
        const chat = installChat(errorTextChat('chat-unit'))
        const before = snapshot(chat)

        const result = await withNavigatorStorage(undefined, () => retryLegacyColdChatLoad(0, 0))

        expect(result).toBe('unavailable')
        expect(snapshot(chat)).toBe(before)
    })

    for (const backend of BACKENDS) {
        test.each(damagedBytesFor(backend))(`on ${backend}: %s resolves damaged and leaves the chat untouched`, async (_label, makeBytes) => {
            selectBackend(backend)
            putBytes(backend, 'chat-unit', makeBytes())
            const chat = installChat(errorTextChat('chat-unit'))
            const before = snapshot(chat)

            const result = await retryLegacyColdChatLoad(0, 0)

            expect(result).toBe('damaged')
            expect(snapshot(chat)).toBe(before)
        })
    }

    test.each([
        ['{message: string}', { message: 'not-an-array' }],
        ['{character: {...}} with no message array', { character: { chaId: 'someone' } }],
        ['null', null],
    ])('a decoded value of shape %s resolves damaged and leaves the chat untouched', async (_label, value) => {
        putBytes('opfs', 'chat-unit', encodeUnit(value))
        const chat = installChat(errorTextChat('chat-unit'))
        const before = snapshot(chat)

        const result = await retryLegacyColdChatLoad(0, 0)

        expect(result).toBe('damaged')
        expect(snapshot(chat)).toBe(before)
    })

    test('guard: a side field the merge cannot read still resolves error and leaves the chat untouched', async () => {
        putBytes('opfs', 'chat-unit', encodeUnit({ message: [{ time: 1, data: 'archived', role: 'user' }], localLore: 5 }))
        const chat = installChat(errorTextChat('chat-unit'))
        chat.localLore = [{ key: 'live', content: 'live lore' }]
        const before = snapshot(chat)

        expect(await retryLegacyColdChatLoad(0, 0)).toBe('error')
        expect(snapshot(chat)).toBe(before)
    })

    test('guard: a file that cannot be read resolves error, a getDirectory that rejects resolves error, an absent unit resolves missing', async () => {
        putBytes('opfs', 'chat-unit', encodeUnit(GOOD_CHAT_UNIT))
        opfsFailure = new StandInNotReadableError('the file could not be read')
        installChat(errorTextChat('chat-unit'))
        expect(await retryLegacyColdChatLoad(0, 0)).toBe('error')

        opfsFailure = null
        const rejecting = { getDirectory: async () => { throw new StandInSecurityError('the operation is insecure') } }
        expect(await withNavigatorStorage(rejecting, () => retryLegacyColdChatLoad(0, 0))).toBe('error')

        installChat(errorTextChat('absent-unit'))
        expect(await retryLegacyColdChatLoad(0, 0)).toBe('missing')
    })

    test('guard: a good unit resolves ok and replaces the error text with the archived messages', async () => {
        putBytes('opfs', 'chat-unit', encodeUnit(GOOD_CHAT_UNIT))
        const chat = installChat(errorTextChat('chat-unit'))

        expect(await retryLegacyColdChatLoad(0, 0)).toBe('ok')
        expect(chat.message.map((m) => m.data)).toEqual(['archived'])
        expect(get(selectedCharID)).toBe(0)
    })
})

describe('the backup collector takes one branch for every unreadable unit', () => {
    const KEY = '00000000-0000-4000-8000-0000000000aa'
    const SITUATIONS: Array<[string, () => Promise<Awaited<ReturnType<typeof collectColdStorageBackupPayloads>>>]> = [
        ['a file that cannot be read', async () => {
            opfsFailure = new StandInNotReadableError('the file could not be read')
            return collectColdStorageBackupPayloads(db())
        }],
        ['no storage on the page', async () => withNavigatorStorage(undefined, () => collectColdStorageBackupPayloads(db()))],
        ['stored bytes that do not decode', async () => {
            opfsFiles.set('coldstorage_' + KEY + '.json', new Uint8Array([1, 2, 3, 4]))
            return collectColdStorageBackupPayloads(db())
        }],
    ]

    function db(): Pick<Database, 'characters' | 'pluginCustomStorage'> {
        const chat = errorTextChat(KEY)
        return {
            characters: [{ chaId: 'c1', name: 'Alice', type: 'character', chatPage: 0, chats: [chat] }],
            pluginCustomStorage: {},
        } as unknown as Pick<Database, 'characters' | 'pluginCustomStorage'>
    }

    test.each(SITUATIONS)('guard: %s reports the unit as unavailable and carries nothing', async (_label, collect) => {
        const result = await collect()

        expect(result.missingKeys).toEqual([KEY])
        expect(result.invalidKeys).toEqual([])
        expect(result.payloads).toEqual([])
    })

    test('guard: an absent unit, by contrast, is left out without being reported', async () => {
        const result = await collectColdStorageBackupPayloads(db())

        expect(result.missingKeys).toEqual([])
        expect(result.payloads).toEqual([])
    })
})

describe('a key that cannot become a storage name is never read as missing', () => {
    // 116 bytes: its hex-encoded Node file name is 2 * (12 + 116) = 256 bytes.
    const OVERLONG_KEY = 'k'.repeat(116)

    test('regression: on tauri a key holding a slash, whose read fails with os error 2 while exists() says false, is an error of kind damaged', async () => {
        selectBackend('tauri')

        const result = await readColdStorageItem('a/b')

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('damaged')
    })

    test('regression: on node a key whose hex-encoded name is over 255 bytes, which the server answers with an empty 200, is an error of kind damaged', async () => {
        selectBackend('node')

        const result = await readColdStorageItem(OVERLONG_KEY)

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('damaged')
    })

    test('guard: the same read of a key the rule accepts is still missing when the unit is absent', async () => {
        selectBackend('tauri')
        expect(await readColdStorageItem('absent-key')).toEqual({ status: 'missing' })
        selectBackend('node')
        expect(await readColdStorageItem('absent-key')).toEqual({ status: 'missing' })
        selectBackend('opfs')
        expect(await readColdStorageItem('absent-key')).toEqual({ status: 'missing' })
    })

    test('contract: preLoadChat on a pointer whose key is rejected resolves damaged and leaves the chat untouched', async () => {
        const chat = installChat(pointerChat('a/b'))
        const before = snapshot(chat)

        expect(await preLoadChat(0, 0)).toBe('damaged')
        expect(snapshot(chat)).toBe(before)
    })

    test('guard: a backup of a stub whose unit key is rejected reports that key as unavailable and names the character', async () => {
        const stub = {
            chaId: 'cha-stub',
            name: 'Alice',
            type: 'character',
            chatPage: 0,
            coldstorage: 'a/b',
            coldStoragedChats: [],
            chats: [{ id: 'chat-0', message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
        }
        const db = { characters: [stub], pluginCustomStorage: {} } as unknown as Pick<Database, 'characters' | 'pluginCustomStorage'>

        const result = await collectColdStorageBackupPayloads(db)

        expect(result.payloads).toEqual([])
        expect(result.missingKeys).toEqual(['a/b'])
        expect(result.owners?.get('a/b')).toEqual(['Alice'])
    })
})
