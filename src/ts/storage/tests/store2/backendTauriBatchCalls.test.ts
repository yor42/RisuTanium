// @vitest-environment node
/**
 * Regression reproducers for the batched store2 unit read: one `readUnits` of the twelve units of a character is one
 * `read_store2_units` invoke and no per-key `read_range` of a `store2/` key, on the Android transport and on the desktop
 * transport. Units are committed through the real backend over the real `createTauriFilesStore` on the command and file
 * system stand-ins. A pass is not evidence about the Rust command or the native bridge.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fs)
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    /** What the operating-system plugin answers; the platform decides the transport. */
    const os: { kind: string } = { kind: 'android' }
    /** The desktop write_durable answers { flushed } as the Rust command does. */
    async function invoke(command: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<unknown> {
        const reply = await desktop.invoke(command, args, options)
        return command === 'write_durable' ? { flushed: true } : reply
    }
    return { fs, desktop, paths, os, invoke }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os.kind }))

import { createTauriBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { store2BatchTransport } from 'src/ts/storage/tauriStore2Batch'
import { absentCommit, bytesOf, unitKey } from './backendConformance'

// Whether the desktop transport batches; the Q1 follow-up flips the platform switch and every expectation follows.
const desktopBatches = store2BatchTransport('desktop')

function reset(os: string): void {
    h.os.kind = os
    h.fs.reset()
    h.desktop.reset()
    h.paths.reset()
    h.desktop.chunk.reportFlushes()
    h.fs.setPlatform(os === 'android' ? 'posix' : os === 'windows' ? 'windows' : 'posix')
    resetByteTransportForTests()
}

/** The twelve units of one character, each with its own bytes, committed through the backend. */
async function commitCharacter(): Promise<{ backend: Store2Backend, keys: string[], expected: Uint8Array[] }> {
    const backend = await createTauriBackend(createTauriFilesStore({ platform: h.os.kind === 'windows' ? 'windows' : 'posix' }))
    const keys = Array.from({ length: 12 }, (_, i) => unitKey(i + 1))
    const expected = keys.map((_, i) => bytesOf(i + 1, 200 - i, 7, i * 3, 1, 2, 3))
    await backend.commitOrdinary(await absentCommit(backend), keys.map((key, i) => ({ key, bytes: expected[i] })), bytesOf(9))
    h.desktop.reset()
    return { backend, keys, expected }
}

describe('a multi-key readUnits costs one batch invoke', () => {
    beforeEach(() => reset('android'))

    test('T4.1 android: one call for twelve units and no per-key read of a store2 key', async () => {
        reset('android')
        const { backend, keys, expected } = await commitCharacter()

        const read = await backend.readUnits(keys)

        expect(h.desktop.chunk.callsOf('read_store2_units').length).toBe(1)
        expect(h.desktop.chunk.callsOf('read_range').filter((call) => String(call.args.key).startsWith('store2/'))).toHaveLength(0)
        expect(keys.map((key) => [...(read.get(key) ?? [])])).toEqual(expected.map((bytes) => [...bytes]))
    })

    test('T4.2 desktop: one call for twelve units while the desktop transport batches', async () => {
        reset('windows')
        const { backend, keys, expected } = await commitCharacter()

        const read = await backend.readUnits(keys)

        expect(h.desktop.chunk.callsOf('read_store2_units').length).toBe(desktopBatches ? 1 : 0)
        expect(h.desktop.chunk.callsOf('read_range').filter((call) => String(call.args.key).startsWith('store2/'))).toHaveLength(desktopBatches ? 0 : 12)
        expect(keys.map((key) => [...(read.get(key) ?? [])])).toEqual(expected.map((bytes) => [...bytes]))
    })
})
