/**
 * The compressed legacy encoding is a pure function of its input: the gzip header carries no wall-clock timestamp, so two
 * exports of an unchanged save are byte-identical. A zero header timestamp is valid gzip, so the repo's decoder still reads it.
 * Platform boundaries are mocked as in the strict-read tests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
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

import { decodeRisuSave, encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'

function gzipStart(bytes: Uint8Array) {
    return bytes.findIndex((b, i) => b === 0x1f && bytes[i + 1] === 0x8b && bytes[i + 2] === 0x08)
}

function sample() {
    return { name: 'card', chats: Array.from({ length: 200 }, (_, i) => ({ message: 'hello', index: i })), n: 7 }
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
    vi.useRealTimers()
})

describe('compressed legacy encoding', () => {
    test('is byte-identical across a clock advance', () => {
        const first = encodeRisuSaveLegacy(sample(), 'compression')
        vi.setSystemTime(new Date('2026-06-01T12:34:56Z'))
        const second = encodeRisuSaveLegacy(sample(), 'compression')
        expect(Array.from(second)).toEqual(Array.from(first))
    })

    test('writes a zero gzip MTIME', () => {
        const bytes = encodeRisuSaveLegacy(sample(), 'compression')
        const start = gzipStart(bytes)
        expect(start).toBeGreaterThanOrEqual(0)
        expect(Array.from(bytes.subarray(start + 4, start + 8))).toEqual([0, 0, 0, 0])
    })

    // Compatibility guard: passes before and after the fix.
    test('still decodes to the same object', async () => {
        const decoded = await decodeRisuSave(encodeRisuSaveLegacy(sample(), 'compression'))
        expect(decoded).toEqual(sample())
    })
})
