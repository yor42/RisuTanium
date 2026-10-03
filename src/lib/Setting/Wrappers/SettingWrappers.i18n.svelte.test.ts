// @vitest-environment happy-dom

/**
 * The data-driven settings wrappers render registry labels in the active UI language, read
 * at render time: item labels, `Select` option labels (`SettingSelect.svelte`) and
 * `Segmented` option labels (`SettingSegmented.svelte`). An option whose language key is
 * absent falls back to its English `label`, never to the text "undefined". The settings
 * search still finds an item by its English fallback label while the UI is Korean.
 *
 * Items come from the REAL registry files (`advancedSettingsData.ts`,
 * `accessibilitySettingsData.ts`) and are rendered by the REAL wrappers over a `$state`
 * stand-in for `DBState`. MOCKED: `platform` (a web build), `alert` (`alertMd` only, used by
 * `Help.svelte`'s click handler), `stores.svelte`, and the registry files this test does not
 * use (emptied lists; `utils` imports them to build the full list).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Component } from 'svelte'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/setting/botSettingsParamsData'), () => ({
    basicParameterItems: [],
    modelSpecificParameterItems: [],
    penaltyParameterItems: [],
    samplingParameterItems: [],
    seedSetting: [],
}) as unknown as typeof import('src/ts/setting/botSettingsParamsData'))
vi.mock(import('src/ts/setting/chatFormatSettingsData'), () => ({
    chatFormatSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/chatFormatSettingsData'))
vi.mock(import('src/ts/setting/displaySettingsData.svelte'), () => ({
    displaySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/displaySettingsData.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import { accessibilitySettingsItems } from 'src/ts/setting/accessibilitySettingsData'
import { advancedSettingsItems } from 'src/ts/setting/advancedSettingsData'
import { getFullSettingsData } from 'src/ts/setting/utils'
import SettingSelect from './SettingSelect.svelte'
import SettingSegmented from './SettingSegmented.svelte'
import SettingCheck from './SettingCheck.svelte'

type Wrapper = Component<{ item: SettingItem, ctx: SettingContext }>

const ctx = {} as unknown as SettingContext

function itemById(id: string): SettingItem {
    const found = accessibilitySettingsItems.concat(advancedSettingsItems).find((i) => i.id === id)
    if (!found) throw new Error('registry item missing: ' + id)
    return found
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function render(wrapper: Wrapper, item: SettingItem): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(wrapper, { target, props: { item, ctx } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const optionTexts = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('option')).map((o) => o.textContent?.trim())
const labelText = (target: HTMLElement) => target.querySelector('span')?.textContent?.trim()

beforeEach(() => {
    DBState.db = {
        gptVisionQuality: 'low',
        autoScrollToNewMessage: true,
        alwaysScrollToNewMessage: false,
        longPressToPopupEditor: false,
        newMessageButtonStyle: 'bottom-center',
    } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('SettingSelect option labels', () => {
    test('regression reproducer: an option whose language key is absent renders its label, not "undefined"', () => {
        const item: SettingItem = {
            id: 'test.select',
            type: 'select',
            fallbackLabel: 'Test Select',
            options: {
                selectOptions: [
                    { value: 'a', label: 'Alpha Label', labelKey: 'noSuchLanguageKeyForTest' },
                    { value: 'b', label: 'Beta Label' },
                ],
            },
        }
        const shown = optionTexts(render(SettingSelect, item))
        expect(shown).toEqual(['Alpha Label', 'Beta Label'])
        expect(shown).not.toContain('undefined')
    })

    test('guard: English shows the exact English item and option text', () => {
        const target = render(SettingSelect, itemById('adv.visionQual'))
        expect(labelText(target)).toBe('Vision Quality')
        expect(optionTexts(target)).toEqual(['Low', 'High'])
    })

    test('regression reproducer: Korean shows the Korean item label and option labels', () => {
        changeLanguage('ko')
        const target = render(SettingSelect, itemById('adv.visionQual'))
        expect(labelText(target)).toBe(languageKorean.visionQuality)
        expect(optionTexts(target)).toEqual([languageKorean.optLow, languageKorean.optHigh])
        expect(languageKorean.visionQuality).not.toBe(languageEnglish.visionQuality)
        expect(languageKorean.optLow).not.toBe(languageEnglish.optLow)
    })
})

describe('registry option labels follow the language at render time', () => {
    test('regression reproducer: the new-message-button style options follow a language change made after import', () => {
        const item = accessibilitySettingsItems.find((i) =>
            i.options?.selectOptions?.some((o) => o.value === 'floating-circle'))
        if (!item) throw new Error('the new-message-button style item is missing')

        changeLanguage('ko')
        const shown = optionTexts(render(SettingSelect, item))
        expect(shown).toEqual([
            languageKorean.newMessageButtonBottomCenter,
            languageKorean.newMessageButtonBottomRight,
            languageKorean.newMessageButtonBottomLeft,
            languageKorean.newMessageButtonFloatingCircle,
            languageKorean.newMessageButtonRightCenter,
            languageKorean.newMessageButtonTopBar,
        ])
        expect(languageKorean.newMessageButtonTopBar).not.toBe(languageEnglish.newMessageButtonTopBar)
    })

    test('guard: English shows the exact English new-message-button style options', () => {
        const item = accessibilitySettingsItems.find((i) =>
            i.options?.selectOptions?.some((o) => o.value === 'floating-circle'))
        if (!item) throw new Error('the new-message-button style item is missing')
        expect(optionTexts(render(SettingSelect, item))).toEqual([
            languageEnglish.newMessageButtonBottomCenter,
            languageEnglish.newMessageButtonBottomRight,
            languageEnglish.newMessageButtonBottomLeft,
            languageEnglish.newMessageButtonFloatingCircle,
            languageEnglish.newMessageButtonRightCenter,
            languageEnglish.newMessageButtonTopBar,
        ])
    })

    test('regression reproducer: Korean shows a Segmented option label from the registry', () => {
        const item = advancedSettingsItems.find((i) =>
            i.options?.segmentOptions?.some((o) => o.value === 'fedramp'))
        if (!item) throw new Error('the data-region Segmented item is missing')

        changeLanguage('ko')
        const target = render(SettingSegmented, item)
        const buttons = Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())
        expect(buttons).toContain(languageKorean.optDefault)
        expect(languageKorean.optDefault).not.toBe(languageEnglish.optDefault)
    })

    test('guard: English shows the Segmented option "Default"', () => {
        const item = advancedSettingsItems.find((i) =>
            i.options?.segmentOptions?.some((o) => o.value === 'fedramp'))
        if (!item) throw new Error('the data-region Segmented item is missing')
        const target = render(SettingSegmented, item)
        const buttons = Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())
        expect(buttons).toContain('Default')
    })
})

describe('registry item labels', () => {
    test('guard: Korean acc.longPressToPopupEditor shows the Korean label', () => {
        const item = itemById('acc.longPressToPopupEditor')
        changeLanguage('ko')
        const korean = render(SettingCheck, item).textContent?.trim()
        expect(korean).toBe(languageKorean.longPressToPopupEditor)
        expect(korean).not.toBe('')
        expect(languageKorean.longPressToPopupEditor).not.toBe(languageEnglish.longPressToPopupEditor)
    })

    test('regression reproducer: English acc.longPressToPopupEditor shows its exact non-empty English label', () => {
        const target = render(SettingCheck, itemById('acc.longPressToPopupEditor'))
        expect(target.textContent).toContain('Long Press to Open Popup Editor')
    })
})

describe('settings search', () => {
    test('guard: an English search finds the Vision Quality item by id while the UI is Korean', () => {
        changeLanguage('ko')
        const ids = getFullSettingsData('Vision Quality').map((i) => i.id)
        expect(ids).toContain('adv.visionQual')
    })

    test('regression reproducer: the Korean label finds the item', () => {
        changeLanguage('ko')
        const ids = getFullSettingsData(languageKorean.visionQuality).map((i) => i.id)
        expect(ids).toContain('adv.visionQual')
    })
})
