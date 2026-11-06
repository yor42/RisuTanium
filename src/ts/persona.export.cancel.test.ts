/**
 * Closing the save picker of the persona export clears the wait dialog and shows no success
 * notice; a saved export shows the notice once.
 *
 * Drives the REAL `src/ts/persona.ts`. MOCKED: the alert module, the database, the image and
 * PNG modules and the download, whose result is the picker outcome (`false` is a cancel).
 * Titles beginning "guard:" pin behaviour that must be preserved before and after the change;
 * titles beginning "regression reproducer:" fail against a version that ignores the result.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
    storeSet: vi.fn(),
    clear: vi.fn(),
    normal: vi.fn(),
    error: vi.fn(),
    download: vi.fn(),
}))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: spies.clear,
    alertError: spies.error,
    alertNormal: spies.normal,
    alertStore: { set: spies.storeSet, update: vi.fn(), subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => ({ username: 'Ann', personaPrompt: 'prompt', userIcon: 'icon', userNote: '' }),
    saveImage: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    AppendableBuffer: class {},
    downloadFile: spies.download,
    readImage: vi.fn(async () => new Uint8Array([1])),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (img: Uint8Array) => img),
}) as unknown as typeof import('src/ts/process/files/inlays'))
vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: { write: vi.fn(async () => new Uint8Array([2])), readGenerator: vi.fn() },
}) as unknown as typeof import('src/ts/pngChunk'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { exportUserPersona } from './persona'

beforeEach(() => {
    for (const spy of Object.values(spies)) {
        spy.mockReset()
    }
})

describe('exportUserPersona save result', () => {
    test('regression reproducer: a cancelled picker clears the wait dialog and shows no success notice', async () => {
        spies.download.mockResolvedValue(false)

        await exportUserPersona()

        expect(spies.download).toHaveBeenCalledTimes(1)
        const waitOrders = spies.storeSet.mock.invocationCallOrder
        expect(waitOrders.length).toBeGreaterThan(0)
        expect(spies.clear).toHaveBeenCalledTimes(1)
        expect(spies.clear.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...waitOrders))
        expect(spies.normal).not.toHaveBeenCalled()
        expect(spies.error).not.toHaveBeenCalled()
    })

    test('guard: a saved export shows the success notice once and does not clear', async () => {
        spies.download.mockResolvedValue(true)

        await exportUserPersona()

        expect(spies.normal).toHaveBeenCalledTimes(1)
        expect(spies.clear).not.toHaveBeenCalled()
    })
})
