/**
 * Compatibility guards: on every platform except Android the Tauri files store
 * invokes `write_durable` and the fs plugin as the desktop contract requires and
 * never the Android chunk commands, and the helpers load and run where the
 * operating-system plugin cannot answer. A pass
 * here is not evidence about the native bridge.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    const state: { os: string } = { os: 'windows' }
    return { fs, paths, state, invoke: vi.fn() }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (h.state.os === 'throws') {
            throw new TypeError('the shell is missing')
        }
        return h.state.os
    },
}))

import { DURABLE_KEY_HEADER, DURABLE_WRITE_COMMAND } from 'src/ts/storage/tauriDurableWrite'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'

const BYTES = Uint8Array.from([1, 2, 3, 4])
const NEW_COMMANDS = ['write_chunk', 'abort_chunked', 'read_range']

beforeEach(() => {
    h.fs.reset()
    h.invoke.mockReset()
    h.invoke.mockResolvedValue(undefined)
})

describe.each(['windows', 'macos', 'linux', 'ios', 'throws'])('with the operating system reported as %s', (os) => {
    beforeEach(() => {
        h.state.os = os
    })

    test('a durable write invokes only write_durable, with the key in the header and the bytes as the body', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write('blocks/gen/root', BYTES, 'unconditional')

        expect(h.invoke).toHaveBeenCalledTimes(1)
        const [command, body, options] = h.invoke.mock.calls[0]
        expect(command).toBe(DURABLE_WRITE_COMMAND)
        expect(body).toBe(BYTES)
        expect(options).toEqual({ headers: { [DURABLE_KEY_HEADER]: 'blocks%2Fgen%2Froot' } })
    })

    test('a plain write goes through the plugin with the ./ path and never invokes a command', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write('database/database.bin', BYTES, 'unconditional')

        expect(h.invoke).not.toHaveBeenCalled()
        expect(h.fs.renameLog.at(-1)?.to).toBe('./database/database.bin')
        expect(Array.from(h.fs.files.get('database/database.bin') ?? [])).toEqual(Array.from(BYTES))
    })

    test('a read goes through the plugin file read and never invokes a command', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        h.fs.plant('assets/x', BYTES)

        expect(Array.from((await store.read('assets/x')).bytes ?? [])).toEqual(Array.from(BYTES))
        expect((await store.read('assets/gone')).bytes).toBeNull()

        expect(h.fs.calls.filter((call) => call.op === 'readFile').map((call) => call.path)).toEqual(['./assets/x', './assets/gone'])
        expect(h.invoke).not.toHaveBeenCalled()
    })

    test('none of the three Android commands is ever invoked', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        await store.write('blocks/head', BYTES, 'unconditional')
        await store.write('assets/a', BYTES, 'unconditional')
        h.fs.plant('assets/b', BYTES)
        await store.read('assets/b')

        const commands = h.invoke.mock.calls.map((call) => call[0])
        for (const command of NEW_COMMANDS) {
            expect(commands).not.toContain(command)
        }
    })
})
