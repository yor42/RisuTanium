// @vitest-environment jsdom

/**
 * `SettingsShellPage.reveal` on the native pages. The page mounts the real native page for its index (Display,
 * Input, Language, Advanced) and `reveal` must reach the row on whichever one is on screen; the legacy pages that
 * are not native are mocked out.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file, alert and
 * click-handler modules that `setDatabase` and the setting data import, and the legacy pages that have no native
 * page yet.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    changeFullscreen: vi.fn(),
    sleep: vi.fn(async () => {}),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormal: vi.fn(),
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

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

vi.mock('src/ts/rpack/rpack_js.js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
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
        settingsOpen: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('./PluginsShellPage.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

//#endregion

import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import SettingsShellPage from './SettingsShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

type PageExports = { reveal(rowId: string): Promise<HTMLElement | null> }

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function freshProfile(overrides: Partial<Record<keyof Database, unknown>> = {}): Database {
    const profile = { pluginCustomStorage: {}, ...overrides } as Database
    setDatabase(profile)
    return profile
}

function show(index: number): PageExports {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const page = mount(SettingsShellPage, { target, props: { index, phone: false, scrollMemory: new Map<number, number>() } })
    mounted.push(page)
    flushSync()
    return page as unknown as PageExports
}

beforeEach(() => {
    DBState.db = freshProfile()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('reveal on the native pages', () => {
    test('R2: the Input page at index 11 reveals one of its rows', async () => {
        const page = show(11)
        await settle()
        const row = await page.reveal('acc.sendWithEnter')
        expect(row).not.toBeNull()
        expect(row?.dataset.settingRow).toBe('acc.sendWithEnter')
    })

    test('the Language page at index 10 reveals its rows', async () => {
        const page = show(10)
        await settle()
        expect((await page.reveal('lang.translatorLang'))?.dataset.settingRow).toBe('lang.translatorLang')
        expect(await page.reveal('acc.sendWithEnter')).toBeNull()
    })

    test('the Advanced page at index 6 reveals its rows, including the request-info row that moved in', async () => {
        const page = show(6)
        await settle()
        expect((await page.reveal('adv.genTime'))?.dataset.settingRow).toBe('adv.genTime')
        expect((await page.reveal('acc.requestInfoInsideChat'))?.dataset.settingRow).toBe('acc.requestInfoInsideChat')
        expect(await page.reveal('acc.sendWithEnter')).toBeNull()
    })

    test('the Display page at index 3 still reveals its rows, and a row of another page is not found', async () => {
        const page = show(3)
        await settle()
        expect(await page.reveal('display.lineHeight')).not.toBeNull()
        expect(await page.reveal('acc.sendWithEnter')).toBeNull()
    })
})
