// @vitest-environment jsdom

/**
 * `AlertComp.svelte`'s `'tos'` block: the Terms and Privacy links read the scheme accent through the
 * `risu-link` class, and the accent is derived to stay at least 4.5:1 on the dialog's own surface (the
 * alert box is the pattern dialog: it paints the pattern surface).
 * The links were a fixed green (`text-green-600`), 2.82:1 on Light.
 *
 * The contrast test is a regression reproducer against that markup. The hover test is a new-rule guard:
 * hovering or focusing a link moves it to the scheme text colour under the hover-capable media query, and
 * a touch device keeps the accent. The fixtures are the real producers: the real AlertComp mounted from
 * source, the Tailwind output of `src/styles.css` compiled for it, and the real `updateColorScheme`,
 * resolved per element by the cascade model.
 *
 * MOCKED: the module set of `AlertComp.tos.svelte.test.ts` plus the system bars and the app store.
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

vi.mock(import('../../ts/characters'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        changeChar: vi.fn(),
    }
})

vi.mock(import('../../ts/media/avatarThumb'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        getAvatarThumbSrc: vi.fn(async () => null),
    }
})

vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

//#endregion

import { alertStore, DBState } from '../../ts/stores.svelte'
import { colorSchemeList, colorSchemePresets, updateColorScheme } from '../../ts/gui/colorscheme'
import { cr, parseConcrete, toHex, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, compositeHex, readRepoFile, type ModelEnv, type RuleSet } from '../../styles/tests/cascadeModel'
import AlertComp from './AlertComp.svelte'

let rules: RuleSet
let target: HTMLElement
let app: unknown
let links: HTMLElement[]
let box: HTMLElement

const rgbOf = (value: string | undefined): Rgba => {
    if (value === undefined) throw new Error('no painted colour')
    const c = parseConcrete(value.startsWith('#') ? value.slice(0, 7) : value)
    if (c === null) throw new Error(`unreadable colour ${value}`)
    return c
}
const modelOf = (env: ModelEnv = {}): CascadeModel => new CascadeModel(rules, env)

/**
 * The opaque surface the element's text sits on: the alert box paint, then every translucent background layer of the
 * ancestors between the box and the element, composited in order (a tint layer is a colour with alpha, or a gradient of one).
 */
function surfaceUnder(m: CascadeModel, el: HTMLElement): string {
    const chain: Element[] = []
    for (let node = el.parentElement; node && node !== box; node = node.parentElement) chain.unshift(node)
    let surface = toHex(rgbOf(m.painted(box)['background-color']))
    for (const node of chain) {
        const painted = m.painted(node)
        const layer = painted['background-color'] ?? painted['background-image']?.match(/#[0-9a-f]{8}/i)?.[0]
        if (layer !== undefined && layer.length === 9) surface = compositeHex(layer, surface)
    }
    return surface
}

function applyScheme(name: string): void {
    (DBState.db as unknown as Record<string, unknown>).colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    flushSync()
}

beforeAll(async () => {
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    rules = compileRules([
        await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte'))),
        { name: 'pattern-dialog', css: readRepoFile('src/lib/Nexus/pattern/pattern-dialog.css') },
        { name: 'pattern-alert', css: readRepoFile('src/lib/Nexus/pattern/pattern-alert.css') },
    ])
    target = document.createElement('div')
    document.body.appendChild(target)
    alertStore.set({ type: 'tos', msg: 'tos' } as never)
    app = mount(AlertComp, { target, props: {} })
    flushSync()
    links = Array.from(target.querySelectorAll<HTMLElement>('a[role="button"]'))
    box = target.querySelector<HTMLElement>('[data-alert-box]')!
}, 120000)

afterAll(async () => {
    if (app) await unmount(app as never).catch(() => {})
    target?.remove()
    alertStore.set({ type: 'none', msg: '' } as never)
    vi.unstubAllEnvs()
})

describe("AlertComp 'tos' block: the document links", () => {
    test('the two links are rendered in the alert box and carry the scheme link class', () => {
        expect(links.length).toBe(2)
        expect(box).not.toBeNull()
        for (const link of links) {
            expect(link.classList.contains('risu-link')).toBe(true)
            expect(Array.from(link.classList).filter((c) => /^(text|hover:text)-/.test(c))).toEqual([])
        }
    })

    test('regression reproducer: the links are underlined and carry the app focus ring, so they do not rely on colour alone', () => {
        expect(links.length).toBe(2)
        for (const link of links) {
            expect(link.classList.contains('underline')).toBe(true)
            expect(link.classList.contains('risu-focus-ring')).toBe(true)
        }
    })

    test.each(colorSchemeList)('%s: the links read at 4.5:1 on the surface painted under them: the pattern surface plus any tint layer that covers them', (name) => {
        applyScheme(name)
        const m = modelOf()
        const resolvedSurface = m.custom(box, '--pattern-surface')
        expect(resolvedSurface, 'the pattern surface token resolves').toBeDefined()
        expect(toHex(rgbOf(m.painted(box)['background-color']))).toBe(toHex(rgbOf(resolvedSurface)))
        for (const link of links) {
            const surface = surfaceUnder(m, link)
            const colour = m.painted(link).color
            expect(cr(rgbOf(colour), rgbOf(surface)), `${name} ${colour} on ${surface}`).toBeGreaterThanOrEqual(4.5)
        }
    })

    test.each(colorSchemeList)('%s: the links are the accent role at rest, the scheme text colour on hover or focus, and a touch device keeps the accent', (name) => {
        applyScheme(name)
        const role = document.documentElement.style.getPropertyValue('--risu-theme-role-accent')
        expect(role).not.toBe('')
        const link = links[0]
        expect(toHex(rgbOf(modelOf().painted(link).color))).toBe(toHex(rgbOf(role)))
        const hovered = modelOf({ hovered: link, hoverMedia: true }).painted(link)
        expect(toHex(rgbOf(hovered.color))).toBe(toHex(rgbOf(colorSchemePresets[name].textcolor)))
        const touch = modelOf({ hovered: link, hoverMedia: false }).painted(link)
        expect(toHex(rgbOf(touch.color))).toBe(toHex(rgbOf(role)))
    })
})
