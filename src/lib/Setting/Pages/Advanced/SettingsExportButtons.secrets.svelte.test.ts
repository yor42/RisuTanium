// @vitest-environment happy-dom

/**
 * The settings bug-report export (`SettingsExportButtons.svelte`) holds no
 * value of any database-scope credential entry of `SECRET_FIELDS`, in the
 * downloaded file or the copied text. The database is built from the registry
 * (one sentinel per credential path) and handed through a mocked
 * `getDatabase`; the component, the clone polyfill and the registry are real.
 *
 * `reproducer:` fails on the component before the registry-driven strip.
 * `guard:` passes before and after.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { language } from 'src/lang'
// Installs the real `globalThis.safeStructuredClone`, the same way `src/main.ts` does.
import 'src/ts/polyfill'
import { missingSentinels, sentinelObject, sentinelsIn } from 'src/ts/storage/tests/shareStripFixture'

const { liveDb, downloadFileMock } = vi.hoisted(() => ({
    liveDb: { value: {} as Record<string, unknown> },
    downloadFileMock: vi.fn(async (_name: string, _bytes: Uint8Array) => true),
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

async function exportReport(): Promise<{ text: string, report: Record<string, unknown> }> {
    instance = mount(SettingsExportButtons, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
    const button = Array.from(target.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes(language.settingsPage.exportSettingsBugReport))
    expect(button).toBeDefined()
    button!.click()
    await vi.waitFor(() => expect(downloadFileMock).toHaveBeenCalledTimes(1))
    const text = new TextDecoder().decode(downloadFileMock.mock.calls[0][1])
    await vi.waitFor(() => expect(clipboardText).not.toBe(''))
    expect(clipboardText).toBe(text)
    return { text, report: JSON.parse(text) as Record<string, unknown> }
}

function nested(report: Record<string, unknown>, field: string, key: string): unknown {
    return (report[field] as Record<string, unknown>)[key]
}

describe('settings bug-report export: credential entries of the registry', () => {
    const { object, leaves } = sentinelObject('database')

    test('reproducer: the fields the substring filter misses are blank, then no database credential sentinel remains', async () => {
        liveDb.value = { ...object, temperature: 0.7 }
        expect(missingSentinels(liveDb.value, leaves)).toEqual([])

        const { text, report } = await exportReport()

        expect(report.novellistAPI).toBe('')
        expect(report.mancerHeader).toBe('')
        expect(report.falToken).toBe('')
        expect(nested(report, 'openaiCompatImage', 'key')).toBe('')
        expect(nested(report, 'wavespeedImage', 'key')).toBe('')
        expect(nested(report, 'deeplXOptions', 'token')).toBe('')
        expect(report.vertexAccessToken).toBe('')
        expect((report.additionalParams as string[][])[0][1]).toBe('')
        expect(sentinelsIn(text, leaves)).toEqual([])
        expect(clipboardText).not.toContain('SENTINEL:')
    })

    test('reproducer: the connection store and the working proxy reference are left out of the report whole', async () => {
        liveDb.value = {
            temperature: 0.7,
            proxyConnectionId: 'conn-1',
            connections: [{ id: 'conn-1', name: 'host-name-sentinel', provider: 'reverse_proxy', key: 'SENTINEL:connection-key', url: 'https://url-sentinel.invalid/v1' }],
        }

        const { text, report } = await exportReport()

        expect(Object.hasOwn(report, 'connections')).toBe(false)
        expect(Object.hasOwn(report, 'proxyConnectionId')).toBe(false)
        expect(text).not.toContain('url-sentinel')
        expect(text).not.toContain('host-name-sentinel')
        expect(text).not.toContain('SENTINEL:connection-key')
    })

    test('guard: non-credential look-alikes and ordinary settings are kept', async () => {
        liveDb.value = {
            ...object,
            temperature: 0.7,
            customTokenizer: 'tokenizer-name',
            vertexAccessTokenExpires: 1234,
        }

        const { report } = await exportReport()

        expect(report.temperature).toBe(0.7)
        expect(report.customTokenizer).toBe('tokenizer-name')
        expect(report.vertexAccessTokenExpires).toBe(1234)
    })
})
