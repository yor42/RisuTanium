// @vitest-environment happy-dom

/**
 * `UserSettings.svelte` ("Backup & Files"): the "Clean Unused Archived Data and Assets" button is never shown, whatever the
 * page storage mode (store2, read-only, unset, legacy, block). The buttons the store2 page keeps (save, partial save,
 * load, internal load, dataset) stay. The two backstops behind the removed button are in `exportAsDatasetStore2.test.ts`,
 * which runs the real functions. The manual "Clean Up Unused Files" button is shown only on a store2 page whose boot session is
 * a tauri, indexeddb or node one.
 *
 * MOCKED: every module the component calls into (backup, restore, dataset, alerts), the platform and the
 * `stores.svelte` state. `src/lang`, `Button.svelte` and the page storage mode store are real.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return false },
    get isNodeServer() { return false },
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { checkCorruption: false } as unknown as Database })
    return {
        DBState: state,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/drive/internalBackup'), () => ({
    loadInternalBackup: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/internalBackup'))

vi.mock(import('src/ts/drive/backuplocal'), () => ({
    LoadLocalBackup: vi.fn(),
    SaveLocalBackup: vi.fn(async () => ({ status: 'saved', notices: [] })),
    SavePartialLocalBackup: vi.fn(async () => ({ status: 'saved', notices: [] })),
}) as unknown as typeof import('src/ts/drive/backuplocal'))

vi.mock(import('src/ts/drive/backupWorkGuard'), () => ({
    refuseBackupLoadWhileBusy: vi.fn(() => false),
}) as unknown as typeof import('src/ts/drive/backupWorkGuard'))

vi.mock(import('src/ts/storage/exportAsDataset'), () => ({
    exportAsDataset: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/storage/exportAsDataset'))

//#endregion

import { language } from 'src/lang'
import { resetPageStorageModeForTests, setPageStorageMode, type PageStorageMode } from 'src/ts/storage/pageStorageMode'
import { resetStore2BootForTest, setStore2BootSession } from 'src/ts/storage/store2/bootActive'
import type { Store2Session } from 'src/ts/storage/store2/session'
import UserSettings from 'src/lib/Setting/Pages/UserSettings.svelte'

function mountPage(): { target: HTMLElement, app: Record<string, unknown> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(UserSettings, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    return { target, app }
}

async function teardown(target: HTMLElement, app: Record<string, unknown>): Promise<void> {
    await unmount(app as never)
    target.remove()
}

const buttonLabels = (target: HTMLElement): string[] => [...target.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? '')

beforeEach(() => {
    resetPageStorageModeForTests()
    resetStore2BootForTest()
})

afterEach(() => {
    resetPageStorageModeForTests()
    resetStore2BootForTest()
})

describe('UserSettings "Backup & Files" by page storage mode', () => {
    test('guard (G5): on a store2 page there is no clean-up button, and the other backup buttons are there', () => {
        setPageStorageMode({ kind: 'store2' })

        const { target, app } = mountPage()

        const labels = buttonLabels(target)
        expect(labels).not.toContain(language.cleanColdStorage)
        for (const expected of [language.saveBackupLocal, language.savePartialLocalBackup, language.loadBackupLocal, language.loadInternalBackup, language.exportAsDataset]) {
            expect(labels).toContain(expected)
        }
        return teardown(target, app)
    })

    test.each([
        { kind: 'unset' },
    ] as const satisfies readonly PageStorageMode[])('regression reproducer (G5): the clean-up button is never shown, page mode $kind', (mode) => {
        setPageStorageMode(mode)

        const { target, app } = mountPage()

        expect(buttonLabels(target)).not.toContain(language.cleanColdStorage)
        return teardown(target, app)
    })

    test.each([
        { kind: 'store2' },
        { kind: 'read-only', reason: 'opfs-transitional' },
        { kind: 'unset' },
    ] as const satisfies readonly PageStorageMode[])('guard (passes before and after): the clean-up button is never shown, page mode $kind', (mode) => {
        setPageStorageMode(mode)

        const { target, app } = mountPage()

        expect(buttonLabels(target)).not.toContain(language.cleanColdStorage)
        return teardown(target, app)
    })
})

describe('UserSettings "Backup & Files" has no service-worker cache panel', () => {
    test('R4 on a non-Tauri page there is no asset cache integrity heading or verify button', () => {
        setPageStorageMode({ kind: 'store2' })

        const { target, app } = mountPage()

        expect(target.textContent).not.toContain('Asset Cache Integrity')
        expect(target.textContent).not.toContain('Verify Asset Cache Now')
        expect(buttonLabels(target)).toContain(language.saveBackupLocal)
        return teardown(target, app)
    })
})

describe('UserSettings "Backup & Files" Clean Up Unused Files button', () => {
    const bootSession = (kind: Store2Session['kind']): Store2Session => ({ kind }) as Store2Session

    test.each(['tauri', 'indexeddb', 'node'] as const)('regression reproducer (AS9): a store2 page with a %s boot session shows the button', (kind) => {
        setPageStorageMode({ kind: 'store2' })
        setStore2BootSession(bootSession(kind))

        const { target, app } = mountPage()

        const labels = buttonLabels(target)
        expect(labels).toContain('Clean Up Unused Files')
        expect(labels).toContain(language.cleanUnusedFiles)
        expect(labels).not.toContain(language.cleanColdStorage)
        return teardown(target, app)
    })

    test('guard (U1): a store2 page with an opfs-transitional boot session shows no button', () => {
        setPageStorageMode({ kind: 'store2' })
        setStore2BootSession(bootSession('opfs-transitional'))

        const { target, app } = mountPage()

        expect(buttonLabels(target)).not.toContain(language.cleanUnusedFiles)
        return teardown(target, app)
    })

    test('guard (U1): a store2 page with no boot session shows no button', () => {
        setPageStorageMode({ kind: 'store2' })

        const { target, app } = mountPage()

        expect(buttonLabels(target)).not.toContain(language.cleanUnusedFiles)
        return teardown(target, app)
    })

    test.each([
        { kind: 'unset' },
        { kind: 'read-only', reason: 'opfs-transitional' },
    ] as const satisfies readonly PageStorageMode[])('guard (U1): page mode $kind shows no button even with a node boot session', (mode) => {
        setPageStorageMode(mode)
        setStore2BootSession(bootSession('node'))

        const { target, app } = mountPage()

        const labels = buttonLabels(target)
        expect(labels).not.toContain(language.cleanUnusedFiles)
        expect(labels).not.toContain(language.cleanColdStorage)
        return teardown(target, app)
    })
})
