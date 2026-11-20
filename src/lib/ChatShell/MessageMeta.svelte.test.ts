// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: { edit: 'Edit', remove: 'Delete', chatShellMoreActions: 'More actions', chatShellStopAndDelete: 'Stop and delete' } }))
import MessageMeta from './MessageMeta.svelte'
import type { ActionId } from '../../ts/chatShell/actionSlots'
import { glyphsIn, iconsIn, lucideNames } from './tests/glyphFree'

let target: HTMLElement
let app: ReturnType<typeof MessageMeta> | undefined
afterEach(async () => { if (app) await unmount(app); app = undefined; target?.remove(); localStorage.removeItem('risuChatShell.actionSlots') })

describe('message meta actions', () => {
    test('default pins and overflow have accessible targets', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const onaction = vi.fn()
        const onmore = vi.fn()
        app = mount(MessageMeta, { target, props: { name: 'Ari', available: ['edit', 'delete', 'copy'], onaction, onmore } })
        flushSync()
        const edit = target.querySelector<HTMLButtonElement>('[data-action="edit"]')!
        expect(edit.getAttribute('aria-label')).toBe('Edit')
        edit.click()
        expect(onaction).toHaveBeenCalledWith('edit', false)
        const more = target.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!
        more.click()
        expect(onmore).toHaveBeenCalledWith(more)
    })
    test('the pinned Delete is labelled Stop and delete only while the reply is generating', async () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(MessageMeta, { target, props: { name: 'Ari', available: ['edit', 'delete'], onaction: vi.fn(), onmore: vi.fn() } })
        flushSync()
        const settled = target.querySelector<HTMLButtonElement>('[data-action="delete"]')!
        expect(settled.getAttribute('aria-label')).toBe('Delete')
        expect(settled.title).toBe('Delete')
        await unmount(app)
        app = mount(MessageMeta, { target, props: { name: 'Ari', available: ['edit', 'delete'], generating: true, onaction: vi.fn(), onmore: vi.fn() } })
        flushSync()
        const generating = target.querySelector<HTMLButtonElement>('[data-action="delete"]')!
        expect(generating.getAttribute('aria-label')).toBe('Stop and delete')
        expect(generating.title).toBe('Stop and delete')
        expect(target.querySelector<HTMLButtonElement>('[data-action="edit"]')!.getAttribute('aria-label')).toBe('Edit')
    })
    test('a Shift click on Delete reports the modifier and a plain click does not', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        const onaction = vi.fn()
        app = mount(MessageMeta, { target, props: { name: 'Ari', available: ['edit', 'delete'], onaction, onmore: vi.fn() } })
        flushSync()
        const remove = target.querySelector<HTMLButtonElement>('[data-action="delete"]')!
        remove.click()
        remove.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
        expect(onaction).toHaveBeenNthCalledWith(1, 'delete', false)
        expect(onaction).toHaveBeenNthCalledWith(2, 'delete', true)
    })
    test('every pinned action has its own icon, not a shared fallback', async () => {
        await import('@lucide/svelte')
        localStorage.setItem('risuChatShell.actionSlots', JSON.stringify({ order: ['copy', 'bookmark', 'branch', 'hideAI', 'readAloud'], pinned: ['copy', 'bookmark', 'branch', 'hideAI', 'readAloud'] }))
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(MessageMeta, { target, props: { name: 'Ari', available: ['copy', 'bookmark', 'branch', 'hideAI', 'readAloud', 'delete'], onaction: vi.fn(), onmore: vi.fn() } })
        flushSync()
        const icons = [...target.querySelectorAll<HTMLButtonElement>('[data-action]')].map((button) => lucideNames(button).join())
        expect(icons).not.toContain('lucide-puzzle')
        expect(icons).not.toContain('')
        expect(new Set(icons).size).toBe(icons.length)
    }, 120_000)
    // TC2-3 (regression reproducer, replaces "own glyph"): each pinned action is its own Lucide icon and no text glyph remains.
    // deleteAfter is never pinned (partition drops it), so its icon is only reachable through the action sheet.
    test('each pinned action draws its own icon, More is the horizontal ellipsis, and no glyph text remains', async () => {
        await import('@lucide/svelte')
        const expected: Record<string, string> = {
            copy: 'lucide-copy', edit: 'lucide-pencil', translate: 'lucide-languages', readAloud: 'lucide-volume-2', delete: 'lucide-trash-2',
            branch: 'lucide-git-branch', bookmark: 'lucide-bookmark', hideAI: 'lucide-eye-off', newReply: 'lucide-refresh-cw',
            stepPrev: 'lucide-chevron-left', stepNext: 'lucide-chevron-right', selectText: 'lucide-text-select',
            customizeButtons: 'lucide-settings-2', 'plugin:x': 'lucide-puzzle',
        }
        const ids = Object.keys(expected)
        for (let start = 0; start < ids.length; start += 3) {
            const batch = ids.slice(start, start + 3)
            localStorage.setItem('risuChatShell.actionSlots', JSON.stringify({ order: batch, pinned: batch }))
            target = document.createElement('div')
            document.body.appendChild(target)
            app = mount(MessageMeta, { target, props: { name: 'Ari', available: [...batch, 'delete'] as ActionId[], onaction: vi.fn(), onmore: vi.fn() } })
            flushSync()
            for (const id of batch) {
                const button = target.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!
                expect(lucideNames(button), id).toEqual([expected[id]])
                expect(iconsIn(button)[0].getAttribute('aria-hidden'), id).toBe('true')
            }
            expect(glyphsIn(target)).toEqual([])
            expect(lucideNames(target.querySelector('[aria-label="More actions"]')!)).toEqual(['lucide-ellipsis'])
            await unmount(app)
            app = undefined
            target.remove()
        }
    }, 120_000)
    test('the time and the model name carry the single-line classes, the long model name is also the tooltip', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(MessageMeta, { target, props: { name: 'Ari', time: 1_700_000_000_000, model: 'Custom-mock-model-with-a-long-name', available: ['edit'], onaction: vi.fn(), onmore: vi.fn() } })
        flushSync()
        const time = target.querySelector<HTMLElement>('time')!
        const model = target.querySelector<HTMLElement>('.model')!
        expect(time.classList.contains('time')).toBe(true)
        expect(model.textContent).toBe('Custom-mock-model-with-a-long-name')
        expect(model.title).toBe('Custom-mock-model-with-a-long-name')
    })
})
