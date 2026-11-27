// @vitest-environment jsdom

/**
 * `HypaV3Progress.svelte` carries the memory-progress vocabulary on its real elements (W1-T7c): the collapsed pill is a button, and its click shows
 * the card with the store's message, bar and sub-message. MOCKED: the stores module, reduced to the progress store.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    hypaV3ProgressStore: writable({ open: false, miniMsg: '', msg: '', subMsg: '' }),
    savingStoppedReason: writable(''),
    frozenSaveKeysStore: writable([]),
}))

import { hypaV3ProgressStore } from 'src/ts/stores.svelte'
import HypaV3Progress from './HypaV3Progress.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountProgress(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Progress, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    hypaV3ProgressStore.set({ open: true, miniMsg: '3/9', msg: 'Summarizing', subMsg: 'Chunk 3 of 9' })
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('HypaV3Progress overlay parts', () => {
    test('the collapsed state is the pill button holding the mini message', () => {
        const target = mountProgress()
        const pill = target.querySelector('[data-part="memory-progress-pill"]') as HTMLButtonElement
        expect(pill.tagName).toBe('BUTTON')
        expect(pill.querySelector('[data-part="memory-progress-mini"]')?.textContent?.trim()).toBe('3/9')
        expect(target.querySelector('[data-part="memory-progress"]')).toBeNull()
    })

    test('a click on the pill shows the card with the message, the bar, its fill and the sub-message', () => {
        const target = mountProgress()
        ;(target.querySelector('[data-part="memory-progress-pill"]') as HTMLButtonElement).click()
        flushSync()
        const layer = target.querySelector('[data-part="memory-progress"]') as HTMLElement
        expect(layer).not.toBeNull()
        const card = layer.querySelector(':scope > [data-part="memory-progress-card"]') as HTMLButtonElement
        expect(card.tagName).toBe('BUTTON')
        expect(card.querySelector('[data-part="memory-progress-text"]')?.textContent).toBe('Summarizing')
        expect(card.querySelector('[data-part="memory-progress-bar"] > [data-part="memory-progress-bar-fill"]')).not.toBeNull()
        expect(card.querySelector('[data-part="memory-progress-subtext"]')?.textContent).toBe('Chunk 3 of 9')
        expect(target.querySelector('[data-part="memory-progress-pill"]')).toBeNull()
    })

    test('a click on the card collapses it back to the pill', () => {
        const target = mountProgress()
        ;(target.querySelector('[data-part="memory-progress-pill"]') as HTMLButtonElement).click()
        flushSync()
        ;(target.querySelector('[data-part="memory-progress-card"]') as HTMLButtonElement).click()
        flushSync()
        expect(target.querySelector('[data-part="memory-progress-pill"]')).not.toBeNull()
    })
})
