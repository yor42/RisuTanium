// @vitest-environment jsdom

/**
 * `GridCatalog.svelte`, edit row: the icon-only trash button paints its glyph in the scheme's derived
 * on-danger role, on the same red fills as the danger Button, on every built-in colour scheme (the same
 * defect as #355: the scheme text colour on a fixed red fill, 2.30:1 to 2.78:1 on five light presets).
 *
 * GC-1 (rest) and GC-2 (hovered, and the touch device that keeps the rest fill) are regression reproducers
 * against the markup that carried the scheme text colour and `hover:bg-red-500`. The fixtures are the real
 * producers: the real GridCatalog mounted from source, the Tailwind output of `src/styles.css` compiled for
 * it, and the real `updateColorScheme`, resolved per element by the cascade model. The icon form is the
 * one `chooseRowForms` returns when the row is narrower than count, Group and label; the geometry is
 * stubbed per instance after mount (the `GridCatalog.group.svelte.test.ts` precedent).
 *
 * MOCKED: the module set of `GridCatalog.edit.svelte.test.ts` plus the system bars and the app store;
 * geometry is faked. A device behaves differently in ways no jsdom run shows.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => {}),
            },
            getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
            checkCharOrder: vi.fn(),
            requiresFullEncoderReload: { state: false },
            AppendableBuffer: class {},
            VirtualWriter: class {},
            LocalWriter: class {},
            BlankWriter: class {},
            downloadFile: vi.fn(),
            openURL: vi.fn(),
            loadAsset: vi.fn(),
            saveAsset: vi.fn(),
            readImage: vi.fn(),
            globalFetch: vi.fn(),
            aiWatermarkingLawApplies: vi.fn(() => false),
            changeChatTo: vi.fn(),
            hubURL: '',
            getFetchLogs: vi.fn(() => []),
            getFetchData: vi.fn(() => ({})),
            aiLawApplies: vi.fn(() => false),
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('../../ts/stores.svelte')
    return {
        getDatabase: vi.fn((_options?: { snapshot?: boolean }) => DBState.db),
        getCurrentCharacter: vi.fn(() => DBState.db.characters?.[0]),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'),
    getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
    readDir: vi.fn(async () => []),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        MobileGUIStack: writable([]),
        CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }),
        MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 },
        SettingsMenuIndex: writable(0),
        ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false),
        botMakerMode: writable(false),
        DynamicGUI: writable(false),
        sideBarClosing: writable(false),
        sideBarStore: writable({ tab: 0 }),
        PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]),
        additionalHamburgerMenu: writable([]),
        CharConfigSubMenu: writable(0),
        MobileGUI: writable(false),
        hypaV3ModalOpen: writable(false),
        ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false),
        alertGenerationInfoStore: writable(null),
        CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
        SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
    } as unknown as typeof import('../../ts/stores.svelte')
})

vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
        removeChar: vi.fn(),
        trashCharacters: vi.fn(async () => 0),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

//#endregion

import { DBState } from '../../ts/stores.svelte'
import { language } from '../../lang'
import { colorSchemeList, updateColorScheme } from '../../ts/gui/colorscheme'
import { cr, parseConcrete, toHex, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, readRepoFile, type ModelEnv, type RuleSet } from '../../styles/tests/cascadeModel'
import { oklchToRgba } from '../../styles/tests/oklchColour'
import GridCatalog from './GridCatalog.svelte'

//#region fixtures

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        flushSync()
        await Promise.resolve()
    }
    flushSync()
}

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text.trim())

const rect = (width: number) => () => ({ left: 0, top: 0, right: width, bottom: 0, width, height: 0, x: 0, y: 0, toJSON: () => ({}) })

function rgbOf(value: string | undefined): Rgba {
    if (value === undefined) throw new Error('no painted colour')
    const c = value.startsWith('#') ? parseConcrete(value.slice(0, 7)) : (parseConcrete(value) ?? oklchToRgba(value))
    if (c === null) throw new Error(`unreadable colour ${value}`)
    return c
}

const hexOf = (value: string | undefined): string => toHex(rgbOf(value))

let rules: RuleSet
let target: HTMLElement
let app: unknown
let trash: HTMLButtonElement
let clientWidthDescriptor: PropertyDescriptor | undefined
const FILLS = { rest: '#c10007', hover: '#e7000b' } as const
const modelOf = (env: ModelEnv = {}): CascadeModel => new CascadeModel(rules, env)

function applyScheme(name: string): void {
    (DBState.db as unknown as Record<string, unknown>).colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    flushSync()
}

beforeAll(async () => {
    rules = compileRules([await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/GridCatalog.svelte')))])
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [{
            chaId: 'A', name: 'Char A', type: 'character', image: '', creatorNotes: '', chatPage: 0, lastInteraction: 0,
            chats: [{ id: 'A-chat', message: [], note: '', name: '', localLore: [] }],
        }],
        characterOrder: ['A'],
        hideAllImages: false,
    } as unknown as Database

    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 312 })
    // The scroller's own observer stays off; only the edit row's observer is captured, so its measurement can be driven.
    vi.stubGlobal('ResizeObserver', undefined)

    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(GridCatalog, { target, props: { endGrid: vi.fn() } })
    await settle()
    buttonByText(target, language.grid)!.click()
    await settle()
    const observed: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { observed.push(callback) }
        observe(): void {}
        disconnect(): void {}
    })
    const edit = buttonByText(target, language.othersUi.editMode)!
    edit.click()
    await settle()
    target.querySelector<HTMLButtonElement>('[data-charlist-key] button[aria-label="Char A"]')!.click()
    await settle()

    // The row is narrower than count, Group and label and wider than count, Group and icon: the icon form.
    const group = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.othersUi.editGroup}"]`)!
    const row = group.parentElement!
    const [full, number, label] = Array.from(row.querySelectorAll<HTMLElement>('span.invisible'))
    row.getBoundingClientRect = rect(280)
    group.getBoundingClientRect = rect(32)
    full.getBoundingClientRect = rect(90)
    number.getBoundingClientRect = rect(17)
    label.getBoundingClientRect = rect(260)
    observed.forEach((callback) => callback())
    await settle()
    trash = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.othersUi.editMoveToTrash}"]`)!
}, 120000)

afterAll(async () => {
    if (app) await unmount(app as never).catch(() => {})
    target?.remove()
    vi.unstubAllGlobals()
    if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
})

//#endregion

describe('GridCatalog: the icon-only trash button', () => {
    test('the icon form is rendered and its fills are the pinned red-700 and red-600', () => {
        expect(trash, 'the icon trash button').not.toBeNull()
        expect(trash.textContent?.trim()).toBe('')
        applyScheme('light')
        expect(hexOf(modelOf().painted(trash)['background-color'])).toBe(FILLS.rest)
        expect(hexOf(modelOf({ hovered: trash, hoverMedia: true }).painted(trash)['background-color'])).toBe(FILLS.hover)
    })

    // GC-1
    test.each(colorSchemeList)('GC-1 %s: the glyph reads at 4.5:1 on the rest fill and is the on-danger role', (name) => {
        applyScheme(name)
        const p = modelOf().painted(trash)
        expect(cr(rgbOf(p.color), rgbOf(p['background-color'])), `${name} ${p.color} on ${p['background-color']}`).toBeGreaterThanOrEqual(4.5)
        const role = document.documentElement.style.getPropertyValue('--risu-theme-role-on-danger')
        expect(hexOf(p.color)).toBe(hexOf(role))
    })

    // GC-2
    test.each(colorSchemeList)('GC-2 %s: the hovered glyph reads at 4.5:1 on the red-600 fill, and a touch device keeps the rest fill', (name) => {
        applyScheme(name)
        const hovered = modelOf({ hovered: trash, hoverMedia: true }).painted(trash)
        expect(hexOf(hovered['background-color'])).toBe(FILLS.hover)
        expect(cr(rgbOf(hovered.color), rgbOf(hovered['background-color'])), `${name} hover`).toBeGreaterThanOrEqual(4.5)
        const touch = modelOf({ hovered: trash, hoverMedia: false }).painted(trash)
        expect(hexOf(touch['background-color'])).toBe(FILLS.rest)
    })
})
