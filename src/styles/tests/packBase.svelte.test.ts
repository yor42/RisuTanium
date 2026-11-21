// @vitest-environment jsdom

/**
 * A theme pack sits on the fixed base it was judged against (MC-2500): while the real gate has a pack sheet on, every
 * token the pack does not set resolves to the reference base, under every colour scheme; without a pack the scheme
 * mapping applies. The fixtures are the real producers: the built-in packs through the judge, `buildAppliedText` and
 * `commitPackSheet`, the real gate, the real `updateColorScheme`, and the real token files and Tailwind compile resolved
 * per element by the cascade model.
 *
 * TP1, TP2 and TP3b are regression reproducers: against the stage before the gate set the root attribute they fail
 * on assertions. Before the scheme mapping existed they passed, because every token was static. TP3, TP4, TP6 and TP7
 * are compatibility guards.
 */
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import postcss, { type Rule } from 'postcss'
import { compile as compileSvelte } from 'svelte/compiler'
import { get } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { parseConcrete } from '../../ts/themePack/colour'
import {
    CascadeModel, REPO_ROOT, appSheetsInOrder, compileAppStyles, compileRules, normaliseColours, readRepoFile, withPackElement,
    type ModelSheet, type RuleSet,
} from './cascadeModel'

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
    getFileSrc: vi.fn(),
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

import { updateColorScheme } from '../../ts/gui/colorscheme'
import { packBaseTone } from '../../ts/gui/surfaceTone'
import { BUILTIN_PACKS, type BuiltinPack } from '../../ts/themePack/builtins'
import { buildAppliedText, commitPackSheet, preparePackSheet, resetPackSheetForTests } from '../../ts/themePack/apply'
import { chatCommitInput, chatElementOf } from '../../ts/themePack/fixtures/packCommit'
import { TOKEN_FILES, tokenFile } from '../../ts/themePack/tokens'
import { judgeAreaSheet, judgePackSheets } from '../../ts/themePack/index'
import { judgeSessionOverForTests } from '../../ts/themePack/judgeClient'
import { declareSurface, installThemePackGate, resetThemePackGateForTests, syncThemePackMedia } from '../../ts/themePack/surfaceGate.svelte'

// ---- the sources the base is compared against

const SRC_TOKEN_FILES = ['src/styles/nexus-tokens.css', 'src/styles/pattern-tokens.css', 'src/styles/chat-tokens.css'] as const
const BASE_SELECTOR = ':root:where([data-theme-pack-base])'
const ATTRIBUTE = 'data-theme-pack-base'

// The restored names, pinned from the pre-scheme declarations: 25 / 2 / 2.
const PINNED_NEXUS = [
    '--nexus-canvas', '--nexus-canvas-bloom', '--nexus-canvas-warm', '--nexus-surface', '--nexus-surface-raised', '--nexus-surface-flat',
    '--nexus-edge', '--nexus-edge-strong', '--nexus-field-border', '--nexus-text', '--nexus-text-secondary', '--nexus-text-muted',
    '--nexus-accent', '--nexus-ring', '--nexus-core-from', '--nexus-core-to', '--nexus-accent-rgb', '--nexus-danger', '--nexus-danger-rgb',
    '--nexus-overlay-rgb', '--nexus-warning-rgb', '--alpha-switch-off', '--color-placeholder', '--color-surface-sheet', '--color-surface-toast',
]
const PINNED_PATTERN = ['--pattern-on-accent', '--pattern-on-danger']
const PINNED_CHAT = ['--color-scheme', '--color-surface-bar']
// The app shape tokens the Tailwind radius and hairline scale reads (MC-3128): never restored by the base, but both token files must declare each, so the compared set cannot silently shrink.
const PINNED_SHAPE = ['--ui-radius-xs', '--ui-radius-sm', '--ui-radius-md', '--ui-radius-lg', '--ui-radius-xl', '--ui-radius-2xl', '--ui-radius-3xl', '--ui-radius-4xl', '--ui-radius', '--ui-border-width']
// The app's own black under the pack canvas; it has no reference counterpart and no pack may declare it.
const PACK_BACKDROP = '--surface-pack-backdrop'

// Chat motion tokens the app deliberately keeps different from the reference (the app's own reduced-motion factor).
const ALLOWED_DIVERGENCE = new Set(['--chat-motion', '--chat-dur-fast', '--chat-dur-base', '--chat-dur-slow'])

const SCHEMES = ['light', 'default', 'nexus', 'twilight', 'cherry'] as const

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The one colour predicate: the resolved value parses as a colour, is an `r g b` channel triplet, is the `--color-scheme`
 * keyword, or composes a colour (a gradient or shadow that names one).
 */
function isColour(name: string, value: string): boolean {
    return name === '--color-scheme'
        || parseConcrete(value) !== null
        || /^\d{1,3} \d{1,3} \d{1,3}$/.test(value.trim())
        || /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(/i.test(value)
}

/** The custom properties declared directly in top-level rules with one of `selectors`; later declarations win. */
function declaredIn(css: string, selectors: string[]): Map<string, string> {
    const out = new Map<string, string>()
    for (const node of postcss.parse(css).nodes) {
        if (node.type !== 'rule') continue
        const rule = node as Rule
        if (!selectors.includes(rule.selector.trim())) continue
        rule.walkDecls((d) => { if (d.prop.startsWith('--')) out.set(d.prop, collapse(d.value)) })
    }
    return out
}

function plainRoot(css: string): Map<string, string> {
    return declaredIn(css, [':root'])
}

/** The reference text per name: chat over nexus as the validator reads them, and the pattern reference. */
function referenceTexts(): Map<string, string> {
    const merged = new Map<string, string>()
    for (const css of [TOKEN_FILES['theme/nexus-tokens.css'], readRepoFile('docs/design/theme/pattern-tokens.css'), TOKEN_FILES['chat/theme-tokens.css']]) {
        for (const [name, text] of plainRoot(css)) merged.set(name, text)
    }
    return merged
}

function srcTokenNames(): string[] {
    const names = new Set<string>()
    for (const file of SRC_TOKEN_FILES) for (const name of plainRoot(readRepoFile(file)).keys()) names.add(name)
    return [...names].sort()
}

// ---- the compiled app, the document and the gate

let appSheets: ModelSheet[]
let surfaceCandidates: string[]

interface TailwindOxide {
    Scanner: new (opts: { sources: { base: string, pattern: string, negated: boolean }[] }) => { scan(): string[] }
}

async function scanCandidates(files: string[]): Promise<string[]> {
    const viteRequire = createRequire(path.join(REPO_ROOT, 'node_modules/@tailwindcss/vite/package.json'))
    const oxide = await import(/* @vite-ignore */pathToFileURL(viteRequire.resolve('@tailwindcss/oxide')).href) as TailwindOxide
    return new oxide.Scanner({ sources: files.map((f) => ({ base: REPO_ROOT, pattern: f, negated: false })) }).scan()
}

const SURFACE_DIRS = ['src/lib/ChatShell', 'src/lib/Nexus/pattern', 'src/lib/Nexus/brand']

function listFiles(dir: string, ext: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) out.push(...listFiles(rel, ext))
        else if (entry.name.endsWith(ext) && !/\.test\./.test(entry.name)) out.push(rel)
    }
    return out
}

const inSurface = (file: string): boolean => SURFACE_DIRS.some((d) => file.startsWith(`${d}/`))

/** Every component a surface file imports from outside the surface directories (static, type-only and dynamic imports). */
function embeddedComponents(surfaceSvelte: string[]): string[] {
    const found = new Set<string>()
    for (const file of surfaceSvelte) {
        for (const m of readRepoFile(file).matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+\.svelte)['"]/g)) {
            const spec = m[1]
            const abs = spec.startsWith('.') ? path.resolve(REPO_ROOT, path.dirname(file), spec) : path.join(REPO_ROOT, spec)
            const rel = path.relative(REPO_ROOT, abs).split(path.sep).join('/')
            if (inSurface(rel)) continue
            try { readRepoFile(rel) } catch { continue }
            found.add(rel)
        }
    }
    return [...found].sort()
}

// The components a surface file embeds from outside the surface directories; they use the classic names (MC-2517).
const EMBEDDED = [
    'src/lib/ChatScreens/AssetInput.svelte',
    'src/lib/ChatScreens/ChatBody.svelte',
    'src/lib/ChatScreens/CreatorQuote.svelte',
    'src/lib/ChatScreens/NotificationsOffNotice.svelte',
    'src/lib/ChatScreens/PartialEditController.svelte',
    'src/lib/ChatScreens/Suggestion.svelte',
    // Enters through the TaskYieldHarness test harness; in production App renders it over the chat.
    'src/lib/Others/AlertComp.svelte',
    'src/lib/Others/CharListAvatar.svelte',
    'src/lib/Others/PluginDefinedIcon.svelte',
    'src/lib/SideBars/CharConfig.svelte',
    'src/lib/SideBars/DevTool.svelte',
    // Enters through the TaskToastHarness test harness; it paints nothing (display: contents).
    'src/lib/UI/GUI/AlertInertScope.svelte',
]

const surfaceSvelte = SURFACE_DIRS.flatMap((d) => listFiles(d, '.svelte'))
const surfaceSources = [...surfaceSvelte, ...embeddedComponents(surfaceSvelte)]

beforeAll(async () => {
    surfaceCandidates = await scanCandidates(surfaceSources)
    appSheets = await appSheetsInOrder(surfaceCandidates)
}, 120000)

let covered = false

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorSchemeName = 'default'
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    const custom = document.createElement('style')
    custom.id = 'customcss'
    document.body.appendChild(custom)
    covered = false
    installThemePackGate(() => covered)
    declareSurface('chat')
})

afterEach(() => {
    resetPackSheetForTests()
    resetThemePackGateForTests()
    document.documentElement.removeAttribute('style')
    document.head.innerHTML = ''
    document.body.innerHTML = ''
})

function pack(id: string): BuiltinPack {
    const found = BUILTIN_PACKS.find((p) => p.id === id)
    if (!found) throw new Error(`no built-in ${id}`)
    return found
}

/** A built-in through the real path: judge, applied text, commit (which syncs the real gate). */
function applyBuiltin(builtin: BuiltinPack): void {
    const judged = judgeAreaSheet('chat', builtin.chatCss, undefined, 'chat')
    expect(judged.result.ok).toBe(true)
    expect(commitPackSheet(chatCommitInput(buildAppliedText(judged, () => '')))).toEqual({ ok: true })
}

function applySheet(text: string): void {
    expect(commitPackSheet(chatCommitInput(text))).toEqual({ ok: true })
}

const packElement = (): HTMLStyleElement | null => document.querySelector<HTMLStyleElement>('style[data-theme-pack]')
const ROOT = (): HTMLElement => document.documentElement

function resolvedRules(): RuleSet {
    return compileRules(withPackElement(appSheets, packElement()))
}

function under(scheme: string, set: RuleSet): CascadeModel {
    h.db.colorSchemeName = scheme
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    return new CascadeModel(set)
}

const colourText = (value: string | undefined): string => normaliseColours(value ?? '', '#000000ff')

const BUILTIN_IDS = ['builtin:origin-navy', 'builtin:banana-cocoa']

// ---- TP1

describe('TP1: with the base on, the app resolves every token to the judged reference', () => {
    const referenceTextByName = referenceTexts()
    const names = srcTokenNames().filter((n) => referenceTextByName.has(n) && !ALLOWED_DIVERGENCE.has(n))

    test('the compared set holds the restored names and the pinned divergence is not a colour', () => {
        expect(names.length).toBeGreaterThan(150)
        for (const n of [...PINNED_NEXUS, ...PINNED_PATTERN, ...PINNED_CHAT, ...PINNED_SHAPE]) expect(names).toContain(n)
        const resolved = new CascadeModel(compileRules(appSheets))
        for (const n of ALLOWED_DIVERGENCE) {
            const value = resolved.custom(ROOT(), n)
            expect(value, n).toBeDefined()
            expect(isColour(n, value!), n).toBe(false)
        }
    })

    test.each(BUILTIN_IDS)('(i) %s: the winning app declaration of every name equals the reference text', (id) => {
        applyBuiltin(pack(id))
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(true)
        // Every sheet below is unlayered and both selectors are (0,1,0), so the last declaration in load order wins.
        const winner = new Map<string, string>()
        for (const sheet of appSheets) {
            for (const [name, text] of declaredIn(sheet.css, [':root', BASE_SELECTOR])) winner.set(name, text)
        }
        const different = names.filter((n) => winner.get(n) !== referenceTextByName.get(n))
        expect(different.map((n) => `${n}: ${winner.get(n)} != ${referenceTextByName.get(n)}`)).toEqual([])
    })

    test.each(BUILTIN_IDS)('(ii) %s: with the pack merged, every name resolves as the reference does, under every scheme', (id) => {
        applyBuiltin(pack(id))
        const element = packElement()!
        const reference = compileRules([
            { name: 'ref-nexus', css: TOKEN_FILES['theme/nexus-tokens.css'] },
            { name: 'ref-pattern', css: readRepoFile('docs/design/theme/pattern-tokens.css') },
            { name: 'ref-chat', css: TOKEN_FILES['chat/theme-tokens.css'] },
            { name: 'pack', css: element.textContent ?? '' },
        ])
        const set = resolvedRules()
        const different: string[] = []
        for (const scheme of ['light', 'default', 'nexus']) {
            const actual = under(scheme, set)
            const expected = new CascadeModel(reference)
            for (const n of names) {
                const a = actual.custom(ROOT(), n)
                const e = expected.custom(ROOT(), n)
                if (a !== e) different.push(`${scheme} ${n}: ${a} != ${e}`)
            }
        }
        expect(different).toEqual([])
    })

    test('(iii) the base rules declare exactly the pinned names, per file', () => {
        const names3 = (file: string) => [...declaredIn(readRepoFile(file), [BASE_SELECTOR]).keys()]
        expect(names3('src/styles/nexus-tokens.css')).toEqual(PINNED_NEXUS)
        expect(names3('src/styles/pattern-tokens.css')).toEqual(PINNED_PATTERN)
        expect(names3('src/styles/chat-pack-base.css')).toEqual([...PINNED_CHAT, PACK_BACKDROP])
    })
})

// ---- TP2

describe('TP2: under a pack every collected name resolves the same in every colour scheme', () => {
    // The classic names (MC-2517, accepted limitation): the nine @theme colour names and the nine direct reads.
    const CLASSIC = ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkborderc', 'darkbutton']
    const EXCLUDED = new Set([...CLASSIC.map((n) => `--color-${n}`), ...CLASSIC.map((n) => `--risu-theme-${n}`)])

    const varRefs = (css: string): string[] => [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1])

    async function collect(): Promise<Set<string>> {
        const collected = new Set<string>()
        // (1) the names the token files declare in a plain :root
        for (const n of srcTokenNames()) collected.add(n)
        // (2) the var() references of the compiled component CSS and of the raw component stylesheets
        for (const file of surfaceSources) {
            const result = compileSvelte(readRepoFile(file), { filename: file, css: 'external' })
            for (const n of varRefs(result.css?.code ?? '')) collected.add(n)
        }
        for (const dir of SURFACE_DIRS) for (const file of listFiles(dir, '.css')) for (const n of varRefs(readRepoFile(file))) collected.add(n)
        // (3) the var() references of the utility rules the surface sources use, minus the rules the build emits with no candidates
        const base = new Set<string>()
        postcss.parse((await compileAppStyles([])).css).walkRules((r) => { base.add(r.toString()) })
        postcss.parse((await compileAppStyles(surfaceCandidates)).css).walkRules((r) => {
            if (!base.has(r.toString())) for (const n of varRefs(r.toString())) collected.add(n)
        })
        return collected
    }

    test('the exclusion is the nine classic names, each declared as a @theme indirection to its direct name', () => {
        expect(CLASSIC).toHaveLength(9)
        const theme = new Map<string, string>()
        postcss.parse(readRepoFile('src/styles.css')).walkAtRules('theme', (at) => {
            at.walkDecls((d) => { theme.set(d.prop, collapse(d.value)) })
        })
        for (const n of CLASSIC) expect(theme.get(`--color-${n}`)).toBe(`var(--risu-theme-${n})`)
    })

    test('the embedded classic components are exactly the pinned list', () => {
        expect(embeddedComponents(surfaceSvelte)).toEqual(EMBEDDED)
    })

    test('the collection is live and can fail: utilities are collected, no role is read, the schemes differ without a pack', async () => {
        const collected = await collect()
        expect(collected.has('--color-textcolor')).toBe(true)
        expect([...collected].filter((n) => n.startsWith('--risu-theme-role-'))).toEqual([])
        // Non-vacuity 1: the Tailwind build carries the candidates, so a nexus utility name resolves, to the base text with the base on.
        applySheet(':root{--nexus-accent-rgb:255 170 0}')
        const withBase = under('light', resolvedRules())
        expect(colourText(withBase.custom(document.body, '--color-nexus-text'))).toBe(colourText('rgb(255 255 255 / 0.92)'))
        // Non-vacuity 2: without a pack the scheme moves the canvas, so equality under a pack is not vacuous.
        resetPackSheetForTests()
        resetThemePackGateForTests()
        const light = under('light', compileRules(appSheets)).custom(ROOT(), '--nexus-canvas')
        const nexus = under('nexus', compileRules(appSheets)).custom(ROOT(), '--nexus-canvas')
        expect(light).toBeDefined()
        expect(light).not.toBe(nexus)
    })

    test.each(BUILTIN_IDS)('%s: every collected name outside the exclusion has one value in all schemes', async (id) => {
        const collected = [...await collect()].filter((n) => !EXCLUDED.has(n)).sort()
        expect(collected.length).toBeGreaterThan(300)
        applyBuiltin(pack(id))
        const set = resolvedRules()
        const probe = document.body
        const values = new Map<string, string | undefined>()
        const different: string[] = []
        for (const scheme of SCHEMES) {
            const model = under(scheme, set)
            for (const n of collected) {
                const value = model.custom(probe, n)
                if (scheme === SCHEMES[0]) values.set(n, value)
                else if (values.get(n) !== value) different.push(`${scheme} ${n}: ${value} != ${values.get(n)}`)
            }
        }
        expect(different).toEqual([])
    }, 120000)
})

// ---- TP3

describe('TP3: the names a pack sets win over the base', () => {
    test.each(SCHEMES)('%s: Origin Navy keeps its canvas and accent, Banana Cocoa its scheme keyword and overlay', (scheme) => {
        applyBuiltin(pack('builtin:origin-navy'))
        const navy = under(scheme, resolvedRules())
        expect(colourText(navy.custom(ROOT(), '--nexus-canvas'))).toBe(colourText('#21222c'))
        expect(colourText(navy.custom(ROOT(), '--nexus-accent'))).toBe(colourText('rgb(139 233 253)'))
        applyBuiltin(pack('builtin:banana-cocoa'))
        const cocoa = under(scheme, resolvedRules())
        expect(cocoa.custom(ROOT(), '--color-scheme')).toBe('light')
        expect(cocoa.custom(ROOT(), '--nexus-overlay-rgb')).toBe('0 0 0')
        expect(colourText(cocoa.custom(ROOT(), '--color-surface-sheet'))).toBe(colourText('#ffffff'))
    })
})

// ---- TP3b

describe('TP3b (TB8c): a pack that sets only a channel derives from it', () => {
    test('a pack that sets only the accent channel moves the accent and its tints', () => {
        applySheet(':root{--nexus-accent-rgb:255 170 0}')
        const m = under('light', resolvedRules())
        expect(colourText(m.custom(ROOT(), '--nexus-accent'))).toBe(colourText('rgb(255 170 0)'))
        expect(colourText(m.custom(ROOT(), '--pattern-fill-confirm'))).toBe(colourText('rgb(255 170 0)'))
        expect(colourText(m.custom(ROOT(), '--color-accent-tint-strong'))).toBe(colourText('rgb(255 170 0 / 0.14)'))
    })

    test('a pack that sets only the overlay channel derives the field border from it', () => {
        applySheet(':root{--nexus-overlay-rgb:0 0 0}')
        const m = under('light', resolvedRules())
        expect(colourText(m.custom(ROOT(), '--nexus-field-border'))).toBe(colourText('rgb(0 0 0 / 0.36)'))
    })
})

// ---- TP4

describe('TP4: without a pack nothing is marked and the chat follows the scheme', () => {
    test('a chat with no pack element', () => {
        syncThemePackMedia()
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
        expect(colourText(under('light', resolvedRules()).custom(ROOT(), '--nexus-canvas'))).toBe(colourText('#ffffff'))
    })

    test('an empty pack sheet, through the prepare step and the active-pack mapping, commits null', async () => {
        applyBuiltin(pack('builtin:origin-navy'))
        const empty: BuiltinPack = { id: 'builtin:empty', slug: 'empty', name: 'Empty', version: '1.0.0', license: 'MIT', attribution: 'x', modes: ['dark'], chatCss: '/* nothing */' }
        const prepared = await preparePackSheet({ kind: 'builtin', pack: empty }, judgeSessionOverForTests(async (sheets) => judgePackSheets(sheets)), () => true)
        expect('stale' in prepared).toBe(false)
        if ('stale' in prepared || !prepared.ok) throw new Error('the empty sheet was not prepared')
        expect(chatElementOf(prepared).text).toBeNull()
        commitPackSheet({ elements: prepared.elements, blobs: prepared.blobs })
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
        expect(colourText(under('light', resolvedRules()).custom(ROOT(), '--nexus-canvas'))).toBe(colourText('#ffffff'))
    })
})

// ---- TP6

describe('TP6: the base follows the real apply and the cover', () => {
    test('a committed pack marks the root, a replacement keeps it, and committing null clears it', () => {
        applyBuiltin(pack('builtin:origin-navy'))
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(true)
        expect(get(packBaseTone)).toBe('dark')
        applyBuiltin(pack('builtin:banana-cocoa'))
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(true)
        expect(get(packBaseTone)).toBe('dark')
        expect(commitPackSheet(null)).toEqual({ ok: true })
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
    })

    test('a cover over the chat turns the base and the pack off together, and the scheme shows through', () => {
        applyBuiltin(pack('builtin:origin-navy'))
        expect(colourText(under('light', resolvedRules()).custom(ROOT(), '--nexus-canvas'))).toBe(colourText('#21222c'))
        covered = true
        syncThemePackMedia()
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(false)
        expect(get(packBaseTone)).toBeNull()
        expect(packElement()!.getAttribute('media')).toBe('not all')
        expect(colourText(under('light', resolvedRules()).custom(ROOT(), '--nexus-canvas'))).toBe(colourText('#ffffff'))
        covered = false
        syncThemePackMedia()
        expect(ROOT().hasAttribute(ATTRIBUTE)).toBe(true)
        expect(colourText(under('light', resolvedRules()).custom(ROOT(), '--nexus-canvas'))).toBe(colourText('#21222c'))
    })
})

// ---- TP7

describe('TP7: tokens with no scheme dependence resolve the same with the base on or off', () => {
    test('durations, sizes, radii and motion are unchanged by the attribute', () => {
        const declared = srcTokenNames()
        const model = (on: boolean): CascadeModel => {
            if (on) ROOT().setAttribute(ATTRIBUTE, '')
            else ROOT().removeAttribute(ATTRIBUTE)
            return under('default', compileRules(appSheets))
        }
        const off = model(false)
        // A token that reads the scheme is covered by TP1 and TP2; the rest are plain values.
        const declaredText = new Map<string, string>()
        for (const file of SRC_TOKEN_FILES) for (const [name, text] of plainRoot(readRepoFile(file))) declaredText.set(name, text)
        const plain = declared.filter((n) => {
            const v = off.custom(ROOT(), n)
            return v !== undefined && !isColour(n, v) && !declaredText.get(n)!.includes('--risu-theme-')
        })
        expect(plain.length).toBeGreaterThan(100)
        for (const n of ['--chat-dur-fast', '--nexus-duration-press', '--radius-field']) expect(plain).toContain(n)
        const offValues = new Map(plain.map((n) => [n, off.custom(ROOT(), n)]))
        const on = model(true)
        const different = plain.filter((n) => on.custom(ROOT(), n) !== offValues.get(n))
        ROOT().removeAttribute(ATTRIBUTE)
        expect(different).toEqual([])
    })
})
