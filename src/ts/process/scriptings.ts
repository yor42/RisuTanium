import { asBuffer } from 'src/ts/util';
import { getChatVar, getGlobalChatVar, setChatVar } from "../parser/chatVar.svelte";
import { hasher, type simpleCharacterArgument, risuChatParser } from "../parser/parser.svelte";
import { LuaEngine, LuaFactory } from "wasmoon";
import { getCurrentCharacter, getCurrentChat, getDatabase, setDatabase, type Chat, type character, type groupChat, type triggerscript } from "../storage/database.svelte";
import { get } from "svelte/store";
import { ReloadChatPointer, ReloadGUIPointer, selectedCharID } from "../stores.svelte";
import { alertSelect, alertError, alertInput, alertNormal, alertConfirm } from "../alert";
import { HypaProcesser } from "./memory/hypamemory";
import { generateAIImage, type ImageGenerationOptions } from "./stableDiff";
import { writeInlayImage, getInlayAsset } from "./files/inlays";
import type { OpenAIChat, MultiModal } from "./index.svelte";
import { requestChatData, type StreamResponseChunk } from "./request/request";
import { v4 } from "uuid";
import { getModuleLorebooks, getModuleTriggers } from "./modules";
import { Mutex } from "../mutex";
import { tokenize } from "../tokenizer";
import { fetchNative, readImage } from "../globalApi.svelte";
import { loadLoreBookV3Prompt, snapshotSubject } from './lorebook.svelte';
import { getPersonaPrompt, getUserName, getUserIcon, parseKeyValue } from '../util';
import { createRunSubject, type Origin, type RunSubject } from "./chatOrigin";
import { clearSupaMemoryIfEmpty, withSupaRepoint } from "./memory/supaResume";
let luaFactory:LuaFactory
let ScriptingSafeIds = new Set<string>()
let ScriptingEditDisplayIds = new Set<string>()
let ScriptingLowLevelIds = new Set<string>()
let lastRequestResetTime = 0
let lastRequestsCount = 0

interface BasicScriptingEngineState {
    code?: string;
    mutex: Mutex;
    chat?: Chat;
    // The call's own runner (the member in a group call, else the owner) and
    // origin subject, refreshed on every call -- never a value a `declareAPI`
    // closure captured when the engine was first built, which would go stale
    // the moment a later call reuses this same engine for a different
    // character or chat.
    char?: character|groupChat|simpleCharacterArgument;
    subject?: RunSubject | null;
    stopSending?: boolean;
    setVar?: (key:string, value:string) => boolean|void,
    getVar?: (key:string) => string,
}

/**
 * The chat a binding should act on: the origin's chat when the call carries
 * one, re-resolved at the moment of the call (never a reference held from
 * when the engine was built or from an earlier binding in this same call);
 * otherwise `state.chat`, set fresh on every call, for a caller that has no
 * origin to give.
 */
function currentChatFor(state: ScriptingEngineState): Chat | undefined {
    if (state.subject) {
        return state.subject.resolve()?.chat ?? undefined
    }
    return state.chat
}

/**
 * The owner the name/description/first-message/background bindings act on:
 * the origin's owner (the group itself, in a group call) when the call
 * carries one, re-resolved at the moment of the call; otherwise the current
 * selection, for a caller with no origin to give.
 */
function ownerFor(state: ScriptingEngineState): character | groupChat | undefined {
    if (state.subject) {
        return state.subject.resolve()?.owner
    }
    const db = getDatabase()
    const selectedChar = get(selectedCharID)
    return db.characters[selectedChar]
}

/**
 * Marks the call's own origin for save, in the same synchronous stretch as
 * the write it follows -- a write a binding makes before the Lua call's own
 * `await` must already be marked by the time that `await` suspends, not
 * only once the whole call later returns. A call with no origin marks
 * nothing, the same as `currentChatFor`/`ownerFor`'s selection fallback.
 */
function markWriteFor(state: ScriptingEngineState): void {
    state.subject?.mark()
}

/**
 * The chat a persona lookup (`getUserName`/`getUserIcon`/`getPersonaPrompt`)
 * should bind to: `undefined` with no origin, so those functions fall back
 * to the selection; the origin's own chat, or `null` when it did not
 * resolve, so a gone or ambiguous origin reads as no persona bound rather
 * than the selection's.
 */
function personaChatFor(state: ScriptingEngineState): Chat | null | undefined {
    if (!state.subject) {
        return undefined
    }
    return state.subject.resolve()?.chat ?? null
}

/**
 * The origin-bound default for Lua's `getChatVar` binding, used only for a
 * call that carries an origin and was given no explicit `getVar`. Same
 * semantics as `chatVar.svelte.ts`'s `getChatVar`: a `$`-prefixed key in the
 * chat's `scriptstate`, falling back to the call's own character's
 * `defaultVariables` and then the database's `templateDefaultVariables`,
 * then `'null'` -- except the chat is `currentChatFor(state)`, never the
 * selection, so a gone or ambiguous origin makes `chat` undefined and goes
 * through the same `defaultVariables`/`templateDefaultVariables`/`'null'`
 * fallback chain.
 */
function defaultGetVarFor(state: ScriptingEngineState, key: string): string {
    const chat = currentChatFor(state)
    const stateValue = chat?.scriptstate?.['$' + key]
    if (stateValue === undefined || stateValue === null) {
        const runnerVariables = (state.char as character | groupChat | undefined)?.defaultVariables ?? ''
        const defaultVariables = parseKeyValue(runnerVariables).concat(parseKeyValue(getDatabase().templateDefaultVariables))
        const findResult = defaultVariables.find((f) => f[0] === key)
        if (findResult) {
            return findResult[1]
        }
        return 'null'
    }
    return stateValue.toString()
}

/**
 * The origin-bound default for Lua's `setChatVar` binding, used only for a
 * call that carries an origin and was given no explicit `setVar`. Same
 * semantics as `chatVar.svelte.ts`'s `setChatVar` (a no-op, returning false,
 * when the value is unchanged), except the write lands on
 * `currentChatFor(state)` and is marked in the same synchronous stretch,
 * and a gone or ambiguous origin writes nothing.
 */
function defaultSetVarFor(state: ScriptingEngineState, key: string, value: string): boolean {
    const chat = currentChatFor(state)
    if (!chat) {
        return false
    }
    chat.scriptstate ??= {}
    const stateKey = '$' + key
    if (chat.scriptstate[stateKey] === value) {
        return false
    }
    chat.scriptstate[stateKey] = value
    markWriteFor(state)
    return true
}

interface LuaScriptingEngineState extends BasicScriptingEngineState {
    engine?: LuaEngine;
    type: 'lua';
}

interface PythonScriptingEngineState extends BasicScriptingEngineState {
    pyodide?: PyodideContext
    type: 'py';
}

type ScriptingEngineState = LuaScriptingEngineState | PythonScriptingEngineState;

let ScriptingEngines = new Map<string, ScriptingEngineState>()
let luaFactoryPromise: Promise<void> | null = null;
let pendingEngineCreations = new Map<string, Promise<ScriptingEngineState>>();

export async function runScripted(code:string, arg:{
    char?:character|groupChat|simpleCharacterArgument,
    chat?:Chat
    data?: string|OpenAIChat[],
    setVar?: (key:string, value:string) => boolean|void,
    getVar?: (key:string) => string,
    lowLevelAccess?: boolean,
    meta?: object,
    mode?: string,
    type?: 'lua'|'py'
    origin?: Origin,
}){
    const type: 'lua'|'py' = arg.type ?? 'lua'
    const char = arg.char ?? getCurrentCharacter()
    const data = arg.data ?? ''
    const meta = arg.meta ?? {}
    const mode = arg.mode ?? 'manual'

    let chat = arg.chat ?? getCurrentChat()
    let stopSending = false
    let lowLevelAccess = arg.lowLevelAccess ?? false

    if(type === 'lua'){
        await ensureLuaFactory()
    }
    let ScriptingEngineState = await getOrCreateEngineState(mode, type);

    // A call with an origin and no explicit override resolves `setChatVar`/
    // `getChatVar` through it, never the selection; a call with no origin
    // keeps the selection-bound defaults. An explicit `setVar`/`getVar` always
    // wins over either default: `triggerlua` passes both, and
    // `runLuaEditTrigger` passes a `getVar` for a send subject.
    const setVar = arg.setVar ?? (arg.origin
        ? (key: string, value: string) => defaultSetVarFor(ScriptingEngineState, key, value)
        : setChatVar)
    const getVar = arg.getVar ?? (arg.origin
        ? (key: string) => defaultGetVarFor(ScriptingEngineState, key)
        : getChatVar)

    return await ScriptingEngineState.mutex.runExclusive(async () => {
        ScriptingEngineState.chat = chat
        ScriptingEngineState.char = char
        ScriptingEngineState.subject = arg.origin ? createRunSubject(arg.origin) : null
        ScriptingEngineState.stopSending = false
        ScriptingEngineState.setVar = setVar
        ScriptingEngineState.getVar = getVar
        if (code !== ScriptingEngineState.code) {
            let declareAPI:(name: string, func:Function) => void

            if(ScriptingEngineState.type === 'lua'){
                console.log('Creating new Lua engine for mode:', mode)
                ScriptingEngineState.engine?.global.close()
                ScriptingEngineState.code = code
                ScriptingEngineState.engine = await luaFactory.createEngine({injectObjects: true})
                const luaEngine = ScriptingEngineState.engine
                declareAPI = (name:string, func:Function) => {
                    luaEngine.global.set(name, func)
                }
            }
            if(ScriptingEngineState.type === 'py'){
                console.log('Creating new Pyodide context for mode:', mode)
                ScriptingEngineState.pyodide?.close()
                ScriptingEngineState.pyodide = new PyodideContext()
                declareAPI = (name:string, func:Function) => {
                    ScriptingEngineState.pyodide?.declareAPI(name, func as any)
                }
            }
            declareAPI('getChatVar', (id:string,key:string) => {
                return ScriptingEngineState.getVar(key)
            })
            declareAPI('setChatVar', (id:string,key:string, value:string) => {
                if(!ScriptingSafeIds.has(id) && !ScriptingEditDisplayIds.has(id)){
                    return
                }
                ScriptingEngineState.setVar(key, value)
            })
            declareAPI('setChatVarChanged', (id:string,key:string, value:string) => {
                if(!ScriptingSafeIds.has(id) && !ScriptingEditDisplayIds.has(id)){
                    return
                }
                if(ScriptingEngineState.setVar(key, value) === true){
                    return true
                }
            })
            declareAPI('getGlobalVar', (id:string, key:string) => {
                return getGlobalChatVar(key, ScriptingEngineState.subject)
            })
            declareAPI('stopChat', (id:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                ScriptingEngineState.stopSending = true
            })
            declareAPI('alertError', (id:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                alertError(value)
            })
            declareAPI('alertNormal', (id:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                alertNormal(value)
            })
            declareAPI('alertInput', (id:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                return alertInput(value)
            })
            declareAPI('alertSelect', (id:string, value:string[]) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                return alertSelect(value)
            })
            declareAPI('alertConfirm', (id:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                return alertConfirm(value).then(res => res ? true : false)
            })

            declareAPI('getChatMain', (id:string, index:number) => {
                const chat = currentChatFor(ScriptingEngineState)?.message.at(index)
                if(!chat){
                    return JSON.stringify(null)
                }
                const data = {
                    role: chat.role,
                    data: chat.data,
                    time: chat.time ?? 0
                }
                return JSON.stringify(data)
            })

            declareAPI('getChatData', (id:string, index:number) => {
                const chat = currentChatFor(ScriptingEngineState)?.message.at(index)
                return chat?.data ?? ''
            })

            declareAPI('getChatRole', (id:string, index:number) => {
                const chat = currentChatFor(ScriptingEngineState)?.message.at(index)
                return chat?.role ?? ''
            })

            declareAPI('getRecentChatsMain', (id:string, count:number) => {
                const chats = currentChatFor(ScriptingEngineState)?.message ?? []
                const safeCount = Math.max(0, Math.floor(count || 0))
                const start = Math.max(0, chats.length - safeCount)
                return JSON.stringify(chats.slice(start).map((v) => ({
                    role: v.role,
                    data: v.data,
                    time: v.time ?? 0,
                })))
            })

            declareAPI('setChat', (id:string, index:number, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const message = currentChatFor(ScriptingEngineState)?.message?.at(index)
                if(message){
                    message.data = value ?? ''
                    markWriteFor(ScriptingEngineState)
                }
            })
            declareAPI('setChatRole', (id:string, index:number, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const message = currentChatFor(ScriptingEngineState)?.message?.at(index)
                if(message){
                    message.role = value === 'user' ? 'user' : 'char'
                    markWriteFor(ScriptingEngineState)
                }
            })
            declareAPI('cutChat', (id:string, start:number, end:number) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const target = currentChatFor(ScriptingEngineState)
                if(target){
                    withSupaRepoint(target, () => {
                        target.message = target.message.slice(start,end)
                    })
                    markWriteFor(ScriptingEngineState)
                }
            })
            declareAPI('removeChat', (id:string, index:number) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const target = currentChatFor(ScriptingEngineState)
                if(target){
                    withSupaRepoint(target, () => {
                        target.message.splice(index, 1)
                    })
                    markWriteFor(ScriptingEngineState)
                }
            })
            declareAPI('addChat', (id:string, role:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                let roleData:'user'|'char' = role === 'user' ? 'user' : 'char'
                const target = currentChatFor(ScriptingEngineState)
                if(target){
                    target.message.push({role: roleData, data: value ?? ''})
                    markWriteFor(ScriptingEngineState)
                }
            })
            declareAPI('insertChat', (id:string, index:number, role:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                let roleData:'user'|'char' = role === 'user' ? 'user' : 'char'
                const target = currentChatFor(ScriptingEngineState)
                if(target){
                    target.message.splice(index, 0, {role: roleData, data: value ?? ''})
                    markWriteFor(ScriptingEngineState)
                }
            })

            declareAPI('getTokens', async (id:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                return await tokenize(value)
            })

            declareAPI('getChatLength', (id:string) => {
                return currentChatFor(ScriptingEngineState)?.message.length ?? 0
            })

            declareAPI('getFullChatMain', (id:string) => {
                const data = JSON.stringify((currentChatFor(ScriptingEngineState)?.message ?? []).map((v) => {
                    return {
                        role: v.role,
                        data: v.data,
                        time: v.time ?? 0
                    }
                }))
                return data
            })

            declareAPI('sleep', (id:string, time:number) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(true)
                    }, time)
                })
            })

            declareAPI('cbs', (value) => {
                return risuChatParser(value, { chara: ownerFor(ScriptingEngineState), subject: ScriptingEngineState.subject })
            })
            
            declareAPI('setFullChatMain', (id:string, value:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const realValue = JSON.parse(value)
                const target = currentChatFor(ScriptingEngineState)
                if(!target){
                    return
                }

                target.message = realValue.map((v) => {
                    return {
                        role: v.role,
                        data: v.data
                    }
                })
                clearSupaMemoryIfEmpty(target)
                markWriteFor(ScriptingEngineState)
            })

            declareAPI('logMain', (value:string) => {
                console.log(JSON.parse(value))
            })

            declareAPI('reloadDisplay', (id:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
            })

            declareAPI('reloadChat', (id: string, index: number) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                ReloadChatPointer.update((v) => {
                    v[index] = (v[index] ?? 0) + 1
                    return v
                })
            })

            //Low Level Access
            declareAPI('similarity', async (id:string, source:string, value:string[]) => {
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }
                const processer = new HypaProcesser()
                await processer.addText(value)
                return await processer.similaritySearch(source)
            })

            declareAPI('request', async (id:string, url:string) => {
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }

                if(lastRequestResetTime + 60000 < Date.now()){
                    lastRequestsCount = 0
                    lastRequestResetTime = Date.now()
                }
                
                if(lastRequestsCount > 5){
                    return JSON.stringify({
                        status: 429,
                        data: 'Too many requests. you can request 5 times per minute'
                    })
                }

                lastRequestsCount++

                try {
                    //for security and other reasons, only get request in 120 char is allowed
                    if(url.length > 120){
                        return JSON.stringify({
                            status: 413,
                            data: 'URL to large. max is 120 characters'
                        })
                    }

                    if(!url.startsWith('https://')){
                        return JSON.stringify({
                            status: 400,
                            data: "Only https requests are allowed"
                        })
                    }

                    const bannedURL = [
                        "https://realm.risuai.net",
                        "https://risuai.net",
                        "https://risuai.xyz"
                    ]

                    for(const burl of bannedURL){

                        if(url.startsWith(burl)){
                            return JSON.stringify({
                                status: 400,
                                data: "request to " + url + ' is not allowed'
                            })
                        }
                    }

                    //browser fetch
                    const d = await fetchNative(url, {
                        method: "GET"
                    })
                    const text = await d.text()
                    return JSON.stringify({
                        status: d.status,
                        data: text
                    })

                } catch (error) {
                    return JSON.stringify({
                        status: 400,
                        data: 'internal error'
                    })
                }
            })

            declareAPI('generateImage', async (id:string, value:string, negValue:string = '', options?:ImageGenerationOptions) => {
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }
                // A gone or ambiguous group member skips rather than
                // falling back to the group -- the runner is only usable
                // here when it is either not a group member at all, or a
                // member that still resolves.
                if(ScriptingEngineState.subject?.origin.memberChaId && ScriptingEngineState.subject.memberStatus() !== 'ok'){
                    return 'Error: Image generation failed'
                }
                const orientation = options?.orientation
                if(orientation !== undefined && orientation !== 'landscape' && orientation !== 'portrait'){
                    return 'Error: Image orientation must be landscape or portrait, received ' + orientation
                }

                const runner = ScriptingEngineState.char ?? char
                const gen = await generateAIImage(value, runner as character, negValue, 'inlay', options)
                if(!gen){
                    return 'Error: Image generation failed'
                }
                const imgHTML = new Image()
                imgHTML.src = gen
                const inlay = await writeInlayImage(imgHTML)
                return `{{inlay::${inlay}}}`
            })

            declareAPI('getCharacterImageMain', async (id:string) => {
                try {
                    const character = ownerFor(ScriptingEngineState)

                    if (!character || character.type === 'group' || !character.image) {
                        return ''
                    }

                    const img = await readImage(character.image)
                    const imgObj = new Image()
                    const extention = character.image.split('.').at(-1)

                    imgObj.src = URL.createObjectURL(new Blob([asBuffer(img)], {type: `image/${extention}`}))

                    const imgid = await writeInlayImage(imgObj, { name: character.image, ext: extention, id: character.image})

                    if (imgid) {
                        return `{{inlayed::${imgid}}}`
                    }
                    console.warn('Failed to create character image inlay')
                    return ''
                } catch (error) {
                    console.error('Error in getCharacterImageMain:', error)
                    return ''
                }
            })

            declareAPI('getPersonaImageMain', async (id:string) => {
                try {
                    const icon = getUserIcon(personaChatFor(ScriptingEngineState))

                    if(!icon) {
                        return ''
                    }

                    const img = await readImage(icon)
                    const imgObj = new Image()
                    const extention = icon.split('.').at(-1)

                    imgObj.src = URL.createObjectURL(new Blob([asBuffer(img)], {type: `image/${extention}`}))

                    const imgid = await writeInlayImage(imgObj, { name: icon, ext: extention, id: icon})

                    if (imgid) {
                        return `{{inlayed::${imgid}}}`
                    }
                    
                    console.warn('Failed to create character image inlay')
                    return ''
                } catch (error) {
                    console.error('Error in getCharacterImageMain:', error)
                    return ''
                }
            })

            declareAPI('hash', async (id:string, value:string) => {
                return await hasher(new TextEncoder().encode(value))
            })

            const parseLuaOptions = (optionsStr?: string) => {
                if (!optionsStr) {
                    return {};
                }

                try {
                    const parsed = JSON.parse(optionsStr);
                    return parsed && typeof parsed === 'object' ? parsed : {};
                } catch {
                    return {};
                }
            };

            const collectLuaStreamText = async (stream: ReadableStream<StreamResponseChunk>) => {
                const reader = stream.getReader();
                let text = '';

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            break;
                        }
                        if (value && typeof value['0'] === 'string') {
                            text = value['0'];
                        }
                    }
                } finally {
                    reader.releaseLock();
                }

                return text;
            };

            declareAPI('LLMMain', async (id:string, promptStr:string, useMultimodal: boolean = false, optionsStr: string = '') => {
                let prompt:{
                    role: string,
                    content: string
                }[] = JSON.parse(promptStr)
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }
                let promptbody:OpenAIChat[] = prompt.map((dict) => {
                    let role:'system'|'user'|'assistant' = 'assistant'
                    switch(dict['role']){
                        case 'system':
                        case 'sys':
                            role = 'system'
                            break
                        case 'user':
                            role = 'user'
                            break
                        case 'assistant':
                        case 'bot':
                        case 'char':{
                            role = 'assistant'
                            break
                        }
                    }

                    return {
                        content: dict['content'] ?? '',
                        role: role,
                    }
                })

                if(useMultimodal) {
                    for(const msg of promptbody) {
                        const inlays:string[] = []
                        msg.content = msg.content.replace(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g, (
                            match: string,
                            p1: string,
                            p2: string
                        ) => {
                            if(msg.role === 'assistant') {
                                if(p2 && p1 === 'inlayeddata') {
                                    inlays.push(p2)
                                }
                            }
                            else {
                                if(p2) {
                                    inlays.push(p2)
                                }
                            }
                            return ''
                        })
                        
                        const multimodals: MultiModal[] = []
                        for(const inlay of inlays) {
                            const inlayData = await getInlayAsset(inlay)
                            multimodals.push({
                                type: inlayData?.type,
                                base64: inlayData?.data,
                                width: inlayData?.width,
                                height: inlayData?.height
                            })
                        }

                        msg.multimodals = multimodals.length > 0 ? multimodals : undefined
                    }
                }

                const options = parseLuaOptions(optionsStr) as { streaming?: boolean }
                const result = await requestChatData({
                    formated: promptbody,
                    bias: {},
                    useStreaming: options.streaming === true,
                    forceStreaming: options.streaming === true,
                    noMultiGen: true,
                    subject: ScriptingEngineState.subject ?? undefined,
                }, 'model')

                if(result.type === 'fail'){
                    return JSON.stringify({
                        success: false,
                        result: 'Error: ' + result.result
                    })
                }

                if(result.type === 'streaming'){
                    try {
                        return JSON.stringify({
                            success: true,
                            result: await collectLuaStreamText(result.result)
                        })
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            result: 'Error: ' + error
                        })
                    }
                }

                if(result.type === 'multiline'){
                    return JSON.stringify({
                        success: false,
                        result: result.result
                    })
                }

                return JSON.stringify({
                    success: true,
                    result: result.result
                })
            })

            declareAPI('simpleLLM', async (id:string, prompt:string) => {
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }
                const result = await requestChatData({
                    formated: [{
                        role: 'user',
                        content: prompt
                    }],
                    bias: {},
                    useStreaming: false,
                    noMultiGen: true,
                    subject: ScriptingEngineState.subject ?? undefined,
                }, 'model')

                if(result.type === 'fail'){
                    return {
                        success: false,
                        result: 'Error: ' + result.result
                    }
                }

                if(result.type === 'streaming' || result.type === 'multiline'){
                    return {
                        success: false,
                        result: result.result
                    }
                }

                return {
                    success: true,
                    result: result.result
                }
            })
            
            declareAPI('getName', (id:string) => {
                return ownerFor(ScriptingEngineState)?.name
            })

            declareAPI('setName', (id:string, name:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                if(typeof name !== 'string'){
                    throw('Invalid data type')
                }
                const owner = ownerFor(ScriptingEngineState)
                if(!owner){
                    return
                }
                owner.name = name
                markWriteFor(ScriptingEngineState)
            })

            declareAPI('getDescription', (id:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const owner = ownerFor(ScriptingEngineState)
                if(!owner){
                    return
                }
                if(owner.type === 'group'){
                    throw('Character is a group')
                }
                return owner.desc
            })

            declareAPI('setDescription', (id:string, desc:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                if(typeof desc !== 'string'){
                    throw('Invalid data type')
                }
                const owner = ownerFor(ScriptingEngineState)
                if(!owner){
                    return
                }
                if(owner.type === 'group'){
                    throw('Character is a group')
                }
                owner.desc = desc
                markWriteFor(ScriptingEngineState)
            })

            declareAPI('getCharacterFirstMessage', (id:string) => {
                return ownerFor(ScriptingEngineState)?.firstMessage
            })

            declareAPI('setCharacterFirstMessage', (id:string, data:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                if(typeof data !== 'string'){
                    return false
                }
                const owner = ownerFor(ScriptingEngineState)
                if(!owner){
                    return false
                }
                owner.firstMessage = data
                markWriteFor(ScriptingEngineState)
                return true
            })

            declareAPI('getPersonaName', (id:string) => {
                return getUserName(personaChatFor(ScriptingEngineState))
            })

            declareAPI('getPersonaDescription', (id:string) => {
                const char = ownerFor(ScriptingEngineState)

                return risuChatParser(getPersonaPrompt(personaChatFor(ScriptingEngineState)), { chara: char, subject: ScriptingEngineState.subject })
            })

            declareAPI('getAuthorsNote', (id:string) => {
                return currentChatFor(ScriptingEngineState)?.note ?? ''
            })

            declareAPI('getBackgroundEmbedding', (id:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                const owner = ownerFor(ScriptingEngineState)
                return owner?.backgroundHTML
            })

            declareAPI('setBackgroundEmbedding', (id:string, data:string) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }
                if(typeof data !== 'string'){
                    return false
                }
                const owner = ownerFor(ScriptingEngineState)
                if(!owner){
                    return false
                }
                owner.backgroundHTML = data
                markWriteFor(ScriptingEngineState)
                return true
            })

            // Lore books
            declareAPI('getLoreBooksMain', (id:string, search:string) => {
                const selectedChar = ownerFor(ScriptingEngineState)
                if (!selectedChar || selectedChar.type !== 'character') {
                    return
                }

                const loreSources = [
                    currentChatFor(ScriptingEngineState)?.localLore ?? [],
                    selectedChar.globalLore,
                    getModuleLorebooks(ScriptingEngineState.subject)
                ]

                const found = []
                for (const source of loreSources) {
                    for (const b of source) {
                        if (b.comment === search) {
                            found.push({ ...b, content: risuChatParser(b.content, { chara: selectedChar, subject: ScriptingEngineState.subject }) })
                        }
                    }
                }

                return JSON.stringify(found)
            })

            type upsertLoreBookOptions = {
                alwaysActive?: boolean
                insertOrder?: number
                key?: string
                secondKey?: string
                regex?: boolean
            }

            declareAPI('upsertLocalLoreBook', (id:string, name:string, content:string, options:upsertLoreBookOptions) => {
                if(!ScriptingSafeIds.has(id)){
                    return
                }

                // The runner's own type gates this, read fresh every call --
                // never the `char` this closure was built with, which goes
                // stale the moment a later call reuses this same engine for
                // a different character. A group's member is always type
                // 'character', so a group run skips the check and instead
                // writes to the group's own chat below: that write must land
                // even when the member is gone or ambiguous.
                const runner = ScriptingEngineState.char ?? char
                const isGroupRun = !!ScriptingEngineState.subject?.origin.memberChaId
                if(!isGroupRun && runner.type !== 'character'){
                    return
                }

                const targetChat = currentChatFor(ScriptingEngineState)
                if(!targetChat){
                    return
                }

                const {
                    alwaysActive = false,
                    insertOrder = 100,
                    key = '',
                    regex = false,
                    secondKey = '',
                } = options

                const newLocalLoreBooks = targetChat.localLore.filter((book) => book.comment !== name)
                newLocalLoreBooks.push({
                    alwaysActive,
                    comment: name,
                    content: content,
                    insertorder: insertOrder,
                    mode: 'normal',
                    key,
                    secondkey: secondKey,
                    selective: !!secondKey,
                    useRegex: regex,
                })
                targetChat.localLore = newLocalLoreBooks
                markWriteFor(ScriptingEngineState)
            })

            declareAPI('loadLoreBooksMain', async (id:string, reserve:number) => {
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }

                const selectedChar = ownerFor(ScriptingEngineState)

                if (!selectedChar || selectedChar.type !== 'character') {
                    return
                }

                // Captured before `loadLoreBookV3Prompt`'s own awaits, so the
                // per-book parse below reads this call's one snapshot rather
                // than resolving again once the scan's `tokenize` awaits have
                // let the run's own memo go stale.
                const bookSubject = ScriptingEngineState.subject ? snapshotSubject(ScriptingEngineState.subject.resolve()) : undefined

                const fullLoreBooks = (await loadLoreBookV3Prompt(ScriptingEngineState.subject)).actives
                const db = getDatabase()
                const maxContext = db.maxContext - reserve
                if (maxContext < 0) {
                    return JSON.stringify([])
                }

                let totalTokens = 0
                const loreBooks = []

                for (const book of fullLoreBooks) {
                    const parsed = risuChatParser(book.prompt, { chara: selectedChar, subject: bookSubject }).trim()
                    if (parsed.length === 0) {
                        continue
                    }

                    const tokens = await tokenize(parsed)

                    if (totalTokens + tokens > maxContext) {
                        break
                    }
                    totalTokens += tokens
                    loreBooks.push({
                        data: parsed,
                        role: book.role === 'assistant' ? 'char' : book.role,
                    })
                }

                return JSON.stringify(loreBooks)
            })

            declareAPI('axLLMMain', async (id:string, promptStr:string, useMultimodal: boolean = false, optionsStr: string = '') => {
                let prompt:{
                    role: string,
                    content: string
                }[] = JSON.parse(promptStr)
                if(!ScriptingLowLevelIds.has(id)){
                    return
                }
                let promptbody:OpenAIChat[] = prompt.map((dict) => {
                    let role:'system'|'user'|'assistant' = 'assistant'
                    switch(dict['role']){
                        case 'system':
                        case 'sys':
                            role = 'system'
                            break
                        case 'user':
                            role = 'user'
                            break
                        case 'assistant':
                        case 'bot':
                        case 'char':{
                            role = 'assistant'
                            break
                        }
                    }

                    return {
                        content: dict['content'] ?? '',
                        role: role,
                    }
                })

                if(useMultimodal) {
                    for(const msg of promptbody) {
                        const inlays:string[] = []
                        msg.content = msg.content.replace(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g, (
                            match: string,
                            p1: string,
                            p2: string
                        ) => {
                            if(msg.role === 'assistant') {
                                if(p2 && p1 === 'inlayeddata') {
                                    inlays.push(p2)
                                }
                            }
                            else {
                                if(p2) {
                                    inlays.push(p2)
                                }
                            }
                            return ''
                        })
                        
                        const multimodals: MultiModal[] = []
                        for(const inlay of inlays) {
                            const inlayData = await getInlayAsset(inlay)
                            multimodals.push({
                                type: inlayData?.type,
                                base64: inlayData?.data,
                                width: inlayData?.width,
                                height: inlayData?.height
                            })
                        }

                        msg.multimodals = multimodals.length > 0 ? multimodals : undefined
                    }
                }

                const options = parseLuaOptions(optionsStr) as { mode?: string, streaming?: boolean }
                const modes = new Set(['emotion', 'memory', 'otherAx', 'submodel', 'translate'])
                const mode = options.mode ?? 'otherAx'
                if (!modes.has(mode)) {
                    return JSON.stringify({
                        result: 'Error: Invalid axLLM mode: ' + mode,
                        success: false
                    })
                }
                const result = await requestChatData({
                    formated: promptbody,
                    bias: {},
                    useStreaming: options.streaming === true,
                    forceStreaming: options.streaming === true,
                    noMultiGen: true,
                    subject: ScriptingEngineState.subject ?? undefined,
                }, mode as 'emotion' | 'memory' | 'otherAx' | 'submodel' | 'translate')

                if(result.type === 'fail'){
                    return JSON.stringify({
                        success: false,
                        result: 'Error: ' + result.result
                    })
                }

                if(result.type === 'streaming'){
                    try {
                        return JSON.stringify({
                            success: true,
                            result: await collectLuaStreamText(result.result)
                        })
                    } catch (error) {
                        return JSON.stringify({
                            success: false,
                            result: 'Error: ' + error
                        })
                    }
                }

                if(result.type === 'multiline'){
                    return JSON.stringify({
                        success: false,
                        result: result.result
                    })
                }

                return JSON.stringify({
                    success: true,
                    result: result.result
                })
            })

            declareAPI('getCharacterLastMessage', (id: string) => {
                // With an origin, re-resolved on every call, never the chat
                // object held since the call began -- a replacement of the
                // origin chat's slot during this call's own await must still
                // be seen here. With no origin, this is `state.chat`, fixed
                // for the whole call, so a replacement of that slot during
                // an await is not seen.
                const chat = currentChatFor(ScriptingEngineState)
                if (!chat) {
                    return ''
                }

                const selchar = ownerFor(ScriptingEngineState)

                let pointer = chat.message.length - 1
                while (pointer >= 0) {
                    if (chat.message[pointer].role === 'char') {
                        const messageData = chat.message[pointer].data
                        return messageData
                    }
                    pointer--
                }

                return selchar?.firstMessage
            })

            declareAPI('getUserLastMessage', (id: string) => {
                const chat = currentChatFor(ScriptingEngineState)
                if (!chat) {
                    return ''
                }

                let pointer = chat.message.length - 1
                while (pointer >= 0) {
                    if (chat.message[pointer].role === 'user') {
                        const messageData = chat.message[pointer].data
                        return messageData
                    }
                    pointer--
                }
                return ''
            })

            console.log('Running Lua code:', code)
            if(ScriptingEngineState.type === 'lua'){
                await ScriptingEngineState.engine?.doString(luaCodeWrapper(code))
            }
            if(ScriptingEngineState.type === 'py'){
                await ScriptingEngineState.pyodide?.init(code)
            }
            ScriptingEngineState.code = code
        }
        let accessKey = v4()
        if(mode === 'editDisplay'){
            ScriptingEditDisplayIds.add(accessKey)
        }
        else{
            ScriptingSafeIds.add(accessKey)
            if(lowLevelAccess){
                ScriptingLowLevelIds.add(accessKey)
            }
        }
        let res:any
        if(ScriptingEngineState.type === 'lua'){
            const luaEngine = ScriptingEngineState.engine
            try {
                switch(mode){
                    case 'input':{
                        const func = luaEngine.global.get('onInput')
                        if(func){
                            res = await func(accessKey)
                        }
                        break
                    }
                    case 'output':{
                        const func = luaEngine.global.get('onOutput')
                        if(func){
                            res = await func(accessKey)
                        }
                        break
                    }
                    case 'start':{
                        const func = luaEngine.global.get('onStart')
                        if(func){
                            res = await func(accessKey)
                        }
                        break
                    }
                    case 'onButtonClick':{
                        const func = luaEngine.global.get('onButtonClick')
                        if(func){
                            res = await func(accessKey, data)
                        }
                        break
                    }
                    case 'onFormSubmit':{
                        const func = luaEngine.global.get('onFormSubmit')
                        if(func){
                            res = await func(accessKey, data, JSON.stringify(meta))
                        }
                        break
                    }
                    case 'editRequest':
                    case 'editDisplay':
                    case 'editInput':
                    case 'editOutput':{
                        const func = luaEngine.global.get('callListenMain')
                        if(func){
                            // editDisplay takes a raw string, and must output a raw string
                            const directString = mode === 'editDisplay'
                            const value = directString ? data : JSON.stringify(data)
                            const serializedMeta = JSON.stringify(meta)

                            res = await func(mode, accessKey, value, serializedMeta)
                            if (!directString) {
                                res = JSON.parse(res)
                            }
                        }
                        break
                    }
                    default:{
                        const func = luaEngine.global.get(mode)
                        if(func){
                            res = await func(accessKey)
                        }
                        break
                    }
                }   
                if(res === false){
                    stopSending = true
                }
            } catch (error) {
                console.error(error)
            }
        }
        if(ScriptingEngineState.type === 'py'){
            switch(mode){
                case 'input':{
                    res = await ScriptingEngineState.pyodide?.python(`onInput('${accessKey}')`)
                    break
                }
                case 'output':{
                    res = await ScriptingEngineState.pyodide?.python(`onOutput('${accessKey}')`)
                    break
                }
                case 'start':{
                    res = await ScriptingEngineState.pyodide?.python(`onStart('${accessKey}')`)
                    break
                }
                case 'onButtonClick':{
                    res = await ScriptingEngineState.pyodide?.python(`onButtonClick('${accessKey}', '${data as string}')`)
                    break
                }
                case 'editRequest':
                case 'editDisplay':
                case 'editInput':
                case 'editOutput':{
                    res = await ScriptingEngineState.pyodide?.python(`callListenMain('${mode}', '${accessKey}', '${JSON.stringify(data)}', '${JSON.stringify(meta)}')`)
                    res = JSON.parse(res)
                    break
                }
                default:{
                    res = await ScriptingEngineState.pyodide?.python(`${mode}('${accessKey}')`)
                    break
                }
            }
        }
        ScriptingSafeIds.delete(accessKey)
        ScriptingLowLevelIds.delete(accessKey)
        chat = currentChatFor(ScriptingEngineState) ?? ScriptingEngineState.chat
        stopSending = stopSending || !!ScriptingEngineState.stopSending

        return {
            stopSending, chat, res
        }
    })
}

async function makeLuaFactory(){
    const _luaFactory = new LuaFactory()
    async function mountFile(name:string){
        let code = ''
        for(let i = 0; i < 3; i++){
            try {
                const res = await fetch('/lua/' + name)
                if(res.status >= 200 && res.status < 300){
                    code = await res.text()
                    break
                }
            } catch (error) {}
        }
        await _luaFactory.mountFile(name,code)
    }

    await mountFile('json.lua')
    luaFactory = _luaFactory
}

async function ensureLuaFactory() {
    if (luaFactory) return;
    
    if (luaFactoryPromise) {
        try {
            await luaFactoryPromise;
        } catch (error) {
            luaFactoryPromise = null;
        }
        return;
    }

    try {
        luaFactoryPromise = makeLuaFactory();
        await luaFactoryPromise;
    } finally {
        luaFactoryPromise = null;
    }
}

async function getOrCreateEngineState(
    mode: string, 
    type: 'lua'|'py'
): Promise<ScriptingEngineState> {
    let engineState = ScriptingEngines.get(mode);
    if (engineState) {
        return engineState;
    }
    
    let pendingCreation = pendingEngineCreations.get(mode);
    if (pendingCreation) {
        return pendingCreation;
    }
    
    const creationPromise = (() => {
        const engineState: ScriptingEngineState = {
            mutex: new Mutex(),
            type: type,
        };
        ScriptingEngines.set(mode, engineState);

        pendingEngineCreations.delete(mode);

        return Promise.resolve(engineState);
    })();
    
    pendingEngineCreations.set(mode, creationPromise);
    
    return creationPromise;
}

function luaCodeWrapper(code:string){
    return `
json = require 'json'

function getChat(id, index)
    return json.decode(getChatMain(id, index))
end

function getFullChat(id)
    return json.decode(getFullChatMain(id))
end

function getRecentChats(id, count)
    return json.decode(getRecentChatsMain(id, count))
end

function setFullChat(id, value)
    setFullChatMain(id, json.encode(value))
end

function log(value)
    logMain(json.encode(value))
end

function getLoreBooks(id, search)
    return json.decode(getLoreBooksMain(id, search))
end


function loadLoreBooks(id)
    return json.decode(loadLoreBooksMain(id):await())
end

function LLM(id, prompt, useMultimodal, options)
    useMultimodal = useMultimodal or false
    options = options or {}
    return json.decode(LLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function axLLM(id, prompt, useMultimodal, options)
    useMultimodal = useMultimodal or false
    options = options or {}
    return json.decode(axLLMMain(id, json.encode(prompt), useMultimodal, json.encode(options)):await())
end

function getCharacterImage(id)
    return getCharacterImageMain(id):await()
end

function getPersonaImage(id)
    return getPersonaImageMain(id):await()
end

local editRequestFuncs = {}
local editDisplayFuncs = {}
local editInputFuncs = {}
local editOutputFuncs = {}

function listenEdit(type, func)
    if type == 'editRequest' then
        editRequestFuncs[#editRequestFuncs + 1] = func
        return
    end

    if type == 'editDisplay' then
        editDisplayFuncs[#editDisplayFuncs + 1] = func
        return
    end

    if type == 'editInput' then
        editInputFuncs[#editInputFuncs + 1] = func
        return
    end

    if type == 'editOutput' then
        editOutputFuncs[#editOutputFuncs + 1] = func
        return
    end

    throw('Invalid type')
end

function getState(id, name)
    local escapedName = "__"..name
    return json.decode(getChatVar(id, escapedName))
end

function setState(id, name, value)
    local escapedName = "__"..name
    setChatVar(id, escapedName, json.encode(value))
end

function setStateChanged(id, name, value)
    local escapedName = "__"..name
    return setChatVarChanged(id, escapedName, json.encode(value))
end

function async(callback)
    return function(...)
        local co = coroutine.create(callback)
        local safe, result = coroutine.resume(co, ...)

        return Promise.create(function(resolve, reject)
            local checkresult
            local step = function()
                if coroutine.status(co) == "dead" then
                    local send = safe and resolve or reject
                    return send(result)
                end

                safe, result = coroutine.resume(co)
                checkresult()
            end

            checkresult = function()
                if safe and result == Promise.resolve(result) then
                    result:finally(step)
                else
                    step()
                end
            end

            checkresult()
        end)
    end
end

callListenMain = async(function(eventType, id, value, meta)
    local realValue = value
    local realMeta = json.decode(meta)

    if eventType == 'editDisplay' then
        local realValue = value
        for _, func in ipairs(editDisplayFuncs) do
            local output = func(id, realValue, realMeta)
            local outputType = type(output)
            if outputType == 'string' then
                realValue = output
            else
                print('Error: Lua editDisplay must return a string, received ' .. outputType)
            end
        end
        return realValue
    end

    realValue = json.decode(value)

    if eventType == 'editRequest' then
        for _, func in ipairs(editRequestFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if eventType == 'editInput' then
        for _, func in ipairs(editInputFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    if eventType == 'editOutput' then
        for _, func in ipairs(editOutputFuncs) do
            realValue = func(id, realValue, realMeta)
        end
    end

    return json.encode(realValue)
end)

${code}
`
}

/**
 * `sendSubject` is the caller's own address into the database (a send's). It
 * chooses which triggers run: the module list is the one of the chat it
 * resolves, never the selection's. The Lua itself is not given it. Its origin
 * is the same ids without the group member, and its chat variables are read
 * through a subject built from that origin alone, so that in a chat whose id
 * has two holders the Lua sees an empty chat and writes nothing, and in a
 * group its variable defaults come from the group. The text the triggers
 * return is used either way. `origin` alone is handed to the Lua as it is.
 */
export async function runLuaEditTrigger<T extends string|OpenAIChat[]>(char:character|groupChat|simpleCharacterArgument, mode:string, content:T, meta?:object, origin?:Origin, sendSubject?:RunSubject):Promise<T>{
    switch(mode){
        case 'editinput':
            mode = 'editInput'
            break
        case 'editoutput':
            mode = 'editOutput'
            break
        case 'editdisplay':
            mode = 'editDisplay'
            break
        case 'editprocess':
            return content
    }

    try {
        let data = content
        // Chosen here, before the module list is read -- an origin or a
        // subject makes the module selection follow it, never the selection,
        // for every trigger this call runs.
        const subject = sendSubject ?? (origin ? createRunSubject(origin) : undefined)

        const triggers = char.type === 'group' ? (getModuleTriggers(subject)) : (char.triggerscript.map((v): triggerscript => {
            return { ...v, lowLevelAccess: false }
        }).concat(getModuleTriggers(subject)))

        let luaOrigin = origin
        let luaSubject: RunSubject | undefined
        for(let trigger of triggers){
            if(trigger?.effect?.[0]?.type === 'triggerlua'){
                if(sendSubject && !luaSubject){
                    luaOrigin = { chaId: sendSubject.origin.chaId, chatId: sendSubject.origin.chatId }
                    luaSubject = createRunSubject(luaOrigin)
                }
                const varSubject = luaSubject
                const runResult = await runScripted(trigger.effect[0].code, {
                    char: char,
                    lowLevelAccess: false,
                    mode: mode,
                    data,
                    meta,
                    origin: luaOrigin,
                    getVar: varSubject ? (key: string) => getChatVar(key, varSubject) : undefined,
                })
                data = runResult.res ?? data
            }
        }


        return data
    } catch (error) {
        return content
    }
}

export async function runLuaButtonTrigger(char:character|groupChat|simpleCharacterArgument, data:string, origin?:Origin):Promise<any>{
    return await runLuaInteractionTrigger('button', char, data, undefined, origin)
}

export async function runLuaInteractionTrigger(type:'button'|'form', char:character|groupChat|simpleCharacterArgument, triggerKey:string, meta?:object, origin?:Origin):Promise<any>{
    const mode = type === 'button' ? 'onButtonClick' : 'onFormSubmit'

    let runResult
    try {
        const triggers = char.type === 'group' ? getModuleTriggers() : char.triggerscript.map<triggerscript>((v) => ({
            ...v,
            lowLevelAccess: char.type !== 'simple' ? char.lowLevelAccess ?? false : false
        })).concat(getModuleTriggers())

        for(let trigger of triggers){
            if(trigger?.effect?.[0]?.type === 'triggerlua'){
                runResult = await runScripted(trigger.effect[0].code, {
                    char,
                    data: triggerKey,
                    lowLevelAccess: trigger.lowLevelAccess,
                    meta,
                    mode,
                    origin,
                })
            }
        }
    } catch (error) {
        throw(error)
    }
    return runResult   
}

class PyodideContext{
    worker: Worker;
    apis: Record<string, (...args:any[]) => any> = {};
    inited: boolean = false;
    constructor(){
        this.worker = new Worker(new URL('./pyworker.ts', import.meta.url), {
            type: 'module'
        })
        this.worker.onmessage = (event:MessageEvent) => {
            if(event.data.type === 'call'){
                const { function: func, args, callId } = event.data;
                if(this.apis[func]){
                    this.apis[func](...args).then((result) => {
                        this.worker.postMessage({
                            type: 'functionResult',
                            callId: callId,
                            result: result
                        });
                    }).catch((error) => {
                        this.worker.postMessage({
                            type: 'error',
                            error: error.message,
                            id: callId
                        });
                    });
                } else {
                    this.worker.postMessage({
                        type: 'error',
                        error: `Function ${func} not found`,
                        id: callId
                    });
                }
            }
        }
    }
    declareAPI(name:string, func:(...args:any[]) => any){
        this.apis[name] = func;
    }
    async init(code:string){
        if(this.inited){
            return;
        }
        const id = crypto.randomUUID();
        return new Promise<void>((resolve, reject) => {
            this.worker.onmessage = (event:MessageEvent) => {
                if(event.data.id !== id){
                    return
                }

                if(event.data.type === 'init'){
                    this.inited = true;
                    resolve();
                } else if(event.data.type === 'error'){
                    reject(new Error(event.data.error));
                }
            };
            this.worker.postMessage({
                type: 'init',
                code: code,
                id: id,
                moduleFunctions: Object.keys(this.apis)
            });
        });
    }
    async python(call:string){
        const id = crypto.randomUUID();
        return new Promise<any>((resolve, reject) => {
            this.worker.onmessage = (event:MessageEvent) => {
                if(event.data.id !== id){
                    return
                }

                if(event.data.type === 'python'){
                    resolve(event.data.call);
                } else if(event.data.type === 'error'){
                    reject(new Error(event.data.error));
                }
            };
            this.worker.postMessage({
                type: 'python',
                call: call,
                id: id
            });
        });
    }
    close(){
        this.worker.terminate();
    }
}
