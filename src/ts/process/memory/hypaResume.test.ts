/**
 * findResumeIndex / isSkipEligibleChat: the pure resume-point rule shared by the
 * hypa summarisers. No mocks.
 */
import { describe, expect, it } from 'vitest'
import type { OpenAIChat } from '../index.svelte'
import { findResumeIndex, isSkipEligibleChat } from './hypaResume'

const msg = (memo: string): OpenAIChat => ({ role: 'user', content: memo, memo })
const greeting: OpenAIChat = { role: 'assistant', content: 'greeting' }
const exampleUser: OpenAIChat = { role: 'user', content: 'ex', name: 'example_user' }
const exampleAssistant: OpenAIChat = { role: 'assistant', content: 'ex', name: 'example_assistant' }
const newChat: OpenAIChat = { role: 'system', content: '[Start a new chat]', memo: 'NewChat' }

describe('isSkipEligibleChat', () => {
    it.each([
        ['example_user name', exampleUser, true],
        ['example_assistant name', exampleAssistant, true],
        ['NewChatExample memo', { role: 'system', content: 'x', memo: 'NewChatExample' }, true],
        ['NewChat memo', newChat, true],
        ['blank content', { role: 'assistant', content: ' \n' }, true],
        ['greeting', greeting, false],
        ['ordinary message', msg('m0'), false],
    ] as [string, OpenAIChat, boolean][])('%s', (_label, chat, expected) => {
        expect(isSkipEligibleChat(chat)).toBe(expected)
    })
})

describe('findResumeIndex', () => {
    const chats = [msg('m0'), msg('m1'), msg('m2'), msg('m3')]

    it('is -1 when no summary has a memo in the chat list', () => {
        expect(findResumeIndex(chats, [])).toBe(-1)
        expect(findResumeIndex(chats, [[]])).toBe(-1)
        expect(findResumeIndex(chats, [['gone', 'missing']])).toBe(-1)
    })

    it('is the maximum position over every memo of every set', () => {
        expect(findResumeIndex(chats, [['m0', 'm3'], ['m1']])).toBe(3)
        expect(findResumeIndex(chats, [['m2'], ['m0', 'm1']])).toBe(2)
    })

    it('does not depend on the iteration order of a set', () => {
        expect(findResumeIndex(chats, [new Set(['m2', 'm1', 'm0'])])).toBe(2)
        expect(findResumeIndex(chats, [new Set(['m0', 'm1', 'm2'])])).toBe(2)
    })

    it('ignores memos that are absent from the chat list', () => {
        expect(findResumeIndex(chats, [['gone', 'm1']])).toBe(1)
    })

    it('keeps undefined when the first memo-less chat is the greeting', () => {
        expect(findResumeIndex([newChat, greeting, msg('m0')], [[undefined]])).toBe(1)
    })

    it.each([
        ['an example turn', [exampleUser, exampleAssistant, newChat, greeting, msg('m0')]],
        ['a blank chat', [{ role: 'assistant', content: '' } as OpenAIChat, greeting, msg('m0')]],
    ])('drops undefined when the first memo-less chat is %s', (_label, list) => {
        expect(findResumeIndex(list, [[undefined]])).toBe(-1)
    })

    it('keeps undefined when only memo-bearing marker chats precede the greeting', () => {
        const marker: OpenAIChat = { role: 'system', content: 'x', memo: 'NewChatExample' }
        expect(findResumeIndex([marker, newChat, greeting], [[undefined]])).toBe(2)
    })

    it('counts a defined memo while undefined is dropped for an example turn', () => {
        expect(findResumeIndex([exampleUser, greeting, msg('m0')], [[undefined, 'm0']])).toBe(2)
    })

    it('lets a defined memo past the greeting dominate undefined', () => {
        expect(findResumeIndex([newChat, greeting, msg('m0'), msg('m1')], [[undefined, 'm1']])).toBe(3)
    })

    it('lets undefined win only while nothing defined lies further on', () => {
        expect(findResumeIndex([newChat, greeting, msg('m0')], [[undefined], ['gone']])).toBe(1)
    })
})
