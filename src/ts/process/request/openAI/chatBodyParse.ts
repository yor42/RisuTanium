import { LLMFlags } from 'src/ts/model/modellist'
import type { RunSubject } from '../../chatOrigin'
import { extractJSON } from '../../templates/jsonSchema'

/**
 * What a non-streamed OpenAI-compatible chat body is read with. It is the whole input of the read besides the body
 * itself, so a record written by an earlier page can be read the way the live request would have read it.
 */
export interface OpenAIParseContext {
    kind: 'openai-chat'
    /** The model's `deepSeekThinkingOutput` flag: a `</think>` split of the content becomes a thoughts block. */
    deepSeekThinkingOutput: boolean
    /** The JSON path the reply text is extracted with; null when none is set. */
    extractJson: string | null
    /** The database's JSON schema switch or the request's own schema: extraction applies only when it is set. */
    jsonSchema: boolean
    /** More than one candidate was requested: every choice is read. */
    multiGen: boolean
}

/** The fields of the parse context a stream is read with; the stream transform reads nothing else of the request. */
export type OpenAIChatReadRule = Pick<OpenAIParseContext, 'deepSeekThinkingOutput' | 'extractJson' | 'jsonSchema' | 'multiGen'>

/** The parse context of a recorded OpenAI-compatible chat stream: the same rule under its own kind. */
export type OpenAIStreamParseContext = OpenAIChatReadRule & { kind: 'openai-chat-stream' }

interface OpenAIChoice {
    text?: string
    reasoning_content?: string
    message?: {
        content?: string | null
        reasoning_content?: string
        reasoning?: string
    }
}

/** The part of a chat completion body the read looks at. */
export interface OpenAIChatBody {
    choices: OpenAIChoice[]
}

export type ParsedOpenAIChatBody =
    | { type: 'success', result: string }
    | { type: 'multiline', result: ['char', string][] }

/** The context a request reads its reply with, taken from the request argument and the database. */
export function openAIParseContextOf(
    arg: { extractJson?: string, schema?: string, multiGen?: boolean, modelInfo?: { flags: LLMFlags[] } },
    db: { jsonSchemaEnabled?: boolean },
): OpenAIParseContext {
    return {
        kind: 'openai-chat',
        deepSeekThinkingOutput: arg.modelInfo?.flags.includes(LLMFlags.deepSeekThinkingOutput) === true,
        extractJson: arg.extractJson ? arg.extractJson : null,
        jsonSchema: Boolean(db.jsonSchemaEnabled || arg.schema),
        multiGen: arg.multiGen === true,
    }
}

/** True for a value that can be read as a chat body at all: a JSON object. A body without choices still throws in the read. */
export function isOpenAIChatBody(value: unknown): value is OpenAIChatBody {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The reply text of the first choice. It throws where the live request throws (a body with no choice), and the caller
 * decides what that means.
 */
export function processOpenAIChatText(dat: OpenAIChatBody, ctx: OpenAIParseContext, subject?: RunSubject): string {
    const extracting = ctx.extractJson !== null && ctx.jsonSchema
    if (dat?.choices[0]?.text) {
        const text = dat.choices[0].text
        if (extracting) {
            try {
                const parsed = JSON.parse(text)
                const extracted = extractJSON(parsed, ctx.extractJson as string, { subject })
                return extracted
            } catch (error) {
                console.log(error)
                return text
            }
        }
        return text
    }
    if (extracting) {
        return extractJSON(dat.choices[0].message.content, ctx.extractJson as string, { subject })
    }
    const msg = dat.choices[0].message
    let result = msg.content ?? ''
    const reasoningContentField = dat?.choices[0]?.reasoning_content ?? dat?.choices[0]?.message?.reasoning_content
    if (ctx.deepSeekThinkingOutput && !reasoningContentField) {
        let reasoningContent = ''
        result = result.replace(/(.*)\<\/think\>/gms, (m, p1) => {
            reasoningContent = p1
            return ''
        })
        if (reasoningContent) {
            reasoningContent = reasoningContent.replace(/\<think\>/gms, '')
            result = `<Thoughts>\n${reasoningContent}\n</Thoughts>\n${result}`
        }
    }
    if (reasoningContentField && !result.startsWith('<Thoughts>')) {
        result = `<Thoughts>\n${reasoningContentField}\n</Thoughts>\n${result}`
    }
    // For openrouter, https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request#response.body.choices.message.reasoning
    if (dat?.choices?.[0]?.message?.reasoning) {
        result = `<Thoughts>\n${dat.choices[0].message.reasoning}\n</Thoughts>\n${result}`
    }

    return result
}

/**
 * The reply of a chat body that carries no tool call: every choice when several candidates were requested, else the
 * first choice's text. The one reader of the live request and of a recovered record.
 */
export function parseOpenAIChatBody(dat: OpenAIChatBody, ctx: OpenAIParseContext, subject?: RunSubject): ParsedOpenAIChatBody {
    if (ctx.multiGen && dat.choices) {
        if (ctx.extractJson !== null && ctx.jsonSchema) {
            return {
                type: 'multiline',
                result: dat.choices.map((v): ['char', string] => {
                    const extracted = extractJSON(v.message.content ?? '', ctx.extractJson as string, { subject })
                    return ['char', extracted]
                }),
            }
        }
        return {
            type: 'multiline',
            result: dat.choices.map((v): ['char', string] => ['char', v.message.content ?? '']),
        }
    }
    return {
        type: 'success',
        result: processOpenAIChatText(dat, ctx, subject) ?? '',
    }
}
