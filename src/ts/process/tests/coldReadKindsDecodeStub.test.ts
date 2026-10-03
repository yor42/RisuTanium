/**
 * Which decode failures make an archived read "damaged" and which stay a plain
 * read error, driven through the real reader with the decompressor replaced by
 * a stub that fails the way each cause fails.
 *
 * Only an error that says the stored bytes are bad makes a read damaged: an
 * fflate data-format code (0, 1, 2, 3, 6) or a SyntaxError from `JSON.parse`.
 * Anything else the decompressor can throw (a RangeError for a buffer that
 * cannot be allocated, a Worker that cannot start, an fflate code for API
 * misuse, an error with no code) says nothing about the data, so the read stays
 * a plain error and the user is still invited to try again. Calling a healthy
 * large unit "damaged" on a device that ran out of memory could make the user
 * delete a good character.
 *
 * `fflate` is replaced for this whole file, so it cannot compress; the real
 * decoder is exercised in `coldReadKinds.test.ts` and the pure classification
 * in `../coldstorageDataKinds.test.ts`. The error shapes here are the ones
 * fflate 0.8.2's Node build and its browser Worker bridge produce, taken from
 * source; the browser Worker path itself is not run.
 *
 * Tests whose title starts with "guard:" protect behaviour that holds whatever
 * the cause of the failure (a plain error with no kind, an untouched chat); the
 * others pin which causes make a read damaged.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

const h = vi.hoisted(() => ({
    decompress: vi.fn(),
}))

vi.mock('fflate', () => ({
    compress: vi.fn(),
    decompress: (data: Uint8Array, callback: (error: unknown, result: Uint8Array | null) => void) => h.decompress(data, callback),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

// The page store holds no unit, so every read falls through to the legacy OPFS
// file whose bytes the stubbed decompressor then fails on.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const store = createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: async () => [],
        removeItem: async () => { },
    })
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
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
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import { coldStorageHeader, preLoadChat, readColdStorageItem, retryLegacyColdChatLoad } from '../coldstorage.svelte'
import { formatColdStorageLoadError } from '../coldstorageData'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import type { Database } from 'src/ts/storage/database.svelte'

const STORED_BYTES = new Uint8Array([9, 9, 9, 9])

const opfsDirectory = {
    async getFileHandle() {
        return {
            async getFile() {
                return { async arrayBuffer() { return STORED_BYTES.buffer.slice(0) } }
            },
        }
    },
}

type Decompressor = (data: Uint8Array, callback: (error: unknown, result: Uint8Array | null) => void) => void

function failWith(error: unknown): Decompressor {
    return (_data, callback) => callback(error, null)
}

function throwWith(error: unknown): Decompressor {
    return () => { throw error }
}

function decodeTo(text: string): Decompressor {
    return (_data, callback) => callback(null, new TextEncoder().encode(text))
}

function fflateError(message: string, code: number | undefined): Error {
    return Object.assign(new Error(message), code === undefined ? {} : { code })
}

function kindOf(result: Awaited<ReturnType<typeof readColdStorageItem>>): unknown {
    return result.status === 'error' ? (result as { kind?: unknown }).kind : undefined
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    h.decompress.mockReset()
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => opfsDirectory } })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    consoleErrorSpy.mockRestore()
    selectedCharID.set(-1)
})

describe('a decode failure that says the stored bytes are bad is damaged', () => {
    test.each([
        ['unexpected EOF (a truncated stream)', 0],
        ['invalid block type', 1],
        ['invalid length/literal', 2],
        ['invalid distance', 3],
        ['invalid zlib data (a bad header)', 6],
    ] as const)('%s, fflate code %i, is damaged', async (message, code) => {
        h.decompress.mockImplementation(failWith(fflateError(message, code)))

        const result = await readColdStorageItem('unit-key')

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('damaged')
    })

    test('a decompressor that throws its data-format error synchronously is damaged', async () => {
        h.decompress.mockImplementation(throwWith(fflateError('unexpected EOF', 0)))

        expect(kindOf(await readColdStorageItem('unit-key'))).toBe('damaged')
    })

    test('text that decompresses but is not JSON is damaged', async () => {
        h.decompress.mockImplementation(decodeTo('{not valid json'))

        const result = await readColdStorageItem('unit-key')

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBe('damaged')
    })
})

describe('a decode failure that says nothing about the stored bytes stays a plain read error', () => {
    const NOT_ABOUT_THE_DATA: Array<[string, () => unknown]> = [
        ['a RangeError for a buffer that cannot be allocated', () => new RangeError('Array buffer allocation failed')],
        ['a plain Error', () => new Error('something else went wrong')],
        ['an error shaped like a Worker that could not start (no code)', () => Object.assign(new Error('Failed to construct Worker'), { name: 'SecurityError' })],
        ['an error posted back from a Worker with no code', () => fflateError('worker crashed', undefined)],
        ['an error named SyntaxError with no fflate code, as starting a Worker can throw (the name rule belongs to JSON.parse only)', () => Object.assign(new Error('Failed to construct Worker'), { name: 'SyntaxError' })],
        ['an fflate code for a finished stream (API misuse), 4', () => fflateError('stream finished', 4)],
        ['an fflate code for a missing stream handler (API misuse), 5', () => fflateError('no stream handler', 5)],
        ['an fflate code for a missing callback (API misuse), 7', () => fflateError('no callback', 7)],
        ['an error with a string code', () => Object.assign(new Error('boom'), { code: 'ERR_OUT_OF_MEMORY' })],
    ]

    test.each(NOT_ABOUT_THE_DATA)('guard: %s is an error with no kind', async (_label, makeError) => {
        h.decompress.mockImplementation(failWith(makeError()))

        const result = await readColdStorageItem('unit-key')

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBeUndefined()
    })

    test.each(NOT_ABOUT_THE_DATA)('guard: %s, thrown synchronously, is an error with no kind', async (_label, makeError) => {
        h.decompress.mockImplementation(throwWith(makeError()))

        const result = await readColdStorageItem('unit-key')

        expect(result.status).toBe('error')
        expect(kindOf(result)).toBeUndefined()
    })

    test.each(NOT_ABOUT_THE_DATA)('guard: %s resolves a pointer chat as error and leaves it untouched', async (_label, makeError) => {
        h.decompress.mockImplementation(failWith(makeError()))
        const chat = { id: 'chat-0', message: [{ time: 1, data: coldStorageHeader + 'chat-unit', role: 'char' }], note: '', name: '', localLore: [] }
        DBState.db = { characters: [{ chaId: 'cha-1', name: 'Alice', type: 'character', chatPage: 0, chats: [chat] }] } as unknown as Database
        selectedCharID.set(0)
        const before = JSON.stringify(chat)

        expect(await preLoadChat(0, 0)).toBe('error')
        expect(JSON.stringify(chat)).toBe(before)
    })

    test.each(NOT_ABOUT_THE_DATA)('guard: %s resolves a legacy retry as error and leaves the chat untouched', async (_label, makeError) => {
        h.decompress.mockImplementation(failWith(makeError()))
        const chat = { id: 'chat-0', message: [{ time: 1, data: formatColdStorageLoadError('chat-unit'), role: 'char' }], note: '', name: '', localLore: [] }
        DBState.db = { characters: [{ chaId: 'cha-1', name: 'Alice', type: 'character', chatPage: 0, chats: [chat] }] } as unknown as Database
        selectedCharID.set(0)
        const before = JSON.stringify(chat)

        expect(await retryLegacyColdChatLoad(0, 0)).toBe('error')
        expect(JSON.stringify(chat)).toBe(before)
    })

    describe('when the JSON step itself fails for a reason other than bad text', () => {
        const SENTINEL = '{"sentinel":"the text that makes JSON.parse run out of memory"}'

        /** `JSON.parse` fails with `error` for the sentinel text only; every other text parses as usual. */
        function failJsonParseOnSentinel(error: unknown): void {
            const realParse = JSON.parse.bind(JSON)
            jsonParseSpy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
                if (text === SENTINEL) {
                    throw error
                }
                return realParse(text, reviver)
            })
        }

        let jsonParseSpy: { mockRestore: () => void } | undefined

        afterEach(() => {
            jsonParseSpy?.mockRestore()
            jsonParseSpy = undefined
        })

        test('guard: a RangeError from JSON.parse (the text is too large for this device) is an error with no kind', async () => {
            h.decompress.mockImplementation(decodeTo(SENTINEL))
            failJsonParseOnSentinel(new RangeError('Invalid string length'))

            const result = await readColdStorageItem('unit-key')

            expect(result.status).toBe('error')
            expect(kindOf(result)).toBeUndefined()
        })

        test('guard: a RangeError from JSON.parse resolves a pointer chat as error and leaves it untouched', async () => {
            h.decompress.mockImplementation(decodeTo(SENTINEL))
            failJsonParseOnSentinel(new RangeError('Invalid string length'))
            const chat = { id: 'chat-0', message: [{ time: 1, data: coldStorageHeader + 'chat-unit', role: 'char' }], note: '', name: '', localLore: [] }
            DBState.db = { characters: [{ chaId: 'cha-1', name: 'Alice', type: 'character', chatPage: 0, chats: [chat] }] } as unknown as Database
            selectedCharID.set(0)
            const before = JSON.stringify(chat)

            expect(await preLoadChat(0, 0)).toBe('error')
            expect(JSON.stringify(chat)).toBe(before)
        })
    })

    test('guard: bytes that decode to a good value are ok', async () => {
        h.decompress.mockImplementation(decodeTo(JSON.stringify({ character: { chaId: 'a' } })))

        expect(await readColdStorageItem('unit-key')).toEqual({ status: 'ok', value: { character: { chaId: 'a' } } })
    })
})
