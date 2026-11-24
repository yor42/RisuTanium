// @vitest-environment node
// The chat sidebar's elements that carried no part now carry literal chat parts, so a chat pack can name each one as the last
// compound of a selector (sidebar.css itself stays a skipped sheet). Every new name is a CHAT_PARTS member, takes the default
// reach tier of its sidebar neighbours (recolour and respace, never hide or move), is disjoint from the other areas, and is
// rendered as a literal data-part by the component named here.
import { describe, expect, it } from 'vitest'
import { lintAreaPack, type ThemeArea } from './index'
import { CRITICAL_PARTS, ESCAPE_ANCESTORS, ESCAPE_ROUTE_PARTS, REACH_CHAT, SAFE_LEAVES, selectorTier } from './engine'
import { CHAT_PARTS, isAreaPart, isHomePart, isSettingsPart, isStudioPart } from './areaParts'

const sources = import.meta.glob('/src/lib/ChatShell/sidebar/*.svelte', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const source = (file: string): string => sources[`/src/lib/ChatShell/sidebar/${file}`]

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
    ['chat-sidebar-search-box', 'ShellSidebarSearch.svelte'], ['chat-search-character-name', 'ShellSidebarSearch.svelte'],
    ['chat-search-chat-name', 'ShellSidebarSearch.svelte'], ['chat-search-chat-preview', 'ShellSidebarSearch.svelte'],
]

const lint = (area: ThemeArea, css: string) => lintAreaPack(area, css, 'probe')

describe('the chat sidebar parts that were unmarked', () => {
    it('lists 37 names, each once', () => {
        expect(NEW_PARTS).toHaveLength(37)
        expect(new Set(NEW_PARTS.map(([name]) => name)).size).toBe(37)
    })

    it.each(NEW_PARTS)('%s is a chat part', (name) => {
        expect(CHAT_PARTS.has(name)).toBe(true)
        expect(isAreaPart('chat', name)).toBe(true)
    })

    it.each(NEW_PARTS)('%s is rendered as a literal data-part by %s', (name, file) => {
        expect(source(file), `${file} carries data-part="${name}"`).toContain(`data-part="${name}"`)
    })

    it.each(NEW_PARTS)('%s takes the reach tier: a recolour is accepted, hiding and moving are refused', (name) => {
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

    it('the escape-route entry of the sidebar stays protected and unlisted among the new names', () => {
        expect(CRITICAL_PARTS).toContain('sidebar-settings')
        expect(NEW_PARTS.map(([name]) => name)).not.toContain('sidebar-settings')
        expect(lint('chat', '[data-part="sidebar-settings"]{display:none}').ok).toBe(false)
    })
})
