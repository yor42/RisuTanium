// @vitest-environment jsdom

/**
 * Contrast of classic surfaces on every built-in colour scheme, through the real producers: the real
 * `updateColorScheme`, the real Button and MultiLangDisplay mounted from source, and the Tailwind output
 * of `src/styles.css` compiled for them, all resolved per element by the cascade model. Every painted
 * Tailwind `oklch(...)` value is converted to sRGB by the shared `oklchToRgba`.
 *
 * LC-4 to LC-6 (#355, the text on the danger Button) and LC-7 and LC-8 (#374, the prose list markers) are
 * regression reproducers: the danger text was the scheme text colour on a fixed red fill, and the markers
 * were the typography plugin's grey. LC-6 and LC-8 are new-rule guards. LC-7's matched-rule control is a
 * compatibility guard: the same DOM against the sheet without the marker rule paints the plugin's greys,
 * so the pass cannot be the inheritance fallback of an unmatched selector.
 *
 * LC-9 and LC-9h (#364, the task toast text and the dismiss glyph) are regression reproducers; LC-10 and LC-10h
 * (Open) are compatibility guards. The toast is the real ToastHost under the real judged and gated built-in packs and
 * without one. LC-9h and LC-10h assert the classic textcolor-on-selected identity, not a contrast: that pair stays
 * below 3:1 on cherry (2.99) and Open's below 4.5 on cherry, galaxy and nature, the accepted MC-2604 limitation.
 *
 * MOCKED: alert, database, globalApi, util, stores, the system bars, the app store and `ParseMarkdown`
 * (a tight markdown-it list). Hover is the cascade model's `{ hovered, hoverMedia }` environment.
 */
import postcss from 'postcss'
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { cr, parseConcrete, toHex, type Rgba } from 'src/ts/themePack/colour'
import {
    CascadeModel, appSheetsInOrder, classCandidates, compileAppStyles, compileRules, compositeHex, readRepoFile, withPackElement,
    type ModelSheet, type ModelEnv, type RuleSet,
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
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    readImage: vi.fn(),
    fetchNative: vi.fn(),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    aiLawApplies: vi.fn(() => false),
    aiWatermarkingLawApplies: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
    parseMultilangString: (value: string) => ({ en: value }),
    toLangName: (code: string) => code,
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selIdState: { selId: 0 },
    selectedCharID: writable(-1),
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({} as Record<number, number>),
    CurrentTriggerIdStore: writable(null),
    HideIconStore: writable(false),
    createSimpleCharacter: vi.fn(() => null),
    CustomCSSStore: writable(''),
    SafeModeStore: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({ read: async () => ({ bytes: null, version: null }) }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock('src/ts/parser/parser.svelte', () => ({
    ParseMarkdown: async () => '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ol>\n<li>three</li>\n<li>four</li>\n</ol>',
}))

vi.mock('src/ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: () => { } }))
vi.mock('src/ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { colorSchemeList, colorSchemePresets, updateColorScheme, updateTextThemeAndCSS } from 'src/ts/gui/colorscheme'
import { BUILTIN_PACKS } from 'src/ts/themePack/builtins'
import { buildAppliedText, commitPackSheet, resetPackSheetForTests } from 'src/ts/themePack/apply'
import { judgeAreaSheet } from 'src/ts/themePack/index'
import { declareSurface, installThemePackGate, resetThemePackGateForTests } from 'src/ts/themePack/surfaceGate.svelte'
import type { TaskToastInit } from 'src/ts/toast/toastHost.svelte'
import Button from 'src/lib/UI/GUI/Button.svelte'
import MultiLangDisplay from 'src/lib/UI/GUI/MultiLangDisplay.svelte'
import { host, installToastHarness, part, show } from 'src/lib/Nexus/pattern/ToastHost.scenarios.test-helpers.svelte'

//#region shared fixtures

let tailwind: ModelSheet
let rules: RuleSet
const instances: unknown[] = []

function mountInto(component: never, props: Record<string, unknown>): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    instances.push(mount(component, { target, props }))
    flushSync()
    return target
}

function applyScheme(name: string): void {
    h.db.colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    flushSync()
}

/** A painted colour as sRGB: `#rrggbbaa` text, a concrete colour or a Tailwind `oklch(...)` token. */
function rgbOf(value: string | undefined): Rgba {
    if (value === undefined) throw new Error('no painted colour')
    const c = value.startsWith('#') ? parseConcrete(value.slice(0, 7)) : (parseConcrete(value) ?? oklchToRgba(value))
    if (c === null) throw new Error(`unreadable colour ${value}`)
    return c
}

const hexOf = (value: string | undefined): string => toHex(rgbOf(value))
const modelOf = (set: RuleSet, env: ModelEnv = {}): CascadeModel => new CascadeModel(set, env)

beforeAll(async () => {
    // `class:prose-invert={...}` is a directive, so the plain class name is named explicitly.
    tailwind = await compileAppStyles(classCandidates(
        readRepoFile('src/lib/UI/GUI/Button.svelte'),
        readRepoFile('src/lib/UI/GUI/MultiLangDisplay.svelte'),
        'prose-invert',
    ))
    rules = compileRules([tailwind])
    h.db.language = 'en'
}, 120000)

afterAll(async () => {
    for (const instance of instances.splice(0)) await unmount(instance as never).catch(() => {})
})

//#endregion

//#region #353 and #354: the Standard italic and the Custom quote fallback

describe('text theme colours on the light schemes', () => {
    const lightSchemes = colorSchemeList.filter((name) => colorSchemePresets[name].type === 'light')
    const darkSchemes = colorSchemeList.filter((name) => colorSchemePresets[name].type === 'dark')
    const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name).toLowerCase()

    function paintTheme(scheme: string, textTheme: 'standard' | 'custom', quotes: [string | null, string | null] = [null, null]): void {
        h.db.textTheme = textTheme
        h.db.font = 'default'
        h.db.customTextTheme = {
            FontColorStandard: '#111111',
            FontColorItalic: '#222222',
            FontColorBold: '#333333',
            FontColorItalicBold: '#444444',
            FontColorQuote1: quotes[0],
            FontColorQuote2: quotes[1],
        }
        applyScheme(scheme)
        updateTextThemeAndCSS()
    }

    test('the scheme lists are not empty', () => {
        expect(lightSchemes.length).toBeGreaterThan(0)
        expect(darkSchemes.length).toBeGreaterThan(0)
    })

    test.each(lightSchemes)('LC-1 %s: the Standard italic and italic-bold read 4.5:1 on bgcolor and darkbg', (name) => {
        paintTheme(name, 'standard')
        const scheme = colorSchemePresets[name]
        for (const key of ['--FontColorStandard', '--FontColorItalic', '--FontColorBold', '--FontColorItalicBold', '--FontColorQuote1', '--FontColorQuote2']) {
            const ink = rgbOf(rootVar(key))
            expect(cr(ink, rgbOf(scheme.bgcolor)), `${key} on bgcolor`).toBeGreaterThanOrEqual(4.5)
            expect(cr(ink, rgbOf(scheme.darkbg)), `${key} on darkbg`).toBeGreaterThanOrEqual(4.5)
        }
    })

    test.each(lightSchemes)('LC-3a %s: null Custom quotes follow the scheme and read 4.5:1', (name) => {
        paintTheme(name, 'custom')
        const scheme = colorSchemePresets[name]
        for (const key of ['--FontColorQuote1', '--FontColorQuote2']) {
            const ink = rgbOf(rootVar(key))
            expect(cr(ink, rgbOf(scheme.bgcolor)), `${key} on bgcolor`).toBeGreaterThanOrEqual(4.5)
            expect(cr(ink, rgbOf(scheme.darkbg)), `${key} on darkbg`).toBeGreaterThanOrEqual(4.5)
        }
    })

    test.each(darkSchemes)('LC-3b (passes before and after) %s: null Custom quotes on a dark scheme keep the dark quotes', (name) => {
        paintTheme(name, 'custom')
        expect(rootVar('--FontColorQuote1')).toBe('#8be9fd')
        expect(rootVar('--FontColorQuote2')).toBe('#ffb86c')
    })

    test.each(lightSchemes)('LC-3b (passes before and after) %s: a set Custom quote is painted verbatim', (name) => {
        paintTheme(name, 'custom', ['#102030', '#405060'])
        expect(rootVar('--FontColorQuote1')).toBe('#102030')
        expect(rootVar('--FontColorQuote2')).toBe('#405060')
    })
})

//#endregion

//#region #355: the danger Button

describe('the danger Button', () => {
    const fillOf = { rest: '#c10007', selected: '#9f0712', hover: '#e7000b' } as const
    let rest: HTMLElement
    let selected: HTMLElement

    beforeAll(() => {
        rest = mountInto(Button as never, { styled: 'danger', selected: false }).querySelector('button')!
        selected = mountInto(Button as never, { styled: 'danger', selected: true }).querySelector('button')!
    })

    test('the compiled sheet is live: the on-danger rule exists and the fills are the pinned red-700, red-800 and red-600', () => {
        expect(tailwind.css).toContain('.risu-on-danger')
        applyScheme('light')
        const m = modelOf(rules)
        expect(hexOf(m.painted(rest)['background-color'])).toBe(fillOf.rest)
        expect(hexOf(m.painted(selected)['background-color'])).toBe(fillOf.selected)
        expect(hexOf(modelOf(rules, { hovered: rest, hoverMedia: true }).painted(rest)['background-color'])).toBe(fillOf.hover)
    })

    // LC-4
    test.each(colorSchemeList)('LC-4 %s: the text reads at 4.5:1 on the rest and the selected fill', (name) => {
        applyScheme(name)
        const m = modelOf(rules)
        for (const [label, el] of [['rest', rest], ['selected', selected]] as const) {
            const p = m.painted(el)
            const ratio = cr(rgbOf(p.color), rgbOf(p['background-color']))
            expect(ratio, `${name} ${label} ${p.color} on ${p['background-color']}`).toBeGreaterThanOrEqual(4.5)
        }
    })

    // LC-5
    test.each(colorSchemeList)('LC-5 %s: the hovered text reads at 4.5:1 on the red-600 fill, and a touch device keeps the rest fill', (name) => {
        applyScheme(name)
        const hovered = modelOf(rules, { hovered: rest, hoverMedia: true }).painted(rest)
        expect(hexOf(hovered['background-color'])).toBe(fillOf.hover)
        expect(cr(rgbOf(hovered.color), rgbOf(hovered['background-color'])), `${name} hover`).toBeGreaterThanOrEqual(4.5)
        const touch = modelOf(rules, { hovered: rest, hoverMedia: false }).painted(rest)
        expect(hexOf(touch['background-color'])).toBe(fillOf.rest)
    })

    // LC-6
    test.each(colorSchemeList)('LC-6 %s: the painted text is the on-danger role, the scheme text colour where that already passes', (name) => {
        applyScheme(name)
        const role = document.documentElement.style.getPropertyValue('--risu-theme-role-on-danger')
        expect(role).not.toBe('')
        const p = modelOf(rules).painted(rest)
        expect(hexOf(p.color)).toBe(hexOf(role))
        const tx = rgbOf(colorSchemePresets[name].textcolor)
        if (Object.values(fillOf).every((f) => cr(tx, rgbOf(f)) >= 4.5)) expect(hexOf(p.color)).toBe(toHex(tx))
    })
})

//#endregion

//#region #374: prose list markers

describe('prose list markers', () => {
    let display: HTMLElement
    let control: RuleSet

    let removed = 0

    const withoutMarkerRule = (css: string): string => {
        const root = postcss.parse(css)
        root.walkRules((rule) => {
            if (rule.parent?.type === 'root' && rule.selector === '.prose' && rule.nodes.some((n) => n.type === 'decl' && n.prop === '--tw-prose-bullets' && n.value === 'currentColor')) {
                rule.remove()
                removed++
            }
        })
        return root.toString()
    }

    beforeAll(async () => {
        control = compileRules([{ name: 'tailwind', css: withoutMarkerRule(tailwind.css) }])
        display = mountInto(MultiLangDisplay as never, { value: 'list', markdown: true })
        await tick()
        flushSync()
    })

    const items = (): { ul: HTMLElement, ol: HTMLElement } => ({
        ul: display.querySelector<HTMLElement>('ul > li')!,
        ol: display.querySelector<HTMLElement>('ol > li')!,
    })

    test('the unlayered marker rule is in the compiled sheet, and the control sheet is the same sheet without it', () => {
        expect(removed).toBe(1)
    })

    test('the list items are rendered under .prose', () => {
        const { ul, ol } = items()
        expect(ul).not.toBeNull()
        expect(ol).not.toBeNull()
        expect(ul.closest('.prose')).not.toBeNull()
    })

    // LC-7
    test.each(colorSchemeList)('LC-7 %s: the markers read at 3:1 on the page and panel colours', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        const m = modelOf(rules)
        const { ul, ol } = items()
        for (const [label, li] of [['ul', ul], ['ol', ol]] as const) {
            const marker = rgbOf(m.painted(li, '::marker').color)
            expect(cr(marker, rgbOf(scheme.bgcolor)), `${name} ${label} on bgcolor`).toBeGreaterThanOrEqual(3)
            expect(cr(marker, rgbOf(scheme.darkbg)), `${name} ${label} on darkbg`).toBeGreaterThanOrEqual(3)
        }
    })

    test.each(colorSchemeList)('LC-7 control %s: without the rule the same DOM paints the plugin greys (the marker selector matched)', (name) => {
        applyScheme(name)
        const dark = colorSchemePresets[name].type === 'dark'
        expect(display.querySelector('.prose')!.classList.contains('prose-invert'), `${name} prose-invert`).toBe(dark)
        const m = modelOf(control)
        const { ul, ol } = items()
        expect(hexOf(m.painted(ul, '::marker').color)).toBe(dark ? '#4a5565' : '#d1d5dc')
        expect(hexOf(m.painted(ol, '::marker').color)).toBe(dark ? '#99a1af' : '#6a7282')
        expect(m.unmodelled.filter((u) => u.includes('marker'))).toEqual([])
    })

    // LC-8
    test.each(colorSchemeList)('LC-8 %s: the marker is the colour of its list item', (name) => {
        applyScheme(name)
        const m = modelOf(rules)
        const { ul, ol } = items()
        for (const li of [ul, ol]) {
            expect(hexOf(m.painted(li, '::marker').color)).toBe(hexOf(m.painted(li).color))
        }
    })
})

//#endregion

//#region #364: the task toast text

describe('the task toast text', () => {
    // The real ToastHost on the harness's fake clock; the pack is the real judged, applied and gated sheet.
    installToastHarness()

    const VARIANTS = ['none', ...BUILTIN_PACKS.map((p) => p.id)]
    let toastSheets: ModelSheet[]

    beforeAll(async () => {
        const candidates = classCandidates(readRepoFile('src/lib/Nexus/pattern/ToastHost.svelte'))
        toastSheets = [
            ...await appSheetsInOrder(candidates),
            { name: 'task-toast', css: readRepoFile('src/lib/Nexus/pattern/pattern-task-toast.css') },
        ]
    }, 120000)

    function taskInit(): TaskToastInit {
        return {
            title: 'Import', line: 'File 1 of 2: a.png', mark: 'transfer_in', fraction: 0.25, determinate: true, badge: false,
            phase: 'done', openLabel: 'Open', onOpen: () => { }, onEnd: () => { },
        }
    }

    interface TaskParts { toast: HTMLElement, title: HTMLElement, line: HTMLElement, open: HTMLElement, dismiss: HTMLElement }

    /** A finished task shows Open and Dismiss, so every pair is measured on one toast. */
    function mountTask(): TaskParts {
        show()
        host.postTask(taskInit())
        flushSync()
        const toast = document.querySelector<HTMLElement>('[data-part="task-toast"]')!
        return {
            toast,
            title: part(toast, 'task-toast-title'),
            line: part(toast, 'task-toast-line'),
            open: part(toast, 'task-toast-open'),
            dismiss: part(toast, 'task-toast-dismiss'),
        }
    }

    /** The painted colour of an element, composited over the opaque surface when it carries alpha. */
    function inkOn(m: CascadeModel, el: HTMLElement, surface: Rgba): Rgba {
        return rgbOf(compositeHex(m.painted(el).color, toHex(surface)))
    }

    /** The opaque painted background; an alpha fill would make every ratio below meaningless. */
    function fillOf(m: CascadeModel, el: HTMLElement): Rgba {
        const bg = m.painted(el)['background-color']
        expect(bg, 'the element paints a background').toMatch(/^#[0-9a-f]{6}ff$/)
        return rgbOf(bg)
    }

    describe.each(VARIANTS)('with %s', (variant) => {
        let rules: RuleSet

        beforeAll(() => {
            const custom = document.createElement('style')
            custom.id = 'customcss'
            document.body.appendChild(custom)
            installThemePackGate(() => false)
            declareSurface('chat')
            if (variant !== 'none') {
                const builtin = BUILTIN_PACKS.find((p) => p.id === variant)!
                const judged = judgeAreaSheet('chat', builtin.chatCss, undefined, 'chat')
                expect(judged.result.ok).toBe(true)
                expect(commitPackSheet({ text: buildAppliedText(judged, () => ''), blobs: [] })).toEqual({ ok: true })
            }
            rules = compileRules(withPackElement(toastSheets, document.querySelector<HTMLStyleElement>('style[data-theme-pack]')))
        })

        afterAll(() => {
            resetPackSheetForTests()
            resetThemePackGateForTests()
            document.getElementById('customcss')?.remove()
            document.documentElement.removeAttribute('style')
        })

        const base = (name: string): { textcolor: Rgba, textcolor2: Rgba, selected: Rgba } => ({
            textcolor: rgbOf(colorSchemePresets[name].textcolor),
            textcolor2: rgbOf(colorSchemePresets[name].textcolor2),
            selected: rgbOf(colorSchemePresets[name].selected),
        })

        // LC-9
        if (variant !== 'none') {
            test.each(colorSchemeList)('LC-9 %s: the title and the line read at 4.5:1 and the dismiss glyph at 3:1 on the toast', (name) => {
                applyScheme(name)
                const t = mountTask()
                const m = modelOf(rules)
                const surface = fillOf(m, t.toast)
                expect(cr(inkOn(m, t.title, surface), surface), `${name} title`).toBeGreaterThanOrEqual(4.5)
                expect(cr(inkOn(m, t.line, surface), surface), `${name} line`).toBeGreaterThanOrEqual(4.5)
                expect(cr(inkOn(m, t.dismiss, surface), surface), `${name} dismiss glyph`).toBeGreaterThanOrEqual(3)
            })
        }

        // LC-9h: contrast here is the classic pair by construction (cherry's 2.99 is the MC-2604 limitation), so the
        // identity is what the rule must keep.
        test.each(colorSchemeList)('LC-9h %s: the hovered dismiss is the classic textcolor on selected pair', (name) => {
            applyScheme(name)
            const t = mountTask()
            const hovered = modelOf(rules, { hovered: t.dismiss, hoverMedia: true })
            const classic = base(name)
            expect(toHex(inkOn(hovered, t.dismiss, classic.selected)), `${name} glyph`).toBe(toHex(classic.textcolor))
            expect(toHex(fillOf(hovered, t.dismiss)), `${name} fill`).toBe(toHex(classic.selected))
        })

        // LC-10
        test.each(colorSchemeList)('LC-10 %s: Open reads at 4.5:1 on its fill', (name) => {
            applyScheme(name)
            const t = mountTask()
            const m = modelOf(rules)
            const fill = fillOf(m, t.open)
            expect(cr(inkOn(m, t.open, fill), fill), `${name} open`).toBeGreaterThanOrEqual(4.5)
        })

        if (variant === 'none') {
            test.each(colorSchemeList)('LC-10 %s: without a pack the title is the scheme text and the line is no weaker than the base textcolor2', (name) => {
                applyScheme(name)
                const t = mountTask()
                const m = modelOf(rules)
                const surface = fillOf(m, t.toast)
                const classic = base(name)
                expect(toHex(inkOn(m, t.title, surface)), `${name} title`).toBe(toHex(classic.textcolor))
                expect(cr(inkOn(m, t.line, surface), surface), `${name} line`).toBeGreaterThanOrEqual(cr(classic.textcolor2, surface))
            })
        }

        // LC-10h: the contrast of this pair is the MC-2604 limitation (cherry 2.99, galaxy 4.31, nature 3.46); the identity is the rule.
        test.each(colorSchemeList)('LC-10h %s: the hovered Open is the classic textcolor on selected pair', (name) => {
            applyScheme(name)
            const t = mountTask()
            const hovered = modelOf(rules, { hovered: t.open, hoverMedia: true })
            const classic = base(name)
            expect(toHex(inkOn(hovered, t.open, classic.selected)), `${name} text`).toBe(toHex(classic.textcolor))
            expect(toHex(fillOf(hovered, t.open)), `${name} fill`).toBe(toHex(classic.selected))
        })
    })
})

//#endregion
