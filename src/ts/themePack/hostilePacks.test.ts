// @vitest-environment node
// Hostile-pack suite: the validator assertions of docs/design/theme/checks/run.mjs (sections 1 to 6) run against the port's
// public API (lintAreaPack and the port registries); the reference implementation is not imported. Reference fixtures
// (pack files, JSON hostile lists and the three plain-data .mjs modules) are read as data only.
// Not ported: run.mjs section 7 (single-token fuzz), section 8 (shared token file checks) and dd256's calibration against
// rendered pages; those are mockup and token-file checks, not validator behaviour.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { lintPack as lintEngine, type LintResult, type RegistryInput } from './engine'
import { THEME_AREAS, lintAreaPack, type ThemeArea } from './index'
import { HOME_REGISTRY, HOME_SETTABLE, homeSupplement } from './registries/home'
import { STUDIO_MAXIMUMS, STUDIO_MINIMUMS } from './registries/studio'
// The repository root, from this file's location, so the suite does not depend on the working directory.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
type Named = [string, string]
interface ReviewPack { id: string, name: string, css: string }
interface Benign { HOME_BENIGN: Named[], NEW_BENIGN: Record<string, Named[]>, NEW_HOSTILE: [ThemeArea | 'all', string, string, RegExp][] }
interface Hostile { HOSTILE: Named[], HOSTILE_2: Named[], HOSTILE_3: Named[], BENIGN: Named[], BENIGN_2: Named[], BORDERLINE_OK: string[] }
interface Values { SETTINGS_REGISTRY: RegistryInput, REJECT: Record<string, [string]>, ACCEPT: Record<string, [string]> }
// The reference fixture data modules (plain JS) are loaded by URL from the repository root, so the suite runs on any checkout.
const loadData = async <T,>(rel: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(path.resolve(ROOT, 'docs/design', rel)).href)) as T
const benign = await loadData<Benign>('theme/checks/fixtures/benign.mjs')
const hostile = await loadData<Hostile>('chat/checks/th/packlint-hostile.mjs')
const values = await loadData<Values>('chat/checks/th/packlint-values.mjs')

// Fixture files are resolved from the repository root (the test runs with the repository root as cwd).
const read = (rel: string): string => readFileSync(path.resolve(ROOT, 'docs/design', rel), 'utf8')
const readReviewPacks = (name: string): ReviewPack[] => JSON.parse(readFileSync(path.resolve(ROOT, 'docs/design/theme/checks/fixtures', name), 'utf8')) as ReviewPack[]
const why = (r: LintResult): string => r.errors.map((e) => `${e.selector} { ${e.prop} }: ${e.why}`).join(' | ')
const rejectedFor = (r: LintResult, re: RegExp): boolean => !r.ok && r.errors.some((e) => re.test(e.why))
const detail = (r: LintResult): string => (r.ok ? 'ACCEPTED' : why(r).slice(0, 300))
const lint = (area: ThemeArea, css: string, name: string): LintResult => lintAreaPack(area, css, name)
const expectRejected = (r: LintResult, re: RegExp): void => { expect(rejectedFor(r, re), `${re} against ${detail(r)}`).toBe(true) }
const expectAccepted = (r: LintResult): void => { expect(r.ok, why(r)).toBe(true) }
const areasOf = (area: ThemeArea | 'all'): readonly ThemeArea[] => (area === 'all' ? THEME_AREAS : [area])

// Helper variables: a hostile pack that chains through --x, --a ... is also judged with those names listed, so the
// underlying floor logic is shown to still work.
const HELPERS: RegExp[] = [/^--(x\d?|a|b|z|t|w|r)$/]

const lintOpenHome = (css: string, name: string): LintResult => {
    const r = lintEngine(css, name, { ...HOME_REGISTRY, settable: [...HOME_SETTABLE, ...HELPERS] })
    const e = homeSupplement(css)
    if (e.length) {
        r.errors.push(...e)
        r.ok = false
    }
    return r
}

const SHIPPED_PACKS: [ThemeArea, string][] = THEME_AREAS.flatMap((a) => ['origin-navy', 'banana-cocoa'].map((p): [ThemeArea, string] => [a, `${a}/themes/${p}.css`]))
const NAVY_STUDIO = read('studio/themes/origin-navy.css')

describe('1 shipped packs', () => {
    it('lists all 8 shipped packs (4 areas, 2 packs each)', () => { expect(SHIPPED_PACKS).toHaveLength(8) })
    it.each(SHIPPED_PACKS)('%s: %s is accepted', (area, file) => {
        expectAccepted(lint(area, read(file), file))
    })
})

// Studio review packs: the right reason for each; the decided-accept set stays accepted (DD-243 protects the key controls only).
const R_ALLOW = /not on the declaration allowlist|can contain, be or sit inside|translucent text/
const STUDIO_EXPECT: Record<string, RegExp> = {
    H01: /protected part studio-save-chip/, H02: /protected part studio-save-retry/, H03: /translucent text|allowlist/, H04: R_ALLOW, H05: R_ALLOW,
    P04: /larger than 64 px/, S04: /names no part|protected part/, S12: /names no part/, S13: /names no part/, S14: /names no part/, S15: /names no part/, S16: /names no part/, S17: /names no part/, S18: /names no part/, S19: /names no part/,
    T01: /fully transparent/, T02: /would be [\d.]+:1/, T03: /fully transparent/, T04: /critical minimum/, T05: /not a pack-settable/, T06: /not a pack-settable/, T07: /not a pack-settable/, T08: /not a pack-settable/, T09: /not a pack-settable/, T10: /not a pack-settable/, T11: /not a pack-settable/, T12: /not a pack-settable/,
    T13: /critical minimum/, T14: /fully transparent/, T15: /not a pack-settable/, T16: /would be [\d.]+:1/, T17: /would be [\d.]+:1/, T18: /critical maximum/, T19: /would be [\d.]+:1/, T20: /would be [\d.]+:1/, T21: /not a pack-settable/, T22: /not a pack-settable/, T23: /not a pack-settable/, T24: /would be [\d.]+:1/, T25: /would be [\d.]+:1/, T26: /would be [\d.]+:1/,
}
const STUDIO_DECIDED_ACCEPT = new Set(['H06', 'H07', 'H08', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P17'])
const studioExtra: [string, string | null, RegExp | null][] = [
    ['B1-token sheet transparent', ':root{--color-surface-sheet:transparent}', /fully transparent|opaque/], ['B1-token sheet alpha .05', ':root{--color-surface-sheet:rgb(0 1 28 / 0.05)}', /opaque colour/], ['toast transparent', ':root{--color-surface-toast:transparent}', /fully transparent|opaque/],
    ['sheet = canvas colour translucent', ':root{--color-surface-sheet:rgb(0 1 28 / 0.1)}', /opaque colour/], ['edge transparent', ':root{--nexus-edge:transparent;--nexus-edge-strong:transparent}', /fully transparent/], ['studio-tint-sheet-92 holder', ':root{--studio-tint-sheet-92:transparent}', /not a pack-settable/],
    ['M6 tree width 100px', ':root{--studio-tree-width:100px}', /critical minimum/], ['M6 tree width 400px accepted? (inside 160..480)', null, null], ['M6 side width 3000px', ':root{--studio-side-width:3000px}', /critical maximum/], ['M6 side width 100px', ':root{--studio-side-width:100px}', /critical minimum/],
    ['B2 animation speed', ':root{--risu-animation-speed:100}', /not a pack-settable/], ['B2 sizes ladder', ':root{--studio-sz-12vh:3000px;--studio-sp-2px:3000px}', /not a pack-settable/],
]
// Home review packs: each must be rejected with a reason from its group's set.
const HOME_RIGHT = (id: string): RegExp => {
    if (/^K(1|2|5|6|7|8|9|10|11|12|14|17|18|19|21|22|23)$/.test(id)) return /cannot be resolved to a concrete sRGB|would be [\d.]+:1|cannot be checked/
    if (/^K(3|4|13|15|16|20|24)$/.test(id)) return /fully transparent|opaque|would be [\d.]+:1|cannot be resolved|primary button label/
    if (/^L[1-7]$/.test(id)) return /outlines|indication of focus|allowlist|visibility|not allowed in a pack selector/;   // L3 uses :focus, which no pack selector may use at all
    if (/^(H\d+|V\d|W\d|T\d|N\d+|G\d+|M\d+)$/.test(id) || id === 'A8') return /allowlist|can place|position|negative margin|outline|cursor|transform|clip|filter|z-index|animation|transition|font size|translucent|not allowed|beyond|inset|float|can cover, fade or disable|larger than 64|text colour that is|background that makes|writing-mode/
    if (/^F\d+$/.test(id)) return /critical m|cannot be|not a pack-settable|not allowed|@/
    if (/^C\d+$/.test(id)) return /would be [\d.]+:1|fully transparent|cannot be resolved|not allowed|@media|not a pack-settable/
    if (/^[ARS]\d+$/.test(id)) return /protected part|data-part-critical|not allowed|allowlist|url|@|transform|position|animation|transition|content|z-index|background|opaque/
    return /./
}
const HOME_DECIDED_ACCEPT = new Set(['H52']);   // a font family is a pack's freedom (fonts are out of scope for lint)

// Private variables (--pack-*) cannot launder a value: [name, css, accepted?, reason].
const PRIV: [string, string, boolean, RegExp?][] = [
    ['a private colour used by a control', ':root{--pack-y:#fee500}[data-part="chat-send"]{background:var(--pack-y);color:#191919}', true],
    ['text colour through a private variable', ':root{--pack-t:#0e0f2b;--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
    ['colour-mix through a private variable', ':root{--pack-t:color-mix(in srgb,red,blue);--nexus-text:var(--pack-t)}', false, /cannot be resolved to a concrete sRGB/],
    ['oklch through a chain of two', ':root{--pack-a:var(--pack-b);--pack-b:oklch(0.1 0 0);--nexus-danger:var(--pack-a)}', false, /cannot be resolved to a concrete sRGB/],
    ['transparent sheet through a private variable', ':root{--pack-s:transparent;--color-surface-sheet:var(--pack-s)}', false, /fully transparent|opaque/],
    ['translucent sheet through a private variable', ':root{--pack-s:rgb(14 15 42 / 0.4);--color-surface-sheet:var(--pack-s)}', false, /opaque colour/],
    ['a floor through a private variable', ':root{--pack-s:0px;--nexus-focus-ring-width:var(--pack-s)}', false, /critical minimum/],
    ['a ceiling through a private variable', ':root{--pack-s:900px;--header-height:var(--pack-s)}', false, /critical maximum/],
    ['a ceiling through a private variable in calc()', ':root{--pack-s:400px;--header-height:calc(var(--pack-s) * 2)}', false, /critical maximum/],
    ['the bad value only under a root attribute', ':root{--pack-t:#fff}html[data-layout="phone"]{--pack-t:#0e0f2b}:root{--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
    ['the bad value only in an @media block', ':root{--pack-t:#fff}@media (min-width:1px){:root{--pack-t:#0e0f2b}}:root{--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
    ['the bad value declared first, a good one last', '@media (min-width:1px){:root{--pack-t:#0e0f2b}}:root{--pack-t:#fff;--nexus-text:var(--pack-t)}', false, /would be [\d.]+:1/],
    ['padding through a private variable under a root attribute', 'html[data-layout="phone"]{--pack-p:9999px}[data-part="chat-send"]{padding:var(--pack-p)}', false, /larger than 64 px/],
    ['padding through a fallback', '[data-part="chat-send"]{padding:var(--pack-none,9999px)}', false, /larger than 64 px/],
    ['a private variable chaining to a ladder token', ':root{--pack-g:var(--space-3);--control-gap:var(--pack-g)}', true],
    ['a cycle', ':root{--pack-a:var(--pack-b);--pack-b:var(--pack-a)}', false, /cannot be judged/],
    ['a private variable set on a part (inlined as one more value, judged wherever it is read)', '[data-part="chat-send"]{--pack-a:1px}', true],
    ['a part-scoped private value that reaches a ceiling', '[data-part="chat-send"]{--pack-a:900px}:root{--header-height:var(--pack-a)}', false, /critical maximum/],
    ['an unlisted name that only looks private', ':root{--packs-x:#fff}', false, /not a pack-settable/],
    ['background through a private variable on a kind selector', ':root{--pack-b:#fff}[data-kind="restore"]{background:var(--pack-b)}', false, /names no part/],
    ['outline through a private variable', ':root{--pack-o:none}[data-part="chat-message-name"]{outline:var(--pack-o)}', false, /outlines/],
    ['display through a private variable on Send', ':root{--pack-d:none}[data-part="chat-send"]{display:var(--pack-d)}', false, /allowlist/],
    ['a text colour through a private variable on a reach part', ':root{--pack-c:#0e0f2b}[data-part="chat-list-row"]{color:var(--pack-c)}', false, /text colour that is/],
]
// Studio fix round: the save chip and Retry are protected, their ancestors leave the safe tier, --studio-critical-min-width is a floored role token.
const FIX_ROUND: [string, string, RegExp][] = [
    ['hide the failing chip icon', '[data-part="studio-save-chip-icon"]{display:none}', /protected part studio-save-chip-icon/],
    ['hide the failing chip text', '[data-part="studio-save-chip-text"]{font-size:0}', /protected part studio-save-chip-text/],
    ['transparent chip text', '[data-part="studio-save-chip-text"]{color:transparent}', /protected part studio-save-chip-text/],
    ['hide the chip while failed (by state)', '[data-part="studio-save-chip"][data-state="failed"]{display:none}', /protected part studio-save-chip/],
    ['hide the chip in conflict', '[data-part="studio-save-chip"][data-state="conflict"]{opacity:0}', /protected part studio-save-chip/],
    ['hide Retry', '[data-part="studio-save-retry"]{display:none}', /protected part studio-save-retry/],
    ['hide the header (it holds the chip)', '[data-part="studio-header"]{display:none}', /allowlist/],
    ['hide the save slot', '[data-part="studio-save-slot"]{visibility:hidden}', /allowlist/],
    ['squeeze a banner: min width 40px', ':root{--studio-critical-min-width:40px}', /critical minimum/],
    ['squeeze a banner: min width 159px', ':root{--studio-critical-min-width:159px}', /critical minimum/],
    ['squeeze under a phone layout', 'html[data-layout="phone"]{--studio-critical-min-width:100px}', /critical minimum/],
    ['squeeze in an @media block', '@media (max-width:400px){:root{--studio-critical-min-width:0}}', /critical minimum/],
    ['squeeze through a private variable', ':root{--pack-w:20px;--studio-critical-min-width:var(--pack-w)}', /critical minimum/],
    ['squeeze with a relative unit', ':root{--studio-critical-min-width:10vw}', /critical minimum/],
    ['min width beyond a phone', ':root{--studio-critical-min-width:900px}', /critical maximum/],
    ['squeeze by ancestor padding (form host 100 + body 20 a side)', '[data-part="studio-form-host"]{padding:0 100px}[data-part="studio-body"]{padding:0 20px}', /ancestor padding along/],
    ['the splitter\'s own variable is not settable', ':root{--studio-tree-user-width:100px}', /not a pack-settable/],
    ['the old unprefixed tab size is not settable', ':root{--tab-size:99}', /not a pack-settable/],
    ['tab size 99', ':root{--studio-tab-size:99}', /critical maximum/],
    ['tab size 0', ':root{--studio-tab-size:0}', /critical minimum/],
    ['tree width 100 (bounded 160 to 480)', ':root{--studio-tree-width:100px}', /critical minimum/],
    ['side width 3000 (bounded 240 to 560)', ':root{--studio-side-width:3000px}', /critical maximum/],
]
const FIX_ROUND_ACCEPTED: Named[] = [['min width at the page default 160px', ':root{--studio-critical-min-width:160px}'], ['min width 240px', ':root{--studio-critical-min-width:240px}'], ['tab size 4', ':root{--studio-tab-size:4}'], ['tree width 300px', ':root{--studio-tree-width:300px}'], ['count error background transparent', ':root{--studio-count-error-bg:transparent}'], ['recolour the header (reach)', '[data-part="studio-header"]{border-radius:12px;padding:4px 12px}'], ['form host padding 16px a side', '[data-part="studio-form-host"]{padding:0 16px}']]
// A selector that names no part may not change a size; the root of a protected sheet keeps the page's width.
const DD265: [ThemeArea | 'all', string, string, RegExp][] = [
    ['all', 'padding on a kind selector', '[data-kind="peer"]{padding:64px}', /names no part can resize/], ['all', 'border width on a kind selector', '[data-kind="conflict"]{border:16px dashed #f8f8f2}', /names no part can resize/],
    ['all', 'border-width on a state selector', '[data-state="failed"]{border-width:16px}', /names no part can resize/], ['all', 'font-size on a kind selector', '[data-kind="restore"]{font-size:40px}', /names no part can resize/],
    ['all', 'width on a kind selector', '[data-kind="apply"]{width:50%}', /names no part can resize/], ['all', 'max-width on a kind selector', '[data-kind="leave"]{max-width:50%}', /names no part can resize/], ['all', 'min-width on a state selector', '[data-state="ask"]{min-width:900px}', /names no part can resize/],
    ['all', 'padding-inline on a state selector', '[data-state="failed"]{padding-inline:50px}', /names no part can resize/], ['all', 'padding through a private variable', ':root{--pack-p:64px}[data-kind="peer"]{padding:var(--pack-p)}', /names no part can resize/],
    ['all', 'inside @media', '@media (max-width:2000px){[data-kind="peer"]{padding:64px}}', /names no part can resize/], ['all', 'with a root attribute in front', 'html[data-layout="phone"] [data-kind="peer"]{padding:64px;font-size:40px}', /names no part can resize/],
    ['studio', 'sheet root width 50%', '[data-part="studio-sheet-root"]{width:50%;max-width:50%}', /root of a protected sheet/], ['studio', 'sheet root width 200px', '[data-part="studio-sheet-root"]{width:200px}', /root of a protected sheet/], ['studio', 'sheet root min-width 900px', '[data-part="studio-sheet-root"]{min-width:900px}', /root of a protected sheet/],
    ['chat', 'chat sheet width 50%', '[data-part="chat-sheet"]{width:50%}', /root of a protected sheet/], ['chat', 'chat sheet body max-width 100px', '[data-part="chat-sheet-body"]{max-width:100px}', /root of a protected sheet/], ['home', 'home dialog width 150px', '[data-part="home-dialog"]{width:150px}', /root of a protected sheet/],
]
// Ceilings, safe-tier padding and ancestor padding chains.
const CEIL_PACKS: [ThemeArea, string, string, RegExp][] = [
    ['chat', 'header height 3000px', ':root{--header-height:3000px}', /critical maximum/], ['chat', 'message gap 3000px', ':root{--message-gap:3000px}', /critical maximum/], ['chat', 'composer field height 900px', ':root{--composer-field-height:900px}', /critical maximum/],
    ['chat', 'sidebar width 3000px', ':root{--sidebar-width:3000px}', /critical maximum/], ['chat', 'avatar 500px', ':root{--size-avatar:500px}', /critical maximum/], ['chat', 'font size xl 300px', ':root{--font-size-xl:300px}', /critical maximum/],
    ['chat', 'touch size 300px', ':root{--size-touch:300px}', /critical maximum/], ['chat', 'bubble padding 500px', ':root{--bubble-pad-start:500px}', /critical maximum/],
    ['studio', 'tab height 900px', ':root{--studio-tab-height:900px}', /critical maximum/], ['studio', 'tree row height 900px', ':root{--studio-tree-row-height:900px}', /critical maximum/], ['studio', 'splitter 900px', ':root{--studio-splitter-width:900px}', /critical maximum/],
    ['studio', 'padding 4000px on an ordinary toast (P04)', '[data-part="studio-toast"]{padding:4000px}', /larger than 64 px/],
    ['home', 'padding 500px on a safe card', '[data-part="home-story"]{padding:500px}', /larger than 64 px/], ['settings', 'padding 500px on a safe leaf', '[data-part="settings-section-title"]{padding:500px}', /larger than 64 px/],
    ['studio', 'M3 main + body padding 64px (ancestor chain 256 px)', '[data-part="studio-main"]{padding:64px}[data-part="studio-body"]{padding:64px}', /ancestor padding along/],
    ['studio', 'M3 main + body + form host (each 40px a side, 240 px)', '[data-part="studio-main"]{padding:0 40px}[data-part="studio-body"]{padding:0 40px}[data-part="studio-form-host"]{padding:0 40px}', /ancestor padding along/],
    ['studio', 'M3 sheet root alone 64px', '[data-part="studio-sheet-root"]{padding:64px}', /ancestor padding along/],
    ['home', 'shell + main + library padding 48px each side', '[data-part="home-shell"]{padding:0 48px}[data-part="home-main"]{padding:0 48px}[data-part="home-library"]{padding:0 48px}', /ancestor padding along/],
    ['chat', 'transcript + message + body padding', '[data-part="chat-transcript"]{padding:0 64px}[data-part="chat-message"]{padding:0 64px}', /ancestor padding along/],
]
const CEIL_ACCEPTED: [ThemeArea, string, string][] = [['studio', 'main + body padding 12px a side (48 px more than the default 24, 72 px in all), within the budget', '[data-part="studio-main"]{padding:0 12px}[data-part="studio-body"]{padding:0 12px}'], ['chat', 'a roomy header and gaps inside the ceilings', ':root{--header-height:64px;--message-gap:32px;--composer-field-height:72px}'], ['home', 'card padding 24px', '[data-part="home-story"]{padding:24px}']]
const MUST: Record<string, RegExp> = { R1: /ancestor padding|larger than 64/, R2: /larger than 64|ancestor padding/, R3: /ancestor padding/, R4: /ancestor padding/, R11: /names no part/, R12: /names no part/, R15: /names no part|outlines/, R16: /root of a protected sheet/ }

describe('2 studio review packs', () => {
    for (const f of readReviewPacks('studio-hostile.json')) {
        for (const [label, css] of [['bare', f.css], ['on Navy', NAVY_STUDIO + '\n' + f.css]] as Named[]) {
            if (STUDIO_DECIDED_ACCEPT.has(f.id)) {
                // Accepted by decision: only the key controls are protected, other safe parts keep their freedom.
                it(`${f.id} ${label} is accepted by decision (${f.name})`, () => { expectAccepted(lint('studio', css, f.id)) })
                continue
            }
            const re = STUDIO_EXPECT[f.id] || /./
            it(`${f.id} ${label} is rejected for the right reason ${re} (${f.name.slice(4)})`, () => { expectRejected(lint('studio', css, f.id), re) })
        }
    }
    it('every decided-accept id and every expected id is a pack of the studio review list', () => {
        const ids = new Set(readReviewPacks('studio-hostile.json').map((f) => f.id))
        for (const id of [...STUDIO_DECIDED_ACCEPT, ...Object.keys(STUDIO_EXPECT)]) expect(ids.has(id), id).toBe(true)
    })
    for (const [n, css, re] of studioExtra) {
        if (css === null || re === null) {
            it(`${n}: a tree width inside its limits is accepted`, () => { expectAccepted(lint('studio', ':root{--studio-tree-width:400px}', n)) })
            continue
        }
        it(`${n} is rejected (${re})`, () => { expectRejected(lint('studio', css, n), re) })
    }
})

// ---- 3. Home re-review packs
describe('3 home review packs', () => {
    for (const f of readReviewPacks('home-hostile.json')) {
        const key = f.id
        if (HOME_DECIDED_ACCEPT.has(key)) {
            it(`${key} is accepted by decision (a font family is free): ${f.name}`, () => { expectAccepted(lint('home', f.css, key)) })
            continue
        }
        const re = HOME_RIGHT(key)
        it(`${key} is rejected for the right reason: ${f.name.slice(0, 60)}`, () => {
            const r = lint('home', f.css, key)
            let ok = rejectedFor(r, re)
            // Rejected only because it chains through a helper variable: with the helpers listed, the original mechanism still rejects it.
            if (!r.ok && !ok && r.errors.some((e) => /not a pack-settable/.test(e.why))) ok = rejectedFor(lintOpenHome(f.css, key), re)
            expect(ok, `${re} against ${detail(r)}`).toBe(true)
        })
        if (/^F(1|5|6|7|8|17|18|20)$/.test(key) || key === 'F19' || key === 'F2') {
            // The floor and ceiling cases: with their helper variables listed, the worst-case floors still reject them.
            it(`${key} with its helper variables listed is still rejected by the floor and ceiling logic`, () => { expectRejected(lintOpenHome(f.css, key), /critical m|cannot be/) })
        }
    }
    it('every decided-accept id is a pack of the home review list', () => {
        const ids = new Set(readReviewPacks('home-hostile.json').map((f) => f.id))
        for (const id of HOME_DECIDED_ACCEPT) expect(ids.has(id), id).toBe(true)
    })
})

// ---- 4. new DD-242 / DD-243 packs
describe('4 new rules', () => {
    for (const [area, name, css, re] of benign.NEW_HOSTILE) {
        for (const a of areasOf(area)) it(`${a}: ${name} is rejected for the right reason (${re})`, () => { expectRejected(lint(a, css, name), re) })
    }
    // The default Deep Nexus pack (no rules) is accepted everywhere: no default fails its own rules.
    it.each(THEME_AREAS)('%s: an empty pack is accepted', (a) => { expectAccepted(lint(a, '', 'empty')) })
    it('registry.same rejects a channel that is not its colour and accepts one that is', () => {
        const bad = lintEngine(':root{--nexus-accent-rgb:255 0 0}', 'same', { same: [['--nexus-accent-rgb', '--nexus-canvas', 'test']] })
        const good = lintEngine('', 'same', { same: [['--nexus-canvas', '--nexus-canvas', 't']] })
        expectRejected(bad, /is not the colour of/)
        expectAccepted(good)
    })
    it('--pack-* is the one private prefix in every area (a registry may turn it off with an empty prefix)', () => {
        const off = lintEngine(':root{--pack-y:#fee500}', 'off', { privatePrefix: '' })
        for (const a of THEME_AREAS) expectAccepted(lint(a, ':root{--pack-y:#fee500}', 'p'))
        expect(off.ok, detail(off)).toBe(false)
        expect(lint('chat', ':root{--bc-y:#fee500}', 'bc').ok).toBe(false)
    })
})

// ---- 4b. private variables cannot launder a value; ceilings, safe padding, ancestor chains
describe('4b private variables, studio fix round, reach packs, ceilings and chains', () => {
    for (const [n, css, want, re] of PRIV) {
        for (const a of THEME_AREAS) {
            if (n.includes('studio') && a !== 'studio') continue
            it(`${a}: ${n} is ${want ? 'accepted' : `rejected (${re})`}`, () => {
                const r = lint(a, css, n)
                if (want) expectAccepted(r)
                else expectRejected(r, re as RegExp)
            })
        }
    }
    for (const [n, css, re] of FIX_ROUND) {
        it(`studio: ${n} is rejected (${re}), bare and on Origin Navy`, () => {
            expectRejected(lint('studio', css, n), re)
            expect(lint('studio', NAVY_STUDIO + '\n' + css, n).ok).toBe(false)
        })
    }
    for (const [n, css] of FIX_ROUND_ACCEPTED) it(`studio: ${n} is accepted`, () => { expectAccepted(lint('studio', css, n)) })
    {
        // The Studio review's ancestor-reach packs R1..R16, read from the review file, judged by the Studio lint.
        const src = read('reviews/studio-theme-review/reach.mjs')
        const R = [...src.matchAll(/\['(R\d+) ([^']*)', '((?:[^'\\]|\\.)*)'\]/g)].map((m): [string, string, string] => [m[1], m[2], m[3]])
        it('all 16 reach packs were read (R1..R16)', () => { expect(R.length).toBe(16) })
        for (const [id, name, css] of R) {
            const re = MUST[id]
            if (re) it(`studio reach ${id}: ${name} is rejected (${re})`, () => { expectRejected(lint('studio', css, id), re) })
        }
    }
    for (const [ar, n, css, re] of DD265) {
        for (const a of areasOf(ar)) it(`${a}: ${n} is rejected (${re})`, () => { expectRejected(lint(a, css, n), re) })
    }
    for (const a of THEME_AREAS) {
        for (const [n, css] of [['colour and radius on a kind selector', '[data-kind="peer"]{border-color:#f8f8f2;border-radius:12px;color:#fff}'], ['a width of auto or 100% on a sheet root', '[data-part="studio-sheet-root"]{width:100%;max-width:none}']] as Named[]) {
            if (/sheet root/.test(n) && a !== 'studio') continue
            it(`${a}: ${n} is accepted`, () => { expectAccepted(lint(a, css, n)) })
        }
    }
    for (const [a, n, css, re] of CEIL_PACKS) it(`${a}: ${n} is rejected (${re})`, () => { expectRejected(lint(a, css, n), re) })
    for (const [a, n, css] of CEIL_ACCEPTED) it(`${a}: ${n} is accepted`, () => { expectAccepted(lint(a, css, n)) })
})

// ---- 5. benign fixtures
describe('5 benign fixtures', () => {
    for (const [n, css] of benign.HOME_BENIGN) it(`home: ${n} is accepted`, () => { expectAccepted(lint('home', css, n)) })
    for (const a of THEME_AREAS) {
        for (const [n, css] of [...benign.NEW_BENIGN.all, ...(benign.NEW_BENIGN[a] || [])]) it(`${a}: ${n} is accepted`, () => { expectAccepted(lint(a, css, n)) })
    }
    for (const [n, css] of [...hostile.BENIGN, ...hostile.BENIGN_2]) it(`chat: ${n} is accepted`, () => { expectAccepted(lint('chat', css, n)) })
    for (const [k, [css]] of Object.entries(values.ACCEPT)) {
        // The value-space fixtures are judged by the chat engine under the Settings part registry they were written for.
        it(`settings value fixture ${k} is accepted under its registry`, () => { expectAccepted(lintEngine(css, k, values.SETTINGS_REGISTRY)) })
    }
    it('the Settings index on the right through role tokens is accepted', () => { expectAccepted(lint('settings', read('settings/checks/th/fixtures/index-right.css'), 'index-right')) })
    {
        const decls = (m: Record<string, string | number>, keep: (k: string) => boolean = () => true): string => ':root{' + Object.entries(m).filter(([k]) => keep(k)).map(([k, v]) => `${k}:${v}`).join(';') + '}'
        const sheetToks = /^--studio-(space-5|font-xl|font-base|size-touch-lg|space-3)$/
        const cases: Named[] = [
            ['every floor value together', decls(STUDIO_MINIMUMS)],
            ['every ceiling value together except the sheet geometry', decls(STUDIO_MAXIMUMS, (k) => !sheetToks.test(k))],
            ['a compact form', ':root{--studio-font-md:12px;--studio-font-base:13px;--studio-space-3:6px;--studio-form-row-height:36px;--studio-form-risky-edge-width:3px;--studio-form-risky-tint-alpha:0.07}'],
        ]
        for (const [n, css] of cases) it(`studio: ${n} is accepted`, () => { expectAccepted(lint('studio', css, n)) })
    }
})

// ---- 6. legacy suites of the areas
describe('6 legacy hostile lists are still rejected', () => {
    const legacy: Named[] = [...hostile.HOSTILE, ...hostile.HOSTILE_3, ...hostile.HOSTILE_2.filter(([n]) => !hostile.BORDERLINE_OK.includes(n))]
    for (const [n, css] of legacy) it(`chat: ${n} is rejected`, () => { expect(lint('chat', css, '').ok, 'ACCEPTED').toBe(false) })
    for (const [k, [css]] of Object.entries(values.REJECT)) {
        it(`settings value fixture ${k} is rejected under its registry`, () => { expect(lintEngine(css, k, values.SETTINGS_REGISTRY).ok, 'ACCEPTED').toBe(false) })
    }
    it.each(['backdrop-hidden', 'backdrop-top', 'cancel-hidden', 'footer-row-reverse', 'retry-hidden', 'row-hidden', 'toast-faded'])('settings fixture file %s is rejected', (f) => {
        expect(lint('settings', read(`settings/checks/th/fixtures/${f}.css`), f).ok, 'ACCEPTED').toBe(false)
    })
})
