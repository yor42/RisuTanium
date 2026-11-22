// Test-only census of the parts a screen's critical elements enclose, and of the parts that enclose them. An element
// carrying `data-part-critical` protects every `data-part` at or under it: through `{@render x()}` of a snippet defined in
// the same file, through a component element to its imported `.svelte` file (recursively), and through the component's own
// children, which lie lexically inside its tag. A named import from `@lucide/svelte` is a leaf: it spreads its props onto its own
// `<svg>`, so it counts only while it carries no `data-*` attribute and no spread. A name that cannot be read statically under a marked
// root, a component that cannot be resolved and a `{@render}` of anything but a local snippet are census problems: a critical subtree must
// use literal names. Popups reuse this scan.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'svelte/compiler'

interface AstNode { readonly type?: string; readonly [key: string]: unknown }

function object(value: unknown): AstNode | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AstNode : null
}

function list(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : []
}

function nameOfIdentifier(value: unknown): string | null {
    const node = object(value)
    return node?.type === 'Identifier' && typeof node.name === 'string' ? node.name : null
}

export interface ClosureCensus {
    /** The `data-part` of each marked root, in file order of discovery (`(unlisted)` when it has no literal name). */
    readonly roots: readonly string[]
    /** Every part at or under a marked root, sorted. */
    readonly names: readonly string[]
    /** One line per construct the census cannot follow, with its file. */
    readonly problems: readonly string[]
}

interface ParsedFile {
    readonly file: string
    readonly ast: AstNode
    readonly imports: ReadonlyMap<string, string>
    /** Local names of named imports, with the module they come from. */
    readonly namedImports: ReadonlyMap<string, string>
    readonly snippets: ReadonlyMap<string, AstNode>
}

const LUCIDE = '@lucide/svelte'

export type SourceReader = (file: string) => string | null

export function readFromDisk(file: string): string | null {
    try {
        return readFileSync(file, 'utf8')
    } catch {
        return null
    }
}

export function svelteFilesUnder(dir: string): string[] {
    const found: string[] = []
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) found.push(...svelteFilesUnder(full))
        else if (name.endsWith('.svelte')) found.push(full)
    }
    return found.sort()
}

function walkNodes(value: unknown, visit: (node: AstNode) => boolean): void {
    if (Array.isArray(value)) {
        for (const item of value) walkNodes(item, visit)
        return
    }
    const node = object(value)
    if (node === null) return
    if (visit(node) === false) return
    for (const [key, child] of Object.entries(node)) {
        if (key === 'metadata' || key === 'parent') continue
        walkNodes(child, visit)
    }
}

function parseFile(file: string, read: SourceReader): ParsedFile | null {
    const source = read(file)
    if (source === null) return null
    const ast = object(parse(source, { modern: true }))
    if (ast === null) return null
    const imports = new Map<string, string>()
    const namedImports = new Map<string, string>()
    const snippets = new Map<string, AstNode>()
    for (const statement of list(object(object(ast.instance)?.content)?.body)) {
        const node = object(statement)
        if (node?.type !== 'ImportDeclaration' || typeof object(node.source)?.value !== 'string') continue
        const from = object(node.source)?.value as string
        for (const specifier of list(node.specifiers)) {
            const spec = object(specifier)
            const local = nameOfIdentifier(spec?.local)
            if (spec?.type === 'ImportDefaultSpecifier' && local !== null) imports.set(local, from)
            if (spec?.type === 'ImportSpecifier' && local !== null) namedImports.set(local, from)
        }
    }
    walkNodes(ast.fragment, (node) => {
        if (node.type === 'SnippetBlock') {
            const name = nameOfIdentifier(node.expression)
            if (name !== null) snippets.set(name, node)
        }
        return true
    })
    return { file, ast, imports, namedImports, snippets }
}

function attributeOf(element: AstNode, name: string): AstNode | null {
    for (const attribute of list(element.attributes)) {
        const node = object(attribute)
        if (node?.type === 'Attribute' && node.name === name) return node
    }
    return null
}

/** The literal text of a `data-part`, or null when the value is dynamic or the attribute is a bare flag. */
function literalPart(attribute: AstNode): string | null {
    const value = list(attribute.value)
    if (value.length !== 1) return null
    const first = object(value[0])
    return first?.type === 'Text' && typeof first.data === 'string' ? first.data : null
}

function resolveComponent(from: ParsedFile, name: string): string | null {
    const source = from.imports.get(name)
    if (source === undefined || !source.startsWith('.') || !source.endsWith('.svelte')) return null
    return path.resolve(path.dirname(from.file), source)
}

/** Parts at or under every marked root of the given files. */
export function censusOfFiles(files: readonly string[], read: SourceReader = readFromDisk): ClosureCensus {
    const roots: string[] = []
    const names = new Set<string>()
    const problems: string[] = []
    const cache = new Map<string, ParsedFile | null>()
    const parsed = (file: string): ParsedFile | null => {
        if (!cache.has(file)) cache.set(file, parseFile(file, read))
        return cache.get(file) ?? null
    }
    const entered = new Set<string>()

    function under(file: ParsedFile, root: unknown): void {
        walkNodes(root, (node) => {
            if (node.type === 'RegularElement') {
                const part = attributeOf(node, 'data-part')
                if (part !== null) {
                    const literal = literalPart(part)
                    if (literal === null) problems.push(`${file.file}: a data-part that is not a literal under a critical root`)
                    else names.add(literal)
                }
                if (list(node.attributes).some((attribute) => object(attribute)?.type === 'SpreadAttribute')) {
                    problems.push(`${file.file}: an element with a spread attribute under a critical root`)
                }
            } else if (node.type === 'Component') {
                if (typeof node.name === 'string' && file.namedImports.get(node.name) === LUCIDE) {
                    const carriesPart = list(node.attributes).some((attribute) => {
                        const item = object(attribute)
                        return item?.type === 'SpreadAttribute' || (item?.type === 'Attribute' && typeof item.name === 'string' && item.name.startsWith('data-'))
                    })
                    if (carriesPart) problems.push(`${file.file}: a lucide icon with data-* or a spread under a critical root`)
                    return true
                }
                const target = typeof node.name === 'string' ? resolveComponent(file, node.name) : null
                const child = target === null ? null : parsed(target)
                if (target === null || child === null) {
                    problems.push(`${file.file}: component ${String(node.name)} under a critical root cannot be resolved`)
                } else if (!entered.has(`${target}`)) {
                    entered.add(target)
                    under(child, child.ast.fragment)
                }
            } else if (node.type === 'SvelteComponent' || node.type === 'SvelteElement' || node.type === 'SvelteSelf') {
                problems.push(`${file.file}: a dynamic or recursive element under a critical root`)
            } else if (node.type === 'RenderTag') {
                const expression = object(node.expression)
                const callee = expression?.type === 'CallExpression' ? nameOfIdentifier(expression.callee) : null
                const snippet = callee === null ? undefined : file.snippets.get(callee)
                if (snippet === undefined) {
                    problems.push(`${file.file}: a {@render} that is not a snippet of this file under a critical root`)
                } else if (!entered.has(`${file.file}#${callee}`)) {
                    entered.add(`${file.file}#${callee}`)
                    under(file, snippet.body)
                }
            }
            return true
        })
    }

    for (const file of files) {
        const own = parsed(file)
        if (own === null) continue
        walkNodes(own.ast.fragment, (node) => {
            if (node.type === 'RegularElement' && attributeOf(node, 'data-part-critical') !== null) {
                const part = attributeOf(node, 'data-part')
                roots.push(part === null ? '(unlisted)' : literalPart(part) ?? '(unlisted)')
                under(own, node)
                return false
            }
            return true
        })
    }
    return { roots, names: [...names].sort(), problems }
}

export interface PartCensus {
    /** Every literal `data-part` of the given files, sorted. Dynamic names are not counted. */
    readonly parts: readonly string[]
    /** Parts that are, or hold at any depth, an interactive element, sorted. */
    readonly interactive: readonly string[]
    /** Parts found outside every marked subtree of their own file, sorted. */
    readonly outsideRoots: readonly string[]
}

const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a', 'label'])
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'slider', 'spinbutton', 'textbox', 'combobox', 'listbox', 'searchbox', 'treeitem', 'gridcell'])

/** An element, component or directive that can take input, or whose content cannot be read as inert. */
function isInteractive(node: AstNode, file: ParsedFile): boolean {
    if (node.type === 'RegularElement') {
        if (typeof node.name === 'string' && INTERACTIVE_TAGS.has(node.name)) return true
        return list(node.attributes).some((attribute) => {
            const item = object(attribute)
            if (item === null) return false
            if (item.type === 'SpreadAttribute' || item.type === 'BindDirective' || item.type === 'OnDirective') return true
            if (item.type !== 'Attribute' || typeof item.name !== 'string') return false
            if (item.name.startsWith('on') || item.name === 'tabindex') return true
            if (item.name !== 'role') return false
            const role = literalPart(item)
            return role === null || INTERACTIVE_ROLES.has(role)
        })
    }
    if (node.type === 'Component') return !(typeof node.name === 'string' && file.namedImports.get(node.name) === LUCIDE)
    return node.type === 'SvelteComponent' || node.type === 'SvelteElement' || node.type === 'SvelteSelf' || node.type === 'RenderTag'
}

/** The literal parts of the files, which of them take or hold input, and which sit outside every marked subtree. */
export function censusOfParts(files: readonly string[], read: SourceReader = readFromDisk): PartCensus {
    const parts = new Set<string>()
    const interactive = new Set<string>()
    const outside = new Set<string>()
    for (const file of files) {
        const own = parseFile(file, read)
        if (own === null) continue
        walkNodes(own.ast.fragment, (node) => {
            if (node.type !== 'RegularElement') return true
            const part = attributeOf(node, 'data-part')
            const literal = part === null ? null : literalPart(part)
            if (literal === null) return true
            parts.add(literal)
            let holds = false
            walkNodes(node, (inner) => {
                if (isInteractive(inner, own)) holds = true
                return true
            })
            if (holds) interactive.add(literal)
            return true
        })
        walkNodes(own.ast.fragment, (node) => {
            if (node.type !== 'RegularElement') return true
            if (attributeOf(node, 'data-part-critical') !== null) return false
            const part = attributeOf(node, 'data-part')
            const literal = part === null ? null : literalPart(part)
            if (literal !== null) outside.add(literal)
            return true
        })
    }
    return { parts: [...parts].sort(), interactive: [...interactive].sort(), outsideRoots: [...outside].sort() }
}
interface Frame { readonly node: AstNode }

/**
 * Opt-in stop mode of `enclosingPartsOfRoots`. Giving any options object makes every place the upward lift cannot follow a
 * problem instead of a silent stop; omitting it keeps the original behaviour.
 */
export interface EnclosingOptions {
    /** Roots are the elements whose literal `data-part` is in this set, marked or not. Without it the roots are the marked elements. */
    readonly rootParts?: ReadonlySet<string>
    /** Files the lift may end in without a problem (the app root, which renders nothing above itself). */
    readonly tops?: readonly string[]
    /** The repository root: resolves `src/...` imports, and problems name files relative to it. */
    readonly aliasRoot?: string
}

/**
 * The parts that enclose a marked root: the `data-part` elements above the root in its own file, and, through the render
 * chain, above every element that renders the file the root sits in (and so on up). The marked parts themselves are not
 * reported. With `options` every stop of the lift is reported in `problems` (see `EnclosingOptions`).
 */
export function enclosingPartsOfRoots(files: readonly string[], read: SourceReader = readFromDisk, options?: EnclosingOptions): { readonly names: readonly string[]; readonly problems: readonly string[] } {
    const names = new Set<string>()
    const problems = new Set<string>()
    const strict = options !== undefined
    const aliasRoot = options?.aliasRoot
    const rootParts = options?.rootParts
    const tops = new Set(options?.tops ?? [])
    const shown = (file: string): string => (aliasRoot === undefined ? file : path.relative(aliasRoot, file).split(path.sep).join('/'))
    const stop = (text: string): void => {
        if (strict) problems.add(text)
    }
    const cache = new Map<string, ParsedFile | null>()
    const parsed = (file: string): ParsedFile | null => {
        if (!cache.has(file)) cache.set(file, parseFile(file, read))
        return cache.get(file) ?? null
    }
    const partOf = (node: AstNode): string | null => {
        const part = attributeOf(node, 'data-part')
        return part === null ? null : literalPart(part)
    }
    const isRoot = (node: AstNode): boolean => {
        if (node.type !== 'RegularElement') return false
        if (rootParts === undefined) return attributeOf(node, 'data-part-critical') !== null
        const literal = partOf(node)
        return literal !== null && rootParts.has(literal)
    }
    const partsAbove = (stack: readonly Frame[]): string[] => {
        const above: string[] = []
        for (const frame of stack) {
            if (frame.node.type !== 'RegularElement') continue
            const literal = partOf(frame.node)
            if (literal !== null) above.push(literal)
        }
        return above
    }
    /** The file an import specifier points at, or null when the lift cannot follow it. */
    const resolveImport = (host: ParsedFile, from: string): string | null => {
        if (!strict || from.startsWith('.')) return path.resolve(path.dirname(host.file), from)
        if (aliasRoot !== undefined && from.startsWith('src/')) return path.resolve(aliasRoot, from)
        return null
    }
    /** Visits every node of a file with the stack of its ancestors. */
    const visitWithStack = (file: ParsedFile, visit: (node: AstNode, stack: readonly Frame[]) => void): void => {
        const stack: Frame[] = []
        const recurse = (value: unknown): void => {
            if (Array.isArray(value)) {
                for (const item of value) recurse(item)
                return
            }
            const node = object(value)
            if (node === null) return
            if (typeof node.type === 'string') visit(node, stack)
            stack.push({ node })
            for (const [key, child] of Object.entries(node)) {
                if (key !== 'metadata' && key !== 'parent') recurse(child)
            }
            stack.pop()
        }
        recurse(file.ast.fragment)
    }
    /** A site inside a component's children has the component's own wrapper parts above it, which the lift cannot see. */
    const checkFrames = (host: ParsedFile, stack: readonly Frame[]): void => {
        for (const frame of stack) {
            if (frame.node.type === 'SvelteComponent') {
                stop(`${shown(host.file)}: a dynamic component site cannot be lifted`)
            } else if (frame.node.type === 'Component' && typeof frame.node.name === 'string') {
                const name = frame.node.name
                if (host.imports.has(name) || host.namedImports.has(name)) {
                    stop(`${shown(host.file)}: a root or render site inside component ${name}'s children; ${name}'s own wrapper parts are not followed`)
                } else {
                    stop(`${shown(host.file)}: a dynamic component site cannot be lifted`)
                }
            }
        }
    }
    const climb = (host: ParsedFile, stack: readonly Frame[]): void => {
        for (const part of partsAbove(stack)) names.add(part)
        checkFrames(host, stack)
        liftIntoSnippet(host, stack)
    }
    const lifted = new Set<string>()
    /** Every part above each place `file` is rendered, through every importer, upward. */
    const liftFile = (target: string): void => {
        if (lifted.has(target)) return
        lifted.add(target)
        let rendered = false
        for (const importer of files) {
            const host = parsed(importer)
            if (host === null || importer === target) continue
            const local: string[] = []
            for (const [name, from] of host.imports) {
                const resolved = resolveImport(host, from)
                if (resolved === null) {
                    if (from.endsWith('.svelte')) stop(`${shown(importer)}: import ${from} cannot be resolved for the upward lift`)
                } else if (resolved === target) {
                    local.push(name)
                }
            }
            if (local.length === 0) continue
            visitWithStack(host, (node, stack) => {
                if (node.type === 'Component' && typeof node.name === 'string' && local.includes(node.name)) {
                    rendered = true
                    climb(host, stack)
                    liftFile(importer)
                }
            })
        }
        if (strict && !rendered && !tops.has(target)) stop(`${shown(target)}: rendered by no scanned file; the parts above it are not followed`)
    }
    const snippetsSeen = new Set<string>()
    /** A place inside a snippet is also above every `{@render}` of that snippet. */
    const liftIntoSnippet = (host: ParsedFile, stack: readonly Frame[]): void => {
        for (const frame of stack) {
            if (frame.node.type !== 'SnippetBlock') continue
            const snippet = nameOfIdentifier(frame.node.expression)
            if (snippet === null) continue
            if (strict) {
                if (snippetsSeen.has(`${host.file}#${snippet}`)) continue
                snippetsSeen.add(`${host.file}#${snippet}`)
            }
            let renderedHere = false
            visitWithStack(host, (node, outer) => {
                if (node.type === 'RenderTag') {
                    const expression = object(node.expression)
                    if (expression?.type === 'CallExpression' && nameOfIdentifier(expression.callee) === snippet) {
                        renderedHere = true
                        if (strict) climb(host, outer)
                        else for (const part of partsAbove(outer)) names.add(part)
                    }
                }
            })
            if (strict && !renderedHere) stop(`${shown(host.file)}: snippet ${snippet} holding a root or render site is not rendered in this file`)
        }
    }
    for (const file of files) {
        const own = parsed(file)
        if (own === null) continue
        let hasRoot = false
        visitWithStack(own, (node, stack) => {
            if (isRoot(node)) {
                hasRoot = true
                if (strict) {
                    climb(own, stack)
                } else {
                    for (const part of partsAbove(stack)) names.add(part)
                    liftIntoSnippet(own, stack)
                }
            }
        })
        if (hasRoot) liftFile(file)
    }
    return { names: [...names].sort(), problems: [...problems].sort() }
}

/**
 * Test-only components under src/lib that no product file imports (checked by escapeRoute.test.ts). They are left out of the
 * escape-route census and site scan, which describe what the app renders; a pinned list, not a name pattern, so a product
 * component is never dropped by its name.
 */
export const TEST_ONLY_COMPONENTS: readonly string[] = [
    'src/lib/ChatScreens/ChatBodyBoundRootHarness.svelte',
    'src/lib/ChatScreens/ChatsLivenessRowStub.svelte',
    'src/lib/ChatShell/WarmHoldProbeRow.svelte',
    'src/lib/ChatShell/tests/HtmlRangeHost.svelte',
    'src/lib/Nexus/pattern/TaskToastHarness.svelte',
    'src/lib/Nexus/pattern/TaskYieldHarness.svelte',
    'src/lib/Setting/Pages/Display/ThemePackRowStub.svelte',
    'src/lib/SettingsShell/PersonasShellPage.testHost.svelte',
    'src/lib/SettingsShell/SettingsShell.testHost.svelte',
    'src/lib/UI/Home/HomeShellKeyHarness.svelte',
    'src/lib/UI/Windowed/WindowedSegment.harness.test.svelte',
]

/** The loader's host and failure line and the row's root: roots of the escape walk that are not escape-route names. */
export const THEME_PACK_ROW_ROOTS: readonly string[] = ['theme-pack-row-host', 'theme-pack-load-failed', 'theme-pack-row']

/** The product components the escape-route census and site scan read: every `.svelte` under src/lib minus the test-only list, plus src/App.svelte. Absolute paths, sorted. */
export function escapeSourceFiles(repoRoot: string): string[] {
    const skipped = new Set(TEST_ONLY_COMPONENTS.map((file) => path.resolve(repoRoot, file)))
    return [...svelteFilesUnder(path.join(repoRoot, 'src/lib')).filter((file) => !skipped.has(file)), path.join(repoRoot, 'src/App.svelte')]
}

/** Every element whose literal `data-part` is in `rootParts`, keyed `<repo-relative file>#<name>#<ordinal in the file>` (ordinal counted per name, in document order). */
export function escapeSites(files: readonly string[], repoRoot: string, rootParts: ReadonlySet<string>, read: SourceReader = readFromDisk): string[] {
    const keys: string[] = []
    for (const file of files) {
        const own = parseFile(file, read)
        if (own === null) continue
        const ordinal = new Map<string, number>()
        walkNodes(own.ast.fragment, (node) => {
            if (node.type !== 'RegularElement') return true
            const part = attributeOf(node, 'data-part')
            const literal = part === null ? null : literalPart(part)
            if (literal !== null && rootParts.has(literal)) {
                const at = ordinal.get(literal) ?? 0
                ordinal.set(literal, at + 1)
                keys.push(`${path.relative(repoRoot, file).split(path.sep).join('/')}#${literal}#${at}`)
            }
            return true
        })
    }
    return keys.sort()
}

const SIDEBAR = 'src/lib/ChatShell/sidebar/ShellSidebar.svelte'
const ROW_LOADER = 'src/lib/Setting/Pages/Display/ThemePackRowLoader.svelte'
const ROW = 'src/lib/Setting/Pages/Display/ThemePackRow.svelte'

/**
 * The mounted-screen fixtures of escapeWalk.svelte.test.ts and the escape sites each one renders (`escapeSites` keys).
 * Their union must equal the scanned sites, so a new site without a fixture fails the walk test.
 */
export const ESCAPE_FIXTURE_SITES: Readonly<Record<string, readonly string[]>> = {
    F1: [`${SIDEBAR}#sidebar-settings#0`],
    F2: ['src/lib/ChatShell/ThisChatSheet.svelte#this-chat-all-settings#0'],
    F3: ['src/lib/UI/Home/HomeDrawer.svelte#home-drawer-settings#0'],
    F4: ['src/lib/SettingsShell/SettingsShellIndex.svelte#settings-index-display#0'],
    F5: [`${ROW_LOADER}#theme-pack-load-failed#0`, `${ROW_LOADER}#theme-pack-row-host#0`, `${ROW}#theme-pack-row#0`],
    F6: ['src/lib/Setting/Settings.svelte#settings-index-display#0', `${ROW_LOADER}#theme-pack-row-host#0`, `${ROW}#theme-pack-row#0`],
    F7: ['src/lib/SideBars/Sidebar.svelte#rail-settings#0', 'src/lib/SideBars/Sidebar.svelte#rail-settings#1', 'src/lib/SideBars/Sidebar.svelte#rail-settings#2'],
    F8: ['src/lib/Others/BootPackEscape.svelte#boot-pack-escape#0'],
}

/** What encloses one element of a mounted tree. */
export interface Enclosure {
    /** The `data-part` of every ancestor, nearest first. */
    readonly parts: readonly string[]
    /** The `data-role` (user or system) of every ancestor. */
    readonly roleAncestors: readonly string[]
    /** The `data-role` (user or system) of every previous element sibling of the element and of each ancestor. */
    readonly roleSiblings: readonly string[]
}

/** The parts above an element and the message roles that can reach it through a descendant or sibling combinator. */
export function enclosureOf(element: Element): Enclosure {
    const parts: string[] = []
    const roleAncestors: string[] = []
    const roleSiblings: string[] = []
    const isRole = (value: string | null): value is string => value === 'user' || value === 'system'
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        if (node !== element) {
            const part = node.getAttribute('data-part')
            if (part !== null) parts.push(part)
            const role = node.getAttribute('data-role')
            if (isRole(role)) roleAncestors.push(role)
        }
        for (let sibling = node.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
            const role = sibling.getAttribute('data-role')
            if (isRole(role)) roleSiblings.push(role)
        }
    }
    return { parts, roleAncestors, roleSiblings }
}

/**
 * The walk's verdict on the elements named `name` in a mounted tree: how many there are, whether each carries the marker (an
 * unmarked one must hold no part), that every part above it is in `allowed`, and that no message role reaches it. Empty when all hold.
 */
export function escapeWalkViolations(container: ParentNode, name: string, expected: { readonly count: number; readonly marked: boolean }, allowed: ReadonlySet<string>): string[] {
    const found = [...container.querySelectorAll(`[data-part="${name}"]`)]
    const violations: string[] = []
    if (found.length !== expected.count) violations.push(`${name}: ${found.length} elements, expected ${expected.count}`)
    for (const element of found) {
        if (expected.marked && !element.hasAttribute('data-part-critical')) violations.push(`${name}: no data-part-critical`)
        if (!expected.marked && element.querySelector('[data-part]') !== null) violations.push(`${name}: an unmarked element that holds a part`)
        const enclosure = enclosureOf(element)
        const unlisted = enclosure.parts.filter((part) => !allowed.has(part))
        if (unlisted.length > 0) violations.push(`${name}: parts above that are neither in ESCAPE_ANCESTORS nor critical: ${unlisted.join(', ')}`)
        if (enclosure.roleAncestors.length > 0) violations.push(`${name}: a message-role ancestor`)
        if (enclosure.roleSiblings.length > 0) violations.push(`${name}: a message-role previous sibling`)
    }
    return violations
}
