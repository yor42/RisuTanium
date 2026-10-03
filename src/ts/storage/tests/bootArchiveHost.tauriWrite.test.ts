/**
 * The Tauri binding of the boot archive pass's `writeMainFile`
 * (`src/ts/storage/bootArchiveHost.ts`) replaces `database/database.bin`
 * atomically: a write that fails part-way rejects and leaves the old file
 * byte-identical, and a successful write leaves the new bytes and no temp file.
 *
 * The Tauri file system is the in-memory fake in `tauriFsFake.ts`; a passing
 * test here is not evidence about the native plugin.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(() => 'windows') }))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(),
    forageStorage: { staleAccountProfile: false, getItem: vi.fn(), setItem: vi.fn() },
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

// The page's byte store selects among clients this test never uses; their
// modules reach into the application, so they are stood in for.
vi.mock(import('src/ts/storage/nodeStorage'), () => ({
    NodeStorage: class { },
}) as unknown as typeof import('src/ts/storage/nodeStorage'))

vi.mock(import('src/ts/storage/opfsStorage'), () => ({
    OpfsStorage: class { },
}) as unknown as typeof import('src/ts/storage/opfsStorage'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    LoadingStatusState: { text: '' },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isMobile: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

import { createProductionBootArchiveDeps } from 'src/ts/storage/bootArchiveHost'

const MAIN = 'database/database.bin'
const OLD_MAIN = new TextEncoder().encode('old-main-file-bytes')
const NEW_MAIN = new TextEncoder().encode('new-main-file-bytes-from-the-boot-commit')

function text(bytes: Uint8Array | undefined): string | undefined {
    return bytes ? new TextDecoder().decode(bytes) : undefined
}

beforeEach(() => {
    fakeFs.reset()
    fakeFs.files.set(MAIN, OLD_MAIN.slice())
})

describe('the Tauri writeMainFile of the boot archive pass', () => {
    test('a write that fails part-way rejects and leaves the old main file byte-identical', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')
        const fault = fakeFs.failWritesOf(() => true)

        await expect(deps.writeMainFile(NEW_MAIN)).rejects.toBeDefined()

        expect(fault.fired).toBe(1)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD_MAIN))
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
    })

    test('a successful write leaves the new bytes at the main path, no temp file, and never opens the main path for writing', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')

        await deps.writeMainFile(NEW_MAIN)

        expect(text(fakeFs.files.get(MAIN))).toBe(text(NEW_MAIN))
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
    })

    test('a rename that keeps failing rejects and leaves the old main file and no temp file', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')
        const fault = fakeFs.failRenames('failed to rename (os error 1)')

        await expect(deps.writeMainFile(NEW_MAIN)).rejects.toBeDefined()

        expect(fault.fired).toBe(1)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD_MAIN))
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
    })
})
