// @vitest-environment node
// End-to-end translation faithfulness: the port must return, for the same stylesheet, exactly the verdict and the
// errors (content and order) of the reference lint in docs/design. The reference tree is read in place (an accepted
// coupling): when a file is missing the suite fails with its path instead of skipping.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AREA_LINT, THEME_AREAS, type ThemeArea } from './index'
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
