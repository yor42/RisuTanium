/**
 * The small signals the idle reload reads: the plugin panel registry, whether
 * speech is playing, and the restored-bytes listener.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    isPluginPanelOpen,
    markPluginPanelHidden,
    markPluginPanelShown,
    resetBusyActionsForTest,
    type PluginPanelHandle,
} from '../memory/busyActions'
import {
    hasRestoredBytes,
    noteRestoredBytes,
    resetRestoredBytesForTest,
    restoredBytesOutside,
    setRestoredBytesListener,
} from '../memory/restoredBytes'
import { beginClip, cancelTTSPlayback, isTTSPlaying, releaseClip } from '../ttsPlayback'

function panel(overrides: Partial<{ isConnected: boolean, display: string }> = {}): PluginPanelHandle & { isConnected: boolean, style: { display: string } } {
    return { isConnected: overrides.isConnected ?? true, style: { display: overrides.display ?? 'block' } }
}

beforeEach(() => {
    resetBusyActionsForTest()
    resetRestoredBytesForTest()
})

afterEach(() => {
    vi.unstubAllGlobals()
    cancelTTSPlayback()
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

describe('whether speech is playing', () => {
    test('is true while a clip is open and false once it is released', () => {
        vi.stubGlobal('speechSynthesis', undefined)
        expect(isTTSPlaying()).toBe(false)
        const clip = beginClip({ close: async () => { } } as unknown as AudioContext)
        expect(isTTSPlaying()).toBe(true)
        releaseClip(clip)
        expect(isTTSPlaying()).toBe(false)
    })

    test('is true while the browser\'s own speech is speaking or queued', () => {
        vi.stubGlobal('speechSynthesis', { speaking: true, pending: false })
        expect(isTTSPlaying()).toBe(true)
        vi.stubGlobal('speechSynthesis', { speaking: false, pending: true })
        expect(isTTSPlaying()).toBe(true)
        vi.stubGlobal('speechSynthesis', { speaking: false, pending: false })
        expect(isTTSPlaying()).toBe(false)
    })
})

describe('the restored-bytes listener', () => {
    test('is called after every count that added bytes, and not for one that added none', () => {
        const listener = vi.fn()
        setRestoredBytesListener(listener)
        noteRestoredBytes('a', 0)
        noteRestoredBytes(undefined, 10)
        expect(listener).not.toHaveBeenCalled()
        expect(hasRestoredBytes()).toBe(false)
        noteRestoredBytes('a', 10)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(hasRestoredBytes()).toBe(true)
        setRestoredBytesListener(null)
        noteRestoredBytes('a', 10)
        expect(listener).toHaveBeenCalledTimes(1)
    })

    test('counts per character so a kept-inline one can be left out', () => {
        noteRestoredBytes('a', 10)
        noteRestoredBytes('b', 20)
        expect(restoredBytesOutside(new Set(['a']))).toBe(20)
        expect(restoredBytesOutside(new Set(['a', 'b']))).toBe(0)
        expect(restoredBytesOutside()).toBe(30)
    })
})
