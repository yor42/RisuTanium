// @vitest-environment jsdom

/**
 * The shell Display page at index 3 of the Settings page, with the real page, rows, wrappers, registry and custom
 * components. The profile is built through the real `setDatabase` on an empty profile (MC-329), so every default is
 * the one a fresh install holds.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState and plain writable stores), the platform, file, alert and click-handler
 * modules that `setDatabase` and the Display data import, and the legacy pages other than Display.
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
vi.mock('../Setting/Pages/UserSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/BotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/OtherBotSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PluginSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AdvancedSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/LanguageSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/AccessibilitySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PersonaSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/PromptSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/Module/ModuleSettings.svelte', () => ({ default: () => {} }))
vi.mock('../Setting/Pages/HotkeySettings.svelte', () => ({ default: () => {} }))
vi.mock('../Others/PluginDefinedIcon.svelte', () => ({ default: () => {} }))

//#endregion

import { language } from 'src/lang'
import { setDatabase, type Database } from 'src/ts/storage/database.svelte'
import { DBState, SettingsMenuIndex } from 'src/ts/stores.svelte'
import DisplayShellPage from './DisplayShellPage.svelte'
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

/** An empty profile through the real normaliser: what a fresh install holds. */
function freshProfile(overrides: Partial<Record<keyof Database, unknown>> = {}): Database {
    const profile = { pluginCustomStorage: {}, ...overrides } as Database
    setDatabase(profile)
    return profile
}

function show(index: number, phone = false): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(SettingsShellPage, { target, props: { index, phone, scrollMemory: new Map<number, number>() } }))
    flushSync()
    return target
}

function showPage(phone = false): { target: HTMLElement, page: PageExports } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const page = mount(DisplayShellPage, { target, props: { phone } }) as unknown as PageExports
    mounted.push(page as unknown as ReturnType<typeof mount>)
    flushSync()
    return { target, page }
}

function maybeRow(target: HTMLElement, id: string): HTMLElement | null {
    return [...target.querySelectorAll<HTMLElement>('[data-setting-row]')].find((el) => el.dataset.settingRow === id) ?? null
}

function row(target: HTMLElement, id: string): HTMLElement {
    const found = maybeRow(target, id)
    if (!found) throw new Error(`no row ${id}`)
    return found
}

function setProfile(overrides: Partial<Record<keyof Database, unknown>> = {}): void {
    DBState.db = freshProfile(overrides)
}

function slider(target: HTMLElement, id: string): HTMLElement {
    return row(target, id).querySelector<HTMLElement>('[role="slider"]')!
}

function press(el: HTMLElement, key: string): void {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
}

function checkbox(target: HTMLElement, id: string): HTMLInputElement {
    return row(target, id).querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

function openAdvanced(target: HTMLElement): void {
    target.querySelector<HTMLButtonElement>('[data-section="display.advanced"] button[aria-expanded]')!.click()
    flushSync()
}

/** The stored database as plain data, to compare before and after a mount. */
function dbSnapshot(): Record<string, unknown> {
    return JSON.parse(JSON.stringify($state.snapshot(DBState.db))) as Record<string, unknown>
}

/** The top-level keys whose stored value differs between two snapshots. */
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    )
}

beforeEach(() => {
    SettingsMenuIndex.set(3)
    DBState.db = freshProfile()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('the Display view at index 3 (T-B1, T-B6)', () => {
    test('T-B1: the shell page shows the five open sections in order and a collapsed Advanced section', async () => {
        const target = show(3)
        await settle()
        const sections = [...target.querySelectorAll<HTMLElement>('[data-part="settings-section"]')].map((el) => el.dataset.section)
        expect(sections).toEqual(['display.themeColor', 'display.fontSize', 'display.chat', 'display.sound', 'display.motion', 'display.advanced'])
        const advanced = target.querySelector<HTMLElement>('[data-section="display.advanced"]')!
        expect(advanced.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
        expect(advanced.querySelector('[data-setting-row]')).toBeNull()
    })

    test('T-B6: the quote-styling row is the positive reading of the stored inverse', async () => {
        DBState.db = freshProfile({ unformatQuotes: false })
        const target = show(3)
        await settle()
        const box = row(target, 'display.unformatQuotes').querySelector<HTMLInputElement>('input[type="checkbox"]')!
        expect(box.checked).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(3)
    })
})

describe('Advanced section', () => {
    test('starts collapsed with no rows, opens on a click, collapses again, and is collapsed on every mount', async () => {
        const first = showPage()
        await settle()
        const button = () => first.target.querySelector<HTMLButtonElement>('[data-section="display.advanced"] button[aria-expanded]')!
        expect(button().getAttribute('aria-expanded')).toBe('false')
        expect(maybeRow(first.target, 'display.customCSS')).toBeNull()
        openAdvanced(first.target)
        expect(button().getAttribute('aria-expanded')).toBe('true')
        expect(maybeRow(first.target, 'display.customCSS')).not.toBeNull()
        for (const id of ['display.hideApiKey', 'display.useLegacyGUI', 'display.menuSideBar', 'display.showPromptComparison', 'display.useAdditionalAssetsPreview']) {
            expect(maybeRow(first.target, id), id).not.toBeNull()
        }
        openAdvanced(first.target)
        expect(button().getAttribute('aria-expanded')).toBe('false')
        expect(maybeRow(first.target, 'display.customCSS')).toBeNull()
        openAdvanced(first.target)
        unmount(mounted.pop()!)
        first.target.remove()
        const second = showPage()
        expect(second.target.querySelector('[data-section="display.advanced"] button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
        expect(maybeRow(second.target, 'display.customCSS')).toBeNull()
    })

    test('the sticker shows only with unrecommended settings on, as in the legacy list', async () => {
        const { target } = showPage()
        openAdvanced(target)
        expect(maybeRow(target, 'display.useChatSticker')).toBeNull()
        unmount(mounted.pop()!)
        target.remove()
        setProfile({ showUnrecommended: true })
        const again = showPage()
        openAdvanced(again.target)
        expect(maybeRow(again.target, 'display.useChatSticker')).not.toBeNull()
    })
})

describe('reveal', () => {
    test('opens the owning collapsed section and resolves the row element', async () => {
        const { target, page } = showPage()
        expect(maybeRow(target, 'display.customCSS')).toBeNull()
        const found = await page.reveal('display.customCSS')
        expect(found).not.toBeNull()
        expect(found!.dataset.settingRow).toBe('display.customCSS')
        expect(target.querySelector('[data-section="display.advanced"] button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true')
    })

    test('resolves a row of an open section, an unknown row as null, and a row whose condition is false as null', async () => {
        const { page } = showPage()
        expect((await page.reveal('display.lineHeight'))!.dataset.settingRow).toBe('display.lineHeight')
        expect(await page.reveal('display.nothing')).toBeNull()
        expect(await page.reveal('display.waifuWidth')).toBeNull()
    })

    test('finds a quote box inside the chat section once custom quotes is on', async () => {
        setProfile({ customQuotes: true })
        const { page } = showPage()
        expect((await page.reveal('display.leadingSingleQuote'))!.dataset.settingRow).toBe('display.leadingSingleQuote')
    })
})

describe('inverse controls (T-B7)', () => {
    test('clicking the quote-styling switch writes the inverse of what it shows', async () => {
        setProfile({ unformatQuotes: false })
        const { target } = showPage()
        await settle()
        const box = checkbox(target, 'display.unformatQuotes')
        expect(box.checked).toBe(true)
        box.click()
        await settle()
        expect(DBState.db.unformatQuotes).toBe(true)
        expect(box.checked).toBe(false)
        box.click()
        await settle()
        expect(DBState.db.unformatQuotes).toBe(false)
    })

    test('the animation slider writes a stored duration of 1 minus its position, to two decimals', async () => {
        setProfile({ animationSpeed: 0.5 })
        const { target } = showPage()
        await settle()
        const handle = slider(target, 'display.animationSpeed')
        press(handle, 'ArrowRight')
        press(handle, 'ArrowRight')
        await settle()
        expect(DBState.db.animationSpeed).toBe(0.4)
        press(handle, 'End')
        await settle()
        expect(DBState.db.animationSpeed).toBe(0)
        expect(handle.getAttribute('aria-valuetext')).toBe(language.settingsShellAnimationInstant)
        press(handle, 'Home')
        await settle()
        expect(DBState.db.animationSpeed).toBe(1)
    })
})

describe('mounting writes nothing (T-B8)', () => {
    test.each([
        ['a fresh profile', {}],
        ['off-step values', { animationSpeed: 0.37, assetWidth: 12.5 }],
        ['an animation speed above the slider range', { animationSpeed: 2 }],
        ['custom quotes on with no stored boxes', { customQuotes: true }],
        ['the waifu theme, a custom font and a custom colour scheme', { theme: 'waifu', font: 'custom', colorSchemeName: 'custom' }],
        ['the retired custom theme', { theme: 'custom' }],
    ] as const)('%s: the stored values are identical after mount, a flush and a tick', async (_name, overrides) => {
        setProfile(overrides)
        if ('customQuotes' in overrides) DBState.db.customQuotesData = undefined
        const before = dbSnapshot()
        const { target } = showPage()
        await settle()
        openAdvanced(target)
        await settle()
        expect(changedKeys(before, dbSnapshot())).toEqual([])
    })

    test('the off-step values are shown as stored', async () => {
        setProfile({ animationSpeed: 0.37, assetWidth: 12.5 })
        const { target } = showPage()
        await settle()
        expect(slider(target, 'display.animationSpeed').getAttribute('aria-valuetext')).toBe(language.settingsShellAnimationSeconds(0.37))
        expect(row(target, 'display.assetWidth').querySelector('[role="slider"]')!.getAttribute('aria-valuetext')).toBe(language.settingsShellAssetRem(12.5))
    })
})

describe('asset width modes', () => {
    function radio(target: HTMLElement, value: string): HTMLInputElement {
        return row(target, 'display.assetWidth').querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!
    }

    test('unlimited, hidden and custom write -1, 0 and the width, and the slider shows only in custom mode', async () => {
        setProfile({ assetWidth: -1 })
        const { target } = showPage()
        await settle()
        expect(radio(target, 'unlimited').checked).toBe(true)
        expect(row(target, 'display.assetWidth').querySelector('[role="slider"]')).toBeNull()
        radio(target, 'hidden').click()
        await settle()
        expect(DBState.db.assetWidth).toBe(0)
        expect(radio(target, 'hidden').checked).toBe(true)
        radio(target, 'custom').click()
        await settle()
        expect(DBState.db.assetWidth).toBe(20)
        const handle = row(target, 'display.assetWidth').querySelector<HTMLElement>('[role="slider"]')!
        press(handle, 'ArrowRight')
        await settle()
        expect(DBState.db.assetWidth).toBe(21)
        radio(target, 'unlimited').click()
        await settle()
        expect(DBState.db.assetWidth).toBe(-1)
        radio(target, 'custom').click()
        await settle()
        expect(DBState.db.assetWidth).toBe(21)
    })

    test('a stored custom width opens in custom mode', async () => {
        setProfile({ assetWidth: 12.5 })
        const { target } = showPage()
        await settle()
        expect(radio(target, 'custom').checked).toBe(true)
        expect(radio(target, 'unlimited').checked).toBe(false)
    })
})

describe('dependent rows (T-B9)', () => {
    function dimmed(target: HTMLElement, id: string): boolean {
        return row(target, id).dataset.dimmed === 'true'
    }

    test('block quote styling is dimmed with its reason only while quote styling is off', async () => {
        setProfile({ unformatQuotes: false })
        const { target } = showPage()
        await settle()
        expect(dimmed(target, 'display.blockquoteStyling')).toBe(false)
        expect(row(target, 'display.blockquoteStyling').querySelector('[data-part="setting-row-reason"]')).toBeNull()
        DBState.db.unformatQuotes = true
        await settle()
        expect(dimmed(target, 'display.blockquoteStyling')).toBe(true)
        expect(row(target, 'display.blockquoteStyling').querySelector('[data-part="setting-row-reason"]')!.textContent).toBe(language.settingsShellBlockquoteDimmed)
        expect(row(target, 'display.blockquoteStyling').querySelector('input[type="checkbox"]')).not.toBeNull()
    })

    test('first-message pages are dimmed while swipe is off, and the jump opens Input', async () => {
        setProfile({ swipe: true })
        const { target } = showPage()
        await settle()
        expect(dimmed(target, 'display.showFirstMessagePages')).toBe(false)
        DBState.db.swipe = false
        await settle()
        expect(dimmed(target, 'display.showFirstMessagePages')).toBe(true)
        expect(row(target, 'display.showFirstMessagePages').querySelector('[data-part="setting-row-reason"]')!.textContent).toBe(language.settingsShellFirstPagesDimmed)
        SettingsMenuIndex.set(3)
        row(target, 'display.showFirstMessagePages').querySelector<HTMLButtonElement>('[data-part="setting-row-jump"]')!.click()
        expect(get(SettingsMenuIndex)).toBe(11)
    })
})

describe('theme and colour rows', () => {
    function themeRadio(target: HTMLElement, value: string): HTMLInputElement {
        return row(target, 'display.theme').querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!
    }

    test('five theme cards select the stored theme, and the waifu rows appear with the waifu theme', async () => {
        const { target } = showPage()
        await settle()
        expect(row(target, 'display.theme').querySelectorAll('input[type="radio"]')).toHaveLength(5)
        expect(themeRadio(target, '').checked).toBe(true)
        expect(maybeRow(target, 'display.waifuWidth')).toBeNull()
        themeRadio(target, 'waifu').click()
        await settle()
        expect(DBState.db.theme).toBe('waifu')
        expect(themeRadio(target, 'waifu').checked).toBe(true)
        expect(maybeRow(target, 'display.waifuWidth')).not.toBeNull()
        expect(maybeRow(target, 'display.waifuWidth2')).not.toBeNull()
        themeRadio(target, 'customHTML').click()
        await settle()
        expect(maybeRow(target, 'display.guiHTML')).not.toBeNull()
        expect(maybeRow(target, 'display.waifuWidth')).toBeNull()
    })

    test('the retired custom theme is not offered and no card is selected for it', async () => {
        setProfile({ theme: 'custom' })
        const { target } = showPage()
        await settle()
        expect(row(target, 'display.theme').querySelector('input[type="radio"][value="custom"]')).toBeNull()
        expect(row(target, 'display.theme').querySelector('input[type="radio"]:checked')).toBeNull()
        expect(maybeRow(target, 'display.customGui')).toBeNull()
        expect(DBState.db.theme).toBe('custom')
    })

    test('the colour-scheme grid is on the page', async () => {
        const { target } = showPage()
        await settle()
        expect(row(target, 'display.colorScheme').querySelectorAll('button[aria-pressed]').length).toBeGreaterThan(10)
    })
})

describe('chat display rows', () => {
    test('the four quote boxes and the preview show only with custom quotes on, falling back to the curly default', async () => {
        setProfile({ customQuotes: false })
        const { target } = showPage()
        await settle()
        expect(maybeRow(target, 'display.quoteBoxes')).toBeNull()
        expect(maybeRow(target, 'display.leadingDoubleQuote')).toBeNull()
        DBState.db.customQuotes = true
        DBState.db.customQuotesData = undefined
        await settle()
        const boxes = ['display.leadingDoubleQuote', 'display.trailingDoubleQuote', 'display.leadingSingleQuote', 'display.trailingSingleQuote']
            .map((id) => row(target, id).querySelector<HTMLInputElement>('input')!)
        expect(boxes.map((box) => box.value)).toEqual(['“', '”', '‘', '’'])
        expect(target.querySelector('[data-part="quote-preview"]')!.textContent).toContain(language.settingsShellQuotePreview('“', '”', '‘', '’'))
        boxes[0].value = '<<'
        boxes[0].dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(DBState.db.customQuotesData).toEqual(['<<', '”', '‘', '’'])
        expect(target.querySelector('[data-part="quote-preview"]')!.textContent).toContain(language.settingsShellQuotePreview('<<', '”', '‘', '’'))
    })

    test('the dead memory-limit fields are neither rows nor in the way, and their values stay', async () => {
        setProfile({ showMemoryLimit: true, memoryLimitThickness: 77 })
        const { target } = showPage()
        await settle()
        openAdvanced(target)
        expect(maybeRow(target, 'display.showMemoryLimit')).toBeNull()
        expect(maybeRow(target, 'display.memoryLimitThickness')).toBeNull()
        expect(DBState.db.showMemoryLimit).toBe(true)
        expect(DBState.db.memoryLimitThickness).toBe(77)
    })

    test('the close-button size is a slider on a wide layout and a note on a phone', async () => {
        const wide = showPage(false)
        await settle()
        expect(slider(wide.target, 'display.settingsCloseButtonSize')).not.toBeNull()
        unmount(mounted.pop()!)
        wide.target.remove()
        const phone = showPage(true)
        await settle()
        const closeRow = row(phone.target, 'display.settingsCloseButtonSize')
        expect(closeRow.querySelector('[role="slider"]')).toBeNull()
        expect(closeRow.querySelector('[data-part="setting-row-note"]')!.textContent).toBe(language.settingsShellCloseButtonPhone)
    })

    test('the notification row is on the page with its status line', async () => {
        const { target } = showPage()
        await settle()
        expect(row(target, 'display.notification').querySelector('[data-part="notification-status"]')).not.toBeNull()
    })
})

describe('labels come from the language keys (T-B10)', () => {
    const touched: Array<() => void> = []

    function stub(table: Record<string, string>, key: string, value: string): void {
        const before = table[key]
        table[key] = value
        touched.push(() => {
            if (before === undefined) delete table[key]
            else table[key] = before
        })
    }

    afterEach(() => {
        for (const undo of touched.splice(0)) undo()
    })

    test('step names on the named-step sliders and colour-scheme names are the key text, with the capitalised id as the fallback', async () => {
        const steps = language.settingsShellStepNames as unknown as Record<string, string>
        const schemes = language.settingsShellSchemeNames as unknown as Record<string, string>
        stub(steps, 'default', 'STEP-DEFAULT-SENTINEL')
        stub(steps, 'big', 'STEP-BIG-SENTINEL')
        stub(schemes, 'dark', 'SCHEME-DARK-SENTINEL')
        stub(schemes, 'monokai-light', 'SCHEME-MONOKAI-SENTINEL')
        delete schemes['sage-light']
        const { target } = showPage()
        await settle()
        expect(slider(target, 'display.textAreaSize').getAttribute('aria-valuetext')).toBe('STEP-DEFAULT-SENTINEL')
        const titles = [...row(target, 'display.colorScheme').querySelectorAll('button[title]')].map((button) => button.getAttribute('title'))
        expect(titles).toContain('SCHEME-DARK-SENTINEL')
        expect(titles).toContain('SCHEME-MONOKAI-SENTINEL')
        expect(titles).toContain('Sage Light')
        press(slider(target, 'display.textAreaTextSize'), 'ArrowRight')
        await settle()
        expect(slider(target, 'display.textAreaTextSize').getAttribute('aria-valuetext')).toBe('STEP-BIG-SENTINEL')
    })
})
