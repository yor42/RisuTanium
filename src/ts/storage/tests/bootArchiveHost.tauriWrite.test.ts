/**
 * The Tauri binding of the boot archive pass's commit and re-read
 * (`src/ts/storage/bootArchiveHost.ts`, through `bootPassSeams.ts`): the
 * conversion of a legacy profile leaves the previous state authoritative when
 * it fails, writes nothing to `database/database.bin`, and the re-read after a
 * failure writes nothing back.
 *
 * The Tauri file system is the in-memory fake in `tauriFsFake.ts`, and the
 * durable `write_durable` command is its `invoke` stand-in; a passing test here
 * is not evidence about the native plugin or the Rust command.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(() => 'windows') }))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)
vi.mock('@tauri-apps/api/path', () => fakePaths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...fakePaths.coreModule, invoke: fakeFs.invoke }))

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

// The strict decode of the committed state reaches the encoder and decoder module, which reads the live database.
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

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
import { fingerprintMainFile } from 'src/ts/storage/mainFileFingerprint'
import { preBlocksKey } from 'src/ts/storage/mainFileFingerprint'
import { resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { injectAppStore } from 'src/ts/storage/store/appStore'
import { makeSet } from './blockStoreHarness'

const MAIN = 'database/database.bin'
const HEAD = 'blocks/head'
const OLD_MAIN = new TextEncoder().encode('old-main-file-bytes')
const SET = makeSet({ characters: [{ chaId: 'a' }, { chaId: 'b' }] })

function text(bytes: Uint8Array | undefined): string | undefined {
    return bytes ? new TextDecoder().decode(bytes) : undefined
}

beforeEach(() => {
    fakeFs.reset()
    fakeFs.files.set(MAIN, OLD_MAIN.slice())
    injectAppStore(null)
    resetPageBlockOwnerForTests()
    resetPageStorageModeForTests()
    setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(OLD_MAIN) })
})

describe('the Tauri commit of the boot archive pass on a legacy profile (the conversion)', () => {
    test('a conversion whose first block write fails rejects, leaves the legacy main file byte-identical and writes no head', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')
        const fault = fakeFs.failDurableWrites('disk full')

        await expect(deps.commit(SET)).rejects.toBeDefined()

        expect(fault.fired).toBeGreaterThan(0)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD_MAIN))
        expect(fakeFs.files.has(HEAD)).toBe(false)
        expect(fakeFs.listing('database')).toEqual(['database.bin'])
    })

    test('a head write that fails leaves the main file authoritative: the blocks written before it are garbage, never a state', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')
        const fault = fakeFs.failDurableWrites('disk full', (key) => key === HEAD)

        await expect(deps.commit(SET)).rejects.toBeDefined()

        expect(fault.fired).toBe(1)
        expect(text(fakeFs.files.get(MAIN))).toBe(text(OLD_MAIN))
        expect(fakeFs.files.has(HEAD)).toBe(false)
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
    })

    test('a conversion that wins writes the head after every other block key, then the pre-conversion copy durably, never opens the main path for writing, and moves the main file aside', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')

        await deps.commit(SET)

        const log = fakeFs.durableLog
        const headIndex = log.indexOf(HEAD)
        expect(headIndex).toBeGreaterThan(-1)
        expect(log.slice(headIndex + 1), 'only the pre-conversion copy follows the head').toEqual([preBlocksKey(0)])
        expect(log.slice(0, headIndex).every((key) => key.startsWith('blocks/') && key !== HEAD), 'every earlier durable write is a block key').toBe(true)
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
        expect(fakeFs.files.has(MAIN)).toBe(false)
        expect(text(fakeFs.files.get(preBlocksKey(0)))).toBe(text(OLD_MAIN))
    })

    test('the re-read after a failed commit returns the legacy main file and writes nothing back, however the bytes look', async () => {
        const deps = await createProductionBootArchiveDeps('tauri')
        fakeFs.failDurableWrites('disk full')
        await expect(deps.commit(SET)).rejects.toBeDefined()
        const unreadable = new Uint8Array([7, 7, 7, 7])
        fakeFs.files.set(MAIN, unreadable.slice())

        const reread = await deps.reread()

        expect(reread.kind).toBe('bytes')
        expect(reread.kind === 'bytes' && Array.from(reread.bytes ?? [])).toEqual(Array.from(unreadable))
        expect(fakeFs.writesTo(MAIN)).toHaveLength(0)
        expect(Array.from(fakeFs.files.get(MAIN) ?? [])).toEqual(Array.from(unreadable))
    })
})
