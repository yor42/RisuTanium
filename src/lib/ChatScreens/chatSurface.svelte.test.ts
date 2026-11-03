// @vitest-environment jsdom

/**
 * The chat surface's hide/release decision, on real writables standing in for the stores. A Settings teardown stand-in
 * (an effect whose cleanup bumps the GUI pointer, run in the flush that `tick()` ends with) plays the part of a Settings
 * page that signals while it closes.
 *
 * Labels: SEAM = unit test of the new decision (its evidence is the mutants it kills), CG = guard.
 */
import { tick } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock('../../ts/stores.svelte', () => ({
    settingsOpen: writable(false),
    MobileGUI: writable(false),
    ReloadGUIPointer: writable(0),
    ReloadChatPointer: writable({} as Record<number, number>),
}))

//#endregion

import { MobileGUI, ReloadChatPointer, ReloadGUIPointer, settingsOpen } from '../../ts/stores.svelte'
import { noteTopLevelChange, resetTopLevelChangesForTests } from '../../ts/storage/topLevelChanges'
import { changeLanguage } from '../../lang'
import { chatSurface, installChatSurface, isChatSurfaceInstalled, onSurfaceHiding, resetChatSurfaceForTests } from './chatSurface.svelte'

let stopTeardownStandIn: (() => void) | null = null

/** An effect whose cleanup runs in the flush that follows `settingsOpen` turning false, like a page's `onDestroy`. */
function installTeardownStandIn(onTeardown: () => void) {
    stopTeardownStandIn = $effect.root(() => {
        const open = $state({ value: false })
        settingsOpen.subscribe((value) => { open.value = value })
        $effect(() => {
            if (open.value) {
                return onTeardown
            }
        })
    })
}

async function settle() {
    await tick()
    await tick()
}

beforeEach(() => {
    resetChatSurfaceForTests()
    resetTopLevelChangesForTests()
    settingsOpen.set(false)
    MobileGUI.set(false)
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    installChatSurface()
})

afterEach(() => {
    stopTeardownStandIn?.()
    stopTeardownStandIn = null
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    changeLanguage('en')
})

describe('install state', () => {
    test('SEAM the surface is installed after install and not after the test reset', () => {
        expect(isChatSurfaceInstalled()).toBe(true)
        resetChatSurfaceForTests()
        expect(isChatSurfaceInstalled()).toBe(false)
    })
})

describe('release decision', () => {
    test('SEAM T8 the release waits for the teardown flush: a bump from the teardown rebuilds', async () => {
        installTeardownStandIn(() => { ReloadGUIPointer.update((value) => value + 1) })
        settingsOpen.set(true)
        await settle()
        expect(chatSurface.hidden).toBe(true)

        settingsOpen.set(false)
        expect(chatSurface.hidden).toBe(true)
        await settle()

        expect(chatSurface.hidden).toBe(false)
        expect(chatSurface.rebuildEpoch).toBe(1)
    })

    test('SEAM T8b a reopen before the release flushes keeps the surface hidden and the first baseline', async () => {
        settingsOpen.set(true)
        await settle()
        noteTopLevelChange()

        settingsOpen.set(false)
        settingsOpen.set(true)
        await settle()
        expect(chatSurface.hidden).toBe(true)
        expect(chatSurface.rebuildEpoch).toBe(0)

        settingsOpen.set(false)
        await settle()
        expect(chatSurface.hidden).toBe(false)
        expect(chatSurface.rebuildEpoch).toBe(1)
    })

    test('CG an idle visit releases without a rebuild', async () => {
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.hidden).toBe(false)
        expect(chatSurface.rebuildEpoch).toBe(0)
    })

    test('SEAM a settings-level change during the visit rebuilds once', async () => {
        settingsOpen.set(true)
        await settle()
        noteTopLevelChange()
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(chatSurface.hidden).toBe(false)
    })

    test('SEAM a settings-level change before the visit does not rebuild', async () => {
        noteTopLevelChange()
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.rebuildEpoch).toBe(0)
    })

    test('SEAM a GUI bump while hidden rebuilds once and catches the held pointers up', async () => {
        settingsOpen.set(true)
        await settle()
        ReloadGUIPointer.update((value) => value + 1)
        expect(chatSurface.heldGui).toBe(0)
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(chatSurface.heldGui).toBe(1)
        expect(chatSurface.hidden).toBe(false)
    })

    test('SEAM a row bump while hidden rebuilds and the held row pointers take the raw values', async () => {
        settingsOpen.set(true)
        await settle()
        ReloadChatPointer.update((value) => { value[3] = 2; return value })
        expect(chatSurface.heldChat).toEqual({})
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(chatSurface.heldChat).toEqual({ 3: 2 })
    })

    test('SEAM a visit with a hidden signal rebuilds and the next idle visit does not', async () => {
        settingsOpen.set(true)
        await settle()
        ReloadGUIPointer.update((value) => value + 1)
        settingsOpen.set(false)
        await settle()
        expect(chatSurface.rebuildEpoch).toBe(1)

        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(chatSurface.hidden).toBe(false)
    })

    test('SEAM a UI language change during the visit remounts once; an idle visit and a non-language change do not', async () => {
        settingsOpen.set(true)
        await settle()
        changeLanguage('ko')
        settingsOpen.set(false)
        await settle()
        expect(chatSurface.remountEpoch).toBe(1)
        expect(chatSurface.hidden).toBe(false)

        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(chatSurface.remountEpoch).toBe(1)

        settingsOpen.set(true)
        await settle()
        noteTopLevelChange()
        settingsOpen.set(false)
        await settle()
        expect(chatSurface.remountEpoch).toBe(1)
        expect(chatSurface.rebuildEpoch).toBe(1)
    })

    test('SEAM a language change before the visit does not remount', async () => {
        changeLanguage('ko')
        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()

        expect(chatSurface.remountEpoch).toBe(0)
    })

    test('SEAM MobileGUI never hides the surface', async () => {
        MobileGUI.set(true)
        settingsOpen.set(true)
        await settle()

        expect(chatSurface.hidden).toBe(false)
    })
})

describe('hiding hook', () => {
    test('SEAM U1 the callback runs once, synchronously, while the surface is still visible', async () => {
        const seen: boolean[] = []
        onSurfaceHiding(() => { seen.push(chatSurface.hidden) })

        settingsOpen.set(true)
        expect(seen).toEqual([false])

        await settle()
        expect(chatSurface.hidden).toBe(true)
        expect(seen).toEqual([false])
    })

    test('SEAM U2 a reopen while hidden, a MobileGUI open, an unregistered callback and a reset surface call nothing', async () => {
        let calls = 0
        const unregister = onSurfaceHiding(() => { calls += 1 })

        settingsOpen.set(true)
        await settle()
        expect(calls).toBe(1)
        settingsOpen.set(false)
        settingsOpen.set(true)
        await settle()
        expect(calls).toBe(1)
        settingsOpen.set(false)
        await settle()

        MobileGUI.set(true)
        settingsOpen.set(true)
        await settle()
        expect(calls).toBe(1)
        settingsOpen.set(false)
        await settle()
        MobileGUI.set(false)

        unregister()
        settingsOpen.set(true)
        await settle()
        expect(calls).toBe(1)
        settingsOpen.set(false)
        await settle()

        onSurfaceHiding(() => { calls += 1 })
        resetChatSurfaceForTests()
        installChatSurface()
        settingsOpen.set(true)
        await settle()
        expect(calls).toBe(1)
    })

    test('SEAM U4 a throwing callback neither stops the hide nor the callbacks after it', async () => {
        const failure = vi.spyOn(console, 'error').mockImplementation(() => {})
        let later = 0
        onSurfaceHiding(() => { throw new Error('capture failed') })
        onSurfaceHiding(() => { later += 1 })

        settingsOpen.set(true)
        await settle()

        expect(chatSurface.hidden).toBe(true)
        expect(later).toBe(1)
        expect(failure).toHaveBeenCalledTimes(1)
        failure.mockRestore()
    })

    test('CG U3 the hide and release baselines are unchanged with a callback registered', async () => {
        onSurfaceHiding(() => {})

        settingsOpen.set(true)
        await settle()
        ReloadGUIPointer.update((value) => value + 1)
        settingsOpen.set(false)
        await settle()
        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(chatSurface.heldGui).toBe(1)
        expect(chatSurface.hidden).toBe(false)

        settingsOpen.set(true)
        await settle()
        settingsOpen.set(false)
        await settle()
        expect(chatSurface.rebuildEpoch).toBe(1)
        expect(chatSurface.closeEpoch).toBe(2)
    })
})

describe('held pointers while visible', () => {
    test('SEAM the GUI pointer is forwarded', () => {
        ReloadGUIPointer.update((value) => value + 1)
        expect(chatSurface.heldGui).toBe(1)
    })

    test('SEAM the in-place row pointer is forwarded as a copy', () => {
        ReloadChatPointer.update((value) => { value[1] = 4; return value })
        expect(chatSurface.heldChat).toEqual({ 1: 4 })
        expect(chatSurface.heldChat).not.toBe(get(ReloadChatPointer))
        ReloadChatPointer.update((value) => { value[1] = 5; return value })
        expect(chatSurface.heldChat).toEqual({ 1: 5 })
    })
})
