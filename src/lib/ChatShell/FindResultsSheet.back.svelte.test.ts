// @vitest-environment jsdom
/**
 * Back with the search results sheet open. REAL: `FindResultsSheet.svelte`, `ShellSheet.svelte` and the back-handler registry.
 * STAND-IN: an outer Back handler registered before the sheet opens plays the search bar's own close.
 * MOCKED: the language table and the alert modules the registry imports.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { Message } from '../../ts/storage/database.svelte'

vi.mock('../../lang', () => ({
    language: { cancel: 'Cancel', chatShellFindSeeAll: 'See all', chatShellFindHidden: 'Hidden from the prompt', chatShellFindNoDate: 'no date' },
}))
vi.mock('src/lang', () => ({
    language: { cancel: 'Cancel', chatShellFindSeeAll: 'See all', chatShellFindHidden: 'Hidden from the prompt', chatShellFindNoDate: 'no date' },
}))
vi.mock('../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { dispatchBack, registerBackHandler, resetBackHandlersForTests } from '../../ts/backHandlers'
import FindResultsSheet from './FindResultsSheet.svelte'

let app: ReturnType<typeof mount> | undefined
let outerBack: Mock<() => boolean>
let onclose: Mock<() => void>
const view = $state({ open: true })
const messages = $state<Message[]>([])

function show(): void {
    const target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(FindResultsSheet, {
        target,
        props: {
            get open() { return view.open }, opener: null, background: [], get messages() { return messages }, hits: [], query: 'lantern',
            complete: true, thinking: false, firstText: '', userName: 'Me', charName: 'Seraphina',
            userImage: '', charImage: '', onpick: vi.fn<(position: number) => void>(), onclose,
        },
    })
    flushSync()
}

beforeEach(() => {
    resetBackHandlersForTests()
    view.open = true
    outerBack = vi.fn<() => boolean>(() => true)
    onclose = vi.fn<() => void>(() => { view.open = false })
})
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('Back with the results sheet open', () => {
    test('B2d-6: one Back closes only the sheet and leaves the outer surface open; the next Back reaches the outer surface', async () => {
        registerBackHandler(outerBack)
        show()
        expect(document.querySelector('[data-part="chat-sheet"]')).not.toBeNull()

        expect(dispatchBack()).toBe(true)
        await tick()
        expect(onclose).toHaveBeenCalledTimes(1)
        expect(outerBack).not.toHaveBeenCalled()
        expect(document.querySelector('[data-part="chat-sheet"]')).toBeNull()

        expect(dispatchBack()).toBe(true)
        expect(outerBack).toHaveBeenCalledTimes(1)
        expect(onclose).toHaveBeenCalledTimes(1)
    })
})
