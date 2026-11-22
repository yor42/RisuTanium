import { describe, expect, test, vi } from 'vitest'
import type { PageStorageMode } from '../../../ts/storage/pageStorageMode'

const h = vi.hoisted(() => ({ desktop: false, android: false }))

vi.mock('../../../ts/storage/tauriByteTransport', () => ({
    isDesktopTransport: () => h.desktop,
    isAndroidTransport: () => h.android,
}))

import { utilityVisible } from '../utilityGate'

const store2 = { kind: 'store2' } as unknown as PageStorageMode
const other = { kind: 'readonly' } as unknown as PageStorageMode

function platform(desktop: boolean, android: boolean) {
    h.desktop = desktop
    h.android = android
}

describe('utilityVisible', () => {
    test('the desktop app on a store2 page', () => {
        platform(true, false)
        expect(utilityVisible(store2)).toBe(true)
    })

    test('the Android app on a store2 page', () => {
        platform(false, true)
        expect(utilityVisible(store2)).toBe(true)
    })

    test('plain web or the Node server on a store2 page', () => {
        platform(false, false)
        expect(utilityVisible(store2)).toBe(false)
    })

    test.each([[true, false], [false, true]])('a page that is not store2 (desktop %s, android %s)', (desktop, android) => {
        platform(desktop, android)
        expect(utilityVisible(other)).toBe(false)
    })
})
