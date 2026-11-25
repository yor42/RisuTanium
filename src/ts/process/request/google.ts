import { fetchNative, textifyReadableStream } from "src/ts/globalApi.svelte"
import { LLMFlags, LLMFormat, type LLMModel } from "src/ts/model/modellist"
import { getDatabase, setDatabase } from "src/ts/storage/database.svelte"
import { base64url, simplifySchema } from "src/ts/util"
import { v4 } from "uuid"
import { pkcs8FromPem, RsaKeyError, signRs256 } from "./rs256Signer"
import { saveInlayedSignature, setInlayAsset, writeInlayImage, type InlaySignature } from "../files/inlays"
import { extractJSON, getGeneralJSONSchema } from "../templates/jsonSchema"
import { callTool, decodeToolCall, encodeToolCall } from "../mcp/mcp"
import { alertError } from "src/ts/alert";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { addFetchLog } from "src/ts/globalApi.svelte"
import type { RequestDataArgumentExtended, requestDataResponse, StreamResponseChunk } from './request'
import { applyAdditionalParameters, applyParameters, getAdditionalParameters, type LLMParameter } from './shared'
import { notifyBodyInterceptors } from "./bodyInterceptors"
import { isSecretRef, registerSensitive, resolveSecret } from "src/ts/secretRef"
import { limitedField, readKeyField, sendArgKey, sendKeyLine } from "./secretKey"
import { beginToolRound, endStreamForGate, gateResult, toolBlockGate } from "./toolLoop"
import { isAndroidTransport } from "src/ts/storage/tauriByteTransport"
import { parseJsonBody, readBodyText } from "src/ts/network/frozenBody"
import { parseGoogleUsage } from "../../usage/usageParse"
import type { UsageMeter } from "../../usage/usageTypes"
import { composeGeminiDisplay, extractGeminiContent, geminiReadRuleOf, geminiStreamTransform, initGeminiStreamState, type GeminiReadRule } from "./geminiStreamTransform"
import { bindOwnedStream, endOwnedRead, retireFailedHead, retireOwnedStream } from "src/ts/nativeReply/ownedStream"

/** Vertex access token minted from a referenced service-account key. Memory only; never stored. */
let vertexMemoryToken: { reference: string, email: string, token: string, expires: number } | null = null

type GeminiFunctionCall = {
    id?: string;
    name: string;
    args: any
}

type GeminiFunctionResponse = {
    id?: string;
    name: string;
    response: any
}

interface GeminiPart{
    text?:string
    thought?:boolean
    thoughtSignature?:string
    "inlineData"?: {
        "mimeType": string,
        "data": string
    },
    functionCall?: GeminiFunctionCall
    functionResponse?: GeminiFunctionResponse
}

interface GeminiChat {
    role?: "user"|"model"
    parts:|GeminiPart[]
}

export async function requestGoogleCloudVertex(arg:RequestDataArgumentExtended):Promise<requestDataResponse> {

    const formated = arg.formated
    const db = getDatabase()
    const maxTokens = arg.maxTokens

    let reformatedChat:GeminiChat[] = []
    let systemPrompt = ''

    // An empty list has no system instruction; the request then carries no contents.
    if(formated.length > 0 && formated[0].role === 'system'){
        systemPrompt = formated[0].content
        formated.shift()
    }

    for(let i=0;i<formated.length;i++){
        const chat = formated[i]
  
        const prevChat = reformatedChat[reformatedChat.length-1]
        const qRole = 
            chat.role === 'user' ? 'user' :
            chat.role === 'assistant' ? 'model' :
            chat.role

        if (chat.multimodals && chat.multimodals.length > 0) {
            let geminiParts: GeminiPart[] = [];
            
            geminiParts.push({
                text: chat.content,
            });
            
            for (const modal of chat.multimodals) {
                if (
                    (modal.type === "image" && arg.modelInfo.flags.includes(LLMFlags.hasImageInput)) ||
                    (modal.type === "audio" && arg.modelInfo.flags.includes(LLMFlags.hasAudioInput)) ||
                    (modal.type === "video" && arg.modelInfo.flags.includes(LLMFlags.hasVideoInput))
                ) {
                    const dataurl = modal.base64;
                    const base64 = dataurl.split(",")[1];
                    const mediaType = dataurl.split(";")[0].split(":")[1];
        
                    geminiParts.push({
                        inlineData: {
                            mimeType: mediaType,
                            data: base64,
                        }
                    });
                }

                if(modal.type === 'signature' && db.saveSignatures){
                    const sig:InlaySignature = JSON.parse(Buffer.from(modal.base64, 'base64').toString('utf-8'))
                    if(sig.source === arg.modelInfo.internalID || sig.source === 'models/' + arg.modelInfo.internalID || sig.source === arg.modelInfo.id){
                        geminiParts.push({
                            thought: true,
                            thoughtSignature: sig.signatures[0].content
                        })
                    }
                }
            }
    
            reformatedChat.push({
                role: chat.role === 'user' ? 'user' : 'model',
                parts: geminiParts,
            });        }
        else if(chat.role === 'system'){
            if(prevChat?.role === 'user'){
                reformatedChat[reformatedChat.length-1].parts[0].text += '\nsystem:' + chat.content
            }
            else{
                reformatedChat.push({
                    role: "user",
                    parts: [{
                        text: chat.role + ':' + chat.content
                    }]
                })
            }
        }
        else if(chat.role === 'assistant' || chat.role === 'user'){
            reformatedChat.push({
                role: chat.role === 'user' ? 'user' : 'model',
                parts: [{
                    text: chat.content
                }]
            })
        }
        else{
            reformatedChat.push({
                role: "user",
                parts: [{
                    text: chat.role + ':' + chat.content
                }]
            })
        }
    }

    for (let i=0;i<reformatedChat.length;i++){

        let chat = reformatedChat[i]
        for (let j=0;j<chat.parts.length;j++){
            
            const part = chat.parts[j]
            if (part.text && part.text.includes('<tool_call>')){
                // Analyze the entire text to sequentially process multiple tool_calls
                const toolCallMatches = [...part.text.matchAll(/<tool_call>(.*?)<\/tool_call>/g)]
                if (toolCallMatches.length > 0) {
                    // Split the text by tool_call and reconstruct in order
                    const segments = []
                    let lastIndex = 0

                    for (let k = 0; k < toolCallMatches.length; k++) {
                        const match = toolCallMatches[k]
                        // Text before tool_call
                        if (match.index! > lastIndex) {
                            segments.push({
                                type: 'text',
                                content: part.text.substring(lastIndex, match.index).trim(),
                                role: chat.role
                            })
                        }

                        // Handle tool_call
                        const call = await decodeToolCall(match[1])
                        if (call) {
                            const tool = arg?.tools?.find((t) => t.name === call.call.name)
                            if (tool) {
                                segments.push({
                                    type: 'functionCall',
                                    call: call,
                                    tool: tool
                                })
                            }
                        }

                        lastIndex = match.index! + match[0].length
                    }
                    // Last text after the last tool_call
                    if (lastIndex < part.text.length) {
                        segments.push({
                            type: 'text',
                            content: part.text.substring(lastIndex).trim(),
                            role: chat.role
                        })
                    }
                    // Keep the first text in the current part
                    if (segments.length > 0 && segments[0].type === 'text') {
                        part.text = segments[0].content.trim() ? segments[0].content : ''
                        segments.shift()
                    } else {
                        part.text = ''
                    }

                    // Mark the current part for removal if its text is empty
                    const shouldRemoveCurrentPart = !part.text.trim()

                    // Insert the remaining segments in order
                    let insertIndex = i + 1
                    for (const segment of segments) {
                        if (segment.type === 'text') {
                            // Insert only non-empty text
                            if (segment.content.trim()) {
                                reformatedChat.splice(insertIndex, 0, {
                                    role: segment.role,
                                    parts: [{
                                        text: segment.content
                                    }]
                                })
                                insertIndex++
                            }
                        } else if (segment.type === 'functionCall') {
                            // Insert functionCall
                            reformatedChat.splice(insertIndex, 0, {
                                role: 'model',
                                parts: [{
                                    functionCall: {
                                        name: segment.call.call.name,
                                        args: segment.call.call.arg
                                    }
                                }]
                            })
                            insertIndex++

                            // Insert functionResponse
                            reformatedChat.splice(insertIndex, 0, {
                                parts: [{
                                    functionResponse: {
                                        name: segment.call.call.name,
                                        response: {
                                            data: (() => {
                                                const res: string[] = []
                                                for (const r of segment.call.response) {
                                                    if (r.type === 'text') {
                                                        res.push(r.text)
                                                    }
                                                }
                                                return res
                                            })()
                                        }
                                    }
                                }]
                            })
                            insertIndex++
                        }
                    }
                    // Remove the current part if its text is empty
                    if (shouldRemoveCurrentPart) {
                        reformatedChat.splice(i, 1)
                        i = insertIndex - 2 // Adjust index after removal
                    } else {
                        i = insertIndex - 1 // Start from the correct position in the next loop
                    }
                }
            }
        }
    }

    // After tool parsing, merge consecutive chats with the same role
    for (let i = reformatedChat.length - 1; i >= 1; i--) {
        const currentChat = reformatedChat[i]
        const prevChat = reformatedChat[i - 1]

        if (currentChat.role === prevChat.role) {
            // If the same role is consecutive, merge the parts arrays and remove the current chat

            // If the last part of the previous chat and the first part of the current chat are both text, join with \n\n
            const prevLastPart = prevChat.parts[prevChat.parts.length - 1]
            const currentFirstPart = currentChat.parts[0]

            if (prevLastPart.text && currentFirstPart.text) {
                prevLastPart.text += '\n\n' + currentFirstPart.text
                // Add the rest of the current chat's parts except the first
                prevChat.parts.push(...currentChat.parts.slice(1))
            } else {
                // If not text, just merge the parts arrays
                prevChat.parts.push(...currentChat.parts)
            }

            // Remove the current chat
            reformatedChat.splice(i, 1)
        }
    }

    const uncensoredCatagory = [
        {
            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "threshold": "BLOCK_NONE"
        },
        {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "threshold": "BLOCK_NONE"
        },
        {
            "category": "HARM_CATEGORY_HARASSMENT",
            "threshold": "BLOCK_NONE"
        },
        {
            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
            "threshold": "BLOCK_NONE"
        },
        {
            "category": "HARM_CATEGORY_CIVIC_INTEGRITY",
            "threshold": "BLOCK_NONE"
        }
    ]

    if(arg.modelInfo.flags.includes(LLMFlags.noCivilIntegrity)){
        uncensoredCatagory.splice(4, 1)
    }

    if(arg.modelInfo.flags.includes(LLMFlags.geminiBlockOff)){
        for(let i=0;i<uncensoredCatagory.length;i++){
            uncensoredCatagory[i].threshold = "OFF"
        }
    }

    let para:LLMParameter[] = ['temperature', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty']

    if(arg.modelInfo.flags.includes(LLMFlags.geminiThinking)){
        para.push('thinking_tokens')
        para.push('reasoning_effort')
    }

    para = para.filter((v) => {
        return arg.modelInfo.parameters.includes(v)
    })

    let body: any = {
        contents: reformatedChat,
        generation_config: applyParameters({
            "maxOutputTokens": maxTokens
        }, para, {
            'top_p': "topP",
            'top_k': "topK",
            'presence_penalty': "presencePenalty",
            'frequency_penalty': "frequencyPenalty",
            'thinking_tokens': "thinkingBudget",
            'reasoning_effort': "thinkingConfig.thinkingLevel"
        }, arg.mode, {
            ignoreTopKIfZero: true,
            modelId: arg.modelInfo.id,
            temperature: arg.temperatureOverride
        }),
        safetySettings: uncensoredCatagory,
        systemInstruction: {
            parts: [
                {
                    "text": systemPrompt
                }
            ]
        },
        tools: {
            functionDeclarations: arg?.tools?.map((tool, i) => {
                console.log(tool.name, i)
                return {
                    name: tool.name,
                    description: tool.description,
                    parameters: simplifySchema(tool.inputSchema)
                }
            }) ?? []
        }
    }

    if(arg.modelInfo.flags.includes(LLMFlags.geminiThinking)){
        const generationConfig = body.generation_config

        // 2.5's flat thinkingBudget is wrapped into thinkingConfig here.
        // 3.x's thinkingConfig.thinkingLevel was already set by the rename above.
        if (generationConfig.thinkingBudget !== undefined) {
            generationConfig.thinkingConfig = {
                "thinkingBudget": generationConfig.thinkingBudget,
                "includeThoughts": true,
            }
            delete generationConfig.thinkingBudget
        } else if (generationConfig.thinkingConfig) {
            // Models without a `minimal` level (e.g. Gemini 3.1 Pro) — map it to `low`, as Google does.
            if (generationConfig.thinkingConfig.thinkingLevel === 'minimal'
                && arg.modelInfo.flags.includes(LLMFlags.geminiThinkingNoMinimal)) {
                generationConfig.thinkingConfig.thinkingLevel = 'low'
            }
            generationConfig.thinkingConfig.includeThoughts = true
        }
    }

    if(systemPrompt === ''){
        delete body.systemInstruction
    }

    if(arg.modelInfo.flags.includes(LLMFlags.hasAudioOutput)){
        body.generation_config.responseModalities = [
            'TEXT', 'AUDIO'
        ]
        arg.useStreaming = false
    }
    if(arg.imageResponse || arg.modelInfo.flags.includes(LLMFlags.hasImageOutput)){ 
        body.generation_config.responseModalities = [
            'TEXT', 'IMAGE'
        ]
        arg.useStreaming = false
    }

    let headers:{[key:string]:string} = {
        'Content-Type': 'application/json'
    }

    if(db.gptVisionQuality === 'high'){
        body.generation_config.mediaResolution = "MEDIA_RESOLUTION_MEDIUM"
    }

    const PROJECT_ID = db.google.projectId
    const REGION = db.vertexRegion
    console.log(arg.modelInfo);

    const isVertexGlobalOnlyModel = (modelId: string) => {
        // Gemini 3 preview models and the 3.5/3.6/3.7/3.8 Flash family are not served from the regions
        // selectable in settings (us-central1, us-west1); route them through the global endpoint.
        return /^gemini-3-.*-preview$/.test(modelId) || /^gemini-3\.[5678]-flash/.test(modelId)
    }

    async function generateToken(email:string,key:string,persist:boolean = true){
        // Input validation
        if (!email.includes("gserviceaccount.com")) {
            throw new Error(language.errors.vertexInvalidClientEmail);
        }
        if (!key.includes("-----BEGIN PRIVATE KEY-----") ||
            !key.includes("-----END PRIVATE KEY-----")) {
            throw new Error(language.errors.vertexInvalidPrivateKey);
        }

        const time = Math.floor(Date.now() / 1000);
    
        const header = {
            alg: "RS256",
            typ: "JWT",
        };

        const claimSet = {
            iss: email,
            iat: time,
            exp: time + 3600,
            scope: "https://www.googleapis.com/auth/cloud-platform",
            aud: "https://oauth2.googleapis.com/token",
        };

        const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
        const encodedClaimSet = base64url(new TextEncoder().encode(JSON.stringify(claimSet)));
    
        // Only a malformed key is relabelled; network and token failures keep their own messages.
        let signature: Uint8Array;
        try {
            signature = await signRs256(pkcs8FromPem(key), new TextEncoder().encode(`${encodedHeader}.${encodedClaimSet}`));
        } catch (error) {
            if (error instanceof RsaKeyError) {
                throw new Error(language.errors.vertexInvalidPrivateKey);
            }
            throw error;
        }

        const jwt = `${encodedHeader}.${encodedClaimSet}.${base64url(signature)}`;

        const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        if (!response.ok) {
            let errorText;
            try {
                errorText = JSON.stringify(await response.json());
            } catch {
                errorText = response.status.toString();
            }
            throw new Error(fillLang(language.errors.googleTokenRefreshFailed, { error: `${errorText}` }));
        }

        const data = await response.json();
        const token = data.access_token;

        if (!token) {
            throw new Error(language.errors.googleNoAccessToken);
        }

        if(persist){
            const db2 = getDatabase()
            db2.vertexAccessToken = token
            db2.vertexAccessTokenExpires = Date.now() + 3500 * 1000
            setDatabase(db2)
        }
        return token;
    }

    const vertexPrivateKey = await readKeyField(db, 'vertexPrivateKey')
    if(arg.modelInfo.format === LLMFormat.VertexAIGemini && isSecretRef(vertexPrivateKey)){
        // A token minted from a referenced key is derived from a secret that is not stored, so it is
        // kept in memory only and never written to the database.
        if (!db.vertexClientEmail) {
            return { type: 'fail', result: language.errors.vertexAuthIncomplete };
        }
        const reference = vertexPrivateKey.trim()
        if(arg.previewBody){
            headers['Authorization'] = "Bearer " + reference
        }
        else if(vertexMemoryToken && vertexMemoryToken.reference === reference && vertexMemoryToken.email === db.vertexClientEmail && vertexMemoryToken.expires > Date.now()){
            headers['Authorization'] = "Bearer " + vertexMemoryToken.token
        }
        else{
            const token = await generateToken(db.vertexClientEmail, await resolveSecret(vertexPrivateKey), false)
            registerSensitive(token, reference + ':token')
            vertexMemoryToken = { reference, email: db.vertexClientEmail, token, expires: Date.now() + 3500 * 1000 }
            headers['Authorization'] = "Bearer " + token
        }
    }
    else if(arg.modelInfo.format === LLMFormat.VertexAIGemini){
        // A request preview never acquires or renews a credential and never writes the database.
        if(arg.previewBody){
            headers['Authorization'] = "Bearer " + (db.vertexAccessToken || '')
        }
        else if(db.vertexAccessTokenExpires < Date.now()){
            if (!db.vertexClientEmail || !vertexPrivateKey) {
                return { type: 'fail', result: language.errors.vertexAuthIncomplete };
            }
            headers['Authorization'] = "Bearer " + await generateToken(db.vertexClientEmail, vertexPrivateKey)
        }
        else{
            headers['Authorization'] = "Bearer " + db.vertexAccessToken
        }
    }

    
    if((db.jsonSchemaEnabled || arg.schema) && !arg.noJsonSchema){
        body.generation_config.response_mime_type = "application/json"
        body.generation_config.response_schema = getGeneralJSONSchema(arg.schema, ['$schema','additionalProperties'], {subject: arg.subject})
        console.log(body.generation_config.response_schema)
    }    
    
    let url = ''
    // A Vertex request without a custom URL authenticates with the minted token, not this key, so
    // an unusable reference in the Gemini key must not fail it.
    const urlCarriesKey = !!arg.customURL || arg.modelInfo.format !== LLMFormat.VertexAIGemini
    let apiKey = urlCarriesKey
        ? (arg.key ? await sendArgKey(arg) : await sendKeyLine(arg, 'google.accessToken'))
        : (arg.key || await readKeyField(db, 'google.accessToken'))

    if(arg.customURL){
        let baseURL = arg.customURL
        if (!baseURL.endsWith('/')) {
            baseURL += '/'
        }
        const endpoint = arg.useStreaming ? 'streamGenerateContent' : 'generateContent'
        const u = new URL(`models/${arg.modelInfo.internalID}:${endpoint}`, baseURL)
        u.searchParams.set('key', apiKey)
        if (arg.useStreaming) {
            u.searchParams.set('alt', 'sse')
        }
        url = u.toString()
    }
    else if(arg.modelInfo.format === LLMFormat.VertexAIGemini){
        const endpoint = arg.useStreaming ? 'streamGenerateContent?alt=sse' : 'generateContent'

        // Some models (e.g. Gemini 3 preview) are only available via the global endpoint.
        const effectiveRegion = isVertexGlobalOnlyModel(arg.modelInfo.internalID) ? 'global' : REGION

        url = effectiveRegion === 'global' ?
            `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${effectiveRegion}/publishers/google/models/${arg.modelInfo.internalID}:${endpoint}` :
            `https://${effectiveRegion}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${effectiveRegion}/publishers/google/models/${arg.modelInfo.internalID}:${endpoint}`
        
        }
    else if(arg.modelInfo.format === LLMFormat.GoogleCloud && arg.useStreaming){
        url = `https://generativelanguage.googleapis.com/v1beta/models/${arg.modelInfo.internalID}:streamGenerateContent?key=${apiKey}&alt=sse`
    }
    else{
        url = `https://generativelanguage.googleapis.com/v1beta/models/${arg.modelInfo.internalID}:generateContent?key=${apiKey}`
    }
    // will return error if functionDeclarations is empty
    if(body.tools?.functionDeclarations?.length === 0){
        body.tools = undefined
    }

    body = applyAdditionalParameters(body, headers, getAdditionalParameters(arg.aiModel))

    if(arg.previewBody){
        return {
            type: 'success',
            result: JSON.stringify({
                url: url,
                body: body,
                headers: headers
            })      
        }
    }

    return requestGoogle(url, body, headers, arg)
}

async function requestGoogle(url:string, body:any, headers:{[key:string]:string}, arg:RequestDataArgumentExtended):Promise<requestDataResponse> {
    
    const db = getDatabase()

    const fallBackGemini = async (originalError:string):Promise<requestDataResponse> => {
        if(!db.antiServerOverloads){
            return {
                type: 'fail',
                result: originalError,
                failByServerError: true
            }
        }

        if(arg?.abortSignal?.aborted){
            return {
                type: 'fail',
                result: originalError,
                failByServerError: true
            }
        }
        if(arg.modelInfo.format === LLMFormat.VertexAIGemini){
            return {
                type: 'fail',
                result: originalError,
                failByServerError: true
            }
        }

        return requestGoogle(url, body, headers, arg)
    }

    // process the text parts into a single text response
    const processTextResponse = (rDatas: {text: string, thought?: boolean}[]) => {
        if(arg.extractJson && (db.jsonSchemaEnabled || arg.schema)){
            for(let i=0;i<rDatas.length;i++){
                const extracted = extractJSON(rDatas[i].text, arg.extractJson, {subject: arg.subject})
                rDatas[i].text = extracted
            }
        }
        const thoughtsArr: string[] = []
        const contentArr: string[] = []
        for (const d of rDatas) {
            if (d.thought) {
                thoughtsArr.push(d.text)
            } else {
                contentArr.push(d.text)
            }
        }
        const thoughts = thoughtsArr.join('\n\n')
        const content = contentArr.join('\n\n')
        return (thoughts ? `<Thoughts>\n\n${thoughts}\n\n</Thoughts>\n\n` : '') + content
    }

    if((arg.modelInfo.format === LLMFormat.GoogleCloud || arg.modelInfo.format === LLMFormat.VertexAIGemini) && arg.useStreaming){

        if(arg.previewBody){
            return {
                type: 'success',
                result: JSON.stringify({
                    url: url,
                    body: body,
                    headers: headers
                })      
            }
        }
        
        // One rule for the stored blob and the live read: the record is replayed exactly as this request reads it.
        const rule = geminiReadRuleOf(arg, db)
        const owned = bindOwnedStream(arg, { kind: 'gemini-stream', ...rule })
        // Everything up to the hand-off is covered: a throw here means the page stopped reading the owned request.
        try {
            const f = await fetchNative(url, {
                headers: headers,
                body: JSON.stringify(body),
                method: 'POST',
                chatId: arg.chatId,
                signal: arg.abortSignal,
                interceptor: 'gemini_base_stream',
                nativeReply: owned?.owner,
                pumpProbe: owned?.probe,
            })

            if(f.status !== 200){
                const text = await textifyReadableStream(f.body)
                // The attempt is over and its record is not the reply: it is removed before the key-limit return
                // and before the fallback request, which is never owned.
                if(owned && await retireFailedHead(owned.owner.key, owned.probe, f.status)){
                    return {
                        type: 'fail',
                        result: text,
                        endsTurn: true
                    }
                }
                const limited = limitedField(arg, f.status)
                if(limited){
                    return {
                        type: 'fail',
                        result: text,
                        keyLimited: limited
                    }
                }
                if(text.includes('RESOURCE_EXHAUSTED')){
                    return await fallBackGemini(text)
                }
                return {
                    type: 'fail',
                    result: text
                }
            }

            const transtream = geminiStreamTransform(rule, {
                onUsage: (usage) => arg.usageMeter?.report(usage),
                // Its a promise, but we don't need to await it here
                onSignature: ({ id, signature }) => {
                    saveInlayedSignature(id, signature).catch((error) => console.error('The Gemini signature could not be saved:', error))
                },
            })

            f.body.pipeTo(transtream.writable).catch(() => {})

            return {
                type: 'streaming',
                result: wrapToolStream(transtream.readable, body, headers, url, arg, rule, owned?.owner.key)
            }
        } catch (error) {
            if(owned){
                endOwnedRead(owned.owner.key)
            }
            throw error
        }
    }

    // On Android the reply must arrive while a hidden page is frozen: no native time limit, and the body is
    // read without the Body mixin. Desktop uses the idle limit (no data for 600 s); web and desktop use the mixin.
    const android = isAndroidTransport()
    const res = await fetchNative(url, {
        headers: headers,
        body: JSON.stringify(body),
        method: 'POST',
        chatId: arg.chatId,
        signal: arg.abortSignal,
        interceptor: 'gemini_base',
        noNativeTimeout: android
    })
    

    if(!res.ok){
        const data = android ? await readBodyText(res) : await res.text()
        const text = JSON.stringify(data)
        const limited = limitedField(arg, res.status)
        if(limited){
            return {
                type: 'fail',
                result: `${text} (status: ${res.status})`,
                keyLimited: limited
            }
        }
        if(text.includes('RESOURCE_EXHAUSTED')){
            return fallBackGemini(text)
        }
        return {
            type: 'fail',
            result: `${text} (status: ${res.status})`
        }
    }

    let rDatas:{text: string, thought?: boolean}[] = [] 
    const processDataItem = async (data:any):Promise<GeminiPart[]> => {
        const parts = data?.candidates?.[0]?.content?.parts as GeminiPart[]

        if(parts){
         
            for(let i=0;i<parts.length;i++){
                const part = parts[i]

                if(part.text){
                    rDatas.push({
                        text: part.text,
                        thought: part.thought
                    })
                }

                if(part.thoughtSignature && arg.saveSignatures){
                    const sigId = v4()
                    await saveInlayedSignature(sigId, {
                        source: arg.modelInfo.internalID || arg.modelInfo.id,
                        sourceFormat: arg.modelInfo.format,
                        signatures: [{
                            type: 'text',
                            content: part.text,
                        }]
                    })
                    rDatas[rDatas.length - 1].text = `{{inlayeddata::${sigId}}}\n\n` + rDatas[rDatas.length - 1].text
                }

                if(part.inlineData){
                    const imgHTML = new Image()
                    const id = v4()

                    if(part.inlineData.mimeType.startsWith('image/')){

                        imgHTML.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                        await writeInlayImage(imgHTML, {
                            id: id
                        })
                        rDatas.push({
                            text: `{{inlayeddata::${id}}}`
                        })
                    }
                    else{
                        const id = v4()
                        await setInlayAsset(id, {
                            name: 'gemini-audio',
                            type: 'audio',
                            data: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                            height: 0,
                            width: 0,
                            ext: part.inlineData.mimeType.split('/')[1],
                        })
                    }
                }

            }   
        }

        if(data?.usageMetadata){
            // The response is already in hand: an abandoned interceptor ends the notification, not the reply.
            await notifyBodyInterceptors(() => ({
                usageMetadata: data.usageMetadata,
                modelStatus: data.modelStatus,
                promptFeedback: data.promptFeedback
            }), 'meta_gemini', arg.abortSignal)
        }
        return parts
    }

    // traverse responded data if it contains multipart contents
    let parts:GeminiPart[] = []
    const resData = android ? await parseJsonBody(res) : await res.json()
    if(Array.isArray(resData)){
        for(const data of resData){
            const p = await processDataItem(data)
            parts = parts.concat(p)
        }
    }
    else{
        const p = await processDataItem(resData)
        parts = parts.concat(p)
    }
    parts = parts.filter((p) => p)

    // The last `usageMetadata` of the response is the cumulative one.
    try {
        const items:{usageMetadata?:unknown}[] = Array.isArray(resData) ? resData : [resData]
        const lastWithUsage = items.filter((item) => item?.usageMetadata).pop()
        const usage = parseGoogleUsage(lastWithUsage?.usageMetadata)
        if(usage){
            arg.usageMeter?.report(usage)
        }
    } catch (error) {}

    const calls: GeminiFunctionCall[] = []
    for (const p of parts) {
        if (p?.functionCall) {
            calls.push(p.functionCall as GeminiFunctionCall)
        }
    }

    // If there are function calls, handle calls and send next request
    if(calls.length > 0){
        const round = beginToolRound(arg)
        if(round !== 'go'){
            return gateResult(round)
        }
        const chat = body.contents as GeminiChat[]

        // Add the model response part to the request content (only function calls if simplifiedToolUse is enabled)
        if(db.simplifiedToolUse){
            chat.push({
                role: 'model',
                parts: calls.map((call) => {
                    return {
                        functionCall: {
                            name: call.name,
                            args: call.args
                        }
                    } as GeminiPart
                })
            })
        }
        // Add the model response part to the request content (text response and function calls)
        else{
            chat.push({
                role: 'model',
                parts: parts.filter((p) => !p.thought)
            })
        }
        // If the last part is a model response, merge it with the previous model response
        if(chat[chat.length - 2]?.role === 'model') {
            chat[chat.length - 2].parts = chat[chat.length - 2].parts.concat(chat[chat.length - 1].parts)
            chat.pop() 
        }
        
        const functionParts: GeminiPart[] = []
        const callCodes: string[] = []
        const tools = arg?.tools ?? []
        
        // Handle tool calls
        for(const call of calls){
            const blockGate = toolBlockGate(arg)
            if(blockGate !== 'go'){
                return gateResult(blockGate)
            }
            const functionName = call.name
            const functionArgs = call.args

            const tool = tools.find((t) => t.name === functionName)
            if(tool){
                const result = (await callTool(tool.name, functionArgs, {subject: arg.subject, mcpURL: tool.mcpURL, toolLoop: arg.toolLoop})).filter((r) => {
                    return r.type === 'text'
                })
                if(result.length === 0){
                    functionParts.push({
                        functionResponse: {
                            name: call.name,
                            response: 'No response from tool.'
                        }
                    })
                }
                
                // Store the encoded tool call history for later use
                if(arg.rememberToolUsage){
                    callCodes.push(await encodeToolCall({
                        call: {
                            id: call.id,
                            name: call.name,
                            arg: call.args
                        },
                        response: result
                    }))
                }
                
                for(let i=0;i<result.length;i++){
                    let response:any = result[i].text
                    try {
                        //try json parse
                        response = {
                            data: JSON.parse(response)
                        }
                    } catch (error) {
                        response = {
                            data: response
                        }
                    }
                    functionParts.push({
                        functionResponse: {
                            name: call.name,
                            response
                        }
                    })
                }
            }
            else{
                functionParts.push({
                    functionResponse: {
                        name: call.name,
                        response: `Tool ${call.name} not found.`
                    }
                })
            }
        }
        
        // Add the user response part to the request content (function responses)
        chat.push({
            parts: functionParts
        })

        body.contents = chat

        // Send the next request recursively 
        let resRec
        let attempt = 0
        do {
            // The first attempt is also the gate before the follow-up request itself.
            if (toolBlockGate(arg) !== 'go') {
                break
            }
            attempt++
            resRec = await requestGoogle(url, body, headers, arg)

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

        // Does not include the text response if simplifiedToolUse is enabled
        const result = (db.simplifiedToolUse ? '' : processTextResponse(rDatas) + '\n\n') + callCodes.join('\n\n')

        // If the next request fails, only the responses so far are returned
        if(resRec.type === 'fail'){
            alertError(`Failed to fetch model response after tool execution`)
            return {
                type: 'success',
                result: result
            }
        } else if(resRec.type === 'success'){
            return {
                type: 'success',
                result: result + '\n\n' + resRec.result
            }
        }
        
        return resRec
    }
    
    const result = processTextResponse(rDatas)

    // fail if the result is empty
    if(!result) {
        return {
            type: 'fail',
            result: fillLang(language.errors.googleEmptyResponse, { response: JSON.stringify(resData) })
        }
    }

    console.log(result)
    return {
        type: 'success',
        result: result
    }
}

function getTranStream(args:{
    modelInfo:LLMModel,
    saveSignature:boolean
    usage?:UsageMeter
}):TransformStream<Uint8Array, StreamResponseChunk> {
    const { modelInfo, saveSignature } = args
    return geminiStreamTransform({
        saveSignatures: saveSignature,
        signatureSource: modelInfo.internalID || modelInfo.id,
        signatureFormat: modelInfo.format,
    }, {
        onUsage: (usage) => args.usage?.report(usage),
        // Its a promise, but we don't need to await it here
        onSignature: ({ id, signature }) => {
            saveInlayedSignature(id, signature).catch((error) => console.error('The Gemini signature could not be saved:', error))
        },
    })
}

export const __testGeminiStream = { getTranStream }

function wrapToolStream(
    stream: ReadableStream<StreamResponseChunk>,
    body:any,
    headers:Record<string,string>,
    url:string,
    arg:RequestDataArgumentExtended,
    // The rule the stream was bound and read with: extraction and thoughts follow it, as a recovered record does.
    rule:GeminiReadRule,
    ownedKey?:string
):ReadableStream<StreamResponseChunk> {
    return new ReadableStream<StreamResponseChunk>({
        async start(controller) {

            const db = getDatabase()
            let reader = stream.getReader()
            let prefix = ''
            let lastValue = initGeminiStreamState()

            while(true){
                let {done, value} = await reader.read()

                value = initGeminiStreamState(value)

                value["0"] = extractGeminiContent(value["0"], rule, arg.subject)

                let content = value["0"]
                let thoughts = value["__thoughts"]
                let lastThought = value["__last_thought"]
                let signText = value["__sign_text"]
                let signFunction = value["__sign_function"]

                if(done){
                    value = initGeminiStreamState(lastValue)

                    content = value["0"]
                    thoughts = value["__thoughts"]
                    lastThought = value["__last_thought"]

                    // thoughtSignatures 
                    signText = value["__sign_text"]
                    signFunction = value["__sign_function"]

                    const calls = JSON.parse(value["__tool_calls"]) as GeminiFunctionCall[]
                    if(calls && calls.length > 0){
                        if(ownedKey !== undefined){
                            // Round 1's request has ended and its record is not the reply: it is removed before the follow-up.
                            await retireOwnedStream(ownedKey)
                        }
                        const round = beginToolRound(arg)
                        if(round !== 'go'){
                            return endStreamForGate(controller, round)
                        }
                        const chat = body.contents as GeminiChat[]

                        // Add the model response part to the request content (only function calls if simplifiedToolUse is enabled)
                        if(db.simplifiedToolUse){
                            chat.push({
                                role: 'model',
                                parts: calls.map((call) => {
                                    return {
                                        functionCall: {
                                            name: call.name,
                                            args: call.args
                                        }
                                    } as GeminiPart
                                })
                            })
                        }
                        // Add the model response part to the request content (text response and function calls)
                        else{
                            chat.push({
                                role: 'model',
                                parts: [{
                                    text: content,
                                    ...(signText ? { thoughtSignature: signText } : {})
                                } as GeminiPart]
                                .concat(
                                    calls.map((call, index) => ({
                                        functionCall: {
                                            name: call.name,
                                            args: call.args
                                        },
                                        ...(index === 0 && signFunction ? { thoughtSignature: signFunction } : {})
                                    } as GeminiPart))
                                )
                            })
                        }
                        // If the last part is a model response, merge it with the previous model response
                        if(chat[chat.length - 2]?.role === 'model') {
                            chat[chat.length - 2].parts = chat[chat.length - 2].parts.concat(chat[chat.length - 1].parts)
                            chat.pop() 
                        }
                        const parts: GeminiPart[] = []
                        const callCodes: string[] = []
                        const tools = arg?.tools ?? []
                        // Handle tool calls
                        for(const call of calls){
                            const blockGate = toolBlockGate(arg)
                            if(blockGate !== 'go'){
                                return endStreamForGate(controller, blockGate)
                            }
                            const functionName = call.name
                            const functionArgs = call.args
                            const tool = tools.find((t) => t.name === functionName)
                            if(tool){
                                const result = (await callTool(tool.name, functionArgs, {subject: arg.subject, mcpURL: tool.mcpURL, toolLoop: arg.toolLoop})).filter((r) => {
                                    return r.type === 'text'
                                })
                                if(result.length === 0){
                                    parts.push({
                                        functionResponse: {
                                            name: call.name,
                                            response: 'No response from tool.'
                                        }
                                    })
                                }
                                // Store the encoded tool call history for later use
                                if(arg.rememberToolUsage){
                                    callCodes.push(await encodeToolCall({
                                        call: {
                                            id: call.id,
                                            name: call.name,
                                            arg: call.args
                                        },
                                        response: result
                                    }))
                                }
                                for(let i=0;i<result.length;i++){
                                    let response:any = result[i].text
                                    try {
                                        //try json parse
                                        response = {
                                            data: JSON.parse(response)
                                        }
                                    } catch (error) {
                                        response = {
                                            data: response
                                        }
                                    }
                                    parts.push({
                                        functionResponse: {
                                            name: call.name,
                                            response
                                        }
                                    })
                                }
                            }
                            else{
                                parts.push({
                                    functionResponse: {
                                        name: call.name,
                                        response: `Tool ${call.name} not found.`
                                    }
                                })
                            }
                        }
                        // Add the user response part to the request content (function responses)
                        chat.push({
                            parts: parts
                        })

                        body.contents = chat
                        
                        headers['Content-Type'] = 'application/json'

                        let resRec
                        let attempt = 0
                        let errorFlag = true
                        
                        do {
                            // The first attempt is also the gate before the follow-up request itself.
                            if(toolBlockGate(arg) !== 'go'){
                                break
                            }
                            attempt++
                            resRec = await fetchNative(url, {
                                headers: headers,
                                body: JSON.stringify(body),
                                method: 'POST',
                                chatId: arg.chatId,
                                signal: arg.abortSignal,
                                interceptor: 'gemini_tool'
                            })
                        
                            if(resRec.status == 200){
                                addFetchLog({
                                    body: body,
                                    response: "Streaming",
                                    success: true,
                                    url: url,
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

                        const transtream = getTranStream({
                            modelInfo: arg.modelInfo,
                            saveSignature: arg.saveSignatures ?? false,
                            usage: arg.usageMeter
                        })
                        resRec.body.pipeTo(transtream.writable).catch(() => {})

                        reader = transtream.readable.getReader()
                        // A follow-up stream that yields no chunk must end the reply, not replay this round's calls.
                        lastValue = initGeminiStreamState()

                        if(db.simplifiedToolUse) {
                            prefix += callCodes.join('\n\n')
                        }
                        else {
                            prefix += (thoughts + lastThought ? `<Thoughts>\n\n${thoughts + lastThought}\n\n</Thoughts>\n\n` : '')
                                + (content ? content + '\n\n' : '')
                                + callCodes.join('\n\n')
                        }

                        controller.enqueue({"0": prefix})
                        
                        continue
                    }

                    await notifyBodyInterceptors(() => value, 'meta_gemini_stream', arg.abortSignal)
                    return controller.close()
                }
                
                lastValue = value

                controller.enqueue({
                    "0": composeGeminiDisplay({ content, thoughts, lastThought }, rule.streamThoughts, prefix)
                })
            }
        }
    })
}
