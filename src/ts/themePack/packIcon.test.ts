// @vitest-environment node
/**
 * The pack icon: what `inspectIcon` reads from PNG and WebP headers, the install-time check of the icon a manifest names
 * (`checkPackIcon`, over a pack the real intake accepted), and the render-time loader that judges the stored bytes again.
 * The PNG and WebP files come from `fixtures/imageBuilder.ts` (real encoder output where an encoder emits the shape).
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { judgePackSheets } from './index'
import { intakePackBytes, type IntakeRefusal, type PackJudge } from './intake'
import {
    actlChunk, apngBytes, padPngTo, pngBytes, pngChunk, riffChunk, riffWebp, vp8Chunk, vp8lChunk, vp8xChunk,
    WEBP_ALPHA, WEBP_ANIMATED, WEBP_LOSSLESS, WEBP_LOSSY,
} from './fixtures/imageBuilder'
import { fakeFont, manifestText, validPackFiles, zipPack, type PackFile } from './fixtures/packBuilder'
import { checkPackIcon, inspectIcon, loadPackIconBlob, PACK_ICON_MAX_BYTES } from './packIcon'

/** The page store stand-in: stored bytes by key and every key asked for. */
const store = { files: new Map<string, Uint8Array>(), reads: [] as string[] }

async function readStored(key: string): Promise<Uint8Array | null> {
    store.reads.push(key)
    return store.files.get(key) ?? null
}

const judge: PackJudge = async (sheets) => judgePackSheets(sheets)

beforeEach(() => {
    store.files.clear()
    store.reads.length = 0
})

function withFlags(bytes: Uint8Array, flags: number): Uint8Array {
    const copy = bytes.slice()
    // The VP8X payload starts at offset 20 (RIFF header 12 + chunk header 8).
    copy[20] = flags
    return copy
}

describe('T3-1 inspectIcon reads the header only', () => {
    test('PNG: a still image gives its size, and an acTL chunk before or after the image data makes it animated', () => {
        expect(inspectIcon(pngBytes(24, 16), 'image/png')).toEqual({ width: 24, height: 16, animated: false })
        expect(inspectIcon(apngBytes(8, 8, 'before'), 'image/png')).toEqual({ width: 8, height: 8, animated: true })
        expect(inspectIcon(apngBytes(8, 8, 'after'), 'image/png')).toEqual({ width: 8, height: 8, animated: true })
        expect(inspectIcon(pngBytes(8, 8, { afterIdat: [actlChunk()] }), 'image/png')).toMatchObject({ animated: true })
    })

    test.each([
        ['a zero width', pngBytes(1, 1, { declaredWidth: 0 })],
        ['a zero height', pngBytes(1, 1, { declaredHeight: 0 })],
        ['a truncated IHDR', pngBytes(8, 8).subarray(0, 20)],
        ['a file with no IHDR first', (() => { const b = pngBytes(8, 8).slice(); b[12] = 0x58; return b })()],
        ['an IHDR of the wrong length', (() => { const b = pngBytes(8, 8).slice(); b[11] = 12; return b })()],
        ['a chunk that runs past the end', pngBytes(8, 8).subarray(0, pngBytes(8, 8).length - 20)],
    ])('PNG: %s is unreadable', (_label, bytes) => {
        expect(inspectIcon(bytes, 'image/png')).toBeNull()
    })

    test('PNG: more chunks than the walk bound is unreadable, never accepted unwalked', () => {
        const chunks = Array.from({ length: 4100 }, () => pngChunk('tEXt', new Uint8Array(1)))
        expect(inspectIcon(pngBytes(8, 8, { beforeIdat: chunks }), 'image/png')).toBeNull()
    })

    test('WebP: real encoder output gives its size, still for lossy, lossless and lossy with alpha (an odd ALPH chunk is padded)', () => {
        expect(inspectIcon(WEBP_LOSSY, 'image/webp')).toEqual({ width: 24, height: 16, animated: false })
        expect(inspectIcon(WEBP_LOSSLESS, 'image/webp')).toEqual({ width: 24, height: 16, animated: false })
        expect(inspectIcon(WEBP_ALPHA, 'image/webp')).toEqual({ width: 24, height: 16, animated: false })
    })

    test('WebP: the ALPH chunk of the alpha fixture has an odd size, so a walk that ignores the pad byte would misread the next header', () => {
        // The first chunk is VP8X (10 bytes), then ALPH at offset 30 with its size at 34.
        expect(new TextDecoder().decode(WEBP_ALPHA.subarray(30, 34))).toBe('ALPH')
        const size = new DataView(WEBP_ALPHA.buffer, WEBP_ALPHA.byteOffset).getUint32(34, true)
        expect(size % 2).toBe(1)
        expect(new TextDecoder().decode(WEBP_ALPHA.subarray(38 + size + 1, 38 + size + 5))).toBe('VP8 ')
    })

    test('WebP: an animation is animated by its flag, its ANIM chunk and its ANMF chunks', () => {
        expect(inspectIcon(WEBP_ANIMATED, 'image/webp')).toEqual({ width: 24, height: 16, animated: true })
        // ANMF chunks without the flag are still animated.
        expect(inspectIcon(withFlags(WEBP_ANIMATED, 0), 'image/webp')).toEqual({ width: 24, height: 16, animated: true })
        // The flag alone, over a still image, is animated.
        expect(inspectIcon(withFlags(WEBP_ALPHA, 0x12), 'image/webp')).toEqual({ width: 24, height: 16, animated: true })
    })

    test('WebP: hand-assembled headers are read at their chunk-relative offsets, the 14-bit masks and the +1 fields', () => {
        expect(inspectIcon(riffWebp([vp8Chunk(300, 200)]), 'image/webp')).toEqual({ width: 300, height: 200, animated: false })
        expect(inspectIcon(riffWebp([vp8lChunk(513, 7)]), 'image/webp')).toEqual({ width: 513, height: 7, animated: false })
        expect(inspectIcon(riffWebp([vp8xChunk(600, 600), vp8Chunk(600, 600)]), 'image/webp')).toEqual({ width: 600, height: 600, animated: false })
        expect(inspectIcon(riffWebp([vp8xChunk(33, 9), riffChunk('EXIF', new Uint8Array(3)), vp8lChunk(33, 9)]), 'image/webp')).toEqual({ width: 33, height: 9, animated: false })
    })

    test.each([
        ['a RIFF size that is not the length minus 8', riffWebp([vp8Chunk(8, 8)], 2)],
        ['a zero VP8 width', riffWebp([vp8Chunk(0, 8)])],
        ['an unknown first chunk', riffWebp([riffChunk('EXIF', new Uint8Array(8)), vp8Chunk(8, 8)])],
        ['a VP8X with no image chunk', riffWebp([vp8xChunk(8, 8)])],
        ['a VP8X whose image chunk gives another size', riffWebp([vp8xChunk(8, 8), vp8Chunk(9, 8)])],
        ['a chunk that runs past the end', WEBP_LOSSY.subarray(0, WEBP_LOSSY.length - 10)],
        ['a truncated header', WEBP_LOSSY.subarray(0, 14)],
        ['a PNG under the WebP type', pngBytes(8, 8)],
    ])('WebP: %s is unreadable', (_label, bytes) => {
        expect(inspectIcon(bytes, 'image/webp')).toBeNull()
    })
})

//#region install-time check

const CHAT_SHEET = '[data-part="chat-message-avatar"]{opacity:1}'

async function acceptedPack(icon: string, files: Record<string, PackFile>, extraManifest: Record<string, unknown> = {}) {
    const archive = zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'manifest.json': manifestText({ icon, ...extraManifest }), ...files }))
    const result = await intakePackBytes(archive, judge)
    if (result.ok === false) {
        throw new Error(`the fixture pack was refused: ${JSON.stringify(result.refusals)}`)
    }
    return { archive, pack: result.pack }
}

async function refusalOf(icon: string, files: Record<string, PackFile>, extraManifest: Record<string, unknown> = {}): Promise<IntakeRefusal> {
    const { archive, pack } = await acceptedPack(icon, files, extraManifest)
    const checked = await checkPackIcon(archive, pack, icon)
    if (checked.ok === true) {
        throw new Error('the icon was accepted')
    }
    return checked.refusal
}

describe('T3-1 checkPackIcon', () => {
    test.each([
        ['a PNG', 'images/icon.png', pngBytes(24, 16), 'png'],
        ['a lossy WebP', 'images/icon.webp', WEBP_LOSSY, 'webp'],
        ['a lossless WebP', 'images/icon.webp', WEBP_LOSSLESS, 'webp'],
        ['a WebP with alpha', 'images/icon.webp', WEBP_ALPHA, 'webp'],
        ['a 512 x 512 PNG', 'images/icon.png', pngBytes(512, 512), 'png'],
    ])('%s is accepted and the bytes returned are the file as stored', async (_label, path, bytes, ext) => {
        const { archive, pack } = await acceptedPack(path, { [path]: bytes })

        const checked = await checkPackIcon(archive, pack, path)

        expect(checked).toEqual({ ok: true, bytes, ext })
    })

    test('a PNG of exactly 262144 bytes is accepted and one of 262145 is refused as too large, before it is read', async () => {
        const base = pngBytes(8, 8)
        const exact = padPngTo(base, PACK_ICON_MAX_BYTES)
        expect(exact.length).toBe(262144)
        const accepted = await acceptedPack('images/icon.png', { 'images/icon.png': exact })
        expect(await checkPackIcon(accepted.archive, accepted.pack, 'images/icon.png')).toMatchObject({ ok: true })

        const over = padPngTo(base, PACK_ICON_MAX_BYTES + 1)
        expect(await refusalOf('images/icon.png', { 'images/icon.png': over })).toEqual({ code: 'iconTooLarge', limitBytes: 262144 })
    })

    test.each([
        ['an icon the pack does not hold', 'images/missing.png', {}, { code: 'iconMissing' }],
        ['a font file', 'fonts/x.woff2', { 'fonts/x.woff2': fakeFont() }, { code: 'iconType' }],
        ['a path outside images/', 'icon.png', {}, { code: 'iconType' }],
        ['a PNG-named path in fonts/', 'fonts/a.png', {}, { code: 'iconType' }],
        ['a path that climbs out of images/', 'images/../icon.png', {}, { code: 'iconType' }],
        ['an SVG path', 'images/icon.svg', {}, { code: 'iconType' }],
        ['a JPEG', 'images/icon.jpg', { 'images/icon.jpg': Uint8Array.of(0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46, 0) }, { code: 'iconType' }],
        ['a PNG 513 wide', 'images/icon.png', { 'images/icon.png': pngBytes(513, 1) }, { code: 'iconDimensions', limitPx: 512 }],
        ['a PNG 513 tall', 'images/icon.png', { 'images/icon.png': pngBytes(1, 513) }, { code: 'iconDimensions', limitPx: 512 }],
        ['a PNG that declares 30000 x 30000', 'images/icon.png', { 'images/icon.png': pngBytes(1, 1, { declaredWidth: 30000, declaredHeight: 30000 }) }, { code: 'iconDimensions', limitPx: 512 }],
        ['a PNG of width 0', 'images/icon.png', { 'images/icon.png': pngBytes(1, 1, { declaredWidth: 0 }) }, { code: 'iconUnreadable' }],
        ['a PNG with a truncated IHDR', 'images/icon.png', { 'images/icon.png': pngBytes(8, 8).subarray(0, 20) }, { code: 'iconUnreadable' }],
        ['a VP8X WebP 600 x 600', 'images/icon.webp', { 'images/icon.webp': riffWebp([vp8xChunk(600, 600), vp8Chunk(600, 600)]) }, { code: 'iconDimensions', limitPx: 512 }],
        ['a VP8L WebP 513 wide', 'images/icon.webp', { 'images/icon.webp': riffWebp([vp8lChunk(513, 8)]) }, { code: 'iconDimensions', limitPx: 512 }],
        ['an APNG with acTL before the image data', 'images/icon.png', { 'images/icon.png': apngBytes(8, 8, 'before') }, { code: 'iconAnimated' }],
        ['an APNG with acTL after the image data', 'images/icon.png', { 'images/icon.png': apngBytes(8, 8, 'after') }, { code: 'iconAnimated' }],
        ['a WebP with the animation flag over a still image', 'images/icon.webp', { 'images/icon.webp': withFlags(WEBP_ALPHA, 0x12) }, { code: 'iconAnimated' }],
        ['an animated WebP', 'images/icon.webp', { 'images/icon.webp': WEBP_ANIMATED }, { code: 'iconAnimated' }],
        ['ANMF chunks without the flag', 'images/icon.webp', { 'images/icon.webp': withFlags(WEBP_ANIMATED, 0) }, { code: 'iconAnimated' }],
        ['a WebP whose RIFF size is not the length minus 8', 'images/icon.webp', { 'images/icon.webp': riffWebp([vp8Chunk(8, 8)], 2) }, { code: 'iconUnreadable' }],
    ] satisfies Array<[string, string, Record<string, PackFile>, IntakeRefusal]>)('T3-1: %s is refused with its reason', async (_label, path, files, expected) => {
        const fontManifest = path.endsWith('.woff2') ? { fonts: [{ file: path, license: 'OFL-1.1' }] } : {}
        expect(await refusalOf(path, files, fontManifest)).toEqual(expected)
    })

    test.each([
        ['an images/ file whose content is WebP under .png', { 'images/x.png': WEBP_LOSSY }, 'images/x.png', 'wrongContent'],
        ['an SVG in the pack', { 'images/x.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' }, 'images/x.svg', 'svg'],
        ['a path that leaves the archive root', { '../a.png': pngBytes(8, 8) }, '../a.png', 'unsafeName'],
        ['a font under a .png name', { 'fonts/a.png': pngBytes(8, 8) }, 'fonts/a.png', 'unknownFile'],
    ])('T3-1g: %s is already refused by the intake, with the same code as before', async (_label, files, icon, code) => {
        const archive = zipPack(validPackFiles({ 'chat.css': CHAT_SHEET, 'manifest.json': manifestText({ icon }), ...files }))

        const result = await intakePackBytes(archive, judge)

        expect(result.ok).toBe(false)
        expect(result.ok === false && result.refusals.map((refusal) => refusal.code)).toContain(code)
    })
})

//#endregion

//#region render-time loader

const KEY_PNG = `assets/tp-${'a'.repeat(64)}.png`
const KEY_WEBP = `assets/tp-${'b'.repeat(64)}.webp`

describe('T3-6 loadPackIconBlob returns a Blob only for stored bytes that pass', () => {
    test('a valid PNG and a valid WebP each give a Blob of the matching type holding the stored bytes', async () => {
        store.files.set(KEY_PNG, pngBytes(24, 16))
        store.files.set(KEY_WEBP, WEBP_ALPHA)

        const png = await loadPackIconBlob(KEY_PNG, readStored)
        const webp = await loadPackIconBlob(KEY_WEBP, readStored)

        expect(png?.type).toBe('image/png')
        expect(new Uint8Array(await png!.arrayBuffer())).toEqual(pngBytes(24, 16))
        expect(webp?.type).toBe('image/webp')
        expect(new Uint8Array(await webp!.arrayBuffer())).toEqual(WEBP_ALPHA)
    })

    test.each([
        ['a 30000 x 30000 IHDR', KEY_PNG, pngBytes(1, 1, { declaredWidth: 30000, declaredHeight: 30000 })],
        ['a 513-wide PNG', KEY_PNG, pngBytes(513, 1)],
        ['a 513-tall PNG', KEY_PNG, pngBytes(1, 513)],
        ['a PNG that declares 1 x 30000', KEY_PNG, pngBytes(1, 1, { declaredHeight: 30000 })],
        ['an APNG', KEY_PNG, apngBytes(8, 8)],
        ['an APNG with acTL after the image data', KEY_PNG, apngBytes(8, 8, 'after')],
        ['a PNG of 262145 bytes', KEY_PNG, padPngTo(pngBytes(8, 8), 262145)],
        ['WebP bytes under a .png key', KEY_PNG, WEBP_LOSSY],
        ['PNG bytes under a .webp key', KEY_WEBP, pngBytes(8, 8)],
        ['an animated WebP', KEY_WEBP, WEBP_ANIMATED],
        ['a 600 x 600 WebP', KEY_WEBP, riffWebp([vp8xChunk(600, 600), vp8Chunk(600, 600)])],
        ['an SVG under a .png key', KEY_PNG, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
        ['a truncated PNG', KEY_PNG, pngBytes(8, 8).subarray(0, 30)],
    ])('T3-6h: %s gives null', async (_label, key, bytes) => {
        store.files.set(key, bytes)

        expect(await loadPackIconBlob(key, readStored)).toBeNull()
    })

    test('T3-6h: a PNG of exactly 262144 bytes still loads', async () => {
        store.files.set(KEY_PNG, padPngTo(pngBytes(8, 8), 262144))

        expect(await loadPackIconBlob(KEY_PNG, readStored)).not.toBeNull()
    })

    test.each([
        ['a user asset key', 'assets/6f2f1c0e9e5d4c8a.png'],
        ['a .risutheme key', `assets/tp-${'a'.repeat(64)}.risutheme`],
        ['an .svg key', `assets/tp-${'a'.repeat(64)}.svg`],
        ['an upper-case hash', `assets/tp-${'A'.repeat(64)}.png`],
        ['a short hash', 'assets/tp-x.png'],
        ['a traversal', `assets/../assets/tp-${'a'.repeat(64)}.png`],
        ['an empty key', ''],
    ])('T3-6h: %s is never read from the store', async (_label, key) => {
        store.files.set(key, pngBytes(8, 8))

        expect(await loadPackIconBlob(key, readStored)).toBeNull()
        expect(store.reads).toEqual([])
    })

    test('a key the store has no bytes for gives null, and a store that throws gives null', async () => {
        expect(await loadPackIconBlob(KEY_PNG, readStored)).toBeNull()
        store.files.set(KEY_WEBP, WEBP_LOSSY)
        const original = store.files.get.bind(store.files)
        store.files.get = () => { throw new Error('store failed') }
        expect(await loadPackIconBlob(KEY_WEBP, readStored)).toBeNull()
        store.files.get = original
    })
})

//#endregion
