// @vitest-environment jsdom

/**
 * The classic Display page shows the Theme pack row in its Theme submenu, second after the theme select, and in the single
 * list of the legacy GUI (T4-8). The row is the real registry entry (the lazy loader); the loaded row is a stub, because the
 * real row and the theme pack runtime behind it are covered by ThemePackRow.svelte.test.ts.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores) and the platform, file, alert and click-handler
 * modules that `setDatabase` and the Display data import. The profile is built through the real `setDatabase` (MC-329).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

import { language } from 'src/lang'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import DisplaySettings from './DisplaySettings.svelte'
import { resetThemePackRowLoaderForTests } from './Display/ThemePackRowLoader.svelte'
import ThemePackRowStub from './Display/ThemePackRowStub.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function show(overrides: Partial<Record<keyof Database, unknown>> = {}): HTMLElement {
    const profile = { pluginCustomStorage: {}, ...overrides } as Database
    setDatabase(profile)
    DBState.db = profile
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(DisplaySettings, { target }))
    flushSync()
    return target
}

function installButtons(target: HTMLElement): HTMLElement[] {
    return [...target.querySelectorAll<HTMLElement>('[data-part="theme-pack-install"]')]
}

beforeEach(() => {
    resetThemePackRowLoaderForTests(async () => ({ default: ThemePackRowStub }))
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('the classic Display page (T4-8)', () => {
    test.each([
        ['a fresh profile', {}],
        ['the waifu theme', { theme: 'waifu' }],
    ] as const)('%s: the Theme submenu shows the loaded row', async (_name, overrides) => {
        const target = show(overrides)
        await settle()
        expect(installButtons(target)).toHaveLength(1)
        expect(target.textContent).not.toContain(language.themePackRowLoadFailed)
    })

    test('the Theme submenu is the only submenu that holds the row', async () => {
        const target = show()
        await settle()
        const tabs = [...target.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.className.includes('flex-1'))
        expect(tabs).toHaveLength(3)
        tabs[1].click()
        await settle()
        expect(installButtons(target)).toHaveLength(0)
        tabs[0].click()
        await settle()
        expect(installButtons(target)).toHaveLength(1)
    })

    test('the legacy GUI list shows the row once', async () => {
        const target = show({ useLegacyGUI: true })
        await settle()
        expect(installButtons(target)).toHaveLength(1)
    })
})
