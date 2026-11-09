// @vitest-environment happy-dom

/**
 * The Android "Reply notifications" switch (CHORE-685 S1b): it shows the host-reported state (opted in and allowed by the
 * system), asks the host through the real page module, puts itself back when the host does not confirm, names a system
 * block, and is offered on Android only while the web notification switch is hidden there.
 *
 * MOCKED: the Android channel (a fake) and `isAndroidTransport` (a flag). The page module, the real `Check` and the real
 * settings data are used. Mocked success says nothing about the native permission prompt.
 *
 * Labels: "new API" tests pin a component and rows that did not exist before S1b.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext } from 'src/ts/setting/types'

const platform = vi.hoisted(() => ({ android: true }))

vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isAndroidTransport: () => platform.android,
    isDesktopTransport: () => false,
}))
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    sleep: vi.fn(),
    selectFileByDom: vi.fn(),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))
vi.mock(import('src/ts/gui/guisize'), () => ({
    guiSizeText: vi.fn(),
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))
vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    CustomGUISettingMenuStore: { set: vi.fn() },
    DBState: { db: {} },
}) as unknown as typeof import('src/ts/stores.svelte'))

import { language } from 'src/lang'
import { createHostChannelFake, type HostChannelFake } from 'src/ts/android/hostChannelFake'
import { installReplyNotifications, state } from 'src/ts/android/replyNotifications.svelte'
import { displaySettingsItems } from 'src/ts/setting/displaySettingsData.svelte'
import { DISPLAY_SHELL_SECTIONS } from 'src/ts/setting/displayShellSettingsData'
import ReplyNotificationsToggle from './ReplyNotificationsToggle.svelte'

let fake: HostChannelFake
const mounted: Array<ReturnType<typeof mount>> = []

function reportState(optedIn: boolean, enabled: boolean): void {
    window.__risuTaniumReplyNotificationsState?.(JSON.stringify({ optedIn, enabled }))
    flushSync()
}

function show(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ReplyNotificationsToggle, { target }))
    flushSync()
    return target
}

const box = (target: HTMLElement): HTMLInputElement => target.querySelector<HTMLInputElement>('input[type="checkbox"]')!

beforeEach(() => {
    platform.android = true
    state.known = false
    state.optedIn = false
    state.enabled = false
    fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    installReplyNotifications()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    delete window.__risuTaniumHost
    delete window.__risuTaniumReplyNotificationsState
})

describe('the switch (T27b)', () => {
    test('new API: it is off until the host reports opted in and allowed, and then shows on', () => {
        const target = show()
        expect(box(target).checked).toBe(false)

        reportState(true, true)
        expect(box(target).checked).toBe(true)

        reportState(true, false)
        expect(box(target).checked).toBe(false)
    })

    test('new API: it labels itself and explains itself', () => {
        const target = show()
        expect(target.textContent).toContain(language.replyNotificationsSetting)
        expect(target.querySelector('[data-part="reply-notifications-help"]')?.textContent).toBe(language.replyNotificationsHelp)
    })

    test('new API: turning it on asks the host to enable, turning it off asks it to disable', () => {
        const target = show()

        box(target).click()
        flushSync()
        expect(fake.postedTo('replyNotifications', 'enable')).toHaveLength(1)
        reportState(true, true)
        expect(box(target).checked).toBe(true)

        box(target).click()
        flushSync()
        expect(fake.postedTo('replyNotifications', 'disable')).toHaveLength(1)
        reportState(false, true)
        expect(box(target).checked).toBe(false)
    })

    test('new API: a tap the host does not confirm (the permission was refused) puts the box back off', () => {
        const target = show()

        box(target).click()
        flushSync()

        expect(fake.postedTo('replyNotifications', 'enable')).toHaveLength(1)
        expect(box(target).checked).toBe(false)
    })

    test('new API: opted in but blocked in the system settings shows off with the status line, and a tap asks the host again', () => {
        const target = show()
        expect(target.querySelector('[data-part="reply-notifications-status"]')).toBeNull()

        reportState(true, false)
        expect(box(target).checked).toBe(false)
        expect(target.querySelector('[data-part="reply-notifications-status"]')?.textContent).toBe(language.replyNotificationsBlocked)

        box(target).click()
        flushSync()
        expect(fake.postedTo('replyNotifications', 'enable')).toHaveLength(1)
        expect(box(target).checked).toBe(false)

        reportState(true, true)
        expect(target.querySelector('[data-part="reply-notifications-status"]')).toBeNull()
        expect(box(target).checked).toBe(true)
    })
})

describe('where the switch is offered (T27b)', () => {
    const context = { db: {} as Database } as SettingContext
    const item = (id: string) => displaySettingsItems.find((candidate) => candidate.id === id)

    test('new API: on Android the reply switch is shown and the web notification switch is hidden', () => {
        platform.android = true
        expect(item('display.replyNotifications')?.condition?.(context)).toBe(true)
        expect(item('display.notification')?.condition?.(context)).toBe(false)
    })

    test('new API: elsewhere the web notification switch is shown and the reply switch is hidden', () => {
        platform.android = false
        expect(item('display.notification')?.condition?.(context)).toBe(true)
        expect(item('display.replyNotifications')?.condition?.(context)).toBe(false)
    })

    test('new API: the reply switch sits in the sound group right after the web notification switch', () => {
        const sound = DISPLAY_SHELL_SECTIONS.find((section) => section.id === 'display.sound')
        const ids = sound?.rows.map((row) => (row.kind === 'setting' ? row.item.id : row.id))
        expect(ids).toEqual(['display.playMessage', 'display.playMessageOnTranslateEnd', 'display.notification', 'display.replyNotifications'])
    })
})
