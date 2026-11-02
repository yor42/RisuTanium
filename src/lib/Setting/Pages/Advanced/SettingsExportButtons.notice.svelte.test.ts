// @vitest-environment happy-dom

/**
 * The bug-report settings export (`SettingsExportButtons.svelte`): after the download and the clipboard copy
 * the web build says the download started, desktop keeps the exported text. The component is real; the
 * database, download, clipboard, alert and platform are mocked.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const mocks = vi.hoisted(() => ({
    alertNormal: vi.fn(),
    downloadFile: vi.fn(async () => {}),
    writeText: vi.fn(async () => {}),
}))
const platformBox = vi.hoisted(() => ({ isTauri: false }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
    alertNormal: mocks.alertNormal,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: mocks.downloadFile,
    getRequestLog: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ aiModel: 'm' })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { statics: {} } },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { language } from 'src/lang'
import SettingsExportButtons from './SettingsExportButtons.svelte'

let mounted: Record<string, unknown> | null = null

beforeEach(() => {
    vi.clearAllMocks()
    platformBox.isTauri = false
    vi.stubGlobal('safeStructuredClone', (value: unknown) => JSON.parse(JSON.stringify(value)))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true })
})

afterEach(() => {
    if (mounted) {
        void unmount(mounted)
        mounted = null
    }
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
})

async function clickBugReport(): Promise<void> {
    const target = document.body.appendChild(document.createElement('div'))
    mounted = mount(SettingsExportButtons, { target }) as Record<string, unknown>
    flushSync()
    const button = Array.from(target.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes(language.settingsPage.exportSettingsBugReport))
    expect(button).toBeDefined()
    button?.click()
    await vi.waitFor(() => expect(mocks.alertNormal).toHaveBeenCalled())
}

describe('the bug-report settings export notice', () => {
    test('regression reproducer: on the web it says the download started', async () => {
        await clickBugReport()

        expect(mocks.downloadFile).toHaveBeenCalledTimes(1)
        expect(mocks.writeText).toHaveBeenCalledTimes(1)
        expect(mocks.alertNormal).toHaveBeenCalledWith(language.settingsReportDownloadStarted)
        expect(mocks.alertNormal).not.toHaveBeenCalledWith(language.settingsExported)
    })

    test('compatibility guard: on desktop it keeps the exported text', async () => {
        platformBox.isTauri = true
        await clickBugReport()

        expect(mocks.alertNormal).toHaveBeenCalledWith(language.settingsExported)
        expect(mocks.alertNormal).not.toHaveBeenCalledWith(language.settingsReportDownloadStarted)
    })
})
