import { v4 } from 'uuid'
import type { LLMFormat } from '../../model/types'
import { parseGoogleUsage } from '../../usage/usageParse'
import type { TokenUsage } from '../../usage/usageTypes'
import type { RunSubject } from '../chatOrigin'
import type { InlaySignature } from '../files/inlays'
import { extractJSON } from '../templates/jsonSchema'
import type { StreamResponseChunk } from './request'

/**
 * What a Gemini stream is read with besides its bytes: the JSON extraction and the thought display the request was built
 * with, and the rule for signature tokens. The read touches nothing else of the request.
 */
export interface GeminiReadRule {
    /** The JSON path the reply text is extracted with; null when none is set. */
    extractJson: string | null
    /** The database's JSON schema switch or the request's own schema: extraction applies only when it is set. */
    jsonSchema: boolean
    /** Whether the thoughts stream into the text as they arrive. */
    streamThoughts: boolean
    /** Whether a thought signature becomes an inlay token in the text. */
    saveSignatures: boolean
    /** The model the signatures are saved for. */
    signatureSource: string
    /** The wire format the signatures are saved for. */
    signatureFormat: LLMFormat
}

/** The parse context of a recorded Gemini stream: the same rule under its own kind. */
export type GeminiStreamParseContext = GeminiReadRule & { kind: 'gemini-stream' }

/** The part of the rule the line reader and the transform use. */
export type GeminiSignatureRule = Pick<GeminiReadRule, 'saveSignatures' | 'signatureSource' | 'signatureFormat'>

/** A thought signature collected while reading, to be saved under `id` for the token already placed in the text. */
export interface GeminiSignatureRecord {
    id: string
    signature: InlaySignature
}

/** The rule a request reads its Gemini reply with, taken from the request argument and the database. */
export function geminiReadRuleOf(
    arg: {
        extractJson?: string
        schema?: string
        saveSignatures?: boolean
        modelInfo?: { internalID?: string, id: string, format: LLMFormat }
    },
    db: { jsonSchemaEnabled?: boolean, streamGeminiThoughts?: boolean },
): GeminiReadRule {
    const model = arg.modelInfo
    if (!model) {
        // Every Gemini request resolves its model before it reads a reply; a rule without one could not name its signatures.
        throw new Error('A Gemini read rule needs the request model')
    }
    return {
        extractJson: arg.extractJson ? arg.extractJson : null,
        jsonSchema: Boolean(db.jsonSchemaEnabled || arg.schema),
        streamThoughts: db.streamGeminiThoughts === true,
        saveSignatures: arg.saveSignatures ?? false,
        signatureSource: model.internalID || model.id,
        signatureFormat: model.format,
    }
}

export function initGeminiStreamState(state?: {[key:string]:string}): {[key:string]:string} {
    if(!state) {
        return {
            "__sign_text": "",
            "__sign_function": "",
            "__last_thought": "",
            "__thoughts": "",
            "__tool_calls": "[]",
            "0": ""
        };
    }
    state["__sign_text"] = state["__sign_text"] || "";
    state["__sign_function"] = state["__sign_function"] || "";
    state["__last_thought"] = state["__last_thought"] || "";
    state["__thoughts"] = state["__thoughts"] || "";
    state["__tool_calls"] = state["__tool_calls"] || "[]";
    state["0"] = state["0"] || "";
    return state;
}

/**
 * Applies one complete or incomplete SSE line to `readed`. Returns true for a `[DONE]` line, which ends the
 * stream; a malformed line throws, as `JSON.parse` does. A signature that becomes a token is handed to `onSignature`
 * right before its token is appended; the reader itself writes nothing.
 */
export function applyGeminiLine(
    line:string,
    readed:{[key:string]:string},
    sig:GeminiSignatureRule,
    onSignature?:(record:GeminiSignatureRecord) => void
):boolean {
    if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') return true;

        const jsonData = JSON.parse(dataStr);

        if (jsonData.candidates?.[0]?.content?.parts) {
            const parts = jsonData.candidates[0].content.parts;
            for (const part of parts) {
                if (part.text) {
                    readed["__thoughts"] += readed["__last_thought"];
                    readed["__last_thought"] = "";
                    if (part.thought){
                        readed["__last_thought"] = part.text;
                    }
                    else {
                        readed["0"] += part.text;
                    }
                    if (part.thoughtSignature) {
                        readed["__sign_text"] = part.thoughtSignature;
                        if(sig.saveSignatures){
                            const sigId = v4()
                            onSignature?.({
                                id: sigId,
                                signature: {
                                    source: sig.signatureSource,
                                    sourceFormat: sig.signatureFormat,
                                    signatures: [{
                                        type: 'text',
                                        content: part.text,
                                    }]
                                }
                            })
                            readed["0"] += `{{inlayeddata::${sigId}}}`;
                        }
                    }
                }
                if (part.functionCall) {
                    const toolCallsData = JSON.parse(readed["__tool_calls"]);
                    toolCallsData.push(part.functionCall);
                    readed["__tool_calls"] = JSON.stringify(toolCallsData);
                    if(part.thoughtSignature){
                        readed["__sign_function"] = part.thoughtSignature;
                        const sigId = v4()

                        if(sig.saveSignatures){
                            onSignature?.({
                                id: sigId,
                                signature: {
                                    source: sig.signatureSource,
                                    sourceFormat: sig.signatureFormat,
                                    signatures: [{
                                        type: 'function',
                                        content: `${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`,
                                    }]
                                }
                            })
                            readed["0"] += `{{inlayeddata::${sigId}}}`;
                        }
                    }
                }
            }
        }

        if(jsonData.usageMetadata){
            readed['__usageMetadata'] = JSON.stringify(jsonData.usageMetadata)
        }
        if(jsonData.modelStatus){
            readed['__modelStatus'] = JSON.stringify(jsonData.modelStatus)
        }
    }
    return false
}

/** What the Gemini stream transform reports to its caller besides the emissions. */
export interface GeminiStreamIo {
    /** Called once at flush with the usage of the committed lines, when it parses. */
    onUsage?: (usage: TokenUsage) => void
    onSignature?: (record: GeminiSignatureRecord) => void
}

export function geminiStreamTransform(
    rule: GeminiSignatureRule,
    io: GeminiStreamIo,
):TransformStream<Uint8Array, StreamResponseChunk> {
    // Only the incomplete last line is kept between reads: each complete line is folded into `committed`
    // once, and the tail is applied to a copy so it never changes what later reads see.
    let carry = '';
    // A committed `[DONE]` or malformed line ends all emission for good.
    let halted = false;
    const committed = initGeminiStreamState();
    // One decoder per stream, so a character split across chunks is joined instead of replaced.
    const decoder = new TextDecoder();
    return new TransformStream<Uint8Array, StreamResponseChunk>({
        transform(chunk, control) {
            if (halted) return;
            carry += decoder.decode(chunk, {stream: true});
            const lastBreak = carry.lastIndexOf('\n');
            if (lastBreak >= 0) {
                const complete = carry.slice(0, lastBreak).split('\n');
                carry = carry.slice(lastBreak + 1);
                try {
                    for (const line of complete) {
                        if (applyGeminiLine(line, committed, rule, io.onSignature)) {
                            halted = true;
                            return;
                        }
                    }
                } catch (error) {
                    halted = true;
                    return;
                }
            }

            // The enqueued object is fresh: `wrapToolStream` mutates what it receives.
            const readed = {...committed};
            try {
                if (applyGeminiLine(carry, readed, rule, io.onSignature)) return;
                control.enqueue(readed)
            } catch (error) {

            }
        },
        flush() {
            carry += decoder.decode();
            // The cumulative usage of the committed lines only, parsed once.
            const rawUsage = committed['__usageMetadata']
            if(rawUsage){
                try {
                    const usage = parseGoogleUsage(JSON.parse(rawUsage))
                    if(usage){
                        io.onUsage?.(usage)
                    }
                } catch (error) {}
            }
        }
    });
}

/** The reply content after the JSON extraction the request was built with. */
export function extractGeminiContent(content: string, rule: Pick<GeminiReadRule, 'extractJson' | 'jsonSchema'>, subject?: RunSubject): string {
    if(rule.extractJson && rule.jsonSchema){
        return extractJSON(content, rule.extractJson, {subject})
    }
    return content
}

/** The text a Gemini stream shows for a snapshot whose content is already extracted: thoughts, then content, after `prefix`. */
export function composeGeminiDisplay(
    snapshot: { content: string, thoughts: string, lastThought: string },
    streamThoughts: boolean,
    prefix: string,
): string {
    const { content, thoughts, lastThought } = snapshot
    if(streamThoughts) {
        return (prefix ? prefix + '\n\n' : '')
            + (thoughts ? `<Thoughts>\n\n${thoughts}\n\n</Thoughts>\n\n` : '')
            + (lastThought ? lastThought + '\n\n' : '')
            + content
    }
    return (prefix ? prefix + '\n\n' : '')
        + (thoughts + lastThought ? `<Thoughts>\n\n${thoughts + lastThought}\n\n</Thoughts>\n\n` : '')
        + content
}

/** The text a stream emission shows, from the raw snapshot the transform enqueued; it never changes the snapshot. */
export function geminiDisplayText(
    snapshot: {[key:string]:string},
    rule: GeminiReadRule,
    subject: RunSubject | undefined,
    prefix: string,
): string {
    const state = initGeminiStreamState({...snapshot})
    return composeGeminiDisplay({
        content: extractGeminiContent(state["0"], rule, subject),
        thoughts: state["__thoughts"],
        lastThought: state["__last_thought"],
    }, rule.streamThoughts, prefix)
}
