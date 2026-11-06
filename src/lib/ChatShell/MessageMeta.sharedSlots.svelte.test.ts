// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: {
    edit: 'Edit', remove: 'Delete', copy: 'Copy', bookmark: 'Bookmark', chatShellMoreActions: 'More actions',
    chatShellCustomizeButtons: 'Customize buttons', chatShellOnThisDevice: 'On this device',
    chatShellMoveUp: 'Move up', chatShellMoveDown: 'Move down', chatShellRestoreDefaults: 'Restore defaults',
} }))
vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))
import MessageMeta from './MessageMeta.svelte'
import CustomizeButtonsSheet from './CustomizeButtonsSheet.svelte'

const KEY = 'risuChatShell.actionSlots'
const available = ['edit', 'delete', 'copy', 'bookmark'] as const
const mounted: Array<{ app: ReturnType<typeof mount>, target: HTMLElement }> = []
afterEach(async () => {
    for (const { app, target } of mounted.splice(0)) { await unmount(app); target.remove() }
    localStorage.removeItem(KEY)
})

function place<T extends Record<string, unknown>>(component: Parameters<typeof mount>[0], props: T): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ app: mount(component, { target, props }), target })
    flushSync()
    return target
}

function row(): HTMLElement {
    return place(MessageMeta, { name: 'Ari', available: [...available], onaction: vi.fn(), onmore: vi.fn() })
}

function pinnedOf(target: HTMLElement): string[] {
    return [...target.querySelectorAll<HTMLElement>('[data-action]')].map((button) => button.dataset.action!)
}

function toggle(sheet: HTMLElement, label: string): void {
    const line = [...sheet.querySelectorAll('[data-part="chat-customize-action"]')].find((item) => item.querySelector('label')?.textContent === label)!
    line.querySelector<HTMLInputElement>('input')!.click()
    flushSync()
}

describe('one shared action layout', () => {
    test('a change made in one sheet reaches every message row without a remount', () => {
        const first = row()
        const second = row()
        const sheet = place(CustomizeButtonsSheet, { open: true, onclose: vi.fn() })
        expect(pinnedOf(first)).toEqual(['edit', 'delete'])
        toggle(sheet, 'Copy')
        expect(pinnedOf(first)).toContain('copy')
        expect(pinnedOf(second)).toContain('copy')
    })

    test('a second sheet opened after the first changed starts from that change and loses nothing', () => {
        const rowHosted = place(CustomizeButtonsSheet, { open: true, background: [document.createElement('main')], onclose: vi.fn() })
        const settingsHosted = place(CustomizeButtonsSheet, { open: true, onclose: vi.fn() })
        const meta = row()
        toggle(rowHosted, 'Copy')
        toggle(settingsHosted, 'Bookmark')
        toggle(rowHosted, 'Edit')
        const stored = JSON.parse(localStorage.getItem(KEY)!)
        expect(stored.pinned).toContain('copy')
        expect(stored.pinned).toContain('bookmark')
        expect(stored.pinned).not.toContain('edit')
        expect(pinnedOf(meta)).toEqual(expect.arrayContaining(['copy', 'bookmark', 'delete']))
        expect(pinnedOf(meta)).not.toContain('edit')
        expect(rowHosted.querySelector('[data-part="chat-customize-preview"]')?.textContent).toBe(settingsHosted.querySelector('[data-part="chat-customize-preview"]')?.textContent)
    })

    test('the rows and sheets show action labels, not raw ids', () => {
        const sheet = place(CustomizeButtonsSheet, { open: true, onclose: vi.fn() })
        const labels = [...sheet.querySelectorAll('[data-part="chat-customize-action"] label')].map((item) => item.textContent)
        expect(labels).toContain('Copy')
        expect(labels).not.toContain('copy')
        expect(sheet.querySelector('[data-part="chat-customize-preview"]')?.textContent).toBe('Edit · Delete')
    })
})
