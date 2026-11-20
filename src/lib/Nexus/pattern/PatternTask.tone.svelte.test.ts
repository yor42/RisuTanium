// @vitest-environment jsdom

/**
 * The task card's mark follows the tone of the surface it sits on: the scheme type, unless a
 * theme-pack base sets its own tone. The real `PatternTask` is mounted with a running task.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import PatternTask from './PatternTask.svelte'
import { createTaskController, type TaskClock } from './taskProgress'
import { ColorSchemeTypeStore, packBaseTone } from '../../../ts/gui/surfaceTone'

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

afterEach(async () => {
    if (mounted) {
        await unmount(mounted.app as never)
        mounted.target.remove()
    }
    mounted = undefined
    ColorSchemeTypeStore.set('dark')
    packBaseTone.set(null)
    vi.restoreAllMocks()
})

describe('TB13: the PatternTask mark tone', () => {
    test('under a dark scheme the mark has the default tone', () => {
        const target = open()
        expect(target.querySelector('svg')).not.toBeNull()
        expect(target.querySelector('svg[data-tone]')).toBeNull()
    })

    test('under a light scheme the mark is light-toned', () => {
        ColorSchemeTypeStore.set('light')
        expect(open().querySelector('svg[data-tone="light"]')).not.toBeNull()
    })

    test('a pack base tone of dark removes the light tone whatever the scheme', () => {
        ColorSchemeTypeStore.set('light')
        packBaseTone.set('dark')
        expect(open().querySelector('svg[data-tone]')).toBeNull()
    })

    test('the tone follows a base change while mounted', () => {
        ColorSchemeTypeStore.set('light')
        const target = open()
        expect(target.querySelector('svg[data-tone="light"]')).not.toBeNull()
        packBaseTone.set('dark')
        flushSync()
        expect(target.querySelector('svg[data-tone]')).toBeNull()
    })
})
