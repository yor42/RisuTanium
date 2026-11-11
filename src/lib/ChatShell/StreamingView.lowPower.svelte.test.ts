// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mount, unmount } from 'svelte'
import { tickFake } from '../../ts/tests/svelteTick.test-helpers'

const control = vi.hoisted(() => ({ cadenceArgs: [] as unknown[] }))

vi.mock('../../ts/chatShell/streamingSafe', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamingSafe')>()
    return {
        ...original,
        createToSafeHtml: async () => async (source: string) => `<p>${source}</p>`,
    }
})
vi.mock('../../ts/chatShell/streamCadence', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../ts/chatShell/streamCadence')>()
    return {
        ...original,
        createStreamCadence: (lowPower?: boolean) => {
            control.cadenceArgs.push(lowPower)
            return original.createStreamCadence(lowPower)
        },
    }
})
vi.mock('../../ts/chatShell/yieldToEventLoop', () => ({ yieldToEventLoop: async () => {} }))
vi.mock('../../lang', () => ({ language: { chatShellThinking: (words: number) => `Thinking… ${words}` } }))

import StreamingView from './StreamingView.svelte'

const mounted: Array<{ target: HTMLElement, app: ReturnType<typeof StreamingView> }> = []
afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) { await unmount(app); target.remove() }
    vi.useRealTimers()
    control.cadenceArgs = []
    const root = document.documentElement
    root.removeAttribute('data-low-power')
    root.classList.remove('nexus-low-power')
})

function start(text: string): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(StreamingView, { target, props: { text } })
    mounted.push({ target, app })
    return target
}

function openText(target: HTMLElement): string {
    return target.querySelector('[data-part="chat-stream-open"]')?.textContent ?? ''
}

describe('StreamingView reads the low-power marker once at the stream start', () => {
    test('R T4 the data attribute makes the cadence low-power', () => {
        document.documentElement.setAttribute('data-low-power', '')
        start('Open')
        expect(control.cadenceArgs).toEqual([true])
    })

    test('R T4 the class makes the cadence low-power', () => {
        document.documentElement.classList.add('nexus-low-power')
        start('Open')
        expect(control.cadenceArgs).toEqual([true])
    })

    test('G T4 with no marker the cadence is not low-power', () => {
        start('Open')
        expect(control.cadenceArgs.map((arg) => arg ?? false)).toEqual([false])
    })

    test('R T4b a marked view renders the first text after the 250 ms floor, not at 100 ms', async () => {
        vi.useFakeTimers()
        document.documentElement.setAttribute('data-low-power', '')
        const target = start('Open')
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(openText(target)).toBe('')
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(openText(target)).toContain('Open')
    })

    test('G T4b an unmarked view renders the first text by 150 ms', async () => {
        vi.useFakeTimers()
        const target = start('Open')
        await vi.advanceTimersByTimeAsync(150)
        await tickFake()
        expect(openText(target)).toContain('Open')
    })
})
