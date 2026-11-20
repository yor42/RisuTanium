// @vitest-environment jsdom

/**
 * `PromptDiffModal.svelte` as a dialog: it is named and modal, the page behind it is inert while it is open,
 * Tab and Shift+Tab wrap inside the panel, and Escape closes through the same path as the X (the same
 * preference save). Closing restores the page and returns focus to the control that opened the modal.
 * Mounts the REAL component over two fixture presets inside a page with a focusable opener and a background
 * control; only `getDatabase` and the Android Back registry are replaced, as in
 * `PromptDiffModal.names.svelte.test.ts`. The Back stand-in keeps the registered handler so the Back path can
 * be driven.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: {} as unknown }))
const backBox = vi.hoisted(() => ({ handlers: [] as Array<() => boolean> }))

vi.mock(import('../../ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../../ts/storage/database.svelte'))

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: (handler: () => boolean) => {
        backBox.handlers.push(handler)
        return () => {
            const index = backBox.handlers.indexOf(handler)
            if (index >= 0) backBox.handlers.splice(index, 1)
        }
    },
    backCloseHandler: (options: { isOpen: () => boolean, close: () => void }) => () => {
        if (!options.isOpen()) return false
        options.close()
        return true
    },
}))

import PromptDiffModal from './PromptDiffModal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await sleep(20)
        flushSync()
    }
}

function plain(name: string, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', text, name }
}

type Page = {
    page: HTMLElement
    opener: HTMLButtonElement
    background: HTMLButtonElement
    host: HTMLElement
}

let pages: Page[] = []
let apps: Array<Record<string, unknown>> = []
let onClose = vi.fn()

function buildPage(): Page {
    const page = document.createElement('div')
    const opener = document.createElement('button')
    opener.textContent = 'open'
    const background = document.createElement('button')
    background.textContent = 'behind'
    const host = document.createElement('div')
    page.append(opener, background, host)
    document.body.appendChild(page)
    pages.push({ page, opener, background, host })
    return pages[pages.length - 1]
}

async function openModal(): Promise<Page & { app: Record<string, unknown> }> {
    const built = buildPage()
    built.opener.focus()
    const app = mount(PromptDiffModal, { target: built.host, props: { firstPresetId: 0, secondPresetId: 1, onClose } }) as unknown as Record<string, unknown>
    apps.push(app)
    await settle()
    return { ...built, app }
}

const dialogOf = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="dialog"]')!

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
}

beforeEach(() => {
    onClose = vi.fn()
    dbBox.db = {
        botPresets: [
            { promptTemplate: [plain('Main', 'old body'), plain('Gone', 'removed')] },
            { promptTemplate: [plain('Main', 'new body'), plain('Extra', 'added')] },
        ],
    } as unknown as Database
})

afterEach(async () => {
    for (const app of apps) await unmount(app as never).catch(() => {})
    apps = []
    for (const p of pages) p.page.remove()
    pages = []
    backBox.handlers.length = 0
})

describe('PromptDiffModal dialog behaviour', { timeout: 60_000 }, () => {
    test('regression reproducer: the panel is a named modal dialog and the page behind it is inert', async () => {
        const { host, opener, background } = await openModal()
        const dialog = dialogOf(host)
        expect(dialog).not.toBeNull()
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        const name = dialog.getAttribute('aria-label') ?? ''
        expect(name.trim()).not.toBe('')
        expect(opener.hasAttribute('inert')).toBe(true)
        expect(background.hasAttribute('inert')).toBe(true)
        expect(dialog.closest('[inert]')).toBeNull()
    })

    test('regression reproducer: focus starts inside the panel and Tab wraps at both ends', async () => {
        const { host, background } = await openModal()
        const dialog = dialogOf(host)
        expect(dialog.contains(document.activeElement)).toBe(true)

        const tabbable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
            .filter((el) => el.tabIndex >= 0 && !(el as HTMLInputElement).disabled)
        expect(tabbable.length).toBeGreaterThan(1)
        const first = tabbable[0]
        const last = tabbable[tabbable.length - 1]

        last.focus()
        const forward = press('Tab')
        expect(forward.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(first)

        first.focus()
        const backward = press('Tab', { shiftKey: true })
        expect(backward.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(last)

        background.focus()
        expect(dialog.contains(document.activeElement)).toBe(true)
    })

    test('regression reproducer: Escape closes once with the X path, and closing returns focus and releases the page', async () => {
        const { host, opener, background, app } = await openModal()
        const dialog = dialogOf(host)
        expect(dialog).not.toBeNull()

        const event = press('Escape')
        expect(event.defaultPrevented).toBe(true)
        expect(onClose).toHaveBeenCalledTimes(1)
        expect((dbBox.db as { promptDiffPrefs?: unknown }).promptDiffPrefs).toBeDefined()

        // A key held down does not close again.
        press('Escape', { repeat: true })
        expect(onClose).toHaveBeenCalledTimes(1)

        await unmount(app as never)
        apps = apps.filter((a) => a !== app)
        flushSync()
        expect(opener.hasAttribute('inert')).toBe(false)
        expect(background.hasAttribute('inert')).toBe(false)
        expect(document.activeElement).toBe(opener)
    })

    test('guard: Back closes once through the same handler (passes before and after the change)', async () => {
        await openModal()
        expect(backBox.handlers.length).toBeGreaterThan(0)
        const handler = backBox.handlers[backBox.handlers.length - 1]
        expect(handler()).toBe(true)
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(handler()).toBe(false)
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
