// @vitest-environment node
// T0a-24 (GUARD, hygiene): CHAT_PARTS is the generated list of the parts the chat screen renders. It is recomputed here from the
// markup of every Svelte component plus the chat registry, so a rename, a new render of a listed name on another screen, or a new
// component under src/lib/ChatScreens/** fails until the list is reviewed. A miss on this list is a hygiene finding, not a claim.
import { describe, expect, it } from 'vitest'
import { CHAT_CHAINS, CHAT_FIXED_WIDTH, CRITICAL_PARTS, POSITIONABLE, REACH_CHAT, SAFE_LEAVES } from './engine'
import { CHAT_PARTS, LEGACY_CHAT_PARTS, SHARED_CHAT_PARTS, isAreaPart, isStudioPart } from './areaParts'

const sources = import.meta.glob('/src/**/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const TEST_COMPONENT = /\.test\.|Harness|Stub|testHost|\/tests\//
type Screen = 'shell' | 'legacy' | 'studio' | 'other'
const screenOf = (file: string): Screen => (file.startsWith('/src/lib/ChatShell/') ? 'shell' : file.startsWith('/src/lib/ChatScreens/') ? 'legacy' : file.startsWith('/src/lib/Studio/') ? 'studio' : 'other')

/** Every `data-part` attribute that is not a plain literal, by file: the reviewed forms below are the only ones the generator understands. */
const REVIEWED_EXPRESSIONS: Readonly<Record<string, readonly string[]>> = {
    '/src/lib/ChatShell/MessageMeta.svelte': ['chat-message-tts'],
    '/src/lib/SettingsShell/SettingsSearchResults.svelte': ['settings-search-result', 'settings-search-more'],
}

interface Rendered {
    byScreen: Record<Screen, Set<string>>
    unreviewed: string[]
}
function collectRendered(): Rendered {
    const byScreen: Record<Screen, Set<string>> = { shell: new Set(), legacy: new Set(), studio: new Set(), other: new Set() }
    const unreviewed: string[] = []
    for (const [file, source] of Object.entries(sources)) {
        if (TEST_COMPONENT.test(file)) continue
        const markup = source.replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '')
        const screen = screenOf(file)
        for (const m of markup.matchAll(/data-part="([^"]*)"/g)) {
            if (/[{}$]/.test(m[1])) unreviewed.push(`${file}: data-part="${m[1]}"`)
            else byScreen[screen].add(m[1])
        }
        for (const m of markup.matchAll(/data-part=\{([^\n]*)/g)) {
            const quoted = new Set([...m[1].matchAll(/'([a-z][a-z0-9-]*)'/g)].map((n) => n[1]))
            const reviewed = REVIEWED_EXPRESSIONS[file]
            if (!reviewed || reviewed.some((n) => !quoted.has(n))) unreviewed.push(`${file}: data-part={${m[1].trim()}`)
            else for (const n of reviewed) byScreen[screen].add(n)
        }
    }
    return { byScreen, unreviewed }
}
const rendered = collectRendered()
const registryNames = new Set<string>([...CRITICAL_PARTS, ...REACH_CHAT, ...SAFE_LEAVES, ...POSITIONABLE, ...CHAT_FIXED_WIDTH, ...CHAT_CHAINS.flatMap((chain) => chain.parts)])
const outside = new Set<string>([...rendered.byScreen.studio, ...rendered.byScreen.other])

const expected = new Set<string>([...registryNames, ...rendered.byScreen.shell].filter((name) => !outside.has(name)))
for (const name of SHARED_CHAT_PARTS) expected.add(name)
for (const name of LEGACY_CHAT_PARTS) expected.delete(name)
const asConstant = (names: ReadonlySet<string>): string => `new Set<string>([\n${[...names].sort().map((n) => `    '${n}',`).join('\n')}\n])`

describe('T0a-24: the generated chat part list', () => {
    it('reads every render form: no unreviewed non-literal data-part', () => {
        expect(rendered.unreviewed).toEqual([])
        expect(Object.keys(sources).length).toBeGreaterThan(200)
        expect(rendered.byScreen.shell.size).toBeGreaterThan(200)
    })

    it('CHAT_PARTS equals the recomputation (a mismatch prints the expected constant)', () => {
        const missing = [...expected].filter((n) => !CHAT_PARTS.has(n))
        const extra = [...CHAT_PARTS].filter((n) => !expected.has(n))
        expect({ missing, extra }, `expected CHAT_PARTS (${expected.size} names) =\n${asConstant(expected)}`).toEqual({ missing: [], extra: [] })
    })

    it('every name rendered only under src/lib/ChatScreens/** is on the shared or the legacy list', () => {
        const legacyOnly = [...rendered.byScreen.legacy].filter((n) => !rendered.byScreen.shell.has(n) && !outside.has(n))
        const reviewed = new Set<string>([...SHARED_CHAT_PARTS, ...LEGACY_CHAT_PARTS])
        expect(legacyOnly.filter((n) => !reviewed.has(n))).toEqual([])
        for (const n of SHARED_CHAT_PARTS) expect(rendered.byScreen.legacy.has(n), `${n} is rendered under ChatScreens`).toBe(true)
        for (const n of LEGACY_CHAT_PARTS) expect(rendered.byScreen.legacy.has(n) && !rendered.byScreen.shell.has(n), `${n} is legacy-only`).toBe(true)
    })

    it('the legacy-only name is absent and the shared name present', () => {
        for (const n of LEGACY_CHAT_PARTS) expect(CHAT_PARTS.has(n)).toBe(false)
        for (const n of SHARED_CHAT_PARTS) expect(CHAT_PARTS.has(n)).toBe(true)
    })

    it('the registry names that no component renders stay on the list: an accepted pack styles some of them', () => {
        const everywhere = new Set<string>(Object.values(rendered.byScreen).flatMap((names) => [...names]))
        const registryOnly = [...registryNames].filter((n) => !everywhere.has(n))
        expect(registryOnly.length).toBeGreaterThan(0)
        expect(registryOnly.filter((n) => !CHAT_PARTS.has(n))).toEqual([])
        expect(CHAT_PARTS.has('chat-message-actions-float')).toBe(true)
        expect(CHAT_PARTS.has('chat-message-stage')).toBe(true)
    })

    it('names other screens render are not chat parts', () => {
        for (const n of ['reply-new-dot', 'reply-error-dot', 'reply-writing-badge', 'chat-shell-device-settings', 'pattern-dialog', 'settings-page', 'home-shell', 'studio-header']) expect(isAreaPart('chat', n), n).toBe(false)
        for (const n of CHAT_PARTS) expect(outside.has(n), `${n} is rendered outside the chat screen`).toBe(false)
    })

    it('no studio or studio-* name is rendered outside src/lib/Studio/**, and every Studio name has the prefix', () => {
        const strayStudio = [...rendered.byScreen.other, ...rendered.byScreen.shell, ...rendered.byScreen.legacy].filter((n) => isStudioPart(n))
        expect(strayStudio).toEqual([])
        expect([...rendered.byScreen.studio].filter((n) => !isStudioPart(n) && !CHAT_PARTS.has(n) && n !== 'studio')).toEqual([])
    })
})
