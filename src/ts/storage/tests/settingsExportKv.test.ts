// @vitest-environment happy-dom

/**
 * The settings bug-report export (`SettingsExportButtons.svelte`) must not put
 * upstream's SaveKV data (`upstreamKvBlocks`) into the downloaded or copied
 * JSON: the field is carried data, not a setting.
 *
 * Mounts the real component, clicks its report button, and reads the JSON it
 * hands to `downloadFile` and to the clipboard. The database it reads is a
 * plain object through a mocked `getDatabase`; the download, the alerts and the
 * stores are mocks.
 *
 * `reproducer:` fails on the component before the field was on its deny list.
 * `guard:` passes before and after.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { language } from 'src/lang'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import 'src/ts/polyfill'

const { liveDb, downloadFileMock } = vi.hoisted(() => ({
    liveDb: { value: {} as Record<string, unknown> },
    downloadFileMock: vi.fn(async (_name: string, _bytes: Uint8Array) => {}),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => liveDb.value),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: downloadFileMock,
    getRequestLog: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))

import SettingsExportButtons from 'src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte'

let target: HTMLElement
let instance: Record<string, unknown> | null = null
let clipboardText = ''

beforeEach(() => {
    downloadFileMock.mockClear()
    clipboardText = ''
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn(async (text: string) => { clipboardText = text }) },
    })
    target = document.createElement('div')
    document.body.appendChild(target)
})

afterEach(() => {
    if (instance !== null) {
        void unmount(instance as never)
        instance = null
    }
    target.remove()
})

async function exportedReport(): Promise<Record<string, unknown>> {
    instance = mount(SettingsExportButtons, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    const button = Array.from(target.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes(language.settingsPage.exportSettingsBugReport))
    expect(button).toBeDefined()
    button!.click()
    await vi.waitFor(() => expect(downloadFileMock).toHaveBeenCalledTimes(1))
    const [name, bytes] = downloadFileMock.mock.calls[0]
    expect(name).toBe('risuai-settings-report.json')
    const downloaded = new TextDecoder().decode(bytes)
    await vi.waitFor(() => expect(clipboardText).not.toBe(''))
    expect(clipboardText).toBe(downloaded)
    return JSON.parse(downloaded) as Record<string, unknown>
}

describe('settings bug-report export', () => {
    test('reproducer: the upstream KV field is in neither the downloaded nor the copied JSON', async () => {
        liveDb.value = {
            temperature: 0.7,
            upstreamKvBlocks: { 'ns-a': { version: 1, entries: [{ k: 'secret-ish', v: 'carried data' }] } },
        }

        const report = await exportedReport()

        expect('upstreamKvBlocks' in report).toBe(false)
        expect(clipboardText).not.toContain('carried data')
    })

    test('guard: ordinary settings are exported and the existing deny list still applies', async () => {
        liveDb.value = { temperature: 0.7, username: 'someone', apikey: 'k', characters: [{ name: 'c' }] }

        const report = await exportedReport()

        expect(report.temperature).toBe(0.7)
        expect('username' in report).toBe(false)
        expect('apikey' in report).toBe(false)
        expect('characters' in report).toBe(false)
        expect('meta' in report).toBe(true)
    })
})
