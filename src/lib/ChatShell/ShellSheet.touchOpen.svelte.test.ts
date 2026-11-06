// @vitest-environment jsdom
/**
 * Reproducer (R9-P F5): a long press opens the sheet under the finger, and the click the browser synthesises when that
 * touch lifts lands on the scrim. The sheet must stay open for that click and still close on a later deliberate tap.
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetBackHandlersForTests } from '../../ts/backHandlers'

vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: () => {} }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

const children = createRawSnippet(() => ({ render: () => '<button data-sheet-initial>First action</button>' }))
const mounted: { app: ReturnType<typeof mount>, target: HTMLElement }[] = []
let clockOffset = 0
let nowSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
    clockOffset = 0
    const realNow = performance.now.bind(performance)
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => realNow() + clockOffset)
})

afterEach(async () => {
    for (const item of mounted.reverse()) { await unmount(item.app); item.target.remove() }
    mounted.length = 0
    nowSpy?.mockRestore()
    nowSpy = null
    resetBackHandlersForTests()
})

function pointer(type: string, pointerType: string, on: Element = document.body): void {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerType', { value: pointerType })
    on.dispatchEvent(event)
}

async function mountSheet(open: { value: boolean }) {
    const { default: ShellSheet } = await import('./ShellSheet.svelte')
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ShellSheet, { target, props: { get open() { return open.value }, kind: 'menu', mode: 'action', label: 'Actions', onclose: () => { open.value = false }, children } })
    mounted.push({ app, target })
    flushSync()
    return target
}

describe('a sheet opened by a long press', () => {
    test('stays open for the click that follows the opening touch and closes on a later tap on the scrim', async () => {
        const open = $state({ value: false })
        const target = await mountSheet(open)
        // The long press: the finger goes down, the sheet opens while it is still down, then it lifts.
        pointer('pointerdown', 'touch')
        clockOffset += 600
        open.value = true
        flushSync()
        const scrim = target.querySelector<HTMLButtonElement>('[data-part="chat-sheet-scrim"]')!
        clockOffset += 30
        pointer('pointerup', 'touch')
        scrim.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        scrim.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        clockOffset += 20
        scrim.click()
        flushSync()
        expect(open.value).toBe(true)
        expect(target.querySelector('[data-part="chat-sheet"]')).not.toBeNull()

        // A deliberate tap on the scrim later is a new touch and dismisses.
        clockOffset += 500
        pointer('pointerdown', 'touch', scrim)
        clockOffset += 60
        pointer('pointerup', 'touch', scrim)
        scrim.click()
        flushSync()
        expect(open.value).toBe(false)
    })

    test('a click on the scrim without any opening touch closes at once', async () => {
        const open = $state({ value: true })
        const target = await mountSheet(open)
        target.querySelector<HTMLButtonElement>('[data-part="chat-sheet-scrim"]')!.click()
        flushSync()
        expect(open.value).toBe(false)
    })

    test('a click that arrives after the grace window of the opening touch closes the sheet', async () => {
        const open = $state({ value: false })
        const target = await mountSheet(open)
        pointer('pointerdown', 'touch')
        clockOffset += 600
        open.value = true
        flushSync()
        pointer('pointerup', 'touch')
        clockOffset += 450
        target.querySelector<HTMLButtonElement>('[data-part="chat-sheet-scrim"]')!.click()
        flushSync()
        expect(open.value).toBe(false)
    })
})
