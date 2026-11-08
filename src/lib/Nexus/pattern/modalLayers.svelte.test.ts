// @vitest-environment jsdom

/**
 * The modal layer counter: a count of open focus-trapping overlays with idempotent release, held by every
 * registered shell, and never read as a rune by a holder, so holding a layer re-runs no other overlay's effect.
 * Counts are compared with the count before each test, so an earlier leak shows as a failure of the afterEach.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))
vi.mock('../../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import ShellSheet from '../../ChatShell/ShellSheet.svelte'
import { resetBackHandlersForTests } from '../../../ts/backHandlers'
import { holdModalLayer, modalLayerCount, modalLayerOpen } from './modalLayers.svelte'
import { hasOpenShell, isTopmostShell, registerShell } from './patternFocus'

const sheetBody = createRawSnippet(() => ({ render: () => '<div><button data-sheet-initial>First</button><button id="second">Second</button></div>' }))

let mountedApps: Array<ReturnType<typeof mount>> = []
let nodes: HTMLElement[] = []

afterEach(async () => {
    for (const app of mountedApps.reverse()) {
        await unmount(app)
    }
    mountedApps = []
    for (const node of nodes.splice(0)) {
        node.remove()
    }
    resetBackHandlersForTests()
    expect(modalLayerCount()).toBe(0)
})

describe('holdModalLayer', () => {
    test('ML1 the layer is a count and each release counts once', () => {
        const base = modalLayerCount()
        const first = holdModalLayer()
        const second = holdModalLayer()
        expect(modalLayerCount()).toBe(base + 2)
        expect(modalLayerOpen()).toBe(true)
        first()
        expect(modalLayerCount()).toBe(base + 1)
        expect(modalLayerOpen()).toBe(true)
        first()
        expect(modalLayerCount()).toBe(base + 1)
        second()
        expect(modalLayerCount()).toBe(base)
        expect(modalLayerOpen()).toBe(false)
    })
})

describe('registerShell', () => {
    test('ML2 an open shell holds a layer until its unregister, and the key and openness rules are unchanged', () => {
        const base = modalLayerCount()
        const a = {}
        const b = {}
        const unregisterA = registerShell(a)
        const unregisterB = registerShell(b)
        expect(modalLayerCount()).toBe(base + 2)
        expect(hasOpenShell()).toBe(true)
        expect(isTopmostShell(b)).toBe(true)
        expect(isTopmostShell(a)).toBe(false)
        unregisterB()
        unregisterB()
        expect(modalLayerCount()).toBe(base + 1)
        expect(isTopmostShell(a)).toBe(true)
        unregisterA()
        expect(modalLayerCount()).toBe(base)
        expect(hasOpenShell()).toBe(false)
    })
})

describe('holding a layer inside an open sheet', () => {
    test('ML3 holding and releasing a layer re-runs no overlay effect: focus stays and the page stays inert', () => {
        const outside = document.createElement('nav')
        document.body.appendChild(outside)
        nodes.push(outside)
        const target = document.createElement('div')
        document.body.appendChild(target)
        nodes.push(target)
        const state = $state({ value: true })
        mountedApps.push(mount(ShellSheet, {
            target,
            props: {
                get open() { return state.value },
                kind: 'sheet',
                label: 'Sheet',
                inertOutside: true,
                onclose: () => { state.value = false },
                children: sheetBody,
            },
        }))
        flushSync()
        const second = target.querySelector<HTMLElement>('#second')!
        second.focus()
        expect(document.activeElement).toBe(second)
        const release = holdModalLayer()
        flushSync()
        release()
        flushSync()
        expect(document.activeElement).toBe(second)
        expect(outside.hasAttribute('inert')).toBe(true)
    })
})
