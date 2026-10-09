/**
 * The wrappers around the app's own file commands. They run over the in-memory
 * IPC boundary of `tauriWireFake.ts`: the native arm sends `app_fs_*` with a
 * bare `{ key }`, the arm for a page without the operating-system plugin
 * (web, Node server, test runner) falls back to the file plugin with the
 * `./`-prefixed path and the AppData base directory. A pass says nothing about
 * the Rust commands or the native shell.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { StoreInvalidKeyError } from '../store/errors'
import { installTauriWire, type TauriWire, type WireOs } from './tauriWireFake'

const APP_DATA = 14

let wire: TauriWire | undefined

function install(os: WireOs | 'none'): TauriWire {
    wire = installTauriWire({ os: os === 'none' ? 'linux' : os })
    if (os === 'none') {
        // No operating-system plugin: `transportKind()` answers 'other'.
        ;(window as Window & { __TAURI_OS_PLUGIN_INTERNALS__?: unknown }).__TAURI_OS_PLUGIN_INTERNALS__ = undefined
    }
    return wire
}

afterEach(() => {
    wire?.uninstall()
    wire = undefined
})

describe('usesAppFs', () => {
    test.each([
        ['android', true],
        ['windows', true],
        ['linux', true],
        ['macos', true],
        ['none', false],
    ] as const)('on %s the answer is %s', async (os, expected) => {
        install(os)
        const { usesAppFs } = await import('../appFs')

        expect(usesAppFs()).toBe(expected)
    })
})

describe.each(['android', 'windows'] as const)('the native arm on %s', (os) => {
    test('exists sends the bare key and answers the boolean', async () => {
        const w = install(os)
        w.fs.plant('database/x.bin', Uint8Array.of(1))
        const { appFsExists } = await import('../appFs')

        const answers = [await appFsExists('database/x.bin'), await appFsExists('database/none'), await appFsExists('database')]

        expect(answers).toEqual([true, false, true])
        expect(w.callsOf('app_fs_exists').map((call) => call.args)).toEqual([{ key: 'database/x.bin' }, { key: 'database/none' }, { key: 'database' }])
        expect(w.plugin()).toEqual([])
    })

    test('the empty key names the data directory', async () => {
        const w = install(os)
        const { appFsExists, appFsMkdirAll } = await import('../appFs')

        expect(await appFsExists('')).toBe(true)
        await appFsMkdirAll('')

        expect(w.calls.map((call) => [call.cmd, call.args])).toEqual([['app_fs_exists', { key: '' }], ['app_fs_mkdir_all', { key: '' }]])
    })

    test('mkdir creates every missing ancestor and repeating it is not an error', async () => {
        const w = install(os)
        const { appFsMkdirAll } = await import('../appFs')

        await appFsMkdirAll('a/b/c')
        await appFsMkdirAll('a/b/c')

        expect(w.fs.directories.has('a/b/c')).toBe(true)
        expect(w.callsOf('app_fs_mkdir_all').map((call) => call.args)).toEqual([{ key: 'a/b/c' }, { key: 'a/b/c' }])
        expect(w.plugin()).toEqual([])
    })

    test('remove deletes a file and passes a rejection through as the string the command gave', async () => {
        const w = install(os)
        w.fs.plant('assets/a.png', Uint8Array.of(1))
        const { appFsRemove } = await import('../appFs')

        await appFsRemove('assets/a.png')
        const rejection = await appFsRemove('assets/a.png').then(() => undefined, (error: unknown) => error)

        expect(w.fs.files.has('assets/a.png')).toBe(false)
        expect(typeof rejection).toBe('string')
        expect(rejection).toMatch(/\(os error 2\)$/)
    })

    test('the data directory comes from the command', async () => {
        const w = install(os)
        const { appDataDirectory } = await import('../appFs')

        const directory = await appDataDirectory()

        expect(directory).toBe(os === 'windows' ? 'C:\\appdata' : '/appdata')
        expect(w.callsOf('app_data_dir_path')).toHaveLength(1)
        expect(w.plugin()).toEqual([])
    })

    test.each(['./a/b', '/a/b'])('a key that starts with %s is refused before any command', async (key) => {
        const w = install(os)
        const { appFsExists, appFsMkdirAll, appFsRemove } = await import('../appFs')

        await expect(appFsExists(key)).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(appFsMkdirAll(key)).rejects.toBeInstanceOf(StoreInvalidKeyError)
        await expect(appFsRemove(key)).rejects.toBeInstanceOf(StoreInvalidKeyError)

        expect(w.calls).toEqual([])
    })
})

describe('the plugin fallback without an operating-system plugin', () => {
    test('exists asks the file plugin for ./key under AppData, and for the root with the empty path', async () => {
        const w = install('none')
        w.fs.plant('database/x.bin', Uint8Array.of(1))
        const { appFsExists } = await import('../appFs')

        const answers = [await appFsExists('database/x.bin'), await appFsExists('')]

        expect(answers).toEqual([true, true])
        expect(w.callsOf('plugin:fs|exists').map((call) => call.args)).toEqual([
            { path: './database/x.bin', options: { baseDir: APP_DATA } },
            { path: '', options: { baseDir: APP_DATA } },
        ])
        expect(w.callsOf('app_fs_exists')).toEqual([])
    })

    test('mkdir is recursive and remove passes its rejection through', async () => {
        const w = install('none')
        const { appFsMkdirAll, appFsRemove } = await import('../appFs')

        await appFsMkdirAll('a/b')
        const rejection = await appFsRemove('a/gone').then(() => undefined, (error: unknown) => error)

        expect(w.callsOf('plugin:fs|mkdir').map((call) => call.args)).toEqual([{ path: './a/b', options: { baseDir: APP_DATA, recursive: true } }])
        expect(w.callsOf('plugin:fs|remove').map((call) => call.args)).toEqual([{ path: './a/gone', options: { baseDir: APP_DATA } }])
        expect(typeof rejection).toBe('string')
        expect(rejection).toMatch(/\(os error 2\)$/)
    })

    test('the data directory comes from the path plugin', async () => {
        const w = install('none')
        const { appDataDirectory } = await import('../appFs')

        expect(await appDataDirectory()).toBe('/appdata')
        expect(w.callsOf('plugin:path|resolve_directory')).toHaveLength(1)
    })

    test.each(['./a/b', '/a/b'])('a key that starts with %s is refused before any command', async (key) => {
        const w = install('none')
        const { appFsRemove } = await import('../appFs')

        await expect(appFsRemove(key)).rejects.toBeInstanceOf(StoreInvalidKeyError)

        expect(w.calls).toEqual([])
    })
})
