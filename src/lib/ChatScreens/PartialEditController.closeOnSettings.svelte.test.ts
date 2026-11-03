// @vitest-environment jsdom

/**
 * Opening Settings cancels an open partial edit and hides the partial-edit buttons.
 *
 * Mounts the REAL `PartialEditController.svelte` over a real message body, with the REAL
 * `partialEdit` matcher and `localDrafts`. The page-level pieces jsdom lacks are replaced:
 * `IntersectionObserver` reports the body as visible, `requestAnimationFrame` runs at once and
 * `document.elementFromPoint` answers with the hovered paragraph. The surface's close signal is
 * driven by bumping `chatSurface.closeEpoch`, which is what the surface does when Settings opens.
 *
 * Invariants pinned here:
 *  - the button wrapper the controller appends to `document.body` is hidden after Settings opens,
 *    because it lives outside the hidden chat surface and would otherwise stay on screen;
 *  - an open partial edit is cancelled and its registered draft is released;
 *  - the buttons stay shown when the signal does not fire.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: {} },
}))

import PartialEditController from './PartialEditController.svelte'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { hasMessageEditorDrafts, resetLocalDraftsForTest } from 'src/ts/localDrafts'

const MESSAGE_TEXT = 'Hello partial edit text'

let bodyRoot: HTMLElement
let paragraph: HTMLElement
let mountedController: Record<string, unknown> | null = null

beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
        constructor(private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void) {}
        observe() {
            this.callback([{ isIntersecting: true }])
        }
        disconnect() {}
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        callback(0)
        return 1
    })
    bodyRoot = document.createElement('div')
    paragraph = document.createElement('p')
    paragraph.textContent = MESSAGE_TEXT
    bodyRoot.append(paragraph)
    document.body.append(bodyRoot)
    ;(document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => paragraph
})

afterEach(async () => {
    if (mountedController !== null) {
        await unmount(mountedController as never)
    }
    mountedController = null
    document.body.replaceChildren()
    resetChatSurfaceForTests()
    resetLocalDraftsForTest()
    vi.unstubAllGlobals()
})

function showController() {
    const holder = document.createElement('div')
    document.body.append(holder)
    mountedController = mount(PartialEditController, {
        target: holder,
        props: { messageData: MESSAGE_TEXT, chatIndex: 0, bodyRoot, blockEditEnabled: true },
    }) as unknown as Record<string, unknown>
    flushSync()
}

function hoverParagraph() {
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5, bubbles: true }))
    flushSync()
}

function buttonWrapper(): HTMLElement {
    return document.body.querySelector<HTMLElement>('.partial-edit-btn-wrapper')!
}

describe('PartialEditController: opening Settings', () => {
    test('hides the button wrapper that lives on document.body', () => {
        showController()
        hoverParagraph()
        expect(buttonWrapper().style.display).toBe('flex')

        chatSurface.closeEpoch += 1
        flushSync()

        expect(buttonWrapper().style.display).toBe('none')
    })

    test('cancels an open partial edit and releases its draft', async () => {
        showController()
        hoverParagraph()
        buttonWrapper().querySelector<HTMLButtonElement>('.partial-edit-btn-edit')!.click()
        await vi.waitFor(() => {
            flushSync()
            expect(document.body.querySelector('.partial-edit-modal')).not.toBeNull()
        })
        expect(hasMessageEditorDrafts()).toBe(true)

        chatSurface.closeEpoch += 1
        flushSync()

        expect(document.body.querySelector('.partial-edit-modal')).toBeNull()
        expect(hasMessageEditorDrafts()).toBe(false)
    })

    test('closing the editor before the scroll timer fires throws nothing', async () => {
        const caught: unknown[] = []
        const onWindowError = (event: ErrorEvent) => {
            caught.push(event.error ?? event.message)
            event.preventDefault()
        }
        const onUncaught = (error: unknown) => {
            caught.push(error)
        }
        window.addEventListener('error', onWindowError)
        process.on('uncaughtException', onUncaught)
        try {
            showController()
            hoverParagraph()
            buttonWrapper().querySelector<HTMLButtonElement>('.partial-edit-btn-edit')!.click()
            await vi.waitFor(() => {
                flushSync()
                expect(document.body.querySelector('.partial-edit-modal')).not.toBeNull()
            })
            // Past the focus timer, which has scheduled the delayed scroll, but before that scroll runs.
            await new Promise((resolve) => setTimeout(resolve, 60))

            chatSurface.closeEpoch += 1
            flushSync()
            expect(document.body.querySelector('.partial-edit-modal')).toBeNull()

            await new Promise((resolve) => setTimeout(resolve, 300))
            expect(caught).toEqual([])
        } finally {
            window.removeEventListener('error', onWindowError)
            process.off('uncaughtException', onUncaught)
        }
    })

    test('guard: without the close signal the buttons stay shown', () => {
        showController()
        hoverParagraph()

        flushSync()

        expect(buttonWrapper().style.display).toBe('flex')
    })
})
