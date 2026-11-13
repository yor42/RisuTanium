// @vitest-environment node
// The validator API (judgeAreaSheet, judgePackSheets) and the resource spans are metadata over the validator: spans
// index the canonical text exactly, and the verdict is the one lintAreaPack gives. The corpus is the parity suite's,
// read from the reference tree in place like parity.test.ts.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalStylesheet, type ResourceSpan } from './canonical'
import { THEME_AREAS, judgeAreaSheet, judgePackSheets, lintAreaPack, preprocessCss, validateThemePack, type ThemeArea } from './index'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESIGN = path.resolve(ROOT, 'docs/design')
const LEGACY_SETTINGS = ['backdrop-hidden', 'backdrop-top', 'cancel-hidden', 'footer-row-reverse', 'retry-hidden', 'row-hidden', 'toast-faded']

type Entry2 = readonly [string, string]
interface RefLoader { PACKS: Record<string, string>, read: (rel: string) => string }
interface RefBenign {
    HOME_BENIGN: Entry2[]
    NEW_BENIGN: Record<string, Entry2[]>
    NEW_HOSTILE: readonly [string, string, string, RegExp][]
}
interface RefHostile { HOSTILE: Entry2[], HOSTILE_2: Entry2[], HOSTILE_3: Entry2[], BENIGN: Entry2[], BENIGN_2: Entry2[] }
interface RefValues { ACCEPT: Record<string, Entry2>, REJECT: Record<string, Entry2> }

const load = <T,>(rel: string): Promise<T> => import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, rel)).href) as Promise<T>
const lib = await load<RefLoader>('theme/checks/lib.mjs')
const benign = await load<RefBenign>('theme/checks/fixtures/benign.mjs')
const hostile = await load<RefHostile>('chat/checks/th/packlint-hostile.mjs')
const values = await load<RefValues>('chat/checks/th/packlint-values.mjs')
const reachSource = fs.readFileSync(path.join(DESIGN, 'reviews/studio-theme-review/reach.mjs'), 'utf8')

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
function readHostileFixture(file: string): { id: string, css: string }[] {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(DESIGN, 'theme/checks/fixtures', file), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`${file} is not an array`)
    return parsed.map((item: unknown) => {
        if (!isRecord(item) || typeof item.id !== 'string' || typeof item.css !== 'string') throw new Error(`${file} holds an entry without id and css`)
        return { id: item.id, css: item.css }
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
const reach = [...reachSource.matchAll(/\['(R\d+) ([^']*)', '((?:[^'\\]|\\.)*)'\]/g)].map((m) => ({ id: m[1], name: m[2], css: m[3] }))
for (const r of reach) add('studio reach', `${r.id} ${r.name}`, r.css)

const LEAF = '[data-part="chat-message-avatar"]'
const RE_1550 = /MC-1550/
const RE_COULD_NOT_CHECK = /could not be checked/

interface SpanView { form: ResourceSpan['form'], token: string, raw: string, target: string }
function spansOf(css: string): { text: string, spans: SpanView[], errors: number } {
    const canonical = canonicalStylesheet(preprocessCss(css))
    const spans = canonical.resources.map((r) => ({ form: r.form, token: canonical.text.slice(r.start, r.end), raw: r.raw, target: r.target }))
    return { text: canonical.text, spans, errors: canonical.errors.length }
}

describe('Ts-2: a resource span indexes the canonical text exactly', () => {
    it('an unquoted url is one url-token span, with its whitespace', () => {
        expect(spansOf(`${LEAF}{background-image:url(images/a.png)}`).spans).toEqual([{ form: 'url-token', token: 'url(images/a.png)', raw: 'images/a.png', target: 'images/a.png' }])
        expect(spansOf(`${LEAF}{background-image:url( images/a.png )}`).spans).toEqual([{ form: 'url-token', token: 'url( images/a.png )', raw: 'images/a.png', target: 'images/a.png' }])
    })

    it('a quoted url argument is one string span, quotes included, and the url( wrapper is not a span', () => {
        expect(spansOf(`${LEAF}{background-image:url("images/a.png")}`).spans).toEqual([{ form: 'string', token: '"images/a.png"', raw: 'images/a.png', target: 'images/a.png' }])
        expect(spansOf(`${LEAF}{background-image:url( 'images/a.png' )}`).spans).toEqual([{ form: 'string', token: "'images/a.png'", raw: 'images/a.png', target: 'images/a.png' }])
    })

    it('every string argument of a resource function is a span, in text order, also under a vendor prefix', () => {
        const { spans } = spansOf(`${LEAF}{background-image:-webkit-image-set("a.png" 1x,"b.png" 2x)}`)
        expect(spans.map((s) => [s.form, s.token])).toEqual([['string', '"a.png"'], ['string', '"b.png"']])
    })

    it('a string outside a resource function is not a span', () => {
        expect(spansOf(`${LEAF}{content:"images/a.png"}`).spans).toEqual([])
        expect(spansOf(`${LEAF}{background-image:image-set("a.png" 1x) , url(b.png)}`).spans.map((s) => s.token)).toEqual(['"a.png"', 'url(b.png)'])
    })

    it('offsets index the canonical text, where a comment is one space, not the source', () => {
        const css = `/* a longer comment */${LEAF}{background-image:url(images/a.png)}`
        const { text, spans } = spansOf(css)
        expect(text.startsWith(' ')).toBe(true)
        const canonical = canonicalStylesheet(preprocessCss(css))
        expect(canonical.resources[0].start).toBe(1 + `${LEAF}{background-image:`.length)
        expect(spans[0].token).toBe('url(images/a.png)')
    })

    it('a broken or unterminated resource has no span and carries an error', () => {
        for (const css of [`${LEAF}{background-image:url(a.png}`, `${LEAF}{background-image:url("a.png}`, `${LEAF}{background-image:url(a"b.png)}`]) {
            const view = spansOf(css)
            expect(view.spans, css).toEqual([])
            expect(view.errors, css).toBeGreaterThan(0)
        }
    })

    it('the @font-face blocks hold exactly the src resources of their blocks, with offsets into the same canonical text', () => {
        const face = '@font-face{font-family:"pack-serif";src:url(fonts/serif.woff2) format("woff2"),url("fonts/serif.woff") format("woff")}'
        const judged = judgeAreaSheet('chat', `${face}${LEAF}{background-image:url(images/a.png)}`)
        expect(judged.result.errors).toEqual([])
        expect(judged.fontFaceBlocks).toHaveLength(1)
        const [block] = judged.fontFaceBlocks
        expect(judged.canonical.slice(block.start, block.end)).toBe(block.text)
        expect(block.text).toBe(face)
        const inFace = judged.resources.map((r) => ({ token: judged.canonical.slice(r.start, r.end), inFace: r.start >= block.start && r.end <= block.end }))
        expect(inFace).toEqual([
            { token: 'url(fonts/serif.woff2)', inFace: true },
            { token: '"fonts/serif.woff"', inFace: true },
            { token: 'url(images/a.png)', inFace: false },
        ])
    })

    it('a sheet with a regular and a bold @font-face block is judged, with both blocks listed and each resource inside its block', () => {
        const regular = '@font-face{font-family:"pack-serif";font-weight:400;src:url(fonts/serif.woff2) format("woff2")}'
        const bold = '@font-face{font-family:"pack-serif";font-weight:700;src:url(fonts/serif-bold.woff2) format("woff2")}'
        const judged = judgeAreaSheet('chat', `${regular}${bold}${LEAF}{background-image:url(images/a.png)}`)
        expect(judged.result.errors).toEqual([])
        expect(judged.result.ok).toBe(true)
        expect(judged.fontFaceBlocks).toHaveLength(2)
        expect(judged.fontFaceBlocks.map((b) => b.text)).toEqual([regular, bold])
        const fontResources = judged.resources.filter((r) => judged.canonical.slice(r.start, r.end).includes('fonts/'))
        expect(fontResources).toHaveLength(2)
        for (const r of judged.resources) {
            const containing = judged.fontFaceBlocks.filter((b) => r.start >= b.start && r.end <= b.end)
            expect(containing, judged.canonical.slice(r.start, r.end)).toHaveLength(judged.canonical.slice(r.start, r.end).includes('fonts/') ? 1 : 0)
        }
    })

    it('every span of every corpus input is a url token or a string token that holds its target', () => {
        let url = 0
        let str = 0
        for (const input of inputs) {
            const canonical = canonicalStylesheet(preprocessCss(input.css))
            let previousEnd = 0
            for (const r of canonical.resources) {
                const token = canonical.text.slice(r.start, r.end)
                expect(r.start, input.label).toBeGreaterThanOrEqual(previousEnd)
                expect(r.end, input.label).toBeGreaterThan(r.start)
                previousEnd = r.end
                expect(r.raw, input.label).toBe(r.target)
                if (r.form === 'url-token') {
                    const inner = /^(?:-(?:webkit|moz|ms|o)-)?url\(\s*([^\s)]*)\s*\)$/i.exec(token)
                    expect(inner?.[1], `${input.label}: ${token}`).toBe(r.raw)
                    url++
                } else {
                    expect(token[0], `${input.label}: ${token}`).toMatch(/^["']$/)
                    expect(token.slice(-1), `${input.label}: ${token}`).toBe(token[0])
                    expect(token.slice(1, -1), `${input.label}: ${token}`).toBe(r.raw)
                    str++
                }
            }
        }
        // the corpus must exercise both forms, or the loop above proves nothing
        expect(url).toBeGreaterThan(0)
        expect(str).toBeGreaterThan(0)
    })

    it('judgeAreaSheet returns the lintAreaPack verdict and the canonical pieces for every corpus input', { timeout: 300_000 }, () => {
        for (const input of inputs) {
            const canonical = canonicalStylesheet(preprocessCss(input.css))
            for (const area of THEME_AREAS) {
                const judged = judgeAreaSheet(area, input.css, undefined, input.label)
                expect(judged.result, `${area} / ${input.label}`).toEqual(lintAreaPack(area, input.css, input.label))
                expect(judged.canonical, `${area} / ${input.label}`).toBe(canonical.text)
                expect(judged.resources, `${area} / ${input.label}`).toEqual(canonical.resources)
                for (const block of judged.fontFaceBlocks) expect(judged.canonical.slice(block.start, block.end), `${area} / ${input.label}`).toBe(block.text)
            }
        }
    })
})

describe('Ts-3: judgePackSheets judges each sheet with its own font families', () => {
    const SETTINGS_SHEET = '[data-part="settings-section-title"]{font-family:pack-f}'
    const FACE_SHEET = '@font-face{font-family:pack-f;src:url(f.woff2)}'

    it('a family registered only in another sheet is refused for the sheet that uses it', () => {
        const pooled = validateThemePack({ files: { chat: FACE_SHEET, settings: SETTINGS_SHEET }, totalBytes: 1 })
        expect(pooled.areas.settings?.errors.filter((e) => RE_1550.test(e.why))).toEqual([])
        const perSheet = judgePackSheets({ chat: FACE_SHEET, settings: SETTINGS_SHEET })
        expect(perSheet.ok).toBe(false)
        expect(perSheet.areas.chat?.result.ok).toBe(true)
        expect(perSheet.areas.settings?.result.ok).toBe(false)
        expect(perSheet.areas.settings?.result.errors.some((e) => RE_1550.test(e.why))).toBe(true)
        expect(perSheet.areas.settings?.result).toEqual(lintAreaPack('settings', SETTINGS_SHEET, 'settings'))
    })

    it('a sheet that registers and uses its own family is accepted', () => {
        const own = `${FACE_SHEET}[data-part="settings-section-title"]{font-family:pack-f}`
        const judged = judgePackSheets({ settings: own })
        expect(judged.ok).toBe(true)
        expect(judged.areas.settings?.fontFaceBlocks).toHaveLength(1)
    })

    it('an area without a sheet is absent, and an empty pack is ok', () => {
        expect(judgePackSheets({ home: '' }).areas).toEqual({ home: expect.objectContaining({ canonical: '' }) })
        expect(judgePackSheets({}).areas).toEqual({})
        expect(judgePackSheets({}).ok).toBe(true)
    })

    it('the shipped packs get the verdicts lintAreaPack and validateThemePack give', () => {
        for (const theme of ['origin-navy', 'banana-cocoa']) {
            const files: Partial<Record<ThemeArea, string>> = {}
            for (const area of THEME_AREAS) files[area] = lib.read(lib.PACKS[`${area}/${theme}`])
            const judged = judgePackSheets(files)
            const pooled = validateThemePack({ files, totalBytes: 1 })
            for (const area of THEME_AREAS) {
                expect(judged.areas[area]?.result, `${theme} ${area}`).toEqual(lintAreaPack(area, files[area]!, area))
                expect(judged.areas[area]?.result, `${theme} ${area} pooled`).toEqual(pooled.areas[area])
            }
            expect(judged.ok, theme).toBe(pooled.ok)
        }
    })
})

describe('Ts-4: a sheet the checks throw on is refused, not thrown on', () => {
    // An escaped at-keyword makes the declaration reader throw inside the value rules.
    const THROWING = '@\\6b eyframes x{from{opacity:0}}'

    it('the wrapper keeps its behaviour and the judge API refuses', () => {
        expect(() => lintAreaPack('chat', THROWING)).toThrow()
        const judged = judgeAreaSheet('chat', THROWING, undefined, 'chat')
        expect(judged.result.ok).toBe(false)
        expect(judged.result.name).toBe('chat')
        expect(judged.result.errors).toHaveLength(1)
        expect(judged.result.errors[0].why).toMatch(RE_COULD_NOT_CHECK)
        expect(judged.canonical).toBe('')
        expect(judged.resources).toEqual([])
        expect(judged.fontFaceBlocks).toEqual([])
    })

    it('judgePackSheets refuses the pack and still judges the other sheets', () => {
        const judged = judgePackSheets({ chat: THROWING, studio: '' })
        expect(judged.ok).toBe(false)
        expect(judged.areas.chat?.result.errors[0].why).toMatch(RE_COULD_NOT_CHECK)
        expect(judged.areas.studio?.result.ok).toBe(true)
    })
})
