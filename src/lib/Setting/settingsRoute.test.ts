// @vitest-environment jsdom

/**
 * `openSettingsForFix` is the in-app route from the failed-send card to Settings. The module is new, so before the
 * fix every case fails on the missing import (diagnostic). MOCKED: `stores.svelte` (plain writable stores).
 */
import { get, writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../ts/stores.svelte'), () => ({
    MobileGUI: writable(false),
    SettingsMenuIndex: writable(-1),
    settingsOpen: writable(false),
}) as unknown as typeof import('../../ts/stores.svelte'))

import { SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { fixPending, isReturnToChat, openSettingsForFix, resetSettingsRouteForTests } from './settingsRoute'

beforeEach(() => {
    resetSettingsRouteForTests()
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
})

describe('openSettingsForFix', () => {
    test('it opens Chat Bot settings (index 1) and marks the return to the chat', () => {
        openSettingsForFix('botSettings')

        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(1)
        expect(isReturnToChat()).toBe(true)
        expect(get(fixPending)).toBe(false)
    })

    test('any close clears the mark and asks for the focus on Try again, once', () => {
        openSettingsForFix('botSettings')

        settingsOpen.set(false)

        expect(isReturnToChat()).toBe(false)
        expect(get(fixPending)).toBe(true)

        fixPending.set(false)
        settingsOpen.set(true)
        settingsOpen.set(false)
        expect(get(fixPending)).toBe(false)
    })

    test('a plain open of Settings never marks a return', () => {
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)

        expect(isReturnToChat()).toBe(false)
        settingsOpen.set(false)
        expect(get(fixPending)).toBe(false)
    })

    test('a second route after an unfinished one still marks one return and one close', () => {
        openSettingsForFix('botSettings')
        openSettingsForFix('botSettings')

        settingsOpen.set(false)

        expect(isReturnToChat()).toBe(false)
        expect(get(fixPending)).toBe(true)
    })

    test('a stale focus request is dropped when a new route starts', () => {
        fixPending.set(true)

        openSettingsForFix('botSettings')

        expect(get(fixPending)).toBe(false)
    })
})
