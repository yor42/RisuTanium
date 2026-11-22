import type { RunSubject } from '../../chatOrigin'
import { extractJSON } from '../../templates/jsonSchema'
import { parseOpenAIChatUsage } from '../../../usage/usageParse'
import type { TokenUsage } from '../../../usage/usageTypes'
import type { StreamResponseChunk } from '../request'
import type { OpenAIChatReadRule } from './chatBodyParse'

/**
 * What the OpenAI-compatible chat stream transform reports to its caller besides the emissions. It is the whole input of
 * the transform besides the rule and the bytes, so the live request and a recovered record read a stream the same way.
 */
export interface OpenAIChatStreamIo {
    /** The run `extractJSON` reports its warnings to. */
    subject?: RunSubject
    /** Called once at flush with the last non-null usage object of the stream, when it parses. */
    onUsage?: (usage: TokenUsage) => void
}

type OpenAIStreamState = {
    readed:{[key:string]:string}
    reasoning:string
    // The last non-null usage object seen on a complete line; a later `usage: null` never erases it.
    usage?:object
}

/**
 * The transform of an OpenAI-compatible chat stream into the reply text so far. It reads the rule, the io object and the
 * bytes, and no request argument or database, so any byte partition of one body ends with the same last emission.
 */
export function openAIChatStreamTransform(
    rule:OpenAIChatReadRule,
    io:OpenAIChatStreamIo,
):TransformStream<Uint8Array, StreamResponseChunk> {
    // Only the incomplete last line crosses a read boundary. Each complete line is folded into
    // `committed` once; the incomplete tail is folded into a throwaway copy.
    let carry:Uint8Array = new Uint8Array([])
    const committed:OpenAIStreamState = {readed: {}, reasoning: ""}
    let doneSnap:OpenAIStreamState|null = null
    let pendingSnap:OpenAIStreamState|null = null
    let reasoningFromStructured = false

    const appendStreamingFragment = (current:string, incoming?:string) => {
        if(!incoming){
            return current
        }
        if(incoming.length > current.length && incoming.startsWith(current)){
            return incoming
        }
        return current + incoming
    }

    const copyState = (state:OpenAIStreamState):OpenAIStreamState => ({readed: {...state.readed}, reasoning: state.reasoning})

    // Emits fresh copies of `state`. It throws exactly where the `[DONE]` and final emissions always
    // threw, before any enqueue.
    const emit = (state:OpenAIStreamState, control:TransformStreamDefaultController<StreamResponseChunk>) => {
        const readed = {...state.readed}
        let reasoningContent = state.reasoning
        const JSONreaded:{[key:string]:string} = {}
        if(rule.deepSeekThinkingOutput && !reasoningFromStructured){
            readed["0"] = readed["0"].replace(/(.*)\<\/think\>/gms, (m, p1) => {
                reasoningContent = p1
                return ""
            })

            if(reasoningContent){
                reasoningContent = reasoningContent.replace(/\<think\>/gm, '')
            }
        }
        if(rule.extractJson !== null && rule.jsonSchema){
            for(const key in readed){
                const extracted = extractJSON(readed[key], rule.extractJson, {subject: io.subject})
                JSONreaded[key] = extracted
            }
            console.log(JSONreaded)
            control.enqueue(JSONreaded)
        }
        else if(reasoningContent){
            const chunk:Record<string,string> = {
                "0": `<Thoughts>\n${reasoningContent}\n</Thoughts>\n${readed["0"] ?? ''}`,
            }
            if(readed["__tool_calls"]){
                chunk["__tool_calls"] = readed["__tool_calls"]
            }
            control.enqueue(chunk)
        }
        else{
            control.enqueue(readed)
        }
    }

    // Folds one line into `state`. A `[DONE]` line emits at once: 'done' when that completed, 'threw' when
    // the emission threw (the throw is swallowed and the state is unchanged).
    const applyLine = (data:string, state:OpenAIStreamState, control:TransformStreamDefaultController<StreamResponseChunk>):'done'|'threw'|'line' => {
        if(data.startsWith("data: ")){
            try {
                const rawChunk = data.replace("data: ", "")
                if(rawChunk === "[DONE]"){
                    try {
                        emit(state, control)
                    } catch (error) {
                        return 'threw'
                    }
                    return 'done'
                }
                const readed = state.readed
                const parsedChunk = JSON.parse(rawChunk)
                const choices = parsedChunk.choices
                const chunkUsage:unknown = parsedChunk.usage
                if(typeof chunkUsage === 'object' && chunkUsage !== null){
                    state.usage = chunkUsage
                }
                for(const choice of choices){
                    const chunk = choice.delta.content ?? choice.text
                    if(chunk){
                        if(rule.multiGen){
                            const ind = choice.index.toString()
                            if(!readed[ind]){
                                readed[ind] = ""
                            }
                            readed[ind] = appendStreamingFragment(readed[ind], chunk)
                        }
                        else{
                            if(!readed["0"]){
                                readed["0"] = ""
                            }
                            readed["0"] = appendStreamingFragment(readed["0"], chunk)
                        }
                    }
                    // Check for tool calls in the delta
                    if(choice?.delta?.tool_calls){
                        if(!readed["__tool_calls"]){
                            readed["__tool_calls"] = JSON.stringify({})
                        }
                        const toolCallsData = JSON.parse(readed["__tool_calls"])

                        for(const toolCall of choice.delta.tool_calls) {
                            const index = toolCall.index ?? 0
                            const toolCallId = toolCall.id

                            // Initialize tool call data if not exists
                            if(!toolCallsData[index]) {
                                toolCallsData[index] = {
                                    id: toolCallId || null,
                                    type: 'function',
                                    function: {
                                        name: null,
                                        arguments: ''
                                    }
                                }
                            }

                            // Update tool call data incrementally
                            if(toolCall.id) {
                                toolCallsData[index].id = toolCall.id
                            }
                            if(toolCall.function?.name) {
                                toolCallsData[index].function.name = toolCall.function.name
                            }
                            if(toolCall.function?.arguments) {
                                toolCallsData[index].function.arguments = appendStreamingFragment(toolCallsData[index].function.arguments, toolCall.function.arguments)
                            }
                        }

                        readed["__tool_calls"] = JSON.stringify(toolCallsData)
                    }
                    const reasoningChunk = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
                    if(reasoningChunk){
                        reasoningFromStructured = true
                        state.reasoning = appendStreamingFragment(state.reasoning, reasoningChunk)
                    }
                }
            } catch (error) {}
        }
        return 'line'
    }

    return new TransformStream<Uint8Array, StreamResponseChunk>({
        transform(chunk, control) {
            // A `[DONE]` whose emission threw is re-tested first, against the current sticky flag.
            if(pendingSnap){
                try {
                    emit(pendingSnap, control)
                    doneSnap = pendingSnap
                    pendingSnap = null
                    return
                } catch (error) {}
            }
            if(doneSnap){
                try {
                    emit(doneSnap, control)
                } catch (error) {}
                return
            }
            try {
                const combined = new Uint8Array(carry.length + chunk.length);
                combined.set(carry, 0);
                combined.set(chunk, carry.length);
                const lastLF = combined.lastIndexOf(0x0A)
                if(lastLF >= 0){
                    const datas = Buffer.from(combined.subarray(0, lastLF)).toString().split('\n')
                    carry = combined.slice(lastLF + 1)
                    for(const data of datas){
                        const outcome = applyLine(data, committed, control)
                        if(outcome === 'done'){
                            doneSnap = committed
                            return
                        }
                        if(outcome === 'threw' && !pendingSnap){
                            pendingSnap = copyState(committed)
                        }
                    }
                }
                else{
                    carry = combined
                }

                let current = committed
                if(carry.length > 0){
                    current = copyState(committed)
                    if(applyLine(Buffer.from(carry).toString(), current, control) === 'done'){
                        return
                    }
                }
                emit(current, control)
            } catch (error) {

            }
        },
        flush() {
            // Only complete lines are committed, so the tail copy never contributes usage. One report per stream;
            // a stream without parsable usage reports nothing.
            try {
                const usage = parseOpenAIChatUsage(committed.usage)
                if(usage){
                    io.onUsage?.(usage)
                }
            } catch (error) {}
        }
    })
}
