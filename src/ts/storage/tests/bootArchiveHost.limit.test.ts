/**
 * The production binding of the boot archive pass (`src/ts/storage/bootArchiveHost.ts`):
 * the body limit it hands the pass is the limit the Node server enforces, and
 * the memo it reads is the one `bootArchiveMemo.ts` writes.
 *
 * Every module the binding reaches for a real effect is mocked; nothing here
 * touches a server, a file system or a browser lock. The server's limit is read
 * from `server/node/bodyLimit.cjs`, the module `server.cjs` takes it from. The
 * first test asserts the size rule's binding, the second the memo's.
 */
import { createRequire } from 'node:module'
import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn(() => 'windows') }))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    readMainFile: vi.fn(),
    writeMainFile: vi.fn(),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(),
    forageStorage: { staleAccountProfile: false, getItem: vi.fn(), setItem: vi.fn() },
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

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
    isTauri: false,
    isNodeServer: true,
    isMobile: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

import { createProductionBootArchiveDeps } from 'src/ts/storage/bootArchiveHost'

const requireFromHere = createRequire(import.meta.url)

beforeEach(() => {
    localStorage.clear()
})

describe('boot archive pass: the production binding of the size rule', () => {
    test('hands the pass the body limit the Node server enforces', async () => {
        const server = requireFromHere('../../../../server/node/bodyLimit.cjs') as { NODE_BODY_LIMIT_BYTES: number }
        expect(server.NODE_BODY_LIMIT_BYTES).toBe(104_857_600)

        const deps = await createProductionBootArchiveDeps('web')

        expect(deps.nodeBodyLimit).toBe(server.NODE_BODY_LIMIT_BYTES)
    })

    test('reads the device memo from the module that writes it', async () => {
        const memoModulePath = '/src/ts/storage/bootArchiveMemo'
        const memoModule = await import(/* @vite-ignore */ memoModulePath) as typeof import('src/ts/storage/bootArchiveMemo')
        const deps = await createProductionBootArchiveDeps('web')
        expect(deps.readArchiveMemo().skipped.size).toBe(0)
        expect(deps.readArchiveMemo().tooLarge).toBe(false)

        memoModule.rememberSkipped(['a', 'b'])
        memoModule.rememberTooLarge()

        expect([...deps.readArchiveMemo().skipped].sort()).toEqual(['a', 'b'])
        expect(deps.readArchiveMemo().tooLarge).toBe(true)
    })
})
