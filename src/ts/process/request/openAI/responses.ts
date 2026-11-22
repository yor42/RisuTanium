import { language } from "src/lang"
import { fillLang } from "src/lang/fill"
import { alertError } from "src/ts/alert"
import { getDatabase } from "src/ts/storage/database.svelte"
import { LLMFlags } from "src/ts/model/modellist"
import { addFetchLog, fetchNative, globalFetch, textifyReadableStream } from "src/ts/globalApi.svelte"
import { simplifySchema } from "src/ts/util"
import { NANOGPT_RESPONSES_ENDPOINT, NANOGPT_SUBSCRIPTION_RESPONSES_ENDPOINT } from "src/ts/model/providers/nanogpt"

import { getOpenAIJSONSchema } from "../../templates/jsonSchema"
import { callTool, decodeToolCall, encodeToolCall } from "../../mcp/mcp"
import type { RequestDataArgumentExtended, requestDataResponse, StreamResponseChunk } from '../request'
import { applyAdditionalParameters, applyParameters, getAdditionalParameters, isReasoningCapabilityParameter } from '../shared'

import type { OpenAIChatExtra, ResponseFunctionCallItem, ResponseInputItem, ResponseItem, ResponseOutputItem } from './types'
import { getLocalNetworkRequestOptions, type LocalNetworkRequestOptions } from './shared'
import { limitedField, sendArgKey, sendKeyLine } from '../secretKey'
import { beginToolRound, endStreamForGate, gateResult, toolBlockGate } from '../toolLoop'
import { parseResponsesUsage } from '../../../usage/usageParse'
import { bindOwnedStream, endOwnedRead, retireFailedHead, retireOwnedStream } from 'src/ts/nativeReply/ownedStream'
import { extractResponsesFunctionCalls, extractResponsesTextWith, responsesReadRuleOf, responsesStreamTransform, sanitizeResponsesContinuationItem } from './responsesStreamTransform'

function responseTextContentToString(content:any):string{
    if(typeof content === 'string'){
        return content
    }
    if(Array.isArray(content)){
        return content.map((c) => c?.text ?? '').join('\n')
    }
    return ''
}

async function decodeRememberedToolCallsForResponses(text:string):Promise<ResponseItem[]>{
    const items:ResponseItem[] = []
    const segments = text.split(/(<tool_call>.*?<\/tool_call>)/gms)
    let currentContent = ''

    for(const segment of segments){
        const toolCallMatch = segment.match(/<tool_call>(.*?)<\/tool_call>/s)
        if(!toolCallMatch){
            currentContent += segment
            continue
        }

        if(currentContent.trim()){
            items.push({
                content: [{ type: 'output_text', text: currentContent, annotations: [] }],
                role: 'assistant',
                status: 'completed',
                type: 'message'
            })
            currentContent = ''
        }

        const decoded = await decodeToolCall(toolCallMatch[1])
        if(decoded){
            items.push({
                type: 'function_call',
                call_id: decoded.call.id,
                name: decoded.call.name,
                arguments: decoded.call.arg,
                status: 'completed'
            })
            items.push({
                type: 'function_call_output',
                call_id: decoded.call.id,
                output: decoded.response.filter((m) => m.type === 'text').map((m) => m.text).join('\n')
            })
        }
    }

    if(currentContent.trim()){
        items.push({
            content: [{ type: 'output_text', text: currentContent, annotations: [] }],
            role: 'assistant',
            status: 'completed',
            type: 'message'
        })
    }

    return items
}

async function buildResponseInputItems(arg:RequestDataArgumentExtended):Promise<ResponseItem[]>{
    const items:ResponseItem[] = []
    const developerRole = arg.modelInfo.flags.includes(LLMFlags.DeveloperRole)
    const db = getDatabase()

    for(const content of arg.formated as OpenAIChatExtra[]){
        switch(content.role){
            case 'function':
                break
            case 'tool':{
                items.push({
                    type: 'function_call_output',
                    call_id: content.tool_call_id ?? '',
                    output: responseTextContentToString(content.content)
                })
                break
            }
            case 'assistant':{
                if(typeof content.content === 'string' && content.content.includes('<tool_call>')){
                    items.push(...await decodeRememberedToolCallsForResponses(content.content))
                    break
                }

                const text = responseTextContentToString(content.content)
                const item:ResponseOutputItem = {
                    content: text ? [{ type: 'output_text', text: text, annotations: [] }] : [],
                    role: 'assistant',
                    status: 'completed',
                    type: 'message',
                }
                items.push(item)

                if(content.tool_calls){
                    for(const toolCall of content.tool_calls){
                        items.push({
                            type: 'function_call',
                            call_id: toolCall.id,
                            name: toolCall.function.name,
                            arguments: toolCall.function.arguments,
                            status: 'completed'
                        })
                    }
                }
                break
            }
            case 'user':
            case 'developer':
            case 'system':{
                const role = content.role === 'system' && developerRole ? 'developer' : content.role
                const item:ResponseInputItem = {
                    content: [],
                    role: role as 'user' | 'system' | 'developer'
                }

                const text = responseTextContentToString(content.content)
                if(text || db.newOAIHandle === false){
                    item.content.push({ type: 'input_text', text })
                }

                const multimodals = content.multimodals ?? []
                for(const multimodal of multimodals){
                    if(multimodal.type === 'image'){
                        item.content.push({
                            type: 'input_image',
                            detail: (db.gptVisionQuality ?? 'auto') as 'high' | 'low' | 'auto',
                            image_url: multimodal.base64
                        })
                    }
                    else{
                        item.content.push({
                            type: 'input_file',
                            file_data: multimodal.base64,
                        })
                    }
                }

                if(item.content.length > 0){
                    items.push(item)
                }
                break
            }
        }
    }

    return items
}

function getResponsesRequestURL(arg:RequestDataArgumentExtended):{requestURL:string, risuIdentify:boolean}{
    const db = getDatabase()
    const aiModel = arg.aiModel
    let requestURL = aiModel === 'nanogpt'
        ? (db.nanogptUseSubscriptionEndpoint ? NANOGPT_SUBSCRIPTION_RESPONSES_ENDPOINT : NANOGPT_RESPONSES_ENDPOINT)
        : (arg.customURL ?? "https://api.openai.com/v1/responses")
    if(arg.modelInfo?.endpoint){
        requestURL = arg.modelInfo.endpoint
    }

    let risuIdentify = false
    if(requestURL.startsWith("risu::")){
        risuIdentify = true
        requestURL = requestURL.replace("risu::", '')
    }

    if(aiModel === 'reverse_proxy' && db.autofillRequestUrl){
        try{
            const url = new URL(requestURL)
            const pathSegments = url.pathname.split('/').filter(Boolean)
            const lastSegment = pathSegments[pathSegments.length - 1] ?? ''

            if(url.searchParams.has('api-version') && url.pathname.includes('/responses')){
                // Azure-style Responses API URL already includes the endpoint
            }
            else if(lastSegment === 'responses'){
                // keep as-is
            }
            else if(lastSegment === 'v1'){
                url.pathname = url.pathname.replace(/\/?$/, '/responses')
            }
            else{
                url.pathname = url.pathname.replace(/\/?$/, '/v1/responses')
            }

            requestURL = url.toString()
        }
        catch{
            const [baseURL, query] = requestURL.split('?', 2)
            let nextURL = baseURL
            const pathSegments = nextURL.split('/').filter(Boolean)
            const lastSegment = pathSegments[pathSegments.length - 1] ?? ''
            const hasApiVersion = query?.includes('api-version=')

            if(hasApiVersion && nextURL.includes('/responses')){
                // Azure-style Responses API URL already includes the endpoint
            }
            else if(lastSegment === 'responses'){
                // keep as-is
            }
            else if(lastSegment === 'v1'){
                nextURL += nextURL.endsWith('/') ? 'responses' : '/responses'
            }
            else{
                nextURL += nextURL.endsWith('/') ? 'v1/responses' : '/v1/responses'
            }

            requestURL = query ? `${nextURL}?${query}` : nextURL
        }
    }

    return { requestURL, risuIdentify }
}

async function buildResponsesHeaders(arg:RequestDataArgumentExtended, risuIdentify:boolean):Promise<Record<string,string>>{
    const db = getDatabase()
    const aiModel = arg.aiModel
    // Only the chosen field is resolved, so an unset reference in a field this model does not use cannot fail it.
    const chosenKey = arg.modelInfo?.keyIdentifier
        ? await sendKeyLine(arg, `OaiCompAPIKeys:${arg.modelInfo.keyIdentifier}`)
        : (arg.key != null
            ? await sendArgKey(arg)
            : await sendKeyLine(arg, aiModel === 'nanogpt' ? 'nanogptKey' : aiModel === 'reverse_proxy' ? 'proxyKey' : 'openAIKey'))
    const headers = {
        "Authorization": "Bearer " + chosenKey,
        "Content-Type": "application/json"
    }
    if(risuIdentify){
        headers["X-Proxy-Risu"] = 'RisuAI'
    }
    if(aiModel === 'nanogpt' && db.nanogptProvider && !db.nanogptUseSubscriptionEndpoint){
        headers["X-Provider"] = db.nanogptProvider
    }

    return headers
}

function getResponsesRequestModel(arg:RequestDataArgumentExtended):string{
    const db = getDatabase()
    if(arg.aiModel === 'nanogpt'){
        return db.nanogptRequestModel || arg.modelInfo.internalID || arg.aiModel
    }
    return arg.modelInfo.internalID || arg.aiModel || 'gpt-4.1'
}

function cloneResponsesBodyForRequest<T>(value:T):T{
    if(typeof structuredClone === 'function'){
        return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value))
}

function toExternalResponsesBody(body:Record<string, any>):Record<string, any>{
    const { __lastOutput: _internalLastOutput, ...externalBody } = body
    const requestBody = cloneResponsesBodyForRequest(externalBody)
    if(requestBody.store === false && Array.isArray(requestBody.input)){
        requestBody.input = requestBody.input.flatMap((item:any) => {
            const sanitized = sanitizeResponsesContinuationItem(item)
            if(sanitized){
                return [sanitized]
            }
            if(item?.type === 'reasoning'){
                return []
            }
            if(item && typeof item === 'object'){
                const { id: _serverItemId, ...clientItem } = item
                return [clientItem]
            }
            return [item]
        })
    }
    return requestBody
}

async function buildResponsesBody(arg:RequestDataArgumentExtended):Promise<Record<string, any>>{
    const db = getDatabase()
    const tools:any[] = []

    if(arg.tools && arg.tools.length > 0){
        tools.push(...arg.tools.map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: simplifySchema(tool.inputSchema),
        })))
    }
    if(db.modelTools.includes('search')){
        tools.push({ type: 'web_search_preview' })
    }

    const responseParameters = arg.modelInfo.parameters.filter((p) =>
        ['temperature', 'top_p', 'reasoning_effort', 'verbosity'].includes(p) || isReasoningCapabilityParameter(p)
    )

    let body = applyParameters({
        model: getResponsesRequestModel(arg),
        input: await buildResponseInputItems(arg),
        max_output_tokens: arg.maxTokens,
        tools: tools,
        store: false
    }, responseParameters, {
        reasoning_effort: 'reasoning.effort',
        verbosity: 'text.verbosity'
    }, arg.mode, {
        modelId: arg.modelInfo.id
    })

    if(body.tools.length === 0){
        delete body.tools
    }
    if(arg.modelInfo.parameters.includes('reasoning_effort' as any)){
        body.reasoning ??= {}
        body.reasoning.summary ??= 'auto'
    }
    if(arg.aiModel === 'ollama-cloud'){
        delete body.store
    }
    if(db.jsonSchemaEnabled || arg.schema){
        body.text ??= {}
        body.text.format = {
            type: 'json_schema',
            ...getOpenAIJSONSchema(arg.schema, {subject: arg.subject})
        }
    }

    return body
}

function extractResponsesText(data:any, arg:RequestDataArgumentExtended):string{
    return extractResponsesTextWith(data, responsesReadRuleOf(arg, getDatabase()), arg.subject)
}

async function appendResponsesToolOutputs(body:any, calls:ResponseFunctionCallItem[], arg:RequestDataArgumentExtended, assistantText:string):Promise<string>{
    const db = getDatabase()
    const input = body.input as ResponseItem[]
    for(const item of body.__lastOutput ?? []){
        const sanitized = sanitizeResponsesContinuationItem(item)
        if(!sanitized){
            continue
        }
        if(db.simplifiedToolUse && item?.type === 'message'){
            input.push({ ...sanitized, content: [] })
        }
        else{
            input.push(sanitized)
        }
    }

    const callCodes:string[] = []
    for(const toolCall of calls){
        // The caller sees the same gate before it sends the follow-up, so it ends the turn; nothing more is dispatched.
        if(toolBlockGate(arg) !== 'go'){
            break
        }
        let output = 'Tool call failed with no text response'
        try{
            const parsed = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}
            const tool = arg.tools?.find((t) => t.name === toolCall.name)
            if(!tool){
                output = 'No tool found with name: ' + toolCall.name
            }
            else{
                const used = (await callTool(tool.name, parsed, {subject: arg.subject, mcpURL: tool.mcpURL, toolLoop: arg.toolLoop})).filter((m) => m.type === 'text')
                if(used.length > 0){
                    output = used[0].text
                    if(arg.rememberToolUsage){
                        callCodes.push(await encodeToolCall({
                            call: {
                                id: toolCall.call_id,
                                name: toolCall.name,
                                arg: toolCall.arguments
                            },
                            response: used
                        }))
                    }
                }
            }
        }
        catch(error){
            output = 'Tool call failed with error: ' + error
        }
        input.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output
        })
    }

    return [assistantText && !db.simplifiedToolUse ? assistantText : '', callCodes.join('\n\n')].filter(Boolean).join('\n\n')
}

// One report per HTTP response that carries usage; an unparsable usage reports nothing.
function reportResponsesUsage(arg:RequestDataArgumentExtended, rawUsage:unknown):void{
    try{
        const usage = parseResponsesUsage(rawUsage)
        if(usage){
            arg.usageMeter?.report(usage)
        }
    }
    catch{}
}

async function requestHTTPResponsesAPI(requestURL:string, body:any, headers:Record<string,string>, arg:RequestDataArgumentExtended, networkOptions:LocalNetworkRequestOptions):Promise<requestDataResponse>{
    const db = getDatabase()
    const response = await globalFetch(requestURL, {
        body: toExternalResponsesBody(body),
        headers: headers,
        chatId: arg.chatId,
        abortSignal: arg.abortSignal,
        interceptor: 'openai_response_api',
        networkRoute: networkOptions.networkRoute,
        requestTimeoutMs: networkOptions.requestTimeoutMs,
        deliverWhileFrozen: true
    })

    if(!response.ok){
        return {
            type: 'fail',
            result: (language.errors.httpError + `${JSON.stringify(response.data)}`),
            keyLimited: limitedField(arg, response.status)
        }
    }

    const data = response.data as any
    reportResponsesUsage(arg, data?.usage)
    if(data?.status === 'failed' || data?.error){
        return { type: 'fail', result: JSON.stringify(data.error ?? data) }
    }
    if(data?.status === 'incomplete'){
        const result = extractResponsesText(data, arg)
        const reason = data?.incomplete_details?.reason ? fillLang(language.errors.incompleteResponseReason, { reason: `${data.incomplete_details.reason}` }) : language.errors.incompleteResponse
        return { type: 'fail', result: result ? `${reason}\n${result}` : reason }
    }

    const calls = extractResponsesFunctionCalls(data)
    if(calls.length > 0){
        const round = beginToolRound(arg)
        if(round !== 'go'){
            return gateResult(round)
        }
        body.__lastOutput = data.output ?? []
        const assistantText = extractResponsesText(data, arg)
        const prefix = await appendResponsesToolOutputs(body, calls, arg, assistantText)
        delete body.__lastOutput

        let resRec:requestDataResponse
        let attempt = 0
        do{
            // The first attempt is also the gate before the follow-up request itself.
            if(toolBlockGate(arg) !== 'go'){
                break
            }
            attempt++
            resRec = await requestHTTPResponsesAPI(requestURL, body, headers, arg, networkOptions)
            if(resRec.type !== 'fail' || resRec.endsTurn){
                break
            }
        } while(attempt <= db.requestRetrys)

        // A Stop that landed during the last attempt, or a spent budget, must not reach the failure below.
        const afterRetries = toolBlockGate(arg)
        if(afterRetries !== 'go'){
            return gateResult(afterRetries)
        }

        if(resRec.type === 'success'){
            return { type: 'success', result: prefix ? prefix + '\n\n' + resRec.result : resRec.result }
        }
        return resRec
    }

    const result = extractResponsesText(data, arg)
    if(!result){
        const incomplete = data?.incomplete_details?.reason ? fillLang(language.errors.incompleteResponseReason, { reason: `${data.incomplete_details.reason}` }) : ''
        return { type: 'fail', result: incomplete || JSON.stringify(data) }
    }

    return { type: 'success', result }
}

function getResponsesTranStream(arg:RequestDataArgumentExtended):TransformStream<Uint8Array, StreamResponseChunk>{
    return responsesStreamTransform(responsesReadRuleOf(arg, getDatabase()), {
        subject: arg.subject,
        onUsage: (usage) => arg.usageMeter?.report(usage)
    })
}

export const __testResponsesAPI = {
    buildResponsesBody,
    buildResponsesHeaders,
    extractResponsesText,
    extractResponsesFunctionCalls,
    getResponsesRequestURL,
    getResponsesTranStream,
    sanitizeResponsesContinuationItem,
    toExternalResponsesBody
}

function wrapResponsesToolStream(stream:ReadableStream<StreamResponseChunk>, body:any, headers:Record<string,string>, requestURL:string, arg:RequestDataArgumentExtended, networkOptions:LocalNetworkRequestOptions, ownedKey?:string):ReadableStream<StreamResponseChunk>{
    return new ReadableStream<StreamResponseChunk>({
        async start(controller) {
            const db = getDatabase()
            let reader = stream.getReader()
            let prefix = ''
            let lastValue:StreamResponseChunk = { "0": '' }

            while(true){
                const { done, value } = await reader.read()
                if(!done){
                    lastValue = value
                    controller.enqueue({ "0": (prefix ? prefix + '\n\n' : '') + (value?.["0"] ?? '') })
                    continue
                }

                const calls = Object.values(JSON.parse(lastValue?.["__tool_calls"] || '{}') || {}) as ResponseFunctionCallItem[]
                if(calls.length === 0){
                    controller.close()
                    return
                }

                if(ownedKey !== undefined){
                    // Round 1's request has ended and its record is not the reply: it is removed before the follow-up.
                    await retireOwnedStream(ownedKey)
                }
                const round = beginToolRound(arg)
                if(round !== 'go'){
                    return endStreamForGate(controller, round)
                }

                body.__lastOutput = calls.map((call) => ({
                    type: 'function_call',
                    call_id: call.call_id,
                    name: call.name,
                    arguments: call.arguments,
                    status: 'completed'
                }))
                const callPrefix = await appendResponsesToolOutputs(body, calls, arg, lastValue?.["0"] ?? '')
                delete body.__lastOutput
                const blocksGate = toolBlockGate(arg)
                if(blocksGate !== 'go'){
                    return endStreamForGate(controller, blocksGate)
                }
                prefix += (prefix && callPrefix ? '\n\n' : '') + callPrefix
                if(prefix){
                    controller.enqueue({ "0": prefix })
                }

                let resRec:Response
                let attempt = 0
                let ok = false
                do{
                    // The first attempt is also the gate before the follow-up request itself.
                    if(toolBlockGate(arg) !== 'go'){
                        break
                    }
                    attempt++
                    resRec = await fetchNative(requestURL, {
                        body: JSON.stringify(toExternalResponsesBody(body)),
                        method: "POST",
                        headers: headers,
                        signal: arg.abortSignal,
                        chatId: arg.chatId,
                        interceptor: 'openai_response_api_tool',
                        networkRoute: networkOptions.networkRoute,
                        requestTimeoutMs: networkOptions.requestTimeoutMs
                    })
                    ok = resRec.status === 200 && resRec.headers.get('Content-Type')?.includes('text/event-stream')
                } while(!ok && attempt <= db.requestRetrys)

                // A Stop that landed during the last attempt, or a spent budget, must not reach the alert below.
                const afterRetries = toolBlockGate(arg)
                if(afterRetries !== 'go'){
                    return endStreamForGate(controller, afterRetries)
                }

                if(!ok){
                    alertError(`Failed to fetch model response after tool execution`)
                    controller.close()
                    return
                }

                addFetchLog({
                    body: toExternalResponsesBody(body),
                    response: "Streaming",
                    success: true,
                    url: requestURL,
                    status: resRec.status,
                })

                const transtream = getResponsesTranStream(arg)
                resRec.body.pipeTo(transtream.writable).catch(() => {})
                reader = transtream.readable.getReader()
                lastValue = { "0": '' }
            }
        }
    })
}

export async function requestOpenAIResponseAPI(arg:RequestDataArgumentExtended):Promise<requestDataResponse>{
    const db = getDatabase()
    const aiModel = arg.aiModel
    let body = await buildResponsesBody(arg)
    const { requestURL, risuIdentify } = getResponsesRequestURL(arg)
    const headers = await buildResponsesHeaders(arg, risuIdentify)

    if(aiModel === 'reverse_proxy' || aiModel?.startsWith('xcustom:::')){
        body = applyAdditionalParameters(body, headers, getAdditionalParameters(aiModel))
    }
    if(!arg.useStreaming){
        body.stream = false
    }

    const localNetworkOptions = getLocalNetworkRequestOptions(requestURL, db, false)
    const streamingLocalNetworkOptions = getLocalNetworkRequestOptions(requestURL, db, true)

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: requestURL,
                body: toExternalResponsesBody(body),
                headers: headers
            })
        }
    }

    if(arg.useStreaming){
        body.stream = true
        // One rule for the stored blob and the live read: the record is replayed exactly as this request reads it.
        const rule = responsesReadRuleOf(arg, db)
        const owned = bindOwnedStream(arg, { kind: 'openai-responses-stream', ...rule })
        // Everything up to the hand-off is covered: a throw here means the page stopped reading the owned request.
        try {
            const response = await fetchNative(requestURL, {
                body: JSON.stringify(toExternalResponsesBody(body)),
                method: "POST",
                headers: headers,
                signal: arg.abortSignal,
                chatId: arg.chatId,
                interceptor: 'openai_response_api_streaming',
                networkRoute: streamingLocalNetworkOptions.networkRoute,
                requestTimeoutMs: streamingLocalNetworkOptions.requestTimeoutMs,
                nativeReply: owned?.owner,
                pumpProbe: owned?.probe,
            })

            const failedHead = async (extra: { keyLimited?: ReturnType<typeof limitedField> }): Promise<requestDataResponse> => {
                const result = await textifyReadableStream(response.body)
                if(!owned){
                    return { type: 'fail', result, ...extra }
                }
                // The attempt is over and its record is not the reply: it is removed before any retry pushes.
                if(await retireFailedHead(owned.owner.key, owned.probe, response.status)){
                    return { type: 'fail', result, ...extra, endsTurn: true }
                }
                return { type: 'fail', result, ...extra }
            }

            if(response.status !== 200){
                return await failedHead({ keyLimited: limitedField(arg, response.status) })
            }
            if(!response.headers.get('Content-Type')?.includes('text/event-stream')){
                return await failedHead({})
            }

            addFetchLog({
                body: toExternalResponsesBody(body),
                response: "Streaming",
                success: true,
                url: requestURL,
                status: response.status,
            })

            const transtream = responsesStreamTransform(rule, {
                subject: arg.subject,
                onUsage: (usage) => arg.usageMeter?.report(usage),
            })
            response.body.pipeTo(transtream.writable).catch(() => {})
            return {
                type: 'streaming',
                result: wrapResponsesToolStream(transtream.readable, body, headers, requestURL, arg, streamingLocalNetworkOptions, owned?.owner.key)
            }
        } catch (error) {
            if(owned){
                endOwnedRead(owned.owner.key)
            }
            throw error
        }
    }

    return requestHTTPResponsesAPI(requestURL, body, headers, arg, localNetworkOptions)
}
