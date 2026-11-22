import type { RunSubject } from '../../chatOrigin'
import { extractJSON } from '../../templates/jsonSchema'
import { parseResponsesUsage } from '../../../usage/usageParse'
import type { TokenUsage } from '../../../usage/usageTypes'
import type { StreamResponseChunk } from '../request'
import type { ResponseFunctionCallItem, ResponseItem } from './types'

/** What a Responses API stream is read with besides its bytes: the JSON extraction the request was built with. */
export interface ResponsesReadRule {
    /** The JSON path the reply text is extracted with; null when none is set. */
    extractJson: string | null
    /** The database's JSON schema switch or the request's own schema: extraction applies only when it is set. */
    jsonSchema: boolean
}

/** The parse context of a recorded Responses API stream: the same rule under its own kind. */
export type ResponsesStreamParseContext = ResponsesReadRule & { kind: 'openai-responses-stream' }

/**
 * What the Responses stream transform reports to its caller besides the emissions. It is the whole input of the transform
 * besides the rule and the bytes, so the live request and a recovered record read a stream the same way.
 */
export interface ResponsesStreamIo {
    /** The run `extractJSON` reports its warnings to. */
    subject?: RunSubject
    /** Called once at flush with the usage of the completed response, when it parses. */
    onUsage?: (usage: TokenUsage) => void
}

/** The rule a request reads its Responses reply with, taken from the request argument and the database. */
export function responsesReadRuleOf(
    arg: { extractJson?: string, schema?: string },
    db: { jsonSchemaEnabled?: boolean },
): ResponsesReadRule {
    return {
        extractJson: arg.extractJson ? arg.extractJson : null,
        jsonSchema: Boolean(db.jsonSchemaEnabled || arg.schema),
    }
}

export function sanitizeResponsesContinuationItem(item:any):ResponseItem | null{
    if(item?.type === 'function_call' && item.call_id && item.name){
        return {
            type: 'function_call',
            call_id: item.call_id,
            name: item.name,
            arguments: item.arguments ?? '',
            status: item.status ?? 'completed'
        }
    }

    if(item?.type === 'message'){
        const content = (item.content ?? []).flatMap((contentItem:any) => {
            if(contentItem?.type === 'output_text'){
                return [{ type: 'output_text', text: contentItem.text ?? '', annotations: contentItem.annotations ?? [] }]
            }
            if(contentItem?.type === 'refusal'){
                return [{ type: 'refusal', refusal: contentItem.refusal ?? '' }]
            }
            return []
        })

        return {
            type: 'message',
            role: item.role ?? 'assistant',
            status: item.status ?? 'completed',
            content
        }
    }

    return null
}

export function extractResponsesFunctionCalls(data:any):ResponseFunctionCallItem[]{
    return (data?.output ?? [])
        .filter((item:any) => item?.type === 'function_call' && item.name && item.call_id)
        .map((item:any) => sanitizeResponsesContinuationItem(item))
        .filter((item:any): item is ResponseFunctionCallItem => item?.type === 'function_call')
}

function collectResponsesReasoningText(value:any):string[]{
    if(!value){
        return []
    }
    if(typeof value === 'string'){
        return [value]
    }
    if(Array.isArray(value)){
        return value.flatMap((item) => collectResponsesReasoningText(item))
    }
    if(typeof value !== 'object'){
        return []
    }

    const texts:string[] = []
    for(const key of ['text', 'summary_text', 'reasoning_text', 'reasoning', 'summary']){
        if(typeof value[key] === 'string'){
            texts.push(value[key])
        }
    }
    return texts
}

function extractResponsesReasoningTexts(item:any):string[]{
    if(item?.type !== 'reasoning'){
        return []
    }

    const texts = [
        ...collectResponsesReasoningText(item.summary),
        ...collectResponsesReasoningText(item.content),
    ]
    for(const key of ['text', 'summary_text', 'reasoning_text', 'reasoning']){
        if(typeof item[key] === 'string'){
            texts.push(item[key])
        }
    }

    return texts.filter((text) => text.length > 0)
}

/** The reply text of a whole Responses body, read with the rule and the run it is given and nothing else. */
export function extractResponsesTextWith(data:any, rule:ResponsesReadRule, subject?:RunSubject):string{
    const texts:string[] = []
    const refusals:string[] = []
    const thoughts:string[] = []
    const hasTopLevelOutputText = typeof data?.output_text === 'string'

    if(hasTopLevelOutputText){
        texts.push(data.output_text)
    }

    for(const item of data?.output ?? []){
        if(item?.type === 'reasoning'){
            thoughts.push(...extractResponsesReasoningTexts(item))
        }
        if(item?.type !== 'message'){
            continue
        }
        for(const content of item.content ?? []){
            if(!hasTopLevelOutputText && content?.type === 'output_text' && content.text){
                texts.push(content.text)
            }
            if(content?.type === 'refusal' && content.refusal){
                refusals.push(content.refusal)
            }
        }
    }

    if(refusals.length > 0 && texts.length === 0){
        return refusals.join('\n')
    }

    let result = texts.join('\n')
    if(thoughts.length > 0 && !result.startsWith('<Thoughts>')){
        result = `<Thoughts>\n\n${thoughts.join('\n\n')}\n\n</Thoughts>\n${result}`
    }
    if(rule.extractJson !== null && rule.jsonSchema){
        return extractJSON(result, rule.extractJson, {subject})
    }

    return result
}

/**
 * The transform of a Responses API event stream into the reply text so far. It reads the rule, the io object and the
 * bytes, and no request argument or database, so any byte partition of one body ends with the same last emission.
 */
export function responsesStreamTransform(rule:ResponsesReadRule, io:ResponsesStreamIo):TransformStream<Uint8Array, StreamResponseChunk>{
    const decoder = new TextDecoder()
    let buffer = ''
    let text = ''
    let reasoning = ''
    let error = ''
    let completedUsage:unknown = null
    const calls:Record<string, ResponseFunctionCallItem> = {}

    const appendReasoning = (incoming?:string) => {
        if(!incoming){
            return
        }
        if(reasoning.endsWith(incoming)){
            return
        }
        if(reasoning){
            reasoning += "\n\n"
        }
        reasoning += incoming
    }

    const emit = (controller:TransformStreamDefaultController<StreamResponseChunk>) => {
        let result = text
        if(reasoning){
            result = `<Thoughts>\n\n${reasoning}\n\n</Thoughts>\n${result}`
        }
        if(rule.extractJson !== null && rule.jsonSchema){
            result = extractJSON(result, rule.extractJson, {subject: io.subject})
        }
        const chunk:Record<string,string> = { "0": error || result }
        if(Object.keys(calls).length > 0){
            chunk["__tool_calls"] = JSON.stringify(calls)
        }
        controller.enqueue(chunk)
    }

    const applyEvent = (event:any) => {
        const type = event?.type
        if(type === 'response.output_text.delta' || type === 'response.refusal.delta'){
            text += event.delta ?? ''
        }
        else if(type === 'response.output_text.done' && event.text && !text.endsWith(event.text)){
            text = event.text
        }
        else if(type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta' || type === 'response.reasoning.delta'){
            appendReasoning(event.delta)
        }
        else if(type === 'response.reasoning_summary_text.done' || type === 'response.reasoning_text.done'){
            if(event.text && !reasoning.endsWith(event.text)){
                reasoning = event.text
            }
        }
        else if(type === 'response.function_call_arguments.delta'){
            const key = event.call_id ?? event.item_id ?? event.output_index?.toString() ?? '0'
            calls[key] ??= { type: 'function_call', call_id: event.call_id ?? key, name: '', arguments: '' }
            calls[key].arguments += event.delta ?? ''
        }
        else if(type === 'response.output_item.done' && event.item?.type === 'function_call'){
            if(event.item.id){
                delete calls[event.item.id]
            }
            calls[event.item.call_id] = {
                type: 'function_call',
                call_id: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments ?? '',
                status: event.item.status
            }
        }
        else if(type === 'response.failed' || type === 'response.error' || type === 'error'){
            error = JSON.stringify(event.error ?? event)
        }
        else if(type === 'response.completed'){
            completedUsage = event.response?.usage
            const finalText = extractResponsesTextWith(event.response, rule, io.subject)
            if(finalText){
                text = finalText
                if(finalText.startsWith('<Thoughts>')){
                    reasoning = ''
                }
            }
            for(const call of extractResponsesFunctionCalls(event.response)){
                calls[call.call_id] = call
            }
        }
    }

    const processBufferedEvents = (controller:TransformStreamDefaultController<StreamResponseChunk>, final = false) => {
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        if(final && buffer.trim()){
            events.push(buffer)
            buffer = ''
        }

        let emitted = false
        for(const rawEvent of events){
            const dataLines = rawEvent.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.replace(/^data:\s?/, ''))
            if(dataLines.length === 0){
                continue
            }
            const data = dataLines.join('\n')
            if(data === '[DONE]'){
                emit(controller)
                emitted = true
                continue
            }
            try{
                applyEvent(JSON.parse(data))
            }
            catch{}
            emit(controller)
            emitted = true
        }
        return emitted
    }

    // One report per HTTP response that carries usage; an unparsable usage reports nothing.
    const reportUsage = () => {
        try{
            const usage = parseResponsesUsage(completedUsage)
            if(usage){
                io.onUsage?.(usage)
            }
        }
        catch{}
    }

    return new TransformStream<Uint8Array, StreamResponseChunk>({
        transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true })
            processBufferedEvents(controller)
        },
        flush(controller) {
            buffer += decoder.decode()
            const emitted = processBufferedEvents(controller, true)
            reportUsage()
            if(!emitted){
                emit(controller)
            }
        }
    })
}
