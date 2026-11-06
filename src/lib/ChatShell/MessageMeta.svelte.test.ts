// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

vi.mock('../../lang', () => ({ language: { edit: 'Edit', remove: 'Delete', chatShellMoreActions: 'More actions', chatShellStopAndDelete: 'Stop and delete' } }))
import MessageMeta from './MessageMeta.svelte'

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
    test('every pinned action has its own glyph, not a shared bullet', () => {
        localStorage.setItem('risuChatShell.actionSlots', JSON.stringify({ order: ['copy', 'bookmark', 'branch', 'hideAI', 'readAloud'], pinned: ['copy', 'bookmark', 'branch', 'hideAI', 'readAloud'] }))
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(MessageMeta, { target, props: { name: 'Ari', available: ['copy', 'bookmark', 'branch', 'hideAI', 'readAloud', 'delete'], onaction: vi.fn(), onmore: vi.fn() } })
        flushSync()
        const glyphs = [...target.querySelectorAll<HTMLButtonElement>('[data-action]')].map((button) => button.textContent)
        expect(glyphs).not.toContain('•')
        expect(new Set(glyphs).size).toBe(glyphs.length)
    })
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
