// @vitest-environment happy-dom

/**
 * Closing the file chooser of the image translation (auto mode) without
 * choosing an image ends the run quietly: no translation request for the blank
 * canvas, no error toast, and the button is idle again.
 *
 * Mounts the REAL `PlaygroundImageTrans.svelte`; the picker answers `null` as
 * `selectSingleFile` does when nothing was picked. The request, util and alert
 * modules are mocks, so nothing leaves the test.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    pick: vi.fn(async (): Promise<null> => null),
    request: vi.fn(),
    error: vi.fn(),
}))

vi.mock(import('src/ts/util'), () => ({
    jsonOutputTrimmer: vi.fn((s: string) => s),
    selectSingleFile: h.pick,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: h.request,
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: h.error,
}) as unknown as typeof import('src/ts/alert'))

vi.mock('../UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import { language } from 'src/lang'
import PlaygroundImageTrans from './PlaygroundImageTrans.svelte'

let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => {
    h.pick.mockClear()
    h.request.mockClear()
    h.error.mockClear()
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundImageTrans, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
})

afterEach(async () => {
    await unmount(app as never)
    target.remove()
})

function translateButton(): HTMLButtonElement {
    const buttons = Array.from(target.querySelectorAll('button'))
    return buttons[buttons.length - 1]
}

describe('the image translation button in auto mode', () => {
    test('closing the chooser sends no request, shows no error and leaves the button idle', async () => {
        translateButton().click()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()

        expect(h.pick).toHaveBeenCalledTimes(1)
        expect(h.request).not.toHaveBeenCalled()
        expect(h.error).not.toHaveBeenCalled()
        expect(translateButton().textContent?.trim()).toBe(language.imageTranslation)
    })

    test('guard: a second click after a closed chooser asks for the chooser again', async () => {
        translateButton().click()
        await new Promise((resolve) => setTimeout(resolve, 20))
        translateButton().click()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(h.pick).toHaveBeenCalledTimes(2)
    })
})
