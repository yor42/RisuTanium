// @vitest-environment happy-dom

/**
 * (G) A caller that handles a refused image read in its own press handler: the playground image generator.
 *
 * Mounts the REAL `PlaygroundImageGen.svelte` with `generateAIImage` rejecting with each access control list string and
 * presses the button. The press handler catches the rejection, reports the exact refusal string through `alertError`,
 * clears the generating spinner, and shows no image.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({
    generate: vi.fn(async (): Promise<string | null> => null),
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    const selIdState = $state({ selId: -1 })
    return { DBState: state, selIdState } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertError: h.alertError,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    generateAIImage: h.generate,
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/characters'), () => ({
    createBlankChar: vi.fn(() => ({ name: 'blank' })),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('src/lib/UI/GUI/TextAreaInput.svelte', () => ({ default: () => {} }))

import PlaygroundImageGen from 'src/lib/Playground/PlaygroundImageGen.svelte'

const REFUSALS = [
    'Command plugin:fs|read_file not allowed by ACL',
    'fs.read_file not allowed. Permissions associated with this command: fs:allow-read-file',
]

let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => {
    h.generate.mockReset()
    h.alertError.mockReset()
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundImageGen, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
})

afterEach(async () => {
    await unmount(app as never)
    target.remove()
})

describe('the playground image generator when the access control list refuses a read (G)', () => {
    test.each(REFUSALS)('the refusal is reported through alertError with the exact string, clears the spinner, and shows no image: %s', async (refusal) => {
        h.generate.mockRejectedValue(refusal)

        target.querySelector('button')!.click()
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()

        expect(h.generate).toHaveBeenCalledTimes(1)
        expect(h.alertError).toHaveBeenCalledTimes(1)
        expect(h.alertError).toHaveBeenCalledWith(refusal)
        expect(target.querySelector('.loadmove')).toBeNull()
        expect(target.querySelector('img')).toBeNull()
    })
})
