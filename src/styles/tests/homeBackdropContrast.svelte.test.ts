// @vitest-environment jsdom

/**
 * Contrast of Home text over a custom backdrop image across light and dark colour schemes (#591).
 *
 * REAL: `HomeShell`, `MainMenu`, `HomeTopBar`, `HomeGreeting`, `CommunityList`, `updateColorScheme`,
 * `src/styles/home-tokens.css`, compiled Tailwind output of `src/styles.css`, and compiled
 * `HomeGreeting.svelte` component CSS, all resolved per element by `CascadeModel`.
 *
 * MOCKED: database/stores, character/realm/alert/globalApi helpers, `HomeLibrary` (a lightweight
 * row stub with `text-textcolor` and `text-textcolor2`), `RealmMain`, and `NexusNetworkBackground`.
 */
import { flushSync, mount, onDestroy, tick, unmount } from 'svelte'
import { compile as compileSvelte } from 'svelte/compiler'
import { writable } from 'svelte/store'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { cr, over, parseConcrete, toHex, type Rgba } from 'src/ts/themePack/colour'
import {
    CascadeModel, classCandidates, compileAppStyles, compileRules, readRepoFile,
    type ModelSheet, type RuleSet,
} from 'src/styles/tests/cascadeModel'
import { oklchToRgba } from 'src/styles/tests/oklchColour'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    parseMultilangString: (value: string) => ({ en: value }),
    toLangName: (code: string) => code,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/characters'), () => ({
    createNewCharacter: vi.fn(),
    changeChar: vi.fn(),
    getCharImage: vi.fn(async () => ''),
    archivedMemberIds: () => [],
    changeCharGeneration: () => 0,
    supersedeChangeChar: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/characterPick'), () => ({
    changeCharOrAlert: vi.fn(async () => 'selected'),
}) as unknown as typeof import('src/ts/characterPick'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: h.db })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        sideBarStore: writable(false),
        PlaygroundStore: writable(0),
        selectedCharID: writable(-1),
        additionalHamburgerMenu: [],
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/lib/UI/Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

const libraryStub = vi.hoisted(() => (anchor: Comment) => {
    const row = document.createElement('div')
    row.setAttribute('data-part', 'library-row')
    row.innerHTML = '<span data-testid="char-name" class="text-textcolor">Alice</span><span data-testid="char-meta" class="text-textcolor2">3 | 2m</span>'
    anchor.parentNode!.insertBefore(row, anchor)
    onDestroy(() => row.remove())
})

vi.mock('src/lib/UI/Home/HomeLibrary.svelte', () => ({ default: libraryStub }))

vi.mock('src/lib/Nexus/network/nexusNetwork', () => ({
    createNetworkField: vi.fn(() => ({ destroy: vi.fn(), time: () => 0 })),
}))

import HomeShell from 'src/lib/UI/Home/HomeShell.svelte'
import { openHomeLibrary, startHomeView } from 'src/lib/UI/Home/homeView.svelte'
import { colorSchemePresets, defaultColorScheme, updateColorScheme } from 'src/ts/gui/colorscheme'
import { DBState } from 'src/ts/stores.svelte'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'

const HOME_GREETING_FILE = 'src/lib/UI/Home/HomeGreeting.svelte'

let tailwind: ModelSheet
let homeTokens: ModelSheet
let baseSheets: ModelSheet[]
let mounted: unknown[] = []
let targets: HTMLElement[] = []

function rgbOf(value: string | undefined): Rgba {
    if (value === undefined) throw new Error('no painted colour')
    const c = value.startsWith('#') ? parseConcrete(value.slice(0, 7)) : (parseConcrete(value) ?? oklchToRgba(value))
    if (c === null) throw new Error(`unreadable colour ${value}`)
    if (value.startsWith('#') && value.length === 9) {
        return [c[0], c[1], c[2], parseInt(value.slice(7, 9), 16) / 255]
    }
    return c
}

function applyScheme(name: keyof typeof colorSchemePresets): void {
    h.db.colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    flushSync()
}

function effectiveBg(model: CascadeModel, element: HTMLElement, backdropHex: string): Rgba {
    const landing = element.closest<HTMLElement>('[data-part="home-landing"]')
    const chain: HTMLElement[] = []
    let cur: HTMLElement | null = element
    while (cur) {
        chain.push(cur)
        if (cur === landing) break
        cur = cur.parentElement
    }
    chain.reverse()

    let bg = parseConcrete(backdropHex)!
    for (const node of chain) {
        const raw = model.painted(node)['background-color']
        if (!raw || raw === 'transparent') continue
        const layer = rgbOf(raw)
        if (layer[3] > 0) {
            bg = over(layer, bg)
        }
    }
    return bg
}

function effectiveFg(model: CascadeModel, element: HTMLElement, bg: Rgba): Rgba {
    const raw = model.painted(element).color
    const fg = rgbOf(raw)
    return fg[3] < 1 ? over(fg, bg) : fg
}

function greetingCssFor(root: HTMLElement): ModelSheet {
    const header = root.querySelector<HTMLElement>('[data-part="home-greeting"]')
    const scope = Array.from(header?.classList ?? []).find((c) => c.startsWith('svelte-')) ?? 'svelte-home-greeting'
    const css = compileSvelte(readRepoFile(HOME_GREETING_FILE), {
        filename: HOME_GREETING_FILE,
        css: 'external',
        cssHash: () => scope,
    }).css?.code ?? ''
    return { name: 'HomeGreeting', css }
}

function resetDb(overrides: Record<string, unknown> = {}): void {
    for (const key of Object.keys(h.db)) delete h.db[key]
    Object.assign(h.db, {
        language: 'en',
        colorScheme: structuredClone(defaultColorScheme),
        colorSchemeName: 'default',
        hideRealm: true,
        realmDirectOpen: false,
        hideAllImages: false,
        customBackground: '',
        theme: '',
        username: 'User',
        personas: [],
        selectedPersona: 0,
        characters: [{ type: 'character', chaId: 'a', name: 'Alice', image: '', chats: [], chatPage: 0 }],
        ...overrides,
    })
    DBState.db = h.db as unknown as typeof DBState.db
}

async function mountHome(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    mounted.push(mount(HomeShell, { target }))
    flushSync()
    openHomeLibrary()
    await tick()
    flushSync()
    return target
}

beforeAll(async () => {
    Element.prototype.scrollTo ??= vi.fn()
    tailwind = await compileAppStyles(classCandidates(
        readRepoFile('src/lib/UI/Home/HomeShell.svelte'),
        readRepoFile('src/lib/UI/MainMenu.svelte'),
        readRepoFile('src/lib/UI/Home/HomeTopBar.svelte'),
        readRepoFile('src/lib/UI/Home/HomeGreeting.svelte'),
        readRepoFile('src/lib/UI/CommunityList.svelte'),
        'bg-bgcolor/90 text-textcolor text-textcolor2',
    ))
    homeTokens = { name: 'home-tokens', css: readRepoFile('src/styles/home-tokens.css') }
    baseSheets = [tailwind, homeTokens]
}, 120000)

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    startHomeView()
    resetDb()
})

afterEach(async () => {
    for (const instance of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    for (const target of targets.splice(0)) {
        target.remove()
    }
    document.documentElement.removeAttribute('style')
})

afterAll(() => {
    resetBackHandlersForTests()
})

describe('Home text contrast over custom backdrop (#591)', () => {
    const schemes = ['light', 'dark', 'default'] as const
    const backdrops = [
        ['dark', '#000000'],
        ['light', '#ffffff'],
    ] as const

    test.each(
        schemes.flatMap((scheme) => backdrops.map(([backdropName, backdropHex]) => [scheme, backdropName, backdropHex] as const)),
    )('%s scheme over %s backdrop (%s): Home text meets WCAG AA', async (scheme, _backdropName, backdropHex) => {
        resetDb({ customBackground: 'assets/backdrop.png' })
        applyScheme(scheme)
        const root = await mountHome()
        const rules: RuleSet = compileRules([...baseSheets, greetingCssFor(root)])
        const model = new CascadeModel(rules)

        const checks: Array<[string, HTMLElement | null, number]> = [
            ['greeting h1', root.querySelector('[data-part="home-greeting"] h1'), 3.0],
            ['greeting eyebrow', root.querySelector('[data-part="home-eyebrow"]'), 4.5],
            ['topbar brand', root.querySelector('[data-part="home-brand"]'), 4.5],
            ['library heading', root.querySelector('[data-jump-target="library"]'), 4.5],
            ['character name', root.querySelector('[data-testid="char-name"]'), 4.5],
            ['character meta', root.querySelector('[data-testid="char-meta"]'), 4.5],
            ['community title', root.querySelector('[data-part="home-community-title"]'), 4.5],
        ]

        for (const [label, el, floor] of checks) {
            expect(el, `${label} present`).not.toBeNull()
            const bg = effectiveBg(model, el!, backdropHex)
            const fg = effectiveFg(model, el!, bg)
            const ratio = cr(fg, bg)
            expect(ratio, `${scheme} / ${backdropHex} / ${label} (${toHex(fg)} on ${toHex(bg)})`).toBeGreaterThanOrEqual(floor)
        }
    })

    test('no-backdrop guard: without a backdrop, home-landing carries no data-backdrop and no painted background', async () => {
        resetDb({ customBackground: '', theme: '' })
        applyScheme('light')
        const root = await mountHome()
        const landing = root.querySelector<HTMLElement>('[data-part="home-landing"]')!
        expect(landing.hasAttribute('data-backdrop')).toBe(false)
        const rules = compileRules([...baseSheets, greetingCssFor(root)])
        const model = new CascadeModel(rules)
        const bg = model.painted(landing)['background-color']
        expect(bg === undefined || bg === 'transparent' || rgbOf(bg)[3] === 0).toBe(true)
    })

    test('picker-sentinel guard: customBackground "-" does not trigger the backdrop scrim', async () => {
        resetDb({ customBackground: '-' })
        applyScheme('light')
        const root = await mountHome()
        const landing = root.querySelector<HTMLElement>('[data-part="home-landing"]')!
        expect(landing.hasAttribute('data-backdrop')).toBe(false)
        const rules = compileRules([...baseSheets, greetingCssFor(root)])
        const model = new CascadeModel(rules)
        const bg = model.painted(landing)['background-color']
        expect(bg === undefined || bg === 'transparent' || rgbOf(bg)[3] === 0).toBe(true)
    })

    test('theme-pack guard: a pack setting --home-ink keeps its colour over the scrim', async () => {
        resetDb({ customBackground: 'assets/backdrop.png' })
        applyScheme('light')
        const root = await mountHome()
        const packSheet: ModelSheet = { name: 'pack', css: ':root { --home-ink: #123456; }' }
        const rules = compileRules([...baseSheets, greetingCssFor(root), packSheet])
        const model = new CascadeModel(rules)
        const h1 = root.querySelector<HTMLElement>('[data-part="home-greeting"] h1')!
        const bg = effectiveBg(model, h1, '#000000')
        const fg = effectiveFg(model, h1, bg)
        expect(toHex(fg)).toBe('#123456')
        expect(cr(fg, bg)).toBeGreaterThanOrEqual(4.5)
    })
})
