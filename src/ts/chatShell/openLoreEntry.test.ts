/**
 * Where a listed lorebook entry opens (MC-3334): Studio on the entry when Studio can open, else the classic editor's
 * lorebook page of that owner. Regression reproducers for the routing; the Studio and classic openers are mocked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ eligible: true, opened: true }))

vi.mock('../studio/studioSwitch.svelte', () => ({ studioEligible: () => h.eligible }))
vi.mock('../studio/studioScreen.svelte', () => ({ openStudio: vi.fn(() => h.opened) }))
vi.mock('../studio/classicLinks.svelte', () => ({ openInClassicEditor: vi.fn(() => true) }))

import { openLoreEntry, studioTargetOfLoreEntry } from './openLoreEntry'
import { openStudio } from '../studio/studioScreen.svelte'
import { openInClassicEditor } from '../studio/classicLinks.svelte'

const element = {} as HTMLElement

beforeEach(() => {
    h.eligible = true
    h.opened = true
    vi.mocked(openStudio).mockClear()
    vi.mocked(openInClassicEditor).mockClear()
})

describe('openLoreEntry', () => {
    test('regression reproducer: Studio opens on the entry, from the chat, with the tapped element as opener', async () => {
        await openLoreEntry({ owner: { type: 'chat', id: 'chat-1' }, kind: 'lore', item: 'chat-1/lore:2' }, element)
        expect(openStudio).toHaveBeenCalledWith({ owner: { type: 'chat', id: 'chat-1' }, kind: 'lore', item: 'chat-1/lore:2', from: 'chat' }, { element })
        expect(openInClassicEditor).not.toHaveBeenCalled()
    })

    test('regression reproducer: without Studio the classic lorebook page of the owner opens', async () => {
        h.eligible = false
        await openLoreEntry({ owner: { type: 'module', id: 'mod-1' }, kind: 'lore', item: 'mod-1/lore:0' }, element)
        expect(openStudio).not.toHaveBeenCalled()
        expect(openInClassicEditor).toHaveBeenCalledWith('module', 'lore')
    })

    test('regression reproducer: a refused Studio open falls back to the classic page', async () => {
        h.opened = false
        await openLoreEntry({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore' }, element)
        expect(openInClassicEditor).toHaveBeenCalledWith('character', 'lore')
    })

    test('regression reproducer: an entry with no known owner never reaches Studio', async () => {
        await openLoreEntry({ owner: { type: 'module', id: '' }, kind: 'lore' }, element)
        expect(openStudio).not.toHaveBeenCalled()
        expect(openInClassicEditor).toHaveBeenCalledWith('module', 'lore')
    })

    test('regression reproducer: a target with an entry id carries it to the Studio visit', () => {
        expect(studioTargetOfLoreEntry({ owner: { type: 'module', id: 'mod-1' }, kind: 'lore', entry: 'e-1' })).toEqual({ owner: { type: 'module', id: 'mod-1' }, kind: 'lore', entry: 'e-1', from: 'chat' })
    })

    test('compatibility guard: a target with an entry id still falls back to the classic page without Studio', async () => {
        h.eligible = false
        await openLoreEntry({ owner: { type: 'module', id: 'mod-1' }, kind: 'lore', entry: 'e-1' }, element)
        expect(openStudio).not.toHaveBeenCalled()
        expect(openInClassicEditor).toHaveBeenCalledWith('module', 'lore')
    })

    test('a target without an item opens the owner list', () => {
        expect(studioTargetOfLoreEntry({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore' })).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore', from: 'chat' })
    })
})
