// @vitest-environment jsdom

/**
 * Back on the Connections page in both Settings hosts (A11). The legacy host's handler is registered
 * exactly as `Settings.svelte` does (real `backCloseHandler` over the real `settingsBackClose`), before
 * the page mounts, so the page's own handler is newer and answers first.
 * T29 (reproducer): on a base whose page only called `setSettingsSubLevel`, the legacy handler ran and
 * set the index to -1 at width 390. Falsified by M24 (no page handler) and M25 (detail closes before
 * the dialog). T30 (guard): the shell header Back closes the sub-level; falsified by removing
 * `setSettingsSubLevel`.
 * MOCKED: as the sibling page tests (real `$state` DBState, toast host, arm delay).
 */
import 'src/ts/polyfill'
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        additionalSettingsMenu: [],
        easyPanelStore: { open: false },
        MobileGUI: writable(false),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('../../ts/stores.svelte')
})
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/lite', () => ({ isLite: writable(false) }))
vi.mock('../../ts/toast/toastHost.svelte', () => ({ postToast: vi.fn(), postUndoToast: vi.fn() }))
vi.mock('../Nexus/pattern/patternWarning', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../Nexus/pattern/patternWarning')>()),
    armDelayMs: () => 0,
}))

import { backCloseHandler, dispatchBack, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import { setSettingsSubLevel, settingsShellBackSnapshot, settingsShellBackStep } from '../../ts/settingsShell/settingsNavigation'
import { DBState, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { settingsBackClose } from '../Setting/settingsBack'
import Page from './ConnectionsShellPage.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
    window.dispatchEvent(new Event('resize'))
    flushSync()
}

async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function mountPage(): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Page, { target }))
    flushSync()
}

function detailOpen(): boolean {
    return document.querySelector('[data-part="connection-detail"]') !== null
}

function dialogOpen(): boolean {
    return document.querySelector('[data-part="pattern-warn-root"]') !== null
}

async function openDeleteDialog(): Promise<void> {
    document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
    await settle()
    document.querySelector<HTMLElement>('[data-part="connection-delete"]')!.click()
    await settle()
}

beforeEach(() => {
    resetBackHandlersForTests()
    settingsOpen.set(true)
    SettingsMenuIndex.set(18)
    setWidth(390)
    DBState.db = {
        connections: [{ id: 'conn-1', name: 'Home proxy', provider: 'reverse_proxy', key: 'sk-SYNTH-proxy-5678', url: 'https://p.invalid' }],
        proxyConnectionId: '',
        botPresets: [],
        customModels: [],
    } as unknown as Database
    // The legacy host registers this once, when Settings opens, before any page mounts.
    registerBackHandler(backCloseHandler({
        isOpen: () => get(settingsOpen),
        snapshot: () => `${get(settingsOpen)}|${get(SettingsMenuIndex)}`,
        close: settingsBackClose,
    }))
})

afterEach(async () => {
    for (const app of mounted.splice(0)) {
        await unmount(app)
    }
    document.body.innerHTML = ''
    setSettingsSubLevel(null)
    resetBackHandlersForTests()
    setWidth(1280)
})

describe('T29 legacy host Back (A11)', () => {
    test('Back on the detail returns to the list and the page index stays', async () => {
        mountPage()
        document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
        await settle()
        expect(detailOpen()).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(detailOpen()).toBe(false)
        expect(document.querySelector('[data-connection-open="conn-1"]')).not.toBeNull()
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(get(settingsOpen)).toBe(true)
    })

    test('Back on the add flow returns to the list and stores nothing', async () => {
        mountPage()
        document.querySelector<HTMLElement>('[data-part="connection-add-open"]')!.click()
        await settle()
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(document.querySelector('[data-part="connection-add"]')).toBeNull()
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(DBState.db.connections?.length).toBe(1)
    })

    test('with the delete dialog open, Back cancels only the dialog; the next Back closes the detail; the next leaves the page', async () => {
        mountPage()
        await openDeleteDialog()
        expect(dialogOpen()).toBe(true)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(dialogOpen()).toBe(false)
        expect(detailOpen()).toBe(true)
        expect(DBState.db.connections?.length).toBe(1)
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(detailOpen()).toBe(false)
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(dispatchBack()).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
    })
})

describe('T30 shell header Back', () => {
    test('closes a dialog, then the detail, then goes up to the index', async () => {
        mountPage()
        await openDeleteDialog()
        expect(settingsShellBackSnapshot()).toContain('|sub')
        settingsShellBackStep()
        await settle()
        expect(dialogOpen()).toBe(false)
        expect(detailOpen()).toBe(true)
        settingsShellBackStep()
        await settle()
        expect(detailOpen()).toBe(false)
        expect(get(SettingsMenuIndex)).toBe(18)
        expect(settingsShellBackSnapshot()).not.toContain('|sub')
        settingsShellBackStep()
        expect(get(SettingsMenuIndex)).toBe(-1)
    })

    test('leaving the page clears its sub-level', async () => {
        mountPage()
        document.querySelector<HTMLElement>('[data-connection-open="conn-1"]')!.click()
        await settle()
        expect(settingsShellBackSnapshot()).toContain('|sub')
        await unmount(mounted.pop()!)
        expect(settingsShellBackSnapshot()).not.toContain('|sub')
    })
})
