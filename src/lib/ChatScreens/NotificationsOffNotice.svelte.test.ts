// @vitest-environment jsdom

/**
 * The notice shown after the notification permission is denied (DD-009): one chat instance consumes
 * it, shows it above the composer, and it ends on Close, Open settings, an allowed push, or when
 * that instance unmounts. Nothing is persisted.
 *
 * MOCKED: the Android host channel (a fake). The real component, the real page module and the real
 * language table are used; a passing test says nothing about the native permission prompt. Every
 * "absent after" test first asserts that the notice WAS shown.
 *
 * Labels: all tests here are diagnostics of the new component; none is a regression reproducer.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import { createHostChannelFake, type HostChannelFake } from 'src/ts/android/hostChannelFake'
import * as replyNotificationsModule from 'src/ts/android/replyNotifications.svelte'
import NotificationsOffNotice from './NotificationsOffNotice.svelte'

const mounted: Array<{ instance: ReturnType<typeof mount>; target: HTMLElement }> = []
let fake: HostChannelFake

const NOTICE = '[data-part="notifications-off-notice"]'

async function settle(): Promise<void> {
    flushSync()
    await tick()
    flushSync()
}

/** Mounts one instance in its own target. */
async function mountInstance(): Promise<{ target: HTMLElement; instance: ReturnType<typeof mount> }> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(NotificationsOffNotice, { target })
    mounted.push({ instance, target })
    await settle()
    return { target, instance }
}

/** The host's permission answer, as MainActivity calls it; the hook is asserted to exist first. */
async function permissionResult(value: unknown): Promise<void> {
    const hook = window.__risuTaniumNotificationPermissionResult
    expect(typeof hook).toBe('function')
    hook?.(value)
    await settle()
}

async function pushState(appNotifications: boolean): Promise<void> {
    window.__risuTaniumReplyNotificationsState?.(JSON.stringify({ optedIn: false, enabled: appNotifications, appNotifications }))
    await settle()
}

beforeEach(() => {
    replyNotificationsModule.resetNotificationsOffNoticeForTests?.()
    fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    replyNotificationsModule.installReplyNotifications()
})

afterEach(() => {
    for (const { instance, target } of mounted.splice(0)) {
        try {
            unmount(instance)
        } catch {
            // Already unmounted by the test.
        }
        target.remove()
    }
    delete window.__risuTaniumHost
    delete window.__risuTaniumReplyNotificationsState
    delete window.__risuTaniumNotificationPermissionResult
})

describe('the notice instance', () => {
    test('C1: a denial that arrived before the mount is shown on mount', async () => {
        await permissionResult(false)
        const { target } = await mountInstance()
        expect(target.querySelector(NOTICE)).not.toBeNull()
    })

    test('C2: a denial that arrives while the instance is mounted shows at once', async () => {
        const { target } = await mountInstance()
        expect(target.querySelector(NOTICE)).toBeNull()
        await permissionResult(false)
        expect(target.querySelector(NOTICE)).not.toBeNull()
    })

    test('C3: a second instance never shows it, nor does one mounted after the first unmounted', async () => {
        const first = await mountInstance()
        await permissionResult(false)
        expect(first.target.querySelector(NOTICE)).not.toBeNull()

        const second = await mountInstance()
        expect(second.target.querySelector(NOTICE)).toBeNull()
        expect(first.target.querySelector(NOTICE)).not.toBeNull()

        unmount(first.instance)
        await settle()
        const third = await mountInstance()
        expect(third.target.querySelector(NOTICE)).toBeNull()
        expect(second.target.querySelector(NOTICE)).toBeNull()
    })

    test('C4: an allowed push hides the shown notice', async () => {
        const { target } = await mountInstance()
        await permissionResult(false)
        expect(target.querySelector(NOTICE)).not.toBeNull()
        await pushState(true)
        expect(target.querySelector(NOTICE)).toBeNull()
    })

    test('C5: the notice is a status with the decided text, and Close removes it for the process', async () => {
        const { target } = await mountInstance()
        await permissionResult(false)
        const notice = target.querySelector<HTMLElement>(NOTICE)
        expect(notice).not.toBeNull()
        expect(notice?.getAttribute('role')).toBe('status')
        expect(notice?.textContent).toContain(language.notificationsOffNotice)
        expect(notice?.textContent).toContain('Notifications are off, so background replies have no Stop button in the notification shade.')
        const open = notice?.querySelector<HTMLButtonElement>('button[data-action="open-settings"]')
        const close = notice?.querySelector<HTMLButtonElement>('button[data-action="close"]')
        expect(open?.textContent).toBe(language.notificationsOffOpenSettings)
        expect(close?.textContent).toBe(language.uiCommon.close)

        close?.click()
        await settle()
        expect(target.querySelector(NOTICE)).toBeNull()

        await permissionResult(false)
        expect(target.querySelector(NOTICE)).toBeNull()
        const again = await mountInstance()
        expect(again.target.querySelector(NOTICE)).toBeNull()
    })

    test('C5b: Open settings calls the host once, never enable, and removes the notice for the process', async () => {
        const { target } = await mountInstance()
        await permissionResult(false)
        const open = target.querySelector<HTMLButtonElement>(`${NOTICE} button[data-action="open-settings"]`)
        expect(open).not.toBeNull()

        open?.click()
        await settle()
        expect(fake.postedTo('replyNotifications', 'openNotificationSettings')).toHaveLength(1)
        expect(fake.postedTo('replyNotifications', 'enable')).toEqual([])
        expect(target.querySelector(NOTICE)).toBeNull()

        await permissionResult(false)
        const again = await mountInstance()
        expect(again.target.querySelector(NOTICE)).toBeNull()
    })

    test('C6: unmounting the instance that showed it leaves the phase consumed, never re-armed', async () => {
        const { target, instance } = await mountInstance()
        await permissionResult(false)
        expect(target.querySelector(NOTICE)).not.toBeNull()
        expect(replyNotificationsModule.notificationsOff.phase).toBe('consumed')

        unmount(instance)
        await settle()
        expect(replyNotificationsModule.notificationsOff.phase).toBe('consumed')
    })

    test('an allowed answer never shows it', async () => {
        const { target } = await mountInstance()
        await permissionResult(true)
        expect(target.querySelector(NOTICE)).toBeNull()
        await permissionResult(false)
        expect(target.querySelector(NOTICE)).toBeNull()
    })
})
