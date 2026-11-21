import { describe, expect, test } from 'vitest'
import type { OpenAIChat } from '../../../index.svelte'
import { FIRST_MESSAGE_ID, createSendCapture, firstRecordOf, rawHash, rawHashOf, recordOf, recordTextOf, type CapturedMessage } from '../records'

describe('rawHash', () => {
    test('new rule: equal data hashes equal, a one-character change differs, the length leads', () => {
        expect(rawHash('hello world')).toBe(rawHash('hello world'))
        expect(rawHash('hello world')).not.toBe(rawHash('hello worle'))
        expect(rawHash('hello world').startsWith('11:')).toBe(true)
        expect(rawHash('')).toMatch(/^0:/)
    })
})

describe('rawHashOf', () => {
    test('new rule: reuses the hash for unchanged data and rehashes a replaced text on the same object', () => {
        const msg = { data: 'first text' }
        const h = rawHashOf(msg, msg.data)
        expect(h).toBe(rawHash('first text'))
        expect(rawHashOf(msg, msg.data)).toBe(h)
        msg.data = 'second text'
        expect(rawHashOf(msg, msg.data)).toBe(rawHash('second text'))
    })
})

describe('recordTextOf', () => {
    test('new rule: drops thoughts and asset prompts and keeps everything else', () => {
        expect(recordTextOf('a <Thoughts>secret\nmore</Thoughts>b {{asset_prompt::draw a cat}}c {{AssetPrompt::x}}d')).toBe('a b c d')
        expect(recordTextOf('plain *action* "speech" <b>tag</b>')).toBe('plain *action* "speech" <b>tag</b>')
    })
})

describe('createSendCapture', () => {
    test('new rule: refs hold the very ref object and newest is the last add', () => {
        const capture = createSendCapture()
        const a: OpenAIChat = { role: 'user', content: 'a' }
        const b: OpenAIChat = { role: 'assistant', content: 'b' }
        const ra: CapturedMessage = { msg: { chatId: 'x', role: 'user', data: 'a' }, chatIndex: 0, name: 'Bot', preWrap: 'a', data: 'a' }
        const rb: CapturedMessage = { msg: { chatId: 'y', role: 'char', data: 'b' }, chatIndex: 1, name: 'Bot', preWrap: 'b', data: 'b' }
        expect(capture.newest).toBeNull()
        capture.add(a, ra)
        capture.add(b, rb)
        expect(capture.refs.get(a)).toBe(ra)
        expect(capture.refs.get(b)).toBe(rb)
        expect(capture.newest).toBe(rb)
    })
})

describe('recordOf and firstRecordOf', () => {
    test('new rule: the char name is the captured name and the user name is the given one', () => {
        const user = recordOf({ msg: { chatId: 'u1', role: 'user', data: 'hi' }, chatIndex: 4, name: 'ignored', preWrap: 'hi', data: 'hi' }, 'Alice')
        expect(user).toEqual({ chatId: 'u1', index: 4, role: 'user', name: 'Alice', rawHash: rawHash('hi'), preWrap: 'hi' })
        const bot = recordOf({ msg: { role: 'char', data: 'yo' }, chatIndex: 5, name: 'Bot', preWrap: 'yo', data: 'yo' }, 'Alice')
        expect(bot.name).toBe('Bot')
        expect(bot.chatId).toBe('')
    })

    test('RC1 regression reproducer: the record hashes the text captured at loop time, not a later msg.data', () => {
        const msg = { chatId: 'c1', role: 'user' as const, data: 'captured text' }
        const ref: CapturedMessage = { msg, chatIndex: 0, name: 'Bot', preWrap: 'captured text', data: msg.data }
        msg.data = 'rewritten after capture'
        expect(recordOf(ref, 'Alice').rawHash).toBe(rawHash('captured text'))
    })

    test('new rule: the first message record is #first at index -1 with no name prefix', () => {
        const rec = firstRecordOf({ chat: { role: 'assistant', content: 'Bot: Hello' }, preWrap: 'Hello', raw: 'Hello {{user}}' }, 'Bot')
        expect(rec).toEqual({ chatId: FIRST_MESSAGE_ID, index: -1, role: 'char', name: 'Bot', rawHash: rawHash('Hello {{user}}'), preWrap: 'Hello' })
    })
})
