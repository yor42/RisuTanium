// @vitest-environment jsdom
/**
 * S4d-T3: the preset icon pipeline both editors share. MOCKED: the file picker, and the canvas, image and object URL
 * (jsdom has none); the assertions are the pipeline's call sequence: a 48x48 canvas, the image drawn over it, a 0.7
 * JPEG data URL. A cancelled pick returns null before any canvas exists.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ pick: vi.fn<(ext: string[]) => Promise<{ name: string; data: Uint8Array } | null>>() }))
vi.mock('./util', () => ({ selectSingleFile: h.pick }))

import { pickPresetIcon } from './presetIcon'

const calls: string[] = []
let canvas: { width: number; height: number; getContext: () => unknown; toDataURL: (type: string, quality: number) => string }

beforeEach(() => {
    calls.length = 0
    h.pick.mockReset()
    const drawImage = vi.fn((_img: unknown, x: number, y: number, w: number, hh: number) => { calls.push(`draw ${x},${y},${w},${hh}`) })
    canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage }),
        toDataURL: (type, quality) => { calls.push(`encode ${canvas.width}x${canvas.height} ${type} ${quality}`); return 'data:image/jpeg;base64,ENC' },
    }
    const create = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => (tag === 'canvas' ? (canvas as unknown as HTMLCanvasElement) : create(tag)))
    vi.stubGlobal('Image', class { src = ''; decode = async () => { calls.push('decode') } })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:icon' })
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('S4d-T3: pickPresetIcon', () => {
    test('offers the four image types and encodes a 48x48 JPEG at quality 0.7', async () => {
        h.pick.mockResolvedValue({ name: 'a.png', data: new Uint8Array([1, 2, 3]) })
        await expect(pickPresetIcon()).resolves.toBe('data:image/jpeg;base64,ENC')
        expect(h.pick).toHaveBeenCalledWith(['png', 'jpg', 'jpeg', 'webp'])
        expect(calls).toEqual(['decode', 'draw 0,0,48,48', 'encode 48x48 image/jpeg 0.7'])
    })

    test('a cancelled pick returns null and touches no canvas', async () => {
        h.pick.mockResolvedValue(null)
        await expect(pickPresetIcon()).resolves.toBeNull()
        expect(calls).toEqual([])
    })
})
