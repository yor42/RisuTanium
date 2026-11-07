// @vitest-environment jsdom
/**
 * A focused text field removed by a Svelte block fires blur and focusout while the block's update is running. The keyboard
 * watcher must not report into reactive state from inside that dispatch, or the write throws and the consumer's keyboard
 * flag stays stuck open. REAL: `softKeyboard.ts`, the harness's runes and {#if} block. MOCKED: the host bridge.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { HostIme, ImeState } from '../android/hostBridge'
import SoftKeyboardRemovalHarness from './tests/SoftKeyboardRemovalHarness.svelte'

class HostImeStub implements HostIme {
    state: ImeState | null = null
    listeners = new Set<(state: ImeState) => void>()
    read(): ImeState | null {
        return this.state
    }
    subscribe(listener: (state: ImeState) => void): () => void {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }
    report(visible: boolean, height: number): void {
        this.state = { visible, height }
        for (const listener of [...this.listeners]) listener(this.state)
    }
}

class ViewportStub extends EventTarget {
    height = 800
    width = 400
    scale = 1
}

describe('a focused field removed by a block', () => {
    let target: HTMLElement
    let app: ReturnType<typeof mount> | undefined
    let errors: string[]
    const recordError = (event: ErrorEvent) => {
        errors.push(event.error instanceof Error ? event.error.message : String(event.message))
        event.preventDefault()
    }

    beforeEach(() => {
        errors = []
        window.addEventListener('error', recordError)
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
        Object.defineProperty(window, 'visualViewport', { value: new ViewportStub(), configurable: true })
        target = document.createElement('div')
        document.body.append(target)
    })
    afterEach(() => {
        if (app) unmount(app)
        app = undefined
        window.removeEventListener('error', recordError)
        vi.restoreAllMocks()
        document.body.replaceChildren()
        Reflect.deleteProperty(window, 'visualViewport')
    })

    const root = () => target.firstElementChild as HTMLElement

    test('the keyboard flag follows the host close and no error is thrown', async () => {
        const ime = new HostImeStub()
        app = mount(SoftKeyboardRemovalHarness, { target, props: { ime } })
        flushSync()
        const input = target.querySelector<HTMLInputElement>('[data-part="name"]')!
        input.focus()
        ime.report(true, 288)
        flushSync()
        expect(root().hasAttribute('data-keyboard')).toBe(true)

        // Chromium blurs a focused node, with focusout, while it is still attached and before it is removed.
        const originalRemove = Element.prototype.remove
        vi.spyOn(Element.prototype, 'remove').mockImplementation(function (this: Element) {
            const active = this.ownerDocument.activeElement
            if (active && this.contains(active)) (active as HTMLElement).blur()
            originalRemove.call(this)
        })
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        flushSync()
        await tick()
        vi.restoreAllMocks()

        expect(target.querySelector('[data-part="name"]')).toBeNull()
        expect(document.activeElement).toBe(target.querySelector('[data-part="done"]'))
        ime.report(false, 0)
        await tick()
        expect(root().hasAttribute('data-keyboard')).toBe(false)
        expect(errors).toEqual([])
    })
})
