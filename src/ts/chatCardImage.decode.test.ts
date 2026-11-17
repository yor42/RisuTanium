// @vitest-environment happy-dom

/**
 * `decode` is shared by the card avatar and the phone portrait shrink: bitmap options are forwarded only
 * when given, and an engine that rejects them still decodes through an `<img>`.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { decode } from './chatCardImage'

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

afterEach(() => {
    vi.unstubAllGlobals()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
})

function fakeBitmap() {
    return { width: 40, height: 60, close: vi.fn() }
}

describe('decode bitmap options', () => {
    test('D1: options are passed to createImageBitmap when given', async () => {
        const spy = vi.fn(async () => fakeBitmap())
        vi.stubGlobal('createImageBitmap', spy)
        const blob = new Blob([new Uint8Array(4)])
        const decoded = await decode(blob, new AbortController().signal, { imageOrientation: 'from-image' })
        expect(spy).toHaveBeenCalledTimes(1)
        expect(spy.mock.calls[0]).toEqual([blob, { imageOrientation: 'from-image' }])
        expect(decoded?.width).toBe(40)
    })

    test('D1: without options createImageBitmap gets exactly one argument', async () => {
        const spy = vi.fn(async () => fakeBitmap())
        vi.stubGlobal('createImageBitmap', spy)
        await decode(new Blob([new Uint8Array(4)]), new AbortController().signal)
        expect(spy.mock.calls[0]).toHaveLength(1)
    })

    test('D1: an engine that rejects the options falls back to an image element', async () => {
        vi.stubGlobal('createImageBitmap', vi.fn(async () => {
            throw new TypeError('imageOrientation is not supported')
        }))
        class FakeImage {
            onload: (() => void) | null = null
            onerror: (() => void) | null = null
            naturalWidth = 4000
            naturalHeight = 3000
            set src(_value: string) {
                queueMicrotask(() => this.onload?.())
            }
            removeAttribute(): void {}
        }
        vi.stubGlobal('Image', FakeImage)
        const create = vi.fn(() => 'blob:img')
        const revoke = vi.fn()
        URL.createObjectURL = create
        URL.revokeObjectURL = revoke
        const decoded = await decode(new Blob([new Uint8Array(4)]), new AbortController().signal, { imageOrientation: 'from-image' })
        expect(decoded?.width).toBe(4000)
        expect(decoded?.height).toBe(3000)
        decoded?.release()
        expect(revoke).toHaveBeenCalledWith('blob:img')
    })
})
