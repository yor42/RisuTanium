// @vitest-environment node
// The magic-byte table: what a bundled font or image must start with, whatever its extension claims.
import { describe, expect, it } from 'vitest'
import { kindOfMime, mimeOfExtension, SNIFF_BYTES, sniffPackFile, type PackFileMime } from './sniff'
import { utf8 } from './fixtures/packBuilder'

function head(...parts: readonly (string | readonly number[])[]): Uint8Array {
    const out = new Uint8Array(SNIFF_BYTES)
    let at = 0
    for (const part of parts) {
        const bytes = typeof part === 'string' ? utf8(part) : Uint8Array.from(part)
        out.set(bytes, at)
        at += bytes.length
    }
    return out
}

describe('T1-24 sniff table', () => {
    const ROWS: readonly (readonly [string, PackFileMime, Uint8Array])[] = [
        ['woff2', 'font/woff2', head('wOF2')],
        ['woff', 'font/woff', head('wOFF')],
        ['ttf', 'font/ttf', head([0x00, 0x01, 0x00, 0x00])],
        ['ttf', 'font/ttf', head('true')],
        ['otf', 'font/otf', head('OTTO')],
        ['png', 'image/png', head([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
        ['jpg', 'image/jpeg', head([0xFF, 0xD8, 0xFF])],
        ['jpeg', 'image/jpeg', head([0xFF, 0xD8, 0xFF])],
        ['gif', 'image/gif', head('GIF87a')],
        ['gif', 'image/gif', head('GIF89a')],
        ['webp', 'image/webp', head('RIFF', [0, 0, 0, 0], 'WEBP')],
        ['avif', 'image/avif', head([0, 0, 0, 0x1C], 'ftypavif')],
        ['avif', 'image/avif', head([0, 0, 0, 0x1C], 'ftypavis')],
    ]

    it('each kind is accepted with its extension and its own head', () => {
        for (const [ext, mime, bytes] of ROWS) {
            expect(sniffPackFile(bytes), ext).toBe(mime)
            expect(mimeOfExtension(ext), ext).toBe(mime)
        }
    })

    it('a font head under another font extension is a different MIME, so the pairing check refuses it', () => {
        expect(sniffPackFile(head('OTTO'))).not.toBe(mimeOfExtension('ttf'))
        expect(sniffPackFile(head('wOF2'))).not.toBe(mimeOfExtension('woff'))
    })

    it('webp needs WEBP at 8, avif needs ftyp at 4 and avif or avis at 8', () => {
        expect(sniffPackFile(head('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull()
        expect(sniffPackFile(head('RIFF'))).toBeNull()
        expect(sniffPackFile(head([0, 0, 0, 0x1C], 'ftypheic'))).toBeNull()
        expect(sniffPackFile(head([0, 0, 0, 0x1C], 'moovavif'))).toBeNull()
    })

    it('a head that matches all but the last magic byte is not a match', () => {
        expect(sniffPackFile(head([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0B]))).toBeNull()
        expect(sniffPackFile(head([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x00]))).toBeNull()
        expect(sniffPackFile(head([0xFF, 0xD8, 0x00]))).toBeNull()
        expect(sniffPackFile(head([0x00, 0x01, 0x00, 0x01]))).toBeNull()
        expect(sniffPackFile(head('XXXX____WEBP'))).toBeNull()
        expect(sniffPackFile(head('tru'))).toBeNull()
        expect(sniffPackFile(head('GIF88a'))).toBeNull()
    })

    it('a head shorter than its magic is not a match', () => {
        expect(sniffPackFile(utf8('wOF'))).toBeNull()
        expect(sniffPackFile(Uint8Array.of(0x89, 0x50, 0x4E, 0x47))).toBeNull()
        expect(sniffPackFile(new Uint8Array(15))).toBeNull()
        expect(sniffPackFile(new Uint8Array(0))).toBeNull()
    })

    it('an archive, a link target, SVG text and an empty body have no allowed head', () => {
        expect(sniffPackFile(head([0x50, 0x4B, 0x03, 0x04]))).toBeNull()
        expect(sniffPackFile(head('../../etc/passwd'))).toBeNull()
        expect(sniffPackFile(head('<svg xmlns='))).toBeNull()
        expect(sniffPackFile(new Uint8Array(SNIFF_BYTES))).toBeNull()
    })

    it('an extension outside the table promises nothing, including upper-case forms and inherited names', () => {
        for (const ext of ['woff3', 'WOFF2', 'svg', 'zip', 'txt', '', 'constructor', 'toString', '__proto__']) {
            expect(mimeOfExtension(ext), ext).toBeNull()
        }
    })

    it('kindOfMime splits fonts from images', () => {
        expect(kindOfMime('font/woff2')).toBe('font')
        expect(kindOfMime('image/avif')).toBe('image')
    })
})
