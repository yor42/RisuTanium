// @vitest-environment jsdom

/**
 * The markdown alert is a classic surface: its body span takes `prose-invert` only under a dark colour
 * scheme (a pack's fixed base tone does not move it), and its text colour comes from the scheme's
 * `textcolor`, which stays readable on the scheme's `darkbg` under every preset. A fixed gray utility
 * would paint over the prose colour and fail on light presets.
 *
 * Fixtures are the real producers: the real `updateColorScheme` over the real preset table, the real
 * `surfaceTone` stores, and the Tailwind output of `src/styles.css` compiled for `AlertComp.svelte`,
 * resolved per element by the cascade model. The module mocks follow `AlertComp.peerConflicts.svelte.test.ts`.
 * MOCKED: `ParseMarkdown` returns `<ul><li>item</li></ul>bare`, so the cascade over a list item and bare
 * text is under test, not the sanitizer; the system bars; the database and stores.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from '../../ts/platform'
import { cr, parseConcrete, type Rgba } from 'src/ts/themePack/colour'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, readRepoFile, type RuleSet } from 'src/styles/tests/cascadeModel'

//#region module mocks (see file header)

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
        getDatabase: vi.fn((options?: { snapshot?: boolean }) => DBState.db),
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
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
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

vi.mock(import('../../ts/parser/parser.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ParseMarkdown: vi.fn(async () => '<ul><li>item</li></ul>bare'),
    }
})

//#endregion

import { colorSchemeList, colorSchemePresets, updateColorScheme } from 'src/ts/gui/colorscheme'
import { ColorSchemeTypeStore, packBaseTone } from 'src/ts/gui/surfaceTone'
import { alertStore, DBState } from '../../ts/stores.svelte'
import AlertComp from './AlertComp.svelte'

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
let rules: RuleSet

function applyScheme(name: string): void {
    ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

async function showAlert(): Promise<{ span: HTMLElement; li: HTMLElement | null }> {
    alertStore.set({ type: 'markdown', msg: '- item\n\nbare' } as never)
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(AlertComp, { target, props: {} }))
    flushSync()
    await tick()
    await tick()
    const span = target.querySelector<HTMLElement>('span.chattext.prose')
    expect(span, 'the markdown body span').not.toBeNull()
    return { span: span!, li: span!.querySelector<HTMLElement>('li') }
}

/** Tailwind's default palette (`text-gray-300`) is written in oklch, which the colour parser does not read; out-of-gamut values are clipped. */
function oklchToRgba(token: string): Rgba | null {
    const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(token)
    if (m === null) return null
    const L = Number(m[1]) / (m[2] === '%' ? 100 : 1)
    const C = Number(m[3])
    const hue = (Number(m[4]) * Math.PI) / 180
    const a = C * Math.cos(hue)
    const b = C * Math.sin(hue)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const lin = [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
    ]
    const gamma = (v: number): number => {
        const c2 = Math.min(1, Math.max(0, v))
        return 255 * (c2 <= 0.0031308 ? 12.92 * c2 : 1.055 * c2 ** (1 / 2.4) - 0.055)
    }
    return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2]), 1]
}

beforeAll(async () => {
    rules = compileRules([await compileAppStyles(classCandidates(readRepoFile('src/lib/Others/AlertComp.svelte')))])
}, 120000)

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((target) => target.remove())
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
    document.documentElement.removeAttribute('style')
    ColorSchemeTypeStore.set('dark')
    packBaseTone.set(null)
})

afterAll(() => {
    document.documentElement.removeAttribute('style')
})

describe('AlertComp markdown body prose-invert follows the colour scheme', () => {
    test('RR: a light scheme does not invert the prose', async () => {
        applyScheme('light')
        const { span } = await showAlert()
        expect(span.classList.contains('prose-invert')).toBe(false)
    })

    test('RR: a light scheme under a dark pack base is still not inverted', async () => {
        applyScheme('light')
        packBaseTone.set('dark')
        const { span } = await showAlert()
        expect(span.classList.contains('prose-invert')).toBe(false)
    })

    test('CG (passes before and after): a dark scheme inverts the prose', async () => {
        applyScheme('default')
        const { span } = await showAlert()
        expect(span.classList.contains('prose-invert')).toBe(true)
    })

    test('CG (passes before and after): a dark scheme under a light pack base is still inverted', async () => {
        applyScheme('default')
        packBaseTone.set('light')
        const { span } = await showAlert()
        expect(span.classList.contains('prose-invert')).toBe(true)
    })
})

describe('AlertComp markdown body text is readable on the scheme darkbg', () => {
    test('the compiled sheet is live and the scheme list is not empty', () => {
        expect(colorSchemeList.length).toBeGreaterThan(0)
        expect(rules.rules.length).toBeGreaterThan(0)
    })

    test.each(colorSchemeList)('%s: the span (bare text) and a list item paint at least 4.5:1 on darkbg', async (name) => {
        applyScheme(name)
        const { span, li } = await showAlert()
        expect(li, 'the list item').not.toBeNull()
        const model = new CascadeModel(rules)
        const darkbg = parseConcrete(colorSchemePresets[name].darkbg)!
        const ratio = (el: HTMLElement): number => {
            const painted = model.painted(el).color
            const colour = parseConcrete(painted.slice(0, 7)) ?? oklchToRgba(painted)
            expect(colour, `${name}: painted colour ${painted} is a concrete colour`).not.toBeNull()
            return cr(colour!, darkbg)
        }
        expect(ratio(span), `${name} span`).toBeGreaterThanOrEqual(4.5)
        expect(ratio(li!), `${name} li`).toBeGreaterThanOrEqual(4.5)
    })
})
