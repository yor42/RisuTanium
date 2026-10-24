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

import { MobileGUI, SettingsMenuIndex, settingsOpen } from '../../ts/stores.svelte'
import { settingsBackClose } from './settingsBack'

function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

const originalWidth = window.innerWidth

beforeEach(() => {
    MobileGUI.set(false)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(true)
})

afterEach(() => {
    setWidth(originalWidth)
})

describe('settingsBackClose', () => {
    test.each([
        ['Beta Mobile GUI overlay (no X exists)', true, 500, 3, false, 3],
        ['Beta Mobile GUI overlay at the list', true, 500, -1, false, -1],
        ['wide layout with a page open', false, 1000, 3, false, 3],
        ['narrow list view', false, 500, -1, false, -1],
        ['narrow detail view goes back to the list', false, 500, 3, true, -1],
    ])('(G) %s', (_name, mobileGui, width, index, stillOpen, indexAfter) => {
        MobileGUI.set(mobileGui)
        setWidth(width)
        SettingsMenuIndex.set(index)
        settingsBackClose()
        expect(get(settingsOpen)).toBe(stillOpen)
        expect(get(SettingsMenuIndex)).toBe(indexAfter)
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
