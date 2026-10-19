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

    // The batched readers of an export answer a raw response, which the Android bridge cannot carry.
    test('only the raw mode makes the raw-body commands available', () => {
        h.os = 'android'
        expect(isAssetBatchAvailable()).toBe(false)
        h.os = 'windows'
        expect(isAssetBatchAvailable()).toBe(true)
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
