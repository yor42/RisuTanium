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
        expect(onaction).toHaveBeenCalledWith('edit')
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
})
