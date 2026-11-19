import { describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/model/modellist', () => ({ LLMFlags: { deepSeekThinkingOutput: 7 } }))
vi.mock('../../templates/jsonSchema', () => ({
    extractJSON: (data: unknown, format: string) => `${format}:${typeof data === 'string' ? data : JSON.stringify(data)}`,
}))

import { openAIParseContextOf, parseOpenAIChatBody, processOpenAIChatText, type OpenAIParseContext } from './chatBodyParse'

/**
 * T7 (compat): the extracted reader gives what `requestHTTPOpenAI` gave inline: content, reasoning fields, the
 * deepseek `</think>` split, OpenRouter reasoning, JSON extraction with a schema, several candidates, empty content.
 * Every row passes before and after the extraction.
 */

const plain: OpenAIParseContext = { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false }
const body = (message: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ choices: [{ message, ...extra }] })

describe('parseOpenAIChatBody', () => {
    test('content', () => {
        expect(parseOpenAIChatBody(body({ content: 'hi' }), plain)).toEqual({ type: 'success', result: 'hi' })
    })

    test('reasoning_content on the message and on the choice', () => {
        expect(processOpenAIChatText(body({ content: 'hi', reasoning_content: 'why' }), plain)).toBe('<Thoughts>\nwhy\n</Thoughts>\nhi')
        expect(processOpenAIChatText(body({ content: 'hi' }, { reasoning_content: 'why' }), plain)).toBe('<Thoughts>\nwhy\n</Thoughts>\nhi')
    })

    test('deepseek </think> split turns the head into a thoughts block', () => {
        const ctx = { ...plain, deepSeekThinkingOutput: true }
        expect(processOpenAIChatText(body({ content: '<think>plan</think>answer' }), ctx)).toBe('<Thoughts>\nplan\n</Thoughts>\nanswer')
        expect(processOpenAIChatText(body({ content: 'answer' }), ctx)).toBe('answer')
    })

    test('openrouter reasoning', () => {
        expect(processOpenAIChatText(body({ content: 'hi', reasoning: 'r' }), plain)).toBe('<Thoughts>\nr\n</Thoughts>\nhi')
    })

    test('extractJson applies only with the schema switch', () => {
        const ctx = { ...plain, extractJson: '$.a', jsonSchema: true }
        expect(processOpenAIChatText(body({ content: '{"a":1}' }), ctx)).toBe('$.a:{"a":1}')
        expect(processOpenAIChatText(body({ content: '{"a":1}' }), { ...ctx, jsonSchema: false })).toBe('{"a":1}')
    })

    test('the legacy text field wins and is extracted when asked', () => {
        const dat = { choices: [{ text: '{"a":1}' }] }
        expect(processOpenAIChatText(dat, plain)).toBe('{"a":1}')
        expect(processOpenAIChatText(dat, { ...plain, extractJson: '$.a', jsonSchema: true })).toBe('$.a:{"a":1}')
    })

    test('several candidates give one entry each, extracted when asked', () => {
        const dat = { choices: [{ message: { content: 'one' } }, { message: { content: 'two' } }] }
        const ctx = { ...plain, multiGen: true }
        expect(parseOpenAIChatBody(dat, ctx)).toEqual({ type: 'multiline', result: [['char', 'one'], ['char', 'two']] })
        expect(parseOpenAIChatBody(dat, { ...ctx, extractJson: '$.x', jsonSchema: true })).toEqual({ type: 'multiline', result: [['char', '$.x:one'], ['char', '$.x:two']] })
    })

    test('empty content is an empty reply, and a body with no choice throws as the live read does', () => {
        expect(parseOpenAIChatBody(body({ content: null }), plain)).toEqual({ type: 'success', result: '' })
        expect(() => parseOpenAIChatBody({} as never, plain)).toThrow()
    })
})

describe('openAIParseContextOf', () => {
    test('reads the request argument and the database switches', () => {
        const flags = [7]
        expect(openAIParseContextOf({ extractJson: '$.a', schema: 's', multiGen: true, modelInfo: { flags: flags as never } }, { jsonSchemaEnabled: false }))
            .toEqual({ kind: 'openai-chat', deepSeekThinkingOutput: true, extractJson: '$.a', jsonSchema: true, multiGen: true })
        expect(openAIParseContextOf({}, { jsonSchemaEnabled: true }))
            .toEqual({ kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: true, multiGen: false })
    })
})
