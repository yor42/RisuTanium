// @vitest-environment jsdom
/**
 * The lorebook list under the latest reply (MC-3333, MC-3334): a count that expands into the entries the send used,
 * each naming its source, and a tap that opens the lorebook editor on that entry.
 * REAL: `ReplyLoreUse.svelte`, the `loreUse` record and target helpers. MOCKED: the language table, the app database
 * (modules only) and the editor opener.
 * Regression reproducers: without the list nothing renders; without the live-name check a moved entry opens the
 * wrong one.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: { modules: [] as { id: string, lorebook?: { comment?: string, key?: string }[] }[] },
}))

vi.mock('../../lang', () => ({
    language: {
        chatShellLoreUsed: (n: number) => `${n} lorebook entries`,
        chatShellLoreUsedList: 'Lorebook entries sent with this reply',
        chatShellLoreSourceModule: 'Module',
        chatShellLoreUntitled: 'Untitled entry',
        character: 'Character',
        Chat: 'Chat',
    },
}))
vi.mock('../../ts/stores.svelte', () => ({ DBState: { db: h.db } }))
vi.mock('../../ts/chatShell/openLoreEntry', () => ({ openLoreEntry: vi.fn(async () => {}) }))

import ReplyLoreUse from './ReplyLoreUse.svelte'
import { noteLoreUse, type LoreUsedEntry } from '../../ts/process/loreUse'
import { openLoreEntry } from '../../ts/chatShell/openLoreEntry'

const ENTRIES: LoreUsedEntry[] = [
    { source: 'character', ownerId: 'cha-1', index: 1, name: 'Harbour' },
    { source: 'chat', ownerId: 'chat-1', index: 0, name: '' },
    { source: 'module', ownerId: 'mod-1', index: 0, name: 'Weather' },
]

let app: ReturnType<typeof mount> | undefined
let target: HTMLElement

function show(chatId: string | undefined, ownerLore = [{ comment: 'Gate' }, { comment: 'Harbour' }]): void {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(ReplyLoreUse, { target, props: { chatId, ownerLore, chat: { id: 'chat-1', localLore: [{ key: '' }] } } })
    flushSync()
}

const part = (name: string) => target.querySelector<HTMLElement>(`[data-part="${name}"]`)
const all = (name: string) => [...target.querySelectorAll<HTMLElement>(`[data-part="${name}"]`)]

beforeEach(() => {
    h.db.modules = [{ id: 'mod-1', lorebook: [{ comment: 'Weather' }] }]
    vi.mocked(openLoreEntry).mockClear()
    noteLoreUse('reply-1', ENTRIES)
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
    noteLoreUse('', [])
})

describe('ReplyLoreUse', () => {
    test('regression reproducer: the latest reply shows a collapsed count; other messages show nothing', async () => {
        show('reply-1')
        const count = part('chat-message-lore-count')
        expect(count?.tagName).toBe('BUTTON')
        expect(count?.textContent).toContain('3 lorebook entries')
        expect(count?.getAttribute('aria-expanded')).toBe('false')
        expect(part('chat-message-lore-list')).toBeNull()
        await unmount(app!)
        app = undefined
        document.body.replaceChildren()
        show('older-reply')
        expect(part('chat-message-lore')).toBeNull()
    })

    test('regression reproducer: the count expands into each entry with its name and source', () => {
        show('reply-1')
        part('chat-message-lore-count')!.click()
        flushSync()
        expect(part('chat-message-lore-count')?.getAttribute('aria-expanded')).toBe('true')
        expect(part('chat-message-lore-list')?.getAttribute('aria-label')).toBe('Lorebook entries sent with this reply')
        expect(all('chat-message-lore-entry').map((row) => [row.querySelector('[data-part="chat-message-lore-name"]')?.textContent, row.querySelector('[data-part="chat-message-lore-source"]')?.textContent])).toEqual([
            ['Harbour', 'Character'],
            ['Untitled entry', 'Chat'],
            ['Weather', 'Module'],
        ])
    })

    test('regression reproducer: a tap opens the editor on the entry while the live list still has it there', () => {
        show('reply-1')
        part('chat-message-lore-count')!.click()
        flushSync()
        const rows = all('chat-message-lore-entry')
        rows[0].click()
        rows[2].click()
        expect(vi.mocked(openLoreEntry).mock.calls.map((call) => call[0])).toEqual([
            { owner: { type: 'character', id: 'cha-1' }, kind: 'lore', item: 'cha-1/lore:1' },
            { owner: { type: 'module', id: 'mod-1' }, kind: 'lore', item: 'mod-1/lore:0' },
        ])
        expect(vi.mocked(openLoreEntry).mock.calls[0][1]).toBe(rows[0])
    })

    test('regression reproducer: an entry moved since the send opens the lorebook list, not the entry now at its index', () => {
        show('reply-1', [{ comment: 'Harbour' }, { comment: 'Gate' }])
        part('chat-message-lore-count')!.click()
        flushSync()
        all('chat-message-lore-entry')[0].click()
        expect(vi.mocked(openLoreEntry).mock.calls[0][0]).toEqual({ owner: { type: 'character', id: 'cha-1' }, kind: 'lore' })
    })

    test('a new send that used no entry clears the list', () => {
        show('reply-1')
        noteLoreUse('reply-2', [])
        flushSync()
        expect(part('chat-message-lore')).toBeNull()
    })
})
