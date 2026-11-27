// @vitest-environment node

/**
 * The Nexus stylesheet imports are purely additive. The frozen copy of the pre-UI-S0
 * `src/styles.css` and the live file are compiled by Tailwind exactly as the Vite plugin
 * does; the pre output must reappear in order inside the post output, and every added
 * line must belong to a `nexus`-named rule or to a custom property the pre output never
 * declares. A later change that edits `src/styles.css` on purpose re-baselines the fixture
 * and `BASE_STYLES_BLOB` in the same diff.
 *
 * S2 (MC-3128): the Tailwind radius and hairline scale reads the --ui-* app shape tokens, whose defaults equal the pre theme
 * values. `s2Remapped` resolves the eleven remapped Tailwind names on the pre side and the ten --ui-* names on the post side,
 * each against its own output's declarations, so the two sides compare by resolved value: a changed default, a wrong mapping or
 * a plain `@theme` leaves lines unmatched. Nothing else is resolved and no other theme name may be absent.
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

const BASE_STYLES_BLOB = '1cc4baee4c023a1f146ac060f9ac40441cff494a'

// Files and folders UI-S0 adds that Tailwind scans. The pre side negates them so it
// approximates the scan set before UI-S0; the post side scans everything.
const S0_NEW_PATHS = [
    'src/lib/Nexus',
    'src/styles',
    'src/ts/gui/nexusColorScheme.ts',
    'src/ts/gui/nexusColorScheme.test.ts',
    'src/ts/gui/colorscheme.nexusHidden.test.ts',
    'src/lib/Setting/Pages/Display/ColorSchemeSelect.nexusHidden.svelte.test.ts',
    'src/ts/patternPromptAnswer.ts',
]

// Selectors of utilities that UI-S0 may add without a `nexus` class. Every entry needs a stated reason.
const S0_NEW_UTILITIES: string[] = []

interface ScanSource { base: string, pattern: string, negated: boolean }
interface TailwindCompiler {
    sources: { base: string, pattern: string, negated: boolean }[]
    root: 'none' | null | { base: string, pattern: string }
    build(candidates: string[]): string
}
interface TailwindNode {
    compile(css: string, opts: { base: string, onDependency: (file: string) => void }): Promise<TailwindCompiler>
}
interface TailwindOxide {
    Scanner: new (opts: { sources: ScanSource[] }) => { scan(): string[] }
}

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const fixturePath = path.join(root, 'src/styles/tests/cssBaseline/styles.pre-ui-s0.css')
const livePath = path.join(root, 'src/styles.css')

async function loadTailwind() {
    const viteRequire = createRequire(realpathSync(path.join(root, 'node_modules/@tailwindcss/vite/package.json')))
    const node = await import(/* @vite-ignore */ pathToFileURL(viteRequire.resolve('@tailwindcss/node')).href) as TailwindNode
    const oxide = await import(/* @vite-ignore */ pathToFileURL(viteRequire.resolve('@tailwindcss/oxide')).href) as TailwindOxide
    return { compile: node.compile, Scanner: oxide.Scanner }
}

// A fresh compiler per side: `build()` accumulates candidates across calls.
async function compileSide(cssText: string, negatedPaths: string[]): Promise<string[]> {
    const { compile, Scanner } = await loadTailwind()
    const compiler = await compile(cssText, { base: path.join(root, 'src'), onDependency: () => {} })
    const own: ScanSource[] = compiler.root === 'none'
        ? []
        : compiler.root === null
            ? [{ base: root, pattern: '**/*', negated: false }]
            : [{ ...compiler.root, negated: false }]
    const sources: ScanSource[] = [
        ...own,
        ...compiler.sources,
        ...negatedPaths.map((p) => ({ base: root, pattern: p, negated: true })),
    ]
    const candidates = new Scanner({ sources }).scan()
    return compiler.build(candidates).split(/\r?\n/)
}

function gitBlobId(text: string): string {
    const body = Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')
    return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex')
}

function unmatchedPreLines(pre: string[], post: string[]): { unmatched: string[], added: boolean[] } {
    const added = post.map(() => true)
    const unmatched: string[] = []
    let at = 0
    for (const line of pre) {
        let found = -1
        for (let i = at; i < post.length; i++) {
            if (post[i] === line) { found = i; break }
        }
        if (found < 0) {
            unmatched.push(line)
        } else {
            added[found] = false
            at = found + 1
        }
    }
    return { unmatched, added }
}

const WRAPPERS = [
    /^:root$/,
    /^:root, :host$/,
    /^html\[data-input="hover"\]$/,
    // The device reduce-motion setting scopes token overrides on the root: on (`rm`) and the OS rule stepping aside for off (`rm-off`).
    /^:root\.rm$/,
    /^:root:not\(\.rm-off\)$/,
    // The theme pack's fixed base: the gate sets the root attribute while a pack sheet is on, and these rules restore the judged reference.
    /^:root:where\(\[data-theme-pack-base\]\)$/,
    // The own-scheme island (ownScheme.svelte.ts) re-declares each root block, so those blocks also match the island and its state variants.
    /^:root, \[data-own-scheme\]$/,
    /^:root\.rm, :root\.rm \[data-own-scheme\]$/,
    /^:root:not\(\.rm-off\), :root:not\(\.rm-off\) \[data-own-scheme\]$/,
    /^html\[data-input="hover"\], html\[data-input="hover"\] \[data-own-scheme\]$/,
    /^@media /,
    /^@layer [\w-]+$/,
    /^@supports /,
]
const NEXUS_CLASS = /\.(?:[\w\\:/[\]%.-]*?-)?nexus-/

function splitTopLevel(selector: string): string[] {
    const parts: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of selector) {
        if (ch === '(' || ch === '[') depth++
        if (ch === ')' || ch === ']') depth--
        if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else { cur += ch }
    }
    parts.push(cur.trim())
    return parts
}

function isWrapper(head: string): boolean {
    return WRAPPERS.some((w) => w.test(head))
}

// A rule whose every selector is the own-scheme island itself (optionally a descendant of it) changes nothing outside an island, so it is allowed to add any declaration. Sibling combinators are refused because they select elements outside the island.
const ISLAND_SELECTOR = /^(\[data-own-scheme(="[\w-]+")?\]( [\w.#:\[\]="*>() -]+)?|:is\(\[data-own-scheme="[\w-]+"\], \[data-own-scheme="[\w-]+"\] \*\)(:[\w-]+)*)$/

function isNexusHead(head: string): boolean {
    if (head.startsWith('@keyframes ')) return head.startsWith('@keyframes nexus-')
    if (head.startsWith('@property ')) return head.startsWith('@property --nexus-')
    if (head.startsWith('@')) return false
    return splitTopLevel(head).every((part) => NEXUS_CLASS.test(part) || ISLAND_SELECTOR.test(part))
}

function declaredNames(lines: string[]): Set<string> {
    const names = new Set<string>()
    for (const line of lines) {
        const m = /^\s*(--[\w-]+)\s*:/.exec(line)
        if (m) names.add(m[1])
    }
    return names
}

function disallowedAddedLines(pre: string[], post: string[], added: boolean[]): string[] {
    const preNames = declaredNames(pre)
    const bad: string[] = []
    const stack: { head: string, trusted: boolean }[] = []
    let inComment = false
    post.forEach((raw, i) => {
        const line = raw.trim()
        const isAdded = added[i]
        if (inComment) {
            if (line.includes('*/')) inComment = false
            return
        }
        if (line.startsWith('/*')) {
            if (!line.includes('*/')) inComment = true
            return
        }
        if (line === '') return
        if (line.endsWith('{')) {
            const head = line.slice(0, -1).trim()
            const inNexus = stack.some((f) => f.trusted)
            const keyframeStop = inNexus && /^(from|to|\d+(\.\d+)?%)(, *(from|to|\d+(\.\d+)?%))*$/.test(head)
            const trusted = isNexusHead(head) || S0_NEW_UTILITIES.includes(head) || keyframeStop
            if (isAdded && !(isWrapper(head) || trusted)) bad.push(line)
            stack.push({ head, trusted })
            return
        }
        if (line === '}') {
            stack.pop()
            return
        }
        if (!isAdded) return
        if (stack.some((f) => f.trusted)) return
        const prop = /^(--[\w-]+)\s*:/.exec(line)
        if (prop && stack.length > 0 && stack.every((f) => isWrapper(f.head)) && !preNames.has(prop[1])) return
        bad.push(line)
    })
    return bad
}

const SCALE_STEPS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']
// The Tailwind names the S2 scale remaps: eleven theme variables, present only on the pre side.
const S2_REMAPPED_TW = [...SCALE_STEPS.map((step) => `--radius-${step}`), '--radius', '--default-border-width', '--border-width-1']
// The app shape tokens they now read, declared in nexus-tokens.css with the pre values as defaults.
const S2_APP = [...SCALE_STEPS.map((step) => `--ui-radius-${step}`), '--ui-radius', '--ui-border-width']

function declaredValues(lines: string[], names: readonly string[]): Map<string, string> {
    const wanted = new Set(names)
    const values = new Map<string, string>()
    for (const line of lines) {
        const m = /^\s*(--[\w-]+)\s*:\s*(.*?);\s*$/.exec(line)
        if (!m || !wanted.has(m[1])) continue
        if (values.has(m[1]) && values.get(m[1]) !== m[2]) throw new Error(`${m[1]} is declared twice with different values`)
        values.set(m[1], m[2])
    }
    return values
}

// Exactly `var(--name)`: a reference with a fallback is never resolved.
function resolveNames(line: string, values: Map<string, string>): string {
    return line.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => values.get(name) ?? whole)
}

/**
 * Brings both sides to resolved values. Pre: the eleven Tailwind names read their own declared value, and their declaration
 * lines may be absent from the post side. Post: the ten --ui-* names read the value the post output declares. `complete`
 * (default) fails when the post output declares no default for one of the ten.
 */
function s2Remapped(pre: string[], post: string[], complete = true): { pre: string[], post: string[] } {
    const preValues = declaredValues(pre, S2_REMAPPED_TW)
    const postValues = declaredValues(post, S2_APP)
    const missing = S2_APP.filter((name) => !postValues.has(name))
    if (complete && missing.length > 0) throw new Error(`the post output declares no default for ${missing.join(', ')}`)
    const absent = new Set(S2_REMAPPED_TW)
    return {
        pre: pre.filter((line) => {
            const m = /^\s*(--[\w-]+)\s*:/.exec(line)
            return !(m && absent.has(m[1]))
        }).map((line) => resolveNames(line, preValues)),
        post: post.map((line) => resolveNames(line, postValues)),
    }
}

describe('UI-S0 stylesheet imports are additive', () => {
    test('T-CSS-0: the frozen baseline is the base blob of src/styles.css', () => {
        expect(gitBlobId(readFileSync(fixturePath, 'utf8'))).toBe(BASE_STYLES_BLOB)
    })

    test('T-CSS-1: the pre output reappears in order and every added line is allowed', async () => {
        const pre = await compileSide(readFileSync(fixturePath, 'utf8'), S0_NEW_PATHS)
        const compiledPost = await compileSide(readFileSync(livePath, 'utf8'), [])
        expect(pre.length).toBeGreaterThan(1000)
        const same = s2Remapped(pre, compiledPost)
        const { unmatched, added } = unmatchedPreLines(same.pre, same.post)
        expect(added.filter(Boolean).length).toBeGreaterThan(0)
        expect(unmatched).toEqual([])
        expect(disallowedAddedLines(same.pre, same.post, added)).toEqual([])
    }, 60000)

    test('the pattern tokens come after the Nexus tokens they reference', async () => {
        const pre = await compileSide(readFileSync(fixturePath, 'utf8'), S0_NEW_PATHS)
        const same = s2Remapped(pre, await compileSide(readFileSync(livePath, 'utf8'), []))
        const post = same.post
        const { added } = unmatchedPreLines(same.pre, post)
        const firstAdded = (name: string) => post.findIndex((line, i) => added[i] && line.trim().startsWith(name))
        expect(firstAdded('--nexus-')).toBeGreaterThanOrEqual(0)
        expect(firstAdded('--pattern-')).toBeGreaterThan(firstAdded('--nexus-'))
    }, 60000)
})

describe('classifier self-checks', () => {
    const pre = [':root {', '  --a: 1;', '}', '.keep {', '  color: red;', '}']
    const run = (post: string[]) => {
        const { unmatched, added } = unmatchedPreLines(pre, post)
        return { unmatched, bad: disallowedAddedLines(pre, post, added) }
    }

    test('a new custom property in :root and a nexus rule are allowed', () => {
        const r = run([':root {', '  --a: 1;', '}', ':root {', '  --nexus-x: 2;', '}', '.nexus-mark {', '  color: blue;', '}', '.keep {', '  color: red;', '}'])
        expect(r).toEqual({ unmatched: [], bad: [] })
    })

    test('a global rule, a redeclared property and an edited line are caught', () => {
        expect(run([':root {', '  --a: 1;', '}', 'body {', '  color: blue;', '}', '.keep {', '  color: red;', '}']).bad).toEqual(['body {', 'color: blue;'])
        expect(run([':root {', '  --a: 1;', '}', ':root {', '  --a: 2;', '}', '.keep {', '  color: red;', '}']).bad).toEqual(['--a: 2;'])
        expect(run([':root {', '  --a: 1;', '}', '.keep {', '  color: blue;', '}']).unmatched).toEqual(['  color: red;'])
    })

    // The S2 normalisation, on small fixtures shaped like the compiled output.
    const verdictOf = (prePart: string[], postPart: string[]) => {
        const same = s2Remapped(prePart, postPart, false)
        const { unmatched, added } = unmatchedPreLines(same.pre, same.post)
        return { unmatched, bad: disallowedAddedLines(same.pre, same.post, added) }
    }
    const radiusPre = (value: string) => ['@layer theme {', '  :root, :host {', `    --radius-md: ${value};`, '  }', '}', '.rounded-md {', '  border-radius: var(--radius-md);', '}']
    const radiusPost = (value: string) => ['@layer theme {', '  :root, :host {', '  }', '}', ':root {', `  --ui-radius-md: ${value};`, '}', '.rounded-md {', '  border-radius: var(--ui-radius-md);', '}']

    test('SC-1: a remapped step matches by its resolved value', () => {
        expect(verdictOf(radiusPre('0.375rem'), radiusPost('0.375rem'))).toEqual({ unmatched: [], bad: [] })
    })

    test('SC-2: a remapped step with a different value is caught', () => {
        expect(verdictOf(radiusPre('0.375rem'), radiusPost('0.4rem'))).toEqual({ unmatched: ['  border-radius: 0.375rem;'], bad: ['border-radius: 0.4rem;'] })
    })

    test('SC-3: a variable that is not remapped is never resolved', () => {
        const prePart = ['@layer theme {', '  :root, :host {', '    --spacing-x: 4px;', '  }', '}', '.p {', '  padding: var(--spacing-x);', '}']
        const postPart = ['@layer theme {', '  :root, :host {', '    --spacing-x: 4px;', '  }', '}', ':root {', '  --other: 4px;', '}', '.p {', '  padding: var(--other);', '}']
        expect(verdictOf(prePart, postPart)).toEqual({ unmatched: ['  padding: var(--spacing-x);'], bad: ['padding: var(--other);'] })
    })

    test('SC-4: only the remapped theme names may be absent from the post side', () => {
        const prePart = ['@layer theme {', '  :root, :host {', '    --radius-md: 0.375rem;', '    --spacing: 0.25rem;', '  }', '}']
        const postPart = ['@layer theme {', '  :root, :host {', '  }', '}']
        expect(verdictOf(prePart, postPart)).toEqual({ unmatched: ['    --spacing: 0.25rem;'], bad: [] })
    })

    test('a post output without the ten defaults fails the comparison itself', () => {
        expect(() => s2Remapped(radiusPre('0.375rem'), radiusPost('0.375rem'))).toThrow(/no default for/)
    })
})
