// @vitest-environment happy-dom

/**
 * The text and textarea settings wrappers render a registry placeholder in the active UI
 * language, read at render time through `getPlaceholder`. A `placeholderKey` that is absent,
 * empty or names a non-string value falls back to the item's English `options.placeholder`,
 * never to the text "undefined".
 *
 * The `adv.emoPrompt` item comes from the REAL registry (`advancedSettingsData.ts`) and is
 * rendered by the REAL wrappers over a `$state` stand-in for `DBState`. MOCKED: `platform`
 * (a web build), `alert` (`alertMd` only, used by `Help.svelte`'s click handler),
 * `stores.svelte`, and the registry files this test does not use (emptied lists; `utils`
 * imports them to build the full list).
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
    return { DBState: state, selIdState: { selId: -1 } } as unknown as typeof import('src/ts/stores.svelte')
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
import { advancedSettingsItems } from 'src/ts/setting/advancedSettingsData'
import { getPlaceholder } from 'src/ts/setting/utils'
import SettingText from './SettingText.svelte'
import SettingTextarea from './SettingTextarea.svelte'

type Wrapper = Component<{ item: SettingItem, ctx: SettingContext }>

const ctx = {} as unknown as SettingContext

function itemById(id: string): SettingItem {
    const found = advancedSettingsItems.find((i) => i.id === id)
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

const placeholderOf = (target: HTMLElement, selector: 'input' | 'textarea') =>
    target.querySelector(selector)?.getAttribute('placeholder')

function syntheticItem(type: 'text' | 'textarea', placeholderKey: string | undefined): SettingItem {
    return {
        id: 'test.' + type,
        type,
        fallbackLabel: 'Test',
        bindKey: 'emotionPrompt2',
        options: { placeholderKey, placeholder: 'English fallback' },
    }
}

beforeEach(() => {
    DBState.db = { emotionPrompt2: '' } as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

describe('text setting placeholder', () => {
    test('regression reproducer: Korean shows the Korean adv.emoPrompt placeholder', () => {
        changeLanguage('ko')
        const target = render(SettingText, itemById('adv.emoPrompt'))
        expect(placeholderOf(target, 'input')).toBe('비워 두면 기본값을 사용합니다')
    })

    test('guard: English shows the exact English adv.emoPrompt placeholder', () => {
        const target = render(SettingText, itemById('adv.emoPrompt'))
        expect(placeholderOf(target, 'input')).toBe('Leave it blank to use default')
        expect(languageEnglish.emotionPromptPlaceholder).toBe('Leave it blank to use default')
    })

    test('guard: a placeholderKey naming a missing key shows the English placeholder', () => {
        changeLanguage('ko')
        const target = render(SettingText, syntheticItem('text', 'noSuchLanguageKeyForTest'))
        expect(placeholderOf(target, 'input')).toBe('English fallback')
    })
})

describe('textarea setting placeholder', () => {
    test('regression reproducer: Korean shows the Korean placeholder named by placeholderKey', () => {
        changeLanguage('ko')
        const target = render(SettingTextarea, syntheticItem('textarea', 'emotionPromptPlaceholder'))
        expect(placeholderOf(target, 'textarea')).toBe('비워 두면 기본값을 사용합니다')
    })

    test('guard: a placeholderKey naming a missing key shows the English placeholder', () => {
        const target = render(SettingTextarea, syntheticItem('textarea', 'noSuchLanguageKeyForTest'))
        expect(placeholderOf(target, 'textarea')).toBe('English fallback')
    })
})

describe('getPlaceholder', () => {
    // getPlaceholder is the resolver the wrappers call; these are unit tests of its fallback rules.
    test('an item without a placeholderKey returns its placeholder', () => {
        expect(getPlaceholder(syntheticItem('text', undefined))).toBe('English fallback')
    })

    test('an empty placeholderKey returns the placeholder', () => {
        expect(getPlaceholder(syntheticItem('text', ''))).toBe('English fallback')
    })

    test('a placeholderKey naming a missing key returns the placeholder', () => {
        expect(getPlaceholder(syntheticItem('text', 'noSuchLanguageKeyForTest'))).toBe('English fallback')
    })

    test('a placeholderKey naming a non-string entry returns the placeholder', () => {
        expect(getPlaceholder(syntheticItem('text', 'settingsPage'))).toBe('English fallback')
    })

    test('an item with neither key nor placeholder returns undefined', () => {
        const item: SettingItem = { id: 'test.none', type: 'text', fallbackLabel: 'Test' }
        expect(getPlaceholder(item)).toBeUndefined()
    })

    test('a placeholderKey naming an existing key returns the active-language text', () => {
        changeLanguage('ko')
        expect(getPlaceholder(syntheticItem('text', 'emotionPromptPlaceholder'))).toBe('비워 두면 기본값을 사용합니다')
    })
})
