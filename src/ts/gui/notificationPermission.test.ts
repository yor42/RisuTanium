// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readNotificationStatus, requestNotifications } from './notificationPermission'

type FakePermission = string | undefined

function stubNotification(permission: FakePermission, requestPermission?: () => Promise<string>) {
    vi.stubGlobal('Notification', { permission, requestPermission })
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('readNotificationStatus never throws and names the four states', () => {
    test.each(['granted', 'denied', 'default'] as const)('reports %s as is', (permission) => {
        stubNotification(permission)
        expect(readNotificationStatus()).toBe(permission)
    })

    test('a missing Notification API reads as unsupported', () => {
        vi.stubGlobal('Notification', undefined)
        expect(readNotificationStatus()).toBe('unsupported')
    })

    test('an unknown permission value reads as unsupported', () => {
        stubNotification('mystery')
        expect(readNotificationStatus()).toBe('unsupported')
    })

    test('a permission getter that throws reads as unsupported', () => {
        vi.stubGlobal('Notification', {
            get permission(): string {
                throw new Error('blocked by the host')
            },
        })
        expect(readNotificationStatus()).toBe('unsupported')
    })
})

describe('requestNotifications asks only while the permission is undecided', () => {
    test('asks exactly once on default and returns the answer', async () => {
        const request = vi.fn(async () => 'granted')
        stubNotification('default', request)
        await expect(requestNotifications()).resolves.toBe('granted')
        expect(request).toHaveBeenCalledTimes(1)
    })

    test('a refusal on the first ask is reported as denied', async () => {
        const request = vi.fn(async () => 'denied')
        stubNotification('default', request)
        await expect(requestNotifications()).resolves.toBe('denied')
        expect(request).toHaveBeenCalledTimes(1)
    })

    test.each(['granted', 'denied'] as const)('does not ask again when already %s', async (permission) => {
        const request = vi.fn(async () => 'granted')
        stubNotification(permission, request)
        await expect(requestNotifications()).resolves.toBe(permission)
        expect(request).not.toHaveBeenCalled()
    })

    test('without the API it returns unsupported and does not throw', async () => {
        vi.stubGlobal('Notification', undefined)
        await expect(requestNotifications()).resolves.toBe('unsupported')
    })

    test('a rejected request does not throw and leaves the re-read status', async () => {
        const request = vi.fn(async () => {
            throw new Error('request failed')
        })
        stubNotification('default', request)
        await expect(requestNotifications()).resolves.toBe('default')
        expect(request).toHaveBeenCalledTimes(1)
    })

    test('an unknown answer leaves the re-read status', async () => {
        stubNotification('default', async () => 'mystery')
        await expect(requestNotifications()).resolves.toBe('default')
    })
})
