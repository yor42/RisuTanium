// @vitest-environment node
// #315 and #316 loosen the reach tier (MC-2538): repeating gradients read as gradients, background-size, -position and
// -repeat allowed on reach parts, and a px or rem max-width of at least 320 px. Each loosening accepts more and keeps every
// colour judged; the refusals beside each one stay. Every sheet is also linted by the reference in docs/design, which must
// return the port's errors exactly.
// Kinds: every "accepts" case is a regression reproducer (refused before #315/#316). The "still refuses" cases are
// compatibility guards (refused before and after), except two that pin a changed reason: the repeating-gradient stop case was
// refused before as an unknown colour word and is now refused by the critical-text check, and the DD-242 cases were refused
// before by the declaration allowlist and now only by the widened DD-242 guard (they also kill the mutant without that guard).
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AREA_LINT, judgeAreaSheet, type ThemeArea } from './index'

const DESIGN = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/design')
interface RefResult { ok: boolean, errors: { selector: string, prop: string, why: string }[] }
const lib = await import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'theme/checks/lib.mjs')).href) as { LINT: Record<ThemeArea, (css: string, name: string) => RefResult> }

// A light page whose surfaces are all readable with the app's dark text, so a refusal below is the rule under test and not contrast.
const ROOT = `:root {
  --color-scheme: light;

  /* pack-local helpers (DD-258) */
  --pack-paper: #fdfdfa;
  --pack-rule: #b9cfe9;
  --pack-margin: #f0a8a6;
  --pack-ink: #1f4aa8;

  /* canvas and surfaces */
  --nexus-canvas: #fdfdfa;
  --nexus-canvas-bloom: transparent;
  --nexus-canvas-warm: transparent;
  --nexus-surface: rgb(43 46 52 / 0.04);
  --nexus-surface-raised: rgb(43 46 52 / 0.08);
  --nexus-surface-flat: #ffffff;
  --nexus-edge: rgb(43 46 52 / 0.14);
  --nexus-edge-strong: rgb(43 46 52 / 0.55);
  --nexus-field-border: var(--nexus-edge-strong);
  --color-placeholder: var(--nexus-text-secondary);
  --color-surface-sheet: #ffffff;
  --color-surface-bar: #f6f6f1;
  --color-surface-toast: #fffef5;
  --color-surface-kbd: #e4e4de;
  --color-key: #ffffff;

  /* text: graphite */
  --nexus-text: #2b2e34;
  --nexus-text-secondary: #464b54;
  --nexus-text-muted: #545a64;

  /* accent: blue ink */
  --nexus-accent-rgb: 31 74 168;
  --nexus-accent: rgb(var(--nexus-accent-rgb));
  --nexus-ring: #1f4aa8;
  --nexus-core-from: #1f4aa8;
  --nexus-core-to: #173a86;
  --color-on-brand: #ffffff;
  --nexus-warm: #8a3a1a;
  --nexus-warm-from: #fde9d9;
  --nexus-warm-to: #f8cfb0;
  --color-on-avatar: #2b2e34;
  --color-on-accent: #ffffff;
  --nexus-danger-rgb: 179 38 30;
  --nexus-danger: rgb(var(--nexus-danger-rgb));
  --nexus-overlay-rgb: 0 0 0;

  /* what the channels do not give */
  --color-shimmer: rgb(255 255 255 / 0.6);
  --color-code-bg-inline: rgb(43 46 52 / 0.07);
  --color-code-bg: rgb(43 46 52 / 0.05);
  --color-syntax-keyword: #5b3fa0;
  --color-warning: #8a5a00;
  --color-hit: #8a5a00;
  --color-hit-rgb: 255 236 120;
  --color-hit-bg: rgb(var(--color-hit-rgb) / 0.6);

  /* group speakers and scope tags: dark counterparts for a light page */
  --chat-speaker-0: #7a3b12; --chat-speaker-1: #1f3f8a; --chat-speaker-2: #0d5434; --chat-speaker-3: #6b4a00; --chat-speaker-4: #5b2f9e; --chat-speaker-5: #8c1a42; --chat-speaker-6: #0a4f61; --chat-speaker-7: #7a2a8f;
  --color-scope-character-text: #4b2a8a;
  --color-scope-character-edge: #7a55d6;
  --color-scope-character-rgb: 122 85 214;
  --color-scope-all-text: #7a4a00;
  --color-scope-all-edge: #c27c00;
  --color-scope-all-rgb: 194 124 0;

  /* bubbles: none, the writing sits on the page */
  --color-bubble-char: #fdfdfa;
  --color-bubble-char-text: #2b2e34;
  --color-bubble-user: #fdfdfa;
  --color-bubble-user-text: #1f4aa8;
  --radius-bubble: var(--radius-3);
  --radius-bubble-tail: var(--radius-3);

  /* corners */
  --radius-control: 6px;
  --radius-field: 6px;
  --radius-sheet: 10px;
}
`
const P = (part: string, body: string, pre = ''): string => `${pre}[data-part="${part}"] { ${body} }`
const RULE = 'repeating-linear-gradient(to bottom, rgb(0 0 0 / 0) 0px, rgb(0 0 0 / 0) 23px, #b9cfe9 23px, #b9cfe9 24px)'
// Studio's page is dark, so its ruled lines are dark too (light lines fail its danger-text check)
const STUDIO_RULE = 'repeating-linear-gradient(to bottom, rgb(0 0 0 / 0) 0px, rgb(0 0 0 / 0) 23px, #000000 23px, #000000 24px)'
const LINE = 'linear-gradient(to bottom, rgb(0 0 0 / 0) 23px, #b9cfe9 23px, #b9cfe9 24px)'

const sheetOf = (area: ThemeArea, css: string): string => (area === 'chat' ? ROOT + css : css)
function verdict(area: ThemeArea, css: string): { ok: boolean, whys: string[] } {
    const sheet = sheetOf(area, css)
    const j = judgeAreaSheet(area, sheet)
    // the reference reads the same sheet the same way (parity.test.ts holds this for the corpus; these sheets are new)
    expect(AREA_LINT[area](sheet, 'loosen'), `parity: ${css}`).toEqual(lib.LINT[area](sheet, 'loosen'))
    return { ok: j.result.ok, whys: j.result.ok ? [] : j.result.errors.map((e) => `${e.prop}: ${e.why}`) }
}
const accepts = (area: ThemeArea, css: string): void => {
    const v = verdict(area, css)
    expect(v.whys, css).toEqual([])
    expect(v.ok, css).toBe(true)
}
const refuses = (area: ThemeArea, css: string, why: RegExp): void => {
    const v = verdict(area, css)
    expect(v.ok, css).toBe(false)
    expect(v.whys.some((w) => why.test(w)), `${css}\n${v.whys.join('\n')}`).toBe(true)
}

describe('#315 V1: a repeating gradient is read as a gradient, every stop still judged', () => {
    it('accepts repeating linear, radial and conic gradients on reach parts of chat and Studio', () => {
        accepts('chat', P('chat-transcript', `background-image: ${RULE};`))
        accepts('chat', P('chat-message-list', 'background-image: repeating-radial-gradient(circle, #b9cfe9 0px, #b9cfe9 1px, #ffffff 1px, #ffffff 8px);'))
        accepts('chat', P('chat-transcript', 'background-image: repeating-conic-gradient(#ffffff 0deg, #f4f4f4 10deg);'))
        accepts('studio', P('studio-main', `background-image: ${STUDIO_RULE};`))
    })
    it('still judges the stops of a repeating gradient against the critical text', () => {
        refuses('chat', P('chat-transcript', 'background-image: repeating-linear-gradient(#000000 0px, #000000 4px);'), /critical text/)
    })
    it('still refuses the bare word repeating and a repeating name that is not a gradient', () => {
        refuses('chat', P('chat-transcript', 'background: repeating #ffffff;'), /colour word that is not a colour/)
        refuses('chat', P('chat-transcript', 'background-image: repeating-foo-gradient(#ffffff, #ffffff);'), /colour word that is not a colour/)
    })
})

describe('#315 V2: background-size, -position and -repeat on reach parts', () => {
    it('accepts each longhand on a reach part', () => {
        for (const decl of ['background-size: 100% 24px;', 'background-position: 0 0;', 'background-position-x: 4px;', 'background-position-y: 0;', 'background-repeat: repeat-y;']) {
            accepts('chat', P('chat-transcript', `background-image: ${LINE}; ${decl}`))
        }
        accepts('studio', P('studio-main', 'background-image: linear-gradient(to bottom, rgb(0 0 0 / 0) 23px, #000000 23px, #000000 24px); background-size: 100% 24px;'))
    })
    it('accepts a full ruled page: repeating lines tiled down the transcript', () => {
        accepts('chat', P('chat-transcript', `background-image: ${RULE}, ${LINE}; background-size: 100% 24px; background-repeat: repeat-y;`))
    })
    it('accepts repeat-x and repeat-y in the background shorthand', () => {
        accepts('chat', P('chat-transcript', `background: ${LINE} 0 0 / 24px 24px repeat-y;`))
        accepts('chat', P('chat-transcript', `background: ${LINE} repeat-x;`))
    })
    it('still refuses a bare x or y word, and a length the checks cannot read', () => {
        refuses('chat', P('chat-transcript', 'background: #ffffff y;'), /colour word that is not a colour/)
        refuses('chat', P('chat-transcript', 'background: #ffffff x;'), /colour word that is not a colour/)
        refuses('chat', P('chat-transcript', `background-image: ${LINE}; background-size: 1em 1em;`), /MC-1555/)
    })
    it('refuses each longhand on a selector that names no part, which can match a protected surface itself (DD-242)', () => {
        for (const area of ['home', 'settings'] as const) {
            for (const decl of ['background-size: 0 0;', 'background-repeat: no-repeat;', 'background-position: 9999px 9999px;', 'background-position-x: 9999px;', 'background-position-y: 9999px;']) {
                refuses(area, `[data-state="open"] { ${decl} }`, /DD-242/)
            }
        }
    })
})

describe('#316 V6: a px or rem max-width of at least 320 px on a reach part', () => {
    it('accepts 320 px and wider, in px or rem, with or without !important, on reach parts of chat and Studio', () => {
        for (const v of ['320px', '20rem', '720px', '45rem', '720px !important']) accepts('chat', P('chat-message-list', `max-width: ${v};`))
        accepts('chat', P('chat-transcript', 'max-width: 720px;'))
        accepts('studio', P('studio-main', 'max-width: 720px;'))
    })
    it('still refuses a narrower or unreadable max-width, and any px width', () => {
        for (const v of ['319px', '19.9rem', '0px']) refuses('chat', P('chat-message-list', `max-width: ${v};`), /can collapse the surface/)
        refuses('chat', P('chat-message-list', 'max-width: calc(400px);'), /calc\(\)/)
        refuses('chat', P('chat-message-list', 'max-width: var(--x);'), /can collapse the surface/)
        refuses('chat', P('chat-message-list', 'width: 720px;'), /a width that can collapse the surface/)
    })
    it('keeps the DD-265 width of a protected sheet and of a selector that names no part', () => {
        refuses('chat', P('chat-sheet', 'max-width: 720px;'), /DD-265/)
        refuses('chat', '[data-layout="x"] { max-width: 720px; }', /DD-265/)
    })
})
