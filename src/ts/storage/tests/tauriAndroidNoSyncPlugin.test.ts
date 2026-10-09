/**
 * Android: the byte store and the write sweep reach the Tauri side without a
 * synchronous plugin command that waits for the UI thread.
 *
 * The real `@tauri-apps/plugin-fs` and `@tauri-apps/api/path` JavaScript runs
 * over the in-memory IPC boundary of `tauriWireFake.ts`, so a call through any
 * import path or wrapper is seen at the wire. The assertions are on the
 * recorded commands, never on a thrown error: the store swallows some of them.
 *
 * Coverage is the scenarios below (the byte store, the write sweep and the
 * atomic write); an Android caller outside them is not detected. A pass says
 * nothing about the native shell.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ANDROID_ALLOWED_PLUGIN_COMMANDS, installTauriWire, WAITING_PLUGIN_COMMANDS, type TauriWire } from './tauriWireFake'

let wire: TauriWire

beforeEach(() => {
    wire = installTauriWire({ os: 'android' })
})

afterEach(() => {
    wire.uninstall()
})

async function newStore() {
    const { createTauriFilesStore } = await import('src/ts/storage/store/tauriFilesStore')
    return createTauriFilesStore({ platform: 'posix' })
}

function body(length = 8): Uint8Array {
    return Uint8Array.from({ length }, (_, index) => (index * 7 + 3) % 251)
}

/** The two properties every scenario must keep, asserted from the recorded commands. */
function expectNoWaitingPluginCommand(): void {
    const used = wire.plugin()
    expect(used.filter((cmd) => WAITING_PLUGIN_COMMANDS.includes(cmd))).toEqual([])
    expect(used.filter((cmd) => !ANDROID_ALLOWED_PLUGIN_COMMANDS.includes(cmd))).toEqual([])
}

function appFsKeys(cmd: string): unknown[] {
    return wire.callsOf(cmd).map((call) => (call.args as { key?: unknown }).key)
}

describe('the Tauri byte store on Android sends no waiting plugin command', () => {
    test('reading an absent key answers absent', async () => {
        const store = await newStore()

        const result = await store.read('database/missing.bin')

        expectNoWaitingPluginCommand()
        expect(result.bytes).toBeNull()
        expect(appFsKeys('app_fs_exists')).toEqual(['database/missing.bin'])
    })

    test('writing a plain key into a folder creates the folder through the app command', async () => {
        const store = await newStore()

        await store.write('inlays/pic.png', body(), 'unconditional')

        expectNoWaitingPluginCommand()
        expect(appFsKeys('app_fs_mkdir_all')).toEqual(['inlays'])
        expect(wire.fs.files.get('inlays/pic.png')).toEqual(body())
    })

    test('writing a durable key sends no plugin command at all', async () => {
        const store = await newStore()

        await store.write('blocks/gen/c/6162', body(), 'unconditional')

        expect(wire.fs.files.get('blocks/gen/c/6162')).toEqual(body())
        expect(wire.plugin()).toEqual([])
    })

    test('deleting a present key and an absent key', async () => {
        const store = await newStore()
        wire.fs.plant('assets/a.png', body())

        await store.delete('assets/a.png', 'unconditional')
        await store.delete('assets/b.png', 'unconditional')

        expectNoWaitingPluginCommand()
        expect(wire.fs.files.has('assets/a.png')).toBe(false)
        expect(appFsKeys('app_fs_remove')).toEqual(['assets/a.png', 'assets/b.png'])
        expect(appFsKeys('app_fs_exists')).toEqual(['assets/b.png'])
    })

    test('deleting a mixed set removes the present keys and counts the absent ones as removed', async () => {
        const store = await newStore()
        wire.fs.plant('blocks/g1/a', body())
        wire.fs.plant('blocks/g1/b', body())

        await store.deleteMany([
            { key: 'blocks/g1/a', condition: 'unconditional' },
            { key: 'blocks/g1/gone', condition: 'unconditional' },
            { key: 'blocks/g1/b', condition: 'unconditional' },
        ])

        expectNoWaitingPluginCommand()
        expect(Array.from(wire.fs.files.keys()).filter((key) => key.startsWith('blocks/g1/'))).toEqual([])
        expect(appFsKeys('app_fs_remove')).toEqual(['blocks/g1/a', 'blocks/g1/gone', 'blocks/g1/b'])
    })

    test('has tells a file, a directory and an absent key apart', async () => {
        const store = await newStore()
        wire.fs.plant('assets/dir/file.bin', body())

        const results = [
            await store.has('assets/dir/file.bin'),
            await store.has('assets/dir'),
            await store.has('assets/none'),
        ]

        expectNoWaitingPluginCommand()
        expect(results).toEqual([true, false, false])
        expect(appFsKeys('app_fs_exists')).toEqual(['assets/dir/file.bin', 'assets/dir', 'assets/none'])
    })

    test('listing a folder with a live and a dangling link keeps only what resolves', async () => {
        const store = await newStore()
        wire.fs.plant('assets/real.png', body())
        wire.fs.plantSymlink('assets/live.png', { kind: 'file', data: body() })
        wire.fs.plantSymlink('assets/dangling.png', { kind: 'missing' })

        const keys = (await store.list('assets/')).sort()

        expectNoWaitingPluginCommand()
        expect(keys).toEqual(['assets/live.png', 'assets/real.png'])
        expect(appFsKeys('app_fs_exists').sort()).toEqual(['assets/dangling.png', 'assets/live.png'])
    })

    test('the url of a key is built under the data directory the app command names', async () => {
        const store = await newStore()

        const url = await store.urlFor?.('assets/a.png')

        expectNoWaitingPluginCommand()
        expect(url).toBe('/appdata/assets/a.png')
        expect(wire.callsOf('app_data_dir_path')).toHaveLength(1)
    })
})

describe('the write sweep and the atomic write on Android', () => {
    test('sweeping with and without a leftover temp removes only the temp', async () => {
        const { sweepAllWriteTemps } = await import('src/ts/storage/tauriAtomicWrite')
        wire.fs.plant('database/risu-write-0123456789abcdef.tmp', body())
        wire.fs.plant('database/database.bin', body())
        wire.fs.directories.add('assets')

        await sweepAllWriteTemps()
        await sweepAllWriteTemps()

        expectNoWaitingPluginCommand()
        expect(wire.fs.files.has('database/risu-write-0123456789abcdef.tmp')).toBe(false)
        expect(wire.fs.files.has('database/database.bin')).toBe(true)
    })

    test('the sweep removes a leftover temp through the app command', async () => {
        const { sweepAllWriteTemps } = await import('src/ts/storage/tauriAtomicWrite')
        wire.fs.plant('database/risu-write-0123456789abcdef.tmp', body())

        await sweepAllWriteTemps()

        expectNoWaitingPluginCommand()
        expect(appFsKeys('app_fs_remove')).toEqual(['database/risu-write-0123456789abcdef.tmp'])
        expect(appFsKeys('app_fs_exists')).toContain('database')
    })

    test('a small atomic write goes as chunks: no plugin write and no rename', async () => {
        const { writeFileAtomic } = await import('src/ts/storage/tauriAtomicWrite')

        await writeFileAtomic('./database/small.bin', body())

        expect(wire.fs.files.get('database/small.bin')).toEqual(body())
        expect(wire.plugin()).toEqual([])
    })
})
