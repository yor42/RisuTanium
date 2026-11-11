// @vitest-environment jsdom
/**
 * A window `error` listener that reports into a svelte/store writable must not do so inside the stack that raised the
 * error. A focused field removed by a Svelte block fires focusout while the block effect is running; if a listener
 * throws there, jsdom (like Chromium) delivers the error to window `error` on that same stack, where a store write
 * that reaches a `$store` subscriber throws and leaves the module-wide svelte/store subscriber queue non-empty.
 * After that no store subscriber anywhere is notified again.
 *
 * Reproducer: the alert text must appear and an unrelated store must still notify its subscriber. REAL:
 * `handleWindowError`, the harness's runes, `$store` in a $derived and the {#if} block. The report sink is the
 * app's sink shape (a store write). This file holds exactly one test: the wedge outlives the test that causes it.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, expect, test, vi } from 'vitest'
import WindowErrorTeardownHarness from './tests/WindowErrorTeardownHarness.svelte'
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

test('(R) a throwing raw focusout listener during block teardown still shows the alert and leaves store subscribers alive', async () => {
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
    const host = mount(WindowErrorTeardownHarness, { target, props: { alertLike } })
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
    // The removal must have run from the harness effect; a direct write would not exercise the guarded stack.
    expect((host as { effectHideCount(): number }).effectHideCount()).toBe(1)

    await tick()
    await Promise.resolve()
    probe.set(1)
    unsubscribeProbe()

    expect.soft(target.querySelector('[data-part="alert"]')!.textContent).toBe('handler failed: boom')
    expect.soft(probeSeen).toEqual([1])
})
