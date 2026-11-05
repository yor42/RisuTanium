// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: {
    chatShellMoreActions: 'More actions', copy: 'Copy', copyAsCard: 'Copy as card',
    chatShellSelectText: 'Select text', edit: 'Edit', translate: 'Translate',
    retranslate: 'Retranslate', editTranslation: 'Edit translation', chatShellPartialEdit: 'Partial edit',
    chatShellReadAloud: 'Read aloud', chatShellPreviousReply: 'Previous reply',
    chatShellNextReply: 'Next reply', chatShellNewReply: 'New reply',
    chatShellBranch: 'Branch', bookmark: 'Bookmark', disableMessage: 'Hide from AI', disableAbove: 'Hide above from AI',
    remove: 'Delete', removeThisAndFollowingMessages: 'Delete after',
    chatShellCustomizeButtons: 'Customize buttons', chatShellReplyInProgress: 'Writing reply',
} }))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))
vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

import ActionSheet from './ActionSheet.svelte'

let target: HTMLElement
let app: ReturnType<typeof ActionSheet> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })

describe('action sheet', () => {
    test('groups every reachable action and disables delete on a generating reply', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const onaction = vi.fn()
        const available = ['copy', 'copyCard', 'edit', 'translate', 'retranslate', 'editTranslation', 'partialEdit', 'readAloud', 'branch', 'bookmark', 'hideAI', 'hideAbove', 'delete', 'customizeButtons'] as const
        app = mount(ActionSheet, { target, props: { open: true, available, disabled: ['delete'], onaction, onclose: vi.fn() } })
        flushSync()
        for (const id of available) expect(target.querySelector(`[data-action="${id}"]`)).not.toBeNull()
        const remove = target.querySelector<HTMLButtonElement>('[data-action="delete"]')!
        expect(remove.closest('[data-destructive-group]')).not.toBeNull()
        expect(remove.disabled).toBe(true)
        remove.click()
        expect(onaction).not.toHaveBeenCalled()
    })
    test('an enabled entry closes the sheet and reports its id; Escape closes only the sheet', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const onaction = vi.fn()
        const onclose = vi.fn()
        app = mount(ActionSheet, { target, props: { open: true, available: ['copy', 'delete'], onaction, onclose } })
        flushSync()
        target.querySelector<HTMLButtonElement>('[data-action="copy"]')!.click()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(onaction).toHaveBeenCalledWith('copy')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        expect(onaction).toHaveBeenCalledTimes(1)
    })
})
