// @vitest-environment jsdom

/**
 * The chat-list sort is a device-local choice in `localStorage` (`risuChatShell.chatSort`), never a
 * database field. Reading never writes: an unknown, absent or unreadable value reads as the default.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { readChatSort, writeChatSort } from './deviceSettings'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('TB4 device-local chat sort', () => {
    test('absent reads as recent and nothing is written by the read', () => {
        expect(readChatSort()).toBe('recent')
        expect(localStorage.getItem('risuChatShell.chatSort')).toBeNull()
    })

    test('an unknown stored value reads as recent and is not rewritten', () => {
        localStorage.setItem('risuChatShell.chatSort', 'name')
        expect(readChatSort()).toBe('recent')
        expect(localStorage.getItem('risuChatShell.chatSort')).toBe('name')
    })

    test('both choices round trip under the device key', () => {
        writeChatSort('manual')
        expect(localStorage.getItem('risuChatShell.chatSort')).toBe('manual')
        expect(readChatSort()).toBe('manual')
        writeChatSort('recent')
        expect(readChatSort()).toBe('recent')
    })

    test('storage that throws on read reads as recent, and a throwing write is swallowed', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
        expect(readChatSort()).toBe('recent')
        expect(() => writeChatSort('manual')).not.toThrow()
    })
})
