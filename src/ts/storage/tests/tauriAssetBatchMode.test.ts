// @vitest-environment happy-dom

/**
 * Which batched write command a page may use (`assetBatchWriteMode`, which asks
 * `transportKind`), and the base64 wire of `writeAssetBatchB64`. `invoke` is a
 * stand-in that records what it was given; the native commands are not run here.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
    isTauri: true,
    os: 'android' as string | 'throw',
    invoke: vi.fn<(command: string, args?: unknown, options?: unknown) => Promise<unknown>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
    invoke: (command: string, args?: unknown, options?: unknown) => h.invoke(command, args, options),
}))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (h.os === 'throw') {
            throw new Error('no os plugin')
        }
        return h.os
    },
}))

vi.mock(import('../../platform'), () => ({
    get isTauri() { return h.isTauri },
}) as unknown as typeof import('../../platform'))

import {
    assetBatchWriteMode,
    encodePutFrames,
    isAssetBatchAvailable,
    isAssetBatchReadAvailable,
    markAssetBatchUnavailable,
    resetAssetBatchAvailabilityForTests,
    writeAssetBatchB64,
} from '../tauriAssetBatch'

beforeEach(() => {
    h.isTauri = true
    h.os = 'android'
    h.invoke.mockReset()
    resetAssetBatchAvailabilityForTests()
})

describe('the write mode of a page', () => {
    test('android sends base64 frames', () => {
        h.os = 'android'

        expect(assetBatchWriteMode()).toBe('b64')
    })

    test.each(['windows', 'linux', 'macos'])('%s sends raw frames', (os) => {
        h.os = os

        expect(assetBatchWriteMode()).toBe('raw')
    })

    test.each(['ios', 'throw'])('%s, and a page without the operating-system plugin, do not batch', (os) => {
        h.os = os

        expect(assetBatchWriteMode()).toBe('none')
    })

    test('a page outside the Tauri shell does not batch', () => {
        h.isTauri = false

        expect(assetBatchWriteMode()).toBe('none')
    })

    test.each(['android', 'windows'])('markAssetBatchUnavailable turns %s off for the rest of the page', (os) => {
        h.os = os
        markAssetBatchUnavailable()

        expect(assetBatchWriteMode()).toBe('none')
    })

    // The raw-body write is the desktop's; the Android restore writes base64 frames.
    test('only the raw mode makes the raw-body write available', () => {
        h.os = 'android'
        expect(isAssetBatchAvailable()).toBe(false)
        h.os = 'windows'
        expect(isAssetBatchAvailable()).toBe(true)
    })
})

describe('the read availability of a page', () => {
    test.each(['android', 'windows', 'linux', 'macos'])('%s may use the batched read and the sized listing', (os) => {
        h.os = os

        expect(isAssetBatchReadAvailable()).toBe(true)
    })

    test.each(['ios', 'throw'])('%s, and a page without the operating-system plugin, may not', (os) => {
        h.os = os

        expect(isAssetBatchReadAvailable()).toBe(false)
    })

    test('a page outside the Tauri shell may not', () => {
        h.isTauri = false

        expect(isAssetBatchReadAvailable()).toBe(false)
    })

    // A desktop page whose raw bodies did not reach the commands keeps reading one asset at a time.
    test.each(['android', 'windows'])('markAssetBatchUnavailable turns %s off for the rest of the page', (os) => {
        h.os = os
        expect(isAssetBatchReadAvailable()).toBe(true)

        markAssetBatchUnavailable()

        expect(isAssetBatchReadAvailable()).toBe(false)
    })

    test('the restore keeps its own write test: android reads in batches but does not write raw frames', () => {
        h.os = 'android'

        expect(isAssetBatchReadAvailable()).toBe(true)
        expect(isAssetBatchAvailable()).toBe(false)
        expect(assetBatchWriteMode()).toBe('b64')
    })
})

describe('writeAssetBatchB64', () => {
    const entries = [
        { key: 'assets/a', data: new Uint8Array([1, 2, 3]) },
        { key: 'assets/b', data: new Uint8Array([]) },
    ]

    test('sends the standard base64 of exactly the frames of the raw body, and reads the answers in order', async () => {
        h.invoke.mockResolvedValue([{ k: 'ok', flushed: true }, { k: 'invalid', reason: 'no' }])

        const results = await writeAssetBatchB64(entries, 1024)

        expect(results).toEqual([{ k: 'ok' }, { k: 'invalid', reason: 'no' }])
        expect(h.invoke).toHaveBeenCalledTimes(1)
        const [command, args] = h.invoke.mock.calls[0]
        expect(command).toBe('put_assets_batch_b64')
        const sent = Buffer.from((args as { body: string }).body, 'base64')
        expect(Array.from(sent)).toEqual(Array.from(encodePutFrames(entries)))
        expect((args as { body: string }).body).toBe(Buffer.from(encodePutFrames(entries)).toString('base64'))
    })

    test('a list above the size limit rejects before the call', async () => {
        await expect(writeAssetBatchB64(entries, 2)).rejects.toBeInstanceOf(RangeError)

        expect(h.invoke).not.toHaveBeenCalled()
    })

    test('a result list of the wrong length is an error', async () => {
        h.invoke.mockResolvedValue([{ k: 'ok' }])

        await expect(writeAssetBatchB64(entries, 1024)).rejects.toThrow(/wrong length/)
    })

    test('a rejected call rejects as it is', async () => {
        h.invoke.mockRejectedValue('the write task failed')

        await expect(writeAssetBatchB64(entries, 1024)).rejects.toBe('the write task failed')
    })
})
