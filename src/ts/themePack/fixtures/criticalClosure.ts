// Test-only census of the parts a screen's critical elements enclose, and of the parts that enclose them. An element
// carrying `data-part-critical` protects every `data-part` at or under it: through `{@render x()}` of a snippet defined in
// the same file, through a component element to its imported `.svelte` file (recursively), and through the component's own
// children, which lie lexically inside its tag. A name that cannot be read statically under a marked root, a component
// that cannot be resolved and a `{@render}` of anything but a local snippet are census problems: a critical subtree must
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
    readonly snippets: ReadonlyMap<string, AstNode>
}

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
    const snippets = new Map<string, AstNode>()
    for (const statement of list(object(object(ast.instance)?.content)?.body)) {
        const node = object(statement)
        if (node?.type !== 'ImportDeclaration' || typeof object(node.source)?.value !== 'string') continue
        const from = object(node.source)?.value as string
        for (const specifier of list(node.specifiers)) {
            const spec = object(specifier)
            const local = nameOfIdentifier(spec?.local)
            if (spec?.type === 'ImportDefaultSpecifier' && local !== null) imports.set(local, from)
        }
    }
    walkNodes(ast.fragment, (node) => {
        if (node.type === 'SnippetBlock') {
            const name = nameOfIdentifier(node.expression)
            if (name !== null) snippets.set(name, node)
        }
        return true
    })
    return { file, ast, imports, snippets }
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

interface Frame { readonly node: AstNode }

/**
 * The parts that enclose a marked root: the `data-part` elements above the root in its own file, and, through the render
 * chain, above every element that renders the file the root sits in (and so on up). The marked parts themselves are not
 * reported.
 */
export function enclosingPartsOfRoots(files: readonly string[], read: SourceReader = readFromDisk): { readonly names: readonly string[]; readonly problems: readonly string[] } {
    const names = new Set<string>()
    const problems: string[] = []
    const cache = new Map<string, ParsedFile | null>()
    const parsed = (file: string): ParsedFile | null => {
        if (!cache.has(file)) cache.set(file, parseFile(file, read))
        return cache.get(file) ?? null
    }
    const partsAbove = (stack: readonly Frame[]): string[] => {
        const above: string[] = []
        for (const frame of stack) {
            if (frame.node.type !== 'RegularElement') continue
            const part = attributeOf(frame.node, 'data-part')
            const literal = part === null ? null : literalPart(part)
            if (literal !== null) above.push(literal)
        }
        return above
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
    const lifted = new Set<string>()
    /** Every part above each place `file` is rendered, through every importer, upward. */
    const liftFile = (target: string): void => {
        if (lifted.has(target)) return
        lifted.add(target)
        for (const importer of files) {
            const host = parsed(importer)
            if (host === null || importer === target) continue
            const local = [...host.imports].filter(([, from]) => path.resolve(path.dirname(importer), from) === target).map(([name]) => name)
            if (local.length === 0) continue
            visitWithStack(host, (node, stack) => {
                if (node.type === 'Component' && typeof node.name === 'string' && local.includes(node.name)) {
                    for (const part of partsAbove(stack)) names.add(part)
                    liftIntoSnippet(host, stack)
                    liftFile(importer)
                }
            })
        }
    }
    /** A place inside a snippet is also above every `{@render}` of that snippet. */
    const liftIntoSnippet = (host: ParsedFile, stack: readonly Frame[]): void => {
        for (const frame of stack) {
            if (frame.node.type !== 'SnippetBlock') continue
            const snippet = nameOfIdentifier(frame.node.expression)
            if (snippet === null) continue
            visitWithStack(host, (node, outer) => {
                if (node.type === 'RenderTag') {
                    const expression = object(node.expression)
                    if (expression?.type === 'CallExpression' && nameOfIdentifier(expression.callee) === snippet) {
                        for (const part of partsAbove(outer)) names.add(part)
                    }
                }
            })
        }
    }
    for (const file of files) {
        const own = parsed(file)
        if (own === null) continue
        let hasRoot = false
        visitWithStack(own, (node, stack) => {
            if (node.type === 'RegularElement' && attributeOf(node, 'data-part-critical') !== null) {
                hasRoot = true
                for (const part of partsAbove(stack)) names.add(part)
                liftIntoSnippet(own, stack)
            }
        })
        if (hasRoot) liftFile(file)
    }
    return { names: [...names].sort(), problems }
}
