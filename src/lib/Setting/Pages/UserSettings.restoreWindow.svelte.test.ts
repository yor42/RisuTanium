// @vitest-environment happy-dom

/**
 * The two restore buttons of `UserSettings.svelte` start the Settings restore flows (`settingsRestore.ts`), which hold the
 * restore run across the confirmations and the loader. A button that called a loader directly would leave a card opened on
 * Android unprotected during the confirmations and the picker.
 *
 * Real: `UserSettings.svelte` and its button. Faked: the flows, the loaders and the heavy sibling modules. Mounting proves
 * which function each button calls, not the flow itself (`settingsRestore.svelte.test.ts` and
 * `openedFilesSettingsRestore.svelte.test.ts` cover that).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flows = vi.hoisted(() => ({
    restoreFromBinFile: vi.fn(async () => { }),
    restoreFromInternalBackup: vi.fn(async () => { }),
}))
const loaders = vi.hoisted(() => ({
    LoadLocalBackup: vi.fn(async () => ({ outcome: 'canceled' })),
    loadInternalBackup: vi.fn(async () => ({ outcome: 'canceled' })),
}))

vi.mock('src/ts/drive/settingsRestore', () => flows)
vi.mock('src/ts/drive/backuplocal', () => ({
    SaveLocalBackup: vi.fn(),
    SavePartialLocalBackup: vi.fn(),
    LoadLocalBackup: loaders.LoadLocalBackup,
}))
vi.mock('src/ts/drive/internalBackup', () => ({ loadInternalBackup: loaders.loadInternalBackup }))
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('src/ts/storage/exportAsDataset', () => ({ exportAsDataset: vi.fn() }))
vi.mock('src/ts/process/coldstorage.svelte', () => ({ cleanColdStorage: vi.fn() }))
vi.mock('./StorageMaintenanceSettings.svelte', () => ({ default: () => { } }))
vi.mock('src/ts/storage/pageStorageMode', async () => {
    const { writable } = await import('svelte/store')
    return {
        modeRunsLegacyDeleters: () => false,
        pageStorageModeStore: writable({ kind: 'legacy' }),
    }
})

import { language } from 'src/lang'
import UserSettings from './UserSettings.svelte'

let component: ReturnType<typeof mount> | null = null
let host: HTMLElement

beforeEach(() => {
    flows.restoreFromBinFile.mockClear()
    flows.restoreFromInternalBackup.mockClear()
    loaders.LoadLocalBackup.mockClear()
    loaders.loadInternalBackup.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    component = mount(UserSettings, { target: host })
    flushSync()
})

afterEach(() => {
    if (component) { unmount(component) }
    component = null
    host.remove()
})

function clickButton(label: string): void {
    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label)
    if (!button) { throw new Error('no button labelled ' + label) }
    button.click()
}

describe('the Settings restore buttons', () => {
    test('the .bin button starts the restore flow and calls no loader itself', async () => {
        clickButton(language.loadBackupLocal)
        await Promise.resolve()
        expect(flows.restoreFromBinFile).toHaveBeenCalledTimes(1)
        expect(flows.restoreFromInternalBackup).not.toHaveBeenCalled()
        expect(loaders.LoadLocalBackup).not.toHaveBeenCalled()
    })

    test('the internal-backup button starts the restore flow and calls no loader itself', async () => {
        clickButton(language.loadInternalBackup)
        await Promise.resolve()
        expect(flows.restoreFromInternalBackup).toHaveBeenCalledTimes(1)
        expect(flows.restoreFromBinFile).not.toHaveBeenCalled()
        expect(loaders.loadInternalBackup).not.toHaveBeenCalled()
    })
})
