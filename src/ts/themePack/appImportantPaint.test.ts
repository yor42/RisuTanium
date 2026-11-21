// @vitest-environment node
// AP (GUARD, hygiene, MC-2370): the app's own source writes no !important colour or fill. A pack's !important colour or fill on a reach part
// outranks every ordinary app declaration, whatever its selector, layer, order or animation. Only an app !important declaration (or an inline
// !important) can still beat it. A hit fails until the declaration is removed. A miss is a hygiene finding, not a claim.
// The check reads text, not a parse. Its bounds are those of the rules H1-H8 below; any !important spelling or Tailwind important form they do
// not match is named residue of this hygiene check (MC-2390): computed property names, split names or tokens, a priority held in a variable,
// nesting deeper than one level of braces or parentheses, a `>` before the token in a directive value, a directive value held in a variable,
// two-level parentheses in a utility value, a trailing marker on a class-directive name, a Tailwind important flag set outside the scanned
// files, package CSS, user custom CSS, card CSS, V3 plugin styles and files named *.test.*.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalise } from './engine'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SRC = path.resolve(ROOT, 'src')

const PAINT = 'color|background|background-color|background-image|all'
const UTIL = 'text|bg|from|via|to|fill|stroke'

const RULES: [string, RegExp][] = [
    // H1: an important paint declaration anywhere, crossing text without ; { } and one-level {...} groups (interpolations).
    ['H1', new RegExp(String.raw`(?:^|[^\w-])(?:${PAINT})\s*:(?:[^;{}]|\{[^{}]*\})*!\s*important`)],
    // H2: a Svelte style directive with the important modifier, or whose value reaches !important before the end of the tag.
    ['H2', new RegExp(String.raw`style:(?:${PAINT})(?:\|[\w|]*important|(?:\|[\w|]*)?\s*=[^>]*!\s*important)`)],
    // H3: setProperty with a literal important, one level of nested parentheses in the arguments.
    ['H3', /setproperty\s*\((?:[^()]|\([^()]*\))*important/],
    // H4: a leading Tailwind important marker on a paint utility or arbitrary paint property.
    ['H4', new RegExp(String.raw`(?:^|[\s"'\`{(,:])!(?:[a-z0-9_-]+:)*(?:(?:${UTIL})-|\[(?:${PAINT})\s*:)`)],
    // H5: a trailing Tailwind important marker, one level of parentheses in the utility value.
    ['H5', new RegExp(String.raw`(?:^|[\s"'\`{(,:])(?:(?:${UTIL})-(?:[^\s"'\`{}()]|\([^\s"'\`{}()]*\))*|\[(?:${PAINT})\s*:[^\]]*\])!(?=[\s"'\`}),]|$)`)],
    // H6: @apply carrying a marker.
    ['H6', /@apply\b[^;{}]*!/],
    // H7: @import with Tailwind's global important flag.
    ['H7', /@import\b[^;]*\bimportant\b/],
    // H8: a ! inside a paint utility's bracket value.
    ['H8', new RegExp(String.raw`(?:^|[\s"'\`{(,:])(?:${UTIL})-\[[^\]\s"'\`]*!`)],
]

// Every hit, as `<rule>: <matched text, 80 chars>`, from one form of the text.
const hitsOf = (text: string): string[] => {
    const out: string[] = []
    for (const [rule, re] of RULES) {
        const m = re.exec(text)
        if (m) out.push(`${rule}: ${m[0].slice(0, 80)}`)
    }
    return out
}
// Raw (lower-cased) and normalised forms; a hit in either counts. The raw form catches text normalise removes as a false comment span.
const formsOf = (text: string): { raw: string[]; norm: string[] } => {
    const raw = text.toLowerCase()
    return { raw: hitsOf(raw), norm: hitsOf(normalise(text)) }
}
const scan = (text: string): string[] => {
    const f = formsOf(text)
    return [...new Set([...f.raw, ...f.norm])]
}
const rulesOf = (text: string): string[] => scan(text).map((h) => h.split(':')[0])

const isScannedName = (rel: string): boolean => /\.(svelte|css|ts|js|mjs|cjs|html)$/.test(rel) && !path.basename(rel).includes('.test.')

function walk(dir: string, into: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, into)
        else if (isScannedName(entry.name)) into.push(full)
    }
    return into
}
const relativeOf = (file: string): string => path.relative(ROOT, file).replace(/\\/g, '/')

const scanned = [...walk(SRC), path.resolve(ROOT, 'index.html')].map((file) => ({ rel: relativeOf(file), text: fs.readFileSync(file, 'utf8') }))

// The only app !important paint allowed: the canvas yield to the user's own chat background (MC-2939, MC-3005). While the user has a
// background, the chat-shell, chat-transcript and chat-message-list backgrounds must beat any pack paint on those parts, a pack's
// !important included, so the yield is an inline !important by design. Each entry must still hit, so a moved or renamed yield fails here
// instead of leaving a stale exemption; any other hit, in these files or elsewhere, still fails AP1.
const CANVAS_YIELD_EXEMPT = [
    'src/lib/ChatShell/ChatShell.svelte: H2: style:background-color|important',
    'src/lib/ChatShell/ShellMessageList.svelte: H2: style:background-color|important',
    'src/ts/gui/chatBackground.ts: H1: `background: ${colour} !important',
]
// The scan reports one hit per rule per file, so an exemption alone would mask a second important declaration in the same file. Each
// exempt file therefore pins its exact count of important markers: the yield's own declarations and nothing else.
const CANVAS_YIELD_MARKERS: Record<string, number> = {
    'src/lib/ChatShell/ChatShell.svelte': 2,
    'src/lib/ChatShell/ShellMessageList.svelte': 2,
    'src/ts/gui/chatBackground.ts': 1,
}
const importantMarkers = (text: string): number => (text.toLowerCase().match(/[!|]\s*important/g) ?? []).length

describe('AP: the app source writes no important colour or fill', () => {
    it('AP1: the live tree has no hit outside the canvas yield', () => {
        const hits = scanned.flatMap((f) => scan(f.text).map((h) => `${f.rel}: ${h}`))
        expect(hits.filter((h) => !CANVAS_YIELD_EXEMPT.includes(h))).toEqual([])
        expect(CANVAS_YIELD_EXEMPT.filter((h) => !hits.includes(h))).toEqual([])
        const counts = Object.fromEntries(Object.keys(CANVAS_YIELD_MARKERS).map((rel) => [rel, importantMarkers(scanned.find((f) => f.rel === rel)?.text ?? '')]))
        expect(counts).toEqual(CANVAS_YIELD_MARKERS)
    })

    it('AP2: the scan covers the source tree', () => {
        expect(scanned.length).toBeGreaterThanOrEqual(1000)
        expect(scanned.filter((f) => f.rel.endsWith('.svelte')).length).toBeGreaterThanOrEqual(300)
        expect(scanned.filter((f) => f.rel.endsWith('.css')).length).toBeGreaterThanOrEqual(10)
        expect(scanned.some((f) => f.rel === 'index.html')).toBe(true)
        expect(scanned.some((f) => f.rel === 'src/styles.css')).toBe(true)
        expect(scanned.filter((f) => path.basename(f.rel).includes('.test.'))).toEqual([])
    })

    // [label, text, rule that must hit]
    const CATCH: [string, string, string][] = [
        ['css colour', '.a { color: red !important }', 'H1'],
        ['nested with a space', '.a { .b { color: red ! important } }', 'H1'],
        ['layer with upper case', '@layer x { .a { COLOR: red !IMPORTANT } }', 'H1'],
        ['escaped property name', '.a { \\63 olor: red !important }', 'H1'],
        ['comment before the colon', '.a { color/**/: red !important }', 'H1'],
        ['background-image', '.a { background-image: url(x) !important }', 'H1'],
        ['all', '.a { all: unset !important }', 'H1'],
        ['inline style', '<b style="color: red !important">x</b>', 'H1'],
        ['style directive modifier', '<b style:color|important={c}>x</b>', 'H2'],
        ['setProperty literal', "el.style.setProperty('background-color', c, 'important')", 'H3'],
        ['leading marker', '<b class="!text-white">x</b>', 'H4'],
        ['leading marker with a variant', '<b class="hover:!bg-black">x</b>', 'H4'],
        ['trailing marker', '<b class="bg-red-500!">x</b>', 'H5'],
        ['arbitrary property, leading marker', '<b class="![color:red]">x</b>', 'H4'],
        ['arbitrary property, trailing marker', '<b class="[background:red]!">x</b>', 'H5'],
        ['apply with a marker', '.a { @apply text-white!; }', 'H6'],
        ['import with the important flag', '@import "tailwindcss" important;', 'H7'],
        ['script string', "const s = 'color: red !important'", 'H1'],
        ['false comment span (raw form only)', "const a = '/*'; const s = 'color: red !important'; const b = '*/'", 'H1'],
        ['interpolated inline attribute', '<button data-part="chat-send" style="color: {accent} !important">x</button>', 'H1'],
        ['interpolated, no spaces', '<b style="background-color:{bg}!important">x</b>', 'H1'],
        ['interpolated before another declaration', '<b style="background: {c} !important; padding: 2px">x</b>', 'H1'],
        ['template literal cssText', 'el.style.cssText = `color: ${c} !important`', 'H1'],
        ['template literal setAttribute', "el.setAttribute('style', `background:${bg} !important`)", 'H1'],
        ['template literal sheet text', 'sheet.textContent = `[data-part="chat-send"]{color:${c} !important}`', 'H1'],
        ['setProperty with a call argument', "el.style.setProperty('color', pick(c), 'important')", 'H3'],
        ['setProperty with a method call argument', "el.style.setProperty('background-color', theme.get('bg'), 'important')", 'H3'],
        ['camelCase setProperty in a false comment span (raw form only)', "const a = '/*'; el.style.setProperty('color', c, 'important'); const b = '*/'", 'H3'],
        ['D1 directive value', '<button data-part="chat-send" style:color="red !important">x</button>', 'H2'],
        ['D2 directive value with interpolation', '<button data-part="chat-send" style:background-color="{accent} !important">x</button>', 'H2'],
        ['D3 directive template value', '<button data-part="chat-send" style:color={`${accent} !important`}>x</button>', 'H2'],
        ['D4 directive value, no space', '<b style:background="{c}!important">x</b>', 'H2'],
        ['T1 parenthesised value', '<b class="bg-(--x)!">x</b>', 'H5'],
        ['T2 bracket variable', '<b class="bg-[var(--x)]!">x</b>', 'H5'],
        ['T3 variant with a parenthesised value', '<b class="hover:text-(--risu-theme-textcolor)!">x</b>', 'H5'],
        ['T4 bang inside a bracket value', '<b class="bg-[red!important]">x</b>', 'H8'],
        ['T5 bang inside a bracket value with underscore', '<b class="text-[red_!important]">x</b>', 'H8'],
    ]
    it('AP3: each rule catches its spellings', () => {
        expect(CATCH.length).toBe(37)
        for (const [label, text, rule] of CATCH) {
            expect(rulesOf(text), label).toContain(rule)
        }
    })

    it('AP3: the raw form catches what normalise removes as a false comment span', () => {
        for (const text of [
            "const a = '/*'; const s = 'color: red !important'; const b = '*/'",
            "const a = '/*'; el.style.setProperty('color', c, 'important'); const b = '*/'",
        ]) {
            const f = formsOf(text)
            expect(f.norm).toEqual([])
            expect(f.raw.length).toBeGreaterThan(0)
        }
    })

    const PASS: [string, string][] = [
        ['custom property', '.a { --x-color: red !important }'],
        ['border-color', '.a { border-color: red !important }'],
        ['scrollbar-color', '.a { scrollbar-color: red !important }'],
        ['text fill', '.a { -webkit-text-fill-color: red !important }'],
        ['non-paint important', '.a { animation: none !important }'],
        ['inline non-paint important', '<b style="display:block !important">x</b>'],
        ['plain utilities', '<b class="text-white bg-black bg-red-500 text-sm">x</b>'],
        ['negated expression', '{#if !isOpen}x{/if}'],
        ['plain colour', '.a { color: red }'],
        ['N1 directive without importance', '<b style:color={c} class="x">x</b>'],
        ['N2 custom property directive', '<b style:--x="red !important">x</b>'],
        ['N3 border-color directive', '<b style:border-color="red !important">x</b>'],
        ['N4 plain parenthesised utilities', '<b class="bg-(--x) text-[var(--y)]">x</b>'],
        ['N5 negation beside a plain utility', '<b class={!on ? "bg-(--x)" : ""}>x</b>'],
    ]
    it('AP4: non-paint, other properties and plain forms pass', () => {
        expect(PASS.length).toBe(14)
        for (const [label, text] of PASS) {
            expect(scan(text), label).toEqual([])
        }
    })

    it('AP5: the file filter reads source and skips test files', () => {
        expect(isScannedName('SendStub.svelte')).toBe(true)
        expect(isScannedName('Thing.svelte.test.ts')).toBe(false)
        expect(isScannedName('a.ts')).toBe(true)
        expect(isScannedName('index.html')).toBe(true)
        expect(isScannedName('styles.css')).toBe(true)
        expect(isScannedName('notes.md')).toBe(false)
    })
})
