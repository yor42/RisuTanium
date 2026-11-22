// @vitest-environment node
// The Settings screen's part census (#438 S3a-2). SETTINGS_PARTS is recomputed from the markup of the component closure of the
// Settings shell: SettingsShell.svelte plus every component the setting renderer can mount, which is read from the two registries
// that name them (settingRegistry.ts and customComponents.ts). A rename, a new part, a component added to either registry or a
// settings-* name rendered on another screen fails here until the list is reviewed. The tier pin keeps every live part out of the
// safe tier (MC-3249), the zero-grep check keeps the pre-rename names out of src (the markup, the <style> blocks and the queries).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { REGISTRY_WRITE, registryForms } from './fixtures/registryForms'
import { SETTINGS_PARTS, isAreaPart } from './areaParts'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS, THEME_PACK_ROW_CLOSURE, selectorTier } from './engine'
import { lintAreaPack } from './index'
import { SETTINGS_CRITICAL_CLOSURE } from './registries/settings'
import { SETTINGS_LINT_REGISTRY } from './registries/settings5b'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const src = path.join(root, 'src')
const rel = (file: string): string => path.relative(root, file).split(path.sep).join('/')
const TEST_COMPONENT = /\.test\.|Harness|Stub|testHost|\/tests\//

/** The `.svelte` imports of a source file, static (`from`) and dynamic (`import()`), as absolute paths; a specifier that is not a relative or `src/` path is not followed. */
function svelteImports(file: string): { specifier: string; resolved: string }[] {
    const found: { specifier: string; resolved: string }[] = []
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()\s*['"]([^'"]+\.svelte)['"]/g)) {
        const specifier = m[1]
        if (specifier.startsWith('.')) found.push({ specifier, resolved: path.resolve(path.dirname(file), specifier) })
        else if (specifier.startsWith('src/')) found.push({ specifier, resolved: path.resolve(root, specifier) })
    }
    return found
}

function closureOf(starts: readonly string[]): Set<string> {
    const seen = new Set<string>()
    const stack = [...starts]
    while (stack.length > 0) {
        const file = stack.pop() as string
        if (seen.has(file) || !existsSync(file)) continue
        seen.add(file)
        if (file.endsWith('.svelte')) stack.push(...svelteImports(file).map((i) => i.resolved))
    }
    return seen
}

function walk(dir: string, into: string[]): string[] {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full, into)
        else if (/\.(svelte|ts|js|css)$/.test(name)) into.push(full)
    }
    return into
}

const REGISTRY_FILES = [path.join(src, 'ts/setting/settingRegistry.ts'), path.join(src, 'ts/setting/customComponents.ts')]
const REGISTRY_NAMES = ['settingRegistry', 'customComponents']
const parsedImports = REGISTRY_FILES.map((file) => svelteImports(file))
const roots = [path.join(src, 'lib/SettingsShell/SettingsShell.svelte'), ...parsedImports.flat().map((i) => i.resolved)]
const shell = closureOf(roots)
const legacy = closureOf([path.join(src, 'lib/Setting/Settings.svelte')])
const shellComponents = [...shell].filter((file) => file.endsWith('.svelte') && !TEST_COMPONENT.test(file)).sort()

/** The reviewed non-literal data-parts of the closure: the search result row is a hit or a "more" row. An expression that is not a single string is reviewed only when every string literal in it equals `literals` exactly (members and size); `parts` are the names it can render. */
const REVIEWED_EXPRESSIONS: Readonly<Record<string, { literals: readonly string[]; parts: readonly string[] }>> = {
    'src/lib/SettingsShell/SettingsSearchResults.svelte': { literals: ['hit', 'settings-search-result', 'settings-search-more'], parts: ['settings-search-result', 'settings-search-more'] },
}

/** Components of the closure whose element spreads its rest props, with the reason that is safe: a data-part a caller passes is an attribute of that component's tag, which collect reads at the call site. */
const REVIEWED_SPREADS: Readonly<Record<string, string>> = {
    'src/lib/UI/Windowed/WindowedSegment.svelte': 'the windowed list host forwards its rest props (class); its callers name a part, if at all, on their own tag',
}

interface AstNode { readonly type?: string; readonly [key: string]: unknown }
const object = (value: unknown): AstNode | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AstNode : null)
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

/** Every node of a tree, parents before children; `metadata` and `parent` links are not followed. */
function visit(value: unknown, on: (node: AstNode) => void): void {
    if (Array.isArray(value)) { for (const item of value) visit(item, on); return }
    const node = object(value)
    if (node === null) return
    on(node)
    for (const [key, child] of Object.entries(node)) if (key !== 'metadata' && key !== 'parent') visit(child, on)
}

/** The string a static ESTree node is: a string literal or a template literal with no expression; null for anything else. */
function staticString(node: AstNode | null): string | null {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
    if (node?.type === 'TemplateLiteral' && list(node.expressions).length === 0) {
        const quasis = list(node.quasis)
        const cooked = quasis.length === 1 ? object(object(quasis[0])?.value)?.cooked : undefined
        return typeof cooked === 'string' ? cooked : null
    }
    return null
}

/** The names an expression can yield and whether every value position is static. Only a string literal, a static template, `?:` branches and `||`, `&&`, `??` operands are followed; any other node in a value position is not static. */
function valueNames(node: AstNode | null, names: string[]): boolean {
    if (node === null) return false
    const text = staticString(node)
    if (text !== null) { names.push(text); return true }
    if (node.type === 'Literal') return true
    if (node.type === 'ConditionalExpression') return valueNames(object(node.consequent), names) && valueNames(object(node.alternate), names)
    if (node.type === 'LogicalExpression') return valueNames(object(node.left), names) && valueNames(object(node.right), names)
    return false
}

/** Every string literal and static template anywhere in an expression, including the test of a conditional. */
function allStrings(node: AstNode): string[] {
    const found: string[] = []
    visit(node, (inner) => { const text = staticString(inner); if (text !== null) found.push(text) })
    return found
}

const ELEMENT_TYPES = new Set(['RegularElement', 'Component', 'SvelteElement', 'SvelteComponent', 'SvelteSelf', 'SvelteFragment'])
const sameSet = (a: readonly string[], b: readonly string[]): boolean => new Set(a).size === a.length && a.length === b.length && b.every((n) => a.includes(n))

interface Rendered { names: Set<string>; byName: Map<string, Set<string>>; unreviewed: string[] }
/** The `data-part` names of the components' markup, read from the compiler's AST: every `data-part` attribute of an element or component, and a spread on an element, is either a name this reads or a line in `unreviewed`. */
function collect(files: readonly string[]): Rendered {
    const names = new Set<string>()
    const byName = new Map<string, Set<string>>()
    const unreviewed: string[] = []
    const add = (name: string, file: string): void => {
        names.add(name)
        if (!byName.has(name)) byName.set(name, new Set())
        byName.get(name)?.add(rel(file))
    }
    for (const file of files) {
        let ast: AstNode | null
        try {
            ast = object(parse(readFileSync(file, 'utf8'), { modern: true }))
        } catch {
            unreviewed.push(`${rel(file)}: cannot be parsed`)
            continue
        }
        const reviewed = REVIEWED_EXPRESSIONS[rel(file)]
        visit(ast?.fragment, (node) => {
            if (typeof node.type !== 'string' || !ELEMENT_TYPES.has(node.type)) return
            for (const attribute of list(node.attributes)) {
                const item = object(attribute)
                if (item?.type === 'SpreadAttribute') {
                    if ((node.type === 'RegularElement' || node.type === 'SvelteElement') && REVIEWED_SPREADS[rel(file)] === undefined) unreviewed.push(`${rel(file)}: a spread attribute on an element`)
                    continue
                }
                if (item?.type !== 'Attribute' || item.name !== 'data-part') continue
                const parts = list(item.value)
                const single = object(item.value)
                if (item.value === true) {
                    unreviewed.push(`${rel(file)}: a data-part with no value`)
                } else if (single?.type === 'ExpressionTag') {
                    const expression = object(single.expression)
                    const direct = staticString(expression)
                    if (direct !== null) { add(direct, file); continue }
                    const yielded: string[] = []
                    const staticOnly = expression !== null && valueNames(expression, yielded)
                    const ok = reviewed !== undefined && expression !== null && staticOnly && sameSet(allStrings(expression), [...reviewed.literals]) && sameSet(yielded, [...reviewed.parts])
                    if (ok) for (const n of yielded) add(n, file)
                    else unreviewed.push(`${rel(file)}: a data-part expression that is not a reviewed form (${expression?.type ?? 'unknown'})`)
                } else if (parts.length === 1 && object(parts[0])?.type === 'Text' && typeof object(parts[0])?.data === 'string') {
                    add(object(parts[0])?.data as string, file)
                } else {
                    unreviewed.push(`${rel(file)}: a data-part that mixes text and expressions`)
                }
            }
        })
    }
    return { names, byName, unreviewed }
}
const rendered = collect(shellComponents)
const group = (why: string, names: readonly string[]): [string, string][] => names.map((n): [string, string] => [n, why])
/** The names the Settings tree renders that are not settings-* parts: each belongs to another area or is a protected escape part, with the reason it keeps its name. */
const EXEMPT: ReadonlyMap<string, string> = new Map<string, string>([
    ...group('the pattern dialog frame and warning parts (PatternDialog, PatternWarning): another area owns them, and the frame is critical by name', ['pattern-dialog', 'pattern-dialog-announce', 'pattern-layer', 'pattern-scrim', 'pattern-warn-ack', 'pattern-warn-actions', 'pattern-warn-cancel', 'pattern-warn-caret', 'pattern-warn-consequence', 'pattern-warn-consequences', 'pattern-warn-detail', 'pattern-warn-detail-toggle', 'pattern-warn-headline', 'pattern-warn-mark', 'pattern-warn-primary', 'pattern-warn-root', 'pattern-warn-secondary', 'pattern-warn-undo']),
    ...group('the Theme pack row and its tiles: THEME_PACK_ROW_CLOSURE, protected in every registry', THEME_PACK_ROW_CLOSURE.filter((n) => rendered.names.has(n))),
    ...group('the chat shell sheet the Display page opens: a chat part', ['chat-sheet', 'chat-sheet-handle', 'chat-sheet-layer', 'chat-sheet-scrim', 'chat-customize-action', 'chat-customize-preview']),
    ...group('a Studio component, rendered on the Studio screen as well', ['studio-toggle-link']),
    ...group('a name the character asset inputs render as well (AssetInput, CharConfigPanel)', ['asset-name-box']),
])

const SETTINGS_ONLY_PREFIX = /^settings-[a-z0-9-]+$/

describe('S3a-2 census: the rendered Settings parts', () => {
    it('reads every render form: no unreviewed non-literal data-part', () => {
        expect(rendered.unreviewed).toEqual([])
        expect(shellComponents.length).toBeGreaterThan(100)
    })

    it('the roots come from the two registries: every parsed path exists and no component enters a registry in another form', () => {
        for (const imports of parsedImports) for (const i of imports) expect(existsSync(i.resolved), i.specifier).toBe(true)
        REGISTRY_FILES.forEach((file, i) => {
            const forms = registryForms(file, REGISTRY_NAMES[i])
            expect(forms.imported.size, rel(file)).toBeGreaterThan(0)
            expect(forms.values.length, `${rel(file)} record entries`).toBeGreaterThan(0)
            // a spread, a shorthand or a computed key is a component the closure cannot follow
            expect(forms.unrecognised, `${rel(file)} lines of the record literal that are not "key: Identifier"`).toEqual([])
            // an entry whose value is not an imported `.svelte` default (an inline component, a lazy import, a wrapper) is a component the closure cannot follow
            expect(forms.values.filter((value) => !forms.imported.has(value)), rel(file)).toEqual([])
            expect(new Set(forms.values).size, rel(file)).toBeLessThanOrEqual(parsedImports[i].length)
        })
    })

    it('neither registry object is written outside its literal', () => {
        const writers = walk(src, []).filter((file) => !TEST_COMPONENT.test(file) && REGISTRY_WRITE.test(readFileSync(file, 'utf8')))
        expect(writers.map(rel)).toEqual([])
    })

    it('SETTINGS_PARTS equals the recomputation (a mismatch prints the expected list)', () => {
        const expected = new Set([...rendered.names].filter((n) => !EXEMPT.has(n)))
        const missing = [...expected].filter((n) => !SETTINGS_PARTS.has(n))
        const extra = [...SETTINGS_PARTS].filter((n) => !expected.has(n))
        expect({ missing, extra }, `expected SETTINGS_PARTS (${expected.size} names) =\n${[...expected].sort().map((n) => `    '${n}',`).join('\n')}`).toEqual({ missing: [], extra: [] })
    })

    it('every rendered name is a settings-* part or on the reviewed exemption list, and no exemption is stale', () => {
        const unreviewed = [...rendered.names].filter((n) => !SETTINGS_ONLY_PREFIX.test(n) && !EXEMPT.has(n))
        expect(unreviewed).toEqual([])
        for (const [name, why] of EXEMPT) {
            expect(rendered.names.has(name), `${name} is exempt (${why}) but not rendered`).toBe(true)
            expect(SETTINGS_PARTS.has(name), name).toBe(false)
        }
    })

    it('the exempt Theme pack names are the pinned row closure, never renamed', () => {
        for (const name of THEME_PACK_ROW_CLOSURE.filter((n) => rendered.names.has(n))) expect(CRITICAL_PARTS, name).toContain(name)
    })

    it('no settings-* name is rendered outside the shell and legacy Settings trees', () => {
        const everything = walk(path.join(src, 'lib'), []).filter((file) => file.endsWith('.svelte') && !TEST_COMPONENT.test(file))
        const elsewhere = collect(everything.filter((file) => !shell.has(file) && !legacy.has(file)))
        expect([...elsewhere.names].filter((n) => SETTINGS_ONLY_PREFIX.test(n) && n !== 'settings-search-result' && n !== 'settings-search-more')).toEqual([])
    })

    it('every settings part is a part of the Settings area and of no chat or Studio sheet', () => {
        for (const name of SETTINGS_PARTS) {
            expect(isAreaPart('chat', name), name).toBe(false)
            expect(isAreaPart('studio', name), name).toBe(false)
        }
    })
})

describe('S3a-2 tier pin (MC-3249): no live Settings part is in the safe tier', () => {
    /** A live part may be safe only with a reason: "a genuine safe leaf: decoration with no control or warning". */
    const REVIEWED_SAFE_LIVE: readonly string[] = []

    it('the live parts with the safe tier are exactly the reviewed list', () => {
        const safe = [...SETTINGS_PARTS].filter((name) => selectorTier(`[data-part="${name}"]`, SETTINGS_LINT_REGISTRY) === 'safe').sort()
        expect(safe).toEqual([...REVIEWED_SAFE_LIVE].sort())
    })

    /** The live parts a pack cannot name (the engine refuses a selector naming a protected part), each with its reason. MC-3249: a warning or failure line is reach, so no entry is added for one; the plugin access line and the plugin switch carry names the mock critical list does not hold. */
    const REVIEWED_CRITICAL_LIVE: ReadonlyMap<string, string> = new Map<string, string>([
        ...SETTINGS_CRITICAL_CLOSURE.map((name): [string, string] => [name, 'MC-3248: the backup chooser is critical as a whole']),
        ['settings-hotkey-chord', 'the shortcut itself (critical at base)'],
        ['settings-hotkey-conflict', 'the shortcut conflict warning (critical at base)'],
        ['settings-hotkey-conflict-action', 'a button of the conflict warning (critical at base)'],
        ['settings-hotkey-recording', 'the recording line (critical at base)'],
        ['settings-index-display', 'ESCAPE_ROUTE_PARTS: the Display entry on the way out of a bad pack (MC-3424)'],
        ['settings-persona-active', 'the active-persona mark (critical at base)'],
        ['settings-persona-guard', 'the last-persona guard (critical at base)'],
    ])

    it('the live parts refused by name are exactly the reviewed critical list', () => {
        const refused = [...SETTINGS_PARTS].filter((name) => lintAreaPack('settings', `[data-part="${name}"]{background-color:#000}`).errors.some((e) => /names the protected part/.test(e.why))).sort()
        expect(refused).toEqual([...REVIEWED_CRITICAL_LIVE.keys()].sort())
    })

    it('the escape ancestors stay reach or critical', () => {
        for (const name of ESCAPE_ANCESTORS) expect(selectorTier(`[data-part="${name}"]`, SETTINGS_LINT_REGISTRY), name).not.toBe('safe')
        expect(ESCAPE_ANCESTORS.has('settings-display-page')).toBe(true)
        expect(ESCAPE_ANCESTORS.has('display-page')).toBe(false)
    })
})

/** Every part name the Settings screen rendered before the rename, with its current name; one name was split in two. */
const RENAMES: Readonly<Record<string, string>> = {
    'advanced-calm': 'settings-advanced-calm', 'advanced-page': 'settings-advanced-page', 'asset-width': 'settings-asset-width',
    'asset-width-custom': 'settings-asset-width-custom', 'chat-shell-device-settings': 'settings-chat-shell-device-settings', 'connection-add': 'settings-connection-add',
    'connection-add-open': 'settings-connection-add-open', 'connection-add-provider': 'settings-connection-add-provider', 'connection-alert': 'settings-connection-alert',
    'connection-all-added': 'settings-connection-all-added', 'connection-card': 'settings-connection-card', 'connection-chip': 'settings-connection-chip',
    'connection-delete': 'settings-connection-delete', 'connection-detail': 'settings-connection-detail', 'connection-error': 'settings-connection-error',
    'connection-key': 'settings-connection-key', 'connection-key-clear': 'settings-connection-key-clear', 'connection-key-input': 'settings-connection-key-input',
    'connection-key-replace': 'settings-connection-key-replace', 'connection-key-save': 'settings-connection-key-save', 'connection-name': 'settings-connection-name',
    'connection-name-note': 'settings-connection-name-note', 'connection-notice': 'settings-connection-notice', 'connection-notice-dismiss': 'settings-connection-notice-dismiss',
    'connection-save': 'settings-connection-save', 'connection-use': 'settings-connection-use', 'connection-used': 'settings-connection-used',
    'connection-users': 'settings-connection-users', 'connections-empty': 'settings-connections-empty', 'connections-link': 'settings-connections-link',
    'connections-list': 'settings-connections-list', 'connections-root': 'settings-connections-root', 'connections-view': 'settings-connections-view',
    'data-action': 'settings-data-action', 'data-backup-result': 'settings-data-backup-result', 'data-chooser-actions': 'settings-data-chooser-actions',
    'data-chooser-cancel': 'settings-data-chooser-cancel', 'data-chooser-encrypt': 'settings-data-chooser-encrypt', 'data-chooser-encrypt-slow': 'settings-data-chooser-encrypt-slow',
    'data-chooser-encrypt-toggle': 'settings-data-chooser-encrypt-toggle', 'data-chooser-encrypt-warning': 'settings-data-chooser-encrypt-warning', 'data-chooser-format': 'settings-data-chooser-format',
    'data-chooser-heading': 'settings-data-chooser-heading', 'data-chooser-password': 'settings-data-chooser-password', 'data-chooser-password-again': 'settings-data-chooser-password-again',
    'data-chooser-password-label': 'settings-data-chooser-password-label', 'data-chooser-password-problem': 'settings-data-chooser-password-problem', 'data-chooser-password-show': 'settings-data-chooser-password-show',
    'data-chooser-root': 'settings-data-chooser-root', 'data-chooser-scope': 'settings-data-chooser-scope', 'data-chooser-scope-note': 'settings-data-chooser-scope-note',
    'data-chooser-start': 'settings-data-chooser-start', 'data-page': 'settings-data-page', 'device-chip': 'settings-device-chip',
    'display-page': 'settings-display-page', 'input-page': 'settings-input-page', 'language-page': 'settings-language-page',
    'language-pending': 'settings-language-pending', 'low-power': 'settings-low-power', 'mode-checkbox': 'settings-mode-checkbox',
    'mode-fieldset': 'settings-mode-fieldset', 'mode-hide-switch': 'settings-mode-hide-switch', 'mode-lock-reason': 'settings-mode-lock-reason',
    'mode-repair-banner': 'settings-mode-repair-banner', 'mode-row': 'settings-mode-row', 'mode-show-all': 'settings-mode-show-all',
    'mode-show-all-reason': 'settings-mode-show-all-reason', 'mode-status': 'settings-mode-status', 'mode-visibility': 'settings-mode-visibility',
    'mode-visibility-home-note': 'settings-mode-visibility-home-note', 'mode-visibility-note': 'settings-mode-visibility-note', 'mode-visibility-title': 'settings-mode-visibility-title',
    'new-message-button-outline': 'settings-new-message-button-outline', 'new-message-button-row': 'settings-new-message-button-row', 'notification-status': 'settings-notification-status',
    'notifications-off-line': 'settings-notifications-off-line', 'plugin-access': 'settings-plugin-access-level', 'plugin-arg-invalid': 'settings-plugin-arg-invalid',
    'plugin-args': 'settings-plugin-args', 'plugin-export': 'settings-plugin-export', 'plugin-ipc': 'settings-plugin-ipc',
    'plugin-name': 'settings-plugin-name', 'plugin-remove': 'settings-plugin-remove', 'plugin-settings-file': 'settings-plugin-settings-file',
    'plugin-settings-toggle': 'settings-plugin-settings-toggle', 'plugin-switch': 'settings-plugin-enable', 'plugin-update': 'settings-plugin-update',
    'plugin-update-chip': 'settings-plugin-update-chip', 'plugin-version': 'settings-plugin-version', 'plugins-add': 'settings-plugins-add',
    'plugins-check': 'settings-plugins-check', 'plugins-dev': 'settings-plugins-dev', 'plugins-item': 'settings-plugins-item',
    'plugins-page': 'settings-plugins-page', 'plugins-result-current': 'settings-plugins-result-current', 'plugins-result-failed': 'settings-plugins-result-failed',
    'plugins-result-updates': 'settings-plugins-result-updates', 'plugins-results': 'settings-plugins-results', 'plugins-warning': 'settings-plugins-warning',
    'quote-boxes': 'settings-quote-boxes', 'quote-preview': 'settings-quote-preview', 'reduce-card-effects': 'settings-reduce-card-effects',
    'reduce-card-effects-by-low-power': 'settings-reduce-card-effects-by-low-power', 'reduced-motion': 'settings-reduced-motion', 'reply-notifications-help': 'settings-reply-notifications-help',
    'reply-notifications-status': 'settings-reply-notifications-status', 'seasonal-logo': 'settings-seasonal-logo', 'seasonal-logo-help': 'settings-seasonal-logo-help',
    'setting-row-dot': 'settings-row-dot', 'setting-row-ends': 'settings-row-ends', 'setting-row-hint': 'settings-row-hint',
    'setting-row-jump': 'settings-row-jump', 'setting-row-note': 'settings-row-note', 'setting-row-reason': 'settings-row-reason',
    'settings-persona-bound': 'settings-persona-binding', 'settings-persona-count': 'settings-persona-usage', 'settings-persona-handle': 'settings-persona-drag',
    'settings-search-field': 'settings-persona-search', 'theme-cards': 'settings-theme-cards', 'ui-sounds': 'settings-ui-sounds',
    'ui-sounds-help': 'settings-ui-sounds-help', 'ui-sounds-talkback': 'settings-ui-sounds-talkback', 'usage-clear': 'settings-usage-clear',
    'usage-cleared': 'settings-usage-cleared', 'usage-empty': 'settings-usage-empty', 'usage-manage': 'settings-usage-manage',
    'usage-models': 'settings-usage-models', 'usage-months': 'settings-usage-months', 'usage-note': 'settings-usage-note',
    'usage-overflow': 'settings-usage-overflow', 'usage-price-editor': 'settings-usage-price-editor', 'usage-price-invalid': 'settings-usage-price-invalid',
    'usage-price-source': 'settings-usage-price-source', 'usage-purposes': 'settings-usage-purposes', 'settings-hotkey-banner': 'settings-hotkey-readonly-note | settings-hotkey-dup-warning',
}

describe('S3a-2 zero grep (E-7): no pre-rename name is a data-part under src', () => {
    const old = Object.keys(RENAMES)
    const pattern = new RegExp(`data-part\\s*=\\s*["'](${old.join('|')})["']`)

    it('every current name of the table is a Settings part', () => {
        for (const [from, to] of Object.entries(RENAMES)) for (const name of to.split(' | ')) expect(SETTINGS_PARTS.has(name), `${from} -> ${name}`).toBe(true)
    })

    it('no source, test or style block names a pre-rename part', () => {
        const self = fileURLToPath(import.meta.url)
        const hits: string[] = []
        for (const file of walk(src, [])) {
            if (file === self) continue
            const lines = readFileSync(file, 'utf8').split('\n')
            lines.forEach((line, i) => { if (pattern.test(line)) hits.push(`${rel(file)}:${i + 1}`) })
        }
        expect(hits).toEqual([])
    })
})
