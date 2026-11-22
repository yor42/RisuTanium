// @vitest-environment jsdom
/**
 * TA-5(e), the mounted-screen walk (part 2: Settings). Fixtures F4 (the shell index), F5 (the shell Display page with the Theme pack row,
 * loaded and failed) and F6 (the legacy Settings screen with the shell switch off, menu and Display page, and Lite). Everything on the
 * chains is real (SettingsSurface, SettingsShell, SettingsShellIndex, SettingsShellPage, DisplayShellPage, ShellSettingRow, SettingCustom,
 * Settings, DisplaySettings, SettingRenderer, ThemePackRowLoader, ThemePackRow); the mocks set state and stand in for the pages and
 * services that no chain contains.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { escapeWalkViolations } from './fixtures/criticalClosure'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS } from './engine'

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

import { isLite } from 'src/ts/lite'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import { setSettingsShellEnabled } from 'src/ts/settingsShell/settingsShellSwitch.svelte'
import { resetThemePackRowLoaderForTests } from 'src/lib/Setting/Pages/Display/ThemePackRowLoader.svelte'
import SettingsSurface from 'src/lib/SettingsShell/SettingsSurface.svelte'

const allowed = new Set<string>([...ESCAPE_ANCESTORS, ...CRITICAL_PARTS])
const DISPLAY_INDEX = 3

let mounted: Array<ReturnType<typeof mount>> = []
let container: HTMLElement

function setViewport(width: number): void {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

/** Mounts Settings and, when given a part, waits for it: the row loads through a dynamic import. */
async function openSettings(until?: string): Promise<void> {
    mounted.push(mount(SettingsSurface, { target: container }))
    await settle()
    if (until !== undefined) {
        await vi.waitFor(() => {
            flushSync()
            expect(container.querySelector(`[data-part="${until}"]`)).not.toBeNull()
        }, { timeout: 15000 })
    }
}

function walk(name: string, expected: { count: number, marked: boolean }): void {
    expect(escapeWalkViolations(container, name, expected, allowed)).toEqual([])
}

beforeEach(() => {
    localStorage.clear()
    setSettingsShellEnabled(false)
    isLite.set(false)
    const profile = { pluginCustomStorage: {}, themePacks: [] } as unknown as Database
    setDatabase(profile)
    DBState.db = profile
    resetThemePackRowLoaderForTests()
    container = document.createElement('div')
    document.body.append(container)
})

afterEach(() => {
    for (const app of mounted) unmount(app)
    mounted = []
    flushSync()
    container.remove()
    setSettingsShellEnabled(false)
})

describe('F4 the shell index', () => {
    for (const [label, width, index] of [['phone (index view)', 400, -1], ['wide', 1000, DISPLAY_INDEX]] as const) {
        test(`${label}: the Display entry is a marked escape element`, async () => {
            setViewport(width)
            setSettingsShellEnabled(true)
            SettingsMenuIndex.set(index)
            await openSettings()
            walk('settings-index-display', { count: 1, marked: true })
        })
    }
})

describe('F5 the shell Display page and the Theme pack row', () => {
    for (const [label, width] of [['phone', 400], ['wide', 1000]] as const) {
        test(`${label}: the loaded row sits under the host`, async () => {
            setViewport(width)
            setSettingsShellEnabled(true)
            SettingsMenuIndex.set(DISPLAY_INDEX)
            await openSettings('theme-pack-row')
            walk('theme-pack-row-host', { count: 1, marked: true })
            walk('theme-pack-row', { count: 1, marked: true })
        })

        test(`${label}: a row that fails to load shows the failure line under the host`, async () => {
            setViewport(width)
            resetThemePackRowLoaderForTests(async () => { throw new Error('chunk') })
            setSettingsShellEnabled(true)
            SettingsMenuIndex.set(DISPLAY_INDEX)
            await openSettings('theme-pack-load-failed')
            walk('theme-pack-row-host', { count: 1, marked: true })
            walk('theme-pack-load-failed', { count: 1, marked: true })
            walk('theme-pack-row', { count: 0, marked: true })
        })
    }
})

describe('F6 the legacy Settings screen', () => {
    for (const [label, width] of [['phone', 400], ['wide', 1000]] as const) {
        test(`${label}: the Display menu button is a marked escape element`, async () => {
            setViewport(width)
            SettingsMenuIndex.set(-1)
            await openSettings()
            walk('settings-index-display', { count: 1, marked: true })
        })

        test(`${label}: the Display page holds the Theme pack row`, async () => {
            setViewport(width)
            SettingsMenuIndex.set(DISPLAY_INDEX)
            await openSettings('theme-pack-row')
            walk('theme-pack-row-host', { count: 1, marked: true })
            walk('theme-pack-row', { count: 1, marked: true })
        })
    }

    test('Lite hides the Display button', async () => {
        setViewport(400)
        isLite.set(true)
        SettingsMenuIndex.set(-1)
        await openSettings()
        walk('settings-index-display', { count: 0, marked: true })
    })
})
