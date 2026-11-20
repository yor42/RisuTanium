// @vitest-environment jsdom

/**
 * The CBS `{{button}}` card (`.x-risu-button-default`) hovers to the scheme's `borderc` fill, and its
 * hovered text is the derived on-borderc role: the scheme text colour where that reaches 4.5:1 on the
 * fill, otherwise black or white. The fixtures are the real producers: the Tailwind output of
 * `src/styles.css` compiled for the class, the real `updateColorScheme` over every preset, and the
 * cascade model with the pointer hovering and the hover media query holding or not.
 *
 * H1 and H2 are regression reproducers (the hovered text was the scheme text colour whatever the
 * fill). H3 is a compatibility guard that passes before and after: at rest and on a touch device the
 * card keeps `textcolor` on `darkbutton`.
 *
 * MOCKED: alert, database, globalApi, util, stores, the system bars and the app store.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { cr, parseConcrete } from 'src/ts/themePack/colour'
import {
    CascadeModel, compileAppStyles, compileRules, normaliseColours,
    type ModelSheet, type RuleSet,
} from 'src/styles/tests/cascadeModel'

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
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

import { colorSchemeList, colorSchemePresets, updateColorScheme } from 'src/ts/gui/colorscheme'

let tailwind: ModelSheet
let rules: RuleSet
let card: HTMLElement

beforeAll(async () => {
    tailwind = await compileAppStyles(['x-risu-button-default'])
    rules = compileRules([tailwind])
    card = document.createElement('div')
    card.className = 'x-risu-button-default'
    document.body.appendChild(card)
}, 120000)

afterAll(() => {
    card.remove()
})

function applyScheme(name: string): void {
    h.db.colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

const hexOf = (value: string | undefined): string => normaliseColours(value ?? '', '#000000ff')
const rgb = (hex8: string) => parseConcrete(hex8.slice(0, 7))!
const paint = (env: { hovered?: Element | null, hoverMedia?: boolean }): Record<string, string> =>
    new CascadeModel(rules, env).painted(card)

describe('H1: the hovered CBS button text reads at 4.5:1 or more on its painted fill', () => {
    test('the compiled sheet is live: the card class and its hover fill exist', () => {
        expect(tailwind.css).toContain('.x-risu-button-default')
        expect(tailwind.css).toContain('hover')
    })

    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const p = paint({ hovered: card, hoverMedia: true })
        const fill = hexOf(p['background-color'])
        expect(fill).toBe(hexOf(colorSchemePresets[name].borderc))
        const text = hexOf(p['color'])
        expect(cr(rgb(text), rgb(fill)), `${name} text ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5)
    })
})

describe('H2: the hovered text is the scheme text colour wherever that already reaches 4.5:1', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        const tx = hexOf(scheme.textcolor)
        if (cr(rgb(tx), rgb(hexOf(scheme.borderc))) < 4.5) return
        expect(hexOf(paint({ hovered: card, hoverMedia: true })['color'])).toBe(tx)
    })
})

describe('H3: at rest and on touch the card keeps its text and fill (compatibility guard)', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        for (const env of [{}, { hoverMedia: true }, { hovered: card, hoverMedia: false }]) {
            const p = paint(env)
            expect(hexOf(p['color']), `${name} ${JSON.stringify(env)}`).toBe(hexOf(scheme.textcolor))
            expect(hexOf(p['background-color'])).toBe(hexOf(scheme.darkbutton))
        }
    })
})
