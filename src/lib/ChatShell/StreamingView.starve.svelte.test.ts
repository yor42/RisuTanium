// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

const control = vi.hoisted(() => ({ delay: 0, conversions: 0 }))

vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return {
        ...original,
        createToSafeHtml: async () => async (source: string) => {
            control.conversions++
            await new Promise((resolve) => setTimeout(resolve, control.delay))
            return `<p>${source}</p>`
        },
    }
})
vi.mock('../../lang', () => ({ language: { chatShellThinking: (words: number) => `Thinking ${words}` } }))

import StreamingView from './StreamingView.svelte'

let app: ReturnType<typeof StreamingView> | undefined
let target: HTMLElement
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    vi.useRealTimers()
    control.conversions = 0
})

async function stream(conversionMs: number, finishedBlocks: number, chunkGapMs: number, totalMs: number) {
    vi.useFakeTimers()
    control.delay = conversionMs
    let text = ''
    for (let i = 0; i < finishedBlocks; i++) text += `Block ${i}.\n\n`
    const state = $state({ text: `${text}open` })
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(StreamingView, { target, props: state })
    let chunks = 0
    const samples: { finished: number, open: string }[] = []
    for (let elapsed = 0; elapsed < totalMs; elapsed += chunkGapMs) {
        await vi.advanceTimersByTimeAsync(chunkGapMs)
        state.text += ` w${chunks++}`
        flushSync()
        await tickFake()
        samples.push({ finished: target.querySelectorAll('[data-part="chat-stream-finished"]').length, open: target.querySelector('[data-part="chat-stream-open"]')?.textContent ?? '' })
    }
    await vi.advanceTimersByTimeAsync(2000)
    await tickFake()
    return { chunks, samples }
}

describe('StreamingView with a conversion slower than the cadence', () => {
    test('finished blocks commit and the open paragraph grows while chunks keep arriving', async () => {
        const { chunks, samples } = await stream(15, 40, 60, 4000)
        expect(chunks).toBeGreaterThan(60)
        expect(samples[30].finished).toBe(40)
        expect(samples[60].finished).toBe(40)
        const lastWord = (open: string) => Number(open.match(/w(\d+)\s*$/)?.[1] ?? -1)
        expect(lastWord(samples[30].open)).toBeGreaterThanOrEqual(20)
        expect(lastWord(samples[60].open)).toBeGreaterThanOrEqual(50)
        expect(target.querySelectorAll('[data-part="chat-stream-finished"]').length).toBe(40)
        expect(target.querySelector('[data-part="chat-stream-open"]')?.textContent).toContain(`w${chunks - 1}`)
    })

    test('a conversion is never started for a block that is already committed', async () => {
        await stream(15, 5, 60, 1200)
        const committed = target.querySelectorAll('[data-part="chat-stream-finished"]').length
        expect(committed).toBe(5)
        const before = control.conversions
        await vi.advanceTimersByTimeAsync(2000)
        expect(control.conversions).toBe(before)
    })
})
