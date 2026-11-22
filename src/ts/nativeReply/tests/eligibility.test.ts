import { describe, expect, test } from 'vitest'
import { nativeReplyEligible, type NativeReplyFacts } from '../grant'

/**
 * T1 (guard, new rule): a send owns its reply's record only when every predicate holds. Each row flips one fact of an
 * eligible send; the LAN OpenAI-compatible host is not a fact here because the transport, not the host, decides, so it
 * stays eligible. Streaming is no fact either: P2 (reproducer) is that a streamed send stays eligible.
 */

const eligible: NativeReplyFacts = {
    androidTransport: true,
    singleCharacter: true,
    isContinue: false,
    isPreview: false,
    isPromptPreview: false,
}

describe('nativeReplyEligible', () => {
    test('an Android, one-to-one, plain send is eligible', () => {
        expect(nativeReplyEligible(eligible)).toBe(true)
    })

    test('P2: a streamed send is eligible too: the request format decides, in the strip', () => {
        // Built in a variable so the extra fact is not an excess-property error once the field is gone.
        const streamed = { ...eligible, streaming: true }
        expect(nativeReplyEligible(streamed)).toBe(true)
    })

    test.each([
        ['not Android', { androidTransport: false }],
        ['a group chat', { singleCharacter: false }],
        ['a continue', { isContinue: true }],
        ['a preview', { isPreview: true }],
        ['a prompt preview', { isPromptPreview: true }],
    ] as const)('%s is not eligible', (_name, flip) => {
        expect(nativeReplyEligible({ ...eligible, ...flip })).toBe(false)
    })
})
