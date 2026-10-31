// @vitest-environment happy-dom

/**
 * A node that `Portal.svelte` mounts outside the app's own tree while an alert is
 * shown.
 *
 * Mounts the REAL `Portal.svelte` with a plain button as its child, against a real
 * `writable` standing in for `alertStore`, and reads whether the portalled button
 * sits inside an element that carries the `inert` attribute. A portalled editor is
 * mounted into the document body, outside the `inert` subtree that guards the page
 * behind an alert, so it has to carry the same guard itself. `happy-dom` does not
 * enforce `inert`, so these tests prove what the app sets, not what the browser
 * does with it.
 *
 * Invariants pinned here:
 *  - while an alert that covers the page is shown, whatever a portal mounts is
 *    inside an inert subtree: every alert type but `none` and `toast` covers it;
 *  - with no alert, or with a toast, nothing a portal mounts is inert;
 *  - a portalled node becomes live again once the covering alert closes.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they pin
 * behaviour that must be preserved. Every other test fails while the behaviour
 * it names is missing.
 */

import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from 'src/ts/alert'

vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { alertStore } from 'src/ts/stores.svelte'
import Portal from './Portal.svelte'

const ALERT_TYPES: Array<alertData['type']> = [
    'ask', 'pluginconfirm', 'select', 'input', 'selectChar', 'addchar', 'chatOptions', 'cardexport',
    'selectModule', 'tos', 'staleAccountNotice', 'progress', 'normal', 'error', 'markdown',
    'requestdata', 'hypaV2', 'branches', 'requestlogs', 'pukmakkurit', 'wait2', 'wait',
    'patternSelect', 'patternInput',
]
const NOT_COVERING: Array<alertData['type']> = ['none', 'toast']

const mountedInstances: unknown[] = []

/** Mounts a portal whose child is a button, and returns that button as it sits in the document. */
function mountPortalledButton(): HTMLButtonElement {
    const children = createRawSnippet(() => ({
        render: () => '<button id="portalled">Portalled</button>',
    }))
    mountedInstances.push(mount(Portal, { target: document.body, props: { children } }))
    flushSync()
    const button = document.body.querySelector<HTMLButtonElement>('#portalled')
    expect(button, 'the portalled button is in the document').toBeTruthy()
    return button!
}

function show(type: alertData['type']): void {
    alertStore.set({ type, msg: '' } as never)
    flushSync()
}

afterEach(async () => {
    const instances = mountedInstances.splice(0)
    for (const instance of instances) {
        await unmount(instance as never).catch(() => {})
    }
    document.body.replaceChildren()
    alertStore.set({ type: 'none', msg: '' } as never)
})

describe('Portal.svelte: what it mounts while an alert is shown', () => {
    test.each(ALERT_TYPES)('a node it mounts is inside an inert subtree while a %s alert is shown', (type) => {
        const button = mountPortalledButton()

        show(type)

        expect(button.closest('[inert]'), 'the inert ancestor of the portalled button').not.toBeNull()
    })

    test.each(ALERT_TYPES)('a node it mounts while a %s alert is already shown is inside an inert subtree', (type) => {
        show(type)

        const button = mountPortalledButton()

        expect(button.closest('[inert]'), 'the inert ancestor of the portalled button').not.toBeNull()
    })

    test.each(NOT_COVERING)('guard: a node it mounts is not inside an inert subtree while a %s alert is shown', (type) => {
        const button = mountPortalledButton()

        show(type)

        expect(button.closest('[inert]')).toBeNull()
    })

    test('a node it mounts is live again once the covering alert closes', () => {
        const button = mountPortalledButton()
        show('ask')
        expect.soft(button.closest('[inert]'), 'the inert ancestor while the alert is shown').not.toBeNull()

        show('none')

        expect.soft(button.closest('[inert]'), 'the inert ancestor after the alert closed').toBeNull()
    })
})
