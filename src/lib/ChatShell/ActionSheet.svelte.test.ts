// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
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
    chatShellStopAndDelete: 'Stop and delete', chatShellDeleteFromHere: 'Delete from here',
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
import { glyphsIn, iconsIn } from './tests/glyphFree'

let target: HTMLElement
let app: ReturnType<typeof ActionSheet> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove() })
// The icon imports resolve lazily; a first mount in a cold run would otherwise exceed the default budget.
beforeAll(async () => { await import('@lucide/svelte') }, 120000)

describe('action sheet groups and icons', () => {
    const every = ['copy', 'copyCard', 'selectText', 'edit', 'translate', 'retranslate', 'editTranslation', 'partialEdit', 'readAloud', 'stepPrev', 'stepNext', 'newReply', 'branch', 'bookmark', 'hideAI', 'hideAbove', 'customizeButtons', 'delete', 'deleteAfter'] as const
    const groupsOf = () => Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-action-group"]'))

    test('TC3-3a: the destructive group is the last group, holds exactly delete and deleteAfter, and is the only one marked', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ActionSheet, { target, props: { open: true, available: every, onaction: vi.fn(), onclose: vi.fn() } })
        flushSync()
        const groups = groupsOf()
        expect(groups).toHaveLength(5)
        expect(groups.filter((group) => group.hasAttribute('data-destructive-group'))).toEqual([groups[groups.length - 1]])
        expect(Array.from(groups[groups.length - 1].querySelectorAll('[data-action]')).map((item) => item.getAttribute('data-action'))).toEqual(['delete', 'deleteAfter'])
        expect(groups[3].querySelector('[data-action="customizeButtons"]')).not.toBeNull()
    })

    test('TC3-3b: every item is an aria-hidden icon plus its exact label, with no glyph text', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ActionSheet, { target, props: { open: true, available: every, onaction: vi.fn(), onclose: vi.fn() } })
        flushSync()
        const items = Array.from(target.querySelectorAll<HTMLElement>('[data-action]'))
        expect(items).toHaveLength(every.length)
        for (const item of items) {
            const icons = iconsIn(item)
            expect(icons, item.getAttribute('data-action') ?? '').toHaveLength(1)
            expect(icons[0].getAttribute('aria-hidden')).toBe('true')
            expect(item.textContent).toBe(item.getAttribute('title'))
        }
        expect(glyphsIn(target)).toEqual([])
    })

    test('TC3-3c: a group with nothing available is not rendered, so no empty group or destructive marker remains', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ActionSheet, { target, props: { open: true, available: ['copy'], onaction: vi.fn(), onclose: vi.fn() } })
        flushSync()
        expect(groupsOf()).toHaveLength(1)
        expect(target.querySelector('[data-destructive-group]')).toBeNull()
    })
})

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
    test('a generating reply labels Delete as Stop and delete, and the range entry reads Delete from here', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const onaction = vi.fn()
        app = mount(ActionSheet, { target, props: { open: true, available: ['delete', 'deleteAfter'], generating: true, onaction, onclose: vi.fn() } })
        flushSync()
        const remove = target.querySelector<HTMLButtonElement>('[data-action="delete"]')!
        expect(remove.textContent).toBe('Stop and delete')
        expect(remove.disabled).toBe(false)
        expect(target.querySelector('[data-action="deleteAfter"]')?.textContent).toBe('Delete from here')
        remove.click()
        expect(onaction).toHaveBeenCalledWith('delete')
    })
    test('the background it is given is inert while the sheet is open', async () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const background = document.createElement('main')
        target.appendChild(background)
        const state = $state({ open: true })
        app = mount(ActionSheet, { target, props: { get open() { return state.open }, available: ['copy'], background: [background], onaction: vi.fn(), onclose: vi.fn() } })
        flushSync()
        expect(background.hasAttribute('inert')).toBe(true)
        state.open = false
        flushSync()
        expect(background.hasAttribute('inert')).toBe(false)
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
