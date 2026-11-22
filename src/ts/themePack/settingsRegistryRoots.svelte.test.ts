// @vitest-environment jsdom
/**
 * The loaded roots of the Settings part census (#438 S3a-2). settingsParts.test.ts roots its component closure at the components the
 * two registry modules import and reads their record literals as text; this test loads both modules, under the mounted-screen mocks of
 * escapeWalk.settings.svelte.test.ts, and checks that each loaded record has as many keys and distinct components as its literal names:
 * an added key or a duplicated component fails here, whatever its source form. Overwriting an existing key with a new component is not seen.
 */
import path from 'node:path'
import { writable } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import { registryForms } from './fixtures/registryForms'
//#region module mocks

vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    decryptBuffer: vi.fn(async (d: unknown) => d),
    encryptBuffer: vi.fn(async (d: unknown) => d),
    selectSingleFile: vi.fn(async () => null),
    selectSingleFileObject: vi.fn(async () => null),
    readPickedFileBytes: vi.fn(async () => new Uint8Array()),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    changeFullscreen: vi.fn(),
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(), alertError: vi.fn(), alertConfirm: vi.fn(async () => false), alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    createHypaV3Preset: vi.fn((name: string, settings: unknown) => ({ name, settings })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))
vi.mock(import('src/ts/translator/presets'), () => ({ normalizeTranslatorPresetState: vi.fn() }) as unknown as typeof import('src/ts/translator/presets'))
vi.mock(import('src/ts/polyfill'), () => ({ safeStructuredClone: vi.fn((v: unknown) => JSON.parse(JSON.stringify(v))) }) as unknown as typeof import('src/ts/polyfill'))
vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) },
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(async () => {}), exists: vi.fn(async () => false), mkdir: vi.fn(async () => {}), readFile: vi.fn(async () => new Uint8Array()), BaseDirectory: { AppData: 0 },
}))
vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data), decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const menu = $state([] as unknown[])
    return {
        DBState: state,
        additionalSettingsMenu: menu,
        easyPanelStore: { open: false },
        SettingsMenuIndex: writable(-1),
        CustomGUISettingMenuStore: writable(false),
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The Theme pack row's own services: the apply status, the install machinery and the stores behind them.
vi.mock(import('src/ts/themePack/activePack.svelte'), async (importOriginal) => {
    const status = $state({ activeId: undefined, phase: 'none' })
    return { ...await importOriginal(), themePackApplyState: () => status, requestPackScheme: vi.fn(), cancelPackSchemeRequest: vi.fn() } as unknown as typeof import('src/ts/themePack/activePack.svelte')
})
vi.mock(import('src/ts/gui/colorscheme'), async (importOriginal) => ({ ...await importOriginal(), leavePackScheme: vi.fn() }))
vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => ({ ...await importOriginal(), requestSaveNow: vi.fn(), saveAsset: vi.fn() }))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('src/ts/lite', () => ({ isLite: writable(false) }))

// Pages and widgets that no chain contains.
vi.mock('src/lib/Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/Pages/UsageStatisticsPage.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SettingsShell/PersonasShellPage.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/SettingsShell/PluginsShellPage.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Setting/SettingsLegalLinks.svelte', () => ({ default: () => {} }))
vi.mock('src/lib/Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

//#endregion

import { customComponents } from 'src/ts/setting/customComponents'
import { settingRegistry } from 'src/ts/setting/settingRegistry'

const root = path.resolve(__dirname, '../../..')

describe('S3a-2 the loaded registry records equal their literals', () => {
    const cases: [string, string, Record<string, unknown>][] = [
        ['src/ts/setting/settingRegistry.ts', 'settingRegistry', settingRegistry],
        ['src/ts/setting/customComponents.ts', 'customComponents', customComponents],
    ]
    for (const [file, name, loaded] of cases) {
        it(`${name}: the number of distinct components and of keys is the number of entries of its literal`, () => {
            const forms = registryForms(path.join(root, file), name)
            expect(forms.unrecognised).toEqual([])
            expect(forms.values.length).toBeGreaterThan(0)
            expect(new Set(forms.values).size, 'the literal maps two keys to one component').toBe(forms.values.length)
            expect(Object.keys(loaded).length, `${name} keys`).toBe(forms.values.length)
            expect(new Set(Object.values(loaded)).size, `${name} distinct components`).toBe(forms.values.length)
        })
    }
})