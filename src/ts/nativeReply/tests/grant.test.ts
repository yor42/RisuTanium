import { beforeEach, describe, expect, test } from 'vitest'
import { bindGrant, issueNativeReplyGrant, takeReplyOwner, takeReplyOwnerWithNotice } from '../grant'
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

describe('the notice token of a grant (guard, new rule)', () => {
    test('a grant with an arm payload binds a positive int token that the take returns with the payload, once', () => {
        const owner = bindGrant(issueNativeReplyGrant(KEY, base, '{"v":1}'), parse)
        const taken = takeReplyOwnerWithNotice(owner)
        expect(taken?.noticeJson).toBe('{"v":1}')
        expect(Number.isInteger(taken?.arg.noticeToken)).toBe(true)
        expect(taken?.arg.noticeToken).toBeGreaterThan(0)
        expect(taken?.arg.noticeToken).toBeLessThanOrEqual(0x7fffffff)
        expect(takeReplyOwnerWithNotice(owner)).toBeNull()
    })

    test('a grant with no payload carries no token key at all: the invoke stays as before', () => {
        const owner = bindGrant(issueNativeReplyGrant(KEY, base), parse)
        const taken = takeReplyOwnerWithNotice(owner)
        expect(taken?.noticeJson).toBeNull()
        expect('noticeToken' in (taken?.arg ?? {})).toBe(false)
        const withNull = bindGrant(issueNativeReplyGrant('11111111-0000-4000-8000-000000000002', base, null), parse)
        expect('noticeToken' in (takeReplyOwner(withNull) ?? {})).toBe(false)
    })

    test('two grants get their own tokens, and the token is not part of the blob', () => {
        const first = takeReplyOwnerWithNotice(bindGrant(issueNativeReplyGrant(KEY, base, '{}'), parse))
        const second = takeReplyOwnerWithNotice(bindGrant(issueNativeReplyGrant('11111111-0000-4000-8000-000000000002', base, '{}'), parse))
        expect(first?.arg.noticeToken).not.toBe(second?.arg.noticeToken)
        expect(first?.arg.blob).not.toContain('noticeToken')
    })
})
