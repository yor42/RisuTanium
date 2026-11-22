import { Sha256 } from "@aws-crypto/sha256-js"
import { HttpRequest } from "@smithy/protocol-http"
import { SignatureV4 } from "@smithy/signature-v4"
import { addFetchLog, fetchNative, globalFetch, textifyReadableStream } from "src/ts/globalApi.svelte"
import { LLMFlags, LLMFormat } from "src/ts/model/modellist"
import { resolveClaudeThinkingType } from "src/ts/model/types"
import { registerClaudeObserver } from "src/ts/observer.svelte"
import { getDatabase } from "src/ts/storage/database.svelte"
import { replaceAsync, simplifySchema, sleep } from "src/ts/util"
import { v4 } from "uuid"
import { language } from "src/lang"
import type { MultiModal } from "../index.svelte"
import { extractJSON } from "../templates/jsonSchema"
import { callTool, decodeToolCall, encodeToolCall } from "../mcp/mcp"
import type { RPCToolCallContent } from "../mcp/mcplib"
import type { RequestDataArgumentExtended, requestDataResponse, StreamResponseChunk } from './request'
import { abortedResult, beginToolRound, gateResult, refusedToolContent, runAborted, toolBlockGate } from './toolLoop'
import { applyAdditionalParameters, applyParameters, getAdditionalParameters } from './shared'
import { limitedField, sendArgKey, sendKeyLine } from './secretKey'
import { isSecretRef } from 'src/ts/secretRef'
import { parseAnthropicUsage } from '../../usage/usageParse'
import { createAnthropicStreamReader } from './anthropicStreamRead'
import { bindOwnedStream, endOwnedRead, retireFailedHead, retireOwnedStream } from 'src/ts/nativeReply/ownedStream'
import { takeAnnounced } from 'src/ts/nativeReply/pageState'

interface Claude3TextBlock {
    type: 'text',
    text: string,
    cache_control?: {
        "type": "ephemeral",
        "ttl"?: "5m" | "1h"
    }
}

interface Claude3ImageBlock {
    type: 'image',
    source: {
        type: 'base64'
        media_type: string,
        data: string
    }
    cache_control?: {
        "type": "ephemeral"
        "ttl"?: "5m" | "1h"
    }
}

interface Claude3ToolUseBlock {
    "type": "tool_use",
    "id": string,
    "name": string,
    "input": any,
    cache_control?: {
        "type": "ephemeral"
        "ttl"?: "5m" | "1h"
    }
}

interface Claude3ToolResponseBlock {
    type: "tool_result",
    tool_use_id: string
    content: Claude3ContentBlock[]
    cache_control?: {
        "type": "ephemeral"
        "ttl"?: "5m" | "1h"
    }
}

type Claude3ContentBlock = Claude3TextBlock|Claude3ImageBlock|Claude3ToolUseBlock|Claude3ToolResponseBlock

interface Claude3Chat {
    role: 'user'|'assistant'
    content: Claude3ContentBlock[]
}

interface Claude3ExtendedChat {
    role: 'user'|'assistant'
    content: Claude3ContentBlock[]|string
}

export async function requestClaude(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const formated = arg.formated
    const db = getDatabase()
    const aiModel = arg.aiModel
    const useStreaming = arg.useStreaming
    const ollamaCloudAnthropic = aiModel === 'ollama-cloud'
    let replacerURL = arg.customURL ?? ('https://api.anthropic.com/v1/messages')
    // One line of the field, resolved whole: a Bedrock key line is the AKID:SECRET:region triple and is split after resolution.
    let apiKey = arg.key
        ? await sendArgKey(arg)
        : await sendKeyLine(arg, (aiModel === 'reverse_proxy') ? 'proxyKey' : 'claudeAPIKey')
    const maxTokens = arg.maxTokens
    if(aiModel === 'reverse_proxy' && db.autofillRequestUrl){
        if(replacerURL.endsWith('v1')){
            replacerURL += '/messages'
        }
        else if(replacerURL.endsWith('v1/')){
            replacerURL += 'messages'
        }
        else if(!(replacerURL.endsWith('messages') || replacerURL.endsWith('messages/'))){
            if(replacerURL.endsWith('/')){
                replacerURL += 'v1/messages'
            }
            else{
                replacerURL += '/v1/messages'
            }
        }
    }

    let claudeChat: Claude3Chat[] = []
    let systemPrompt:string = ''

    const addClaudeChat = (chat:{
        role: 'user'|'assistant'
        content: string,
        cache: boolean
    }, multimodals?:MultiModal[]) => {
        if(claudeChat.length > 0 && claudeChat[claudeChat.length-1].role === chat.role){
            let content = claudeChat[claudeChat.length-1].content
            if(multimodals && multimodals.length > 0 && !Array.isArray(content)){
                content = [{    
                    type: 'text',
                    text: content
                }]
            }

            if(Array.isArray(content)){
                let lastContent = content[content.length-1]
                if( lastContent?.type === 'text'){
                    lastContent.text += "\n\n" + chat.content
                    content[content.length-1] = lastContent
                }
                else{
                    content.push({
                        type: 'text',
                        text: chat.content
                    })
                }

                if(multimodals && multimodals.length > 0){
                    for(const modal of multimodals){
                        if(modal.type === 'image'){
                            const dataurl = modal.base64
                            const base64 = dataurl.split(',')[1]
                            const mediaType = dataurl.split(';')[0].split(':')[1]

                            content.unshift({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: mediaType,
                                    data: base64
                                }
                            })
                        }
                    }
                }
            }
            if(chat.cache){

                if(db.claude1HourCaching){
                    content[content.length-1].cache_control = {
                        type: 'ephemeral',
                        ttl: "1h"
                    }
                }
                else{
                    content[content.length-1].cache_control = {
                        type: 'ephemeral'
                    }
                }
            }
            claudeChat[claudeChat.length-1].content = content
        }
        else{
            let formatedChat:Claude3Chat = {
                role: chat.role,
                content: [{
                    type: 'text',
                    text: chat.content
                }]
            }
            if(multimodals && multimodals.length > 0){
                formatedChat.content = [{
                    type: 'text',
                    text: chat.content
                }]
                for(const modal of multimodals){
                    if(modal.type === 'image'){
                        const dataurl = modal.base64
                        const base64 = dataurl.split(',')[1]
                        const mediaType = dataurl.split(';')[0].split(':')[1]

                        formatedChat.content.unshift({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64
                            }
                        })
                    }
                }

            }
            if(chat.cache){
                if(db.claude1HourCaching){
                    formatedChat.content[0].cache_control = {
                        type: 'ephemeral',
                        ttl: "1h"
                    }
                }
                else{
                    formatedChat.content[0].cache_control = {
                        type: 'ephemeral'
                    }
                }
            }
            claudeChat.push(formatedChat)
        }
    }
    for(const chat of formated){
        switch(chat.role){
            case 'user':{
                addClaudeChat({
                    role: 'user',
                    content: chat.content,
                    cache: chat.cachePoint
                }, chat.multimodals)
                break
            }
            case 'assistant':{
                addClaudeChat({
                    role: 'assistant',
                    content: chat.content,
                    cache: chat.cachePoint
                }, chat.multimodals)
                break
            }
            case 'system':{
                if(claudeChat.length === 0){
                    systemPrompt += '\n\n' + chat.content
                }
                else{
                    addClaudeChat({
                        role: 'user',
                        content: "System: " + chat.content,
                        cache: chat.cachePoint
                    })
                }
                break
            }
            case 'function':{
                //ignore function for now
                break
            }
        }
    }
    if(claudeChat.length === 0 && systemPrompt === ''){
        return {
            type: 'fail',
            result: language.errors.claudeNoInput
        }
    }
    if(claudeChat.length === 0 && systemPrompt !== ''){
        claudeChat.push({
            role: 'user',
            content: [{
                type: 'text',
                text: 'Start'
            }]
        })
        systemPrompt = ''
    }
    if(claudeChat[0].role !== 'user'){
        claudeChat.unshift({
            role: 'user',
            content: [{
                type: 'text',
                text: 'Start'
            }]
        })
    }

    //check for tool calls
    for(let j=0;j<claudeChat.length;j++){
        let chat = claudeChat[j]
        for(let i=0;i<chat.content.length;i++){
            let content = chat.content[i]
            if(content.type === 'text'){
                content.text = await replaceAsync(content.text,/<tool_call>(.*?)<\/tool_call>/g, async (match:string, p1:string) => {
                    try {
                        const parsed = await decodeToolCall(p1)
                        if(parsed?.call && parsed?.response){
                            const toolUse:Claude3ToolUseBlock = {
                                type: 'tool_use',
                                id: parsed.call.id,
                                name: parsed.call.name,
                                input: parsed.call.arg
                            }
                            const toolResponse:Claude3ToolResponseBlock = {
                                type: 'tool_result',
                                tool_use_id: parsed.call.id,
                                content: parsed.response.map((v:any) => {
                                    if(v.type === 'text'){
                                        return {
                                            type: 'text',
                                            text: v.text
                                        }
                                    }
                                    if(v.type === 'image'){
                                        return {
                                            type: 'image',
                                            source: {
                                                type: 'base64',
                                                media_type: v.mimeType,
                                                data: v.data
                                            }
                                        }
                                    }
                                    return {
                                        type: 'text',
                                        text: `Unsupported tool response type: ${v.type}`
                                    }
                                })
                            }
                            claudeChat.splice(j, 0, {
                                role: 'assistant',
                                content: [toolUse]
                            })

                            claudeChat.splice(j+1, 0, {
                                role: 'user',
                                content: [toolResponse]
                            })
                            j+=2
                            chat = claudeChat[j]
                            return ''
                        }
                    } catch (error) {
                        
                    }

                    return ''
                })
            }
        }
    }

    let finalChat:Claude3ExtendedChat[] = claudeChat

    if(aiModel === 'reverse_proxy'){
        finalChat = claudeChat.map((v) => {
            if(v.content.length > 0 && v.content[0].type === 'text'){
                return {
                    role: v.role,
                    content: v.content[0].text
                }
            }
        })
    }

    console.log(arg.modelInfo.parameters)
    let body = applyParameters({
        model: arg.modelInfo.internalID,
        messages: finalChat,
        system: systemPrompt.trim(),
        max_tokens: maxTokens,
        stream: useStreaming ?? false,
    }, arg.modelInfo.parameters, {
        'thinking_tokens': 'thinking.budget_tokens'
    }, arg.mode, {
        modelId: arg.modelInfo.id,
        temperature: arg.temperatureOverride
    })

    // Handle thinking mode: off, adaptive, or budget
    const thinkingType = resolveClaudeThinkingType(arg.modelInfo.flags, db.thinkingType)

    if(thinkingType === 'off'){
        if(arg.modelInfo.flags.includes(LLMFlags.claudeThinkingOnByDefault)){
            body.thinking = { type: 'disabled' }
        }
        else {
            delete body.thinking
        }
    }
    else if(thinkingType === 'adaptive' && arg.modelInfo.flags.includes(LLMFlags.claudeAdaptiveThinking)){
        // Adaptive thinking mode
        delete body.thinking
        body.thinking = { type: 'adaptive', display: 'summarized' }
        let effort = db.adaptiveThinkingEffort ?? 'high'
        if(effort === 'xhigh' && !arg.modelInfo.flags.includes(LLMFlags.claudeXHighEffort)){
            effort = 'high'
        }
        body.output_config = { effort }
    }
    else if(body?.thinking?.budget_tokens === 0){
        delete body.thinking
    }
    else if(body?.thinking?.budget_tokens && body?.thinking?.budget_tokens > 0){
        body.thinking.type = 'enabled'
        body.thinking.display = 'summarized'
    }
    else if(body?.thinking?.budget_tokens === null){
        delete body.thinking
    }

    if(systemPrompt === ''){
        delete body.system
    }

    const bedrock = arg.modelInfo.format === LLMFormat.AWSBedrockClaude
    const additionalParams = getAdditionalParameters(aiModel)
    const hasCustomAnthropicBeta = additionalParams.some(([key]) => {
        return key.startsWith('header::') && key.slice('header::'.length).toLocaleLowerCase() === 'anthropic-beta'
    })

    if(bedrock && aiModel !== 'reverse_proxy'){
        function getCredentialParts(key:string) {
            const [accessKeyId, secretAccessKey, region] = key.split(":");
          
            if (!accessKeyId || !secretAccessKey || !region) {
              throw new Error(language.errors.bedrockKeyInvalid);
            }
          
            return { accessKeyId, secretAccessKey, region };
        }
        // A preview keeps a referenced key as the reference. The reference is not an AKID:SECRET:region
        // triple, so the preview is signed with it as a stand-in and shows a placeholder region.
        const { accessKeyId, secretAccessKey, region } = (arg.previewBody && isSecretRef(apiKey))
            ? { accessKeyId: apiKey.trim(), secretAccessKey: apiKey.trim(), region: '%REGION%' }
            : getCredentialParts(apiKey);

        const AMZ_HOST = "bedrock-runtime.%REGION%.amazonaws.com";
        const host = AMZ_HOST.replace("%REGION%", region);
        const stream = false;   // todo?

        // https://docs.claude.com/en/api/claude-on-amazon-bedrock#global-vs-regional-endpoints
        let useGlobal = false;
        
        const datePart = Number(arg.modelInfo.internalID.match(/(\d{8})/)?.[0]);
        const versionMatch = arg.modelInfo.internalID.match(/claude-(?:opus-|sonnet-|haiku-)?(\d+)-(\d+)/);

        if (datePart && !isNaN(datePart)) {
            useGlobal = datePart >= 20250929;
        } else if (versionMatch) {
            const majorVersion = Number(versionMatch[1]);
            const minorVersion = Number(versionMatch[2]);
            useGlobal = (majorVersion > 4) || (majorVersion === 4 && minorVersion >= 5);
        }

        const awsModel = useGlobal 
            ? "global." + arg.modelInfo.internalID 
            : "us." + arg.modelInfo.internalID;

        const url = `https://${host}/model/${awsModel}/invoke${stream ? "-with-response-stream" : ""}`

        let params = {...body}
        params.anthropic_version = "bedrock-2023-05-31"
        delete params.model
        delete params.stream
        if (params.thinking?.type === "enabled" || params.thinking?.type === "adaptive"){
            params.temperature = 1.0
            delete params.top_k
            delete params.top_p
        }

        let bedrockHeaders: Record<string, string> = {
            ["Host"]: host,
            ["Content-Type"]: "application/json",
            ["accept"]: "application/json",
        }

        if(additionalParams.length > 0){
            params = applyAdditionalParameters(params, bedrockHeaders, additionalParams)
        }

        const rq = new HttpRequest({
            method: "POST",
            protocol: "https:",
            hostname: host,
            path: `/model/${awsModel}/invoke${stream ? "-with-response-stream" : ""}`,
            headers: bedrockHeaders,
            body: JSON.stringify(params),
        });
        
        const signer = new SignatureV4({
            sha256: Sha256,
            credentials: { accessKeyId, secretAccessKey },
            region,
            service: "bedrock",
        });
        
        const signed = await signer.sign(rq);

        if(arg.previewBody){
            return {
                type: 'success',
                result: JSON.stringify({
                    url: url,
                    body: params,
                    headers: signed.headers
                })
            }

        }

        const res = await globalFetch(url, {
            method: "POST",
            body: params,
            headers: signed.headers,
            plainFetchForce: true,
            chatId: arg.chatId,
            interceptor: 'anthropic_bedrock'
        })

        if(!res.ok){
            return {
                type: 'fail',
                result: JSON.stringify(res.data),
                keyLimited: limitedField(arg, res.status)
            }
        }
        reportMessageUsage(arg, res.data?.usage)
        if(res.data.error){
            return {
                type: 'fail',
                result: JSON.stringify(res.data.error)
            }
        }
        const contents = res?.data?.content
        if(!contents || contents.length === 0){
            return {
                type: 'fail',
                result: JSON.stringify(res.data)
            }
        }
        let resText = ''
        let thinking = false
        for(const content of contents){
            if(content.type === 'text'){
                if(thinking){
                    resText += "</Thoughts>\n\n"
                    thinking = false
                }
                resText += content.text
            }
            if(content.type === 'thinking'){
                if(!thinking){
                    resText += "<Thoughts>\n"
                    thinking = true
                }
                resText += content.thinking ?? ''
            }
            if(content.type === 'redacted_thinking'){
                if(!thinking){
                    resText += "<Thoughts>\n"
                    thinking = true
                }
                resText += '\n{{redacted_thinking}}\n'
            }
        }

        if(thinking){
            resText += "</Thoughts>\n\n"
        }


        if(arg.extractJson && db.jsonSchemaEnabled){
            return {
                type: 'success',
                result: extractJSON(resText, arg.extractJson, {subject: arg.subject})
            }
        }
        return {
            type: 'success',
            result: resText
        }
    }


    let headers:{
        [key:string]:string
    } = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "accept": "application/json",
    }

    if(ollamaCloudAnthropic){
        headers["Authorization"] = "Bearer " + apiKey
        delete headers["x-api-key"]
    }

    if(arg.tools && arg.tools.length > 0){
        body.tools = arg.tools.map((v) => {
            return {
                name: v.name,
                description: v.description,
                input_schema: simplifySchema(v.inputSchema)
            }
        })

    }

    if(additionalParams.length > 0){
        body = applyAdditionalParameters(body, headers, additionalParams)
    }

    let betas:string[] = []

    if(body.max_tokens > 8192){
        betas.push('output-128k-2025-02-19')
    }


    if(db.claude1HourCaching){
        betas.push('extended-cache-ttl-2025-04-11')
    }

    if(betas.length > 0 && !hasCustomAnthropicBeta){
        headers['anthropic-beta'] = betas.join(',')
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

    if(db.claudeBatching && !ollamaCloudAnthropic){
        if(body.stream !== undefined){
            delete body.stream
        }
        const id = v4()
        const batchRequestUrl = replacerURL + '/batches'
        const batchRequestBody = {
            "requests": [{
                "custom_id": id,
                "params": body,
            }]
        }

        const resp = await fetchNative(batchRequestUrl, {
            "body": JSON.stringify(batchRequestBody),
            "method": "POST",
            signal: arg.abortSignal,
            headers: headers,
            interceptor: 'anthropic_batching',
            logFetch: false
        })

        if(resp.status !== 200){
            const responseText = await textifyReadableStream(resp.body)
            addFetchLog({
                body: batchRequestBody,
                headers: headers,
                response: responseText,
                success: false,
                url: batchRequestUrl,
                chatId: arg.chatId,
                status: resp.status
            })
            return {
                type: 'fail',
                result: responseText,
                keyLimited: limitedField(arg, resp.status)
            }
        }

        const r = (await resp.json())

        if(!r.id){
            addFetchLog({
                body: batchRequestBody,
                headers: headers,
                response: r,
                success: false,
                url: batchRequestUrl,
                chatId: arg.chatId,
                status: resp.status
            })
            return {
                type: 'fail',
                result: language.errors.claudeBatchNoResultsUrl
            }
        }

        addFetchLog({
            body: batchRequestBody,
            headers: headers,
            response: r,
            success: true,
            url: batchRequestUrl,
            chatId: arg.chatId,
            status: resp.status
        })

        const statusUrl = replacerURL + `/batches/${r.id}`
        const resultsUrl = replacerURL + `/batches/${r.id}/results`
        const cancelUrl = replacerURL + `/batches/${r.id}/cancel`
        const abortSignal = arg.abortSignal

        // Streaming is used in batch API to apply successful response even after abortSignal is fired
        // In order to do otherwise, `request.ts` and `index.svelte.ts` should be edited to bypass abort signal check
        const stream = new ReadableStream<StreamResponseChunk>({
            async start(controller){
                const batchStartTime = Date.now()
                const BATCH_TIMEOUT = 24 * 60 * 60 * 1000 + 600 * 1000 // 24 hours + 10 minutes
                let cancelRequested = false

                while(true){
                    try {
                        await sleep(3000)
                        if(abortSignal?.aborted && !cancelRequested){
                            cancelRequested = true
                            try {
                                await fetchNative(cancelUrl, {
                                    "body": "{}",
                                    "method": "POST",
                                    "headers": headers,
                                    "interceptor": 'anthropic_batching_cancel',
                                    logFetch: false
                                })
                            } catch(e) {
                                // ignore cancel request errors
                            }
                        }
                        if(Date.now() - batchStartTime > BATCH_TIMEOUT){
                            controller.error(new Error(language.errors.claudeBatchTimeout))
                            return
                        }

                        const statusRes = await fetchNative(statusUrl, {
                            "method": "GET",
                            "headers": headers,
                            "signal": cancelRequested ? undefined : abortSignal,
                            "interceptor": 'anthropic_batching_status',
                            logFetch: false
                        })

                        if(statusRes.status !== 200){
                            const statusResponseText = await textifyReadableStream(statusRes.body)
                            addFetchLog({
                                body: batchRequestBody,
                                headers: headers,
                                response: statusResponseText,
                                success: false,
                                url: statusUrl,
                                chatId: arg.chatId,
                                status: statusRes.status
                            })
                            controller.error(new Error(statusResponseText))
                            return
                        }

                        const statusData = await statusRes.json()

                        if(statusData.processing_status !== 'ended'){
                            continue
                        }

                        const batchRes = await fetchNative(resultsUrl, {
                            "method": "GET",
                            "headers": headers,
                            "signal": cancelRequested ? undefined : abortSignal,
                            "interceptor": 'anthropic_batching_results',
                            logFetch: false
                        })

                        if(batchRes.status !== 200){
                            const resultResponseText = await textifyReadableStream(batchRes.body)
                            addFetchLog({
                                body: batchRequestBody,
                                headers: headers,
                                response: resultResponseText,
                                success: false,
                                url: resultsUrl,
                                chatId: arg.chatId,
                                status: batchRes.status
                            })
                            controller.error(new Error(resultResponseText))
                            return
                        }

                        //since jsonl
                        const batchResultRawText = await batchRes.text()
                        const batchTextData = batchResultRawText.split('\n').filter((v) => v.trim() !== ''). map((v) => {
                            try {
                                return JSON.parse(v)
                            } catch (error) {
                                return null
                            }
                        }).filter((v) => v !== null)
                        
                        for(const batchData of batchTextData){
                            const type = batchData?.result?.type
                            console.log('Claude batch result type:', type)
                            if(batchData?.result?.type === 'succeeded'){
                                const contents = batchData.result.message.content ?? []
                                let resText = ''
                                let thinking = false
                                for(const content of contents){
                                    if(content.type === 'text'){
                                        if(thinking){
                                            resText += "</Thoughts>\n\n"
                                            thinking = false
                                        }
                                        resText += content.text
                                    }
                                    if(content.type === 'thinking'){
                                        if(!thinking){
                                            resText += "<Thoughts>\n"
                                            thinking = true
                                        }
                                        resText += content.thinking ?? ''
                                    }
                                    if(content.type === 'redacted_thinking'){
                                        if(!thinking){
                                            resText += "<Thoughts>\n"
                                            thinking = true
                                        }
                                        resText += '\n{{redacted_thinking}}\n'
                                    }
                                }

                                if(thinking){
                                    resText += "</Thoughts>\n\n"
                                    thinking = false
                                }

                                controller.enqueue({ "0": resText })
                                addFetchLog({
                                    body: batchRequestBody,
                                    headers: headers,
                                    response: batchData,
                                    success: true,
                                    url: resultsUrl,
                                    chatId: arg.chatId,
                                    status: batchRes.status
                                })
                                controller.close()
                                return
                            }
                            if(batchData?.result?.type === 'errored'){
                                const batchError = batchData.result.error

                                const message = batchError?.error?.message ? 
                                `${batchError.error.type}: ${batchError.error.message}` : 
                                JSON.stringify(batchError)

                                addFetchLog({
                                    body: batchRequestBody,
                                    headers: headers,
                                    response: batchData,
                                    success: false,
                                    url: resultsUrl,
                                    chatId: arg.chatId,
                                    status: batchRes.status
                                })
                                controller.error(new Error(message))
                                return
                            }
                            if(batchData?.result?.type === 'canceled'){
                                addFetchLog({
                                    body: batchRequestBody,
                                    headers: headers,
                                    response: batchData,
                                    success: false,
                                    url: resultsUrl,
                                    chatId: arg.chatId,
                                    status: batchRes.status
                                })
                                controller.close()
                                return
                            }
                            if(batchData?.result?.type === 'expired'){
                                addFetchLog({
                                    body: batchRequestBody,
                                    headers: headers,
                                    response: batchData,
                                    success: false,
                                    url: resultsUrl,
                                    chatId: arg.chatId,
                                    status: batchRes.status
                                })
                                controller.error(new Error(language.errors.claudeBatchExpired))
                                return
                            }
                        }
                    } catch (error) {
                        console.error('Error while waiting for Claude batch results:', error)
                    }
                }
            }
        })

        return {
            type: 'streaming',
            result: stream
        }
    }
    
    
    if(db.claudeRetrivalCaching){
        registerClaudeObserver({
            url: replacerURL,
            body: body,
            headers: headers
        })
    }

    return requestClaudeHTTP(replacerURL, headers, body, arg)
}

// One report per non-stream HTTP response that carries usage.
function reportMessageUsage(arg:RequestDataArgumentExtended, rawUsage:unknown):void{
    try {
        const usage = parseAnthropicUsage(rawUsage)
        if(usage){
            arg.usageMeter?.report(usage)
        }
    } catch (error) {}
}

async function requestClaudeHTTP(replacerURL:string, headers:{[key:string]:string}, body:any, arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    const db = getDatabase()
    
    if(arg.useStreaming){
        
        const owned = bindOwnedStream(arg, { kind: 'anthropic-stream' })
        // Everything up to the hand-off is covered: a throw here means the page stopped reading the owned request.
        try {
            const res = await fetchNative(replacerURL, {
                body: JSON.stringify(body),
                headers: headers,
                method: "POST",
                chatId: arg.chatId,
                signal: arg.abortSignal,
                interceptor: 'anthropic_streaming',
                nativeReply: owned?.owner,
                pumpProbe: owned?.probe,
            })

            if(res.status !== 200){
                const result = await textifyReadableStream(res.body)
                const keyLimited = limitedField(arg, res.status)
                // The attempt is over and its record is not the reply: it is removed before any retry pushes.
                if(owned && await retireFailedHead(owned.owner.key, owned.probe, res.status)){
                    return { type: 'fail', result, keyLimited, endsTurn: true }
                }
                return { type: 'fail', result, keyLimited }
            }
            let breakError = ''

            const stream = new ReadableStream<StreamResponseChunk>({
                async start(controller){
                    let reader = res.body.getReader()
                    let retries = 0
                    const parser = createAnthropicStreamReader({
                        onUsage: (usage) => arg.usageMeter?.report(usage),
                        onFailed: () => arg.usageMeter?.markFailed(),
                        retryOverload: () => Boolean(db.antiServerOverloads) && retries < (db.requestRetrys ?? 0),
                    })
                    let breakWhile = false
                    let retired = false
                    while(true){
                        try {
                            if(arg?.abortSignal?.aborted || breakWhile){
                                break
                            }
                            const {done, value} = await reader.read() 
                            if(done){
                                break
                            }
                            let emit = true
                            if(parser.feed(value) === 'overload'){
                                // console.log('Overload detected, retrying...')
                                controller.enqueue({
                                    "0": "Overload detected, retrying..."
                                })
                                // The retried reply starts from nothing: no text, no open thinking block, no partial line.
                                retries++
                                parser.reset()
                                reader.cancel().catch(() => {})
                                await sleep(1000)
                                if(owned && !retired && !arg?.abortSignal?.aborted){
                                    // The superseded first attempt must not stay `inflight` for a reconcile to place its error text
                                    // over the retry. The retry is unowned, and the key's announced fact is dropped so the page posts
                                    // its own notice when the retry really ends.
                                    await retireOwnedStream(owned.owner.key)
                                    takeAnnounced([owned.owner.key])
                                    retired = true
                                }
                                if(arg?.abortSignal?.aborted){
                                    breakWhile = true
                                    emit = false
                                }
                                else{
                                    const retryRes = await fetchNative(replacerURL, {
                                        body: JSON.stringify(body),
                                        headers: headers,
                                        method: "POST",
                                        chatId: arg.chatId,
                                        signal: arg.abortSignal,
                                        interceptor: 'anthropic_streaming_retry'
                                    })
                                    if(retryRes.status !== 200){
                                        arg.usageMeter?.markFailed()
                                        controller.enqueue({
                                            "0": await textifyReadableStream(retryRes.body)
                                        })
                                        breakWhile = true
                                        emit = false
                                    }
                                    else{
                                        reader = retryRes.body.getReader()
                                    }
                                }
                            }

                            if(emit){
                                controller.enqueue({
                                    "0": parser.text()
                                })
                            }

                        } catch (error) {
                            if(!arg?.abortSignal?.aborted){
                                // A source that errored rejects every later read, so retrying would never end.
                                parser.reportUsage()
                                controller.error(error)
                                return
                            }
                            await sleep(1)
                        }
                    }
                    const beforeFinish = parser.text()
                    const finished = parser.finish()
                    if(finished !== beforeFinish){
                        controller.enqueue({
                            "0": finished
                        })
                    }
                    parser.reportUsage()
                    controller.close()
                },
                cancel(){
                }
            })

            return {
                type: 'streaming',
                result: stream
            }
        } catch (error) {
            if(owned){
                endOwnedRead(owned.owner.key)
            }
            throw error
        }

    }

    const res = await globalFetch(replacerURL, {
        body: body,
        headers: headers,
        method: "POST",
        chatId: arg.chatId,
        interceptor: 'anthropic_http',
        deliverWhileFrozen: true,
        abortSignal: arg.abortSignal
    })

    if(runAborted(arg)){
        return abortedResult()
    }
    if(res.ok){
        reportMessageUsage(arg, res.data?.usage)
    }
    if(!res.ok){
        const stringlified = JSON.stringify(res.data)
        return {
            type: 'fail',
            result: stringlified,
            failByServerError: stringlified?.toLocaleLowerCase()?.includes('overload'),
            keyLimited: limitedField(arg, res.status)
        }
    }
    if(res.data.error){
        const stringlified = JSON.stringify(res.data.error)
        return {
            type: 'fail',
            result: stringlified,
            failByServerError: stringlified?.toLocaleLowerCase()?.includes('overload')
        }
    }
    const contents = res?.data?.content
    if(!contents || contents.length === 0){
        return {
            type: 'fail',
            result: JSON.stringify(res.data)
        }
    }
    let resText = ''
    let thinking = false

    const hasToolUse = (contents as any[]).some((v) => v.type === 'tool_use')

    if(hasToolUse){

        const round = beginToolRound(arg)
        if(round !== 'go'){
            return gateResult(round)
        }

        const messages:Claude3ExtendedChat[] = body.messages
        const response:Claude3Chat = {
            role: 'user',
            content: []
        }
        
        for(const content of (contents as Claude3ContentBlock[])){
            if(messages[messages.length-1].role !== 'assistant'){
                messages.push({
                    role: 'assistant',
                    content: []
                })
            }
            if(typeof messages[messages.length-1].content === 'string'){
                messages[messages.length-1].content = [{
                    type: 'text',
                    text: messages[messages.length-1].content as string
                }]
            }

            if(content.type === 'tool_use'){
                const blockGate = toolBlockGate(arg)
                if(blockGate !== 'go'){
                    return gateResult(blockGate)
                }
                const listed = arg.tools?.find((t) => t.name === content.name)
                // A name the request did not advertise is answered, not routed: routing could start a client for it.
                const used:RPCToolCallContent[] = listed
                    ? await callTool(content.name, content.input, {subject: arg.subject, mcpURL: listed.mcpURL, toolLoop: arg.toolLoop})
                    : refusedToolContent(content.name)
                const r:Claude3ToolResponseBlock = {
                    type: 'tool_result',
                    tool_use_id: content.id,
                    content: used.map((v) => {
                        switch(v.type){
                            case 'text':{
                                return {
                                    type: 'text',
                                    text: v.text,
                                }
                            }
                            case 'image':{
                                return {
                                    type: 'image',
                                    source: {
                                        type: 'base64',
                                        media_type: v.mimeType,
                                        data: v.data
                                    }
                                }
                            }
                            default:{
                                return {
                                    type: 'text',
                                    text: `Unsupported tool response type: ${v.type}`
                                }
                            }
                        }
                    })
                }
                response.content.push(r)
                if(listed && arg.rememberToolUsage){
                    arg.additionalOutput ??= ''
                    arg.additionalOutput += await encodeToolCall({
                        call: {
                            id: content.id,
                            name: content.name,
                            arg: content.input
                        },
                        response: used
                    })
                }
            }

            (messages[messages.length-1] as Claude3Chat).content.push(content)
        }

        const followUpGate = toolBlockGate(arg)
        if(followUpGate !== 'go'){
            return gateResult(followUpGate)
        }

        messages.push(response)

        body.messages = messages
        body.stream = false

        return requestClaudeHTTP(replacerURL, headers, body, arg)
    }
    for(const content of contents){
        if(content.type === 'text'){
            if(thinking){
                resText += "</Thoughts>\n\n"
                thinking = false
            }
            resText += content.text
        }
        if(content.type === 'thinking'){
            if(!thinking){
                resText += "<Thoughts>\n"
                thinking = true
            }
            resText += content.thinking ?? ''
        }
        if(content.type === 'redacted_thinking'){
            if(!thinking){
                resText += "<Thoughts>\n"
                thinking = true
            }
            resText += '\n{{redacted_thinking}}\n'
        }
        if(content.type === 'tool_use'){

        }
    }

    if(thinking){
        resText += "</Thoughts>\n\n"
    }

    arg.additionalOutput ??= ""
    if(arg.extractJson && db.jsonSchemaEnabled){
        return {
            type: 'success',
            result: arg.additionalOutput + extractJSON(resText, arg.extractJson, {subject: arg.subject})
        }
    }
    return {
        type: 'success',
        result: arg.additionalOutput + resText
    }
}
