/**
 * Which Tauri builds may run the boot archive pass (`createProductionBootArchiveDeps`
 * in `src/ts/storage/bootArchiveHost.ts`, its `env().tauriDesktop`): the native
 * operating system answers when it can, the user agent decides when the operating-system
 * plugin is missing, and iOS never archives. These are compatibility guards: they
 * pass before and after Android joins the capable systems. A pass is not evidence
 * about the native plugin.
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

describe('the operating systems the boot archive pass accepts on a Tauri build', () => {
    test.each(['windows', 'linux', 'macos'])('guard: %s is capable', async (os) => {
        h.os = os
        expect(await tauriDesktop()).toBe(true)
    })

    test('guard: iOS never archives', async () => {
        h.os = 'ios'
        expect(await tauriDesktop()).toBe(false)
    })

    test('guard: a web host is not a Tauri build whatever the operating system says', async () => {
        h.os = 'windows'
        expect(await tauriDesktop('web')).toBe(false)
    })

    test('guard: without the operating-system plugin a mobile user agent is not capable', async () => {
        h.os = new Error('no os plugin')
        h.isMobile = true
        expect(await tauriDesktop()).toBe(false)
    })

    test('guard: without the operating-system plugin an iOS user agent is not capable', async () => {
        h.os = new Error('no os plugin')
        h.isIOS = true
        expect(await tauriDesktop()).toBe(false)
    })

    test('guard: without the operating-system plugin a desktop user agent is capable', async () => {
        h.os = new Error('no os plugin')
        expect(await tauriDesktop()).toBe(true)
    })
})
