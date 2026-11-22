// @vitest-environment jsdom
/**
 * TA-12: the boot banner reads no theme token, Tailwind utility or scope attribute. (a) Static: the component has no `class`
 * attribute, no style block, no `var(` and no `data-own-scheme`. (b) The cascade model over the real compiled app CSS
 * (Tailwind output of `src/styles.css`, which carries the token files): the painted colours and the font size, line height and
 * `color-scheme` of every element of the mounted banner are equal under two root schemes and with `data-theme-pack-base` on and
 * off. A probe element outside the banner that uses the theme utilities does follow the root scheme, so the equality is not a
 * model that cannot see a change. The model is not a browser (the PC row reads Chrome).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { CascadeModel, classCandidates, compileAppStyles, compileRules, readRepoFile, type RuleSet } from '../../styles/tests/cascadeModel'

const h = vi.hoisted(() => ({
    /** What `updateColorScheme` reads and paints on the root. */
    rootDb: {} as Record<string, unknown>,
    /** What the banner reads. */
    bannerDb: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.rootDb),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({ downloadFile: vi.fn() }) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: h.bannerDb },
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({ syncSystemBars: vi.fn() }) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/pageStorageMode'), () => ({ getPageStorageMode: vi.fn(() => ({ kind: 'store2' })) }) as unknown as typeof import('src/ts/storage/pageStorageMode'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ isBusy: vi.fn(() => false) }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/drive/restoreInProgress'), () => ({ restoreInProgress: vi.fn(() => false) }) as unknown as typeof import('src/ts/drive/restoreInProgress'))
vi.mock('src/ts/themePack/turnOff', () => ({ turnOffThemePack: vi.fn(), registerPackRequestCanceller: vi.fn() }))

import { defaultColorScheme, PACK_SCHEME_NAME, updateColorScheme, type ColorScheme } from 'src/ts/gui/colorscheme'
import { offerBootEscape, resetPackSafeModeForTests } from 'src/ts/themePack/packSafeMode.svelte'
import BootPackEscape from './BootPackEscape.svelte'

const SOURCE_PATH = 'src/lib/Others/BootPackEscape.svelte'

const USER: ColorScheme = {
    bgcolor: '#101820', darkbg: '#0a1016', borderc: '#445566', selected: '#223344', draculared: '#ff5555',
    textcolor: '#e0e8f0', textcolor2: '#a0a8b0', darkBorderc: '#334455', darkbutton: '#203040', type: 'dark',
}
/** A light pack copy whose text equals its background, the case the banner must stay readable in. */
const PACK_LIGHT: ColorScheme = { ...USER, bgcolor: '#ffffff', textcolor: '#ffffff', darkbutton: '#ffffff', borderc: '#ffffff', type: 'light' }

describe('TA-12(a): the component source', () => {
    const source = readRepoFile(SOURCE_PATH)
    test('no class attribute, no style block, no var(, no data-own-scheme', () => {
        expect(source).not.toMatch(/\sclass\s*[=:]/)
        expect(source).not.toMatch(/<style[\s>]/)
        expect(source).not.toContain('var(')
        expect(source).not.toContain('data-own-scheme')
    })

    test('no data- attribute except the root data-part and data-part-critical', () => {
        const attributes = [...source.matchAll(/\bdata-[\w-]+/g)].map((m) => m[0])
        expect(attributes.sort()).toEqual(['data-part', 'data-part-critical'])
    })

    test('App renders it once, outside every inert scope, so it stays live over the boot screen and boot alerts', () => {
        const app = readRepoFile('src/App.svelte')
        expect(app.match(/<BootPackEscape\s*\/>/g)).toHaveLength(1)
        const inside = [...app.matchAll(/<AlertInertScope>([\s\S]*?)<\/AlertInertScope>/g)].map((m) => m[1])
        expect(inside).toHaveLength(2)
        expect(inside.some((block) => block.includes('BootPackEscape'))).toBe(false)
    })
})

let rules: RuleSet
let mounted: { target: HTMLElement, app: Record<string, unknown> } | undefined

beforeAll(async () => {
    // The wrapper classes of App's `<main>` and the probe's utilities are candidates too, as they are in the real build.
    const tailwind = await compileAppStyles(classCandidates(readRepoFile(SOURCE_PATH), 'flex bg-bg w-full h-full text-textcolor bg-darkbg'))
    rules = compileRules([tailwind])
}, 120000)

beforeEach(() => {
    vi.useFakeTimers()
    resetPackSafeModeForTests()
})

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
    }
    mounted = undefined
    resetPackSafeModeForTests()
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-theme-pack-base')
    document.body.innerHTML = ''
    vi.useRealTimers()
})

function setRootScheme(name: string, scheme?: ColorScheme): void {
    for (const key of Object.keys(h.rootDb)) delete h.rootDb[key]
    h.rootDb.colorSchemeName = name
    h.rootDb.colorScheme = structuredClone(scheme ?? defaultColorScheme)
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

/** The banner of a pack whose stored copy is unreadable; the user's own scheme is in the snapshot. */
function mountBanner(): HTMLElement {
    for (const key of Object.keys(h.bannerDb)) delete h.bannerDb[key]
    Object.assign(h.bannerDb, {
        colorScheme: structuredClone(PACK_LIGHT),
        colorSchemeName: PACK_SCHEME_NAME,
        themePackSchemeSnapshot: { name: 'custom', scheme: structuredClone(USER) },
        customColorScheme: structuredClone(USER),
        activeThemePack: 'builtin:banana-cocoa',
    })
    offerBootEscape(h.bannerDb)
    document.body.innerHTML = '<main id="app" class="flex bg-bg w-full h-full text-textcolor"><div id="probe" class="bg-darkbg text-textcolor"></div></main>'
    const target = document.getElementById('app') as HTMLElement
    mounted = { target, app: mount(BootPackEscape, { target }) as unknown as Record<string, unknown> }
    flushSync()
    return target
}

function textBearing(root: HTMLElement): HTMLElement[] {
    return [root, ...root.querySelectorAll<HTMLElement>('*')]
}

interface Reading {
    painted: Record<string, Record<string, string>>
    props: Record<string, Record<string, string | undefined>>
}

function read(root: HTMLElement): Reading {
    const model = new CascadeModel(rules)
    const painted: Reading['painted'] = {}
    const props: Reading['props'] = {}
    textBearing(root).forEach((el, index) => {
        const key = `${index}:${el.tagName.toLowerCase()}`
        painted[key] = model.painted(el)
        props[key] = {
            'font-size': model.prop(el, 'font-size'),
            'line-height': model.prop(el, 'line-height'),
            'color-scheme': model.prop(el, 'color-scheme'),
        }
    })
    return { painted, props }
}

describe('TA-12(b): the cascade over the real compiled CSS', () => {
    test('liveness: a probe outside the banner follows the root scheme', () => {
        mountBanner()
        setRootScheme('default')
        const dark = new CascadeModel(rules).painted(document.getElementById('probe')!)
        setRootScheme('light')
        const light = new CascadeModel(rules).painted(document.getElementById('probe')!)
        expect(light.color).not.toBe(dark.color)
        expect(light['background-color']).not.toBe(dark['background-color'])
    })

    test('the banner paints the user scheme, opaque, and every reading is equal under two root schemes and the base attribute', () => {
        const target = mountBanner()
        const root = target.querySelector<HTMLElement>('[data-part="boot-pack-escape"]')!
        expect(root).not.toBeNull()

        setRootScheme('default')
        const baseline = read(root)
        // The inline literals are what the model resolved: the user's own colours, not the pack copy and not a token.
        expect(baseline.painted['0:div']['background-color']).toBe('#101820ff')
        expect(baseline.painted['0:div'].color).toBe('#e0e8f0ff')
        expect(baseline.props['0:div']['font-size']).toBe('15px')
        expect(baseline.props['0:div']['line-height']).toBe('20px')
        expect(baseline.props['0:div']['color-scheme']).toBe('dark')

        for (const [name, scheme] of [['light', undefined], ['custom', PACK_LIGHT]] as const) {
            for (const baseAttribute of [false, true]) {
                setRootScheme(name, scheme)
                if (baseAttribute) document.documentElement.setAttribute('data-theme-pack-base', 'light')
                else document.documentElement.removeAttribute('data-theme-pack-base')
                expect(read(root), `${name}, base attribute ${baseAttribute}`).toEqual(baseline)
            }
        }
    })
})
