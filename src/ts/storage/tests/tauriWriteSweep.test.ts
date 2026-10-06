/**
 * `sweepAllWriteTemps` (`src/ts/storage/tauriAtomicWrite.ts`), the boot sweep of the
 * `risu-write-<id>.tmp` files an atomic or chunked write leaves behind when its page
 * dies: every directory a store key can live in is swept, nested ones included, and
 * so is the AppData root. The file system is the strict in-memory fake and the chunk
 * commands are `tauriDesktopFake.ts`; a pass is not evidence about the real plugin.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fs)
    return { fs, desktop }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'windows' }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.desktop.invoke }))

import { createChunkedWriter } from 'src/ts/storage/tauriByteTransport'
import { sweepAllWriteTemps, WRITE_TEMP_DIRECTORIES } from 'src/ts/storage/tauriAtomicWrite'

const TEMP = 'risu-write-0123456789abcdef.tmp'
const BYTES = Uint8Array.from([1, 2, 3])

function temps(): string[] {
    return Array.from(h.fs.files.keys()).filter((key) => /risu-write-[0-9a-f]{16}\.tmp$/.test(key))
}

beforeEach(() => {
    h.fs.reset()
    h.desktop.reset()
    vi.restoreAllMocks()
})

describe('sweepAllWriteTemps', () => {
    test('removes a temp in every directory a key can live in, at any depth, and in the AppData root', async () => {
        const planted = [
            TEMP,
            `database/${TEMP}`,
            `remotes/${TEMP}`,
            `coldstorage/${TEMP}`,
            `blocks/${TEMP}`,
            `blocks/gen/c/${TEMP}`,
            `assets/${TEMP}`,
            `assets/nested/deeper/${TEMP}`,
        ]
        for (const key of planted) {
            h.fs.plant(key, BYTES)
        }

        await sweepAllWriteTemps()

        expect(temps()).toEqual([])
    })

    test('names the directories it covers: database, remotes, coldstorage, blocks and assets', () => {
        expect([...WRITE_TEMP_DIRECTORIES].sort()).toEqual(['assets', 'blocks', 'coldstorage', 'database', 'remotes'])
    })

    test('keeps every file that is not a write temp, including names that merely look like one', async () => {
        const keep = [
            'database/database.bin',
            'database/dbbackup-17909517188.bin',
            'blocks/head',
            'blocks/gen/c/6162',
            'assets/abc.png',
            'assets/nested/abc.png',
            'idle-reload-handoff.json',
            'assets/risu-write-0123.tmp',
            'assets/risu-write-0123456789ABCDEF.tmp',
            'assets/xrisu-write-0123456789abcdef.tmp',
            'assets/risu-write-0123456789abcdef.tmp.bak',
        ]
        for (const key of keep) {
            h.fs.plant(key, BYTES)
        }
        h.fs.plant(`assets/${TEMP}`, BYTES)

        await sweepAllWriteTemps()

        for (const key of keep) {
            expect(h.fs.files.has(key), key).toBe(true)
        }
        expect(h.fs.files.has(`assets/${TEMP}`)).toBe(false)
    })

    test('directories that do not exist yet are skipped without an error and without a listing of them', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })

        await sweepAllWriteTemps()

        expect(logged).not.toHaveBeenCalled()
        expect(h.fs.calls.filter((call) => call.op === 'readDir').map((call) => call.path)).toEqual(['.'])
    })

    test('does not descend into the root: a temp inside an unrelated directory stays', async () => {
        h.fs.plant(`other/${TEMP}`, BYTES)

        await sweepAllWriteTemps()

        expect(h.fs.files.has(`other/${TEMP}`)).toBe(true)
    })

    test('a temp that cannot be removed is logged, the others are still removed, and the sweep resolves', async () => {
        h.fs.plant(`assets/${TEMP}`, BYTES)
        h.fs.plant(`blocks/gen/${TEMP}`, BYTES)
        h.fs.failRemoves('Access is denied. (os error 5)', (path) => path.startsWith('assets/'))
        const logged = vi.spyOn(console, 'error').mockImplementation(() => { })

        await expect(sweepAllWriteTemps()).resolves.toBeUndefined()

        expect(h.fs.files.has(`blocks/gen/${TEMP}`)).toBe(false)
        expect(h.fs.files.has(`assets/${TEMP}`)).toBe(true)
        expect(logged).toHaveBeenCalled()
    })
})

describe('the temp of an abandoned chunked write', () => {
    test('left under a nested asset directory by a page that died after chunk 0, it is removed at the next boot and the key is untouched', async () => {
        h.fs.plant('assets/nested/old.bin', Uint8Array.from([9, 9]))
        const writer = createChunkedWriter('assets/nested/old.bin', { durable: true, chunkBytes: 4 })
        await writer.write(new Uint8Array(12))
        // The page dies here: no finish, no abort.
        expect(temps()).toHaveLength(1)
        expect(temps()[0].startsWith('assets/nested/')).toBe(true)

        await sweepAllWriteTemps()

        expect(temps()).toEqual([])
        expect(Array.from(h.fs.files.get('assets/nested/old.bin') ?? [])).toEqual([9, 9])
    })

    test('the temp of an abandoned durable write under blocks and an abandoned atomic write at the root are removed too', async () => {
        const blocks = createChunkedWriter('blocks/gen/c/6162', { durable: true, chunkBytes: 4 })
        await blocks.write(new Uint8Array(12))
        const root = createChunkedWriter('idle-reload-handoff.json', { durable: false, chunkBytes: 4 })
        await root.write(new Uint8Array(12))
        expect(temps()).toHaveLength(2)

        await sweepAllWriteTemps()

        expect(temps()).toEqual([])
    })
})
