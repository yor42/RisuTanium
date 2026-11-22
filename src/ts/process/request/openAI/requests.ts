import { language } from "src/lang"
import { alertError, alertToast } from "src/ts/alert";
import { fillLang } from "src/lang/fill";
import { getDatabase } from "src/ts/storage/database.svelte"
import { LLMFlags, LLMFormat, LLMProvider } from "src/ts/model/modellist"
import { strongBan, tokenizeNum } from "src/ts/tokenizer"
import { getFreeOpenRouterModels } from "src/ts/model/openrouter"
import { addFetchLog, fetchNative, globalFetch, textifyReadableStream } from "src/ts/globalApi.svelte"
import { isNodeServer, isTauri } from "src/ts/platform"
import { simplifySchema } from "src/ts/util"

import { getOpenAIJSONSchema } from "../../templates/jsonSchema"
import { applyChatTemplate } from "../../templates/chatTemplate"
import { supportsInlayImage } from "../../files/inlays"
import { callTool, decodeToolCall, encodeToolCall } from "../../mcp/mcp"
import { beginToolRound, endStreamForGate, gateResult, toolBlockGate } from '../toolLoop'
import type { RequestDataArgumentExtended, requestDataResponse, StreamResponseChunk } from '../request'
import { applyAdditionalParameters, applyParameters, getAdditionalParameters } from '../shared'

import { buildUserContents } from './chatContents'
import type { OpenAIChatExtra, OpenAIChatFull, ToolCall } from './types'
import { openAIParseContextOf, parseOpenAIChatBody, processOpenAIChatText, type OpenAIChatBody } from './chatBodyParse'
import { openAIChatStreamTransform } from './chatStreamTransform'
import { bindGrant } from 'src/ts/nativeReply/grant'

import { getLocalNetworkRequestOptions, type LocalNetworkRequestOptions } from './shared'
import { leaseRequestKey, limitedField, sendArgKey, sendKeyLine } from '../secretKey'
import { parseOpenAIChatUsage } from '../../../usage/usageParse'
import { wantsStreamUsage } from '../../../usage/streamUsageHosts'
export { requestOpenAIResponseAPI, __testResponsesAPI } from './responses'
function isOfficialOpenAIURL(url: string): boolean {
    try {
        return new URL(url).hostname === 'api.openai.com'
    } catch {
        return false
    }
}

// One report per HTTP response that carries usage; a response without parsable usage reports nothing.
function reportChatUsage(arg:RequestDataArgumentExtended, data:{usage?:unknown}|null|undefined):void{
    try {
        const usage = parseOpenAIChatUsage(data?.usage)
        if(usage){
            arg.usageMeter?.report(usage)
        }
    } catch (error) {}
}

function shouldUseOpenAIFlexProcessing(aiModel: string, url: string, provider: LLMProvider): boolean {
    const isCustomEndpoint = aiModel === 'reverse_proxy' || aiModel.startsWith('xcustom:::')
    return provider === LLMProvider.OpenAI || (isCustomEndpoint && isOfficialOpenAIURL(url))
}

export async function requestOpenAI(arg:RequestDataArgumentExtended):Promise<requestDataResponse>{
    let formatedChat:OpenAIChatExtra[] = []
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel

    const processToolCalls = async (text:string, originalMessage:any) => {
        // Split text by tool_call tags and process each segment
        const segments = text.split(/(<tool_call>.*?<\/tool_call>)/gms)
        const processedMessages = []
        
        let currentContent = ''
        
        for(let i = 0; i < segments.length; i++) {
            const segment = segments[i]
            
            if(segment.match(/<tool_call>(.*?)<\/tool_call>/gms)) {
                // This is a tool call segment
                const toolCallMatch = segment.match(/<tool_call>(.*?)<\/tool_call>/s)
                if(toolCallMatch) {
                    const call = await decodeToolCall(toolCallMatch[1])
                    if(call) {
                        // Create assistant message with accumulated content and this tool call
                        processedMessages.push({
                            ...originalMessage,
                            role: 'assistant',
                            content: currentContent,
                            tool_calls: [{
                                id: call.call.id,
                                type: 'function',
                                function: {
                                    name: call.call.name,
                                    arguments: call.call.arg
                                }
                            }]
                        })

                        // Add tool response
                        const textContents: string[] = []
                        for (const m of call.response) {
                            if (m.type === 'text') {
                                textContents.push(m.text)
                            }
                        }

                        processedMessages.push({
                            role: 'tool',
                            content: textContents.join('\n'),
                            tool_call_id: call.call.id,
                            cachePoint: true
                        })

                        // Reset content for next segment
                        currentContent = ''
                    }
                }
            } else {
                // This is regular text content - accumulate it
                currentContent += segment
            }
        }
        
        // If there's remaining content without tool calls, add it as a regular message
        if(currentContent.trim()) {
            processedMessages.push({
                ...originalMessage,
                role: 'assistant',
                content: currentContent
            })
        }
        
        return processedMessages
    }
    const leftOutAttachments:string[] = []
    for(let i=0;i<formated.length;i++){
        const m = formated[i]

        // Check if message contains tool calls
        if(m.content && m.content.includes('<tool_call>')) {
            const processedMessages = await processToolCalls(m.content, m)
            formatedChat.push(...processedMessages)
        }
        else if(m.multimodals && m.multimodals.length > 0 && m.role === 'user'){
            let v:OpenAIChatExtra = safeStructuredClone(m)
            const built = buildUserContents(m.multimodals, m.content, db.gptVisionQuality, language.openAIAudioUnnamed)
            leftOutAttachments.push(...built.leftOut)
            v.content = built.contents
            formatedChat.push(v)
        }
        else{
            formatedChat.push(m)
        }
    }
    if(leftOutAttachments.length > 0){
        alertToast(fillLang(language.openAIAudioLeftOut, { names: [...new Set(leftOutAttachments)].join(', ') }))
    }

    let oobaSystemPrompts:string[] = []
    for(let i=0;i<formatedChat.length;i++){
        if(formatedChat[i].role !== 'function'){
            if(!(formatedChat[i].name && formatedChat[i].name.startsWith('example_') && db.newOAIHandle)){
                formatedChat[i].name = undefined
            }
            if(db.newOAIHandle && formatedChat[i].memo && formatedChat[i].memo.startsWith('NewChat')){
                formatedChat[i].content = ''
            }
            if(arg.modelInfo.flags.includes(LLMFlags.deepSeekPrefix) && i === formatedChat.length-1 && formatedChat[i].role === 'assistant'){
                formatedChat[i].prefix = true
            }
            if(arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingInput) && i === formatedChat.length-1 && formatedChat[i].thoughts && formatedChat[i].thoughts.length > 0 && formatedChat[i].role === 'assistant'){
                formatedChat[i].reasoning_content = formatedChat[i].thoughts.join('\n')
            }
            delete formatedChat[i].memo
            delete formatedChat[i].removable
            delete formatedChat[i].attr
            delete formatedChat[i].multimodals
            delete formatedChat[i].thoughts
            delete formatedChat[i].cachePoint
        }
        if(aiModel === 'reverse_proxy' && db.reverseProxyOobaMode && formatedChat[i].role === 'system'){
            const cont = formatedChat[i].content
            if(typeof(cont) === 'string'){
                oobaSystemPrompts.push(cont)
                formatedChat[i].content = ''
            }
        }
    }

    if(oobaSystemPrompts.length > 0){
        formatedChat.push({
            role: 'system',
            content: oobaSystemPrompts.join('\n')
        })
    }


    if(db.newOAIHandle){
        formatedChat = formatedChat.filter(m => {
            return m.content !== '' || (m.multimodals && m.multimodals.length > 0) || m.tool_calls || m.role === 'tool'
        })
    }

    for(let i=0;i<arg.biasString.length;i++){
        const bia = arg.biasString[i]
        if(bia[0].startsWith('[[') && bia[0].endsWith(']]')){
            const num = parseInt(bia[0].replace('[[', '').replace(']]', ''))
            arg.bias[num] = bia[1]
            continue
        }

        if(bia[1] === -101){
            arg.bias = await strongBan(bia[0], arg.bias)
            continue
        }
        const tokens = await tokenizeNum(bia[0])

        for(const token of tokens){
            arg.bias[token] = bia[1]

        }
    }


    let requestModel = (aiModel === 'reverse_proxy' || aiModel === 'openrouter') ? db.proxyRequestModel : aiModel
    let openrouterRequestModel = db.openrouterRequestModel
    if(aiModel === 'reverse_proxy'){
        requestModel = db.customProxyRequestModel
    }
    if(aiModel === 'nanogpt'){
        requestModel = db.nanogptRequestModel
    }

    if(aiModel === 'openrouter' && db.openrouterRequestModel === 'risu/free'){
        // The model list swallows its own failures; resolving here first reports an unusable reference as such.
        await leaseRequestKey(arg, 'openrouterKey')
        openrouterRequestModel = await getFreeOpenRouterModels()
    }

    if(arg.modelInfo.flags.includes(LLMFlags.DeveloperRole)){
        formatedChat = formatedChat.map((v) => {
            if(v.role === 'system'){
                v.role = 'developer'
            }
            return v
        })
    }

    console.log(formatedChat)
    if(arg.modelInfo.format === LLMFormat.Mistral){
        requestModel = aiModel

        let reformatedChat:OpenAIChatExtra[] = []

        for(let i=0;i<formatedChat.length;i++){
            const chat = formatedChat[i]
            if(i === 0){
                if(chat.role === 'user' || chat.role === 'system'){
                    reformatedChat.push({
                        role: chat.role,
                        content: chat.content
                    })
                }
                else{
                    reformatedChat.push({
                        role: 'system',
                        content:  chat.role + ':' + chat.content
                    })
                }
            }
            else{
                const prevChat = reformatedChat[reformatedChat.length-1]
                if(prevChat?.role === chat.role){
                    reformatedChat[reformatedChat.length-1].content += '\n' + chat.content
                    continue
                }
                else if(chat.role === 'system'){
                    if(prevChat?.role === 'user'){
                        reformatedChat[reformatedChat.length-1].content += '\nSystem:' + chat.content
                    }
                    else{
                        reformatedChat.push({
                            role: 'user',
                            content: 'System:' + chat.content
                        })
                    }
                }
                else if(chat.role === 'function'){
                    reformatedChat.push({
                        role: 'user',
                        content: chat.content
                    })
                }
                else{
                    reformatedChat.push({
                        role: chat.role,
                        content: chat.content
                    })
                }
            }
        }

        const requestURL = arg.customURL ?? "https://api.mistral.ai/v1/chat/completions"
        const networkOptions = getLocalNetworkRequestOptions(requestURL, db, false)

        const targs = {
            body: applyParameters({
                model: requestModel,
                messages: reformatedChat,
                safe_prompt: false,
                max_tokens: arg.maxTokens,
            }, ['temperature', 'presence_penalty', 'frequency_penalty', 'top_p'], {}, arg.mode, {
                modelId: arg.modelInfo.id
            } ),
            headers: {
                "Authorization": "Bearer " + (arg.key != null ? await sendArgKey(arg) : await sendKeyLine(arg, 'mistralKey')),
            },
            abortSignal: arg.abortSignal,
            chatId: arg.chatId,
            interceptor: 'mistral',
            networkRoute: networkOptions.networkRoute,
            requestTimeoutMs: networkOptions.requestTimeoutMs,
            deliverWhileFrozen: true
        } as const

        if(arg.previewBody){
            return {
                type: 'success',
                result: JSON.stringify({
                    url: requestURL,
                    body: targs.body,
                    headers: targs.headers
                })
            }
        }
    
        const res = await globalFetch(requestURL, targs)

        const dat = res.data as any
        if(res.ok){
            reportChatUsage(arg, dat)
            try {
                const msg:OpenAIChatFull = (dat.choices[0].message)
                return {
                    type: 'success',
                    result: msg.content ?? ''
                }
            } catch (error) {                    
                return {
                    type: 'fail',
                    result: (language.errors.httpError + `${JSON.stringify(dat)}`)
                }
            }
        }
        else{
            if(dat.error && dat.error.message){                    
                return {
                    type: 'fail',
                    result: (language.errors.httpError + `${dat.error.message}`),
                    keyLimited: limitedField(arg, res.status)
                }
            }
            else{
                return {
                    type: 'fail',
                    result: (language.errors.httpError + `${JSON.stringify(res.data)}`),
                    keyLimited: limitedField(arg, res.status)
                }
            }
        }
    }

    db.cipherChat = false
    let body:{
        [key:string]:any
    } = ({
        model: aiModel === 'nanogpt' ? db.nanogptRequestModel :
            aiModel === 'openrouter' ? openrouterRequestModel :
            requestModel ===  'gpt35' ? 'gpt-3.5-turbo'
            : requestModel ===  'gpt35_0613' ? 'gpt-3.5-turbo-0613'
            : requestModel ===  'gpt35_16k' ? 'gpt-3.5-turbo-16k'
            : requestModel ===  'gpt35_16k_0613' ? 'gpt-3.5-turbo-16k-0613'
            : requestModel === 'gpt4' ? 'gpt-4'
            : requestModel === 'gpt45' ? 'gpt-4.5-preview'
            : requestModel === 'gpt4_32k' ? 'gpt-4-32k'
            : requestModel === "gpt4_0613" ? 'gpt-4-0613'
            : requestModel === "gpt4_32k_0613" ? 'gpt-4-32k-0613'
            : requestModel === "gpt4_1106" ? 'gpt-4-1106-preview'
            : requestModel === 'gpt4_0125' ? 'gpt-4-0125-preview'
            : requestModel === "gptvi4_1106" ? 'gpt-4-vision-preview'
            : requestModel === "gpt35_0125" ? 'gpt-3.5-turbo-0125'
            : requestModel === "gpt35_1106" ? 'gpt-3.5-turbo-1106'
            : requestModel === 'gpt35_0301' ? 'gpt-3.5-turbo-0301'
            : requestModel === 'gpt4_0314' ? 'gpt-4-0314'
            : requestModel === 'gpt4_turbo_20240409' ? 'gpt-4-turbo-2024-04-09'
            : requestModel === 'gpt4_turbo' ? 'gpt-4-turbo'
            : requestModel === 'gpt4o' ? 'gpt-4o'
            : requestModel === 'gpt4o-2024-05-13' ? 'gpt-4o-2024-05-13'
            : requestModel === 'gpt4om' ? 'gpt-4o-mini'
            : requestModel === 'gpt4om-2024-07-18' ? 'gpt-4o-mini-2024-07-18'
            : requestModel === 'gpt4o-2024-08-06' ? 'gpt-4o-2024-08-06'
            : requestModel === 'gpt4o-2024-11-20' ? 'gpt-4o-2024-11-20'
            : requestModel === 'gpt4o-chatgpt' ? 'chatgpt-4o-latest'
            : requestModel === 'gpt4o1-preview' ? 'o1-preview'
            : requestModel === 'gpt4o1-mini' ? 'o1-mini'
            : arg.modelInfo.internalID ? arg.modelInfo.internalID
            : (!requestModel) ? 'gpt-3.5-turbo'
            : requestModel,
        messages: formatedChat,
        max_tokens: arg.maxTokens,
        logit_bias: arg.bias,
        stream: false,

    })


    if(Object.keys(body.logit_bias).length === 0){
        delete body.logit_bias
    }

    if(arg.modelInfo.flags.includes(LLMFlags.OAICompletionTokens)){
        body.max_completion_tokens = body.max_tokens
        delete body.max_tokens
    }

    if(db.generationSeed > 0){
        body.seed = db.generationSeed
    }

    if((db.jsonSchemaEnabled || arg.schema) && !arg.noJsonSchema && !arg.modelInfo.flags.includes(LLMFlags.noStructuredOutput)){
        body.response_format = {
            "type": "json_schema",
            "json_schema": getOpenAIJSONSchema(arg.schema, {subject: arg.subject})
        }
    }

    if(db.OAIPrediction){
        body.prediction = {
            type: "content",
            content: db.OAIPrediction
        }
    }

    if(aiModel === 'openrouter'){
        if(db.openrouterFallback){
            body.route = "fallback"
        }
        body.transforms = db.openrouterMiddleOut ? ['middle-out'] : []

        if(db.openrouterProvider){
            const provider: typeof db.openrouterProvider = {} as typeof db.openrouterProvider;
            if (db.openrouterProvider.order?.length) {
                provider.order = db.openrouterProvider.order;
            }
            if (db.openrouterProvider.only?.length) {
                provider.only = db.openrouterProvider.only;
            }
            if (db.openrouterProvider.ignore?.length) {
                provider.ignore = db.openrouterProvider.ignore;
            }
            if (Object.keys(provider).length) {
                body.provider = provider;
            }
        }

        if(db.useInstructPrompt){
            delete body.messages
            const prompt = applyChatTemplate(formated, { subject: arg.subject })
            body.prompt = prompt
        }
    }

    body = applyParameters(
        body,
        arg.modelInfo.parameters,
        {},
        arg.mode,
        {
            modelId: arg.modelInfo.id,
            temperature: arg.temperatureOverride
        }
    )

    if(arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingToggle)){
        if(db.deepseekThinkingType === 'enabled'){
            body.thinking = {
                type: 'enabled',
                reasoning_effort: db.deepseekReasoningEffort ?? 'high'
            }
            delete body.temperature
            delete body.top_p
            delete body.frequency_penalty
            delete body.presence_penalty
        }
        else{
            body.thinking = { type: 'disabled' }
        }
    }

    if(arg.tools && arg.tools.length > 0){
        body.tools = arg.tools.map(tool => {
            return {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: simplifySchema(tool.inputSchema),
                }
            }
        })
    }

    if(aiModel === 'reverse_proxy' && db.reverseProxyOobaMode){
        const OobaBodyTemplate = db.reverseProxyOobaArgs

        const keys = Object.keys(OobaBodyTemplate)
        for(const key of keys){
            if(OobaBodyTemplate[key] !== undefined && OobaBodyTemplate[key] !== null){
                body[key] = OobaBodyTemplate[key]
            }
        }

    }

    if(supportsInlayImage()){
        // inlay models doesn't support logit_bias
        // OpenAI's gpt based llm model supports both logit_bias and inlay image
        if(!(
            aiModel.startsWith('gpt') || 
            (aiModel == 'reverse_proxy' && (
                db.proxyRequestModel?.startsWith('gpt') ||
                (db.proxyRequestModel === 'custom' && db.customProxyRequestModel.startsWith('gpt'))
            )))){
            delete body.logit_bias
        }
    }

    let replacerURL = aiModel === 'nanogpt' ? (db.nanogptUseSubscriptionEndpoint ? 'https://nano-gpt.com/api/subscription/v1/chat/completions' : 'https://nano-gpt.com/api/v1/chat/completions') :
        aiModel === 'openrouter' ? "https://openrouter.ai/api/v1/chat/completions" :
        (arg.customURL) ?? ('https://api.openai.com/v1/chat/completions')

    if(arg.modelInfo?.endpoint){
        replacerURL = arg.modelInfo.endpoint
    }

    let risuIdentify = false
    if(replacerURL.startsWith("risu::")){
        risuIdentify = true
        replacerURL = replacerURL.replace("risu::", '')
    }

    if(aiModel === 'reverse_proxy' && db.autofillRequestUrl){
        if(replacerURL.endsWith('v1')){
            replacerURL += '/chat/completions'
        }
        else if(replacerURL.endsWith('v1/')){
            replacerURL += 'chat/completions'
        }
        else if(!(replacerURL.endsWith('completions') || replacerURL.endsWith('completions/'))){
            if(replacerURL.endsWith('/')){
                replacerURL += 'v1/chat/completions'
            }
            else{
                replacerURL += '/v1/chat/completions'
            }
        }
    }

    if(db.openAIFlexProcessing && shouldUseOpenAIFlexProcessing(aiModel, replacerURL, arg.modelInfo.provider)){
        body.service_tier = 'flex'
    }

    // The field is chosen first and only the chosen one is resolved, so an unset reference in a
    // field this model does not use cannot fail the request.
    const chosenKey = arg.modelInfo?.keyIdentifier
        ? await sendKeyLine(arg, `OaiCompAPIKeys:${arg.modelInfo.keyIdentifier}`)
        : (arg.key != null
            ? await sendArgKey(arg)
            : await sendKeyLine(arg, aiModel === 'nanogpt' ? 'nanogptKey' : aiModel === 'reverse_proxy' ?  'proxyKey' : (aiModel === 'openrouter' ? 'openrouterKey' : 'openAIKey')))
    let headers = {
        "Authorization": "Bearer " + chosenKey,
        "Content-Type": "application/json"
    }
    if(aiModel === 'openrouter'){
        headers["X-Title"] = 'RisuAI'
        headers["HTTP-Referer"] = 'https://risuai.xyz'
    }
    if(aiModel === 'nanogpt' && db.nanogptProvider){
        headers["X-Provider"] = db.nanogptProvider
    }
    if(risuIdentify){
        headers["X-Proxy-Risu"] = 'RisuAI'
    }
    if(arg.multiGen){
        // Check if tools are enabled - multiGen with tools is not supported
        if(arg.tools && arg.tools.length > 0){
            return {
                type: 'fail',
                result: language.errors.multiGenWithTools
            }
        }
        body.n = db.genTime
    }
    
    // Set before the additional parameters, so a user parameter overrides it.
    if(arg.useStreaming && wantsStreamUsage(replacerURL)){
        body.stream_options = { include_usage: true }
    }
    body = applyAdditionalParameters(body, headers, getAdditionalParameters(aiModel))

    // Some aux flows are intentionally non-streaming (e.g. memory/translate).
    // If custom Additional Parameters contains stream=true, force non-stream mode back.
    if(!arg.useStreaming){
        body.stream = false
    }

    const localNetworkOptions = getLocalNetworkRequestOptions(replacerURL, db, false)
    const streamingLocalNetworkOptions = getLocalNetworkRequestOptions(replacerURL, db, true)

    if(arg.useStreaming){
        body.stream = true
        let urlHost = new URL(replacerURL).host
        if(urlHost.includes("localhost") || urlHost.includes("172.0.0.1") || urlHost.includes("0.0.0.0")){
            if(!isTauri && !isNodeServer){
                return {
                    type: 'fail',
                    result: language.errors.localStreamingBlocked,
                }
            }
        }

        if(arg.previewBody){
            return {
                type: 'success',
                result: JSON.stringify({
                    url: replacerURL,
                    body: body,
                    headers: headers
                })
            }
        }
        const da = await fetchNative(replacerURL, {
            body: JSON.stringify(body),
            method: "POST",
            headers: headers,
            signal: arg.abortSignal,
            chatId: arg.chatId,
            interceptor: 'openai_streaming',
            networkRoute: streamingLocalNetworkOptions.networkRoute,
            requestTimeoutMs: streamingLocalNetworkOptions.requestTimeoutMs
        })

        if(da.status !== 200){
            return {
                type: "fail",
                result: await textifyReadableStream(da.body),
                keyLimited: limitedField(arg, da.status)
            }
        }

        if (!da.headers.get('Content-Type').includes('text/event-stream')){
            return {
                type: "fail",
                result: await textifyReadableStream(da.body)
            }
        }

        addFetchLog({
            body: body,
            response: "Streaming",
            success: true,
            url: replacerURL,
            status: da.status,
        })

        const transtream = getTranStream(arg)

        da.body.pipeTo(transtream.writable).catch(() => {})

        return {
            type: 'streaming',
            result: wrapToolStream(transtream.readable, body, headers, replacerURL, arg, streamingLocalNetworkOptions)
        }
    }

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: replacerURL,
                body: body,
                headers: headers
            })
        }
    }

    return requestHTTPOpenAI(replacerURL, body, headers, arg, localNetworkOptions)

}

export async function requestHTTPOpenAI(
    replacerURL:string,
    body:any,
    headers:Record<string,string>,
    arg:RequestDataArgumentExtended,
    networkOptions: LocalNetworkRequestOptions = {}
):Promise<requestDataResponse>{
    
    const db = getDatabase()
    const parseContext = openAIParseContextOf(arg, db)
    // An owned request keeps its reply in a record the next launch can read; a body preview sends nothing.
    const nativeReply = arg.previewBody ? null : bindGrant(arg.nativeReplyGrant, parseContext)
    const res = await globalFetch(replacerURL, {
        body: body,
        headers: headers,
        abortSignal: arg.abortSignal,
        chatId: arg.chatId,
        interceptor: 'openai_basic',
        networkRoute: networkOptions.networkRoute,
        requestTimeoutMs: networkOptions.requestTimeoutMs,
        deliverWhileFrozen: true,
        nativeReply,
    })

    function processTextResponse(dat: OpenAIChatBody):string{
        return processOpenAIChatText(dat, parseContext, arg.subject)
    }

    const dat = res.data as any

    // An announced failure ends the turn: the reply's own record has told the person already.
    if(res.nativeFinal && !res.ok){
        return {
            type: 'fail',
            result: (language.errors.httpError + `${dat?.error?.message ?? JSON.stringify(res.data)}`),
            endsTurn: true,
        }
    }

    if(res.ok){
        reportChatUsage(arg, dat)
        try {
            // Collect all tool_calls from all choices
            let allToolCalls: ToolCall[] = []
            if(dat.choices) {
                for(const choice of dat.choices) {
                    if(choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
                        allToolCalls = allToolCalls.concat(choice.message.tool_calls)
                    }
                }
            }
            
            // Replace choices[0].message.tool_calls with all collected tool calls
            if(dat.choices?.[0]?.message && allToolCalls.length > 0) {
                dat.choices[0].message.tool_calls = allToolCalls
            }

            if(dat.choices?.[0]?.message?.tool_calls && dat.choices[0].message.tool_calls.length > 0){
                const toolCalls = dat.choices[0].message.tool_calls as ToolCall[]

                const round = beginToolRound(arg)
                if(round !== 'go'){
                    return gateResult(round)
                }

                const messages = body.messages as OpenAIChatExtra[]

                messages.push(dat.choices[0].message)

                // Remove the last message content if simplifiedToolUse is enabled
                if(db.simplifiedToolUse && messages[messages.length - 1].content) {
                    messages[messages.length - 1].content = ''
                }
                
                const callCodes: string[] = []

                for(const toolCall of toolCalls){
                    const blockGate = toolBlockGate(arg)
                    if(blockGate !== 'go'){
                        return gateResult(blockGate)
                    }
                    if(!toolCall.function || !toolCall.function.name || toolCall.function.arguments === undefined || toolCall.function.arguments === null){
                        continue
                    }
                    try {
                        const functionArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}
                        if(arg.tools && arg.tools.length > 0){
                            const tool = arg.tools.find(t => t.name === toolCall.function.name)
                            if(!tool){
                                messages.push({
                                    role:'tool',
                                    content: 'No tool found with name: ' + toolCall.function.name,
                                    tool_call_id: toolCall.id
                                })
                            }
                            else{
                                const parsed = functionArgs
                                const x = (await callTool(tool.name, parsed, {subject: arg.subject, mcpURL: tool.mcpURL, toolLoop: arg.toolLoop})).filter(m => m.type === 'text')
                                if(x.length > 0){
                                    messages.push({
                                        role: 'tool',
                                        content: x[0].text,
                                        tool_call_id: toolCall.id
                                    })
                                    if(arg.rememberToolUsage){
                                        callCodes.push(await encodeToolCall({
                                            call: {
                                                id: toolCall.id,
                                                name: toolCall.function.name,
                                                arg: toolCall.function.arguments
                                            },
                                            response: x
                                        }))
                                    }
                                }
                                else{
                                    messages.push({
                                        role: 'tool',
                                        content: 'Tool call failed with no text response',
                                        tool_call_id: toolCall.id
                                    })
                                }
                            }
                        }
                    } catch (error) {
                        messages.push({
                            role: 'tool',
                            content: 'Tool call failed with error: ' + error,
                            tool_call_id: toolCall.id
                        })
                    }
                }                
                
                body.messages = messages

                // Send the next request recursively
                let resRec
                let attempt = 0
                
                do {
                    // The first attempt is also the gate before the follow-up request itself.
                    if (toolBlockGate(arg) !== 'go') {
                        break
                    }
                    attempt++
                    resRec = await requestHTTPOpenAI(replacerURL, body, headers, arg, networkOptions)

                    if (resRec.type != 'fail' || resRec.endsTurn) {
                        break
                    }
                } while (attempt <= db.requestRetrys) // Retry up to db.requestRetrys times

                // A Stop that landed during the last attempt, or a spent budget, must not reach the alert below.
                const afterRetries = toolBlockGate(arg)
                if(afterRetries !== 'go'){
                    return gateResult(afterRetries)
                }
                if(resRec.type === 'fail' && resRec.endsTurn){
                    return resRec
                }

                const callCode = callCodes.join('\n\n')

                // Combine the tool call results with the main response (does not include text response if simplifiedToolUse is enabled)
                const result = (db.simplifiedToolUse ? '' : (processTextResponse(dat) ?? '') + '\n\n') + callCode
                        
                if(resRec.type === 'fail') {
                    alertError(`Failed to fetch model response after tool execution`)
                    return {
                        type: 'success',
                        result: result
                    }
                } else if(resRec.type === 'success') {
                    return {
                        type: 'success',
                        result: result + '\n\n' + resRec.result
                    }
                }
                        
                return resRec
            }
                    
            return parseOpenAIChatBody(dat, parseContext, arg.subject)

        } catch (error) {                    
            return {
                type: 'fail',
                result: (language.errors.httpError + `${JSON.stringify(dat)}`)
            }
        }
    }
    
    if(dat.error && dat.error.message){
        return {
            type: 'fail',
            result: (language.errors.httpError + `${dat.error.message}`),
            keyLimited: limitedField(arg, res.status)
        }
    }

    return {
        type: 'fail',
        keyLimited: limitedField(arg, res.status),
        result: (language.errors.httpError + `${JSON.stringify(res.data)}`)
    }
}

export async function requestOpenAILegacyInstruct(arg:RequestDataArgumentExtended):Promise<requestDataResponse>{
    const formated = arg.formated
    const db = getDatabase()
    const maxTokens = arg.maxTokens
    const temperature = arg.temperature
    const prompt = formated.filter(m => m.content?.trim()).map(m => {
        let author = '';

        if(m.role == 'system'){
            m.content = m.content.trim();
        }

        console.log(m.role +":"+m.content);
        switch (m.role) {
            case 'user': author = 'User'; break;
            case 'assistant': author = 'Assistant'; break;
            case 'system': author = 'Instruction'; break;
            default: author = m.role; break;
        }

        return `\n## ${author}\n${m.content.trim()}`;
        //return `\n\n${author}: ${m.content.trim()}`;
    }).join("") + `\n## Response\n`;

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                error: "This model is not supported in preview mode"
            })
        }
    }

    let body:any = {
        model: "gpt-3.5-turbo-instruct",
        prompt: prompt,
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: 1,
        stop:["User:"," User:", "user:", " user:"],
        presence_penalty: arg.PresensePenalty || (db.PresensePenalty / 100),
        frequency_penalty: arg.frequencyPenalty || (db.frequencyPenalty / 100),
    }

    let headers:any = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + (arg.key != null ? await sendArgKey(arg) : await sendKeyLine(arg, 'openAIKey'))
    }

    body = applyAdditionalParameters(body, headers, getAdditionalParameters(arg.aiModel))

    const response = await globalFetch(arg.customURL ?? "https://api.openai.com/v1/completions", {
        body: body,
        headers: headers,
        chatId: arg.chatId,
        abortSignal: arg.abortSignal,
        deliverWhileFrozen: true
    });

    if(!response.ok){
        return {
            type: 'fail',
            result: (language.errors.httpError + `${JSON.stringify(response.data)}`),
            keyLimited: limitedField(arg, response.status)
        }
    }
    const text:string = response.data.choices[0].text
    return {
        type: 'success',
        result: text.replace(/##\n/g, '')
    }
    
}

// The live read of a stream: the shared transform with the rule and the io this request holds. A replay of a recovered
// record calls `openAIChatStreamTransform` with the rule stored in its blob instead.
function getTranStream(arg:RequestDataArgumentExtended):TransformStream<Uint8Array, StreamResponseChunk> {
    return openAIChatStreamTransform(openAIParseContextOf(arg, getDatabase()), {
        subject: arg.subject,
        onUsage: (usage) => arg.usageMeter?.report(usage),
    })
}

export const __testOpenAIChatStream = { getTranStream }

function wrapToolStream(
    stream: ReadableStream<StreamResponseChunk>,
    body:any,
    headers:Record<string,string>,
    replacerURL:string,
    arg:RequestDataArgumentExtended,
    networkOptions: LocalNetworkRequestOptions = {}
):ReadableStream<StreamResponseChunk> {
    return new ReadableStream<StreamResponseChunk>({
        async start(controller) {

            const db = getDatabase()
            let reader = stream.getReader()
            let prefix = ''
            let lastValue

            const extractThoughts = (text:string) => {
                let reasoningContent = ''
                const content = text.replace(/<Thoughts>\n?([\s\S]*?)\n?<\/Thoughts>\n*/g, (_, p1:string) => {
                    reasoningContent += (reasoningContent ? '\n' : '') + p1
                    return ''
                })
                return {
                    content,
                    reasoningContent
                }
            }

            while(true){
                let {done, value} = await reader.read()

                let content = value?.['0'] || ''
                if(done){
                    value = lastValue ?? {'0': ''}
                    content = value?.['0'] || ''
                    
                    const toolCalls = Object.values(JSON.parse(value?.['__tool_calls'] || '{}') || {}) as ToolCall[]; 
                    if(toolCalls && toolCalls.length > 0){
                        const round = beginToolRound(arg)
                        if(round !== 'go'){
                            return endStreamForGate(controller, round)
                        }
                        const messages = body.messages as OpenAIChatExtra[]
                        let assistantContent = content
                        let assistantReasoningContent = ''
                        const shouldPassDeepSeekReasoning = arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingInput) ||
                            (arg.modelInfo.flags.includes(LLMFlags.deepSeekThinkingToggle) && db.deepseekThinkingType === 'enabled')

                        if(shouldPassDeepSeekReasoning){
                            const extracted = extractThoughts(content)
                            assistantContent = extracted.content
                            assistantReasoningContent = extracted.reasoningContent
                        }

                        const assistantMessage: OpenAIChatExtra = {
                            role: 'assistant',
                            content: (db.simplifiedToolUse ? '' : assistantContent),
                            tool_calls: toolCalls.map(call => ({
                                id: call.id,
                                type: 'function',
                                function: {
                                    name: call.function.name,
                                    arguments: call.function.arguments
                                }
                            }))
                        }
                        if(assistantReasoningContent){
                            assistantMessage.reasoning_content = assistantReasoningContent
                        }

                        messages.push(assistantMessage)

                        const callCodes: string[] = []
                    
                        for(const toolCall of toolCalls){
                            const blockGate = toolBlockGate(arg)
                            if(blockGate !== 'go'){
                                return endStreamForGate(controller, blockGate)
                            }
                            if(!toolCall.function || !toolCall.function.name || !toolCall.function.arguments){
                                continue
                            }
                            try {
                                const functionArgs = JSON.parse(toolCall.function.arguments)
                                if(arg.tools && arg.tools.length > 0){
                                    const tool = arg.tools.find(t => t.name === toolCall.function.name)
                                    if(!tool){
                                        messages.push({
                                            role:'tool',
                                            content: 'No tool found with name: ' + toolCall.function.name,
                                            tool_call_id: toolCall.id
                                        })
                                    }
                                    else{
                                        const parsed = functionArgs
                                        const x = (await callTool(tool.name, parsed, {subject: arg.subject, mcpURL: tool.mcpURL, toolLoop: arg.toolLoop})).filter(m => m.type === 'text')
                                        if(x.length > 0){
                                            messages.push({
                                                role: 'tool',
                                                content: x[0].text,
                                                tool_call_id: toolCall.id
                                            })
                                            if(arg.rememberToolUsage){
                                                callCodes.push(await encodeToolCall({
                                                    call: {
                                                        id: toolCall.id,
                                                        name: toolCall.function.name,
                                                        arg: toolCall.function.arguments
                                                    },
                                                    response: x
                                                }))
                                            }
                                        }
                                        else{
                                            messages.push({
                                                role: 'tool',
                                                content: 'Tool call failed with no text response',
                                                tool_call_id: toolCall.id
                                            })
                                        }
                                    }
                                }
                            } catch (error) {
                                messages.push({
                                    role: 'tool',
                                    content: 'Tool call failed with error: ' + error,
                                    tool_call_id: toolCall.id
                                })
                            }
                        }    
                        
                        body.messages = messages
                        
                        let resRec
                        let attempt = 0
                        let errorFlag = true
                        
                        do {
                            // The first attempt is also the gate before the follow-up request itself.
                            if(toolBlockGate(arg) !== 'go'){
                                break
                            }
                            attempt++
                            resRec = await fetchNative(replacerURL, {
                                body: JSON.stringify(body),
                                method: "POST",
                                headers: headers,
                                signal: arg.abortSignal,
                                chatId: arg.chatId,
                                interceptor: 'openai_tool',
                                networkRoute: networkOptions.networkRoute,
                                requestTimeoutMs: networkOptions.requestTimeoutMs
                            })
                            
                            if(resRec.status == 200 && resRec.headers.get('Content-Type').includes('text/event-stream')) {
                                addFetchLog({
                                    body: body,
                                    response: "Streaming",
                                    success: true,
                                    url: replacerURL,
                                    status: resRec.status,
                                })

                                errorFlag = false
                                break
                            }     
                        } while (attempt <= db.requestRetrys) // Retry up to db.requestRetrys times

                        // A Stop that landed during the last attempt, or a spent budget, must not reach the alert below.
                        const afterRetries = toolBlockGate(arg)
                        if(afterRetries !== 'go'){
                            return endStreamForGate(controller, afterRetries)
                        }

                        if(errorFlag){
                            alertError(`Failed to fetch model response after tool execution`)
                            return controller.close()
                        }

                        const transtream = getTranStream(arg)                    
                        resRec.body.pipeTo(transtream.writable).catch(() => {})
                        
                        reader = transtream.readable.getReader()
                        // A follow-up stream that yields no chunk must end the reply, not replay this round's calls.
                        lastValue = undefined

                        prefix += (content && !db.simplifiedToolUse ? content + '\n\n' : '') + callCodes.join('\n\n')
                        controller.enqueue({"0": prefix})

                        continue
                    }
                    return controller.close()
                }
                
                lastValue = value

                // Every generation key goes on: the consumer turns each into a reroll candidate. Only
                // generation 0 carries the tool-round prefix, since tool rounds read generation 0 alone.
                const chunk:StreamResponseChunk = {"0": (prefix ? prefix + '\n\n' : '') + content}
                for(const key in value){
                    if(key !== '0' && /^\d+$/.test(key)){
                        chunk[key] = value[key]
                    }
                }
                controller.enqueue(chunk)
            }
        }
    })
}
