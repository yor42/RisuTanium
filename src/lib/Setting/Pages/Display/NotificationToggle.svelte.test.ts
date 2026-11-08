// @vitest-environment jsdom

/**
 * The notification switch with the real component, the real wrapper-free `Check` and the real permission helper:
 * a missing Notification API never throws and leaves the switch off, the first use asks while the permission is
 * undecided, a refusal turns the switch off with the old error alert, and the status line names the state.
 *
 * MOCKED: `stores.svelte` (a `$state` DBState) and `alert` (a spy for `alertError`). The Notification API is stubbed
 * per test and restored afterwards.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const spies = vi.hoisted(() => ({
    alertError: vi.fn<(message: string) => void>(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: spies.alertError,
}) as unknown as typeof import('src/ts/alert'))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import NotificationToggle from './NotificationToggle.svelte'

const mounted: Array<ReturnType<typeof mount>> = []
const originalPermissions = Object.getOwnPropertyDescriptor(navigator, 'permissions')

async function settle(): Promise<void> {
    for (let round = 0; round < 3; round++) {
        flushSync()
        await tick()
        await Promise.resolve()
    }
}

function show(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(NotificationToggle, { target }))
    flushSync()
    return target
}

function box(target: HTMLElement): HTMLInputElement {
    return target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

function stubPermissionsQuery(query: () => Promise<unknown>): void {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } })
}

beforeEach(() => {
    DBState.db = { notification: false } as unknown as Database
    spies.alertError.mockReset()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    if (originalPermissions) Object.defineProperty(navigator, 'permissions', originalPermissions)
    else Reflect.deleteProperty(navigator, 'permissions')
})

describe('no Notification API (T-B3)', () => {
    test('turning the switch on does not throw, turns it off, shows the unsupported line and no alert', async () => {
        vi.stubGlobal('Notification', undefined)
        stubPermissionsQuery(() => Promise.reject(new Error('no permissions api')))
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        try {
            const target = show()
            box(target).click()
            await settle()
            expect(unhandled).not.toHaveBeenCalled()
            expect(DBState.db.notification).toBe(false)
            expect(box(target).checked).toBe(false)
            expect(spies.alertError).not.toHaveBeenCalled()
            expect(target.querySelector('[data-part="notification-status"]')!.textContent).toBe(language.settingsShellNotificationUnsupported)
        } finally {
            process.off('unhandledRejection', unhandled)
        }
    })
})

describe('status line', () => {
    test.each([
        ['granted', () => language.settingsShellNotificationGranted],
        ['denied', () => language.settingsShellNotificationDenied],
        ['default', () => language.settingsShellNotificationDefault],
    ] as const)('names the %s permission', (permission, expected) => {
        vi.stubGlobal('Notification', { permission, requestPermission: vi.fn() })
        const target = show()
        expect(target.querySelector('[data-part="notification-status"]')!.textContent).toBe(expected())
    })

    test('names a missing API as unsupported', () => {
        vi.stubGlobal('Notification', undefined)
        const target = show()
        expect(target.querySelector('[data-part="notification-status"]')!.textContent).toBe(language.settingsShellNotificationUnsupported)
    })
})

describe('first use and refusal (T-B4)', () => {
    test('an undecided permission is asked exactly once on the first switch-on, and a grant keeps the switch on', async () => {
        const requestPermission = vi.fn(async () => 'granted')
        vi.stubGlobal('Notification', { permission: 'default', requestPermission })
        stubPermissionsQuery(async () => ({ state: 'prompt' }))
        const target = show()
        box(target).click()
        await settle()
        expect(requestPermission).toHaveBeenCalledTimes(1)
        expect(DBState.db.notification).toBe(true)
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('a refusal on the first ask turns the switch off, shows the old error alert and the blocked line', async () => {
        const requestPermission = vi.fn(async () => 'denied')
        vi.stubGlobal('Notification', { permission: 'default', requestPermission })
        stubPermissionsQuery(async () => ({ state: 'prompt' }))
        const target = show()
        box(target).click()
        await settle()
        expect(requestPermission).toHaveBeenCalledTimes(1)
        expect(DBState.db.notification).toBe(false)
        expect(box(target).checked).toBe(false)
        expect(spies.alertError).toHaveBeenCalledExactlyOnceWith(language.permissionDenied)
        expect(target.querySelector('[data-part="notification-status"]')!.textContent).toBe(language.settingsShellNotificationDenied)
    })

    test('an already blocked permission is not asked again and turns the switch off with the alert', async () => {
        const requestPermission = vi.fn(async () => 'granted')
        vi.stubGlobal('Notification', { permission: 'denied', requestPermission })
        stubPermissionsQuery(async () => ({ state: 'denied' }))
        const target = show()
        box(target).click()
        await settle()
        expect(requestPermission).not.toHaveBeenCalled()
        expect(DBState.db.notification).toBe(false)
        expect(spies.alertError).toHaveBeenCalledExactlyOnceWith(language.permissionDenied)
    })

    test('an already granted permission keeps the switch on without asking', async () => {
        const requestPermission = vi.fn(async () => 'granted')
        vi.stubGlobal('Notification', { permission: 'granted', requestPermission })
        const target = show()
        box(target).click()
        await settle()
        expect(requestPermission).not.toHaveBeenCalled()
        expect(DBState.db.notification).toBe(true)
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('turning the switch off asks nothing and writes false', async () => {
        const requestPermission = vi.fn(async () => 'granted')
        vi.stubGlobal('Notification', { permission: 'default', requestPermission })
        DBState.db = { notification: true } as unknown as Database
        const target = show()
        box(target).click()
        await settle()
        expect(requestPermission).not.toHaveBeenCalled()
        expect(DBState.db.notification).toBe(false)
    })
})
