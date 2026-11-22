// @vitest-environment node
// The escape route (MC-3424): the controls that lead out of a bad pack are protected parts in every registry, the parts that enclose
// them are never safe, and a selector cannot name the island attribute. TA-1..TA-4 judge CSS, TA-5(a)..(d) read the real components.
// The mounted-screen walk (escapeWalk.svelte.test.ts) is the authority for the ancestor list; the census here is only its lower bound.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { AREA_LINT, lintAreaPack, THEME_AREAS } from './index'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS, ESCAPE_ROUTE_PARTS, THEME_PACK_ROW_CLOSURE, lintPack as engineLint, selectorTier, type RegistryInput } from './engine'
import { HOME_REGISTRY } from './registries/home'
import { SETTINGS_REGISTRY } from './registries/settings'
import { STUDIO_REGISTRY } from './registries/studio'
import {
    ESCAPE_FIXTURE_SITES, THEME_PACK_ROW_ROOTS, TEST_ONLY_COMPONENTS, censusOfFiles, censusOfParts, enclosingPartsOfRoots, escapeSites, escapeSourceFiles, readFromDisk,
} from './fixtures/criticalClosure'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const abs = (rel: string): string => path.join(root, rel)

interface PackLint {
    lintPack: (css: string, name?: string, registry?: RegistryInput) => { ok: boolean, errors: { why: string }[] }
    ESCAPE_ANCESTORS: ReadonlySet<string>
    ESCAPE_ROUTE_PARTS: readonly string[]
    THEME_PACK_ROW_CLOSURE: readonly string[]
    CRITICAL_PARTS: readonly string[]
    SAFE_LEAVES: ReadonlySet<string>
}
const packlint = await import(/* @vite-ignore */ pathToFileURL(abs('docs/design/chat/checks/th/packlint.mjs')).href) as PackLint

const ROW_LOADER = 'src/lib/Setting/Pages/Display/ThemePackRowLoader.svelte'
const ROW = 'src/lib/Setting/Pages/Display/ThemePackRow.svelte'
const ESCAPE_WALK_ROOTS: ReadonlySet<string> = new Set([...ESCAPE_ROUTE_PARTS, ...THEME_PACK_ROW_ROOTS])
/** Names reserved before their element exists; the entry must be removed once a component renders it. */
const UNSITED: readonly string[] = []

const refusals = (result: { ok: boolean, errors: { why: string }[] }): string => (result.ok ? 'accepted' : result.errors.map((e) => e.why).join(' | '))
const protectedPart = (name: string): string => `names the protected part ${name}`

describe('TA-1 the settings buttons of the chat shell are protected', () => {
    for (const name of ['sidebar-settings', 'this-chat-all-settings']) {
        it(`a chat sheet naming ${name} is refused`, () => {
            const result = lintAreaPack('chat', `[data-part="${name}"]{border-radius:4px}`)
            expect(refusals(result)).toContain(protectedPart(name))
        })
    }
})

describe('TA-2 every escape name and the row closure are protected in every area', () => {
    const row = censusOfFiles([abs(ROW_LOADER), abs(ROW)]).names
    const names = [...ESCAPE_ROUTE_PARTS, ...row]
    it('the closure the census reads equals THEME_PACK_ROW_CLOSURE', () => {
        expect(THEME_PACK_ROW_CLOSURE, `regenerate: ${JSON.stringify(row)}`).toEqual(row)
    })
    for (const area of THEME_AREAS) {
        it(`the ${area} lint refuses each name`, () => {
            const accepted = names.filter((name) => !refusals(AREA_LINT[area](`[data-part="${name}"]{border-radius:4px}`, area)).includes(protectedPart(name)))
            expect(accepted).toEqual([])
        })
    }
    it('the pinned names are the names of CRITICAL_PARTS, in the engine and in the packlint mirror', () => {
        for (const list of [CRITICAL_PARTS, packlint.CRITICAL_PARTS]) {
            for (const name of names) expect(list, name).toContain(name)
        }
        expect([...packlint.ESCAPE_ROUTE_PARTS]).toEqual(ESCAPE_ROUTE_PARTS)
        expect([...packlint.THEME_PACK_ROW_CLOSURE]).toEqual(THEME_PACK_ROW_CLOSURE)
        expect([...packlint.ESCAPE_ANCESTORS].sort()).toEqual([...ESCAPE_ANCESTORS].sort())
    })
})

describe('TA-3 a part that encloses an escape control is not a safe leaf', () => {
    const css = '[data-part="chat-sidebar-footer"]{opacity:0}'
    it('the engine refuses it', () => {
        expect(engineLint(css).ok).toBe(false)
        expect(lintAreaPack('chat', css).ok).toBe(false)
    })
    it('the packlint mirror refuses it', () => {
        expect(packlint.lintPack(css).ok).toBe(false)
    })
})

describe('TA-4 the island attribute is unnameable', () => {
    const css = '[data-part="chat-header"][data-own-scheme]{border-radius:4px}'
    it('the engine refuses a selector naming data-own-scheme', () => {
        expect(refusals(engineLint(css))).toContain('names data-own-scheme')
    })
    it('the packlint mirror refuses it', () => {
        expect(refusals(packlint.lintPack(css))).toContain('names data-own-scheme')
    })
})

interface AstNode { readonly type?: string, readonly [key: string]: unknown }
const asNode = (value: unknown): AstNode | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AstNode : null)
const attr = (element: AstNode, name: string): AstNode | null => {
    for (const a of Array.isArray(element.attributes) ? element.attributes : []) {
        const node = asNode(a)
        if (node?.type === 'Attribute' && node.name === name) return node
    }
    return null
}
const literal = (element: AstNode, name: string): string | null => {
    const value = asNode(attr(element, name))?.value
    const first = Array.isArray(value) && value.length === 1 ? asNode(value[0]) : null
    return first?.type === 'Text' && typeof first.data === 'string' ? first.data : null
}
interface SiteFacts { name: string, marked: boolean, partAncestors: string[], partDescendants: string[] }
/** Every `rootParts` element of a file in document order, with its marker and the literal parts above and below it. */
function factsOf(file: string, rootParts: ReadonlySet<string>): SiteFacts[] {
    const facts: SiteFacts[] = []
    const ast = asNode(parse(fs.readFileSync(file, 'utf8'), { modern: true }))
    const stack: AstNode[] = []
    const partsBelow = (value: unknown, into: string[]): void => {
        if (Array.isArray(value)) { for (const item of value) partsBelow(item, into); return }
        const node = asNode(value)
        if (node === null) return
        if (node.type === 'RegularElement') {
            const part = literal(node, 'data-part')
            if (part !== null) into.push(part)
        }
        for (const [key, child] of Object.entries(node)) if (key !== 'metadata' && key !== 'parent') partsBelow(child, into)
    }
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) { for (const item of value) visit(item); return }
        const node = asNode(value)
        if (node === null) return
        if (node.type === 'RegularElement') {
            const part = literal(node, 'data-part')
            if (part !== null && rootParts.has(part)) {
                const below: string[] = []
                partsBelow(node.fragment, below)
                const above = stack.filter((n) => n.type === 'RegularElement').map((n) => literal(n, 'data-part')).filter((p): p is string => p !== null)
                facts.push({ name: part, marked: attr(node, 'data-part-critical') !== null, partAncestors: above, partDescendants: below })
            }
        }
        stack.push(node)
        for (const [key, child] of Object.entries(node)) if (key !== 'metadata' && key !== 'parent') visit(child)
        stack.pop()
    }
    visit(asNode(ast)?.fragment)
    return facts
}

const files = escapeSourceFiles(root)
const scanned = escapeSites(files, root, ESCAPE_WALK_ROOTS)

describe('TA-5(a) the escape elements carry their names and markers', () => {
    it('every escape-route name has a site, except the names reserved for a later element', () => {
        const sitedNames = new Set(scanned.map((key) => key.split('#')[1]))
        expect(ESCAPE_ROUTE_PARTS.filter((name) => !sitedNames.has(name))).toEqual([...UNSITED])
    })

    it('every sited element is marked, except the two hamburger wrappers, which hold no part and sit under none', () => {
        const unmarked: string[] = []
        for (const rel of new Set(scanned.map((key) => key.split('#')[0]))) {
            for (const fact of factsOf(abs(rel), ESCAPE_WALK_ROOTS)) {
                if (fact.marked) continue
                unmarked.push(`${rel}#${fact.name}`)
                expect(fact.partAncestors, `${rel}#${fact.name} ancestors`).toEqual([])
                expect(fact.partDescendants, `${rel}#${fact.name} descendants`).toEqual([])
            }
        }
        expect(unmarked).toEqual(['src/lib/SideBars/Sidebar.svelte#rail-settings', 'src/lib/SideBars/Sidebar.svelte#rail-settings'])
    })
})

describe('TA-5(b) the row closure', () => {
    const census = censusOfFiles([abs(ROW_LOADER), abs(ROW)])
    it('is the pinned closure, and its one unresolvable component is the loader’s dynamic row', () => {
        expect(census.names).toEqual(THEME_PACK_ROW_CLOSURE)
        expect(census.problems.map((p) => path.relative(root, p).split(path.sep).join('/'))).toEqual([`${ROW_LOADER}: component Row under a critical root cannot be resolved`])
    })
})

/** Each stop the upward census reports, with the walk fixtures (or the guard) that cover that hop. */
const EXPECTED_PROBLEMS: Readonly<Record<string, readonly string[]>> = {
    "src/App.svelte: a root or render site inside component AlertInertScope's children; AlertInertScope's own wrapper parts are not followed": ['guard:AlertInertScope'],
    "src/lib/ChatShell/ThisChatSheet.svelte: a root or render site inside component ShellSheet's children; ShellSheet's own wrapper parts are not followed": ['F2'],
    'src/lib/ChatShell/ThisChatSheet.svelte: rendered by no scanned file; the parts above it are not followed': ['F2'],
    [`${ROW}: rendered by no scanned file; the parts above it are not followed`]: ['F5', 'F6'],
    [`${ROW_LOADER}: rendered by no scanned file; the parts above it are not followed`]: ['F5', 'F6'],
}

describe('TA-5(c) the upward census is a lower bound of ESCAPE_ANCESTORS', () => {
    const upward = enclosingPartsOfRoots(files, readFromDisk, { rootParts: ESCAPE_WALK_ROOTS, tops: [abs('src/App.svelte')], aliasRoot: root })
    it('every enclosing part that is not critical is listed (subset, not equality)', () => {
        const unlisted = upward.names.filter((name) => !CRITICAL_PARTS.includes(name) && !ESCAPE_ANCESTORS.has(name))
        expect(unlisted).toEqual([])
    })
    it('the stops are exactly the pinned table', () => {
        expect([...upward.problems]).toEqual(Object.keys(EXPECTED_PROBLEMS).sort())
    })
    it('each entry maps to walk fixtures that render a site in the problem’s file, or to the AlertInertScope guard', () => {
        for (const [problem, covers] of Object.entries(EXPECTED_PROBLEMS)) {
            const file = problem.slice(0, problem.indexOf(':'))
            for (const cover of covers) {
                if (cover.startsWith('guard:')) continue
                const sites = ESCAPE_FIXTURE_SITES[cover]
                expect(sites, `${cover} is not a walk fixture`).toBeDefined()
                expect(sites.some((site) => site.startsWith(`${file}#`)), `${cover} renders no site in ${file}`).toBe(true)
            }
        }
    })
    it('guard:AlertInertScope renders only its children, and neither it nor App carries a data-part', () => {
        const wrapper = abs('src/lib/UI/GUI/AlertInertScope.svelte')
        expect(censusOfParts([wrapper, abs('src/App.svelte')]).parts).toEqual([])
        expect(fs.readFileSync(wrapper, 'utf8')).toContain('{@render children?.()}')
    })
})

describe('TA-5(c) the render contexts of the files the census cannot lift', () => {
    const SOURCES = ((): string[] => {
        const out: string[] = []
        const walk = (dir: string): void => {
            for (const name of fs.readdirSync(dir)) {
                const full = path.join(dir, name)
                if (fs.statSync(full).isDirectory()) walk(full)
                else if (/\.(ts|svelte)$/.test(name) && !/\.test(-helpers)?\./.test(name) && !full.includes(path.join('themePack', 'fixtures'))) out.push(full)
            }
        }
        walk(abs('src'))
        return out
    })()
    const rel = (file: string): string => path.relative(root, file).split(path.sep).join('/')
    const skipped = new Set(TEST_ONLY_COMPONENTS)
    const texts = new Map(SOURCES.filter((file) => !skipped.has(rel(file))).map((file) => [file, fs.readFileSync(file, 'utf8')] as const))
    const referrers = (pattern: RegExp): string[] => [...texts].filter(([, text]) => pattern.test(text)).map(([file]) => rel(file)).sort()

    it('the files that import each unlifted component are pinned, dynamic imports and component maps included', () => {
        expect(referrers(/['"][^'"]*\/ThisChatSheet\.svelte['"]/)).toEqual(['src/lib/ChatShell/ChatShell.svelte'])
        expect(referrers(/['"][^'"]*\/ThemePackRowLoader\.svelte['"]/)).toEqual(['src/ts/setting/customComponents.ts'])
        expect(referrers(/['"]\.\/ThemePackRow\.svelte['"]/)).toEqual([ROW_LOADER])
    })
    it('the settings data that places the Theme pack row are pinned', () => {
        expect(referrers(/'ThemePackRow'|display\.themePack/)).toEqual([
            ROW_LOADER, 'src/ts/setting/customComponents.ts', 'src/ts/setting/displaySettingsData.svelte.ts', 'src/ts/setting/displayShellSettingsData.ts', 'src/ts/setting/utils.ts',
        ])
    })
    it('no product file imports a test-only component', () => {
        for (const test of TEST_ONLY_COMPONENTS) {
            const base = path.basename(test)
            expect(referrers(new RegExp(`['"][^'"]*/${base.replace(/\./g, '\\.')}['"]`)), base).toEqual([])
        }
    })
})

describe('TA-5(d) no registry and no area treats an escape ancestor as safe', () => {
    const names = [...ESCAPE_ANCESTORS]
    const registries: [string, RegistryInput | undefined][] = [
        ['chat', undefined], ['settings', SETTINGS_REGISTRY], ['home', HOME_REGISTRY], ['studio', STUDIO_REGISTRY], ['synthetic', { safe: names }],
    ]
    it('the list is not empty', () => {
        expect(names.length).toBeGreaterThan(8)
    })
    for (const [label, registry] of registries) {
        it(`${label}: no ancestor has the safe tier`, () => {
            expect(names.filter((name) => selectorTier(`[data-part="${name}"]`, registry) === 'safe')).toEqual([])
        })
    }
    for (const area of THEME_AREAS) {
        it(`${area}: hiding or fading any ancestor is refused`, () => {
            const accepted = names.filter((name) => (['opacity:0', 'display:none'] as const).some((decl) => AREA_LINT[area](`[data-part="${name}"]{${decl}}`, area).ok))
            expect(accepted).toEqual([])
        })
    }
    it('the packlint mirror refuses the same, with a registry that lists every ancestor as safe', () => {
        const accepted = names.filter((name) => (['opacity:0', 'display:none'] as const).some((decl) => packlint.lintPack(`[data-part="${name}"]{${decl}}`, '', { safe: names }).ok))
        expect(accepted).toEqual([])
    })
})

/** The `.svelte` files each fixture's mount renders (never mocked), and the `.ts` modules that choose the components between them (never mocked in any walk). */
const CHAIN_FILES: Readonly<Record<string, readonly string[]>> = {
    F1: ['src/lib/SideBars/Sidebar.svelte', 'src/lib/ChatShell/sidebar/ShellSidebar.svelte'],
    F2: ['src/lib/ChatScreens/ChatScreen.svelte', 'src/lib/ChatShell/ChatShell.svelte', 'src/lib/ChatShell/ThisChatSheet.svelte', 'src/lib/ChatShell/ShellSheet.svelte'],
    F3: ['src/lib/ChatScreens/ChatScreen.svelte', 'src/lib/ChatScreens/DefaultChatScreen.svelte', 'src/lib/UI/Home/HomeShell.svelte', 'src/lib/UI/Home/HomeDrawer.svelte'],
    F4: ['src/lib/SettingsShell/SettingsSurface.svelte', 'src/lib/SettingsShell/SettingsShell.svelte', 'src/lib/SettingsShell/SettingsShellIndex.svelte'],
    F5: ['src/lib/SettingsShell/SettingsSurface.svelte', 'src/lib/SettingsShell/SettingsShell.svelte', 'src/lib/SettingsShell/SettingsShellPage.svelte', 'src/lib/SettingsShell/DisplayShellPage.svelte', 'src/lib/SettingsShell/ShellSettingRow.svelte',
        'src/lib/Setting/Wrappers/SettingCustom.svelte', ROW_LOADER, ROW],
    F6: ['src/lib/SettingsShell/SettingsSurface.svelte', 'src/lib/Setting/Settings.svelte', 'src/lib/Setting/Pages/DisplaySettings.svelte', 'src/lib/Setting/SettingRenderer.svelte', 'src/lib/Setting/Wrappers/SettingCustom.svelte', ROW_LOADER, ROW],
    F7: ['src/lib/SideBars/Sidebar.svelte'],
    F8: ['src/lib/Others/BootPackEscape.svelte'],
}
const HOP_MODULES: readonly string[] = ['src/ts/setting/customComponents.ts', 'src/ts/setting/settingRegistry.ts']
/** The walk test files and the fixtures each mounts. */
const WALK_FILES: Readonly<Record<string, readonly string[]>> = {
    'escapeWalk.svelte.test.ts': ['F1', 'F7'],
    'escapeWalk.settings.svelte.test.ts': ['F4', 'F5', 'F6'],
    'escapeWalk.chat.svelte.test.ts': ['F2'],
    'escapeWalk.home.svelte.test.ts': ['F3'],
    'escapeWalk.bootBanner.svelte.test.ts': ['F8'],
}

describe('TA-5(e) the walk table and its mocks', () => {
    it('the fixtures declare exactly the escape sites the scan finds, so a new site without a fixture fails', () => {
        const declared = [...new Set(Object.values(ESCAPE_FIXTURE_SITES).flat())].sort()
        expect(declared).toEqual(scanned)
    })

    it('every walk test file is accounted for, and the files cover every fixture once', () => {
        const dir = path.dirname(fileURLToPath(import.meta.url))
        expect(fs.readdirSync(dir).filter((name) => /^escapeWalk.*\.test\.ts$/.test(name)).sort()).toEqual(Object.keys(WALK_FILES).sort())
        expect(Object.values(WALK_FILES).flat().sort()).toEqual(Object.keys(ESCAPE_FIXTURE_SITES).sort())
        expect(Object.keys(CHAIN_FILES).sort()).toEqual(Object.keys(ESCAPE_FIXTURE_SITES).sort())
    })

    it('no walk test mocks a file on its fixtures chains or a hop module, by vi.mock or vi.doMock', () => {
        const dir = path.dirname(fileURLToPath(import.meta.url))
        const bare = (file: string): string => file.replace(/\.(svelte|ts)$/, '')
        for (const [file, fixtures] of Object.entries(WALK_FILES)) {
            const forbidden = new Set([...fixtures.flatMap((id) => CHAIN_FILES[id]), ...HOP_MODULES].map((rel) => bare(path.join(root, rel))))
            const source = fs.readFileSync(path.join(dir, file), 'utf8')
            const specifiers = [...source.matchAll(/vi\.(?:doMock|mock)\(\s*(?:import\(\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1])
            expect(specifiers.length, `${file} mocks nothing`).toBeGreaterThan(0)
            for (const specifier of specifiers) {
                const resolved = specifier.startsWith('src/') ? path.join(root, specifier) : specifier.startsWith('.') ? path.resolve(dir, specifier) : null
                if (resolved !== null) expect(forbidden.has(bare(resolved)), `${file} mocks ${specifier}`).toBe(false)
            }
        }
    })
})