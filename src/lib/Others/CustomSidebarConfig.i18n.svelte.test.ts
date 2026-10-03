// @vitest-environment happy-dom

/**
 * `CustomSidebarConfig.svelte` lists settings items for the custom sidebar by their display
 * label and stores that label on the new entry. An item with a language key shows the
 * translated label, an item with only a fallback label shows that label, and only an item
 * with neither shows its id. The "Search..." placeholder follows the UI language.
 *
 * Mounts the REAL component over a `$state` stand-in for `DBState`. MOCKED:
 * `getFullSettingsData` (a three-item list, so the test controls which items exist) while
 * the real `getLabel` is kept, and the settings data files `utils` imports to build the full
 * list (emptied). The language module is switched per test and restored to English afterwards.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        customSideBarConfigDialogStore: { open: true },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/setting/accessibilitySettingsData'), () => ({
    accessibilitySettingsItems: [],
}) as unknown as typeof import('src/ts/setting/accessibilitySettingsData'))
vi.mock(import('src/ts/setting/advancedSettingsData'), () => ({
    advancedSettingsItems: [],
}) as unknown as typeof import('src/ts/setting/advancedSettingsData'))
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

const items = vi.hoisted(() => ({
    list: [
        { id: 'test.keyed', type: 'check', labelKey: 'visionQuality', fallbackLabel: 'Keyed Fallback' },
        { id: 'test.fallbackOnly', type: 'check', fallbackLabel: 'Fallback Only Label' },
        { id: 'test.neither', type: 'check' },
    ] as unknown[],
}))

vi.mock(import('src/ts/setting/utils'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getFullSettingsData: () => items.list as SettingItem[],
    }
})

import { DBState } from 'src/ts/stores.svelte'
import { changeLanguage } from 'src/lang'
import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'
import CustomSidebarConfig from './CustomSidebarConfig.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountDialog(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(CustomSidebarConfig, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function buttonWithText(target: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
    if (!found) throw new Error('no button with text: ' + text)
    return found
}

function openSettingsSubmenu(
    target: HTMLElement,
    settingsText: string = languageEnglish.settings,
    addItemText: string = languageEnglish.othersUi.addItem,
): void {
    // The button is found by its translated label, else by the English literal.
    const addItem = buttonTexts(target).includes(addItemText) ? addItemText : 'Add Item'
    buttonWithText(target, addItem).click()
    flushSync()
    buttonWithText(target, settingsText).click()
    flushSync()
}

const buttonTexts = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('button')).map((b) => b.textContent?.trim())

beforeEach(() => {
    DBState.db = { customSidebarItems: [] } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('custom sidebar settings submenu labels', () => {
    test('regression reproducer: an item with only a fallback label is shown and stored with that label', () => {
        const target = mountDialog()
        openSettingsSubmenu(target)

        expect(buttonTexts(target)).toContain('Fallback Only Label')
        expect(buttonTexts(target)).not.toContain('test.fallbackOnly')

        buttonWithText(target, 'Fallback Only Label').click()
        flushSync()

        const stored = DBState.db.customSidebarItems.at(-1)
        expect(stored?.subType).toBe('test.fallbackOnly')
        expect(stored?.label).toBe('Fallback Only Label')
    })

    test('regression reproducer: Korean shows and stores the keyed item and the placeholder in Korean', () => {
        changeLanguage('ko')
        const target = mountDialog()
        openSettingsSubmenu(target, languageKorean.settings, languageKorean.othersUi.addItem)

        expect(languageKorean.visionQuality).not.toBe(languageEnglish.visionQuality)
        expect(buttonTexts(target)).toContain(languageKorean.visionQuality)
        expect((target.querySelector('input') as HTMLInputElement).placeholder).toBe(languageKorean.settingsPage.searchEllipsis)
        expect(languageKorean.settingsPage.searchEllipsis).not.toBe(languageEnglish.settingsPage.searchEllipsis)

        buttonWithText(target, languageKorean.visionQuality).click()
        flushSync()
        expect(DBState.db.customSidebarItems.at(-1)?.label).toBe(languageKorean.visionQuality)
    })

    test('guard: an item with neither a key nor a fallback label shows and stores its id', () => {
        const target = mountDialog()
        openSettingsSubmenu(target)

        expect(buttonTexts(target)).toContain('test.neither')

        buttonWithText(target, 'test.neither').click()
        flushSync()

        const stored = DBState.db.customSidebarItems.at(-1)
        expect(stored?.subType).toBe('test.neither')
        expect(stored?.label).toBe('test.neither')
    })

    test('regression reproducer: Korean shows the empty-list text, Delete, Add Item, Close and Back to List in Korean', () => {
        changeLanguage('ko')
        const ko = languageKorean
        for (const [translated, english] of [
            [ko.othersUi.noCustomSidebarItems, languageEnglish.othersUi.noCustomSidebarItems],
            [ko.uiCommon.delete, languageEnglish.uiCommon.delete],
            [ko.othersUi.addItem, languageEnglish.othersUi.addItem],
            [ko.uiCommon.close, languageEnglish.uiCommon.close],
            [ko.othersUi.backToList, languageEnglish.othersUi.backToList],
        ]) {
            expect(translated).not.toBe(english)
        }

        const target = mountDialog()
        expect(target.textContent).toContain(ko.othersUi.noCustomSidebarItems)
        expect(target.textContent).not.toContain('No custom sidebar items configured')
        expect(buttonTexts(target)).toContain(ko.othersUi.addItem)
        expect(buttonTexts(target)).toContain(ko.uiCommon.close)
        expect(buttonTexts(target)).not.toContain('Add Item')
        expect(buttonTexts(target)).not.toContain('Close')

        buttonWithText(target, ko.othersUi.addItem).click()
        flushSync()
        expect(buttonTexts(target)).toContain(ko.othersUi.backToList)
        expect(buttonTexts(target)).not.toContain('Back to List')

        DBState.db.customSidebarItems.push({ id: 'x', type: 'model', subType: 'none', label: 'Entry' })
        buttonWithText(target, ko.othersUi.backToList).click()
        flushSync()
        expect(buttonTexts(target)).toContain(ko.uiCommon.delete)
        expect(buttonTexts(target)).not.toContain('Delete')
    })

    test('guard: English shows the keyed item by its English language value and the English placeholder', () => {
        const target = mountDialog()
        openSettingsSubmenu(target)

        expect(buttonTexts(target)).toContain(languageEnglish.visionQuality)
        expect(buttonTexts(target)).not.toContain('Keyed Fallback')
        expect((target.querySelector('input') as HTMLInputElement).placeholder).toBe('Search...')

        buttonWithText(target, languageEnglish.visionQuality).click()
        flushSync()
        expect(DBState.db.customSidebarItems.at(-1)?.label).toBe(languageEnglish.visionQuality)
    })
})
