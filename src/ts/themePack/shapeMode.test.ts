// @vitest-environment node
// Shape mode (MC-3003): the allowlisted strip of a judged chat sheet. T5 pins exact output strings, T5b pins the token and
// property partition, T6 shows that the stripped text of every real producer and every hostile row still passes the judge
// and carries no paint.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { allowedTokenNames } from './appThemeNames'
import { BUILTIN_PACKS } from './builtins'
import { classify, decls } from './csslit'
import { judgeAreaSheet } from './index'
import { PROP_ALLOW, isAllowedProperty } from './scope'
import { SHAPE_PROPERTY, SHAPE_TOKEN_NAMES, shapeOnlySheet, shapeTokenNames } from './shapeMode'
import { tokenFile } from './tokens'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

// The reference fixture data modules (plain JS) are read as data by URL from the repository root.
type Named = [string, string]
interface Hostile { HOSTILE: Named[], HOSTILE_2: Named[], HOSTILE_3: Named[], BENIGN: Named[], BENIGN_2: Named[] }
interface Benign { NEW_BENIGN: Record<string, Named[]> }
interface Values { ACCEPT: Record<string, [string]> }
const loadData = async <T,>(rel: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(path.resolve(ROOT, 'docs/design', rel)).href)) as T
const hostile = await loadData<Hostile>('chat/checks/th/packlint-hostile.mjs')
const benign = await loadData<Benign>('theme/checks/fixtures/benign.mjs')
const values = await loadData<Values>('chat/checks/th/packlint-values.mjs')

describe('T5 shapeOnlySheet', () => {
    const rows: Array<[string, string, string]> = [
        ['P5 token background and a literal text colour', '[data-part="chat-send"]{background:var(--nexus-surface);color:#000}', '[data-part="chat-send"]{}'],
        ['P1 text colour from an app token', '[data-part="chat-message"]{color:var(--nexus-warm) !important}', '[data-part="chat-message"]{}'],
        ['P3 colour token remapped through another token', ':root{--color-on-accent:var(--nexus-canvas-bloom)}', ':root{}'],
        ['P6 pack channel helpers stay, their consumers go', ':root{--pack-ink:255 0 0;--pack-fill:0 0 255}[data-part="chat-send"]{color:rgb(var(--pack-ink));background:rgb(var(--pack-fill))}', ':root{--pack-ink:255 0 0;--pack-fill:0 0 255}[data-part="chat-send"]{}'],
        ['an app colour token remapped to another token', ':root{--nexus-warm:var(--nexus-accent)}', ':root{}'],
        ['a shape token and a pack helper that a kept radius reads', ':root{--radius-control:8px;--pack-r:8px}[data-part="chat-send"]{border-radius:var(--pack-r)}', ':root{--radius-control:8px;--pack-r:8px}[data-part="chat-send"]{border-radius:var(--pack-r)}'],
        ['the border shorthand goes, width and style stay', '[data-part="chat-send"]{border:1px solid #ccc;border-width:2px;border-style:dashed}', '[data-part="chat-send"]{border-width:2px;border-style:dashed}'],
        ['a border colour longhand goes', '[data-part="chat-send"]{border-top-color:red;border-top-width:2px}', '[data-part="chat-send"]{border-top-width:2px}'],
        ['an image and a gradient go (MC-3003)', '[data-part="chat-send"]{background-image:url("blob:x");background:linear-gradient(red,blue);opacity:.5}', '[data-part="chat-send"]{opacity:.5}'],
        ['a list marker image goes, the rest of the rule stays', '[data-part="chat-message"]{list-style:url(a.png) inside;line-height:1.4}', '[data-part="chat-message"]{line-height:1.4}'],
        ['a list marker read from a helper goes', '[data-part="chat-message"]{list-style:var(--pack-m);line-height:1.4}', '[data-part="chat-message"]{line-height:1.4}'],
        ['a plain list style stays', '[data-part="chat-message"]{list-style:none}', '[data-part="chat-message"]{list-style:none}'],
        ['@font-face is kept whole, its source included', "@font-face{font-family:'pack-a';src:url(f.woff2) format('woff2')}", "@font-face{font-family:'pack-a';src:url(f.woff2) format('woff2')}"],
        ['a forced-colors colour goes, its geometry stays', '@media (forced-colors:active){[data-part="chat-send"]{color:CanvasText;border-width:2px}}', '@media (forced-colors:active){[data-part="chat-send"]{border-width:2px}}'],
        ['opacity stays', '[data-part="chat-send"]{opacity:0.5}', '[data-part="chat-send"]{opacity:0.5}'],
        ['color-scheme goes, a shape token stays', ':root{color-scheme:light;--radius-control:8px}', ':root{--radius-control:8px}'],
        ['the first of two declarations goes with its semicolon', '[data-part="chat-send"]{color:#000;opacity:1}', '[data-part="chat-send"]{opacity:1}'],
        ['the last of two declarations leaves the first untouched', '[data-part="chat-send"]{opacity:1;color:#000}', '[data-part="chat-send"]{opacity:1;}'],
        ['the middle of three declarations', '[data-part="chat-send"]{opacity:1;color:#000;cursor:pointer}', '[data-part="chat-send"]{opacity:1;cursor:pointer}'],
        ['a root selector list of :root and html is a root rule', ':root,html{--nexus-text:#fff;--font-size-md:14px}', ':root,html{--font-size-md:14px}'],
        ['a nested media block loses only its paint', '@media (min-width:600px){[data-part="chat-send"]{padding:4px;color:red}}', '@media (min-width:600px){[data-part="chat-send"]{padding:4px;}}'],
        ['an app token set in a part rule follows the root test', '[data-part="chat-send"]{--nexus-warm:#fff;--radius-control:4px}', '[data-part="chat-send"]{--radius-control:4px}'],
        ['text-decoration colour and shorthand go, the style longhand stays', '[data-part="chat-message"]{text-decoration:underline red;text-decoration-color:red;text-decoration-style:dotted}', '[data-part="chat-message"]{text-decoration-style:dotted}'],
        ['a stroke colour and fill go, the stroke width stays', '[data-part="chat-icon"]{fill:red;stroke:blue;stroke-width:2}', '[data-part="chat-icon"]{stroke-width:2}'],
        ['shadows go', '[data-part="chat-send"]{box-shadow:0 0 4px red;text-shadow:0 0 2px red}', '[data-part="chat-send"]{}'],
    ]
    it.each(rows)('%s', (_name, input, expected) => {
        expect(shapeOnlySheet(input)).toBe(expected)
    })

    it('keeps the geometry of a real built-in and drops its canvas', () => {
        const scratch = BUILTIN_PACKS.find((pack) => pack.slug === 'scratch-white')
        if (scratch === undefined) throw new Error('scratch-white is missing')
        const canonical = judgeAreaSheet('chat', scratch.chatCss).canonical
        const shape = shapeOnlySheet(canonical)
        expect(shape).toContain('--pack-paper: #fdfdfa')
        expect(shape).toContain('--radius-bubble')
        expect(shape).not.toMatch(/--nexus-canvas\s*:/)
        expect(shape).not.toMatch(/--color-scheme\s*:/)
        expect(shape).not.toMatch(/(^|[^-\w])(background[\w-]*|color)\s*:/)
        expect(shape.length).toBeLessThan(canonical.length)
    })

    it('never adds a character and is deterministic', () => {
        for (const pack of BUILTIN_PACKS) {
            const canonical = judgeAreaSheet('chat', pack.chatCss).canonical
            const once = shapeOnlySheet(canonical)
            expect(shapeOnlySheet(canonical)).toBe(once)
            const kept = canonical.split('')
            let cursor = 0
            for (const ch of once) {
                while (cursor < kept.length && kept[cursor] !== ch) cursor++
                expect(cursor < kept.length, 'the output is a subsequence of the input').toBe(true)
                cursor++
            }
        }
    })

    it('gives an empty sheet for an empty sheet and applies nothing for a walker throw', () => {
        expect(shapeOnlySheet('')).toBe('')
        expect(shapeOnlySheet('@{}')).toBe('')
    })
})

describe('T5b the shape token and property partition', () => {
    const allowed = allowedTokenNames('chat')
    const nameOf = (text: string): Map<string, string> => {
        const map = new Map<string, string>()
        for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) map.set(m[1], m[2].trim())
        return map
    }
    const appValues = new Map([...nameOf(tokenFile('theme/nexus-tokens.css')), ...nameOf(tokenFile('chat/theme-tokens.css'))])
    const expand = (value: string, seen: Set<string>, depth = 0): string => {
        if (depth > 12) return value
        return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (whole: string, name: string, fallback: string | undefined) => {
            seen.add(name)
            const known = appValues.get(name)
            return known !== undefined ? expand(known, seen, depth + 1) : (fallback !== undefined ? expand(fallback, seen, depth + 1) : whole)
        })
    }

    const COMPLEMENT = [
        '--alpha-switch-off', '--caret-color', '--chat-speaker-0', '--chat-speaker-1', '--chat-speaker-2', '--chat-speaker-3', '--chat-speaker-4', '--chat-speaker-5', '--chat-speaker-6', '--chat-speaker-7', '--color-accent-soft', '--color-accent-tint', '--color-accent-tint-faint', '--color-accent-tint-strong', '--color-avatar-group-text', '--color-bubble-char', '--color-bubble-char-text', '--color-bubble-user', '--color-bubble-user-text', '--color-code-bg', '--color-code-bg-inline', '--color-danger-edge', '--color-danger-edge-soft', '--color-danger-edge-strong', '--color-danger-tint', '--color-field', '--color-hit', '--color-hit-bg', '--color-hit-rgb', '--color-hue-blue-from', '--color-hue-blue-to', '--color-hue-gold-from', '--color-hue-gold-to', '--color-hue-green-from', '--color-hue-green-to', '--color-hue-rose-from', '--color-hue-rose-to', '--color-hue-violet-from', '--color-hue-violet-to', '--color-key', '--color-knob', '--color-on-accent', '--color-on-avatar', '--color-on-brand', '--color-placeholder', '--color-scheme', '--color-scope-all-bg', '--color-scope-all-edge', '--color-scope-all-rgb', '--color-scope-all-text', '--color-scope-character-bg', '--color-scope-character-edge', '--color-scope-character-rgb', '--color-scope-character-text', '--color-scrim', '--color-shimmer', '--color-skeleton', '--color-skeleton-line', '--color-surface-bar', '--color-surface-kbd', '--color-surface-sheet', '--color-surface-toast', '--color-switch-off', '--color-syntax-keyword', '--color-tint-faint', '--color-tint-strong', '--color-tint-tile', '--color-warning', '--color-zone-edge', '--danger', '--nexus-accent', '--nexus-accent-rgb', '--nexus-blur', '--nexus-canvas', '--nexus-canvas-bloom', '--nexus-canvas-warm', '--nexus-core-from', '--nexus-core-to', '--nexus-danger', '--nexus-danger-rgb', '--nexus-edge', '--nexus-edge-strong', '--nexus-field-border', '--nexus-network-link', '--nexus-network-node', '--nexus-overlay-rgb', '--nexus-ring', '--nexus-shade-rgb', '--nexus-success-rgb', '--nexus-surface', '--nexus-surface-flat', '--nexus-surface-raised', '--nexus-text', '--nexus-text-muted', '--nexus-text-secondary', '--nexus-warm', '--nexus-warm-from', '--nexus-warm-rgb', '--nexus-warm-to', '--nexus-warning-rgb', '--opacity-dim', '--opacity-soft', '--scrollbar-color', '--selection-bg', '--selection-text',
    ]

    it('every listed token is a name a chat pack may set (the intersection rule)', () => {
        const outside = [...SHAPE_TOKEN_NAMES].filter((name) => !allowed.has(name))
        expect(outside).toEqual([])
    })

    it('the settable names that are not listed equal the reviewed paint snapshot, so a new token must be classified', () => {
        const complement = [...allowed].filter((name) => !SHAPE_TOKEN_NAMES.has(name)).sort()
        expect(complement).toEqual([...COMPLEMENT].sort())
    })

    it('every listed token has an app value with no colour, channel triplet, image or scheme reference', () => {
        const problems: string[] = []
        for (const name of SHAPE_TOKEN_NAMES) {
            const raw = appValues.get(name)
            if (raw === undefined) {
                problems.push(`${name}: no value in the docs/design token files`)
                continue
            }
            const seen = new Set<string>()
            const value = expand(raw, seen)
            const hits = decls(`x{${name}:${value}}`).flatMap((decl) => classify(decl)).filter((hit) => hit.kind === 'colour')
            if (hits.length > 0) problems.push(`${name}: colour ${hits[0].lit}`)
            if (/^\s*-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s*$/.test(value)) problems.push(`${name}: a channel triplet`)
            if (/url\(/i.test(value)) problems.push(`${name}: an image`)
            for (const ref of seen) {
                if (ref.startsWith('--risu-theme-')) problems.push(`${name}: reads ${ref}`)
                if (allowed.has(ref) && !SHAPE_TOKEN_NAMES.has(ref)) problems.push(`${name}: reads the paint token ${ref}`)
            }
            if (/--risu-theme-/.test(value)) problems.push(`${name}: reads a scheme variable`)
        }
        expect(problems).toEqual([])
    })

    const PROBES = [
        'color', 'opacity', 'visibility', 'cursor', 'pointer-events', 'user-select', '-webkit-user-select', 'accent-color', 'caret-color', 'scrollbar-color', 'scrollbar-width', 'color-scheme', 'fill', 'stroke', 'stroke-width', 'box-shadow', 'text-shadow',
        'background', 'background-color', 'background-image', 'background-position', 'background-position-x', 'background-size', 'background-repeat', 'background-clip', 'background-origin',
        'border', 'border-top', 'border-block', 'border-inline-start', 'border-width', 'border-style', 'border-color', 'border-top-width', 'border-top-style', 'border-top-color', 'border-block-start-width', 'border-inline-end-color', 'border-radius', 'border-top-left-radius', 'border-start-start-radius',
        'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'font-variant-caps', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-synthesis', 'font-optical-sizing',
        'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness', 'text-underline-offset', 'text-transform', 'text-indent', 'text-overflow', 'text-wrap', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'tab-size', 'vertical-align', 'list-style', 'list-style-type', 'list-style-position', '-webkit-line-clamp', 'text-rendering',
        'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'inset-block-start', 'float', 'clear', 'box-sizing', 'aspect-ratio', 'object-fit', 'object-position', 'clip', 'overflow', 'overflow-x',
        'width', 'height', 'min-width', 'max-height', 'block-size', 'inline-size', 'margin', 'margin-top', 'margin-inline-start', 'padding', 'padding-block-end',
        'gap', 'row-gap', 'order', 'flex', 'flex-grow', 'align-items', 'justify-content', 'place-items', 'grid', 'grid-template-columns', 'grid-area',
        'border-collapse', 'border-spacing', 'table-layout', 'caption-side', 'empty-cells',
        'transform', 'transition', 'animation', 'filter', 'backdrop-filter', 'mix-blend-mode', 'outline', 'outline-color', 'column-rule-color', 'content', 'mask', 'border-image', 'text-fill-color', '-webkit-text-fill-color',
    ]

    it('SHAPE_PROPERTY is a subset of the judge allowlist and matches no paint property', () => {
        const PAINT = /color|background|shadow|^fill$|^stroke$|^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/
        const matched = PROBES.filter((prop) => SHAPE_PROPERTY.some((pattern) => pattern.test(prop)))
        expect(matched.length).toBeGreaterThan(60)
        expect(matched.filter((prop) => !isAllowedProperty(prop))).toEqual([])
        expect(matched.filter((prop) => PAINT.test(prop))).toEqual([])
        expect(PROP_ALLOW.length).toBeGreaterThan(0)
    })

    it('pins the paint side of the allowlist: every probe that is allowed and not shape is paint', () => {
        const stripped = PROBES.filter((prop) => isAllowedProperty(prop) && !SHAPE_PROPERTY.some((pattern) => pattern.test(prop)))
        expect(stripped.sort()).toEqual([
            'accent-color', 'background', 'background-clip', 'background-color', 'background-image', 'background-origin', 'background-position', 'background-position-x', 'background-size', 'background-repeat',
            'border', 'border-block', 'border-color', 'border-inline-end-color', 'border-inline-start', 'border-top', 'border-top-color',
            'box-shadow', 'caret-color', 'color', 'color-scheme', 'fill', 'scrollbar-color', 'stroke', 'text-decoration', 'text-decoration-color', 'text-shadow',
        ].sort())
    })
})

describe('T6 the stripped text of every real producer and hostile row is judged and carries no paint', () => {
    interface Input { label: string, css: string, requireOk: boolean }
    const inputs: Input[] = []

    for (const pack of BUILTIN_PACKS) inputs.push({ label: `built-in ${pack.slug}`, css: pack.chatCss, requireOk: true })
    for (const file of ['origin-navy.risutheme', 'banana-cocoa.risutheme']) {
        const files = unzipSync(new Uint8Array(readFileSync(new URL(`./goldens/${file}`, import.meta.url))))
        const key = Object.keys(files).find((name) => name.endsWith('chat.css'))
        if (key === undefined) throw new Error(`${file} holds no chat.css`)
        inputs.push({ label: `golden ${file}`, css: strFromU8(files[key]), requireOk: true })
    }
    // The hostile rows are sheets the full judge may refuse; the stripped variant must be judged on its own all the same.
    const HOSTILE_ROWS: Array<[string, string]> = [
        ['P1', '[data-part="chat-send"]{color:var(--nexus-warm) !important}'],
        ['P3', ':root{--color-on-accent:var(--nexus-canvas-bloom)}'],
        ['P5', '[data-part="chat-send"]{background-color:var(--nexus-accent) !important;color:#000000 !important}'],
        ['P6', ':root{--pack-ink:255 0 0;--pack-fill:20 20 20}[data-part="chat-send"]{background-color:rgb(var(--pack-fill)) !important;color:rgb(var(--pack-ink)) !important}'],
    ]
    for (const [id, css] of HOSTILE_ROWS) inputs.push({ label: `hostile ${id}`, css, requireOk: true })

    // Corpus sheets: only an accepted chat sheet can ever reach shape mode, so only those are required to stay accepted.
    for (const group of ['HOSTILE', 'HOSTILE_2', 'HOSTILE_3', 'BENIGN', 'BENIGN_2'] as const) for (const [n, css] of hostile[group]) inputs.push({ label: `${group} ${n}`, css, requireOk: false })
    for (const [n, css] of benign.NEW_BENIGN.chat ?? []) inputs.push({ label: `NEW_BENIGN chat ${n}`, css, requireOk: false })
    for (const [key, [css]] of Object.entries(values.ACCEPT)) inputs.push({ label: `values ACCEPT ${key}`, css, requireOk: false })

    function paintIn(stripped: string): string[] {
        const found: string[] = []
        for (const decl of decls(stripped)) {
            if (decl.ctx.at.some((prelude) => /^@font-face\b/i.test(prelude))) continue
            if (decl.prop.startsWith('--')) {
                if (!SHAPE_TOKEN_NAMES.has(decl.prop) && !decl.prop.startsWith('--pack-')) found.push(`${decl.prop} (a custom property)`)
            } else if (!SHAPE_PROPERTY.some((pattern) => pattern.test(decl.prop))) {
                found.push(decl.prop)
            } else if (/url\(|-gradient\(/i.test(decl.value)) {
                found.push(`${decl.prop} (an image)`)
            }
        }
        return found
    }

    it('reads a corpus of real producers and hostile rows', () => {
        expect(inputs.length).toBeGreaterThan(40)
        expect(inputs.filter((input) => input.requireOk)).toHaveLength(BUILTIN_PACKS.length + 2 + HOSTILE_ROWS.length)
    })

    it('every stripped variant that stands for an accepted sheet is judged ok and carries no paint', () => {
        const refused: string[] = []
        const painted: string[] = []
        let checked = 0
        for (const input of inputs) {
            const full = judgeAreaSheet('chat', input.css)
            if (!input.requireOk && !full.result.ok) continue
            const canonical = full.canonical !== '' ? full.canonical : input.css
            const stripped = shapeOnlySheet(canonical)
            checked++
            const judged = judgeAreaSheet('chat', stripped)
            if (!judged.result.ok) refused.push(`${input.label}: ${judged.result.errors.map((error) => error.why).join(' | ').slice(0, 160)}`)
            const paint = paintIn(stripped)
            if (paint.length > 0) painted.push(`${input.label}: ${paint.slice(0, 3).join(', ')}`)
        }
        expect(checked).toBeGreaterThan(20)
        expect(refused).toEqual([])
        expect(painted).toEqual([])
    })
})

describe('S1 the studio shape token list (MC-3121)', () => {
    const STUDIO_GEOMETRY = ['--studio-form-row-height', '--studio-size-touch', '--studio-tree-width']
    const studioSources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return studioSources(full)
        return entry.name.endsWith('.svelte') ? [full] : []
    })
    // A Tailwind arbitrary-value utility that sets a size, gap or inset and nothing painted.
    const GEOMETRY_UTILITY = /^(?:[\w!-]+:)*(?:w|h|min-w|min-h|max-w|max-h|size|gap|basis|p|px|py|m|mx|my)-\[/

    it('the chat list is the pinned set itself', () => {
        expect(shapeTokenNames('chat')).toBe(SHAPE_TOKEN_NAMES)
    })

    it('the studio list is the chat list intersected with the studio names plus the live geometry names, all settable and no paint family', () => {
        const allowed = allowedTokenNames('studio')
        const names = shapeTokenNames('studio')
        const expected = new Set([...SHAPE_TOKEN_NAMES].filter((name) => allowed.has(name)))
        for (const name of STUDIO_GEOMETRY) expected.add(name)
        expect([...names].sort()).toEqual([...expected].sort())
        expect([...names].filter((name) => !allowed.has(name))).toEqual([])
        expect([...names].filter((name) => !SHAPE_TOKEN_NAMES.has(name)).sort()).toEqual(STUDIO_GEOMETRY)
        expect([...names].filter((name) => /color|colour|-rgb$|^--opacity-|^--alpha-|shadow|selection|^--nexus-(canvas|surface|text|accent|warm|edge)/.test(name))).toEqual([])
    })

    it('every studio geometry name is read in src/lib/Studio only as the size of a geometry utility', () => {
        const seen = new Map<string, number>()
        const outside: string[] = []
        for (const file of studioSources(path.join(ROOT, 'src/lib/Studio'))) {
            const text = readFileSync(file, 'utf8')
            for (const match of text.matchAll(/var\(\s*(--studio-(?:tree-width|size-touch|form-row-height))\b/g)) {
                const name = match[1]
                seen.set(name, (seen.get(name) ?? 0) + 1)
                const token = text.slice(0, match.index).split(/[\s"'`]/).pop() ?? ''
                if (!GEOMETRY_UTILITY.test(token)) outside.push(`${path.relative(ROOT, file)}: ${name} in ${token}`)
            }
        }
        expect([...seen.keys()].sort()).toEqual(STUDIO_GEOMETRY)
        expect(outside).toEqual([])
    })

    it('the studio list keeps a studio geometry token that the chat list drops', () => {
        const sheet = ':root{--studio-size-touch:40px;--nexus-text:#fff}'
        expect(shapeOnlySheet(sheet, shapeTokenNames('studio'))).toBe(':root{--studio-size-touch:40px;}')
        expect(shapeOnlySheet(sheet)).toBe(':root{}')
    })
})