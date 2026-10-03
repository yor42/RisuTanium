// @vitest-environment happy-dom

/**
 * `StorageMaintenanceSettings.svelte` hosts one panel of the "Backup & Files"
 * tab (MC-088): Asset Cache Integrity, gated `!isTauri`. It has no OPFS
 * storage switch: a profile whose main store is OPFS is copied back into
 * IndexedDB at startup (`opfsCopyBack.ts`).
 *
 * Tests here are labelled by purpose in their titles: "new-behaviour test"
 * asserts what only a component without a switch does, "compatibility guard"
 * holds before and after.
 *
 * MOCKED: `src/ts/platform` (`isTauri`/`isNodeServer`, both mutable getters
 * backed by a hoisted flag), `src/ts/stores.svelte` (`DBState`, a thin
 * reactive stand-in so `Check`'s `bind:check={DBState.db.checkCorruption}`
 * has somewhere to write) and `src/ts/storage/storageMaintenance` (the one
 * export the component calls, as a spy -- this file asserts only on which
 * panels render, not on the panel's own logic, which
 * `storageMaintenanceAssetIntegrity.test.ts` covers directly). `src/lang` and
 * `src/lib/UI/GUI/CheckInput.svelte` are real: both are plain,
 * dependency-light modules.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformState.isTauri },
    get isNodeServer() { return platformState.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { checkCorruption: false } as unknown as Database })
    return {
        DBState: state,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/storageMaintenance'), () => ({
    verifyAssetIntegrity: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/storage/storageMaintenance'))

//#endregion

import { language } from 'src/lang'
import StorageMaintenanceSettings from './StorageMaintenanceSettings.svelte'

/** Grants every global a browser with OPFS support has; the component renders the same with them. */
function grantOpfsSupport(): void {
    Object.defineProperty(window.navigator, 'storage', {
        value: { getDirectory: vi.fn(async () => ({})) },
        configurable: true,
    })
    Object.defineProperty(window.navigator, 'locks', {
        value: {},
        configurable: true,
    })
    ;(globalThis as unknown as { FileSystemFileHandle: { prototype: { createWritable: () => Promise<unknown> } } }).FileSystemFileHandle = {
        prototype: {
            createWritable: async () => ({}),
        },
    }
}

function revokeOpfsSupport(): void {
    Object.defineProperty(window.navigator, 'storage', { value: undefined, configurable: true })
    Object.defineProperty(window.navigator, 'locks', { value: undefined, configurable: true })
    delete (globalThis as unknown as { FileSystemFileHandle?: unknown }).FileSystemFileHandle
}

function mountPanel(): { target: HTMLElement; app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StorageMaintenanceSettings, { target, props: {} }) as unknown as Record<string, unknown>
    return { target, app }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

function hasIntegrityPanel(target: HTMLElement): boolean {
    return target.textContent?.includes(language.assetIntegrityHeading) ?? false
}

beforeEach(() => {
    platformState.isTauri = false
    platformState.isNodeServer = false
    revokeOpfsSupport()
})

afterEach(() => {
    revokeOpfsSupport()
})

describe('StorageMaintenanceSettings renders only the asset integrity panel (scenario 20)', () => {
    test('compatibility guard, Tauri: no panel renders', async () => {
        platformState.isTauri = true
        grantOpfsSupport()

        const { target, app } = mountPanel()
        flushSync()

        expect(hasIntegrityPanel(target)).toBe(false)
        expect(target.querySelectorAll('button').length).toBe(0)

        await teardown(target, app)
    })

    test('compatibility guard, Node: the integrity panel renders with its one button', async () => {
        platformState.isNodeServer = true
        grantOpfsSupport()

        const { target, app } = mountPanel()
        flushSync()

        expect(hasIntegrityPanel(target)).toBe(true)
        expect(target.querySelectorAll('button').length).toBe(1)

        await teardown(target, app)
    })

    test('new-behaviour test, web with OPFS support: the integrity panel renders and no storage switch button does', async () => {
        grantOpfsSupport()

        const { target, app } = mountPanel()
        flushSync()

        expect(hasIntegrityPanel(target)).toBe(true)
        expect(target.querySelectorAll('button').length).toBe(1)
        expect(target.querySelectorAll('button')[0].textContent?.trim()).toBe(language.assetIntegrityVerifyButton)

        await teardown(target, app)
    })

    test('compatibility guard, web without OPFS support: the integrity panel renders with its one button', async () => {
        revokeOpfsSupport()

        const { target, app } = mountPanel()
        flushSync()

        expect(hasIntegrityPanel(target)).toBe(true)
        expect(target.querySelectorAll('button').length).toBe(1)

        await teardown(target, app)
    })
})
