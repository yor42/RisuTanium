// @vitest-environment node
// The canonical text and the verdict of every corpus input are pinned by digest: the validator API (judgeAreaSheet,
// judgePackSheets) and the resource spans are metadata over the validator, so they must never change what the validator
// reads or decides. The corpus is the parity suite's (shipped packs, hostile and benign fixtures, reach packs), read from
// the reference tree in place like parity.test.ts.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalStylesheet } from './canonical'
import { THEME_AREAS, lintAreaPack, preprocessCss } from './index'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESIGN = path.resolve(ROOT, 'docs/design')
const GOLDEN_FILE = path.resolve(fileURLToPath(new URL('./fixtures/', import.meta.url)), 'corpus-golden.txt')
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

// Every written form of a resource, so the canonical text of each is pinned (the shipped corpus names few resources).
const RESOURCE_LEAF = '[data-part="chat-message-avatar"]'
const RESOURCE_FORMS: readonly Entry2[] = [
    ['unquoted', `${RESOURCE_LEAF}{background-image:url(images/a.png)}`],
    ['unquoted with whitespace', `${RESOURCE_LEAF}{background-image:url(  images/a.png  )}`],
    ['double quoted', `${RESOURCE_LEAF}{background-image:url("images/a.png")}`],
    ['single quoted', `${RESOURCE_LEAF}{background-image:url('images/a.png')}`],
    ['quoted with whitespace', `${RESOURCE_LEAF}{background-image:url( 'images/a.png' )}`],
    ['image-set strings', `${RESOURCE_LEAF}{background-image:image-set('a.png' 1x,"b.png" 2x)}`],
    ['vendor image-set', `${RESOURCE_LEAF}{background-image:-webkit-image-set('a.png' 1x)}`],
    ['after a comment', `/* note */${RESOURCE_LEAF}{background-image:url('images/a.png')}`],
    ['font face sources', `@font-face{font-family:'pack-serif';src:url('fonts/a.woff2') format('woff2'),url(fonts/a.woff) format("woff")}${RESOURCE_LEAF}{background-image:url('images/a.png')}`],
    ['remote and broken', `${RESOURCE_LEAF}{background-image:url('https://example.test/a.png')} ${RESOURCE_LEAF}{background-image:url(a.png}`],
]
for (const [name, css] of RESOURCE_FORMS) add('resource forms', name, css)
const digest = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** One golden line: the label, the digest of the canonical text, then the digest of each area's JSON verdict (`throws` when the validator throws). */
function goldenLine(input: Input): string {
    let canonical: string
    try { canonical = digest(canonicalStylesheet(preprocessCss(input.css)).text) } catch { canonical = 'throws' }
    const verdicts = THEME_AREAS.map((area) => {
        try { return `${area}:${digest(JSON.stringify(lintAreaPack(area, input.css, input.label)))}` } catch { return `${area}:throws` }
    })
    return [JSON.stringify(input.label), canonical, ...verdicts].join(' ')
}

describe('Ts-1: the canonical text and the verdict of every corpus input are unchanged', () => {
    it('reads the whole corpus', () => {
        expect(inputs.length).toBeGreaterThan(800)
        expect(new Set(inputs.map((i) => i.label)).size).toBe(inputs.length)
    })

    it('matches the golden line of every input, in order', { timeout: 300_000 }, () => {
        const golden = fs.readFileSync(GOLDEN_FILE, 'utf8').split(/\r?\n/).filter((line) => line !== '')
        expect(golden).toHaveLength(inputs.length)
        const changed: string[] = []
        inputs.forEach((input, index) => { if (goldenLine(input) !== golden[index]) changed.push(input.label) })
        expect(changed).toEqual([])
    })
})