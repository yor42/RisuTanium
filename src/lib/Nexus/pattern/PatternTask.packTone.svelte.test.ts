// @vitest-environment jsdom

/**
 * The task card's mark under a theme pack: while the real surface gate has a pack sheet on, the mark is dark-toned in
 * any scheme; without one it follows the scheme. REAL: PatternTask, surfaceTone.ts and the gate. The registered probe
 * element stands in for the pack sheet. A regression reproducer against the stage before the gate wrote the base tone.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import PatternTask from './PatternTask.svelte'
import { createTaskController, type TaskClock } from './taskProgress'
import { ColorSchemeTypeStore } from '../../../ts/gui/surfaceTone'
import { declareSurface, installThemePackGate, registerThemePackElement, resetThemePackGateForTests, syncThemePackMedia } from '../../../ts/themePack/surfaceGate.svelte'

let mounted: { target: HTMLElement, app: Record<string, unknown> } | undefined

function open(): HTMLElement {
    const clock: TaskClock = { now: () => 0, setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>, clearTimeout: () => {}, hidden: () => false }
    const controller = createTaskController({ title: 'Import', steps: [{ label: 'Read file' }, { label: 'Tidy up' }], onCancel: () => {} }, clock)
    const props = $state({ view: controller.view, lowPower: false, oncancel: () => {}, onanswer: () => {} })
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted = { target, app: mount(PatternTask as never, { target, props }) as unknown as Record<string, unknown> }
    flushSync()
    return target
}

function packSheet(): () => void {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', 'chat')
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    return registerThemePackElement(element, 'chat')
}

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
    }
    mounted = undefined
    resetThemePackGateForTests()
    ColorSchemeTypeStore.set('dark')
    document.head.innerHTML = ''
})

describe('TP8: the task mark tone under a pack', () => {
    test('with a pack sheet on, a light scheme leaves the mark dark-toned', () => {
        ColorSchemeTypeStore.set('light')
        installThemePackGate(() => false)
        packSheet()
        declareSurface('chat')
        syncThemePackMedia()
        expect(open().querySelector('svg[data-tone]')).toBeNull()
    })

    test('without a pack the mark follows the light scheme', () => {
        ColorSchemeTypeStore.set('light')
        installThemePackGate(() => false)
        declareSurface('chat')
        syncThemePackMedia()
        expect(open().querySelector('svg[data-tone="light"]')).not.toBeNull()
    })

    test('turning the pack on and off while mounted updates the mark without a remount', () => {
        ColorSchemeTypeStore.set('light')
        installThemePackGate(() => false)
        const unregister = packSheet()
        const target = open()
        expect(target.querySelector('svg[data-tone="light"]')).not.toBeNull()
        declareSurface('chat')
        syncThemePackMedia()
        flushSync()
        expect(target.querySelector('svg[data-tone]')).toBeNull()
        unregister()
        syncThemePackMedia()
        flushSync()
        expect(target.querySelector('svg[data-tone="light"]')).not.toBeNull()
    })
})
