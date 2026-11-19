import { describe, expect, test } from 'vitest'
import { nativeReplyEligible, type NativeReplyFacts } from '../grant'

/**
 * T1 (guard, new rule): a send owns its reply's record only when every predicate holds. Each row flips one fact of an
 * eligible send; the LAN OpenAI-compatible host is not a fact here because the transport, not the host, decides, so it
 * stays eligible. Mutants M1-M6 drop one predicate each.
 */

const eligible: NativeReplyFacts = {
    androidTransport: true,
    streaming: false,
    singleCharacter: true,
    isContinue: false,
    isPreview: false,
    isPromptPreview: false,
}

describe('nativeReplyEligible', () => {
    test('an Android, non-streamed, one-to-one, plain send is eligible', () => {
        expect(nativeReplyEligible(eligible)).toBe(true)
    })

    test.each([
        ['not Android', { androidTransport: false }],
        ['streaming', { streaming: true }],
        ['a group chat', { singleCharacter: false }],
        ['a continue', { isContinue: true }],
        ['a preview', { isPreview: true }],
        ['a prompt preview', { isPromptPreview: true }],
    ] as const)('%s is not eligible', (_name, flip) => {
        expect(nativeReplyEligible({ ...eligible, ...flip })).toBe(false)
    })
})
