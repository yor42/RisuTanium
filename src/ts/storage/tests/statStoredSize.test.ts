// @vitest-environment node
/**
 * `statStoredSize` against the `read_range` stand-in of `tauriChunkFake`: the
 * size comes from a zero-length ranged read, so the request asks for no bytes
 * and the reply is the trailer alone. The fake follows the Rust command's
 * clamp and trailer; a pass is not evidence about the Rust command itself.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const chunk = (await import('src/ts/storage/tests/tauriChunkFake')).createChunkedInvoke(fs)
    return { fs, chunk }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.chunk.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

import { MISSING_FILE_ERROR, statStoredSize } from 'src/ts/storage/tauriByteTransport'

function patterned(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + 3) % 256)
}

beforeEach(() => {
    h.fs.reset()
    h.chunk.reset()
})

describe('statStoredSize', () => {
    test('asks for zero bytes at offset 0 and answers the stored size', async () => {
        h.fs.files.set('assets/small', patterned(1234))
        const asked: { offset: number, len: number }[] = []
        h.chunk.hooks.before = ({ offset, len }) => { asked.push({ offset, len }) }

        expect(await statStoredSize('assets/small')).toBe(1234)

        expect(asked).toEqual([{ offset: 0, len: 0 }])
    })

    test('an empty file has size 0', async () => {
        h.fs.files.set('assets/empty', new Uint8Array(0))

        expect(await statStoredSize('assets/empty')).toBe(0)
    })

    test('a file larger than a piece is not read: the size is still the stored length', async () => {
        h.fs.files.set('assets/larger', patterned(300 * 1024))
        let capped = false
        h.chunk.hooks.limit = () => { capped = true; return 0 }

        expect(await statStoredSize('assets/larger')).toBe(300 * 1024)
        expect(capped).toBe(true)
    })

    test('a missing file rejects with the command error that MISSING_FILE_ERROR matches', async () => {
        // Tauri rejects an invoke with the command's error text.
        const error = await statStoredSize('assets/absent').then(() => null, (e: unknown) => e)

        expect(error).not.toBeNull()
        expect(MISSING_FILE_ERROR.test(String(error))).toBe(true)
    })

    test('a directory rejects with the command error, which is not a missing file', async () => {
        h.fs.directories.add('assets/folder')

        const error = await statStoredSize('assets/folder').then(() => null, (e: unknown) => e)

        expect(String(error)).toContain('Is a directory (os error 21)')
        expect(MISSING_FILE_ERROR.test(String(error))).toBe(false)
    })
})
