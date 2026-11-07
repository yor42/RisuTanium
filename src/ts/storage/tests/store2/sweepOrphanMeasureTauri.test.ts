// @vitest-environment node
/**
 * The Tauri size probe of the orphan measurement: the `tauriAssetSize` adapter over `statStoredSize`, and the rule that the
 * console action uses it only for the Tauri files store on android or desktop. Its own file because the module mocks of the
 * Tauri bridge and the operating-system plugin are file-wide.
 *
 * What is a stand-in: `tauriFsFake` and `tauriChunkFake` follow the Rust `read_range` command's clamp and trailer; a pass here is
 * not evidence about the Rust command itself, and the operating system is a mutable mock. The failure of a non-missing file is
 * the fake's own: a directory under the key rejects with `Is a directory (os error 21)`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const chunk = (await import('src/ts/storage/tests/tauriChunkFake')).createChunkedInvoke(fs)
    return { fs, chunk, os: 'android' }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.chunk.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.os }))

import { createMemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import { installSweepDryRunMeasure, tauriAssetSize, type ResidentSources } from 'src/ts/storage/store2/sweep/dryRunMeasure'
import { createClock, seedStore, testEnv } from './commitFixtures'

const resident: ResidentSources = {
    residentRefs: () => [],
    writtenThisPage: () => [],
    residentInlays: async () => new Set(),
}

function patterned(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + 3) % 256)
}

beforeEach(() => {
    h.fs.reset()
    h.chunk.reset()
    h.os = 'android'
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('tauriAssetSize', () => {
    test('reproducer: a stored file answers its size and asks for no bytes', async () => {
        h.fs.files.set('assets/a', patterned(1234))
        const asked: { offset: number, len: number }[] = []
        h.chunk.hooks.before = ({ offset, len }) => { asked.push({ offset, len }) }

        expect(await tauriAssetSize('assets/a')).toBe(1234)

        expect(asked).toEqual([{ offset: 0, len: 0 }])
    })

    test('reproducer: a missing file answers null', async () => {
        expect(await tauriAssetSize('assets/b')).toBeNull()
    })

    test('reproducer: a failure that is not a missing file rejects instead of answering null', async () => {
        h.fs.directories.add('assets/folder')

        const error = await tauriAssetSize('assets/folder').then(() => null, (e: unknown) => e)

        expect(String(error)).toContain('Is a directory (os error 21)')
    })
})

describe('the console action chooses the probe by store kind and operating system', () => {
    async function handleFor(kind: AppStoreKind) {
        const backend = createMemoryBackend()
        await seedStore(backend, testEnv(createClock(), 5))
        const store = createMemoryByteStore()
        store.files.set('assets/a', patterned(1234))
        store.files.set('assets/b', patterned(10))
        h.fs.files.set('assets/a', patterned(1234))
        const session = {
            kind,
            backend,
            openGate: (deleter: Parameters<typeof openDeleterGate>[1]) => openDeleterGate(backend, deleter, { idleReason: null }),
        }
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const handle = installSweepDryRunMeasure({ session, store: async () => store, loadResident: async () => resident }, {})
        return { handle, store }
    }

    test('reproducer: the Tauri store on android sizes through statStoredSize, reads no body, and a missing file is vanished', async () => {
        const { handle, store } = await handleFor('tauri')

        const report = await handle.orphans()

        expect(report).toMatchObject({ status: 'done', storeKind: 'tauri', bytesSource: 'stat', vanished: 1 })
        expect(report.status === 'done' ? report.notInHead : null).toMatchObject({ count: 2, bytes: 1234 })
        expect(store.reads).toEqual([])
    })

    test('reproducer: the Tauri store on a desktop OS also uses the probe', async () => {
        h.os = 'windows'
        const { handle, store } = await handleFor('tauri')

        const report = await handle.orphans()

        expect(report).toMatchObject({ status: 'done', bytesSource: 'stat' })
        expect(store.reads).toEqual([])
    })

    test('reproducer: the Tauri store on an OS that is neither android nor desktop does not use read_range', async () => {
        h.os = 'ios'
        const { handle } = await handleFor('tauri')

        const report = await handle.orphans()

        expect(report).toMatchObject({ status: 'done', bytesSource: 'read' })
        expect(report.status === 'done' ? report.notInHead : null).toMatchObject({ count: 2, bytes: 1244 })
    })

    test('reproducer: a store that is not the Tauri files store never uses the probe, whatever the OS', async () => {
        const { handle } = await handleFor('indexeddb')

        const report = await handle.orphans()

        expect(report).toMatchObject({ status: 'done', storeKind: 'indexeddb', bytesSource: 'read' })
    })
})
