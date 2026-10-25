import { describe, expect, test } from 'vitest'
import { displayMimeOfAssetKey } from 'src/ts/storage/assetDisplayMime'

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
