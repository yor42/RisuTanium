// @vitest-environment happy-dom

/**
 * (G) A caller that has no handler of its own for a refused image read: the playground image generator.
 *
 * Mounts the REAL `PlaygroundImageGen.svelte` with `generateAIImage` rejecting with each access control list string and
 * presses the button. The press handler does not catch, so the rejection escapes to the process unhandled-rejection
 * path (the page's `unhandledrejection` event, which bootstrap routes to the error alert), and no image is shown.
 * The runner's own rejection listeners are set aside for the case and restored, so the deliberate rejection is neither
 * reported as a test error nor lost.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    generate: vi.fn(async (): Promise<string | null> => null),
}))

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
let runnerListeners: Array<(...args: unknown[]) => void> = []
const escaped: unknown[] = []

function onUnhandled(reason: unknown): void {
    escaped.push(reason)
}

beforeEach(() => {
    h.generate.mockReset()
    escaped.length = 0
    runnerListeners = process.listeners('unhandledRejection') as Array<(...args: unknown[]) => void>
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', onUnhandled)
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(PlaygroundImageGen, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
})

afterEach(async () => {
    await unmount(app as never)
    target.remove()
    process.off('unhandledRejection', onUnhandled)
    for (const listener of runnerListeners) {
        process.on('unhandledRejection', listener)
    }
})

describe('the playground image generator when the access control list refuses a read (G)', () => {
    test.each(REFUSALS)('the rejection escapes unhandled with the exact string and no image is shown: %s', async (refusal) => {
        h.generate.mockRejectedValue(refusal)

        target.querySelector('button')!.click()
        flushSync()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()

        expect(h.generate).toHaveBeenCalledTimes(1)
        expect(escaped).toEqual([refusal])
        expect(target.querySelector('img')).toBeNull()
    })
})
