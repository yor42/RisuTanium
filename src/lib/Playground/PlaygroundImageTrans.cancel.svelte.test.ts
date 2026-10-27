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
    pick: vi.fn(async (): Promise<{ data: Uint8Array } | null> => null),
    request: vi.fn(),
    error: vi.fn(),
    hasStubs: vi.fn(() => false),
    ensure: vi.fn(async (): Promise<boolean> => true),
}))

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: h.hasStubs,
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: h.ensure,
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

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
    h.pick.mockReset()
    h.pick.mockImplementation(async () => null)
    h.request.mockReset()
    h.request.mockResolvedValue({ type: 'streaming', result: null })
    h.error.mockClear()
    h.hasStubs.mockReset()
    h.hasStubs.mockReturnValue(false)
    h.ensure.mockReset()
    h.ensure.mockResolvedValue(true)
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

/**
 * The module wait before the translation request. `hasModuleStubs` and `ensureCurrentModulesOrAlert` are mocks here (the
 * helper has its own rows); the image decode and canvas are stand-ins because happy-dom draws nothing. The
 * `waits` and `does-not-request` rows fail against the component without the wait.
 */
describe('the module wait before the image translation request', () => {
    const originalImage = globalThis.Image
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
    const originalCreateObjectURL = URL.createObjectURL

    class DecodedImage {
        src = ''
        width = 2
        height = 2
        async decode(): Promise<void> {}
    }

    beforeEach(() => {
        globalThis.Image = DecodedImage as unknown as typeof Image
        HTMLCanvasElement.prototype.getContext = (() => ({ clearRect() {}, drawImage() {} })) as unknown as typeof HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA'
        URL.createObjectURL = () => 'blob:image'
        h.pick.mockImplementation(async () => ({ data: new Uint8Array([1]) }))
    })

    afterEach(() => {
        globalThis.Image = originalImage
        HTMLCanvasElement.prototype.getContext = originalGetContext
        HTMLCanvasElement.prototype.toDataURL = originalToDataURL
        URL.createObjectURL = originalCreateObjectURL
    })

    async function settle() {
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()
    }

    test('image-translation-waits-for-the-referenced-modules-before-the-request', async () => {
        h.hasStubs.mockReturnValue(true)
        let release: (ok: boolean) => void = () => {}
        h.ensure.mockImplementation(() => new Promise<boolean>((resolve) => { release = resolve }))

        translateButton().click()
        await settle()
        expect(h.ensure).toHaveBeenCalledTimes(1)
        expect(h.request).not.toHaveBeenCalled()

        release(true)
        await settle()
        expect(h.request).toHaveBeenCalledTimes(1)
    })

    test('image-translation-does-not-request-when-a-module-fails-and-the-button-is-idle-again', async () => {
        h.hasStubs.mockReturnValue(true)
        h.ensure.mockResolvedValue(false)

        translateButton().click()
        await settle()

        expect(h.ensure).toHaveBeenCalledTimes(1)
        expect(h.request).not.toHaveBeenCalled()
        expect(h.error).not.toHaveBeenCalled()
        expect(translateButton().textContent?.trim()).toBe(language.imageTranslation)
    })

    test('guard: no-stubs-adds-no-await: without stubs the wait is never asked for and the request is made', async () => {
        translateButton().click()
        await settle()

        expect(h.ensure).not.toHaveBeenCalled()
        expect(h.request).toHaveBeenCalledTimes(1)
    })
})
