// @vitest-environment jsdom

/**
 * The generic section renderer behind the Input, Language and Advanced pages, driven with small synthetic sections
 * of real legacy rows: collapsing, gate visibility, jump rows, the touch note and `reveal`.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), and the platform, file, alert and
 * click-handler modules that `setDatabase` and the setting data import.
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

import { accessibilitySettingsItems } from 'src/ts/setting/accessibilitySettingsData'
import type { ShellSection } from 'src/ts/setting/shellSections'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import ShellSectionsPage from './ShellSectionsPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

type PageExports = { reveal(rowId: string): Promise<HTMLElement | null> }

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function legacy(id: string) {
    const found = accessibilitySettingsItems.find((item) => item.id === id)
    if (!found) throw new Error(`no legacy item ${id}`)
    return found
}

const SECTIONS: readonly ShellSection[] = [
    {
        id: 'test.open',
        labelKey: 'settingsShellInputSend',
        collapsed: false,
        rows: [
            { kind: 'setting', item: legacy('acc.sendWithEnter'), hintKey: 'settingsShellInputSendWithEnterHint' },
            { kind: 'setting', item: legacy('acc.enableBlockPartialEdit'), touchNoteKey: 'settingsShellInputBlockEditTouch' },
            { kind: 'jump', id: 'test.jump', labelKey: 'settingsShellInputEasySize', hintKey: 'settingsShellInputEasySizeHint', index: 3 },
        ],
    },
    {
        id: 'test.gated',
        labelKey: 'settingsShellAdvExperimental',
        collapsed: true,
        when: (db) => db.useExperimental === true,
        rows: [{ kind: 'setting', item: legacy('acc.swipe') }],
    },
]

function showPage(touch = false): { target: HTMLElement, page: PageExports } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const page = mount(ShellSectionsPage, { target, props: { sections: SECTIONS, touch } }) as unknown as PageExports
    mounted.push(page as unknown as ReturnType<typeof mount>)
    flushSync()
    return { target, page }
}

function maybeRow(target: HTMLElement, id: string): HTMLElement | null {
    return [...target.querySelectorAll<HTMLElement>('[data-setting-row]')].find((el) => el.dataset.settingRow === id) ?? null
}

beforeEach(() => {
    SettingsMenuIndex.set(11)
    const profile = { pluginCustomStorage: {} } as Database
    setDatabase(profile)
    DBState.db = profile
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('ShellSectionsPage', () => {
    test('an open section renders its rows with its hint and jump row', async () => {
        const { target } = showPage()
        await settle()
        expect(maybeRow(target, 'acc.sendWithEnter')?.querySelector('[data-part="setting-row-hint"]')).not.toBeNull()
        expect(maybeRow(target, 'test.jump')).not.toBeNull()
        target.querySelector<HTMLElement>('[data-setting-row="test.jump"] button')!.click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(3)
    })

    test('a section whose gate is off renders nothing, and an open gate shows it collapsed', async () => {
        const { target } = showPage()
        await settle()
        expect(target.querySelector('[data-section="test.gated"]')).toBeNull()
        DBState.db.useExperimental = true
        await settle()
        const gated = target.querySelector<HTMLElement>('[data-section="test.gated"]')!
        expect(gated.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
        expect(maybeRow(target, 'acc.swipe')).toBeNull()
        gated.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click()
        flushSync()
        expect(maybeRow(target, 'acc.swipe')).not.toBeNull()
    })

    test('M3: reveal opens a collapsed section and returns the row; it returns null for a closed gate and an unknown id', async () => {
        const { target, page } = showPage()
        await settle()
        expect(await page.reveal('acc.swipe')).toBeNull()
        expect(await page.reveal('acc.nope')).toBeNull()
        DBState.db.useExperimental = true
        await settle()
        expect((await page.reveal('acc.swipe'))?.dataset.settingRow).toBe('acc.swipe')
        expect(target.querySelector('[data-section="test.gated"] button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true')
    })

    test('the touch note replaces the control only on a touch device', async () => {
        const hover = showPage(false)
        await settle()
        expect(maybeRow(hover.target, 'acc.enableBlockPartialEdit')?.querySelector('input[type="checkbox"]')).not.toBeNull()
        const touch = showPage(true)
        await settle()
        const row = maybeRow(touch.target, 'acc.enableBlockPartialEdit')!
        expect(row.querySelector('input[type="checkbox"]')).toBeNull()
        expect(row.querySelector('[data-part="setting-row-note"]')).not.toBeNull()
    })
})
