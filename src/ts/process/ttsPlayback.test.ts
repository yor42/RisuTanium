/**
 * The playback registry of `./ttsPlayback`.
 *
 * Invariants pinned here:
 *  - cancelling aborts the current era's signal and starts a fresh signal;
 *  - a clip that was cancelled before its audio was decoded never starts;
 *  - cancelling stops every started clip and closes every context exactly
 *    once, and releasing a clip twice closes its context once;
 *  - closing an already-closed context never leaves a rejection behind.
 *
 * `AudioContext` is a fake; nothing here touches an audio device.
 */

import { afterEach, describe, expect, test, vi } from 'vitest'
import { beginClip, cancelTTSPlayback, currentTTSSignal, playEncodedAudio, releaseClip, startClip } from './ttsPlayback'

function fakeContext(closeBehaviour: () => Promise<void> = async () => {}) {
    const node = { buffer: null as unknown, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
    const gain = { gain: { value: 1 }, connect: vi.fn() }
    return {
        node,
        gain,
        destination: {},
        close: vi.fn(closeBehaviour),
        createBufferSource: () => node,
        createGain: () => gain,
        decodeAudioData: vi.fn(async () => ({ duration: 1 })),
    }
}

type FakeContext = ReturnType<typeof fakeContext>

function asContext(context: FakeContext): AudioContext {
    return context as unknown as AudioContext
}

const BUFFER = {} as AudioBuffer

afterEach(() => {
    cancelTTSPlayback()
    vi.unstubAllGlobals()
})

describe('the playback era', () => {
    test('new behaviour: cancelling aborts the current signal and hands out a fresh one', () => {
        const before = currentTTSSignal()

        cancelTTSPlayback()

        expect(before.aborted).toBe(true)
        expect(currentTTSSignal().aborted).toBe(false)
        expect(currentTTSSignal()).not.toBe(before)
    })

    test('new behaviour: cancelling twice leaves a signal that is not aborted', () => {
        cancelTTSPlayback()
        cancelTTSPlayback()

        expect(currentTTSSignal().aborted).toBe(false)
    })
})

describe('a clip', () => {
    test('new behaviour: a clip started in a live era connects, starts and closes its context when it ends', () => {
        const context = fakeContext()
        const clip = beginClip(asContext(context))

        expect(startClip(clip, BUFFER, currentTTSSignal())).toBe(true)
        expect(context.node.start).toHaveBeenCalledTimes(1)
        expect(context.node.connect).toHaveBeenCalledWith(context.destination)
        context.node.onended?.()

        expect(context.close).toHaveBeenCalledTimes(1)
    })

    test('new behaviour: a gain puts a gain node between the source and the destination', () => {
        const context = fakeContext()
        const clip = beginClip(asContext(context))

        startClip(clip, BUFFER, currentTTSSignal(), 0.5)

        expect(context.gain.gain.value).toBe(0.5)
        expect(context.node.connect).toHaveBeenCalledWith(context.gain)
        expect(context.gain.connect).toHaveBeenCalledWith(context.destination)
    })

    test('new behaviour: a clip begun before a cancel never starts and its context is closed', () => {
        const context = fakeContext()
        const signal = currentTTSSignal()
        const clip = beginClip(asContext(context))

        cancelTTSPlayback()

        expect(startClip(clip, BUFFER, signal)).toBe(false)
        expect(context.node.start).not.toHaveBeenCalled()
        expect(context.close).toHaveBeenCalledTimes(1)
    })

    test('new behaviour: cancelling stops a started clip and closes its context once', () => {
        const context = fakeContext()
        const clip = beginClip(asContext(context))
        startClip(clip, BUFFER, currentTTSSignal())

        cancelTTSPlayback()
        context.node.onended?.()

        expect(context.node.stop).toHaveBeenCalledTimes(1)
        expect(context.close).toHaveBeenCalledTimes(1)
    })

    test('new behaviour: releasing a clip twice closes its context once', () => {
        const context = fakeContext()
        const clip = beginClip(asContext(context))

        releaseClip(clip)
        releaseClip(clip)

        expect(context.close).toHaveBeenCalledTimes(1)
    })

    test('new behaviour: closing a context that rejects or throws leaves no unhandled rejection and no throw', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)
        try {
            const rejecting = fakeContext(async () => { throw new DOMException('closed', 'InvalidStateError') })
            const throwing = fakeContext(() => { throw new Error('boom') })

            expect(() => releaseClip(beginClip(asContext(rejecting)))).not.toThrow()
            expect(() => releaseClip(beginClip(asContext(throwing)))).not.toThrow()
            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(unhandled).toEqual([])
        } finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    test('new behaviour: a node that cannot be stopped does not stop the cancel from closing the other contexts', () => {
        const first = fakeContext()
        first.node.stop.mockImplementation(() => { throw new Error('not started') })
        const second = fakeContext()
        startClip(beginClip(asContext(first)), BUFFER, currentTTSSignal())
        startClip(beginClip(asContext(second)), BUFFER, currentTTSSignal())

        expect(() => cancelTTSPlayback()).not.toThrow()

        expect(first.close).toHaveBeenCalledTimes(1)
        expect(second.close).toHaveBeenCalledTimes(1)
    })
})

describe('playEncodedAudio', () => {
    test('new behaviour: a signal that is already aborted creates no context', async () => {
        const constructed = vi.fn()
        vi.stubGlobal('AudioContext', class { constructor() { constructed() } })
        const aborted = new AbortController()
        aborted.abort()

        await playEncodedAudio(new ArrayBuffer(4), aborted.signal)

        expect(constructed).not.toHaveBeenCalled()
    })

    test('new behaviour: a decode failure closes the context and rethrows', async () => {
        const context = fakeContext()
        context.decodeAudioData.mockRejectedValue(new Error('bad audio'))
        vi.stubGlobal('AudioContext', class { constructor() { return context } })

        await expect(playEncodedAudio(new ArrayBuffer(4), currentTTSSignal())).rejects.toThrow('bad audio')

        expect(context.close).toHaveBeenCalledTimes(1)
        expect(context.node.start).not.toHaveBeenCalled()
    })
})
