// @vitest-environment happy-dom

/**
 * The `.rtb` button of `UserSettings.svelte` (CHORE-128 S9) starts the entry once per click and calls no `.bin` function.
 * Real: `UserSettings.svelte` and its button. Faked: the entry, the `.bin` flows and the heavy sibling modules. Mounting
 * proves which function the button calls, not the export itself (`rtbExportEntry.test.ts` covers that).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const entry = vi.hoisted(() => ({ startRtbExport: vi.fn(async () => null) }))
const bin = vi.hoisted(() => ({ SaveLocalBackup: vi.fn(), SavePartialLocalBackup: vi.fn() }))

vi.mock('src/ts/drive/rtbExportEntry', () => entry)
vi.mock('src/ts/drive/settingsRestore', () => ({ restoreFromBinFile: vi.fn(), restoreFromInternalBackup: vi.fn() }))
vi.mock('src/ts/drive/backuplocal', () => bin)
vi.mock('src/ts/alert', () => ({ alertConfirm: vi.fn(async () => true) }))
vi.mock('src/ts/storage/exportAsDataset', () => ({ exportAsDataset: vi.fn() }))

import { language } from 'src/lang'
import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import UserSettings from './UserSettings.svelte'

let component: ReturnType<typeof mount> | null = null
let host: HTMLElement

function mountWith(kind: 'store2' | 'unset'): void {
    setPageStorageMode({ kind })
    host = document.createElement('div')
    document.body.appendChild(host)
    component = mount(UserSettings, { target: host })
    flushSync()
}

beforeEach(() => {
    entry.startRtbExport.mockClear()
    bin.SaveLocalBackup.mockClear()
    bin.SavePartialLocalBackup.mockClear()
})

afterEach(() => {
    if (component) { unmount(component) }
    component = null
    host.remove()
    resetPageStorageModeForTests()
})

function buttons(): string[] {
    return [...host.querySelectorAll('button')].map((candidate) => candidate.textContent?.trim() ?? '')
}

describe('the .rtb button', () => {
    test.each(['store2', 'unset'] as const)('on a %s page it sits directly below the .bin save button and one click starts the entry once', async (kind) => {
        mountWith(kind)
        const labels = buttons()
        expect(labels.indexOf(language.rtbExportButton)).toBe(labels.indexOf(language.saveBackupLocal) + 1)
        const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === language.rtbExportButton)
        button?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(entry.startRtbExport).toHaveBeenCalledTimes(1)
        expect(bin.SaveLocalBackup).not.toHaveBeenCalled()
        expect(bin.SavePartialLocalBackup).not.toHaveBeenCalled()
    })
})
