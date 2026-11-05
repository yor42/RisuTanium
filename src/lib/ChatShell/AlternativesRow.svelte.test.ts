// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../lang', () => ({ language: {
    chatShellReplyOf: (index: number, total: number) => `Reply ${index} of ${total}`, chatShellFirstMessageOf: (index: number, total: number) => `First message ${index} of ${total}`, chatShellPreviousReply: 'Previous reply',
    chatShellNextReply: 'Next reply', chatShellFirstReply: 'First reply',
    chatShellLastReply: 'Last reply', chatShellFirstMessage: 'First message', chatShellNewReply: 'New reply',
} }))

import AlternativesRow from './AlternativesRow.svelte'

let target: HTMLElement
let app: ReturnType<typeof AlternativesRow> | undefined
function show(index: number, count: number, firstMessage = false) {
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(AlternativesRow, { target, props: { idx: 2, expectedId: 'reply', index, count, firstMessage } })
    flushSync()
    return target
}
afterEach(async () => {
    if (app) await unmount(app)
    target?.remove()
    app = undefined
    stepSibling.mockClear()
    regenerateNewest.mockClear()
})

describe('T3 alternatives controls', () => {
    test('the last forward control is disabled and cannot generate', () => {
        const row = show(2, 2)
        const next = row.querySelector<HTMLButtonElement>('[data-step="next"]')!
        expect(next.disabled).toBe(true)
        next.click()
        expect(stepSibling).not.toHaveBeenCalled()
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('explicit new reply generates once within the guard interval', () => {
        const row = show(2, 2)
        const newReply = row.querySelector<HTMLButtonElement>('[data-action="newReply"]')!
        newReply.click()
        newReply.click()
        expect(regenerateNewest).toHaveBeenCalledTimes(1)
    })
    test('forward and back browse without generating', () => {
        const row = show(2, 3)
        row.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        row.querySelector<HTMLButtonElement>('[data-step="prev"]')!.click()
        expect(stepSibling).toHaveBeenNthCalledWith(1, expect.anything(), 2, 'reply', 'forward', { generate: false })
        expect(stepSibling).toHaveBeenNthCalledWith(2, expect.anything(), 2, 'reply', 'back', { generate: false })
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('the first message has no new reply control', () => {
        expect(show(1, 2, true).querySelector('[data-action="newReply"]')).toBeNull()
    })
    test('onStep takes over both arrows and nothing reaches the reply tree', () => {
        const steps: string[] = []
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(AlternativesRow, { target, props: { idx: -1, index: 2, count: 3, firstMessage: true, onStep: (direction: 'back' | 'forward') => steps.push(direction) } })
        flushSync()
        target.querySelector<HTMLButtonElement>('[data-step="next"]')!.click()
        target.querySelector<HTMLButtonElement>('[data-step="prev"]')!.click()
        expect(steps).toEqual(['forward', 'back'])
        expect(stepSibling).not.toHaveBeenCalled()
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('the counter names are interpolated keys for replies and for the first message', () => {
        expect(show(2, 3).querySelector('[data-part="chat-alternatives"]')!.getAttribute('aria-label')).toBe('Reply 2 of 3')
        expect(target.querySelector('span[aria-live]')!.textContent).toBe('2 / 3')
        unmount(app!); target.remove()
        const row = show(2, 3, true)
        expect(row.querySelector('[data-part="chat-alternatives"]')!.getAttribute('aria-label')).toBe('First message 2 of 3')
        expect(row.querySelector('span[aria-live]')!.textContent).toBe('First message 2 of 3')
    })
    test('exactly one control of the newest reply carries the reroll hotkey class: the next arrow, then new reply at the end', () => {
        const middle = show(1, 3)
        expect([...middle.querySelectorAll('.button-icon-reroll')].map((node) => node.getAttribute('data-step') ?? node.getAttribute('data-action'))).toEqual(['next'])
        unmount(app!); target.remove()
        const end = show(3, 3)
        expect([...end.querySelectorAll('.button-icon-reroll')].map((node) => node.getAttribute('data-step') ?? node.getAttribute('data-action'))).toEqual(['newReply'])
        unmount(app!); target.remove()
        expect(show(2, 3, true).querySelector('.button-icon-reroll, .button-icon-unreroll')).toBeNull()
    })})
