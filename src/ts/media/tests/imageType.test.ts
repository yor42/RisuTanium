import { describe, expect, test } from 'vitest'
import { IMAGE_TYPE_HEAD_BYTES, IMAGE_TYPE_TAIL_BYTES, getImageType, imageTypeOfEnds, type ImageType } from '../imageType'

test('should detect JPEG', () => {
    // JPEG starts with FF D8, ends with FF D9
    const jpeg = new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9])
    expect(getImageType(jpeg)).toBe('JPEG')
})

test('should detect PNG', () => {
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(getImageType(png)).toBe('PNG')
})

test('should detect GIF87a', () => {
    // GIF87a: 47 49 46 38 37 61
    const gif87a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    expect(getImageType(gif87a)).toBe('GIF')
})

test('should detect GIF89a', () => {
    // GIF89a: 47 49 46 38 39 61
    const gif89a = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(getImageType(gif89a)).toBe('GIF')
})

test('should detect BMP', () => {
    // BMP starts with 42 4D ("BM")
    const bmp = new Uint8Array([0x42, 0x4d, 0x00, 0x00])
    expect(getImageType(bmp)).toBe('BMP')
})

test('should detect AVIF', () => {
    // AVIF: bytes 4-11 are "ftypavif"
    const avif = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x00, // size (bytes 0-3)
        0x66,
        0x74,
        0x79,
        0x70, // "ftyp" (bytes 4-7)
        0x61,
        0x76,
        0x69,
        0x66, // "avif" (bytes 8-11)
    ])
    expect(getImageType(avif)).toBe('AVIF')
})

test('should detect WEBP', () => {
    // WEBP: "RIFF" at 0-3, "WEBP" at 8-11
    const webp = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // "RIFF" (bytes 0-3)
        0x00,
        0x00,
        0x00,
        0x00, // file size (bytes 4-7)
        0x57,
        0x45,
        0x42,
        0x50, // "WEBP" (bytes 8-11)
    ])
    expect(getImageType(webp)).toBe('WEBP')
})

test('should return Unknown for unrecognized format', () => {
    const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(getImageType(unknown)).toBe('Unknown')
})

test('should return Unknown for empty array', () => {
    const empty = new Uint8Array([])
    expect(getImageType(empty)).toBe('Unknown')
})

// Compatibility guards (they pass before and after the rules moved into `imageTypeOfEnds`): the same answers as the
// rule set `getImageType` had, fixture by fixture. Scratch mutant: drop one rule.
const FIXTURES: Array<[number, string, number[], ImageType]> = [
    [0, 'jpeg with both markers', [0xff, 0xd8, 0xff, 0xe0, 0, 0xff, 0xd9], 'JPEG'],
    [1, 'jpeg start without the end marker', [0xff, 0xd8, 0xff, 0xe0, 0, 1, 2], 'Unknown'],
    [2, 'png signature', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0], 'PNG'],
    [3, 'png signature cut one byte short', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a], 'Unknown'],
    [4, 'gif87a', [0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 1, 0], 'GIF'],
    [5, 'gif89a', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0], 'GIF'],
    [6, 'gif with another version', [0x47, 0x49, 0x46, 0x38, 0x38, 0x61, 1, 0], 'Unknown'],
    [7, 'bmp', [0x42, 0x4d, 0, 0, 0, 0], 'BMP'],
    [8, 'avif', [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0], 'AVIF'],
    [9, 'webp', [0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2], 'WEBP'],
    [10, 'riff that is not webp', [0x52, 0x49, 0x46, 0x46, 20, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2], 'Unknown'],
    [11, 'empty', [], 'Unknown'],
    [12, 'one byte', [0xff], 'Unknown'],
    [13, 'jpeg of exactly four bytes', [0xff, 0xd8, 0xff, 0xd9], 'JPEG'],
    [14, 'jpeg start whose last byte alone is the end marker', [0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xd9], 'Unknown'],
    [15, 'jpeg longer than the head bytes', [0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0xff, 0xd9], 'JPEG'],
    [16, 'jpeg start with the end marker inside the head but not at the end', [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 1], 'Unknown'],
]

describe.each(FIXTURES)('fixture %i: %s', (_index, _label, list, expected) => {
    const bytes = Uint8Array.from(list)

    test('getImageType', () => {
        expect(getImageType(bytes)).toBe(expected)
    })

    test('imageTypeOfEnds on the ends alone gives the same type, however the bytes were cut', () => {
        const head = bytes.slice(0, IMAGE_TYPE_HEAD_BYTES)
        const tail = bytes.slice(Math.max(0, bytes.length - IMAGE_TYPE_TAIL_BYTES))
        expect(imageTypeOfEnds(head, tail)).toBe(expected)
    })

    test('a view of a larger buffer gives the same type', () => {
        const padded = new Uint8Array(bytes.length + 10)
        padded.set(bytes, 5)
        expect(getImageType(padded.subarray(5, 5 + bytes.length))).toBe(expected)
    })
})
