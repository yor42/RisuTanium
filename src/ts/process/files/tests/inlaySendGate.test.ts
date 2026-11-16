import { describe, expect, test } from 'vitest'
import { ANDROID_BLOB_VIDEO_DISPLAY_LIMIT_BYTES, ANDROID_STRING_MEDIA_DISPLAY_LIMIT_BYTES, INLAY_SEND_LIMIT_BYTES, blobVideoWholeReadWithheld, inlayImageWithheld, inlayReadVerdict, inlaySendVerdict, withheldStringMediaKind } from '../inlaySendGate'
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES } from '../../../storage/assetUrlGate'
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

describe('inlayImageWithheld', () => {
    const LIMIT = 64 * MIB

    test('is true for an image above 64 MiB on Android', () => {
        expect(inlayImageWithheld('image', LIMIT + 1, true)).toBe(true)
    })

    test('is false off Android, whatever the size', () => {
        expect(inlayImageWithheld('image', LIMIT + 1, false)).toBe(false)
    })

    test('is false at exactly 64 MiB', () => {
        expect(inlayImageWithheld('image', LIMIT, true)).toBe(false)
    })

    test('is false when the size is unknown', () => {
        expect(inlayImageWithheld('image', null, true)).toBe(false)
    })

    test('is false for a video, an audio or a signature, however large', () => {
        for (const type of ['video', 'audio', 'signature'] as const) {
            expect(inlayImageWithheld(type, LIMIT + 1, true)).toBe(false)
        }
    })
})

describe('inlayReadVerdict', () => {
    test('a video or audio is read at exactly the limit and too large one byte above it', () => {
        for (const type of ['video', 'audio'] as const) {
            expect(inlayReadVerdict(summaryOf(type, 20 * MIB))).toBe('read')
            expect(inlayReadVerdict(summaryOf(type, 20 * MIB + 1))).toBe('too-large')
        }
    })

    test('a video or audio of unknown size is read', () => {
        expect(inlayReadVerdict(summaryOf('video', null))).toBe('read')
        expect(inlayReadVerdict(summaryOf('audio', null))).toBe('read')
    })

    test('an image or a signature is read at any size', () => {
        for (const type of ['image', 'signature'] as const) {
            expect(inlayReadVerdict(summaryOf(type, 30 * MIB))).toBe('read')
        }
    })
})

describe('the string media display limit', () => {
    test('is 64 MiB, the limit of an image', () => {
        expect(ANDROID_STRING_MEDIA_DISPLAY_LIMIT_BYTES).toBe(64 * MIB)
    })
})

describe('withheldStringMediaKind', () => {
    const LIMIT = ANDROID_STRING_MEDIA_DISPLAY_LIMIT_BYTES

    test('names the kind of an audio or video above the limit on Android', () => {
        expect(withheldStringMediaKind('audio', LIMIT + 1, true)).toBe('audio')
        expect(withheldStringMediaKind('video', LIMIT + 1, true)).toBe('video')
    })

    test('withholds nothing at exactly the limit, off Android, or of an unknown size', () => {
        for (const type of ['audio', 'video'] as const) {
            expect(withheldStringMediaKind(type, LIMIT, true)).toBeNull()
            expect(withheldStringMediaKind(type, LIMIT + 1, false)).toBeNull()
            expect(withheldStringMediaKind(type, null, true)).toBeNull()
        }
    })

    test('leaves an image and a signature to their own rules, and an unknown type alone', () => {
        expect(withheldStringMediaKind('image', LIMIT + 1, true)).toBeNull()
        expect(withheldStringMediaKind('signature', LIMIT + 1, true)).toBeNull()
        expect(withheldStringMediaKind(undefined, LIMIT + 1, true)).toBeNull()
    })
})

describe('blobVideoWholeReadWithheld', () => {
    const LIMIT = ANDROID_BLOB_VIDEO_DISPLAY_LIMIT_BYTES

    test('the limit is the whole-read limit, 64 MiB', () => {
        expect(LIMIT).toBe(ANDROID_WHOLE_READ_URL_LIMIT_BYTES)
        expect(LIMIT).toBe(64 * MIB)
    })

    test('is true for a video above the limit on Android', () => {
        expect(blobVideoWholeReadWithheld('video', LIMIT + 1, true)).toBe(true)
    })

    test('is false at exactly the limit, of an unknown size, or off Android', () => {
        expect(blobVideoWholeReadWithheld('video', LIMIT, true)).toBe(false)
        expect(blobVideoWholeReadWithheld('video', null, true)).toBe(false)
        expect(blobVideoWholeReadWithheld('video', LIMIT + 1, false)).toBe(false)
    })

    test('is false for an audio, an image, a signature or an unknown type, however large', () => {
        for (const type of ['audio', 'image', 'signature', undefined] as const) {
            expect(blobVideoWholeReadWithheld(type, LIMIT + 1, true)).toBe(false)
        }
    })
})
