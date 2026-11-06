// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PINNED, partition, readSlots, writeSlots } from './actionSlots'

beforeEach(() => localStorage.clear())

describe('T16 action slots', () => {
    it('defaults to Edit and Delete without writing storage', () => {
        expect(readSlots().pinned).toEqual(DEFAULT_PINNED)
        expect(localStorage.length).toBe(0)
    })
    it('skips unknown ids and duplicates without rewriting the stored value', () => {
        const raw = JSON.stringify({ order: ['mystery', 'copy', 'copy', 'plugin:gone', 'delete'], pinned: ['mystery', 'copy', 'copy', 'plugin:gone'] })
        localStorage.setItem('risuChatShell.actionSlots', raw)
        expect(readSlots()).toEqual({ order: ['copy', 'plugin:gone', 'delete'], pinned: ['copy', 'plugin:gone'] })
        expect(localStorage.getItem('risuChatShell.actionSlots')).toBe(raw)
    })
    it('leaves malformed values intact and writes only on an explicit change', () => {
        localStorage.setItem('risuChatShell.actionSlots', '{oops')
        expect(readSlots().pinned).toEqual(DEFAULT_PINNED)
        expect(localStorage.getItem('risuChatShell.actionSlots')).toBe('{oops')
        writeSlots({ order: ['copy', 'delete'], pinned: ['copy'] })
        expect(readSlots().pinned).toEqual(['copy'])
    })
    it('caps visible pins and keeps Delete in overflow', () => {
        const slots = { order: ['copy', 'edit', 'translate', 'delete', 'bookmark'] as const, pinned: ['copy', 'edit', 'translate', 'bookmark'] as const }
        const result = partition({ order: [...slots.order], pinned: [...slots.pinned] }, ['copy', 'edit', 'translate', 'bookmark'], 3)
        expect(result.pinned).toEqual(['copy', 'edit', 'translate'])
        expect(result.overflow).toContain('bookmark')
        expect(result.overflow).toContain('delete')
    })
})
