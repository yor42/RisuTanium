// @vitest-environment jsdom

/**
 * `settingsBackClose` is the one close of the Settings screen, shared by both X buttons and by
 * Back. (G) = guard of the rule table; the function is new, so nothing here can fail "before" for
 * a reason other than the missing module. MOCKED: `stores.svelte` (plain writable stores).
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../ts/stores.svelte'), () => ({
    MobileGUI: writable(false),
    SettingsMenuIndex: writable(-1),
    settingsOpen: writable(true),
}) as unknown as typeof import('../../ts/stores.svelte'))

import { SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { settingsBackClose } from './settingsBack'
import { isReturnToChat, openSettingsForFix, resetSettingsRouteForTests } from './settingsRoute'

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const originalWidth = window.innerWidth

beforeEach(() => {
    resetSettingsRouteForTests()
    SettingsMenuIndex.set(-1)
    settingsOpen.set(true)
})

afterEach(() => {
    setWidth(originalWidth)
})

describe('settingsBackClose', () => {
    test.each([
        ['wide layout with a page open', 1000, 3, false, 3],
        ['narrow list view', 500, -1, false, -1],
        ['narrow detail view goes back to the list', 500, 3, true, -1],
    ])('(G) %s', (_name, width, index, stillOpen, indexAfter) => {
        setWidth(width)
        SettingsMenuIndex.set(index)
        settingsBackClose()
        expect(get(settingsOpen)).toBe(stillOpen)
        expect(get(SettingsMenuIndex)).toBe(indexAfter)
    })

    test('U4 narrow width: after the Fix route, Back closes Settings outright and the mark is gone', () => {
        setWidth(500)
        openSettingsForFix('botSettings')
        expect(get(SettingsMenuIndex)).toBe(1)

        settingsBackClose()

        expect(get(settingsOpen)).toBe(false)
        expect(isReturnToChat()).toBe(false)
    })

    test('U4 narrow width: a plain open afterwards still goes back to the list first', () => {
        setWidth(500)
        openSettingsForFix('botSettings')
        settingsBackClose()
        expect(get(settingsOpen)).toBe(false)

        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        settingsBackClose()

        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
    })

    test('U4 narrow width: a close by another path (Escape, the sidebar) also clears the mark', () => {
        setWidth(500)
        openSettingsForFix('botSettings')

        settingsOpen.set(false)
        settingsOpen.set(true)
        SettingsMenuIndex.set(3)
        settingsBackClose()

        expect(get(settingsOpen)).toBe(true)
        expect(get(SettingsMenuIndex)).toBe(-1)
    })

    test('(G) the width is read when the function runs, not when it was imported', () => {
        SettingsMenuIndex.set(3)
        setWidth(500)
        settingsBackClose()
        expect(get(settingsOpen)).toBe(true)
        SettingsMenuIndex.set(3)
        setWidth(900)
        settingsBackClose()
        expect(get(settingsOpen)).toBe(false)
    })
})
