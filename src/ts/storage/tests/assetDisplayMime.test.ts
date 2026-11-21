import { describe, expect, test } from 'vitest'
import { displayMimeOfInlay } from 'src/ts/storage/assetDisplayMime'

describe('displayMimeOfInlay', () => {
    test.each([
        ['image', 'png', 'image/png'],
        ['image', 'jpg', 'image/jpeg'],
        ['image', 'jpeg', 'image/jpeg'],
        ['image', 'gif', 'image/gif'],
        ['image', 'webp', 'image/webp'],
        ['image', 'avif', 'image/avif'],
        ['image', 'bmp', 'image/bmp'],
        ['video', 'mp4', 'video/mp4'],
        ['video', 'webm', 'video/webm'],
        ['video', 'mkv', 'video/x-matroska'],
        ['video', 'mov', 'video/quicktime'],
        ['audio', 'mp3', 'audio/mpeg'],
        ['audio', 'wav', 'audio/wav'],
        ['audio', 'ogg', 'audio/ogg'],
        ['audio', 'flac', 'audio/flac'],
        ['audio', 'aac', 'audio/aac'],
        ['audio', 'opus', 'audio/opus'],
    ])('a %s inlay with ext %s is shown as %s', (type, ext, mime) => {
        expect(displayMimeOfInlay(type, ext)).toBe(mime)
    })

    test.each([
        ['image', 'mp4'],
        ['image', 'mp3'],
        ['video', 'png'],
        ['video', 'mp3'],
        ['audio', 'webm'],
        ['audio', 'mp4'],
        ['audio', 'png'],
    ])('a %s inlay with ext %s mismatches its kind and is shown as opaque bytes', (type, ext) => {
        expect(displayMimeOfInlay(type, ext)).toBe('application/octet-stream')
    })

    test.each([
        ['image', 'svg'],
        ['image', 'html'],
        ['video', 'xyz'],
        ['audio', 'mpeg'],
        ['audio', 'L16;codec=pcm;rate=24000'],
        ['image', 'svg.png'],
        ['image', 'png/x'],
        ['image', ' png'],
        ['image', ''],
    ])('a %s inlay with ext %s is outside the table and is shown as opaque bytes', (type, ext) => {
        expect(displayMimeOfInlay(type, ext)).toBe('application/octet-stream')
    })

    test('a font type is never reachable for an inlay', () => {
        expect(displayMimeOfInlay('font', 'woff')).toBe('application/octet-stream')
        expect(displayMimeOfInlay('image', 'woff')).toBe('application/octet-stream')
        expect(displayMimeOfInlay('audio', 'ttf')).toBe('application/octet-stream')
    })

    test('a type that is not image, video or audio is shown as opaque bytes', () => {
        expect(displayMimeOfInlay('signature', 'json')).toBe('application/octet-stream')
        expect(displayMimeOfInlay('', 'png')).toBe('application/octet-stream')
        expect(displayMimeOfInlay(undefined, 'png')).toBe('application/octet-stream')
        expect(displayMimeOfInlay(['image'], 'png')).toBe('application/octet-stream')
    })

    test('an ext that is not a string is shown as opaque bytes', () => {
        expect(displayMimeOfInlay('image', undefined)).toBe('application/octet-stream')
        expect(displayMimeOfInlay('image', ['png'])).toBe('application/octet-stream')
        expect(displayMimeOfInlay('image', 5)).toBe('application/octet-stream')
        expect(displayMimeOfInlay('image', null)).toBe('application/octet-stream')
    })

    test('the ext is matched without regard to case', () => {
        expect(displayMimeOfInlay('image', 'PNG')).toBe('image/png')
        expect(displayMimeOfInlay('video', 'Mp4')).toBe('video/mp4')
        expect(displayMimeOfInlay('image', 'SVG')).toBe('application/octet-stream')
    })
})
