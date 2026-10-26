// @vitest-environment happy-dom

/**
 * `verifyAssetIntegrity` over module stubs (`storageMaintenance.ts`): modules are never loaded, so the report names
 * every stub as a module whose assets were not checked, in both report branches, and the registered module loader is
 * never called. A stub with an empty name is named by its id. Every dependency is mocked; the `getUncleanablesSync`
 * double inspects its argument (a full module yields one asset, a stub none). The module names are asserted as
 * literals. The loader is a test double.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MODULE_STUB_KEY, MODULE_STUB_VALUE, isModuleStub } from 'src/ts/storage/moduleStub'

const alertMdMock = vi.hoisted(() => vi.fn())
const alertNormalMock = vi.hoisted(() => vi.fn())
const state = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertMd: alertMdMock,
    alertNormal: alertNormalMock,
    alertStore: { set: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/opfsStorage'), () => ({
    OpfsStorage: class {},
}) as unknown as typeof import('src/ts/storage/opfsStorage'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(async () => vi.fn(async () => {})),
    getUncleanablesSync: vi.fn((db: { modules?: unknown[] }) =>
        (db.modules ?? []).filter((module) => !isModuleStub(module)).map(() => 'asset-full')),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/assetIntegrity'), () => ({
    scanAssetCacheIntegrity: vi.fn(async () => ({
        checked: 1, mismatches: [], notCached: 0, notContentAddressed: 0, unsupported: false,
    })),
    evictAssetCacheEntries: vi.fn(async () => 0),
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: state,
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ setItem: vi.fn(), removeItem: vi.fn() }) },
}))

import { verifyAssetIntegrity } from 'src/ts/storage/storageMaintenance'
import { registerModuleLoader, unregisterModuleLoader } from 'src/ts/storage/store2/moduleAcquire'

const loader = vi.fn(async () => null)

function stub(id: string, name: string): Record<string, unknown> {
    return { id, name, unit: [`unit-${id}`], al: [], il: [], [MODULE_STUB_KEY]: MODULE_STUB_VALUE }
}

const fullModule = { id: 'full', name: 'Full Module', assets: [['a', 'assets/x']], lorebook: [] }

const reportText = () => String(alertMdMock.mock.calls[0]?.[0] ?? '')

beforeEach(() => {
    alertMdMock.mockClear()
    alertNormalMock.mockClear()
    loader.mockClear()
    registerModuleLoader(loader)
    state.db = { characters: [], modules: [] }
})

describe('verifyAssetIntegrity() with module stubs', () => {
    test('integrity-scan-lists-stub-unchecked: with no targets the report names the stub and nothing is loaded', async () => {
        state.db.modules = [stub('m1', 'Stubbed Module')]
        await verifyAssetIntegrity()
        expect(alertNormalMock).not.toHaveBeenCalled()
        expect(alertMdMock).toHaveBeenCalledTimes(1)
        expect(reportText()).toContain('Stubbed Module')
        expect(loader).not.toHaveBeenCalled()
    })

    test('integrity-scan-lists-stub-unchecked: with targets the full report names the stub and nothing is loaded', async () => {
        state.db.modules = [fullModule, stub('m1', 'Stubbed Module'), stub('m2', 'Second Stub')]
        await verifyAssetIntegrity()
        expect(alertMdMock).toHaveBeenCalledTimes(1)
        expect(reportText()).toContain('Stubbed Module, Second Stub')
        expect(reportText()).not.toContain('Full Module')
        expect(loader).not.toHaveBeenCalled()
    })

    test('integrity-scan-lists-stub-unchecked: a stub with an empty name is named by its id', async () => {
        state.db.modules = [stub('id-of-nameless-module', '')]
        await verifyAssetIntegrity()
        expect(reportText()).toContain('id-of-nameless-module')
    })

    test('guard: without a stub no module line is added and no-target scans still report plainly', async () => {
        state.db.modules = [fullModule]
        await verifyAssetIntegrity()
        expect(reportText()).not.toContain('Full Module')
        state.db.modules = []
        alertMdMock.mockClear()
        await verifyAssetIntegrity()
        expect(alertNormalMock).toHaveBeenCalledTimes(1)
        expect(alertMdMock).not.toHaveBeenCalled()
        unregisterModuleLoader()
    })
})
