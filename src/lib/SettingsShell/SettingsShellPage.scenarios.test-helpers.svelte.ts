/**
 * The scroll-memory scenarios of `SettingsShellPage.svelte`, registered by both
 * `SettingsShellPage.modes.svelte.test.ts` (the shipped scheduler) and
 * `SettingsShellPage.asyncOrder.svelte.test.ts` (the async scheduler), so each scenario runs under both
 * schedulers with no copy.
 *
 * The page remembers the scroll position of the view it is leaving, keyed by that view's index. Neither test
 * DOM has layout, so the column's clamp is modelled: the scroll column keeps whatever `scrollTop` it is given
 * until the keyed view node leaves it, and then it reads 0, as a real column does when its content shrinks.
 *
 * The caller owns the module mocks (`stores.svelte`, `alertBack` and the legacy Settings pages): `vi.mock` is
 * file-scoped and the page graph needs them before it is imported.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import SettingsShellPage from './SettingsShellPage.svelte'

export function registerSettingsScrollMemorySuite(): void {
    const mounted: Array<ReturnType<typeof mount>> = []
    const patches: Array<() => void> = []

    // A column whose scroll position the test sets, and which drops to 0 when its keyed view node is removed.
    function modelClampingColumn(target: HTMLElement): HTMLElement {
        const column = target.querySelector<HTMLElement>('[data-part="settings-page-scroll"]')!
        let position = 0
        Object.defineProperty(column, 'scrollTop', {
            configurable: true,
            get: () => position,
            set: (value: number) => { position = value },
        })
        const realRemove = Element.prototype.remove
        Element.prototype.remove = function (this: Element) {
            if (this.parentElement === column && this.getAttribute('data-part') === 'settings-view') {
                position = 0
            }
            realRemove.call(this)
        }
        patches.push(() => { Element.prototype.remove = realRemove })
        return column
    }

    function render(first: number) {
        const state = $state({ index: first })
        const scrollMemory = new Map<number, number>()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(SettingsShellPage, {
            target,
            props: { get index() { return state.index }, phone: false, scrollMemory },
        })
        mounted.push(app)
        flushSync()
        return { state, scrollMemory, column: modelClampingColumn(target), app }
    }

    describe('the page remembers the scroll position of the view it leaves', () => {
        afterEach(() => {
            for (const restore of patches.splice(0).reverse()) restore()
            for (const app of mounted.splice(0)) unmount(app)
            document.body.replaceChildren()
        })

        test('switching view stores the position the leaving view had, before its content clamps', () => {
            const { state, scrollMemory, column } = render(1)
            column.scrollTop = 500
            state.index = 13
            flushSync()
            expect(scrollMemory.get(1)).toBe(500)
        })

        test('each view stores its own position under its own index, in both directions', () => {
            const { state, scrollMemory, column } = render(1)
            column.scrollTop = 500
            state.index = 13
            flushSync()
            column.scrollTop = 120
            state.index = 1
            flushSync()
            expect(scrollMemory.get(1)).toBe(500)
            expect(scrollMemory.get(13)).toBe(120)
        })

        test('guard: a first render stores nothing', () => {
            const { scrollMemory } = render(1)
            expect(scrollMemory.size).toBe(0)
        })

        test('guard: the chip of the shown view is the pressed one, before and after a switch', () => {
            const { state } = render(1)
            const pressedViews = () => Array.from(document.querySelectorAll<HTMLElement>('[data-part="settings-view-chip"][aria-pressed="true"]')).map((chip) => chip.dataset.view)
            expect(pressedViews()).toEqual(['chatBot'])
            state.index = 13
            flushSync()
            expect(pressedViews()).toEqual(['prompt'])
        })

        test('guard: a teardown stores the position of the view on screen', () => {
            const { scrollMemory, column, app } = render(13)
            column.scrollTop = 300
            mounted.splice(mounted.indexOf(app), 1)
            unmount(app)
            expect(scrollMemory.get(13)).toBe(300)
        })
    })
}
