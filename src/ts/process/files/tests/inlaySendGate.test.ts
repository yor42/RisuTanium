import { describe, expect, test } from 'vitest'
import { INLAY_SEND_LIMIT_BYTES, inlaySendVerdict } from '../inlaySendGate'
import { LLMFlags } from '../../../model/types'
import type { InlaySummary } from '../inlayStore'

const MIB = 1024 * 1024

function summaryOf(type: InlaySummary['type'], size: number | null): InlaySummary {
    return { type, name: 'file', ext: 'bin', size }
}

describe('the limit', () => {
    test('is 20 MiB', () => {
        expect(INLAY_SEND_LIMIT_BYTES).toBe(20 * MIB)
    })
})

describe('inlaySendVerdict of a video', () => {
    test('is read with the video flag and a size within the limit', () => {
        expect(inlaySendVerdict(summaryOf('video', MIB), [LLMFlags.hasVideoInput], false)).toBe('read')
    })

    test('is not sent without the video flag, whatever the size', () => {
        expect(inlaySendVerdict(summaryOf('video', MIB), [], false)).toBe('not-sent')
        expect(inlaySendVerdict(summaryOf('video', 194 * MIB), [], false)).toBe('not-sent')
        expect(inlaySendVerdict(summaryOf('video', MIB), [LLMFlags.hasAudioInput], false)).toBe('not-sent')
    })

    test('is not sent when the message already holds a modal part', () => {
        expect(inlaySendVerdict(summaryOf('video', MIB), [LLMFlags.hasVideoInput], true)).toBe('not-sent')
    })

    test('is read at exactly the limit and too large one byte above it', () => {
        expect(inlaySendVerdict(summaryOf('video', 20 * MIB), [LLMFlags.hasVideoInput], false)).toBe('read')
        expect(inlaySendVerdict(summaryOf('video', 20 * MIB + 1), [LLMFlags.hasVideoInput], false)).toBe('too-large')
    })

    test('is read when its size is unknown', () => {
        expect(inlaySendVerdict(summaryOf('video', null), [LLMFlags.hasVideoInput], false)).toBe('read')
    })
})

describe('inlaySendVerdict of an audio', () => {
    test('needs the audio flag, not the video flag', () => {
        expect(inlaySendVerdict(summaryOf('audio', MIB), [LLMFlags.hasAudioInput], false)).toBe('read')
        expect(inlaySendVerdict(summaryOf('audio', MIB), [LLMFlags.hasVideoInput], false)).toBe('not-sent')
    })

    test('is too large above the limit when the flag is present', () => {
        expect(inlaySendVerdict(summaryOf('audio', 20 * MIB + 1), [LLMFlags.hasAudioInput], false)).toBe('too-large')
    })

    test('is not sent when the message already holds a modal part', () => {
        expect(inlaySendVerdict(summaryOf('audio', MIB), [LLMFlags.hasAudioInput], true)).toBe('not-sent')
    })
})

describe('inlaySendVerdict ordering', () => {
    test('a missing flag wins over the size, so an over-limit file the model cannot take is not reported', () => {
        expect(inlaySendVerdict(summaryOf('video', 30 * MIB), [], false)).toBe('not-sent')
        expect(inlaySendVerdict(summaryOf('audio', 30 * MIB), [LLMFlags.hasVideoInput], false)).toBe('not-sent')
    })

    test('a taken slot wins over the size', () => {
        expect(inlaySendVerdict(summaryOf('video', 30 * MIB), [LLMFlags.hasVideoInput], true)).toBe('not-sent')
    })
})

describe('inlaySendVerdict of an image or a signature', () => {
    test('is read at any size, with or without flags and with a taken slot', () => {
        for (const type of ['image', 'signature'] as const) {
            expect(inlaySendVerdict(summaryOf(type, 30 * MIB), [], false)).toBe('read')
            expect(inlaySendVerdict(summaryOf(type, 30 * MIB), [LLMFlags.hasImageInput], true)).toBe('read')
        }
    })
})
