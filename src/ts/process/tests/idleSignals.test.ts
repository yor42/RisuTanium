/**
 * The small busy signals: the plugin panel registry and the restored-bytes
 * counter.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
    isPluginPanelOpen,
    markPluginPanelHidden,
    markPluginPanelShown,
    resetBusyActionsForTest,
    type PluginPanelHandle,
} from '../memory/busyActions'
import {
    noteRestoredBytes,
    resetRestoredBytesForTest,
    restoredBytesOutside,
} from '../memory/restoredBytes'

function panel(overrides: Partial<{ isConnected: boolean, display: string }> = {}): PluginPanelHandle & { isConnected: boolean, style: { display: string } } {
    return { isConnected: overrides.isConnected ?? true, style: { display: overrides.display ?? 'block' } }
}

beforeEach(() => {
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
})

describe('the plugin panel signal', () => {
    test('is set while a panel is shown and cleared when it is hidden', () => {
        const shown = panel()
        expect(isPluginPanelOpen()).toBe(false)
        markPluginPanelShown(shown)
        expect(isPluginPanelOpen()).toBe(true)
        markPluginPanelHidden(shown)
        expect(isPluginPanelOpen()).toBe(false)
    })

    test('stays set while any one of several panels is shown', () => {
        const first = panel()
        const second = panel()
        markPluginPanelShown(first)
        markPluginPanelShown(second)
        markPluginPanelHidden(first)
        expect(isPluginPanelOpen()).toBe(true)
        markPluginPanelHidden(second)
        expect(isPluginPanelOpen()).toBe(false)
    })

    test('showing the same panel twice and hiding it once clears it', () => {
        const shown = panel()
        markPluginPanelShown(shown)
        markPluginPanelShown(shown)
        markPluginPanelHidden(shown)
        expect(isPluginPanelOpen()).toBe(false)
    })

    test('does not count a panel that left the page or was hidden by its style', () => {
        const removed = panel()
        markPluginPanelShown(removed)
        removed.isConnected = false
        expect(isPluginPanelOpen()).toBe(false)
        const hidden = panel()
        markPluginPanelShown(hidden)
        hidden.style.display = 'none'
        expect(isPluginPanelOpen()).toBe(false)
    })
})

describe('the restored-bytes counter', () => {
    test('adds nothing for a missing id or a size that is not positive', () => {
        noteRestoredBytes('a', 0)
        noteRestoredBytes(undefined, 10)
        expect(restoredBytesOutside()).toBe(0)
        noteRestoredBytes('a', 10)
        expect(restoredBytesOutside()).toBe(10)
    })

    test('counts per character so a kept-inline one can be left out', () => {
        noteRestoredBytes('a', 10)
        noteRestoredBytes('b', 20)
        expect(restoredBytesOutside(new Set(['a']))).toBe(20)
        expect(restoredBytesOutside(new Set(['a', 'b']))).toBe(0)
        expect(restoredBytesOutside()).toBe(30)
    })
})
