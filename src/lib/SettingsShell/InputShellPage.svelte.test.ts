// @vitest-environment jsdom

/**
 * The shell Input page (legacy index 11) with the real page, rows, wrappers, registry and custom components. The
 * profile is built through the real `setDatabase` on an empty profile (MC-329), so every default is the one a fresh
 * install holds.
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

import { language } from 'src/lang'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import InputShellPage from './InputShellPage.svelte'

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

/** A pointer stub: a fine hovering pointer is `hover`, anything else is touch. */
function stubPointer(hover: boolean): void {
    window.matchMedia = ((query: string) => ({
        matches: hover && query.includes('hover: hover'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia
}

function showPage(): { target: HTMLElement, page: PageExports } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const page = mount(InputShellPage, { target }) as unknown as PageExports
    mounted.push(page as unknown as ReturnType<typeof mount>)
    flushSync()
    return { target, page }
}

function maybeRow(target: HTMLElement, id: string): HTMLElement | null {
    return [...target.querySelectorAll<HTMLElement>('[data-setting-row]')].find((el) => el.dataset.settingRow === id) ?? null
}

function dbSnapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify($state.snapshot(DBState.db))) as Record<string, unknown>
}

beforeEach(() => {
    SettingsMenuIndex.set(11)
    DBState.db = freshProfile()
    stubPointer(true)
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('the Input page at index 11', () => {
    test('the nine groups render in order and none is collapsible', async () => {
        const { target } = showPage()
        await settle()
        const sections = [...target.querySelectorAll<HTMLElement>('[data-part="settings-section"]')].map((el) => el.dataset.section)
        expect(sections).toEqual([
            'input.send', 'input.edit', 'input.scroll', 'input.gestures', 'input.menu',
            'input.confirm', 'input.a11y', 'input.other', 'input.preview',
        ])
        expect(target.querySelector('button[aria-expanded]')).toBeNull()
        const instant = maybeRow(target, 'acc.instantRemove')
        expect(instant?.textContent).toContain(language.settingsShellInputInstantRemove)
        expect(instant?.textContent).toContain(language.settingsShellInputInstantRemoveHint)
    })

    test('the new-message picker shows only with auto-scroll on and always-scroll off, and a radio stores its value', async () => {
        DBState.db = freshProfile({ autoScrollToNewMessage: false, alwaysScrollToNewMessage: false })
        const { target } = showPage()
        await settle()
        expect(maybeRow(target, 'acc.newMessageButtonStyle')).toBeNull()
        DBState.db.autoScrollToNewMessage = true
        DBState.db.alwaysScrollToNewMessage = true
        await settle()
        expect(maybeRow(target, 'acc.newMessageButtonStyle')).toBeNull()
        DBState.db.alwaysScrollToNewMessage = false
        await settle()
        const picker = maybeRow(target, 'acc.newMessageButtonStyle')
        expect(picker).not.toBeNull()
        expect(picker!.querySelectorAll('input[type="radio"]').length).toBe(6)
        picker!.querySelector<HTMLInputElement>('input[type="radio"][value="top-bar"]')!.click()
        await settle()
        expect(DBState.db.newMessageButtonStyle).toBe('top-bar')
    })

    test('the three preview and switch toggles are in the DOM on mount at phone width', async () => {
        const width = window.innerWidth
        window.innerWidth = 400
        try {
            const { target } = showPage()
            await settle()
            for (const id of ['acc.chatShellPreview', 'acc.settingsShellPreview', 'acc.studio']) {
                expect(maybeRow(target, id), id).not.toBeNull()
            }
        } finally {
            window.innerWidth = width
        }
    })

    test('a touch-only device shows the partial-edit note and no switch; a hover device shows the switch', async () => {
        stubPointer(false)
        const touch = showPage()
        await settle()
        const note = maybeRow(touch.target, 'acc.enableBlockPartialEdit')!
        expect(note.querySelector('[data-part="setting-row-note"]')?.textContent).toBe(language.settingsShellInputBlockEditTouch)
        expect(note.querySelector('input[type="checkbox"]')).toBeNull()
        stubPointer(true)
        const hover = showPage()
        await settle()
        const control = maybeRow(hover.target, 'acc.enableBlockPartialEdit')!
        expect(control.querySelector('input[type="checkbox"]')).not.toBeNull()
        expect(control.querySelector('[data-part="setting-row-note"]')).toBeNull()
    })

    test('an easier-to-read link opens Display', async () => {
        const { target } = showPage()
        await settle()
        target.querySelector<HTMLElement>('[data-setting-row="input.easySize"] button')!.click()
        flushSync()
        expect(get(SettingsMenuIndex)).toBe(3)
    })

    test('mounting writes nothing to the profile', async () => {
        const before = dbSnapshot()
        showPage()
        await settle()
        expect(dbSnapshot()).toEqual(before)
    })

    test('reveal returns the row element, and null for an unknown id or a row whose condition is false', async () => {
        const { page } = showPage()
        await settle()
        expect(await page.reveal('acc.sendWithEnter')).not.toBeNull()
        expect(await page.reveal('acc.nope')).toBeNull()
        DBState.db.autoScrollToNewMessage = false
        await settle()
        expect(await page.reveal('acc.newMessageButtonStyle')).toBeNull()
    })
})
