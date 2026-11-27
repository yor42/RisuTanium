// @vitest-environment jsdom
/**
 * The folder delete question on its own: its text, where focus starts, and the four ways to leave it without deleting
 * (Cancel, Esc, the backdrop and Back). MOCKED: the page store the Back layer reads. The real English `language` is used.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/alertPrompts', async (importOriginal) => ({ ...(await importOriginal<typeof import('src/ts/alertPrompts')>()), pageCovered: () => false }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
    }
})

import { language } from 'src/lang'
import { dispatchBack, resetBackHandlersForTests } from 'src/ts/backHandlers'
import StudioLoreFolderConfirm from './StudioLoreFolderConfirm.svelte'

let mounted: { app: ReturnType<typeof mount>; host: HTMLElement }[] = []

function show(): { confirmed: number; cancelled: number } {
    const calls = { confirmed: 0, cancelled: 0 }
    const host = document.createElement('div')
    document.body.append(host)
    const app = mount(StudioLoreFolderConfirm, { target: host, props: { name: 'Castle', entries: 2, folders: 1, onconfirm: () => { calls.confirmed += 1 }, oncancel: () => { calls.cancelled += 1 } } })
    mounted.push({ app, host })
    flushSync()
    return calls
}

const part = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-part="${name}"]`)

afterEach(async () => {
    for (const entry of mounted.splice(0)) {
        await unmount(entry.app)
        entry.host.remove()
    }
    resetBackHandlersForTests()
})

describe('T41: the folder delete question', () => {
    test('names the folder and what is in it, is a non-modal alert dialog, and starts on Cancel', () => {
        show()
        const dialog = document.querySelector('[role="alertdialog"]')
        expect(dialog).not.toBeNull()
        expect(dialog?.getAttribute('aria-modal')).toBe('false')
        expect(part('studio-lore-confirm-text')?.textContent).toBe(language.studioLoreFolderDeleteConfirm('Castle', 2, 1))
        expect(dialog?.getAttribute('aria-labelledby')).toBe(part('studio-lore-confirm-text')?.id)
        expect(document.activeElement).toBe(part('studio-lore-confirm-cancel'))
    })

    test('only the Delete button confirms', () => {
        const calls = show()
        part('studio-lore-confirm-delete')!.click()
        expect(calls).toEqual({ confirmed: 1, cancelled: 0 })
    })

    test('Cancel, Esc, a tap on the backdrop and Back each cancel and never confirm', () => {
        const calls = show()
        part('studio-lore-confirm-cancel')!.click()
        part('studio-lore-confirm')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        part('studio-lore-confirm-backdrop')!.click()
        expect(calls).toEqual({ confirmed: 0, cancelled: 3 })
        // A tap inside the dialog is not a tap on the backdrop.
        part('studio-lore-confirm')!.click()
        expect(calls.cancelled).toBe(3)
        dispatchBack()
        expect(calls).toEqual({ confirmed: 0, cancelled: 4 })
    })

    test('an Esc during an IME composition is the IME`s and cancels nothing', () => {
        const calls = show()
        part('studio-lore-confirm')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }))
        expect(calls.cancelled).toBe(0)
    })
})
