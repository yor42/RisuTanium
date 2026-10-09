/**
 * Android runs the boot archive pass (`createProductionBootArchiveDeps` in
 * `src/ts/storage/bootArchiveHost.ts`, its `env().tauriDesktop`). Regression
 * reproducer: the gate refused `android` before. iOS stays refused (the guards
 * are in `bootArchiveHost.osGate.test.ts`). A pass is not evidence about the
 * native plugin or the phone.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    os: 'windows' as string | Error,
    isTauri: true,
    isMobile: false,
    isIOS: false,
}))

vi.mock('@tauri-apps/plugin-os', () => ({
    type: vi.fn(() => {
        if (h.os instanceof Error) {
            throw h.os
        }
        return h.os
    }),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({ BaseDirectory: { AppData: 14 } }))
vi.mock('@tauri-apps/api/path', () => ({}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: vi.fn(),
    forageStorage: { staleAccountProfile: false, getItem: vi.fn(), setItem: vi.fn() },
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/nodeStorage'), () => ({
    NodeStorage: class { },
}) as unknown as typeof import('src/ts/storage/nodeStorage'))

vi.mock(import('src/ts/storage/opfsStorage'), () => ({
    OpfsStorage: class { },
}) as unknown as typeof import('src/ts/storage/opfsStorage'))

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
    get isTauri() { return h.isTauri },
    isNodeServer: false,
    get isMobile() { return h.isMobile },
    isIOS: () => h.isIOS,
}) as unknown as typeof import('src/ts/platform'))

import { createProductionBootArchiveDeps } from 'src/ts/storage/bootArchiveHost'

beforeEach(() => {
    h.os = 'windows'
    h.isTauri = true
    h.isMobile = false
    h.isIOS = false
})

async function tauriDesktop(host: 'tauri' | 'web' = 'tauri'): Promise<boolean> {
    return (await createProductionBootArchiveDeps(host)).env().tauriDesktop
}

describe('Android and the boot archive pass', () => {
    test('android is capable on a Tauri host', async () => {
        h.os = 'android'
        expect(await tauriDesktop()).toBe(true)
    })

    test('android is not capable on a web host', async () => {
        h.os = 'android'
        expect(await tauriDesktop('web')).toBe(false)
    })

    test('guard: iOS stays refused', async () => {
        h.os = 'ios'
        expect(await tauriDesktop()).toBe(false)
    })
})
