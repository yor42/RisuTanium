// @vitest-environment jsdom

/**
 * The shell Advanced page (legacy index 6) with the real page, rows, wrappers, registry and custom components. The
 * profile is built through the real `setDatabase` on an empty profile (MC-329).
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), and the platform, file, alert and
 * click-handler modules that `setDatabase` and the setting data import. The private-network toggle keeps its own
 * tests (`AdvancedSettings.privateNetwork.test.ts`), which mount the legacy page around the same component.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
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

//#endregion

import { language } from 'src/lang'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import AdvancedShellPage from './AdvancedShellPage.svelte'

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

function showPage(): { target: HTMLElement, page: PageExports } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const page = mount(AdvancedShellPage, { target }) as unknown as PageExports
    mounted.push(page as unknown as ReturnType<typeof mount>)
    flushSync()
    return { target, page }
}

function maybeRow(target: HTMLElement, id: string): HTMLElement | null {
    return [...target.querySelectorAll<HTMLElement>('[data-setting-row]')].find((el) => el.dataset.settingRow === id) ?? null
}

function sectionOf(target: HTMLElement, id: string): HTMLElement | null {
    return target.querySelector<HTMLElement>(`[data-section="${id}"]`)
}

function dbSnapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify($state.snapshot(DBState.db))) as Record<string, unknown>
}

beforeEach(() => {
    SettingsMenuIndex.set(6)
    DBState.db = freshProfile()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('the Advanced page at index 6', () => {
    test('a calm note opens the page and the red warning is gone', async () => {
        const { target } = showPage()
        await settle()
        expect(target.querySelector('[data-part="advanced-calm"]')?.textContent).toBe(language.settingsShellAdvCalm)
        expect(maybeRow(target, 'adv.warn')).toBeNull()
        expect(target.querySelector('.text-draculared')).toBeNull()
    })

    test('the groups render in order, with the gated ones absent while their gates are off', async () => {
        const { target } = showPage()
        await settle()
        const sections = [...target.querySelectorAll<HTMLElement>('[data-part="settings-section"]')].map((el) => el.dataset.section)
        expect(sections).toEqual(['adv.request', 'adv.lorebook', 'adv.chatload', 'adv.display', 'adv.prompt', 'adv.trouble', 'adv.gates', 'adv.custom', 'adv.other'])
    })

    test('the experimental section appears collapsed with its gate, and reveal opens it', async () => {
        const { target, page } = showPage()
        await settle()
        expect(await page.reveal('adv.exp.cachePoint')).toBeNull()
        DBState.db.useExperimental = true
        await settle()
        const experimental = sectionOf(target, 'adv.experimental')
        expect(experimental).not.toBeNull()
        expect(experimental!.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
        expect(maybeRow(target, 'adv.exp.cachePoint')).toBeNull()
        const row = await page.reveal('adv.exp.cachePoint')
        expect(row?.dataset.settingRow).toBe('adv.exp.cachePoint')
        expect(experimental!.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true')
    })

    test('the unrecommended section follows its gate and holds the old media finder', async () => {
        const { target, page } = showPage()
        await settle()
        expect(sectionOf(target, 'adv.unrecommended')).toBeNull()
        DBState.db.showUnrecommended = true
        await settle()
        expect(sectionOf(target, 'adv.unrecommended')).not.toBeNull()
        expect((await page.reveal('adv.legacyMedia'))?.dataset.settingRow).toBe('adv.legacyMedia')
        DBState.db.showUnrecommended = false
        await settle()
        expect(sectionOf(target, 'adv.unrecommended')).toBeNull()
        expect(maybeRow(target, 'adv.legacyMedia')).toBeNull()
    })

    test('streaming display never shows, even with the experimental gate on', async () => {
        DBState.db = freshProfile({ useExperimental: true })
        const { target, page } = showPage()
        await settle()
        await page.reveal('adv.exp.cachePoint')
        expect(maybeRow(target, 'adv.streamingDisplayOpt')).toBeNull()
        expect(await page.reveal('adv.streamingDisplayOpt')).toBeNull()
    })

    test('request info sits in Troubleshooting', async () => {
        const { target } = showPage()
        await settle()
        const trouble = sectionOf(target, 'adv.trouble')!
        expect(maybeRow(trouble, 'acc.requestInfoInsideChat')).not.toBeNull()
        expect(maybeRow(target, 'acc.requestInfoInsideChat')?.textContent).toContain(language.settingsShellAdvRequestInfo)
    })

    test('the Pro Tools link opens the Input page', async () => {
        const { target } = showPage()
        await settle()
        target.querySelector<HTMLElement>('[data-setting-row="adv.proToolsLink"] button')!.click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(11)
    })

    test('mounting writes nothing to the profile', async () => {
        DBState.db = freshProfile({ useExperimental: true, showUnrecommended: true })
        const before = dbSnapshot()
        showPage()
        await settle()
        expect(dbSnapshot()).toEqual(before)
    })
})
