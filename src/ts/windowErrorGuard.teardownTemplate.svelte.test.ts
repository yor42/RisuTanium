// @vitest-environment jsdom
/**
 * Template-handler variant of windowErrorGuard.teardown.svelte.test.ts. A delegated `onfocusout` handler that throws
 * while a Svelte block removes the focused field raises its error to window `error` on the stack of the block effect
 * (Svelte restores the block's reactive context before the exception leaves its event dispatcher). A report sink that
 * writes a svelte/store writable on that stack throws through a `$store` subscriber and leaves the module-wide
 * subscriber queue non-empty, so no later store write notifies anyone.
 *
 * Reproducer: the alert text must appear and an unrelated store must still notify its subscriber. REAL:
 * `handleWindowError`, the harness's runes, `$store` in a $derived and the {#if} block. This file holds exactly one
 * test: the wedge outlives the test that causes it.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, expect, test, vi } from 'vitest'
import WindowErrorTeardownTemplateHarness from './tests/WindowErrorTeardownTemplateHarness.svelte'
import { handleWindowError } from './windowErrorGuard'

let app: ReturnType<typeof mount> | undefined
let removeListener: (() => void) | undefined

afterEach(() => {
    if (app) unmount(app)
    app = undefined
    removeListener?.()
    removeListener = undefined
    vi.restoreAllMocks()
    document.body.replaceChildren()
})

test('(R) a throwing delegated onfocusout handler during block teardown still shows the alert and leaves store subscribers alive', async () => {
    const alertLike = writable('')
    const probe = writable(0)
    const probeSeen: number[] = []

    const onError = (event: ErrorEvent) => {
        event.preventDefault()
        handleWindowError(event, {
            warn() {},
            error() {},
            report: (error) => { alertLike.set('handler failed: ' + (error as Error).message) },
        })
    }
    window.addEventListener('error', onError)
    removeListener = () => window.removeEventListener('error', onError)

    const target = document.createElement('div')
    document.body.append(target)
    const host = mount(WindowErrorTeardownTemplateHarness, { target, props: { alertLike } })
    app = host
    flushSync()
    const unsubscribeProbe = probe.subscribe((value) => { probeSeen.push(value) })
    probeSeen.length = 0

    const field = target.querySelector<HTMLInputElement>('[data-part="field"]')!
    field.focus()
    expect(document.activeElement).toBe(field)

    // Chromium blurs a focused node, with focusout, while it is still attached and before it is removed.
    const originalRemove = Element.prototype.remove
    vi.spyOn(Element.prototype, 'remove').mockImplementation(function (this: Element) {
        const active = this.ownerDocument.activeElement
        if (active && this.contains(active)) (active as HTMLElement).blur()
        originalRemove.call(this)
    })
    ;(host as { hide(): void }).hide()
    flushSync()
    vi.restoreAllMocks()
    expect(target.querySelector('[data-part="field"]')).toBeNull()

    await tick()
    await Promise.resolve()
    probe.set(1)
    unsubscribeProbe()

    expect.soft(target.querySelector('[data-part="alert"]')!.textContent).toBe('handler failed: boom')
    expect.soft(probeSeen).toEqual([1])
})
