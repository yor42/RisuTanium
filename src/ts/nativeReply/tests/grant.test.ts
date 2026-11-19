import { beforeEach, describe, expect, test } from 'vitest'
import { bindGrant, issueNativeReplyGrant, takeReplyOwner } from '../grant'
import { heldReply, resetPageStateForTests } from '../pageState'
import type { ReplyBlobBase } from '../blob'
import type { OpenAIParseContext } from '../../process/request/openAI/chatBodyParse'

/**
 * T2 (guard, new rule): the grant is identity-checked and one-shot. A lookalike, a second take and an unbound grant own
 * nothing. Mutant M7 replaces the identity set with a field check.
 */

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' },
    targetName: 'Alice',
    saying: 'cha',
    generationInfo: { generationId: KEY },
    promptInfo: {},
    escape: false,
    requestedMs: 1,
}
const parse: OpenAIParseContext = { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }

beforeEach(() => { resetPageStateForTests() })

describe('grant identity', () => {
    test('a grant binds once into an owner that is taken once', () => {
        const grant = issueNativeReplyGrant(KEY, base)
        expect(heldReply(KEY)).toMatchObject({ state: 'inflight', bound: false, invoked: false })
        const owner = bindGrant(grant, parse)
        expect(owner).not.toBeNull()
        expect(heldReply(KEY)?.bound).toBe(true)
        expect(bindGrant(grant, parse)).toBeNull()

        const taken = takeReplyOwner(owner)
        expect(taken).toMatchObject({ key: KEY, pageVersion: 1 })
        expect(JSON.parse(taken?.blob ?? '')).toMatchObject({ format: 'risu-native-reply-blob', target: { chaId: 'cha', chatId: 'chat' } })
        expect(takeReplyOwner(owner)).toBeNull()
    })

    test('a lookalike of the grant binds nothing and a lookalike of the owner is not taken', () => {
        issueNativeReplyGrant(KEY, base)
        expect(bindGrant({ key: KEY }, parse)).toBeNull()
        expect(bindGrant(undefined, parse)).toBeNull()
        expect(takeReplyOwner({ key: KEY, pageVersion: 1, blob: '{}' })).toBeNull()
        expect(heldReply(KEY)?.bound).toBe(false)
    })

    test('an unbound grant yields no owner to take', () => {
        const grant = issueNativeReplyGrant(KEY, base)
        expect(takeReplyOwner(grant)).toBeNull()
    })
})
