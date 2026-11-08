// @vitest-environment happy-dom

/**
 * The Display defaults table must equal what the REAL `setDatabase` fills on an empty profile, and every
 * Display field it fills must have an entry, so the changed-from-default marker never compares against a wrong or
 * missing default (I7). `setDatabase` runs for real with the module mocks of `databaseAccountField.test.ts`,
 * plus the click-handler modules the Display data imports.
 */

import { describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
    changeFullscreen: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(async () => {}),
    saveAsset: vi.fn(async () => ''),
    forageStorage: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    defaultColorScheme: { bgcolor: '#000000' },
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    guiSizeText: vi.fn(),
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/presets'), () => ({
    normalizeTranslatorPresetState: vi.fn(),
}) as unknown as typeof import('src/ts/translator/presets'))

vi.mock(import('src/ts/polyfill'), () => ({
    safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))),
}) as unknown as typeof import('src/ts/polyfill'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => {}),
    readFile: vi.fn(async () => new Uint8Array()),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Record<string, unknown> },
    selectedCharID: { subscribe: vi.fn(), set: vi.fn() },
    CustomGUISettingMenuStore: { set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/model/modellist'), async () => {
    const types = await import('src/ts/model/types')
    return {
        LLMFlags: types.LLMFlags,
        LLMFormat: types.LLMFormat,
        LLMTokenizer: types.LLMTokenizer,
    }
})

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

//#endregion

import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { changedFromDefault, defaultOf, fieldsWithDefault } from './settingDefaults'
import { displaySettingsItems } from './displaySettingsData.svelte'
import { SEARCH_EXCLUDED_IDS } from '../settingsShell/displayPresentation'

/**
 * The Display fields that can carry a marker: the fields the live Display list binds, plus the one a custom
 * component binds (the color scheme). Dead fields have no row and need no default.
 */
function displayFields(): Set<keyof Database> {
    const fields = new Set<keyof Database>(['colorSchemeName'])
    for (const item of displaySettingsItems) {
        if (item.bindKey !== undefined && !SEARCH_EXCLUDED_IDS.has(item.id)) fields.add(item.bindKey)
    }
    return fields
}

/** An empty profile through the real normaliser: what a fresh install holds. */
function freshProfile(): Database {
    const profile = { pluginCustomStorage: {} } as Database
    setDatabase(profile)
    return profile
}

describe('Display defaults against setDatabase (T-A8)', () => {
    test('each default equals the value setDatabase fills on an empty profile', () => {
        const profile = freshProfile()
        const mismatched = fieldsWithDefault()
            .filter((field) => !Object.is(profile[field], defaultOf(field)))
            .map((field) => `${field}: filled ${String(profile[field])}, table ${String(defaultOf(field))}`)
        expect(mismatched).toEqual([])
    })

    test('every Display field that setDatabase fills has an entry, and a field it leaves empty has none', () => {
        const profile = freshProfile()
        const bound = displayFields()
        const missing: string[] = []
        const unfilled: string[] = []
        for (const field of bound) {
            const filled = profile[field] !== undefined
            const known = defaultOf(field) !== undefined
            if (filled && !known) missing.push(field)
            if (!filled && known) unfilled.push(field)
        }
        expect(missing).toEqual([])
        expect(unfilled).toEqual([])
    })

    test('every table field is a Display field', () => {
        const bound = displayFields()
        expect(fieldsWithDefault().filter((field) => !bound.has(field))).toEqual([])
    })
})

describe('changedFromDefault (T-A11 seam)', () => {
    test('a value that differs from the default is changed, and the default itself is not', () => {
        expect(changedFromDefault('lineHeight', 1.5)).toBe(true)
        expect(changedFromDefault('lineHeight', 1.25)).toBe(false)
        expect(changedFromDefault('hideApiKey', false)).toBe(true)
        expect(changedFromDefault('hideApiKey', true)).toBe(false)
        expect(changedFromDefault('animationSpeed', 0.4)).toBe(false)
        expect(changedFromDefault('theme', 'waifu')).toBe(true)
    })

    test('an unset value counts as changed when the default is known', () => {
        expect(changedFromDefault('lineHeight', undefined)).toBe(true)
    })

    test('a field without a known default is never changed', () => {
        expect(defaultOf('roundIcons')).toBeUndefined()
        expect(changedFromDefault('roundIcons', true)).toBe(false)
        expect(changedFromDefault('roundIcons', false)).toBe(false)
    })
})
