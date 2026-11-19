import { describe, expect, test } from 'vitest'
import { language } from '../../../lang'
import type { ReplyNoticeState } from '../../android/replyNotifications.svelte'
import { buildNativeNoticeArm, failedNoticeOf, newNoticeToken } from '../notice'

/**
 * T6 (guard, new rule): the arm payload carries the page's own done notice unchanged, a failed notice titled with the
 * character and worded `keepAliveFailed` that never sounds (D13, D14), and the closing strings of the keep-alive card.
 * T7 (guard): the token is random, positive and 31 bits. Mutants M29 (failed built from other text or a sounding flag),
 * M30 (a counter token).
 */

const done: ReplyNoticeState = {
    v: 2,
    key: 'cha/chat',
    name: 'Alice',
    text: 'Replied',
    publicTitle: 'New reply',
    chaId: 'cha',
    chatId: 'chat',
    avatar: 'data:image/webp;base64,AAAA',
    silent: false,
}

describe('the arm payload', () => {
    test('the done notice is the page notice unchanged and the failed notice names the character with the failed text, silent', () => {
        const arm = JSON.parse(buildNativeNoticeArm(done)) as { v: number, done: ReplyNoticeState, failed: ReplyNoticeState }
        expect(arm.v).toBe(1)
        expect(arm.done).toEqual(done)
        expect(arm.failed).toEqual({
            ...done,
            text: language.keepAliveFailed,
            publicTitle: language.keepAliveFailed,
            silent: true,
        })
        expect(arm.failed.name).toBe('Alice')
        expect(arm.failed.text).toBe('Reply failed')
        expect(arm.failed.key).toBe(arm.done.key)
    })

    test('the closing carries the chat target and the three keep-alive strings', () => {
        const arm = JSON.parse(buildNativeNoticeArm(done)) as { closing: Record<string, string> }
        expect(arm.closing).toEqual({
            chaId: 'cha',
            chatId: 'chat',
            finishingTitle: language.keepAliveFinishing,
            failedTitle: language.keepAliveFailed,
            failedText: language.keepAliveFailedHint,
        })
    })

    test('a failed notice never sounds, whatever the done notice said', () => {
        expect(failedNoticeOf({ ...done, silent: false }).silent).toBe(true)
        expect(failedNoticeOf({ ...done, silent: true }).silent).toBe(true)
    })
})

describe('the notice token', () => {
    test('it is the random word masked to 31 bits, and never zero', () => {
        expect(newNoticeToken(() => new Uint32Array([0x12345678]))).toBe(0x12345678)
        expect(newNoticeToken(() => new Uint32Array([0xffffffff]))).toBe(0x7fffffff)
        expect(newNoticeToken(() => new Uint32Array([0x80000000]))).toBe(1)
        expect(newNoticeToken(() => new Uint32Array([0]))).toBe(1)
    })

    test('two real tokens are positive ints and differ', () => {
        const tokens = new Set<number>()
        for (let i = 0; i < 20; i++) {
            const token = newNoticeToken()
            expect(Number.isInteger(token)).toBe(true)
            expect(token).toBeGreaterThan(0)
            expect(token).toBeLessThanOrEqual(0x7fffffff)
            tokens.add(token)
        }
        expect(tokens.size).toBeGreaterThan(1)
    })
})
