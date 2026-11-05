// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const stepSibling = vi.hoisted(() => vi.fn())
const regenerateNewest = vi.hoisted(() => vi.fn())
vi.mock('../../ts/process/composerActions.svelte', () => ({ stepSibling, regenerateNewest }))
vi.mock('../../lang', () => ({ language: {
    chatShellReply: 'Reply', chatShellOf: 'of', chatShellPreviousReply: 'Previous reply',
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
        const next = row.querySelector<HTMLButtonElement>('.button-icon-reroll')!
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
        row.querySelector<HTMLButtonElement>('.button-icon-reroll')!.click()
        row.querySelector<HTMLButtonElement>('.button-icon-unreroll')!.click()
        expect(stepSibling).toHaveBeenNthCalledWith(1, expect.anything(), 2, 'reply', 'forward', { generate: false })
        expect(stepSibling).toHaveBeenNthCalledWith(2, expect.anything(), 2, 'reply', 'back', { generate: false })
        expect(regenerateNewest).not.toHaveBeenCalled()
    })
    test('the first message has no new reply control', () => {
        expect(show(1, 2, true).querySelector('[data-action="newReply"]')).toBeNull()
    })
})
