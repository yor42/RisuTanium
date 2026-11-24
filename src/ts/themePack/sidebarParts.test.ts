// @vitest-environment node
// The chat sidebar's elements that carried no part now carry literal chat parts, so a chat pack can name each one as the last
// compound of a selector (sidebar.css itself stays a skipped sheet). Every new name is a CHAT_PARTS member, takes the default
// reach tier of its sidebar neighbours (everything off the tier's allowlist is refused, for example display:none, positioning,
// opacity:0, visibility:hidden and font-size:0; recolour and respace are accepted),
// and is disjoint from the other areas. The ?raw scans below only inventory the sources; that each part sits on the intended
// element is proved by the rendered tests ShellSidebar.parts.svelte.test.ts and SidebarMoreMenu.parts.svelte.test.ts.
import { describe, expect, it } from 'vitest'
import { lintAreaPack, type ThemeArea } from './index'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS, ESCAPE_ROUTE_PARTS, REACH_CHAT, SAFE_LEAVES, selectorTier } from './engine'
import { CHAT_PARTS, isAreaPart, isHomePart, isSettingsPart, isStudioPart } from './areaParts'

const sources = import.meta.glob('/src/lib/ChatShell/sidebar/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = (file: string): string => sources[`/src/lib/ChatShell/sidebar/${file}`]
const renderTests = import.meta.glob('/src/lib/ChatShell/sidebar/*.parts.svelte.test.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Each new sidebar part with the component that renders it literally. */
const NEW_PARTS: ReadonlyArray<readonly [name: string, file: string]> = [
    ['chat-sidebar-heading', 'ShellSidebar.svelte'], ['chat-sidebar-new-row', 'ShellSidebar.svelte'], ['chat-sidebar-new-chat', 'ShellSidebar.svelte'],
    ['chat-sidebar-new-menu-toggle', 'ShellSidebar.svelte'], ['chat-sidebar-new-menu', 'ShellSidebar.svelte'], ['chat-sidebar-import', 'ShellSidebar.svelte'],
    ['chat-sidebar-export-all', 'ShellSidebar.svelte'], ['sidebar-sort-label', 'ShellSidebar.svelte'], ['sidebar-sort-help', 'ShellSidebar.svelte'],
    ['more-header', 'SidebarMoreMenu.svelte'], ['more-back', 'SidebarMoreMenu.svelte'], ['more-title', 'SidebarMoreMenu.svelte'],
    ['more-character-settings', 'SidebarMoreMenu.svelte'], ['more-playground', 'SidebarMoreMenu.svelte'], ['more-bookmarks', 'SidebarMoreMenu.svelte'],
    ['more-branches', 'SidebarMoreMenu.svelte'], ['more-dev-tool', 'SidebarMoreMenu.svelte'], ['more-plugin-item', 'SidebarMoreMenu.svelte'],
    ['row-menu-rename', 'ShellRowMenu.svelte'], ['row-menu-move', 'ShellRowMenu.svelte'], ['row-menu-no-folder', 'ShellRowMenu.svelte'],
    ['row-menu-folder-option', 'ShellRowMenu.svelte'], ['row-menu-new-folder', 'ShellRowMenu.svelte'], ['row-menu-duplicate', 'ShellRowMenu.svelte'],
    ['row-menu-export', 'ShellRowMenu.svelte'], ['row-menu-delete', 'ShellRowMenu.svelte'], ['row-menu-folder-rename', 'ShellRowMenu.svelte'],
    ['row-menu-folder-colour', 'ShellRowMenu.svelte'], ['row-menu-colour-option', 'ShellRowMenu.svelte'], ['row-menu-folder-delete', 'ShellRowMenu.svelte'],
    ['chat-row-name-line', 'ShellChatRow.svelte'], ['chat-row-meta', 'ShellChatRow.svelte'], ['chat-row-actions', 'ShellChatRow.svelte'],
    ['chat-folder-actions', 'ShellChatList.svelte'], ['chat-folder-count', 'ShellChatList.svelte'], ['chat-folder-editing', 'ShellChatList.svelte'],
    ['chat-sidebar-search-box', 'ShellSidebarSearch.svelte'], ['chat-search-character-name', 'ShellSidebarSearch.svelte'],
    ['chat-search-chat-name', 'ShellSidebarSearch.svelte'], ['chat-search-chat-preview', 'ShellSidebarSearch.svelte'],
]

const lint = (area: ThemeArea, css: string) => lintAreaPack(area, css, 'probe')

describe('the chat sidebar parts that were unmarked', () => {
    it('lists 40 names, each once', () => {
        expect(NEW_PARTS).toHaveLength(40)
        expect(new Set(NEW_PARTS.map(([name]) => name)).size).toBe(40)
    })

    it.each(NEW_PARTS)('%s is a chat part', (name) => {
        expect(CHAT_PARTS.has(name)).toBe(true)
        expect(isAreaPart('chat', name)).toBe(true)
    })

    // Source inventory only: a literal inside a comment would pass this. The rendered tests prove placement.
    it.each(NEW_PARTS)('source inventory: %s is a literal data-part in %s', (name, file) => {
        expect(source(file), `${file} carries data-part="${name}"`).toContain(`data-part="${name}"`)
    })

    it.each(NEW_PARTS)('source inventory: %s is named by a rendered placement test', (name) => {
        const named = Object.values(renderTests).some((text) => text.includes(`'${name}'`))
        expect(named, `a *.parts.svelte.test.ts file proves ${name} on a rendered element`).toBe(true)
    })

    it.each(NEW_PARTS)('%s takes the reach tier: a recolour is accepted, display:none and a position move on the part are refused', (name) => {
        const subject = `[data-part="${name}"]`
        expect(selectorTier(subject)).toBe('reach')
        const recolour = lint('chat', `${subject}{background:#ffffff !important;color:#000000 !important}`)
        expect(recolour.errors).toEqual([])
        expect(recolour.ok).toBe(true)
        const hidden = lint('chat', `${subject}{display:none}`)
        expect(hidden.ok).toBe(false)
        const moved = lint('chat', `${subject}{position:absolute;inset-inline-start:4px}`)
        expect(moved.ok).toBe(false)
    })

    it.each(NEW_PARTS)('%s is no critical, escape-route, escape-ancestor, reach-list or safe-leaf name', (name) => {
        for (const list of [CRITICAL_PARTS, ESCAPE_ROUTE_PARTS, REACH_CHAT]) expect(list).not.toContain(name)
        expect(ESCAPE_ANCESTORS.has(name)).toBe(false)
        expect(SAFE_LEAVES.has(name)).toBe(false)
    })

    it.each(NEW_PARTS)('%s belongs to no other area', (name) => {
        expect(isHomePart(name)).toBe(false)
        expect(isSettingsPart(name)).toBe(false)
        expect(isStudioPart(name)).toBe(false)
        expect(isAreaPart('popups', name)).toBe(false)
        expect(isAreaPart('home', name)).toBe(false)
        expect(isAreaPart('settings', name)).toBe(false)
        expect(isAreaPart('studio', name)).toBe(false)
    })

    // MC-3638 known limitation, same as the existing this-chat-delete part: these install although they can make the control
    // unreadable or cover it (a transparent colour, clip-path and width:0 pass with notes; an empty positioned ::after cover
    // passes). The two deletes keep their protected confirm; chat-sidebar-export-all has no confirm, so a hijacked tap starts the export.
    it.each(['row-menu-delete', 'row-menu-folder-delete', 'chat-sidebar-export-all'])('known limitation: %s still accepts a transparent colour, clip-path, zero width and a covering ::after', (name) => {
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

    it('the escape-route entry of the sidebar stays protected and unlisted among the new names', () => {
        expect(CRITICAL_PARTS).toContain('sidebar-settings')
        expect(NEW_PARTS.map(([name]) => name)).not.toContain('sidebar-settings')
        expect(lint('chat', '[data-part="sidebar-settings"]{display:none}').ok).toBe(false)
    })
})
