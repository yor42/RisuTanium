// @vitest-environment node
// End-to-end translation faithfulness: the port must return, for the same stylesheet, exactly the verdict and the
// errors (content and order) of the reference lint in docs/design. The reference tree is read in place (an accepted
// coupling): when a file is missing the suite fails with its path instead of skipping.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AREA_LINT, THEME_AREAS, lintAreaPack, type ThemeArea } from './index'
import { CHAT_REGISTRY, lintPack as portLintPack, sheetReport as portSheetReport, type LintResult, type Registry, type RegistryInput } from './engine'
import { HOME_MAXIMUMS, HOME_MINIMUMS } from './registries/home'
import { STUDIO_MAXIMUMS, STUDIO_MINIMUMS } from './registries/studio'
// The repository root, from this file's location, so the suite does not depend on the working directory.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const DESIGN = path.resolve(ROOT, 'docs/design')
const REFERENCE_FILES = [
    'theme/checks/lib.mjs',
    'theme/checks/fixtures/benign.mjs',
    'theme/checks/fixtures/home-hostile.json',
    'theme/checks/fixtures/studio-hostile.json',
    'chat/checks/th/packlint.mjs',
    'chat/checks/th/packlint-hostile.mjs',
    'chat/checks/th/packlint-values.mjs',
    'reviews/studio-theme-review/reach.mjs',
    'studio/themes/origin-navy.css',
    'settings/checks/th/fixtures/index-right.css',
]
const LEGACY_SETTINGS = ['backdrop-hidden', 'backdrop-top', 'cancel-hidden', 'footer-row-reverse', 'retry-hidden', 'row-hidden', 'toast-faded']
for (const rel of [...REFERENCE_FILES, ...LEGACY_SETTINGS.map((n) => `settings/checks/th/fixtures/${n}.css`)]) {
    if (!fs.existsSync(path.join(DESIGN, rel))) throw new Error(`parity.test.ts needs the reference file docs/design/${rel} (resolved ${path.join(DESIGN, rel)}); the suite depends on docs/design being in place`)
}

interface RefError { selector: string, prop: string, why: string }
interface RefResult { ok: boolean, errors: RefError[], name: string }
type RefLint = (css: string, name: string) => RefResult
interface RefLoader {
    LINT: Record<ThemeArea, RefLint>
    PACKS: Record<string, string>
    read: (rel: string) => string
}
interface RefChat {
    lintPack: (css: string, name?: string, registry?: RegistryInput) => RefResult
    sheetReport: (css: string, registry?: RegistryInput | Registry) => unknown
    CHAT_REGISTRY: Registry
}
type Entry2 = readonly [string, string]
interface RefBenign {
    HOME_BENIGN: Entry2[]
    NEW_BENIGN: Record<string, Entry2[]>
    NEW_HOSTILE: readonly [string, string, string, RegExp][]
}
interface RefHostile { HOSTILE: Entry2[], HOSTILE_2: Entry2[], HOSTILE_3: Entry2[], BENIGN: Entry2[], BENIGN_2: Entry2[] }
interface RefValues { ACCEPT: Record<string, Entry2>, REJECT: Record<string, Entry2>, SETTINGS_REGISTRY: RegistryInput }

const load = <T,>(rel: string): Promise<T> => import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, rel)).href) as Promise<T>
const lib = await load<RefLoader>('theme/checks/lib.mjs')
const chat = await load<RefChat>('chat/checks/th/packlint.mjs')
const benign = await load<RefBenign>('theme/checks/fixtures/benign.mjs')
const hostile = await load<RefHostile>('chat/checks/th/packlint-hostile.mjs')
const values = await load<RefValues>('chat/checks/th/packlint-values.mjs')
const reachSource = fs.readFileSync(path.join(DESIGN, 'reviews/studio-theme-review/reach.mjs'), 'utf8')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
/** The id, name and css of each pack in a hostile-pack fixture file. */
function readHostileFixture(file: string): { id: string, name: string, css: string }[] {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(DESIGN, 'theme/checks/fixtures', file), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`${file} is not an array`)
    return parsed.map((item: unknown) => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.css !== 'string') throw new Error(`${file} holds an entry without id, name and css`)
        return { id: item.id, name: item.name, css: item.css }
    })
}

interface Input { label: string, css: string }
const inputs: Input[] = []
const add = (group: string, name: string, css: string): void => { inputs.push({ label: `${group}: ${name}`, css }) }

for (const [key, file] of Object.entries(lib.PACKS)) add('shipped pack', key, lib.read(file))

const navy = lib.read('studio/themes/origin-navy.css')
for (const f of readHostileFixture('home-hostile.json')) {
    add('home-hostile', f.id, f.css)
    add('home-hostile on Navy', f.id, `${navy}\n${f.css}`)
}
for (const f of readHostileFixture('studio-hostile.json')) {
    add('studio-hostile', f.id, f.css)
    add('studio-hostile on Navy', f.id, `${navy}\n${f.css}`)
}

for (const [n, css] of benign.HOME_BENIGN) add('HOME_BENIGN', n, css)
for (const [area, list] of Object.entries(benign.NEW_BENIGN)) for (const [n, css] of list) add(`NEW_BENIGN ${area}`, n, css)
for (const [area, n, css] of benign.NEW_HOSTILE) add(`NEW_HOSTILE ${area}`, n, css)

for (const group of ['HOSTILE', 'HOSTILE_2', 'HOSTILE_3', 'BENIGN', 'BENIGN_2'] as const) for (const [n, css] of hostile[group]) add(group, n, css)
for (const group of ['ACCEPT', 'REJECT'] as const) for (const [key, [css]] of Object.entries(values[group])) add(`values ${group}`, key, css)

for (const n of LEGACY_SETTINGS) add('legacy settings', n, fs.readFileSync(path.join(DESIGN, `settings/checks/th/fixtures/${n}.css`), 'utf8'))
add('legacy settings', 'index-right', fs.readFileSync(path.join(DESIGN, 'settings/checks/th/fixtures/index-right.css'), 'utf8'))

// The reach packs are read exactly as the reference suite reads them: R<n> id, name, css in single quotes.
const reach = [...reachSource.matchAll(/\['(R\d+) ([^']*)', '((?:[^'\\]|\\.)*)'\]/g)].map((m) => ({ id: m[1], name: m[2], css: m[3] }))
for (const r of reach) add('studio reach', `${r.id} ${r.name}`, r.css)

let comparisons = 0
const verdicts = { accepted: 0, rejected: 0 }
const note = (r: RefResult): void => { comparisons++; if (r.ok) verdicts.accepted++; else verdicts.rejected++ }

// each test lints the whole corpus twice (reference and port), which exceeds the default 5 s limit
describe('parity with the reference: area lints, engine lint and sheet report', { timeout: 120_000 }, () => {
    it('reads every corpus the brief names', () => {
        expect(Object.keys(lib.PACKS)).toHaveLength(8)
        expect(reach.map((r) => r.id)).toEqual(Array.from({ length: 16 }, (_, i) => `R${i + 1}`))
        expect(THEME_AREAS).toEqual(['chat', 'settings', 'studio', 'home'])
        expect(inputs.length).toBeGreaterThan(200)
    })

    for (const area of THEME_AREAS) {
        it(`the ${area} area lint returns the reference errors, in order, for every corpus input`, () => {
            for (const input of inputs) {
                const expected = lib.LINT[area](input.css, input.label)
                const actual = AREA_LINT[area](input.css, input.label)
                expect(actual, `${area} / ${input.label}`).toEqual(expected)
                note(expected)
            }
        })
    }

    it('the engine lintPack returns the reference errors, in order, for every corpus input', () => {
        for (const input of inputs) {
            const expected = chat.lintPack(input.css, input.label)
            expect(portLintPack(input.css, input.label), input.label).toEqual(expected)
            note(expected)
        }
    })

    it('the engine sheetReport with CHAT_REGISTRY returns the reference sheet heights for every corpus input', () => {
        for (const input of inputs) {
            expect(portSheetReport(input.css, CHAT_REGISTRY), input.label).toEqual(chat.sheetReport(input.css, chat.CHAT_REGISTRY))
            comparisons++
        }
    })

    it('the engine lintPack with the values-file Settings registry agrees on its ACCEPT and REJECT sets', () => {
        for (const group of ['ACCEPT', 'REJECT'] as const) {
            for (const [key, [css]] of Object.entries(values[group])) {
                const expected = chat.lintPack(css, key, values.SETTINGS_REGISTRY)
                expect(portLintPack(css, key, values.SETTINGS_REGISTRY), `${group} ${key}`).toEqual(expected)
                // the reference suite's expectation: the accept set is accepted, the reject set is rejected
                expect(expected.ok, `${group} ${key} verdict`).toBe(group === 'ACCEPT')
                note(expected)
            }
        }
    })

    it('a seeded single-token fuzz of the registry limits agrees for chat, studio and home', () => {
        // mulberry32: a small deterministic generator so the shuffled order is fixed for seed 727
        let state = 727
        const random = (): number => {
            state = (state + 0x6d2b79f5) | 0
            let t = Math.imul(state ^ (state >>> 15), 1 | state)
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
        const shuffle = <T,>(list: T[]): T[] => {
            const out = [...list]
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1))
                ;[out[i], out[j]] = [out[j], out[i]]
            }
            return out
        }
        const scale = (v: string | number, k: number): string => {
            if (typeof v === 'number') return String(v * k)
            const m = /^(-?[\d.]+)(.*)$/.exec(v)
            return m ? `${Number(m[1]) * k}${m[2]}` : v
        }
        const unitOf = (v: string | number | undefined): string => (typeof v === 'string' ? (/^-?[\d.]+(.*)$/.exec(v)?.[1] ?? '') : '')
        const sources: { area: ThemeArea, min: Record<string, string | number>, max: Record<string, string | number> }[] = [
            { area: 'chat', min: CHAT_REGISTRY.minimums, max: CHAT_REGISTRY.maximums },
            { area: 'studio', min: STUDIO_MINIMUMS, max: STUDIO_MAXIMUMS },
            { area: 'home', min: HOME_MINIMUMS, max: HOME_MAXIMUMS },
        ]
        let fuzzed = 0
        for (const { area, min, max } of sources) {
            const names = shuffle([...new Set([...Object.keys(min), ...Object.keys(max)])])
            expect(names.length, `${area} limits`).toBeGreaterThan(10)
            for (const name of names) {
                const floor = min[name]
                const ceiling = max[name]
                const values: string[] = [
                    floor !== undefined ? scale(floor, 0.5) : `0${unitOf(ceiling)}`,
                    floor !== undefined ? String(floor) : `0${unitOf(ceiling)}`,
                    ceiling !== undefined ? String(ceiling) : `0${unitOf(floor)}`,
                    ceiling !== undefined ? scale(ceiling, 2) : `0${unitOf(floor)}`,
                    'auto',
                ]
                for (const value of values) {
                    const css = `:root{${name}:${value}}`
                    const label = `fuzz ${area} ${name}:${value}`
                    const expected = lib.LINT[area](css, label)
                    expect(AREA_LINT[area](css, label), label).toEqual(expected)
                    note(expected)
                    fuzzed++
                }
            }
        }
        expect(fuzzed).toBeGreaterThan(300)
    })

    it('the compared inputs include accepted and rejected verdicts and more than 300 comparisons in total', () => {
        // runs last in file order: every earlier test has recorded its comparisons
        expect(comparisons).toBeGreaterThan(300)
        expect(verdicts.accepted).toBeGreaterThan(0)
        expect(verdicts.rejected).toBeGreaterThan(0)
    })
})

// UI-S6 stage 1: where the app is stricter than the reference. The reference lint is the byte-parity oracle for AREA_LINT
// (above); lintAreaPack adds the pack normal form on top, so it may refuse what the reference accepts, but only for a
// listed reason (P1) and only for the named corpus entries (P2). Comment joins (html/**/[x]) are not P1 entries: the reference reads the
// raw comment as nothing and already refuses them; they are pinned in packRules.test.ts.
const SEND_PART = '[data-part="chat-send"]'
const SAFE_PART = '[data-part="chat-message-avatar"]'
const TEXT_PART = '[data-part="chat-message-text"]'
const DIVERGENCES: readonly { label: string, area: ThemeArea, css: string, why: RegExp }[] = [
    { label: 'selcase-pair', area: 'chat', css: `${SEND_PART}{background:#111111;color:#111111}[data-part="CHAT-SEND"]{background:#ffff00}`, why: /attribute value or at-rule string in a selector or prelude may hold only a-z/ },
    { label: 'kelvin-back-pair', area: 'studio', css: '[data-part="studio-header-back"]{background:#111111;color:#111111}[data-part="studio-header-bac\u212a"]{background:#ffff00}', why: /may hold only a-z, 0-9/ },
    { label: 'kelvin-tasks-pair', area: 'home', css: '[data-part="home-tasks-button"]{background:#111111;color:#111111}[data-part="home-tas\u212as-button"]{background:#ffff00}', why: /may hold only a-z, 0-9/ },
    { label: 'uni-longs-ctx', area: 'chat', css: `[data-x="\u017f"] ${SAFE_PART}{opacity:0}`, why: /may hold only a-z, 0-9/ },
    { label: 'case-ring', area: 'chat', css: ':root{--focus-ring-w:0px;--FOCUS-RING-W:2px}', why: /a custom property name must be written in lower case/ },
    { label: 'var-ref-upper', area: 'chat', css: `:root{--nexus-pad:10px}${SAFE_PART}{padding:var(--NEXUS-PAD)}`, why: /a var\(\) reference must be written in lower case/ },
    { label: 'pk-empty-pad', area: 'chat', css: `:root{--pack-:1000px}${SAFE_PART}{padding:var(--pack-)}`, why: /the bare name --pack- is not a helper token/ },
    { label: 'pk-scope-pair', area: 'chat', css: `${SAFE_PART}{--pack-c:#111111}${SEND_PART}{background:#ffff00;color:var(--pack-c)}`, why: /is used but has no value on :root/ },
    { label: 'k-attr-pad', area: 'chat', css: `:root{--nexus-pad:10px}html[data-layout="phone"]{--nexus-pad:1000px}${SAFE_PART}{padding:var(--nexus-pad)}`, why: /a pack may set tokens only on :root/ },
    { label: 'app-em-pad-reach', area: 'chat', css: `${SEND_PART}{font-size:40px;padding:var(--size-rel-12)}`, why: /whose value 4em is in em/ },
    { label: 's1-semi-ring', area: 'chat', css: ':root{--focus-ring-w:0px}x;:root{--focus-ring-w:2px}', why: /text outside a rule/ },
    { label: 's2-bracket-ring', area: 'chat', css: ':root{--focus-ring-w:0px;--nexus-x:[;--focus-ring-w:2px;]}', why: /square brackets are not allowed in a rule block/ },
    { label: 's13-mixed-closers-ring', area: 'chat', css: ':root{--focus-ring-w:0px}x[(]){}:root{--focus-ring-w:2px}y]{}', why: /brackets must close in order/ },
    { label: 'var-empty-fb', area: 'chat', css: `${SAFE_PART}{padding:var(--nexus-nope,)}`, why: /without a fallback/ },
    { label: 'calc-product', area: 'chat', css: `${TEXT_PART}{margin:calc(10px * 100)}`, why: /calc\(\) is not allowed in a pack/ },
    { label: 'font-1000pct', area: 'chat', css: `${TEXT_PART}{font-size:1000%}`, why: /font size must be one px or rem length above 0/ },
    { label: 'sysfont', area: 'chat', css: `${TEXT_PART}{font-family:"Wingdings"}`, why: /MC-1550/ },
]

describe('P1: lintAreaPack refuses, for the listed reason, what the reference lint accepts', () => {
    for (const entry of DIVERGENCES) {
        it(`${entry.label} (${entry.area})`, () => {
            expect(lib.LINT[entry.area](entry.css, entry.label).ok, 'the reference accepts it').toBe(true)
            const result = lintAreaPack(entry.area, entry.css, entry.label)
            expect(result.ok).toBe(false)
            expect(result.errors.some((e) => entry.why.test(e.why)), JSON.stringify(result.errors.map((e) => e.why))).toBe(true)
        })
    }
})

// Corpus entries the reference accepts and the app refuses, by name: the pack normal form (MC-1565, MC-1566) and the
// system font rule (MC-1550) refuse them. Any other flip is a stop-and-report, not a list entry.
const NAMED_REFUSALS: readonly string[] = [
    'HOME_BENIGN: B04 a token under data-input|home',
    ...THEME_AREAS.flatMap((area) => ['BENIGN_2: D1 touch density', 'BENIGN_2: D2 wide layout', 'BENIGN_2: D3 both attributes', 'BENIGN_2: D4 :root with an attribute', 'values ACCEPT: index-right'].map((label) => `${label}|${area}`)),
    'legacy settings: index-right|settings',
]
describe('PT1: comment placement keeps a verdict (A19)', () => {
    // A comment only stands where a space means the same to the browser, so deleting every comment outside strings keeps the
    // verdict of an accepted input. A compatibility guard over the corpus; the NF17 reproducers are in packRules.test.ts.
    it('every corpus input accepted in an area stays accepted with its comments deleted', { timeout: 120_000 }, () => {
        let checked = 0
        for (const input of inputs) {
            if (!input.css.includes('/*')) continue
            const stripped = input.css.replace(/\/\*[\s\S]*?\*\//g, '')
            for (const area of THEME_AREAS) {
                if (!lintAreaPack(area, input.css, input.label).ok) continue
                expect(lintAreaPack(area, stripped, input.label).ok, `${area} / ${input.label}`).toBe(true)
                checked++
            }
        }
        expect(checked).toBeGreaterThan(10)
    })
})

describe('P2: the corpus sweep of where lintAreaPack is stricter than the reference', () => {
    it('refuses exactly the named entries, plus the system-font packs (H52, R9)', { timeout: 120_000 }, () => {
        const flips: string[] = []
        for (const input of inputs) {
            for (const area of THEME_AREAS) {
                if (!lib.LINT[area](input.css, input.label).ok) continue
                if (!lintAreaPack(area, input.css, input.label).ok) flips.push(`${input.label}|${area}`)
            }
        }
        const fontPacks = flips.filter((f) => /H52|studio reach: R9/.test(f))
        const others = flips.filter((f) => !fontPacks.includes(f))
        expect(others.sort()).toEqual([...NAMED_REFUSALS].sort())
        // The census of system-font packs the reference accepts and the app refuses: a new one is a stop-and-report.
        expect(fontPacks).toHaveLength(9)
        // The system-font packs are refused for the font rule, in every area that accepts them.
        for (const f of fontPacks) {
            const [label, area] = f.split('|')
            const input = inputs.find((i) => i.label === label)!
            expect(lintAreaPack(area as ThemeArea, input.css, label).errors.some((e) => /MC-1550|font family/.test(e.why)), f).toBe(true)
        }
    })

    it('every named entry is still refused (no stale entries)', { timeout: 120_000 }, () => {
        for (const entry of NAMED_REFUSALS) {
            const [label, area] = entry.split('|')
            const input = inputs.find((i) => i.label === label)
            expect(input, label).toBeDefined()
            expect(lintAreaPack(area as ThemeArea, input!.css, label).ok, entry).toBe(false)
        }
    })
})
