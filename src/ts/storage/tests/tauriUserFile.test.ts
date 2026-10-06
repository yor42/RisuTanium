/**
 * `readUserFile` and `writeUserFile` (`src/ts/storage/tauriUserFile.ts`) against
 * the in-memory plugin stand-in with a per-call cap (`tauriDesktopFake.ts`): on
 * desktop a read is an open plus reads of at most `CHUNK_MAX` bytes (the
 * plugin may answer fewer than asked) and a write above `CHUNK_MAX` is a create
 * followed by appends; every other platform keeps its single call. A pass is
 * not evidence about the plugin or the web view's memory behaviour.
 *
 * Tests titled "per-call bound" fail against the whole-file `readFile` and
 * `writeFile` calls the helpers replace.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const CAP = 4 * 1024 * 1024

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs()
    const bounded = (await import('src/ts/storage/tests/tauriDesktopFake')).createBoundedFs(fs, { cap: 4 * 1024 * 1024 })
    const state = { os: 'windows' }
    return { fs, bounded, state }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.state.os }))

import { readUserFile, writeUserFile } from 'src/ts/storage/tauriUserFile'

const PATH = 'C:/Users/u/Documents/big.charx'

function patterned(length: number, seed = 1): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 11 + seed) % 251)
}

function same(actual: Uint8Array | undefined, expected: Uint8Array): boolean {
    return actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

beforeEach(() => {
    h.fs.reset()
    h.bounded.reset()
    h.state.os = 'windows'
})

describe('readUserFile on desktop', () => {
    test('a small file is one open, one read and one close, with the bytes exactly', async () => {
        h.fs.plant(PATH, patterned(100))

        const read = await readUserFile(PATH)

        expect(same(read, patterned(100))).toBe(true)
        expect(h.bounded.opened).toEqual([PATH])
        expect(h.bounded.readSizes).toEqual([CAP, CAP])
        expect(h.bounded.openHandles()).toBe(0)
        expect(h.fs.calls.filter((call) => call.op === 'readFile')).toEqual([])
    })

    test('per-call bound: a file of several pieces is read with buffers of at most CHUNK_MAX and joined in order', async () => {
        const bytes = patterned(CAP * 2 + 123)
        h.fs.plant(PATH, bytes)

        const read = await readUserFile(PATH)

        expect(same(read, bytes)).toBe(true)
        expect(Math.max(...h.bounded.readSizes)).toBeLessThanOrEqual(CAP)
        expect(h.bounded.openHandles()).toBe(0)
    })

    test.each([CAP, CAP + 1])('a file of %i bytes comes back exactly', async (length) => {
        const bytes = patterned(length)
        h.fs.plant(PATH, bytes)

        expect(same(await readUserFile(PATH), bytes)).toBe(true)
    })

    test('an empty file comes back as zero bytes', async () => {
        h.fs.plant(PATH, new Uint8Array(0))

        expect((await readUserFile(PATH)).length).toBe(0)
        expect(h.bounded.openHandles()).toBe(0)
    })

    test('a read that answers fewer bytes than asked is continued from where it stopped', async () => {
        const bytes = patterned(1000)
        h.fs.plant(PATH, bytes)
        h.bounded.limitReads(64)

        const read = await readUserFile(PATH)

        expect(same(read, bytes)).toBe(true)
        expect(h.bounded.readSizes.length).toBe(Math.ceil(1000 / 64) + 1)
    })

    test('a read error rejects with that error and still closes the handle, even when the close fails too', async () => {
        h.fs.plant(PATH, patterned(100))
        h.bounded.failReads(() => 'Access is denied. (os error 5)')
        h.bounded.failCloses('close error')

        await expect(readUserFile(PATH)).rejects.toBe('Access is denied. (os error 5)')

        expect(h.bounded.openHandles()).toBe(0)
    })

    test('a missing file rejects with the open error and holds no handle', async () => {
        await expect(readUserFile('C:/nowhere/x.charx')).rejects.toEqual(expect.stringMatching(/\(os error 2\)$/))

        expect(h.bounded.openHandles()).toBe(0)
    })

    test('a close that fails after a clean read does not fail the read', async () => {
        h.fs.plant(PATH, patterned(10))
        h.bounded.failCloses('close error')

        expect(same(await readUserFile(PATH), patterned(10))).toBe(true)
    })
})

describe('readUserFile outside desktop', () => {
    test.each(['android', 'ios', 'throws'])('with the operating system %s the file is read by one plugin readFile call', async (os) => {
        h.state.os = os
        const bytes = patterned(CAP / 2)
        h.fs.plant(PATH, bytes)

        const read = await readUserFile(PATH)

        expect(same(read, bytes)).toBe(true)
        expect(h.fs.calls.filter((call) => call.op === 'readFile')).toHaveLength(1)
        expect(h.bounded.opened).toEqual([])
    })
})

describe('writeUserFile', () => {
    const DOWNLOAD = 1

    test('a body of at most CHUNK_MAX is one writeFile call that truncates', async () => {
        await writeUserFile('out.bin', patterned(CAP), DOWNLOAD)

        expect(h.bounded.writeSizes).toEqual([CAP])
        expect(h.fs.writeLog.map((write) => write.options)).toEqual([{ baseDir: DOWNLOAD }])
    })

    test('per-call bound: a larger body is a first call that creates and appends of at most CHUNK_MAX, in order', async () => {
        const bytes = patterned(CAP * 2 + 9)

        await writeUserFile('out.bin', bytes, DOWNLOAD)

        expect(h.bounded.writeSizes).toEqual([CAP, CAP, 9])
        expect(same(h.fs.files.get('out.bin'), bytes)).toBe(true)
    })

    test('the first call does not append and every later one does', async () => {
        const seen: Array<boolean | undefined> = []
        const original = h.bounded.module.writeFile
        h.bounded.module.writeFile = async (path, data, options) => {
            seen.push((options as { append?: boolean } | undefined)?.append)
            await original(path, data, options)
        }
        try {
            await writeUserFile('out.bin', patterned(CAP + 1), DOWNLOAD)
        } finally {
            h.bounded.module.writeFile = original
        }

        expect(seen).toEqual([false, true])
    })

    test('a body above CHUNK_MAX stays one call on a platform that is not desktop (the cap of the stand-in refuses that call)', async () => {
        h.state.os = 'android'

        await expect(writeUserFile('out.bin', patterned(CAP + 1), DOWNLOAD)).rejects.toThrow(/above the per-call bound/)

        expect(h.bounded.writeSizes).toEqual([CAP + 1])
    })
})
