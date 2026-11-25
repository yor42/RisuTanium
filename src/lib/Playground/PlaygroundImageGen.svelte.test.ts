// @vitest-environment happy-dom

/**
 * `PlaygroundImageGen.svelte` (the Playground's image generation tool): a failed
 * `generateAIImage` call reports the error through `alertError` and resets `generating`
 * in `finally` so the button stays usable for subsequent runs.
 *
 * Mounts the REAL `PlaygroundImageGen.svelte`. `generateAIImage`, `createBlankChar` and
 * `alertError` are recording stubs. Titles beginning "guard:" pin behaviour that must be
 * preserved; "regression reproducer:" titles fail against the unfixed component where a
 * rejected generation leaves `generating` stuck at `true`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

const mocks = vi.hoisted(() => ({
    generateAIImage: vi.fn(),
    createBlankChar: vi.fn(() => ({ chaId: 'blank' })),
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selIdState = $state({ selId: -1 })
    return { DBState: state, selIdState } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/stableDiff'), () => ({
    generateAIImage: mocks.generateAIImage,
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: mocks.createBlankChar,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: mocks.alertError,
}) as unknown as typeof import('src/ts/alert'))

import PlaygroundImageGen from './PlaygroundImageGen.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundImageGen, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const generateButton = (target: HTMLElement) => {
    const buttons = Array.from(target.querySelectorAll('button'))
    return buttons[buttons.length - 1] as HTMLButtonElement
}

describe('PlaygroundImageGen', () => {
    beforeEach(() => {
        mocks.generateAIImage.mockReset()
        mocks.createBlankChar.mockClear()
        mocks.alertError.mockReset()
    })

    afterEach(async () => {
        for (const item of mounted.splice(0)) {
            await unmount(item.app).catch(() => {})
            item.target.remove()
        }
    })

    test('regression reproducer: a rejected generation reports the error, clears the spinner and leaves the button usable', async () => {
        mocks.generateAIImage
            .mockRejectedValueOnce(new Error('image read refused'))
            .mockResolvedValueOnce('data:image/png;base64,AAA')

        const target = mountPage()
        generateButton(target).click()
        await settle()

        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        expect((mocks.alertError.mock.calls[0][0] as Error).message).toBe('image read refused')
        expect(target.querySelector('.loadmove')).toBeNull()
        expect(generateButton(target).textContent?.trim()).toBe(language.playground.generate)
        expect(target.querySelector('img')).toBeNull()

        generateButton(target).click()
        await settle()

        expect(mocks.generateAIImage).toHaveBeenCalledTimes(2)
        expect(target.querySelector('.loadmove')).toBeNull()
        const img = target.querySelector('img') as HTMLImageElement | null
        expect(img).not.toBeNull()
        expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAA')
    })

    test('regression reproducer: a non-Error rejection is stringified for alertError and resets the button', async () => {
        mocks.generateAIImage
            .mockRejectedValueOnce('provider down')
            .mockResolvedValueOnce('data:image/png;base64,BBB')

        const target = mountPage()
        generateButton(target).click()
        await settle()

        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        expect(mocks.alertError).toHaveBeenCalledWith('provider down')
        expect(target.querySelector('.loadmove')).toBeNull()

        generateButton(target).click()
        await settle()

        expect(mocks.generateAIImage).toHaveBeenCalledTimes(2)
        expect(target.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,BBB')
    })

    test('guard: a successful generation renders the image and ignores re-entrant clicks while in flight', async () => {
        let resolveGen: (value: string) => void = () => {}
        mocks.generateAIImage.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveGen = resolve }))

        const target = mountPage()
        generateButton(target).click()
        flushSync()

        expect(target.querySelector('.loadmove')).not.toBeNull()
        generateButton(target).click()
        flushSync()
        expect(mocks.generateAIImage).toHaveBeenCalledTimes(1)

        resolveGen('data:image/png;base64,CCC')
        await settle()

        expect(target.querySelector('.loadmove')).toBeNull()
        expect(target.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,CCC')
        expect(mocks.alertError).not.toHaveBeenCalled()
    })
})
