import type { MessageGenerationInfo, MessagePresetInfo } from '../storage/database.svelte'
import type { OpenAIParseContext, OpenAIStreamParseContext } from '../process/request/openAI/chatBodyParse'

/**
 * The page's blob of a native reply record, version 1 (`pageVersion` 1). Rust keeps it opaque in the ticket and hands it
 * back in the listing, so the next launch can place a reply the page that sent the request never saw.
 *
 * The shape of each kind is frozen by its fixture (`tests/fixtures/blob-v1.json`, `blob-openai-chat-stream-v1.json`).
 * - A new parse kind is additive under page version 1: an older page lists it as unreadable, which it keeps and reports
 *   once.
 * - Changing the fields of an existing kind takes `pageVersion` 2 with a migration tested against that kind's fixture.
 * - A kind marker lives only in `parse.kind`, never in a sibling field, because the decoder ignores unknown fields and an
 *   older decoder would read a marked record as the kind it knows.
 * - Version 2 is reserved for a real reshaping.
 *
 * The blob never holds the request's URL, headers, key, body or prompt (`formated`), and it holds no
 * `candidateStartState`: only the first candidate of a reply is recovered.
 */

export const REPLY_BLOB_FORMAT = 'risu-native-reply-blob'
export const REPLY_BLOB_PAGE_VERSION = 1
/** The most the store takes for one blob; a larger one is refused and the request stays page-owned. */
export const REPLY_BLOB_MAX_BYTES = 1024 * 1024

/** What the sending page knows about the reply before the request is built. */
export interface ReplyBlobBase {
    target: { chaId: string, chatId: string }
    /** The character's name as the notes name it. */
    targetName: string
    /** The `chaId` stored as the message's `saying`. */
    saying: string
    generationInfo: MessageGenerationInfo
    promptInfo: MessagePresetInfo
    /** The chat's escape switch: the reply text is escaped before it is stored. */
    escape: boolean
    requestedMs: number
}

/** What a recovered stream reply is counted with: the model it was sent to and the input tokens estimated at send time. */
export interface ReplyUsageContext {
    modelKey: string
    inputEstimate: number
}

export type ReplyBlob =
    | (ReplyBlobBase & { parse: OpenAIParseContext })
    | (ReplyBlobBase & { parse: OpenAIStreamParseContext, usage: ReplyUsageContext })

export type StreamReplyBlob = Extract<ReplyBlob, { parse: OpenAIStreamParseContext }>

export function isStreamReplyBlob(blob: ReplyBlob): blob is StreamReplyBlob {
    return blob.parse.kind === 'openai-chat-stream'
}

/** The blob text for `base` and the parse context the request was built with; the key order is part of the frozen shape. */
export function encodeReplyBlob(base: ReplyBlobBase, parse: OpenAIParseContext): string {
    return JSON.stringify({
        format: REPLY_BLOB_FORMAT,
        target: { chaId: base.target.chaId, chatId: base.target.chatId },
        targetName: base.targetName,
        saying: base.saying,
        generationInfo: base.generationInfo,
        promptInfo: base.promptInfo,
        parse: {
            kind: parse.kind,
            deepSeekThinkingOutput: parse.deepSeekThinkingOutput,
            extractJson: parse.extractJson,
            jsonSchema: parse.jsonSchema,
            multiGen: parse.multiGen,
        },
        escape: base.escape,
        requestedMs: base.requestedMs,
    })
}

function isValidUsageContext(usage: ReplyUsageContext): boolean {
    return typeof usage.modelKey === 'string'
        && typeof usage.inputEstimate === 'number'
        && Number.isFinite(usage.inputEstimate)
        && usage.inputEstimate >= 0
}

/**
 * The blob text of a stream reply. It throws for a usage context the decoder would refuse, so the caller never stores a
 * record it cannot read back; the key order is part of the frozen shape.
 */
export function encodeStreamReplyBlob(base: ReplyBlobBase, parse: OpenAIStreamParseContext, usage: ReplyUsageContext): string {
    if (!isValidUsageContext(usage)) {
        throw new Error('the stream reply usage context is not a model key and a finite non-negative input estimate')
    }
    return JSON.stringify({
        format: REPLY_BLOB_FORMAT,
        target: { chaId: base.target.chaId, chatId: base.target.chatId },
        targetName: base.targetName,
        saying: base.saying,
        generationInfo: base.generationInfo,
        promptInfo: base.promptInfo,
        parse: {
            kind: parse.kind,
            deepSeekThinkingOutput: parse.deepSeekThinkingOutput,
            extractJson: parse.extractJson,
            jsonSchema: parse.jsonSchema,
            multiGen: parse.multiGen,
        },
        usage: { modelKey: usage.modelKey, inputEstimate: usage.inputEstimate },
        escape: base.escape,
        requestedMs: base.requestedMs,
    })
}

export type DecodedReplyBlob =
    | { ok: true, blob: ReplyBlob }
    | { ok: false, problem: string }

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads a blob back. Unknown extra fields are ignored; a page version other than 1, or a known field that is missing or
 * of the wrong type, makes the record unreadable, which the caller keeps and reports and never deletes.
 */
export function decodeReplyBlob(text: string | undefined, pageVersion: number | undefined): DecodedReplyBlob {
    if (pageVersion !== REPLY_BLOB_PAGE_VERSION) {
        return { ok: false, problem: `page version ${String(pageVersion)} is not known` }
    }
    if (typeof text !== 'string') {
        return { ok: false, problem: 'the blob is missing' }
    }
    let raw: unknown
    try {
        raw = JSON.parse(text)
    } catch {
        return { ok: false, problem: 'the blob is not JSON' }
    }
    if (!isRecord(raw) || raw.format !== REPLY_BLOB_FORMAT) {
        return { ok: false, problem: 'the blob has another format' }
    }
    const target = raw.target
    if (!isRecord(target) || typeof target.chaId !== 'string' || typeof target.chatId !== 'string') {
        return { ok: false, problem: 'the blob names no target' }
    }
    if (typeof raw.targetName !== 'string' || typeof raw.saying !== 'string') {
        return { ok: false, problem: 'the blob names no character' }
    }
    if (!isRecord(raw.generationInfo) || !isRecord(raw.promptInfo)) {
        return { ok: false, problem: 'the blob holds no generation info' }
    }
    const parse = raw.parse
    if (!isRecord(parse)
        || (parse.kind !== 'openai-chat' && parse.kind !== 'openai-chat-stream')
        || typeof parse.deepSeekThinkingOutput !== 'boolean'
        || typeof parse.jsonSchema !== 'boolean'
        || typeof parse.multiGen !== 'boolean') {
        return { ok: false, problem: 'the blob holds no known parse rule' }
    }
    const rawExtract = parse.extractJson
    let extractJson: string | null
    if (rawExtract === null) {
        extractJson = null
    } else if (typeof rawExtract === 'string') {
        extractJson = rawExtract
    } else {
        return { ok: false, problem: 'the blob holds no known parse rule' }
    }
    if (typeof raw.escape !== 'boolean' || typeof raw.requestedMs !== 'number' || !Number.isFinite(raw.requestedMs)) {
        return { ok: false, problem: 'the blob holds no request facts' }
    }
    const base: ReplyBlobBase = {
        target: { chaId: target.chaId, chatId: target.chatId },
        targetName: raw.targetName,
        saying: raw.saying,
        // The object shape is checked; its own fields are the page's and an unknown one is carried as it is.
        generationInfo: raw.generationInfo as MessageGenerationInfo,
        promptInfo: raw.promptInfo as MessagePresetInfo,
        escape: raw.escape,
        requestedMs: raw.requestedMs,
    }
    if (parse.kind === 'openai-chat-stream') {
        const usage = raw.usage
        if (!isRecord(usage)
            || typeof usage.modelKey !== 'string'
            || typeof usage.inputEstimate !== 'number'
            || !Number.isFinite(usage.inputEstimate)
            || usage.inputEstimate < 0) {
            return { ok: false, problem: 'the blob holds no usage context' }
        }
        return {
            ok: true,
            blob: {
                ...base,
                parse: {
                    kind: 'openai-chat-stream',
                    deepSeekThinkingOutput: parse.deepSeekThinkingOutput,
                    extractJson,
                    jsonSchema: parse.jsonSchema,
                    multiGen: parse.multiGen,
                },
                usage: { modelKey: usage.modelKey, inputEstimate: usage.inputEstimate },
            },
        }
    }
    return {
        ok: true,
        blob: {
            ...base,
            parse: {
                kind: 'openai-chat',
                deepSeekThinkingOutput: parse.deepSeekThinkingOutput,
                extractJson,
                jsonSchema: parse.jsonSchema,
                multiGen: parse.multiGen,
            },
        },
    }
}
