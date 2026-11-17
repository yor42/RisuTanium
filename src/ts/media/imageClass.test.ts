/**
 * The one animation rule the thumbnail path and the portrait shrink share. The avatarThumb suites import
 * these names through avatarThumb's re-export, which is the compatibility guard for that surface.
 */
import { describe, expect, test } from 'vitest'
import { classifyImage, isAnimatedImage } from './imageClass'

function pngWithChunks(chunks: string[]): Uint8Array {
    const parts: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (const type of chunks) {
        parts.push(0, 0, 0, 0)
        for (let i = 0; i < 4; i++) parts.push(type.charCodeAt(i))
        parts.push(0, 0, 0, 0)
    }
    while (parts.length < 40) parts.push(0)
    return Uint8Array.from(parts)
}

describe('imageClass', () => {
    test('a still PNG is still, a PNG with acTL before IDAT is animated', () => {
        expect(classifyImage(pngWithChunks(['IHDR', 'IDAT', 'IEND']), true)).toEqual({ kind: 'still', mime: 'image/png' })
        expect(classifyImage(pngWithChunks(['IHDR', 'acTL', 'IDAT', 'IEND']), true)).toEqual({ kind: 'animated' })
        expect(isAnimatedImage(pngWithChunks(['IHDR', 'acTL', 'IDAT']))).toBe(true)
    })

    test('a prefix that ends before IDAT cannot be decided', () => {
        expect(classifyImage(pngWithChunks(['IHDR', 'tEXt']), false)).toEqual({ kind: 'undecided' })
    })

    test('a GIF is animated and an unrecognised file is unknown', () => {
        const gif = new TextEncoder().encode('GIF89a' + '\0'.repeat(30))
        expect(classifyImage(gif, true)).toEqual({ kind: 'animated' })
        expect(classifyImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), true)).toEqual({ kind: 'unknown' })
    })
})
