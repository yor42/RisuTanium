// @vitest-environment happy-dom

/**
 * `UserSettings.svelte` ("Backup & Files") on a store2 page: the "Clean Unused Archived Data and Assets" button is
 * hidden, because only a legacy or block page owns what that clean-up deletes (`modeRunsLegacyDeleters`). The buttons the
 * store2 page keeps (save, partial save, load, internal load, dataset) stay. The two backstops behind the hidden button
 * are in `exportAsDatasetStore2.test.ts`, which runs the real functions.
 *
 * These are guards (B5 G5): the button follows the page storage mode, whatever the backup export does. The legacy-page test is the
 * control that shows the button is findable, so a hidden button on store2 is a result and not a selector miss.
 *
 * MOCKED: every module the component calls into (backup, restore, dataset, clean-up, alerts), the platform and the
 * `stores.svelte` state the nested maintenance panel binds. `src/lang`, `Button.svelte`, the nested panel and the page
 * storage mode store are real.
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

vi.mock(import('src/ts/storage/storageMaintenance'), () => ({
    verifyAssetIntegrity: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/storage/storageMaintenance'))

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
    confirmPartialBackup: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/drive/backuplocal'))

vi.mock(import('src/ts/drive/reloadFirst'), () => ({
    askReloadFirstThenExport: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/drive/reloadFirst'))

vi.mock(import('src/ts/drive/backupWorkGuard'), () => ({
    refuseBackupLoadWhileBusy: vi.fn(() => false),
}) as unknown as typeof import('src/ts/drive/backupWorkGuard'))

vi.mock(import('src/ts/storage/exportAsDataset'), () => ({
    exportAsDataset: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/storage/exportAsDataset'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    cleanColdStorage: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { confirmPartialBackup } from 'src/ts/drive/backuplocal'
import { askReloadFirstThenExport } from 'src/ts/drive/reloadFirst'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
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
    vi.clearAllMocks()
    resetPageStorageModeForTests()
})

afterEach(() => {
    resetPageStorageModeForTests()
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

    test('guard (G5 control): on a legacy page the clean-up button is there, so its absence on store2 is a result', () => {
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })

        const { target, app } = mountPage()

        expect(buttonLabels(target)).toContain(language.cleanColdStorage)
        return teardown(target, app)
    })

    test('guard (G5): the button follows the page mode: it appears for a block page and is gone again for an undecided one', () => {
        setPageStorageMode({ kind: 'block' })
        const { target, app } = mountPage()
        expect(buttonLabels(target)).toContain(language.cleanColdStorage)

        setPageStorageMode({ kind: 'unset' })
        flushSync()
        expect(buttonLabels(target)).not.toContain(language.cleanColdStorage)
        return teardown(target, app)
    })
})

describe('UserSettings backup buttons and the reload-first offer', () => {
    function clickButton(target: HTMLElement, label: string): void {
        const button = [...target.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label)
        expect(button).toBeDefined()
        button!.click()
    }

    test('reproducer: the full button asks for the offer for a full export after the backup confirm', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => true)
        setPageStorageMode({ kind: 'store2' })
        const { target, app } = mountPage()

        clickButton(target, language.saveBackupLocal)
        await vi.waitFor(() => expect(askReloadFirstThenExport).toHaveBeenCalledWith('export-full'))

        expect(askReloadFirstThenExport).toHaveBeenCalledTimes(1)
        expect(confirmPartialBackup).not.toHaveBeenCalled()
        await teardown(target, app)
    })

    test('reproducer: the partial button asks the two explanations after the backup confirm and before the offer', async () => {
        const order: string[] = []
        vi.mocked(alertConfirm).mockImplementation(async () => { order.push('backupConfirm'); return true })
        vi.mocked(confirmPartialBackup).mockImplementation(async () => { order.push('explanations'); return true })
        vi.mocked(askReloadFirstThenExport).mockImplementation(async (kind) => { order.push('offer:' + kind) })
        setPageStorageMode({ kind: 'store2' })
        const { target, app } = mountPage()

        clickButton(target, language.savePartialLocalBackup)
        await vi.waitFor(() => expect(order).toEqual(['backupConfirm', 'explanations', 'offer:export-partial']))
        await teardown(target, app)
    })

    test('reproducer: declining the explanations means no offer and no export', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => true)
        vi.mocked(confirmPartialBackup).mockImplementation(async () => false)
        setPageStorageMode({ kind: 'store2' })
        const { target, app } = mountPage()

        clickButton(target, language.savePartialLocalBackup)
        await vi.waitFor(() => expect(confirmPartialBackup).toHaveBeenCalledTimes(1))
        await Promise.resolve()

        expect(askReloadFirstThenExport).not.toHaveBeenCalled()
        await teardown(target, app)
    })

    test('guard: declining the backup confirm starts nothing', async () => {
        vi.mocked(alertConfirm).mockImplementation(async () => false)
        setPageStorageMode({ kind: 'store2' })
        const { target, app } = mountPage()

        clickButton(target, language.saveBackupLocal)
        clickButton(target, language.savePartialLocalBackup)
        await vi.waitFor(() => expect(alertConfirm).toHaveBeenCalledTimes(2))
        await Promise.resolve()

        expect(askReloadFirstThenExport).not.toHaveBeenCalled()
        expect(confirmPartialBackup).not.toHaveBeenCalled()
        await teardown(target, app)
    })
})
