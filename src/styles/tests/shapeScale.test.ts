// @vitest-environment jsdom

/**
 * The app shape-token layer (MC-3128): the Tailwind radius and hairline scale reads ten --ui-* tokens whose defaults equal
 * Tailwind's own values, so the legacy look is unchanged until a theme pack sheet sets one.
 *
 * R3 shows the defect the layer fixes: a pack value in a --ui-* token has to reach `rounded-md`, `rounded` and `border` through
 * the real compiled styles.css. G1 and G2 pin the defaults and the mapping; G6a and G6c pin the consumer rule (SC.2/N7): an app
 * rule may read a --ui-* token, or a name derived from one, only in a radius or width property, never in a paint property.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import postcss, { type AtRule, type Container, type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { judgeAreaSheet } from '../../ts/themePack/index'
import { SHAPE_PROPERTY } from '../../ts/themePack/shapeMode'
import { CascadeModel, compileAppStyles, compileRules, readRepoFile, REPO_ROOT } from './cascadeModel'

const STEPS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl']
const APP_NAMES = [...STEPS.map((step) => `--ui-radius-${step}`), '--ui-radius', '--ui-border-width']
// The eleven Tailwind theme names the scale remaps.
const TAILWIND_NAMES = [...STEPS.map((step) => `--radius-${step}`), '--radius', '--default-border-width', '--border-width-1']
const STUDIO_CSS = ':root{--ui-radius-md:2px;--ui-radius:0px;--ui-border-width:2px}'
const SHAPE_SIZE_PROPERTY = /-(radius|width)$/

interface ScanSource { base: string, pattern: string, negated: boolean }
interface TailwindCompiler {
    sources: ScanSource[]
    root: 'none' | null | { base: string, pattern: string }
    build(candidates: string[]): string
}
interface TailwindNode { compile(css: string, opts: { base: string, onDependency: (file: string) => void }): Promise<TailwindCompiler> }
interface TailwindOxide { Scanner: new (opts: { sources: ScanSource[] }) => { scan(): string[] } }

/** The Tailwind output of a styles.css text over every candidate the repository names, as the Vite plugin scans it. */
async function compileFullRepo(cssText: string): Promise<string> {
    const viteRequire = createRequire(realpathSync(path.join(REPO_ROOT, 'node_modules/@tailwindcss/vite/package.json')))
    const node = await import(/* @vite-ignore */ pathToFileURL(viteRequire.resolve('@tailwindcss/node')).href) as TailwindNode
    const oxide = await import(/* @vite-ignore */ pathToFileURL(viteRequire.resolve('@tailwindcss/oxide')).href) as TailwindOxide
    const compiler = await node.compile(cssText, { base: path.join(REPO_ROOT, 'src'), onDependency: () => {} })
    const own: ScanSource[] = compiler.root === 'none'
        ? []
        : compiler.root === null
            ? [{ base: REPO_ROOT, pattern: '**/*', negated: false }]
            : [{ ...compiler.root, negated: false }]
    const candidates = new oxide.Scanner({ sources: [...own, ...compiler.sources] }).scan()
    return compiler.build(candidates)
}

/** The defaults the first `:root` rule of a token file declares for the given names. */
function rootDefaults(file: string, names: readonly string[]): Map<string, string> {
    const rootRules: Rule[] = []
    postcss.parse(readRepoFile(file)).walkRules((rule) => { if (rule.selector === ':root') rootRules.push(rule) })
    const first = rootRules[0]
    if (!first) throw new Error(`${file} has no :root rule`)
    const wanted = new Set(names)
    const values = new Map<string, string>()
    first.each((child) => { if (child.type === 'decl' && wanted.has(child.prop)) values.set(child.prop, child.value) })
    return values
}

function contextOf(node: Declaration): string {
    const parts: string[] = []
    for (let parent = node.parent as Container | undefined; parent && parent.type !== 'root'; parent = parent.parent as Container | undefined) {
        parts.unshift(parent.type === 'rule' ? (parent as Rule).selector : parent.type === 'atrule' ? `@${(parent as AtRule).name} ${(parent as AtRule).params}` : '')
    }
    return parts.join(' > ')
}

/** Every declaration as `context | property: value`, minus the dropped names, with each value passed through `substitute`. */
function flatten(css: string, drop: ReadonlySet<string>, substitute: (value: string) => string): string[] {
    const out: string[] = []
    postcss.parse(css).walkDecls((decl) => {
        if (drop.has(decl.prop)) return
        out.push(`${contextOf(decl)} | ${decl.prop}: ${substitute(decl.value)}`)
    })
    return out
}

const resolveWith = (values: Map<string, string>) => (value: string): string => value.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => values.get(name) ?? whole)

describe('R3: a pack value in a shape token reaches the legacy utilities (MC-3128)', () => {
    async function shapeOf(packCss: string): Promise<Record<string, string | undefined>> {
        const app = await compileAppStyles(['rounded-md', 'rounded', 'border'])
        document.body.innerHTML = '<div class="rounded-md"></div><div class="rounded"></div><div class="border"></div>'
        const model = new CascadeModel(compileRules([app, { name: 'pack', css: packCss }]))
        const [md, bare, border] = [...document.body.children]
        return { md: model.prop(md, 'border-radius'), bare: model.prop(bare, 'border-radius'), border: model.prop(border, 'border-width') }
    }

    it('the judged studio text resolves rounded-md, rounded and border to the pack values', async () => {
        const canonical = judgeAreaSheet('studio', STUDIO_CSS, undefined, 'studio').canonical
        expect(canonical).toMatch(/--ui-radius-md:\s*2px/)
        expect(await shapeOf(canonical)).toEqual({ md: '2px', bare: '0px', border: '2px' })
    }, 60000)

    it('without a pack the utilities keep the Tailwind defaults', async () => {
        expect(await shapeOf('')).toEqual({ md: '0.375rem', bare: '0.25rem', border: '1px' })
    }, 60000)
})

describe('G1 and G2: the mapping and the defaults', () => {
    const live = readRepoFile('src/styles.css')

    it('G2: the inline block maps every Tailwind radius name and the hairline names to the matching --ui-* token', () => {
        const blocks = postcss.parse(live).nodes.filter((node): node is AtRule => node.type === 'atrule' && node.name === 'theme')
        expect(blocks.map((block) => block.params)).toEqual(['', 'inline'])
        const inline = new Map<string, string>()
        blocks[1].each((child) => { if (child.type === 'decl') inline.set(child.prop, child.value) })
        const installed = readFileSync(path.join(REPO_ROOT, 'node_modules/tailwindcss/theme.css'), 'utf8')
        const radiusNames = [...installed.matchAll(/(--radius(?:-[\w]+)?)\s*:/g)].map((m) => m[1]).sort()
        expect(radiusNames).toEqual([...STEPS.map((step) => `--radius-${step}`), '--radius'].sort())
        const expected = new Map<string, string>([...STEPS.map((step): [string, string] => [`--radius-${step}`, `var(--ui-radius-${step})`]), ['--radius', 'var(--ui-radius)'], ['--default-border-width', 'var(--ui-border-width)'], ['--border-width-1', 'var(--ui-border-width)']])
        expect([...inline.entries()].sort()).toEqual([...expected.entries()].sort())
        expect(blocks[0].toString()).not.toMatch(/--border-width-1\s*:/)
    })

    it('G2: each default equals the installed Tailwind value (E-1), and both token files agree', () => {
        const installed = readFileSync(path.join(REPO_ROOT, 'node_modules/tailwindcss/theme.css'), 'utf8')
        for (const file of ['src/styles/nexus-tokens.css', 'docs/design/theme/nexus-tokens.css']) {
            const defaults = rootDefaults(file, APP_NAMES)
            expect([...defaults.keys()].sort(), file).toEqual([...APP_NAMES].sort())
            for (const step of STEPS) {
                const theme = new RegExp(`--radius-${step}\\s*:\\s*([^;]+);`).exec(installed)
                expect(theme, `installed --radius-${step}`).not.toBeNull()
                expect(defaults.get(`--ui-radius-${step}`), `${file} --ui-radius-${step}`).toBe(theme![1].trim())
            }
            expect(defaults.get('--ui-radius'), file).toBe('0.25rem')
            expect(defaults.get('--ui-border-width'), file).toBe('1px')
        }
    })

    it('G1: the compile with the layer equals the compile without it, once the defaults are substituted', async () => {
        const inlineBlock = /@theme inline \{[^}]*\}\r?\n/
        expect(live).toMatch(inlineBlock)
        const unremapped = live.replace(inlineBlock, '').replace(/(\r?\n)(  --width-110: 28rem;)/, '$1  --border-width-1: 1px;$1$1$2')
        expect(unremapped).not.toBe(live)
        const withLayer = await compileFullRepo(live)
        const without = await compileFullRepo(unremapped)
        const defaults = rootDefaults('src/styles/nexus-tokens.css', APP_NAMES)
        const dropped = new Set([...TAILWIND_NAMES, ...APP_NAMES])
        const tailwindValues = new Map<string, string>()
        postcss.parse(without).walkDecls((decl) => { if (TAILWIND_NAMES.includes(decl.prop)) tailwindValues.set(decl.prop, decl.value) })
        const got = flatten(withLayer, dropped, resolveWith(defaults))
        const want = flatten(without, dropped, resolveWith(tailwindValues))
        expect(withLayer).toMatch(/var\(--ui-radius-md\)/)
        expect(got.length).toBeGreaterThan(2000)
        expect(got).toEqual(want)
    }, 120000)
})

/** The names that read a tracked name (transitively, through custom properties), and the non-custom declarations that read one. */
function consumers(sheets: Array<{ name: string, css: string }>, seeds: readonly string[]): { tracked: Set<string>, readers: Array<{ sheet: string, prop: string, name: string }> } {
    const tracked = new Set(seeds)
    const roots = sheets.map((sheet) => ({ sheet: sheet.name, root: postcss.parse(sheet.css) }))
    const reads = (value: string, name: string): boolean => value.includes(name) && new RegExp(`var\\(\\s*${name}(?![\\w-])`).test(value)
    for (let grew = true; grew;) {
        grew = false
        for (const { root } of roots) {
            root.walkDecls((decl) => {
                if (decl.prop.startsWith('--') && !tracked.has(decl.prop) && [...tracked].some((name) => reads(decl.value, name))) {
                    tracked.add(decl.prop)
                    grew = true
                }
            })
        }
    }
    const readers: Array<{ sheet: string, prop: string, name: string }> = []
    for (const { sheet, root } of roots) {
        root.walkDecls((decl) => {
            if (decl.prop.startsWith('--')) return
            for (const name of tracked) if (reads(decl.value, name)) readers.push({ sheet, prop: decl.prop, name })
        })
    }
    return { tracked, readers }
}
const isSizeProperty = (prop: string): boolean => SHAPE_SIZE_PROPERTY.test(prop) && SHAPE_PROPERTY.some((pattern) => pattern.test(prop))

describe('G6a: in the compiled output a shape token is read only by radius and width properties', () => {
    it('walks every declaration of the full-repo compile', async () => {
        const output = await compileFullRepo(readRepoFile('src/styles.css'))
        const { tracked, readers } = consumers([{ name: 'tailwind', css: output }], APP_NAMES)
        expect(readers.length).toBeGreaterThan(40)
        for (const name of TAILWIND_NAMES) expect(tracked.has(name), `${name} derives from a shape token`).toBe(true)
        expect(readers.filter((reader) => !isSizeProperty(reader.prop)).map((reader) => `${reader.prop} reads ${reader.name}`)).toEqual([])
    }, 120000)
})

describe('G6c: in the source stylesheets and markup a shape token has no unclassified reader', () => {
    const SRC = path.join(REPO_ROOT, 'src')
    const isTestFile = (rel: string): boolean => /\.test\.|test-helpers|testHost|(^|\/)tests\/|\.scenarios\.|Harness|Stub/.test(rel)
    function walk(dir: string, into: string[] = []): string[] {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) walk(full, into)
            else if (/\.(svelte|ts|css|js|mjs)$/.test(entry.name)) into.push(full)
        }
        return into
    }
    const files = walk(SRC).map((file) => ({ rel: 'src/' + path.relative(SRC, file).replace(/\\/g, '/'), full: file })).filter((file) => !isTestFile(file.rel))
    // The validator names the tokens as data; nothing there reads one.
    const VALIDATOR = /^src\/ts\/themePack\//
    const styleBlocks = (text: string): string[] => [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1])

    it('every stylesheet declaration reading a shape token or a name derived from one is a radius or width property', () => {
        const sheets: Array<{ name: string, css: string }> = []
        for (const file of files) {
            const text = readFileSync(file.full, 'utf8')
            if (file.rel.endsWith('.css')) sheets.push({ name: file.rel, css: text })
            else if (file.rel.endsWith('.svelte')) styleBlocks(text).forEach((css, i) => sheets.push({ name: `${file.rel}#style${i}`, css }))
        }
        expect(sheets.length).toBeGreaterThan(100)
        const { readers } = consumers(sheets, APP_NAMES)
        expect(readers.filter((reader) => !isSizeProperty(reader.prop)).map((reader) => `${reader.sheet}: ${reader.prop} reads ${reader.name}`)).toEqual([])
    })

    it('no script or markup outside the validator mentions a shape token: classify the reader first', () => {
        const mentions: string[] = []
        for (const file of files) {
            if (VALIDATOR.test(file.rel) || file.rel.endsWith('.css')) continue
            const text = readFileSync(file.full, 'utf8')
            const markup = file.rel.endsWith('.svelte') ? text.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '') : text
            if (/--ui-(radius|border-width)/.test(markup)) mentions.push(file.rel)
        }
        expect(mentions, 'classify this reader against the consumer rule (SC.2/N7), then list it here').toEqual([])
    })
})
