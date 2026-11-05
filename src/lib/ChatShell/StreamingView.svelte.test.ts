// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'

vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return { ...original, createToSafeHtml: async () => async (source: string) => `<p>${source}</p>` }
})

import StreamingView from './StreamingView.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof StreamingView> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    vi.useRealTimers()
})

describe('StreamingView append-only rendering', () => {
    test('T1: a cadence tick updates only the open paragraph', async () => {
        vi.useFakeTimers()
        const state = $state({ text: 'Finished.\n\nOpen' })
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(StreamingView, { target, props: state })
        mounted.push({ target, app })
        await vi.advanceTimersByTimeAsync(150)
        await tick()
        const finished = target.querySelector('[data-part="chat-stream-finished"]')
        const open = target.querySelector('[data-part="chat-stream-open"]')
        expect(finished?.textContent).toContain('Finished.')
        expect(open?.textContent).toContain('Open')
        state.text = 'Finished.\n\nOpen text'
        flushSync()
        await vi.advanceTimersByTimeAsync(150)
        await tick()
        expect(target.querySelector('[data-part="chat-stream-finished"]')).toBe(finished)
        expect(target.querySelector('[data-part="chat-stream-open"]')).toBe(open)
        expect(open?.textContent).toContain('Open text')
    })
})
