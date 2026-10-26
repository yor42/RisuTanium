// @vitest-environment node
/**
 * The text range read of a frozen-safe key (CHORE-166 stage 2B): the strict base64 decoder, the predicate that selects the
 * frozen-page paths, and which command a ranged read uses. The commands are the stand-ins of `tauriChunkFake`; a pass is
 * not evidence about the Rust commands.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const chunk = (await import('src/ts/storage/tests/tauriChunkFake')).createChunkedInvoke(fs)
    const os = { kind: 'android' as 'android' | 'windows' | 'web' }
    return { fs, chunk, os }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.chunk.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (h.os.kind === 'web') {
            throw new Error('no operating-system plugin')
        }
        return h.os.kind
    },
}))

import {
    base64ToBytes, bytesToBase64, readRanged, shouldBypassFrozenPagePaths, TEXT_RANGE_MAX_BYTES, RANGE_TRAILER_BYTES,
} from 'src/ts/storage/tauriByteTransport'

function patterned(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + 3) % 256)
}

function hide(hidden: boolean): void {
    vi.stubGlobal('document', { visibilityState: hidden ? 'hidden' : 'visible' })
}

beforeEach(() => {
    h.fs.reset()
    h.chunk.reset()
    h.os.kind = 'android'
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('base64ToBytes', () => {
    test.each([0, 1, 2, 3, 4, 5, 56, 57, 58, 1000])('decodes %i bytes byte-exact, as Buffer does', (length) => {
        const bytes = patterned(length)
        const decoded = base64ToBytes(Buffer.from(bytes).toString('base64'))
        expect(Array.from(decoded)).toEqual(Array.from(bytes))
        expect(decoded.length).toBe(length)
    })

    test('round-trips one megabyte with the page encoder, into an array of exactly its size', () => {
        const bytes = patterned(1024 * 1024 + 2)
        const decoded = base64ToBytes(bytesToBase64(bytes))
        expect(decoded.length).toBe(bytes.length)
        expect(decoded.buffer.byteLength).toBe(bytes.length)
        expect(Buffer.from(decoded).equals(Buffer.from(bytes))).toBe(true)
    })

    test.each([
        ['an invalid character', 'AB*D'],
        ['whitespace', 'AB D'],
        ['a character beyond Latin-1', 'ABŁD'],
        ['a length that is not a multiple of four', 'ABC'],
        ['padding before the end', 'A=BC'],
        ['url-safe alphabet', 'AB-_'],
    ])('refuses %s', (_name, text) => {
        expect(() => base64ToBytes(text)).toThrow()
    })
})

describe('shouldBypassFrozenPagePaths', () => {
    test.each([
        ['android', true, true],
        ['android', false, false],
        ['windows', true, false],
        ['windows', false, false],
        ['web', true, false],
        ['web', false, false],
    ] as const)('on %s with the page hidden=%s answers %s', (kind, hidden, expected) => {
        h.os.kind = kind
        hide(hidden)
        expect(shouldBypassFrozenPagePaths()).toBe(expected)
    })

    test('answers false, and does not throw, where there is no document', () => {
        vi.stubGlobal('document', undefined)
        expect(shouldBypassFrozenPagePaths()).toBe(false)
    })
})

describe('readRanged with a frozen-safe key', () => {
    const commands = () => h.chunk.calls.map((call) => call.command)

    test('a hidden Android page reads a small key over the text command and gets exactly the file', async () => {
        const file = patterned(300)
        h.fs.files.set('store2-commit', file)
        hide(true)

        const bytes = await readRanged('store2-commit', undefined, { frozenSafe: true })

        expect(Array.from(bytes)).toEqual(Array.from(file))
        expect(commands()).toEqual(['read_range_text'])
    })

    test('a visible page, a key that is not marked, and the desktop keep read_range', async () => {
        h.fs.files.set('store2-commit', patterned(300))
        hide(false)
        await readRanged('store2-commit', undefined, { frozenSafe: true })
        hide(true)
        await readRanged('store2-commit')
        h.os.kind = 'windows'
        await readRanged('store2-commit', undefined, { frozenSafe: true })

        expect(commands()).toEqual(['read_range', 'read_range', 'read_range'])
    })

    test('a missing key rejects with the command error that ends in the os error', async () => {
        hide(true)
        await expect(readRanged('store2-commit', undefined, { frozenSafe: true })).rejects.toMatch(/\(os error 2\)\s*$/)
        expect(commands()).toEqual(['read_range_text'])
    })

    test('a file just over the cap continues in text pieces up to the cap', async () => {
        const file = patterned(TEXT_RANGE_MAX_BYTES + 1000)
        h.fs.files.set('store2-commit', file)
        hide(true)

        const bytes = await readRanged('store2-commit', undefined, { frozenSafe: true })

        expect(Buffer.from(bytes).equals(Buffer.from(file))).toBe(true)
        expect(commands()).toEqual(['read_range_text', 'read_range_text'])
        expect(h.chunk.callsOf('read_range_text').map((call) => call.args.len)).toEqual([TEXT_RANGE_MAX_BYTES, 1000])
    })

    // The cap check keeps a large remainder off the text command: it goes to the raw read, which a frozen page cannot receive.
    test('above the cap the rest of the file is read with read_range, never read_range_text', async () => {
        const file = patterned(3 * TEXT_RANGE_MAX_BYTES + 5)
        h.fs.files.set('store2-commit', file)
        hide(true)

        const bytes = await readRanged('store2-commit', undefined, { frozenSafe: true })

        expect(Buffer.from(bytes).equals(Buffer.from(file))).toBe(true)
        expect(commands()).toEqual(['read_range_text', 'read_range'])
        const rest = h.chunk.callsOf('read_range')[0].args
        expect(rest.len).toBe(2 * TEXT_RANGE_MAX_BYTES + 5)
        expect(h.chunk.callsOf('read_range_text')[0].args.len).toBe(TEXT_RANGE_MAX_BYTES)
    })

    test('the 56-byte trailer survives the text path: size and identity are checked between pieces', async () => {
        const file = patterned(TEXT_RANGE_MAX_BYTES + 100)
        h.fs.files.set('store2-commit', file)
        hide(true)
        // The file is replaced before every second piece: the identity in its trailer differs from the first piece's.
        h.chunk.hooks.before = ({ index }) => {
            if (index % 2 === 1) {
                h.fs.files.set('store2-commit', patterned(TEXT_RANGE_MAX_BYTES + 100))
            }
        }

        // The read restarts at most twice and then rejects; a decoder that dropped the trailer would not notice the change.
        await expect(readRanged('store2-commit', undefined, { frozenSafe: true })).rejects.toThrow(/changed while it was read/)
        expect(RANGE_TRAILER_BYTES).toBe(56)
    })
})
