import { describe, expect, test } from 'vitest'
import { displayMimeOfAssetKey, displayMimeOfInlay } from 'src/ts/storage/assetDisplayMime'

describe('displayMimeOfAssetKey', () => {
    test.each([
        ['assets/a.png', 'image/png'],
        ['assets/a.jpg', 'image/jpeg'],
        ['assets/a.jpeg', 'image/jpeg'],
        ['assets/a.gif', 'image/gif'],
        ['assets/a.webp', 'image/webp'],
        ['assets/a.avif', 'image/avif'],
        ['assets/a.bmp', 'image/bmp'],
        ['assets/a.mp4', 'video/mp4'],
        ['assets/a.webm', 'video/webm'],
        ['assets/a.mov', 'video/quicktime'],
        ['assets/a.m4v', 'video/x-m4v'],
        ['assets/a.ogv', 'video/ogg'],
        ['assets/a.mkv', 'video/x-matroska'],
        ['assets/a.mp3', 'audio/mpeg'],
        ['assets/a.wav', 'audio/wav'],
        ['assets/a.ogg', 'audio/ogg'],
        ['assets/a.oga', 'audio/ogg'],
        ['assets/a.m4a', 'audio/mp4'],
        ['assets/a.aac', 'audio/aac'],
        ['assets/a.flac', 'audio/flac'],
        ['assets/a.opus', 'audio/opus'],
        ['assets/a.ttf', 'font/ttf'],
        ['assets/a.otf', 'font/otf'],
        ['assets/a.woff', 'font/woff'],
        ['assets/a.woff2', 'font/woff2'],
    ])('%s is shown as %s', (key, mime) => {
        expect(displayMimeOfAssetKey(key)).toBe(mime)
    })

    test.each([
        ['assets/a.svg'],
        ['assets/a.html'],
        ['assets/a.htm'],
        ['assets/a.xhtml'],
        ['assets/a.js'],
        ['assets/a.xyz'],
        ['assets/noextension'],
        ['assets/dir.png/noextension'],
        ['assets/trailingdot.'],
        [''],
    ])('%s is shown as opaque bytes', (key) => {
        expect(displayMimeOfAssetKey(key)).toBe('application/octet-stream')
    })

    test('the extension is matched without regard to case', () => {
        expect(displayMimeOfAssetKey('assets/a.PNG')).toBe('image/png')
        expect(displayMimeOfAssetKey('assets/a.Svg')).toBe('application/octet-stream')
        expect(displayMimeOfAssetKey('assets/a.HTML')).toBe('application/octet-stream')
    })

    test('only the last extension decides', () => {
        expect(displayMimeOfAssetKey('assets/a.svg.png')).toBe('image/png')
        expect(displayMimeOfAssetKey('assets/a.png.svg')).toBe('application/octet-stream')
    })
})

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
