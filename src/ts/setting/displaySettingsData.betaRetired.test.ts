/**
 * The Display settings registry has no Beta Mobile GUI row: the layout is retired, so a toggle for it would change
 * nothing. The `betaMobileGUI` database key itself stays (a `.bin` round trip carries it; see
 * `drive/tests/betaMobileGUIBinRoundTrip.svelte.test.ts`); only the row that binds it is gone.
 *
 * MOCKED: the application modules the data file imports for its click handlers, as in `settingLabelKeys.test.ts`.
 * Only the registry data is inspected, never those handlers.
 */
import { describe, expect, test, vi } from 'vitest'
import type { SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    sleep: vi.fn(),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/guisize'), () => ({
    guiSizeText: vi.fn(),
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    CustomGUISettingMenuStore: { set: vi.fn() },
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertConfirm: vi.fn(),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/translator/translator'), () => ({
    exportLLMCacheAsJSON: vi.fn(),
    importLLMCacheFromJSON: vi.fn(),
    clearLLMCache: vi.fn(),
}) as unknown as typeof import('src/ts/translator/translator'))

import * as registry from 'src/ts/setting/displaySettingsData.svelte'

function items(): SettingItem[] {
    const found: SettingItem[] = []
    const walk = (item: SettingItem) => {
        found.push(item)
        for (const child of item.options?.children ?? []) walk(child)
    }
    for (const exported of Object.values(registry)) {
        if (Array.isArray(exported)) {
            for (const item of exported) {
                if (typeof item === 'object' && item !== null && 'id' in item && 'type' in item) walk(item as SettingItem)
            }
        }
    }
    return found
}

describe('Display settings registry', () => {
    test('guard: the walk reaches the registry rows', () => {
        const ids = items().map((item) => item.id)
        expect(ids.length).toBeGreaterThan(10)
        expect(ids).toContain('display.theme')
    })

    test('T5: no row is the Beta Mobile GUI toggle', () => {
        const all = items()

        expect(all.find((item) => item.id === 'display.betaMobileGUI')).toBeUndefined()
        expect(all.find((item) => item.bindKey === 'betaMobileGUI')).toBeUndefined()
    })
})
