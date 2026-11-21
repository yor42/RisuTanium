// @vitest-environment jsdom

/**
 * The statistics dump and the bug-report export (`SettingsExportButtons.svelte`) show and write no usage ledger key and no
 * `usagePriceOverrides`; `messages` and `imports` stay. The component is real; the database, download, alert and platform
 * are mocked. The assertions read what the component passes to `alertMd` and `downloadFile`, not rendered markup, so no
 * sanitizer is involved. Titles: `reproducer` fails when the filter or the strip is absent.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const { USAGE_STATICS, OVERRIDES } = vi.hoisted(() => ({
    USAGE_STATICS: {
        messages: 7,
        imports: 2,
        'u1|2026-06|chat|n|gpt-test': 3,
        'u1|2026-06|chat|i|gpt-test': 120,
        'u1|ovf|n': 1,
        'u2|future|shape': 5,
    } as Record<string, number>,
    OVERRIDES: { 'gpt-test': { input: '2.5', output: '10' } },
}))

const mocks = vi.hoisted(() => ({
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    downloadFile: vi.fn(async (_name: string, _bytes: Uint8Array) => true),
    writeText: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: mocks.alertMd,
    alertNormal: mocks.alertNormal,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: mocks.downloadFile,
    getRequestLog: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({ aiModel: 'm', statics: { ...USAGE_STATICS }, usagePriceOverrides: OVERRIDES, ltmEngine: true, ltmSettings: { budgetTokens: 1800, future: 1 } })),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { statics: { ...USAGE_STATICS }, usagePriceOverrides: OVERRIDES } },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { language } from 'src/lang'
import SettingsExportButtons from './SettingsExportButtons.svelte'

let mounted: Record<string, unknown> | null = null

beforeEach(() => {
    vi.clearAllMocks()
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

function press(label: string): void {
    const target = document.body.appendChild(document.createElement('div'))
    mounted = mount(SettingsExportButtons, { target }) as Record<string, unknown>
    flushSync()
    const button = Array.from(target.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(label))
    expect(button).toBeDefined()
    button?.click()
}

describe('the statistics dump', () => {
    test('reproducer: it lists messages and imports and no usage key of any version', async () => {
        press(language.settingsPage.showStatistics)
        await vi.waitFor(() => expect(mocks.alertMd).toHaveBeenCalled())

        const table = String(mocks.alertMd.mock.calls[0][0])
        expect(table).toContain('| messages | 7 |')
        expect(table).toContain('| imports | 2 |')
        expect(table).not.toContain('u1|')
        expect(table).not.toContain('u2|')
    })
})

describe('the bug-report export', () => {
    test('reproducer: the file holds statics.messages and no usage key, and no usagePriceOverrides', async () => {
        press(language.settingsPage.exportSettingsBugReport)
        await vi.waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledTimes(1))

        const text = new TextDecoder().decode(mocks.downloadFile.mock.calls[0][1])
        const report = JSON.parse(text) as { statics: Record<string, number>, usagePriceOverrides?: unknown }
        expect(report.statics).toEqual({ messages: 7, imports: 2 })
        expect(Object.hasOwn(report, 'usagePriceOverrides')).toBe(false)
        expect(text).not.toContain('u1|')
        expect(text).not.toContain('gpt-test')
    })

    test('P1 guard (passes before and after): the report keeps ltmEngine and ltmSettings unchanged, because neither name matches the key, proxy or hypa filters', async () => {
        press(language.settingsPage.exportSettingsBugReport)
        await vi.waitFor(() => expect(mocks.downloadFile).toHaveBeenCalledTimes(1))

        const report = JSON.parse(new TextDecoder().decode(mocks.downloadFile.mock.calls[0][1])) as Record<string, unknown>
        expect(report.ltmEngine).toBe(true)
        expect(report.ltmSettings).toEqual({ budgetTokens: 1800, future: 1 })
    })
})
