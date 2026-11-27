// @vitest-environment node
// The partial-edit layers (selection, failed, delete confirm, edit) and the TS-built elements around them (the floating Edit/Delete
// buttons, the code-block menu) carry chat parts (#438 W3-7). 22 names are literal data-part attributes of PartialEditController.svelte,
// 6 are set from TS and are chat parts only through REACH_CHAT. Every non-critical name takes the default reach tier of its chat
// neighbours; chat-partial-delete is the root of the inline delete confirm (MC-2947), protected by name in every area, and it holds
// only the existing protected chat-critical-* names. The ?raw scans only inventory the sources; that each part sits on the intended
// element is proved by PartialEditController.parts.svelte.test.ts and observer.codeMenu.parts.test.ts.
// Test classes: reproducer = fails on the base, guard = passes before and after, diagnostic = pins a known limitation (MC-3638).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { AREA_LINT, lintAreaPack, type JudgedArea } from './index'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS, ESCAPE_ROUTE_PARTS, REACH_CHAT, SAFE_LEAVES, selectorTier } from './engine'
import { CHAT_PARTS, isAreaPart, isHomePart, isSettingsPart, isStudioPart } from './areaParts'
import { censusOfFiles, readFromDisk } from './fixtures/criticalClosure'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')
const CONTROLLER = 'src/lib/ChatScreens/PartialEditController.svelte'
// The two scanned sources are loaded through the module graph, so an in-memory transform of a mutant reaches the scans as well.
const raw = import.meta.glob(['/src/lib/ChatScreens/PartialEditController.svelte', '/src/ts/observer.svelte.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const controller = raw[`/${CONTROLLER}`]
const observer = raw['/src/ts/observer.svelte.ts']
const domTests = [read('src/lib/ChatScreens/PartialEditController.parts.svelte.test.ts'), read('src/ts/observer.codeMenu.parts.test.ts')]

/** The non-critical names the component renders as literal attributes (default reach tier). */
const RENDERED_REACH = [
    'chat-partial-scrim', 'chat-partial-match', 'chat-partial-failed', 'chat-partial-edit', 'chat-partial-header', 'chat-partial-title', 'chat-partial-count',
    'chat-partial-list', 'chat-partial-option', 'chat-partial-option-meta', 'chat-partial-confidence', 'chat-partial-context', 'chat-partial-option-text',
    'chat-partial-actions', 'chat-partial-cancel', 'chat-partial-dismiss', 'chat-partial-message', 'chat-partial-meta', 'chat-partial-hint', 'chat-partial-field',
    'chat-partial-save',
] as const
/** The names set from TS, registry-only. */
const TS_BUILT = [
    'chat-partial-buttons', 'chat-partial-start-edit', 'chat-partial-start-delete', 'chat-code-menu', 'chat-code-menu-copy', 'chat-code-menu-download',
] as const
const ROOT = 'chat-partial-delete'
const REUSED = ['chat-critical-header', 'chat-critical-title', 'chat-critical-body', 'chat-critical-action'] as const
const ALL = [...RENDERED_REACH, ROOT, ...TS_BUILT]

// The chat judge is the installer's entry (lintAreaPack, which includes the effects pass); the other areas go through their judge.
const lint = (area: JudgedArea, css: string) => (area === 'chat' ? lintAreaPack('chat', css, 'probe') : AREA_LINT[area](css, 'probe'))
const AREAS: readonly JudgedArea[] = ['chat', 'popups', 'settings', 'home', 'studio']

describe('lists', () => {
    it('guard: lists 28 names, each once (22 rendered, 6 TS-built)', () => {
        expect(ALL).toHaveLength(28)
        expect(new Set(ALL).size).toBe(28)
        expect(RENDERED_REACH).toHaveLength(21)
        expect(TS_BUILT).toHaveLength(6)
    })

    it.each(ALL)('reproducer: %s is a chat part', (name) => {
        expect(CHAT_PARTS.has(name)).toBe(true)
        expect(isAreaPart('chat', name)).toBe(true)
    })

    // Source inventory only: a literal inside a comment would pass this.
    it.each([...RENDERED_REACH, ROOT])('reproducer (source inventory): %s is a literal data-part of PartialEditController', (name) => {
        expect(controller, `${name}`).toContain(`data-part="${name}"`)
    })

    it.each(TS_BUILT)('reproducer (source inventory): %s is a quoted name in observer.svelte.ts or the controller script', (name) => {
        expect(observer.includes(`'${name}'`) || controller.includes(`setAttribute('data-part', '${name}')`), name).toBe(true)
    })

    it.each(ALL)('guard: %s is named by a rendered DOM test', (name) => {
        expect(domTests.some((text) => text.includes(`'${name}'`)), `a DOM test names ${name}`).toBe(true)
    })

    it.each(ALL)('guard: %s belongs to no other area', (name) => {
        expect(isHomePart(name)).toBe(false)
        expect(isSettingsPart(name)).toBe(false)
        expect(isStudioPart(name)).toBe(false)
        for (const area of ['popups', 'home', 'settings', 'studio'] as const) expect(isAreaPart(area, name), area).toBe(false)
    })
})

describe('the default reach tier of the rendered names', () => {
    it.each(RENDERED_REACH)('reproducer: %s takes the reach tier: a recolour installs, display:none and a position move are refused', (name) => {
        const subject = `[data-part="${name}"]`
        expect(selectorTier(subject)).toBe('reach')
        const recolour = lint('chat', `${subject}{background:#ffffff !important;color:#000000 !important}`)
        expect(recolour.errors).toEqual([])
        expect(recolour.ok).toBe(true)
        expect(lint('chat', `${subject}{display:none}`).ok).toBe(false)
        expect(lint('chat', `${subject}{position:absolute;inset-inline-start:4px}`).ok).toBe(false)
        for (const list of [CRITICAL_PARTS, ESCAPE_ROUTE_PARTS, REACH_CHAT]) expect(list).not.toContain(name)
        expect(ESCAPE_ANCESTORS.has(name)).toBe(false)
        expect(SAFE_LEAVES.has(name)).toBe(false)
    })
})

describe('the TS-built names are registry-only reach parts', () => {
    it.each(TS_BUILT)('reproducer: %s is in REACH_CHAT, no safe leaf and not critical; a recolour installs without notes, hiding and moving are refused', (name) => {
        expect(REACH_CHAT).toContain(name)
        expect(SAFE_LEAVES.has(name)).toBe(false)
        expect(CRITICAL_PARTS).not.toContain(name)
        const subject = `[data-part="${name}"]`
        const recolour = lint('chat', `${subject}{background:#ffffff !important;color:#000000 !important}`)
        expect(recolour.errors).toEqual([])
        expect(recolour.notes ?? []).toEqual([])
        expect(lint('chat', `${subject}{display:none}`).ok).toBe(false)
        expect(lint('chat', `${subject}{position:absolute;inset-inline-start:4px}`).ok).toBe(false)
    })
})

describe('the delete confirm is a protected critical root (MC-2947)', () => {
    it('reproducer: CRITICAL_PARTS contains chat-partial-delete and the four reused names', () => {
        for (const name of [ROOT, ...REUSED]) expect(CRITICAL_PARTS, name).toContain(name)
    })

    it.each(AREAS)('reproducer: %s refuses a selector that names chat-partial-delete as the protected part', (area) => {
        const result = lint(area, `[data-part="${ROOT}"]{border-radius:4px}`)
        expect(result.ok).toBe(false)
        expect(result.errors.map((error) => error.why).join(' | ')).toContain(`names the protected part ${ROOT}`)
    })

    it.each([
        `[data-part="${ROOT}"] [data-part="chat-critical-action"]{color:#000000}`,
        `[data-role="user"] [data-part="${ROOT}"]{display:none}`,
        `[data-part="chat-message"] [data-part="${ROOT}"]{color:#000000}`,
    ])('reproducer: chat refuses %s with the protected reason (the first shape also names chat-critical-action and passes on the base)', (css) => {
        const result = lint('chat', css)
        expect(result.ok).toBe(false)
        expect(result.errors.map((error) => error.why).join(' | ')).toContain('names the protected part')
    })

    it.each(REUSED)('guard: %s stays refused as a protected name', (name) => {
        const result = lint('chat', `[data-part="${name}"]{border-radius:4px}`)
        expect(result.ok).toBe(false)
        expect(result.errors.map((error) => error.why).join(' | ')).toContain('names the protected part')
    })

    it('reproducer: exactly the delete confirm carries data-part-critical in the controller', () => {
        const marked: string[] = []
        const seen = new Set<object>()
        const visit = (value: unknown): void => {
            if (Array.isArray(value)) { value.forEach(visit); return }
            if (value === null || typeof value !== 'object' || seen.has(value)) return
            seen.add(value)
            const node = value as Record<string, unknown>
            if (node.type === 'RegularElement' && Array.isArray(node.attributes)) {
                const attrs = (node.attributes as Array<Record<string, unknown>>)
                if (attrs.some((attr) => attr.name === 'data-part-critical')) {
                    const part = attrs.find((attr) => attr.name === 'data-part')
                    const first = Array.isArray(part?.value) ? (part.value[0] as Record<string, unknown> | undefined)?.data : undefined
                    marked.push(typeof first === 'string' ? first : '(unlisted part)')
                }
            }
            for (const child of Object.values(node)) visit(child)
        }
        visit(parse(controller, { modern: true }))
        expect(marked).toEqual([ROOT])
    })

    it('reproducer: the critical closure of the controller is the root plus the four reused names, all protected', () => {
        const file = path.join(root, CONTROLLER)
        const census = censusOfFiles([file], (name) => (name === file ? controller : readFromDisk(name)))
        expect(census.roots).toEqual([ROOT])
        expect(census.problems).toEqual([])
        expect(census.names).toEqual(['chat-critical-action', 'chat-critical-body', 'chat-critical-header', 'chat-critical-title', ROOT])
        for (const name of census.names) expect(CRITICAL_PARTS, name).toContain(name)
    })
})

// MC-3638 known limitation: the confirm renders inside every message row, so the user-row safe context reaches its ancestors. The
// confirm itself cannot be named, but its row can be hidden or made invisible while the body-level buttons stay reachable.
describe('known limitations (diagnostic pins)', () => {
    it('diagnostic: a user row can be hidden or made invisible with an open confirm in it', () => {
        expect(lint('chat', '[data-part="chat-message"][data-role="user"]{display:none}').ok).toBe(true)
        expect(lint('chat', '[data-part="chat-message"][data-role="user"]{opacity:0}').ok).toBe(true)
    })

    it('diagnostic: the user-row safe context takes a non-critical partial name', () => {
        expect(lint('chat', '[data-role="user"] [data-part="chat-partial-edit"]{display:none}').ok).toBe(true)
    })

    it.each(['chat-partial-start-delete', 'chat-partial-save', 'chat-partial-cancel'])('diagnostic: %s accepts a transparent colour, clip-path, zero width and a covering ::after', (name) => {
        const subject = `[data-part="${name}"]`
        for (const css of [
            `${subject}{color:transparent !important}`,
            `${subject}{clip-path:inset(50%)}`,
            `${subject}{width:0}`,
            `${subject}::after{content:"";position:absolute;inset:-4000px}`,
        ]) {
            expect(lint('chat', css).ok, css).toBe(true)
        }
    })

    it('diagnostic: an effects transform on the user row is accepted', () => {
        expect(lint('chat', '[data-part="chat-message"][data-role="user"]{transform:translateX(4px)}').ok).toBe(true)
    })
})
