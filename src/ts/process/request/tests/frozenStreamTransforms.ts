/**
 * Frozen reference copies of the streaming transforms as they behaved before the incremental rewrite
 * (the OpenAI chat `getTranStream`, the Gemini `getTranStream` and its `initStreamState`).
 * They are the oracle of `streamTransformEquivalence.test.ts` and are never edited to match new code.
 * Dependencies come from the real modules, so the test mocks apply to both versions.
 */
import { LLMFlags, type LLMModel } from "src/ts/model/modellist"
import { getDatabase } from "src/ts/storage/database.svelte"
import { v4 } from "uuid"
import { saveInlayedSignature } from "../../files/inlays"
import { extractJSON } from "../../templates/jsonSchema"
import type { RequestDataArgumentExtended, StreamResponseChunk } from '../request'

export function frozenOpenAIGetTranStream(arg:RequestDataArgumentExtended):TransformStream<Uint8Array, StreamResponseChunk> {
    let dataUint:Uint8Array|Buffer = new Uint8Array([])
    let reasoningContent = ""
    let reasoningFromStructured = false
    const db = getDatabase()

    const appendStreamingFragment = (current:string, incoming?:string) => {
        if(!incoming){
            return current
        }
        if(incoming.length > current.length && incoming.startsWith(current)){
            return incoming
        }
        return current + incoming
    }

    return new TransformStream<Uint8Array, StreamResponseChunk>({
        transform(chunk, control) {
            const combined = new Uint8Array(dataUint.length + chunk.length);
            combined.set(dataUint, 0);
            combined.set(chunk, dataUint.length);
            dataUint = Buffer.from(combined);
            let JSONreaded:{[key:string]:string} = {}
            reasoningContent = ""
                        try {
                const datas = dataUint.toString().split('\n')
                let readed:{[key:string]:string} = {}
                for(const data of datas){
                    if(data.startsWith("data: ")){
                        try {
                            const rawChunk = data.replace("data: ", "")
                            if(rawChunk === "[DONE]"){
                                if(arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingOutput) && !reasoningFromStructured){
                                    readed["0"] = readed["0"].replace(/(.*)\<\/think\>/gms, (m, p1) => {
                                        reasoningContent = p1
                                        return ""
                                    })

                                    if(reasoningContent){
                                        reasoningContent = reasoningContent.replace(/\<think\>/gm, '')
                                    }
                                }
                                if(arg.extractJson && (db.jsonSchemaEnabled || arg.schema)){
                                    for(const key in readed){
                                        const extracted = extractJSON(readed[key], arg.extractJson, {subject: arg.subject})
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
                                return
                            }
                            const choices = JSON.parse(rawChunk).choices
                            for(const choice of choices){
                                const chunk = choice.delta.content ?? choice.text
                                if(chunk){
                                    if(arg.multiGen){
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
                                    reasoningContent = appendStreamingFragment(reasoningContent, reasoningChunk)
                                }
                            }
                        } catch (error) {}
                    }
                }

                if(arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingOutput) && !reasoningFromStructured){
                    readed["0"] = readed["0"].replace(/(.*)\<\/think\>/gms, (m, p1) => {
                        reasoningContent = p1
                        return ""
                    })

                    if(reasoningContent){
                        reasoningContent = reasoningContent.replace(/\<think\>/gm, '')
                    }
                }
                if(arg.extractJson && (db.jsonSchemaEnabled || arg.schema)){
                    for(const key in readed){
                        const extracted = extractJSON(readed[key], arg.extractJson, {subject: arg.subject})
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
            } catch (error) {

            }
        }
    })
}

export function frozenInitStreamState(state?: {[key:string]:string}): {[key:string]:string} {
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

export function frozenGeminiGetTranStream(args:{
    modelInfo:LLMModel,
    saveSignature:boolean
}):TransformStream<Uint8Array, StreamResponseChunk> {
    let buffer = '';
    // One decoder per stream, so a character split across chunks is joined instead of replaced.
    const decoder = new TextDecoder();
    const { modelInfo, saveSignature } = args
    return new TransformStream<Uint8Array, StreamResponseChunk>({
        transform(chunk, control) {
            buffer += decoder.decode(chunk, {stream: true});
            const lines = buffer.split('\n');

            let readed = frozenInitStreamState();

            try {
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') return;

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
                                        if(saveSignature){
                                            //Its a promise, but we don't need to await it here
                                            const sigId = v4()
                                            saveInlayedSignature(sigId, {
                                                source: modelInfo.internalID || modelInfo.id,
                                                sourceFormat: modelInfo.format,
                                                signatures: [{
                                                    type: 'text',
                                                    content: part.text,
                                                }]
                                            }).catch((error) => console.error('The Gemini signature could not be saved:', error))
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

                                        if(saveSignature){
                                            //Its a promise, but we don't need to await it here
                                            saveInlayedSignature(sigId, {
                                                source: modelInfo.internalID || modelInfo.id,
                                                sourceFormat: modelInfo.format,
                                                signatures: [{
                                                    type: 'function',
                                                    content: `${part.functionCall.name}(${JSON.stringify(part.functionCall.args)})`,
                                                }]
                                            }).catch((error) => console.error('The Gemini signature could not be saved:', error))
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
                }
                control.enqueue(readed)
            } catch (error) {

            }
        },
        flush() {
            buffer += decoder.decode();
        }
    });
}
