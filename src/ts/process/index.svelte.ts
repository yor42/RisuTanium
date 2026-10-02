import { get, writable } from "svelte/store";
import { type character, type groupChat, type MessageGenerationInfo, type Chat, type MessagePresetInfo, changeToPreset, type Message, type StreamingDisplayOptimizationMode } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { CharEmotion, selectedCharID } from "../stores.svelte";
import { ChatTokenizer, tokenize, tokenizeNum } from "../tokenizer";
import { language } from "../../lang";
import { alertError, alertToast } from "../alert";
import { parseChatML } from "../parser/chatML";
import { promptViewAt, promptViewOf, splitSentMessages, type PromptView, type SentMessages } from "../cbs";
import { loadLoreBookV3Prompt } from "./lorebook.svelte";
import { findCharacterbyId, getAuthorNoteDefaultText, getPersonaPrompt, isLastCharPunctuation, trimUntilPunctuation, parseToggleSyntax, prebuiltAssetCommand } from "../util";
import { requestChatData } from "./request/request";
import { stableDiff } from "./stableDiff";
import { processScript, processScriptFull, risuChatParser, type MessageLocator, type MessageRef } from "./scripts";
import { exampleMessage } from "./exampleMessages";
import { sayTTS } from "./tts";
import { supaMemory } from "./memory/supaMemory";
import { v4 } from "uuid";
import { groupOrder } from "./group";
import { runTrigger } from "./triggers";
import { HypaProcesser } from "./memory/hypamemory";
import { additionalInformations } from "./embedding/addinfo";
import { getInlayAsset } from "./files/inlays";
import { getGenerationModelString } from "./models/modelString";
import { runInlayScreen } from "./inlayScreen";
import { addRerolls } from "./prereroll";
import { runImageEmbedding } from "./transformers";
import { hanuraiMemory } from "./memory/hanuraiMemory";
import { hypaMemoryV2 } from "./memory/hypav2";
import { runLuaEditTrigger } from "./scriptings";
import { getModelInfo, LLMFlags } from "../model/modellist";
import { hypaMemoryV3 } from "./memory/hypav3";
import { getModuleAssets, getModuleToggles } from "./modules";
import { readImage } from "../globalApi.svelte";
import { pluginV2 } from "../plugins/plugins.svelte";
import { isColdChat } from "./coldstorageData";
import { markCharacterForSave } from "../storage/characterSaveMarks";
import { beginWork, createSendSubject, registerWork, resolveOriginWithHint, type Origin, type OriginContext, type SendSubject, type WorkHandle, type WorkStop } from "./chatOrigin";
import { noteTurnReached, publishUnit, releaseUnit } from "./generationOwnership.svelte";

export interface OpenAIChat{
    role: 'system'|'user'|'assistant'|'function'
    content: string
    memo?:string
    name?:string
    removable?:boolean
    attr?:string[]
    multimodals?: MultiModal[]
    thoughts?: string[]
    cachePoint?: boolean
}

async function runChatOutputListeners(char: any, chat: any, characterIndex: number, chatIndex: number, messageIndex: number){
    if(pluginV2.chatOutput.size === 0){
        return
    }

    const charSnapshot = $state.snapshot(char)
    const chatSnapshot = $state.snapshot(chat)
    for(const listener of pluginV2.chatOutput){
        try {
            await listener({
                char: charSnapshot,
                chat: chatSnapshot,
                characterIndex,
                chatIndex,
                messageIndex,
            })
        }
        catch(e) {
            console.error(e)
        }
    }
}

export interface MultiModal{
    type:'image'|'video'|'audio'|'signature'
    base64:string,
    height?:number,
    width?:number
}

export interface requestTokenPart{
    name:string
    tokens:number
}

/**
 * True exactly while one outermost `sendChat` call is in progress. That call
 * sets it when it is accepted and clears it when it settles; nothing else
 * writes it.
 */
export const doingChat = writable(false)
export const chatProcessStage = writable(0)
export const abortChat = writable(false)
export let requestTokenParts:{[key:string]:requestTokenPart[]} = {}

/**
 * Test-only observation of the positions a streamed reply's flush wrote at.
 * Not part of any plugin-facing surface, and free while no observer is set.
 */
export interface StreamFlushUse {
    origin: Origin
    hint: SendChatOriginHint
    replyId: string
    ownerIndex: number
    chatIndex: number
    memberIndex: number | null
    replyIndex: number
}

let streamFlushObserver: ((use: StreamFlushUse) => void) | null = null

let messageMapRebuilds = 0

/** Test-only count of the message-to-index maps the prompt pass has built. */
export function messageMapRebuildsForTests(): number {
    return messageMapRebuilds
}

export function resetMessageMapRebuildsForTests(): void {
    messageMapRebuilds = 0
}

/**
 * A locator for one prompt pass over a chat: on the first miss it maps every
 * message to its index once, and every hit is checked by identity. A message
 * absent from the map, or whose hit fails the check, counts as gone; the map
 * is never rebuilt, so finding the messages of a pass is linear in the chat.
 */
function createMessageLocator(): MessageLocator {
    let map: Map<Message, number> | null = null
    return {
        find(messages, message){
            if(map === null){
                messageMapRebuilds++
                map = new Map()
                for(let i = 0; i < messages.length; i++){
                    map.set(messages[i], i)
                }
            }
            const at = map.get(message)
            return at !== undefined && messages[at] === message ? at : -1
        }
    }
}

export function setStreamFlushObserverForTests(observer: ((use: StreamFlushUse) => void) | null): void {
    streamFlushObserver = observer
}

/**
 * The objects a caller read the origin's owner and chat through. They decide
 * which holder a write goes to when the origin's id has more than one, and are
 * never written to unless they are a current holder.
 */
export interface SendChatOriginHint {
    owner: character | groupChat
    chat: Chat
}

/**
 * A preview call's own output. The caller passes the object in
 * `SendChatArg.previewResult` and reads it after the call returns.
 */
export interface PreviewResult {
    body?: string
    formated?: OpenAIChat[]
    memberName?: string
    noSpeaker?: boolean
}

export interface SendChatArg {
    chatAdditonalTokens?:number,
    signal?:AbortSignal,
    continue?:boolean,
    usedContinueTokens?:number,
    preview?:boolean
    previewPrompt?:boolean
    /** Receives this call's preview output (see `PreviewResult`). */
    previewResult?: PreviewResult
    /**
     * The chat this send writes into, for a caller that already holds one.
     * Without it, one is captured from the chat on screen when the call starts.
     */
    origin?: Origin
    /** The objects `origin` was read through (see `SendChatOriginHint`). */
    originHint?: SendChatOriginHint
    /** Set by the auto-continue a send starts: the id of the reply it continues. */
    continueMessageId?: string
}

/**
 * What the outer `sendChat` establishes for one call and hands to
 * `sendChatBody`: the origin every write of the call is addressed to, the
 * objects it was read through, and the one subject that resolves it. Nothing
 * in the body addresses a write by a position taken earlier.
 */
interface SendChatCallContext {
    origin: Origin
    hint: SendChatOriginHint
    subject: SendSubject
}

interface SendChatEntry {
    context: SendChatCallContext
    handle: WorkHandle
}

/**
 * Applies the refusals that depend on the chat a call writes to, then fixes
 * that chat for the call. A call that carries an origin reads no selection to
 * choose its chat or to decide whether to run: its cold guard checks the
 * origin's chat, and an origin that does not resolve ends the call quietly. A call without one takes the chat on screen, and
 * nothing selected returns without a side effect. Returns null for every
 * refusal, and registers nothing for it.
 */
function enterSendChat(chatProcessIndex: number, arg: SendChatArg, stop?: WorkStop): SendChatEntry | null {
    let origin: Origin
    let hint: SendChatOriginHint
    let owner: character | groupChat
    let handle: WorkHandle | null = null

    if(arg.origin){
        const ctx = resolveOriginWithHint(arg.origin, arg.originHint)
        if(!ctx){
            return null
        }
        if(isColdChat(ctx.chat)){
            alertError(language.errors.coldStorageChatStillLoading)
            return null
        }
        origin = arg.origin
        owner = ctx.owner
        hint = arg.originHint ?? { owner: ctx.owner, chat: ctx.chat }
    }
    else{
        // CHORE-07: refuse to run against a chat whose first message
        // is still a live cold-storage pointer -- it has not finished loading
        // (or a load attempt failed and left the pointer in place), so nothing
        // in this function has real chat data to work with yet.
        const selected = DBState.db?.characters?.[get(selectedCharID)]
        const selectedChat = selected?.chats?.[selected.chatPage]
        if(isColdChat(selectedChat)){
            alertError(language.errors.coldStorageChatStillLoading)
            return null
        }
        if(!selected || !selectedChat){
            return null
        }
        handle = beginWork(selected, selectedChat, undefined, stop)
        if(!handle){
            return null
        }
        origin = handle.origin
        owner = selected
        hint = { owner: selected, chat: selectedChat }
    }

    if(chatProcessIndex >= 0 && owner.type === 'group' && !origin.memberChaId && owner.characters[chatProcessIndex]){
        origin = { ...origin, memberChaId: owner.characters[chatProcessIndex] }
        handle?.end()
        handle = null
    }
    handle ??= registerWork(origin, stop)

    return { context: { origin, hint, subject: createSendSubject(origin, hint) }, handle }
}

/**
 * Ends a call's registration and marks its origin's owner and member for save,
 * whatever the selection has moved to since: a write made mid-generation to a
 * character other than the selected one (hotkeys, Playground and Home buttons
 * all change selection without checking `doingChat`) would otherwise never be
 * saved.
 */
function settleSendChatCall(entry: SendChatEntry): void {
    entry.handle.end()
    markCharacterForSave(entry.context.origin.chaId)
    markCharacterForSave(entry.context.origin.memberChaId)
}

/**
 * Outer wrapper (CHORE-01). An outermost call is a unit: it owns `doingChat`
 * and the abort controller published as the unit in progress, from the moment
 * it is accepted until it settles. It is refused while another unit holds the
 * flag, when its caller's signal is already aborted, and by the refusals that
 * depend on the chat it writes to (a cold chat still loading, nothing
 * selected, an origin that is gone). A refused call changes neither the flag
 * nor the published controller and registers nothing.
 *
 * The flag check and the take happen in one synchronous stretch: nothing
 * between them may await, or two units could be accepted together.
 *
 * The call writes into a chat fixed at entry and is registered as writing to
 * it until it settles. The recursion inside `sendChatBody` (group turns,
 * auto-continue, resend) goes through `sendChatRecursion`, so it registers
 * and marks for itself but neither checks, sets nor clears the flag.
 *
 * Reports `true` only when the body did and the unit was not aborted, by its
 * caller's signal or by the busy button.
 */
export async function sendChat(chatProcessIndex = -1, arg: SendChatArg = {}): Promise<boolean> {
    chatProcessStage.set(0)
    if(get(doingChat) || arg.signal?.aborted){
        return false
    }
    // The registration carries this unit's abort, so a delete of the chat it
    // writes to stops this send alone, whatever else is running elsewhere.
    const unit = new AbortController()
    const entry = enterSendChat(chatProcessIndex, arg, () => unit.abort())
    if(!entry){
        return false
    }
    const callerSignal = arg.signal
    const relayAbort = () => unit.abort()
    try {
        callerSignal?.addEventListener('abort', relayAbort)
        publishUnit(unit)
        doingChat.set(true)
        const completed = await sendChatBody(chatProcessIndex, { ...arg, signal: unit.signal }, entry.context)
        return completed && !unit.signal.aborted
    } finally {
        try {
            callerSignal?.removeEventListener('abort', relayAbort)
            releaseUnit(unit)
            doingChat.set(false)
        } finally {
            settleSendChatCall(entry)
        }
    }
}

/**
 * A send's own recursion (a group's turns, an auto-continue, a resend): it
 * runs on its unit's flag and signal, so it neither checks, sets nor clears
 * the flag.
 */
async function sendChatRecursion(chatProcessIndex: number, arg: SendChatArg): Promise<boolean> {
    chatProcessStage.set(0)
    const entry = enterSendChat(chatProcessIndex, arg)
    if(!entry){
        return false
    }
    try {
        return await sendChatBody(chatProcessIndex, arg, entry.context)
    } finally {
        settleSendChatCall(entry)
    }
}

async function sendChatBody(chatProcessIndex = -1,arg:SendChatArg = {}, callCtx: SendChatCallContext):Promise<boolean> {

    const { origin, hint, subject } = callCtx
    const abortSignal = arg.signal ?? (new AbortController()).signal
    
    // NOTE: `throwError()` can be called before these are populated (e.g. HypaV3 early validation errors).
    // Keep them declared up-front to avoid TDZ ReferenceErrors in production builds.
    let currentChar:character
    let generationInfo:MessageGenerationInfo|undefined = undefined

    // The reply this call writes to: the message it continues, or the one it
    // appends. It is addressed by its id, never by a position. `replyMessage`
    // is the object the call tracked: it lets `locateReply` skip the search
    // while it is still at `replyIndex`, and picks the reply when more than one
    // message holds the id. A reply that goes missing drops only the writes
    // addressed to it; the call carries on.
    let replyId = undefined as string|undefined
    let replyMessage:Message|undefined = undefined
    let replyIndex = -1

    // What the parses that build the prompt carry: which messages of the chat
    // are not sent, and whether the first message is. It is rebuilt whenever
    // the list it describes is read anew, and the first message's decision,
    // once taken, is carried and never recomputed.
    let promptView!:PromptView
    let firstMessageDecision:boolean|undefined = undefined

    const stageTimings = {
        stage1Start: 0,
        stage2Start: 0,
        stage3Start: 0,
        stage4Start: 0,
        stage1Duration: 0,
        stage2Duration: 0,
        stage3Duration: 0,
        stage4Duration: 0
    }

    let isAborted = false
    let findCharCache:{[key:string]:character} = {}
    function findCharacterbyIdwithCache(id:string){
        const d = findCharCache[id]
        if(!!d){
            return d
        }
        else{
            const r = findCharacterbyId(id)
            findCharCache[id] = r
            return r
        }
    }

    // Ends the call quietly because its origin is gone: nothing more is
    // written or generated for it.
    function endGone():false{
        return false
    }

    function trackReply(chat:Chat, index:number){
        const message = chat.message[index]
        message.chatId ??= v4()
        replyId = message.chatId
        replyMessage = message
        replyIndex = index
    }

    // The index of the reply in `chat`, or -1 when it is gone (or, with more
    // than one message holding its id, none of them is the one this call
    // tracked). The last index found is reused only while that message is still
    // the tracked object and still carries the id.
    function locateReply(chat:Chat):number{
        if(replyId === undefined){
            return -1
        }
        const messages = chat.message
        if(replyMessage !== undefined && messages[replyIndex] === replyMessage && replyMessage.chatId === replyId){
            return replyIndex
        }
        let found = -1
        let hinted = -1
        let holders = 0
        for(let i = 0; i < messages.length; i++){
            if(messages[i].chatId === replyId){
                holders++
                found = i
                if(messages[i] === replyMessage){
                    hinted = i
                }
            }
        }
        if(holders === 0){
            return -1
        }
        if(holders > 1){
            if(hinted === -1){
                return -1
            }
            found = hinted
        }
        replyIndex = found
        return found
    }

    // The reply as the script pass's `@@` branches name it: the tracked
    // message and the index it is at now.
    function replyMessageRef(target:{ctx:OriginContext, index:number}):MessageRef{
        return {message: target.ctx.chat.message[target.index], index: target.index}
    }

    function resolveReply():{ctx:OriginContext, index:number, replyId:string}|null{
        if(replyId === undefined){
            return null
        }
        const ctx = subject.resolve()
        if(!ctx){
            return null
        }
        const index = locateReply(ctx.chat)
        if(index === -1){
            return null
        }
        return {ctx, index, replyId}
    }

    // The message a continue extends: the reply named by `continueMessageId`,
    // else the chat's last message.
    function continuedMessageIndex(chat:Chat):number{
        if(arg.continueMessageId){
            replyId = arg.continueMessageId
            replyMessage = undefined
            return locateReply(chat)
        }
        return chat.message.length - 1
    }

    // Re-assigns the finished timings onto the reply so its reactive copy sees
    // them; a missing reply is skipped. False only when the origin is gone.
    function writeReplyGenerationInfo():boolean{
        const target = resolveReply()
        if(!target){
            return subject.resolve() !== null
        }
        if(target.ctx.chat.message[target.index].generationInfo){
            target.ctx.chat.message[target.index].generationInfo = generationInfo
        }
        return true
    }

    function decideFirstMessageSent(resetAt:number):boolean{
        return nowChatroom.type !== 'group' && resetAt === -1
    }

    // Every message is expanded at its own chat index, hidden ones included, and
    // the result is written back.
    function runCurrentChatFunction():Chat|null{
        const ctx = subject.resolve()
        if(!ctx){
            return null
        }
        const split = splitSentMessages(ctx.chat.message)
        const view = promptViewOf(split, firstMessageDecision ?? decideFirstMessageSent(split.resetAt))
        promptView = view
        ctx.chat.message = ctx.chat.message.map((v, i) => {
            v.data = risuChatParser(v.data, {chara: currentChar, runVar: true, subject, promptView: promptViewAt(view, i)})
            return v
        })
        return ctx.chat
    }

    function reformatContent(data:string){
        if(chatProcessIndex === -1){
            return data.trim()
        }
        return data.trim()
    }

    function throwError(error:string){
        if(!DBState?.db?.inlayErrorResponse){
            alertError(error)
            return
        }

        try{
            const ctx = subject.resolve()
            if(!ctx || !Array.isArray(ctx.chat.message)){
                alertError(error)
                return
            }

            const messages = ctx.chat.message
            const last = messages[messages.length - 1]
            const suffix = `\n\`\`\`risuerror\n${error}\n\`\`\``

            // The error joins only the reply this call is producing or
            // continuing, so it never lands in a message before the call's own
            // output. A continue that fails before it tracks its reply names
            // that reply by id, or by being the chat's last message.
            let lastIsOwnReply = false
            if(last !== undefined){
                if(replyId !== undefined){
                    lastIsOwnReply = locateReply(ctx.chat) === messages.length - 1
                }
                else if(arg.continue){
                    lastIsOwnReply = !arg.continueMessageId || last.chatId === arg.continueMessageId
                }
            }

            if(last?.role === 'char' && lastIsOwnReply){
                last.data += suffix
                return
            }

            const m:Message = {
                role: 'char',
                data: `\`\`\`risuerror\n${error}\n\`\`\``,
                time: Date.now(),
            }
            if(currentChar?.chaId){
                m.saying = currentChar.chaId
            }
            if(generationInfo){
                m.generationInfo = generationInfo
            }
            messages.push(m)
            return
        }
        catch(e){
            console.error(e)
            alertError(error)
            return
        }
    }

    if(chatProcessIndex === -1 && DBState.db.presetChain){
        const names = DBState.db.presetChain.split(',').map((v) => v.trim())
        const randomSelect = Math.floor(Math.random() * names.length)
        const ele = names[randomSelect]

        const findId = DBState.db.botPresets.findIndex((v) => {
            return v.name === ele
        })

        if(findId === -1){
            alertToast(`Cannot find preset: ${ele}`)
        }
        else{
            changeToPreset(findId, true)
        }
    }

    if(origin.memberChaId){
        // A group turn speaks as the member the origin names, found by id when
        // the turn comes -- never by a position taken when the turn order was
        // made. A member who is gone, missing from the group's member list, or
        // held by two characters has no turn; one in cold storage is restored
        // first.
        const memberChaId = origin.memberChaId
        const turnCtx = subject.resolve()
        if(!turnCtx){
            return endGone()
        }
        if(turnCtx.owner.type !== 'group' || !turnCtx.owner.characters.includes(memberChaId)){
            return true
        }
        let memberStatus = subject.memberStatus()
        if(memberStatus === 'gone'){
            const holder = DBState.db.characters.find((c) => c.chaId === memberChaId) as character | undefined
            if(holder?.coldstorage){
                // Loaded on demand: the restore imports `characters.ts`, which
                // imports `doingChat` from this module, so a static import
                // would be a load-time cycle.
                const { restoreColdCharacterByChaId } = await import('./coldMemberRestore')
                if(!(await restoreColdCharacterByChaId(memberChaId))){
                    if(!subject.resolve()){
                        return endGone()
                    }
                    // A member that could not be restored has no turn, whether
                    // it was deleted or taken out of the group meanwhile (no
                    // alert) or its archive failed (`restoreColdCharacterByChaId`
                    // named it in an alert); the group's other members still
                    // speak, and a later turn tries the restore again.
                    return true
                }
                if(!subject.resolve()){
                    return endGone()
                }
                memberStatus = subject.memberStatus()
            }
        }
        if(memberStatus !== 'ok' || !subject.pinMember()){
            return true
        }
    }

    DBState.db.statics.messages += 1
    const entryCtx = subject.resolve()
    if(!entryCtx){
        return endGone()
    }
    const nowChatroom = entryCtx.owner
    nowChatroom.lastInteraction = Date.now()
    entryCtx.chat.message = entryCtx.chat.message.map((v) => {
        v.chatId = v.chatId ?? v4()
        return v
    })
    
    let promptInfo: MessagePresetInfo = {}
    let initialPresetNameForPromptInfo = null
    let initialPromptTogglesForPromptInfo: {
        key: string,
        value: string,
    }[] = []
    if(DBState.db.promptInfoInsideChat){
        initialPresetNameForPromptInfo = DBState.db.botPresets[DBState.db.botPresetsId]?.name ?? ''
        initialPromptTogglesForPromptInfo = parseToggleSyntax(DBState.db.customPromptTemplateToggle + getModuleToggles(subject))
            .flatMap(toggle => {
                const raw = DBState.db.globalChatVariables[`toggle_${toggle.key}`]
                if (toggle.type === 'select' || toggle.type === 'text') {
                    return [{ key: toggle.value, value: toggle.options[raw] }];
                }
                if (raw === '1') {
                    return [{ key: toggle.value, value: 'ON' }];
                }
                return [];
            })

        promptInfo = {
            promptName: initialPresetNameForPromptInfo,
            promptToggles: initialPromptTogglesForPromptInfo,
        }
    }

    let caculatedChatTokens = 0
    if(DBState.db.aiModel.startsWith('gpt')){
        caculatedChatTokens += 5
    }
    else{
        caculatedChatTokens += 3
    }

    if(nowChatroom.type === 'group'){
        if(chatProcessIndex === -1){
            const charNames =nowChatroom.characters.map((v) => findCharacterbyIdwithCache(v).name)

            const messages = entryCtx.chat.message
            const lastMessage = messages[messages.length-1]
            let order = nowChatroom.characters.map((v,i) => {
                return {
                    id: v,
                    talkness: nowChatroom.characterActive[i] ? nowChatroom.characterTalks[i] : -1,
                    index: i
                }
            }).filter((v) => {
                return v.talkness > 0
            })
            if(!nowChatroom.orderByOrder){
                order = groupOrder(order, lastMessage?.data).filter((v) => {
                    if(v.id === lastMessage?.saying){
                        return false
                    }
                    return true
                })
            }
            // A preview walks the same order as a real send and stops at the
            // first member whose call writes a result; a member passed over
            // (gone, duplicated, not in the group) writes none and the walk
            // goes on. Nothing is generated: the preview flags reach every
            // member call.
            const previewing = !!(arg.preview || arg.previewPrompt)
            const previewResult = arg.previewResult ?? {}
            for(let i=0;i<order.length;i++){
                if(abortSignal.aborted){
                    return false
                }
                const r = await sendChatRecursion(order[i].index, {
                    chatAdditonalTokens: caculatedChatTokens,
                    signal: abortSignal,
                    origin: { ...origin, memberChaId: order[i].id },
                    originHint: hint,
                    ...(previewing ? {
                        preview: arg.preview,
                        previewPrompt: arg.previewPrompt,
                        previewResult
                    } : {})
                })
                if(!r){
                    return false
                }
                if(previewing && (previewResult.body !== undefined || previewResult.formated !== undefined)){
                    previewResult.memberName = findCharacterbyIdwithCache(order[i].id).name
                    return true
                }
            }
            if(previewing){
                previewResult.noSpeaker = true
            }
            return true
        }
        else{
            const member = entryCtx.member
            if(!member){
                throwError(`cannot find character: ${origin.memberChaId}`)
                return false
            }
            currentChar = member
        }
    }
    else{
        currentChar = nowChatroom
    }
    noteTurnReached()

    let chatAdditonalTokens = arg.chatAdditonalTokens ?? caculatedChatTokens
    const tokenizer = new ChatTokenizer(chatAdditonalTokens, DBState.db.aiModel.startsWith('gpt') ? 'noName' : 'name')
    const parsedEntryChat = runCurrentChatFunction()
    if(!parsedEntryChat){
        return endGone()
    }
    let currentChat:Chat = parsedEntryChat
    let maxContextTokens = DBState.db.maxContext

    chatProcessStage.set(1)
    stageTimings.stage1Start = Date.now()
    let unformated = {
        'main':([] as OpenAIChat[]),
        'jailbreak':([] as OpenAIChat[]),
        'chats':([] as OpenAIChat[]),
        'lorebook':([] as OpenAIChat[]),
        'globalNote':([] as OpenAIChat[]),
        'authorNote':([] as OpenAIChat[]),
        'lastChat':([] as OpenAIChat[]),
        'description':([] as OpenAIChat[]),
        'postEverything':([] as OpenAIChat[]),
        'personaPrompt':([] as OpenAIChat[])
    }

    let promptTemplate = safeStructuredClone(DBState.db.promptTemplate)
    const usingPromptTemplate = !!promptTemplate
    if(promptTemplate){
        let hasPostEverything = false
        for(const card of promptTemplate){
            if(card.type === 'postEverything'){
                hasPostEverything = true
                break
            }
        }

        if(!hasPostEverything){
            promptTemplate.push({
                type: 'postEverything'
            })
        }
    }
    if(currentChar.utilityBot && (!(usingPromptTemplate && DBState.db.promptSettings.utilOverride))){
        promptTemplate = [
            {
              "type": "plain",
              "text": "",
              "role": "system",
              "type2": "main"
            },
            {
              "type": "description",
            },
            {
              "type": "lorebook",
            },
            {
              "type": "chat",
              "rangeStart": 0,
              "rangeEnd": "end"
            },
            {
              "type": "plain",
              "text": "",
              "role": "system",
              "type2": "globalNote"
            },
            {
                'type': "postEverything"
            }
        ]
    }

    if((!currentChar.utilityBot) && (!promptTemplate)){
        const mainp = currentChar.systemPrompt?.replaceAll('{{original}}', DBState.db.mainPrompt) || DBState.db.mainPrompt


        function formatPrompt(data:string){
            if(!data.startsWith('@@')){
                data = "@@system\n" + data
            }
            const parts = data.split(/@@@?(user|assistant|system)\n/);
  
            // Initialize empty array for the chat objects
            const chatObjects: OpenAIChat[] = [];
            
            // Loop through the parts array two elements at a time
            for (let i = 1; i < parts.length; i += 2) {
              const role = parts[i] as 'user' | 'assistant' | 'system';
              const content = parts[i + 1]?.trim() || '';
              chatObjects.push({ role, content });
            }

            return chatObjects;
        }

        unformated.main.push(...formatPrompt(risuChatParser(mainp + ((DBState.db.additionalPrompt === '' || (!DBState.db.promptPreprocess)) ? '' : `\n${DBState.db.additionalPrompt}`), {chara: currentChar, subject, promptView})))
    
        if(DBState.db.jailbreakToggle){
            unformated.jailbreak.push(...formatPrompt(risuChatParser(DBState.db.jailbreak, {chara: currentChar, subject, promptView})))
        }
    
        unformated.globalNote.push(...formatPrompt(risuChatParser(currentChar.replaceGlobalNote?.replaceAll('{{original}}', DBState.db.globalNote) || DBState.db.globalNote, {chara: currentChar, subject, promptView})))
    }

    let baseDescriptionPrompt:OpenAIChat|null = null
    let beforeDescriptionPrompts:OpenAIChat[] = []
    let afterDescriptionPrompts:OpenAIChat[] = []

    if(currentChat.note){
        unformated.authorNote.push({
            role: 'system',
            content: risuChatParser(currentChat.note, {chara: currentChar, subject, promptView})
        })
    }
    else if(getAuthorNoteDefaultText() !== ''){
        unformated.authorNote.push({
            role: 'system',
            content: risuChatParser(getAuthorNoteDefaultText(), {chara: currentChar, subject, promptView})
        })
    }

    if(DBState.db.chainOfThought && (!(usingPromptTemplate && DBState.db.promptSettings.customChainOfThought))){
        unformated.postEverything.push({
            role: 'system',
            content: `<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>`
        })
    }

    {
        let description = risuChatParser((DBState.db.promptPreprocess ? DBState.db.descriptionPrefix: '') + currentChar.desc, {chara: currentChar, subject, promptView})

        const additionalInfo = await additionalInformations(currentChar, currentChat, promptView)

        if(additionalInfo){
            description += '\n\n' + risuChatParser(additionalInfo, {chara: currentChar, subject, promptView})
        }

        if(currentChar.personality){
            description += risuChatParser("\n\nDescription of {{char}}: " + currentChar.personality, {chara: currentChar, subject, promptView})
        }

        if(currentChar.scenario){
            description += risuChatParser("\n\nCircumstances and context of the dialogue: " + currentChar.scenario, {chara: currentChar, subject, promptView})
        }

        baseDescriptionPrompt = {
            role: 'system',
            content: description
        }
        unformated.description.push(baseDescriptionPrompt)

        if(nowChatroom.type === 'group'){
            const systemMsg = `[Write the next reply only as ${currentChar.name}]`
            unformated.postEverything.push({
                role: 'system',
                content: systemMsg
            })
        }
    }

    const lorepmt = await loadLoreBookV3Prompt(subject, promptView)

    const positionRegex = /{{position::(.+?)}}/g
    const replaceposition = (text:string):{text:string, replaced:boolean} => {
        let replaced = false
        const result = text.replace(positionRegex, (match, p1) => {
            replaced = true
            const posMatch = 'pt_' + p1
            const matchingPrompts: string[] = []
            for (const v of lorepmt.actives) {
                if (v.pos === posMatch) {
                    matchingPrompts.push(v.prompt)
                }
            }
            return matchingPrompts.join('\n')
        })
        return {text: result, replaced}
    }

    // maxDepth controls how many levels of nesting are resolved. Currently set to 5, adjust if needed.
    const resolvePosition = (text:string, maxDepth:number = 5) => {
        let result = text
        for(let i=0; i<maxDepth;i++) {
            const r = replaceposition(result)
            result = r.text
            if(!r.replaced) break
        }
        result = result.replace(positionRegex, '')
        return result
    }

    const normalActives = lorepmt.actives.filter(v => {
        return v.pos === '' && v.inject === null
    })
    console.log(normalActives)

    for(const lorebook of normalActives){
        unformated.lorebook.push({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar, subject, promptView})
        })
    }

    const descActives = lorepmt.actives.filter(v => {
        return v.pos === 'after_desc' || v.pos === 'before_desc' || v.pos === 'personality' || v.pos === 'scenario'
    })

    for(const lorebook of descActives){
        const c = {
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar, subject, promptView})
        }
        if(lorebook.pos === 'before_desc'){
            beforeDescriptionPrompts.unshift(c)
            unformated.description.unshift(c)
        }
        else{
            afterDescriptionPrompts.push(c)
            unformated.description.push(c)
        }
    }

    // The block exists when the send's own chat's persona has a prompt: one
    // resolution and one read give both the gate and the text. A gone subject
    // reads the global persona, never the selection's.
    const personaPromptText = getPersonaPrompt(subject.resolve()?.chat ?? null)
    if(personaPromptText){
        unformated.personaPrompt.push({
            role: 'system',
            content: risuChatParser(personaPromptText, {chara: currentChar, subject, promptView})
        })
    }
    
    if(currentChar.inlayViewScreen){
        if(currentChar.viewScreen === 'emotion'){
            unformated.postEverything.push({
                role: 'system',
                content: currentChar.newGenData.emotionInstructions.replaceAll('{{slot}}', currentChar.emotionImages.map((v) => v[0]).join(', '))
            })
        }
        if(currentChar.viewScreen === 'imggen'){
            unformated.postEverything.push({
                role: 'system',
                content: currentChar.newGenData.instructions
            })
        }
    }

    const postEverythingLorebooks = lorepmt.actives.filter(v => {
        return v.pos === 'depth' && v.depth === 0 && v.role !== 'assistant'
    })
    for(const lorebook of postEverythingLorebooks){
        unformated.postEverything.push({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar, subject, promptView})
        })
    }

    //Since assistant needs to be prefill, we need to add assistant lorebooks after user/system lorebooks
    const postEverythingAssistantLorebooks = lorepmt.actives.filter(v => {
        return v.pos === 'depth' && v.depth === 0 && v.role === 'assistant'
    })

    const injectionLorebooks = lorepmt.actives.filter(v => {
        return v.inject && !v.inject.lore
    })

    const injectionLorePosSet = new Set<string>()
    for(const lorebook of injectionLorebooks){
        injectionLorePosSet.add(lorebook.inject.location)
    }
    
    for(const lorebook of postEverythingAssistantLorebooks){
        unformated.postEverything.push({
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar, subject, promptView})
        })
    }

    //await tokenize currernt
    let currentTokens = DBState.db.maxResponse
    let supaMemoryCardUsed = false
    
    //for unexpected error
    currentTokens += 50
    
    const positionParser = (text:string, loc:string) => {
        console.log(injectionLorePosSet)
        if(injectionLorePosSet.has(loc)){
            const matchings = injectionLorebooks.filter(v => {
                return v.inject.location === loc
            })
            for(const lore of matchings){
                switch(lore.inject.operation){
                    case 'append':{
                        text += ' ' + lore.prompt
                        break
                    }
                    case 'prepend':{
                        text = lore.prompt + ' ' + text
                        break
                    }
                    case 'replace':{
                        text = text.replace(lore.inject.param, lore.prompt)
                        break
                    }
                }
            }
        }

        return resolvePosition(text)
    }

    let hasCachePoint = false
    const convertPromptRole = {
        "system": "system",
        "user": "user",
        "bot": "assistant",
    } as const

    function applyPromptBlockRole(chats:OpenAIChat[], role?: 'user'|'bot'|'system'){
        console.log("Applying ", chats, role)
        if(!role){
            return
        }
        for(const chat of chats){
            chat.role = convertPromptRole[role]
        }
    }

    function getDescriptionPrompts(role?: 'user'|'bot'|'system'){
        const pmt = [
            ...safeStructuredClone(beforeDescriptionPrompts),
            ...(baseDescriptionPrompt ? [safeStructuredClone(baseDescriptionPrompt)] : []),
            ...safeStructuredClone(afterDescriptionPrompts)
        ]
        if(baseDescriptionPrompt){
            applyPromptBlockRole([pmt[beforeDescriptionPrompts.length]], role)
        }
        return pmt
    }

    if(promptTemplate){
        const template = promptTemplate

        async function tokenizeChatArray(chats:OpenAIChat[]){
            for(const chat of chats){
                const tokens = await tokenizer.tokenizeChat(chat)
                currentTokens += tokens
            }
        }

        for(const card of template){
            switch(card.type){
                case 'persona':{
                    let pmt = safeStructuredClone(unformated.personaPrompt)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content)
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'description':{
                    let pmt = getDescriptionPrompts(card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content)
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'authornote':{
                    let pmt = safeStructuredClone(unformated.authorNote)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content || card.defaultText || '')
                        }
                    }

                    await tokenizeChatArray(pmt)
                    break
                }
                case 'lorebook':{
                    await tokenizeChatArray(unformated.lorebook)
                    break
                }
                case 'postEverything':{
                    await tokenizeChatArray(unformated.postEverything)
                    if(usingPromptTemplate && DBState.db.promptSettings.postEndInnerFormat){
                        await tokenizeChatArray([{
                            role: 'system',
                            content: DBState.db.promptSettings.postEndInnerFormat
                        }])
                    }
                    break
                }
                case 'plain':
                case 'jailbreak':
                case 'cot':{
                    if((!DBState.db.jailbreakToggle) && (card.type === 'jailbreak')){
                        continue
                    }
                    if((!DBState.db.chainOfThought) && (card.type === 'cot')){
                        continue
                    }

                    const posType = card.type === 'plain' ? card.type2 : card.type
                    let content = positionParser(card.text, posType)

                    if(card.type2 === 'globalNote'){
                        if(currentChar.replaceGlobalNote){
                            content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll('{{original}}', content)
                        }
                        
                        if(currentChar.prebuiltAssetCommand && !card.text.includes('{{//@customimageinstruction}}')){
                            content += prebuiltAssetCommand
                        }
                        content = (risuChatParser(content, {chara: currentChar, role: card.role, subject, promptView}))
                    }
                    else if(card.type2 === 'main'){
                        content = (risuChatParser(content, {chara: currentChar, role: card.role, subject, promptView}))
                    }
                    else{
                        content = risuChatParser(content, {chara: currentChar, role: card.role, subject, promptView})
                    }

                    const prompt:OpenAIChat ={
                        role: convertPromptRole[card.role],
                        content: content
                    }

                    await tokenizeChatArray([prompt])
                    break
                }
                case 'chatML':{
                    let prompts = parseChatML(card.text, subject, promptView)
                    await tokenizeChatArray(prompts)
                    break
                }
                case 'chat':{
                    let start = card.rangeStart
                    let end = (card.rangeEnd === 'end') ? unformated.chats.length : card.rangeEnd
                    if(start === -1000){
                        start = 0
                        end = unformated.chats.length
                    }
                    if(start < 0){
                        start = unformated.chats.length + start
                        if(start < 0){
                            start = 0
                        }
                    }
                    if(end < 0){
                        end = unformated.chats.length + end
                        if(end < 0){
                            end = 0
                        }
                    }
                    
                    if(start >= end){
                        break
                    }
                    let chats = unformated.chats.slice(start, end)

                    if(usingPromptTemplate && DBState.db.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
                        chats = systemizeChat(chats)
                    }
                    await tokenizeChatArray(chats)
                    break
                }
                case 'memory':{
                    supaMemoryCardUsed = true
                    break
                }
                case 'cache':{
                    hasCachePoint = true
                    break
                }
            }
        }
    }
    else{
        for(const key in unformated){
            const chats = unformated[key] as OpenAIChat[]
            for(const chat of chats){
                currentTokens += await tokenizer.tokenizeChat(chat)
            }
        }
    }
    
    const examples = exampleMessage(currentChar, subject, promptView)

    for(const example of examples){
        currentTokens += await tokenizer.tokenizeChat(example)
    }

    let chats:OpenAIChat[] = examples

    if(!DBState.db.aiModel.startsWith('novelai') && !DBState.db?.promptSettings?.trimStartNewChat){
        chats.push({
            role: 'system',
            content: '[Start a new chat]',
            memo: "NewChat"
        })
    }

    
    let msReseted = false
    // The chat index of each message in `ms`, parallel to it.
    let msChatIndexes:number[] = []
    let sentSplit!:SentMessages
    const makeMs = (currentChat:Chat) => {
        sentSplit = splitSentMessages(currentChat.message)
        msReseted = sentSplit.resetAt !== -1
        msChatIndexes = sentSplit.chatIndexes
        return sentSplit.sent
    }

    let ms:Message[] = makeMs(currentChat)

    // Taken once, here; every later rule about the first message uses it.
    const firstMessageSent = decideFirstMessageSent(sentSplit.resetAt)
    firstMessageDecision = firstMessageSent
    promptView = promptViewOf(sentSplit, firstMessageSent)

    if(firstMessageSent){
        const firstMsg = currentChat.fmIndex === -1 ? nowChatroom.firstMessage : nowChatroom.alternateGreetings[currentChat.fmIndex]

        const chat:OpenAIChat = {
            role: 'assistant',
            content: await (processScript(nowChatroom,
                risuChatParser(firstMsg, {chara: currentChar, subject, promptView}),
            'editprocess', {}, undefined, subject, promptView))
        }

        if(usingPromptTemplate && DBState.db.promptSettings.sendName){
            chat.content = `${currentChar.name}: ${chat.content}`
            chat.attr = ['nameAdded']
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    
    console.log('Prepared messages for token calculation:', ms)

    if(abortSignal.aborted){
        return false
    }
    const triggerResult = await runTrigger(currentChar, 'start', {chat: currentChat, origin, promptFirstSent: firstMessageSent, signal: abortSignal})
    if(triggerResult){
        // A trigger run resolves the origin by id alone, so it writes nothing
        // while the id has two holders. This send goes on with the holder it
        // started from; it stops when the origin has no holder, or when it has
        // several and none is the object the send started from.
        const afterStart = subject.resolve()
        if(!afterStart){
            return false
        }
        currentChat = afterStart.chat
        ms = makeMs(currentChat)
        promptView = promptViewOf(sentSplit, firstMessageSent)
        currentTokens += triggerResult.tokens
        if(triggerResult.stopSending){
            return false
        }
    }
    if(abortSignal.aborted){
        return false
    }

    let index = 0
    // `index` is the position among the sent messages; it counts them for the
    // `<Thoughts>` depth. Every parse of a message reads its index in the chat,
    // and the `@@` branches find the message again by identity should the chat
    // shift.
    const messageLocator = createMessageLocator()
    for(const msg of ms){
        const chatIndex = msChatIndexes[index]
        let formatedChat = (await processScriptFull(nowChatroom,risuChatParser(msg.data, {chara: currentChar, role: msg.role, subject, promptView: promptViewAt(promptView, chatIndex)}), 'editprocess', chatIndex, {
            chatRole: msg.role,
        }, undefined, subject, {message: msg, index: chatIndex, locator: messageLocator}, promptView)).data
        let name = ''
        if(msg.role === 'char'){
            if(msg.saying){
                name = `${findCharacterbyIdwithCache(msg.saying).name}`
            }
            else{
                name = `${currentChar.name}`
            }
        }
        if(!msg.chatId){
            msg.chatId = v4()
        }
        let inlays:string[] = []
        if(msg.role === 'char'){
            formatedChat = formatedChat.replace(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g, (
                match: string,
                p1: string,
                p2: string
            ) => {
                if(p2 && p1 === 'inlayeddata'){
                    inlays.push(p2)
                }
                return ''
            })
        }
        else{
            const inlayMatch = formatedChat.match(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g)
            if(inlayMatch){
                for(const inlay of inlayMatch){
                    inlays.push(inlay)
                }
            }
        }

        let multimodal:MultiModal[] = []
        const modelinfo = getModelInfo(DBState.db.aiModel)
        if(inlays.length > 0){
            for(const inlay of inlays){
                const inlayName = inlay.replace('{{inlayed::', '').replace('{{inlay::', '').replace('}}', '').replace('{{inlayeddata::', '')
                const inlayData = await getInlayAsset(inlayName)
                if(inlayData?.type === 'image'){
                    if(modelinfo.flags.includes(LLMFlags.hasImageInput)){
                        multimodal.push({
                            type: 'image',
                            base64: inlayData.data,
                            width: inlayData.width,
                            height: inlayData.height
                        })
                    }
                    else{
                        const captionResult = await runImageEmbedding(inlayData.data) 
                        formatedChat += `[${captionResult[0].generated_text}]`
                    }
                }
                if(inlayData?.type === 'video' || inlayData?.type === 'audio'){
                    if(multimodal.length === 0){
                        multimodal.push({
                            type: inlayData.type,
                            base64: inlayData.data
                        })
                    }
                }
                if(inlayData?.type === 'signature'){
                    multimodal.push({
                        type: 'signature',
                        base64: inlayData.data
                    })
                }
                formatedChat = formatedChat.replace(inlay, '')
            }
        }

        let attr:string[] = []
        let role:'user'|'assistant'|'system' = msg.role === 'user' ? 'user' : 'assistant'

        if(
            (nowChatroom.type === 'group' && findCharacterbyIdwithCache(msg.saying).chaId !== currentChar.chaId) ||
            (nowChatroom.type === 'group' && DBState.db.groupOtherBotRole === 'assistant') ||
            (usingPromptTemplate && DBState.db.promptSettings.sendName)
        ){
            const form = DBState.db.groupTemplate || `<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`
            formatedChat = risuChatParser(form, {chara: findCharacterbyIdwithCache(msg.saying).name, subject, promptView: promptViewAt(promptView, chatIndex)}).replace('{{slot}}', formatedChat)
            switch(DBState.db.groupOtherBotRole){
                case 'user':
                case 'assistant':
                case 'system':
                    role = DBState.db.groupOtherBotRole
                    break
                default:
                    role = 'assistant'
                    break
            }
        }
        let thoughts:string[] = []
        const maxThoughtDepth = DBState.db.promptSettings?.maxThoughtTagDepth ?? -1
        formatedChat = formatedChat.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (match, p1) => {
            if(maxThoughtDepth === -1 || (maxThoughtDepth - ms.length) <= index){
                thoughts.push(p1)
            }
            return ''
        })

        const assetPromises:Promise<void>[] = []
        formatedChat = formatedChat.replace(/\{\{asset_?prompt::(.+?)\}\}/gmsiu, (match, p1) => {
            const moduleAssets = getModuleAssets(subject)
            const assets = (currentChar.additionalAssets ?? []).concat(moduleAssets)
            const asset = assets.find(v => {
                return v[0] === p1
            })
            if(asset){
                assetPromises.push((async () => {
                    const assetDataBuf = await readImage(asset[1])
                    multimodal.push({
                        type: "image",
                        base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`
                    })
                })())
            }
            else if(p1 === 'icon'){
                assetPromises.push((async () => {
                    const assetDataBuf = await readImage(currentChar.image ?? '')
                    multimodal.push({
                        type: "image",
                        base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`
                    })
                })())
            }
            return ''          
        })
        await Promise.all(assetPromises)

        const chat:OpenAIChat = {
            role: role,
            content: formatedChat,
            memo: msg.chatId,
            attr: attr,
            multimodals: multimodal,
            thoughts: thoughts
        }
        if(chat.multimodals.length === 0){
            delete chat.multimodals
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
        index++
    }
    console.log(JSON.stringify(chats, null, 2))

    const depthPrompts = lorepmt.actives.filter(v => {
        return (v.pos === 'depth' && v.depth > 0) || v.pos === 'reverse_depth'
    })

    for(const depthPrompt of depthPrompts){
        const chat:OpenAIChat = {
            role: depthPrompt.role,
            content: risuChatParser(resolvePosition(depthPrompt.prompt), {chara: currentChar, subject, promptView})
        }
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    
    if(abortSignal.aborted){
        return false
    }

    if(nowChatroom.supaMemory && (DBState.db.supaModelType !== 'none' || DBState.db.hanuraiEnable || DBState.db.hypav2 || DBState.db.hypaV3)){
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        chatProcessStage.set(2)
        stageTimings.stage2Start = Date.now()
        if(DBState.db.hanuraiEnable){
            const hn = await hanuraiMemory(chats, {
                currentTokens,
                maxContextTokens,
                tokenizer
            })

            if(hn === false){
                return false
            }

            chats = hn.chats
            currentTokens = hn.tokens
        }
        else if(DBState.db.hypav2){
            console.log("Current chat's hypaV2 Data: ", currentChat.hypaV2Data)
            const sp = await hypaMemoryV2(chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer, subject)
            if(sp.error){
                console.log(sp)
                throwError(sp.error)
                return false
            }
            chats = sp.chats
            currentTokens = sp.currentTokens
            const memoryCtx = subject.resolve()
            if(!memoryCtx){
                return endGone()
            }
            memoryCtx.chat.hypaV2Data = sp.memory ?? memoryCtx.chat.hypaV2Data
            currentChat = memoryCtx.chat
            console.log("[Expected to be updated] chat's HypaV2Data: ", currentChat.hypaV2Data)
        }
        else if(DBState.db.hypaV3){
            console.log("Current chat's hypaV3 Data: ", currentChat.hypaV3Data)
            const sp = await hypaMemoryV3(chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer, subject)
            if(sp.error){
                // Save new summary
                if (sp.memory) {
                    const errorMemoryCtx = subject.resolve()
                    if(errorMemoryCtx){
                        errorMemoryCtx.chat.hypaV3Data = sp.memory
                    }
                }
                console.log(sp)
                throwError(sp.error)
                return false
            }
            chats = sp.chats
            currentTokens = sp.currentTokens
            const memoryCtx = subject.resolve()
            if(!memoryCtx){
                return endGone()
            }
            memoryCtx.chat.hypaV3Data = sp.memory ?? memoryCtx.chat.hypaV3Data
            currentChat = memoryCtx.chat
            console.log("[Expected to be updated] chat's HypaV3Data: ", currentChat.hypaV3Data)
        }
        else{
            const sp = await supaMemory(chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer, {
                asHyper: DBState.db.hypaMemory
            }, subject)
            if(sp.error){
                throwError(sp.error)
                return false
            }
            chats = sp.chats
            currentTokens = sp.currentTokens
            const memoryCtx = subject.resolve()
            if(!memoryCtx){
                return endGone()
            }
            memoryCtx.chat.supaMemoryData = sp.memory ?? memoryCtx.chat.supaMemoryData
            console.log(memoryCtx.chat.supaMemoryData)
            memoryCtx.chat.lastMemory = sp.lastId ?? memoryCtx.chat.lastMemory;
        }
        stageTimings.stage2Duration = Date.now() - stageTimings.stage2Start
        chatProcessStage.set(1)
    }
    else{
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        while(currentTokens > maxContextTokens){
            if(chats.length <= 1){
                throwError(language.errors.toomuchtoken + "\n\nRequired Tokens: " + currentTokens)

                return false
            }

            currentTokens -= await tokenizer.tokenizeChat(chats[0])
            chats.splice(0, 1)
        }
        const lastMemoryCtx = subject.resolve()
        if(lastMemoryCtx){
            lastMemoryCtx.chat.lastMemory = chats[0].memo
        }
    }

    if(abortSignal.aborted){
        return false
    }

    let biases:[string,number][] = DBState.db.bias.concat(currentChar.bias).map((v) => {
        return [risuChatParser(v[0].replaceAll("\\n","\n").replaceAll("\\r","\r").replaceAll("\\\\","\\"), {chara: currentChar, subject, promptView}),v[1]]
    })

    let memories:OpenAIChat[] = []



    if(!promptTemplate){
        unformated.lastChat.push(chats[chats.length - 1])
        chats.splice(chats.length - 1, 1)
    }

    unformated.chats = chats.map((v) => {
        if(v.memo !== 'supaMemory' && v.memo !== 'hypaMemory'){
            v.removable = true
        }
        else if(supaMemoryCardUsed){
            memories.push(v)
            return {
                role: 'system',
                content: '',
            } as OpenAIChat
        }
        else{
            v.content = `<Previous Conversation>${v.content}</Previous Conversation>`
        }
        return v
    }).filter((v) => {
        return v.content.trim() !== '' || (v.multimodals && v.multimodals.length > 0)
    })

    for(const depthPrompt of depthPrompts){
        const chat:OpenAIChat = {
            role: depthPrompt.role,
            content: risuChatParser(resolvePosition(depthPrompt.prompt), {chara: currentChar, subject, promptView})
        }
        const depth = depthPrompt.pos === 'depth' ? (depthPrompt.depth) : (unformated.chats.length - depthPrompt.depth)
        unformated.chats.splice(depth,0,chat)
    }

    if(triggerResult){
        if(triggerResult.additonalSysPrompt.promptend){
            unformated.postEverything.push({
                role: 'system',
                content: triggerResult.additonalSysPrompt.promptend
            })
        }
        if(triggerResult.additonalSysPrompt.historyend){
            unformated.lastChat.push({
                role: 'system',
                content: triggerResult.additonalSysPrompt.historyend
            })
        }
        if(triggerResult.additonalSysPrompt.start){
            unformated.lastChat.unshift({
                role: 'system',
                content: triggerResult.additonalSysPrompt.start
            })
        }
    }

    
    //make into one

    let formated:OpenAIChat[] = []
    const formatOrder = safeStructuredClone(DBState.db.formatingOrder)
    if(formatOrder){
        formatOrder.push('postEverything')
    }

    //continue chat model
    if(arg.continue && (DBState.db.aiModel.startsWith('claude') || DBState.db.aiModel.startsWith('gpt') || DBState.db.aiModel.startsWith('openrouter') || DBState.db.aiModel.startsWith('reverse_proxy'))){
        unformated.postEverything.push({
            role: 'system',
            content: '[Continue the last response]'
        })
    }

    function pushPrompts(cha:OpenAIChat[]){
        for(const chat of cha){
            if(!chat.content.trim() && !(chat.multimodals && chat.multimodals.length > 0)){
                continue
            }
            if(!(DBState.db.aiModel.startsWith('gpt') || DBState.db.aiModel.startsWith('claude') || DBState.db.aiModel === 'openrouter' || DBState.db.aiModel === 'reverse_proxy')){
                formated.push(chat)
                continue
            }
            if(chat.role === 'system'){
                const endf = formated.at(-1)
                if(endf && endf.role === 'system' && endf.memo === chat.memo && endf.name === chat.name){
                    formated[formated.length - 1].content += '\n\n' + chat.content
                }
                else{
                    formated.push(chat)
                }
                formated.at(-1).content += ''
            }
            else{
                formated.push(chat)
            }
        }
    }

    let promptBodyformatedForChatStore: OpenAIChat[] = []
    function pushPromptInfoBody(role: "function" | "system" | "user" | "assistant", fmt: string, promptBody: OpenAIChat[]) {
        if(!fmt.trim()){
            return
        }
        promptBody.push({
            role: role,
            content: risuChatParser(fmt, {subject, promptView}),
        })
    }

    if(promptTemplate){
        const template = promptTemplate

        for(const card of template){
            switch(card.type){
                case 'persona':{
                    let pmt = safeStructuredClone(unformated.personaPrompt)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content)

                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt)
                    break
                }
                case 'description':{
                    let pmt = getDescriptionPrompts(card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content)
                            
                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt)
                    break
                }
                case 'authornote':{
                    let pmt = safeStructuredClone(unformated.authorNote)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(positionParser(card.innerFormat,card.type), {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content || card.defaultText || '')
                            
                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt)
                    break
                }
                case 'lorebook':{
                    pushPrompts(unformated.lorebook)
                    break
                }
                case 'postEverything':{
                    pushPrompts(unformated.postEverything)
                    if(usingPromptTemplate && DBState.db.promptSettings.postEndInnerFormat){
                        pushPrompts([{
                            role: 'system',
                            content: DBState.db.promptSettings.postEndInnerFormat
                        }])
                    }
                    break
                }
                case 'plain':
                case 'jailbreak':
                case 'cot':{
                    if((!DBState.db.jailbreakToggle) && (card.type === 'jailbreak')){
                        continue
                    }
                    if((!DBState.db.chainOfThought) && (card.type === 'cot')){
                        continue
                    }

                    const posType = card.type === 'plain' ? card.type2 : card.type
                    let content = positionParser(card.text, posType)

                    if(card.type2 === 'globalNote'){
                        if(currentChar.replaceGlobalNote){
                            content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll('{{original}}', content)
                        }
                        if(currentChar.prebuiltAssetCommand && !card.text.includes('{{//@customimageinstruction}}')){
                            content += prebuiltAssetCommand
                        }
                        content = (risuChatParser(content, {chara: currentChar, role: card.role, subject, promptView}))
                    }
                    else if(card.type2 === 'main'){
                        content = (risuChatParser(content, {chara: currentChar, role: card.role, subject, promptView}))
                    }
                    else{
                        content = risuChatParser(content, {chara: currentChar, role: card.role, subject, promptView})
                    }

                    const prompt:OpenAIChat ={
                        role: convertPromptRole[card.role],
                        content: content
                    }

                    if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat && card.type2 !== 'globalNote'){
                        pushPromptInfoBody(prompt.role, prompt.content, promptBodyformatedForChatStore)
                    }

                    pushPrompts([prompt])
                    break
                }
                case 'chatML':{
                    let prompts = parseChatML(card.text, subject, promptView)
                    pushPrompts(prompts)
                    break
                }
                case 'chat':{
                    let start = card.rangeStart
                    let end = (card.rangeEnd === 'end') ? unformated.chats.length : card.rangeEnd
                    if(start === -1000){
                        start = 0
                        end = unformated.chats.length
                    }
                    if(start < 0){
                        start = unformated.chats.length + start
                        if(start < 0){
                            start = 0
                        }
                    }
                    if(end < 0){
                        end = unformated.chats.length + end
                        if(end < 0){
                            end = 0
                        }
                    }
                    
                    if(start >= end){
                        break
                    }

                    let chats = unformated.chats.slice(start, end)
                    if(usingPromptTemplate && DBState.db.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
                        chats = systemizeChat(chats)
                    }
                    pushPrompts(chats)

                    if(DBState.db.automaticCachePoint && !hasCachePoint){
                        let pointer = formated.length - 1
                        let depthRemaining = 3
                        while(pointer >= 0){
                            if(depthRemaining === 0){
                                break
                            }
                            if(formated[pointer].role === 'user'){
                                formated[pointer].cachePoint = true
                                depthRemaining--
                            }
                            pointer--
                        }
                    }
                    break
                }
                case 'memory':{
                    let pmt = safeStructuredClone(memories)
                    applyPromptBlockRole(pmt, card.role2)
                    if(card.innerFormat && pmt.length > 0){
                        for(let i=0;i<pmt.length;i++){
                            pmt[i].content = risuChatParser(card.innerFormat, {chara: currentChar, subject, promptView}).replace('{{slot}}', pmt[i].content)

                            if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
                                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
                            }
                        }
                    }

                    pushPrompts(pmt)
                    break
                }
                case 'cache':{
                    let pointer = formated.length - 1
                    let depthRemaining = card.depth
                    while(pointer >= 0){
                        if(depthRemaining === 0){
                            break
                        }
                        if(formated[pointer].role === card.role || card.role === 'all'){
                            formated[pointer].cachePoint = true
                            depthRemaining--
                        }
                        pointer--
                    }
                    break
                }
            }
        }
    }
    else{
        for(let i=0;i<formatOrder.length;i++){
            const cha = unformated[formatOrder[i]]
            pushPrompts(cha)
        }
    }


    formated = formated.map((v) => {
        v.content = v.content.trim()
        return v
    })

    if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
        promptBodyformatedForChatStore = promptBodyformatedForChatStore.map((v) => {
            v.content = v.content.trim()
            return v
        })
    }


    if(currentChar.depth_prompt && currentChar.depth_prompt.prompt && currentChar.depth_prompt.prompt.length > 0){
        //depth_prompt
        const depthPrompt = currentChar.depth_prompt
        formated.splice(formated.length - depthPrompt.depth, 0, {
            role: 'system',
            content: risuChatParser(depthPrompt.prompt, {chara: currentChar, subject, promptView})
        })
    }

    formated = await runLuaEditTrigger(currentChar, 'editRequest', formated, undefined, undefined, subject)

    if(DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat){
        promptBodyformatedForChatStore = await runLuaEditTrigger(currentChar, 'editRequest', promptBodyformatedForChatStore, undefined, undefined, subject)
        promptInfo.promptText = promptBodyformatedForChatStore
    }

    //token rechecking
    let inputTokens = 0

    for(const chat of formated){
        inputTokens += await tokenizer.tokenizeChat(chat)
    }

    if(inputTokens > maxContextTokens){
        let pointer = 0
        while(inputTokens > maxContextTokens){
            if(pointer >= formated.length){
                throwError(language.errors.toomuchtoken + "\n\nAt token rechecking. Required Tokens: " + inputTokens)
                return false
            }
            if(formated[pointer].removable){
                inputTokens -= await tokenizer.tokenizeChat(formated[pointer])
                formated[pointer].content = ''
            }
            pointer++
        }
        formated = formated.filter((v) => {
            return v.content !== ''  || (v.multimodals && v.multimodals.length > 0)
        })
    }

    //estimate tokens
    let outputTokens = DBState.db.maxResponse
    if(inputTokens + outputTokens > maxContextTokens){
        outputTokens = maxContextTokens - inputTokens
    }
    const generationId = v4()
    const generationModel = getGenerationModelString()

    generationInfo = {
        model: generationModel,
        generationId: generationId,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        maxContext: maxContextTokens,
        stageTiming: {
            stage1: stageTimings.stage1Duration,
            stage2: stageTimings.stage2Duration,
            stage3: 0,
            stage4: 0
        }
    }

    chatProcessStage.set(3)
    stageTimings.stage3Start = Date.now()
    if(arg.preview){
        if(abortSignal.aborted){
            return false
        }
        if(arg.previewResult){
            arg.previewResult.formated = formated
        }
        return true
    }

    if(!subject.resolve()){
        return endGone()
    }

    const req = await requestChatData({
        formated: formated,
        biasString: biases,
        currentChar: currentChar,
        useStreaming: true,
        isGroupChat: nowChatroom.type === 'group',
        bias: {},
        continue: arg.continue,
        chatId: generationId,
        imageResponse: DBState.db.outputImageModal,
        previewBody: arg.previewPrompt,
        escape: nowChatroom.type === 'character' && nowChatroom.escapeOutput,
        rememberToolUsage: DBState.db.rememberToolUsage,
        subject,
    }, 'model', abortSignal)

    console.log(req)
    if(req.model){
        generationInfo.model = getGenerationModelString(req.model)
        console.log(generationInfo.model, req.model)
    }

    if(arg.previewPrompt && req.type === 'success'){
        if(arg.previewResult){
            arg.previewResult.body = req.result
        }
        return true
    }

    let result = ''
    let emoChanged = false
    let resendChat = false
    
    if(abortSignal.aborted === true){
        return false
    }
    if(req.type === 'fail'){
        throwError(req.result)
        return false
    }
    else if(req.type === 'streaming'){
        const reader = req.result.getReader()
        const streamCtx = subject.resolve()
        if(!streamCtx){
            void reader.cancel().catch(() => {})
            return endGone()
        }
        let prefix = ''
        // Set once the origin or the reply is gone: no more chunks are written
        // and the stream is not read further.
        let replyGone:boolean = false
        if(arg.continue){
            const continuedIndex = continuedMessageIndex(streamCtx.chat)
            if(continuedIndex === -1){
                replyGone = true
            }
            else{
                trackReply(streamCtx.chat, continuedIndex)
                prefix = streamCtx.chat.message[continuedIndex].data
            }
        }
        else{
            streamCtx.chat.message.push({
                role: 'char',
                data: "",
                saying: currentChar.chaId,
                time: Date.now(),
                generationInfo,
                promptInfo,
                chatId: generationId,
            })
            trackReply(streamCtx.chat, streamCtx.chat.message.length - 1)
        }
        const performanceMode: StreamingDisplayOptimizationMode = DBState.db.streamingDisplayOptimizationMode ?? 'off'
        streamCtx.chat.isStreaming = true
        streamCtx.chat.activeStreamingDisplayOptimizationMode = performanceMode
        streamCtx.owner.reloadKeys += 1
        let lastResponseChunk:{[key:string]:string} = {}
        let streamAborted:boolean = abortSignal.aborted
        let receivedStreamingResult = false
        const deferStreamingPostProcessing = performanceMode === 'strong'
        const coalesceStreamingDisplay = performanceMode === 'balanced' || performanceMode === 'strong'
        const streamingDisplayFlushDelay = 125
        let pendingStreamingResult: string | null = null
        let streamingFlushTimer: ReturnType<typeof setTimeout> | null = null
        let streamingFlushFrame: number | null = null
        let streamingFlushPromise: Promise<void> | null = null
        let streamingFlushQueued = false
        let streamingFlushError: unknown = null
        const clearStreamingFlushSchedule = () => {
            if(streamingFlushTimer !== null){
                clearTimeout(streamingFlushTimer)
                streamingFlushTimer = null
            }
            if(streamingFlushFrame !== null){
                cancelAnimationFrame(streamingFlushFrame)
                streamingFlushFrame = null
            }
        }
        // One synchronous statement group: resolve the origin and the reply,
        // then write. False, with nothing written, when either is gone.
        const writeReplyData = (data:string, bumpKeys = true):boolean => {
            const target = resolveReply()
            if(!target){
                return false
            }
            target.ctx.chat.message[target.index].data = data
            if(bumpKeys){
                target.ctx.owner.reloadKeys += 1
            }
            if(streamFlushObserver){
                streamFlushObserver({
                    origin,
                    hint,
                    replyId: target.replyId,
                    ownerIndex: target.ctx.ownerIndex,
                    chatIndex: target.ctx.chatIndex,
                    memberIndex: target.ctx.memberIndex,
                    replyIndex: target.index,
                })
            }
            return true
        }
        const processAndWriteReply = async (text:string, bumpKeys = true):Promise<boolean> => {
            const before = resolveReply()
            if(!before){
                return false
            }
            const processed = await processScriptFull(nowChatroom, text, 'editoutput', before.index, {}, undefined, subject, replyMessageRef(before))
            emoChanged = processed.emoChanged
            return writeReplyData(processed.data, bumpKeys)
        }
        const flushStreamingDisplay = async () => {
            clearStreamingFlushSchedule()
            if(streamingFlushPromise){
                streamingFlushQueued = true
                return streamingFlushPromise
            }
            streamingFlushPromise = (async () => {
                do {
                    streamingFlushQueued = false
                    const nextResult = pendingStreamingResult
                    pendingStreamingResult = null
                    if(nextResult === null || replyGone){
                        continue
                    }
                    if(deferStreamingPostProcessing){
                        replyGone = !writeReplyData(reformatContent(prefix + nextResult))
                        continue
                    }
                    replyGone = !(await processAndWriteReply(reformatContent(prefix + nextResult)))
                } while(streamingFlushQueued || pendingStreamingResult !== null)
            })().finally(() => {
                streamingFlushPromise = null
            })
            return streamingFlushPromise
        }
        const scheduleStreamingDisplayFlush = () => {
            if(streamingFlushTimer !== null || streamingFlushFrame !== null){
                return
            }
            streamingFlushTimer = setTimeout(() => {
                streamingFlushTimer = null
                streamingFlushFrame = requestAnimationFrame(() => {
                    streamingFlushFrame = null
                    void flushStreamingDisplay().catch((error) => {
                        streamingFlushError ??= error
                        void reader.cancel().catch(() => {})
                    })
                })
            }, streamingDisplayFlushDelay)
        }
        const abortReader = () => {
            streamAborted = true
            void reader.cancel().catch(() => {})
        }
        abortSignal.addEventListener('abort', abortReader, { once: true })
        try {
            while(streamAborted === false && replyGone === false){
                let readed: ReadableStreamReadResult<{ [key: string]: string }>
                try {
                    readed = await reader.read()
                }
                catch(error){
                    if(abortSignal.aborted || streamAborted){
                        streamAborted = true
                        break
                    }
                    throw error
                }
                if(readed.value){
                    receivedStreamingResult = true
                    lastResponseChunk = readed.value
                    const firstChunkKey = Object.keys(lastResponseChunk)[0]
                    result = lastResponseChunk[firstChunkKey]
                    if(!result){
                        result = ''
                    }
                    if(DBState.db.removeIncompleteResponse){
                        result = trimUntilPunctuation(result)
                    }
                    if(coalesceStreamingDisplay){
                        pendingStreamingResult = result
                        scheduleStreamingDisplayFlush()
                    }
                    else if(!(await processAndWriteReply(reformatContent(prefix + result)))){
                        replyGone = true
                        break
                    }
                }
                if(readed.done){
                    break
                }
            }
        }
        finally {
            abortSignal.removeEventListener('abort', abortReader)
            try {
                if(coalesceStreamingDisplay){
                    try {
                        await flushStreamingDisplay()
                    }
                    catch(error){
                        streamingFlushError ??= error
                    }
                }
                if(streamingFlushError !== null){
                    throw streamingFlushError
                }
                if(deferStreamingPostProcessing && receivedStreamingResult && !replyGone){
                    replyGone = !(await processAndWriteReply(reformatContent(prefix + result), false))
                }
            }
            finally {
                const streamEndCtx = subject.resolve()
                if(streamEndCtx){
                    streamEndCtx.chat.isStreaming = false
                    streamEndCtx.chat.activeStreamingDisplayOptimizationMode = undefined
                    streamEndCtx.owner.reloadKeys += 1
                }
                void reader.cancel().catch(() => {})
            }
        }

        if(streamAborted || abortSignal.aborted){
            return false
        }

        if(!subject.resolve()){
            return endGone()
        }

        // A reply deleted while it streamed leaves nothing to post-process; one
        // that goes missing later (a trigger rebuilding the chat without ids) does
        // not stop the steps that follow, which write nothing to it.
        if(!replyGone && resolveReply()){
            addRerolls(generationId, Object.values(lastResponseChunk), { chaId: origin.chaId, chatId: origin.chatId })

            const parsedChat = runCurrentChatFunction()
            if(!parsedChat){
                return endGone()
            }
            currentChat = parsedChat
            const outputTriggerResult = await runTrigger(currentChar, 'output', {chat:currentChat, origin, signal: abortSignal})
            if(outputTriggerResult && outputTriggerResult.sendAIprompt){
                resendChat = true
            }
            const inlayTarget = resolveReply()
            if(inlayTarget){
                const outputMessage = inlayTarget.ctx.chat.message[inlayTarget.index]
                const inlayr = runInlayScreen(currentChar, outputMessage.data)
                outputMessage.data = inlayr.text
                if(inlayr.promise){
                    const t = await inlayr.promise
                    const asyncInlayTarget = resolveReply()
                    if(asyncInlayTarget){
                        asyncInlayTarget.ctx.chat.message[asyncInlayTarget.index].data = t
                    }
                }
            }
            const listenerCtx = subject.resolve()
            if(!listenerCtx){
                return endGone()
            }
            await runChatOutputListeners(currentChar, listenerCtx.chat, listenerCtx.ownerIndex, listenerCtx.chatIndex, locateReply(listenerCtx.chat))
            if(DBState.db.ttsAutoSpeech){
                await sayTTS(currentChar, result)
            }
        }
    }
    else{
        const msgs = (req.type === 'success') ? [['char',req.result]] as const 
                    : (req.type === 'multiline') ? req.result
                    : []
        let mrerolls:string[] = []
        for(let i=0;i<msgs.length;i++){
            let msg = msgs[i]
            let mess = msg[1]
            const continuing = i === 0 && arg.continue
            const startCtx = subject.resolve()
            if(!startCtx){
                return endGone()
            }
            if(continuing){
                const continuedIndex = continuedMessageIndex(startCtx.chat)
                if(continuedIndex !== -1){
                    trackReply(startCtx.chat, continuedIndex)
                }
            }
            let result2 = await processScriptFull(nowChatroom, reformatContent(mess), 'editoutput', startCtx.chat.message.length, {}, undefined, subject, null)
            if(continuing){
                const continuedTarget = resolveReply()
                if(continuedTarget){
                    const beforeData = continuedTarget.ctx.chat.message[continuedTarget.index].data
                    result2 = await processScriptFull(nowChatroom, reformatContent(beforeData + mess), 'editoutput', continuedTarget.index, {}, undefined, subject, replyMessageRef(continuedTarget))
                }
            }
            if(DBState.db.removeIncompleteResponse){
                result2.data = trimUntilPunctuation(result2.data)
            }
            result = result2.data
            const inlayResult = runInlayScreen(currentChar, result)
            result = inlayResult.text
            emoChanged = result2.emoChanged
            if(continuing){
                const replaceTarget = resolveReply()
                if(replaceTarget){
                    replaceTarget.ctx.chat.message[replaceTarget.index] = {
                        role: 'char',
                        data: result,
                        saying: currentChar.chaId,
                        time: Date.now(),
                        generationInfo,
                        promptInfo,
                        chatId: generationId,
                    }
                    trackReply(replaceTarget.ctx.chat, replaceTarget.index)
                    if(inlayResult.promise){
                        const p = await inlayResult.promise
                        const asyncInlayTarget = resolveReply()
                        if(asyncInlayTarget){
                            asyncInlayTarget.ctx.chat.message[asyncInlayTarget.index].data = p
                        }
                    }
                }
                else if(!subject.resolve()){
                    return endGone()
                }
            }
            else if(i===0){
                const pushCtx = subject.resolve()
                if(!pushCtx){
                    return endGone()
                }
                pushCtx.chat.message.push({
                    role: msg[0],
                    data: result,
                    saying: currentChar.chaId,
                    time: Date.now(),
                    generationInfo,
                    promptInfo,
                    chatId: generationId,
                })
                trackReply(pushCtx.chat, pushCtx.chat.message.length - 1)
                if(inlayResult.promise){
                    const p = await inlayResult.promise
                    const asyncInlayTarget = resolveReply()
                    if(asyncInlayTarget){
                        asyncInlayTarget.ctx.chat.message[asyncInlayTarget.index].data = p
                    }
                }
                mrerolls.push(result)
            }
            else{
                mrerolls.push(result)
            }
            const keysCtx = subject.resolve()
            if(keysCtx){
                keysCtx.owner.reloadKeys += 1
            }
            if(DBState.db.ttsAutoSpeech){
                await sayTTS(currentChar, result)
            }
        }

        if(mrerolls.length >1){
            addRerolls(generationId, mrerolls, { chaId: origin.chaId, chatId: origin.chatId })
        }

        const parsedChat = runCurrentChatFunction()
        if(!parsedChat){
            return endGone()
        }
        currentChat = parsedChat

        const outputTriggerResult = await runTrigger(currentChar, 'output', {chat:currentChat, origin, signal: abortSignal})
        if(outputTriggerResult && outputTriggerResult.sendAIprompt){
            resendChat = true
        }
        if(replyId !== undefined){
            const listenerCtx = subject.resolve()
            if(!listenerCtx){
                return endGone()
            }
            await runChatOutputListeners(currentChar, listenerCtx.chat, listenerCtx.ownerIndex, listenerCtx.chatIndex, locateReply(listenerCtx.chat))
        }
    }

    let needsAutoContinue = false
    const resultTokens = await tokenize(result) + (arg.usedContinueTokens || 0)
    if(DBState.db.autoContinueMinTokens > 0 && resultTokens < DBState.db.autoContinueMinTokens){
        needsAutoContinue = true
    }

    if(DBState.db.autoContinueChat && (!isLastCharPunctuation(result))){
        //if result doesn't end with punctuation or special characters, auto continue
        needsAutoContinue = true
    }

    if(needsAutoContinue){
        if(!subject.resolve()){
            return endGone()
        }
        const continueTarget = resolveReply()
        // A continue extends the chat's last message, so it follows only a
        // reply that is still the last one.
        if(continueTarget && continueTarget.index === continueTarget.ctx.chat.message.length - 1){
            return await sendChatRecursion(chatProcessIndex, {
                chatAdditonalTokens: arg.chatAdditonalTokens,
                continue: true,
                signal: abortSignal,
                usedContinueTokens: resultTokens,
                origin,
                originHint: hint,
                continueMessageId: continueTarget.replyId
            })
        }
    }

    const igp = risuChatParser(DBState.db.igpPrompt ?? "", {subject})

    if(igp){
        const igpFormated = parseChatML(igp, subject)
        const rq = await requestChatData({
            formated: igpFormated,
            bias: {},
            subject,
        },'emotion', abortSignal)

        const igpTarget = resolveReply()
        if(igpTarget){
            if(rq.type === 'success'){
                igpTarget.ctx.chat.message[igpTarget.index].data += rq.result
            }
        }
        else if(!subject.resolve()){
            return endGone()
        }
    }

    stageTimings.stage3Duration = Date.now() - stageTimings.stage3Start

    if(generationInfo.stageTiming) {
        generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
    }
    chatProcessStage.set(4)
    stageTimings.stage4Start = Date.now()

    if(resendChat){
        stageTimings.stage4Duration = Date.now() - stageTimings.stage4Start

        if(generationInfo.stageTiming) {
            generationInfo.stageTiming.stage1 = stageTimings.stage1Duration
            generationInfo.stageTiming.stage2 = stageTimings.stage2Duration
            generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
            generationInfo.stageTiming.stage4 = stageTimings.stage4Duration
        }

        if(!writeReplyGenerationInfo()){
            return endGone()
        }

        return await sendChatRecursion(chatProcessIndex, {
            signal: abortSignal,
            origin,
            originHint: hint
        })
    }

    if(DBState.db.notification){
        try {
            const permission = await Notification.requestPermission()
            if(permission === 'granted'){
                const noti = new Notification('Risuai', {
                    body: result
                })
                noti.onclick = () => {
                    window.focus()
                }
            }
        } catch (error) {
            
        }
    }

    if(req.special){
        if(req.special.emotion){
            let charemotions = get(CharEmotion)
            let currentEmotion = currentChar.emotionImages

            let tempEmotion = charemotions[currentChar.chaId]
            if(!tempEmotion){
                tempEmotion = []
            }
            if(tempEmotion.length > 4){
                tempEmotion.splice(0, 1)
            }

            for(const emo of currentEmotion){
                if(emo[0] === req.special.emotion){
                    const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                    tempEmotion.push(emos)
                    charemotions[currentChar.chaId] = tempEmotion
                    CharEmotion.set(charemotions)
                    emoChanged = true
                    break
                }
            }
        }
    }

    if(!currentChar.inlayViewScreen){
        if(currentChar.viewScreen === 'emotion' && (!emoChanged) && (abortSignal.aborted === false)){

            let currentEmotion = currentChar.emotionImages
            let emotionList = currentEmotion.map((a) => {
                return a[0]
            })
            let charemotions = get(CharEmotion)

            let tempEmotion = charemotions[currentChar.chaId]
            if(!tempEmotion){
                tempEmotion = []
            }
            if(tempEmotion.length > 4){
                tempEmotion.splice(0, 1)
            }

            if(DBState.db.emotionProcesser === 'embedding'){
                const hypaProcesser = new HypaProcesser()
                await hypaProcesser.addText(emotionList.map((v) => 'emotion:' + v))
                let searched = (await hypaProcesser.similaritySearchScored(result)).map((v) => {
                    v[0] = v[0].replace("emotion:",'')
                    return v
                })

                //give panaltys
                for(let i =0;i<tempEmotion.length;i++){
                    const emo = tempEmotion[i]
                    //give panalty index
                    const index = searched.findIndex((v) => {
                        return v[0] === emo[0]
                    })

                    const modifier = ((5 - ((tempEmotion.length - (i + 1))))) / 200

                    if(index !== -1){
                        searched[index][1] -= modifier
                    }
                }

                //make a sorted array by score
                const emoresult = searched.sort((a,b) => {
                    return b[1] - a[1]
                }).map((v) => {
                    return v[0]
                })

                for(const emo of currentEmotion){
                    if(emo[0] === emoresult[0]){
                        const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                        tempEmotion.push(emos)
                        charemotions[currentChar.chaId] = tempEmotion
                        CharEmotion.set(charemotions)
                        break
                    }
                }

                

                return true
            }

            function shuffleArray(array:string[]) {
                for (let i = array.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [array[i], array[j]] = [array[j], array[i]];
                }
                return array
            }

            let emobias:{[key:number]:number} = {}

            for(const emo of emotionList){
                const tokens = await tokenizeNum(emo)
                for(const token of tokens){
                    emobias[token] = 10
                }
            }

            for(let i =0;i<tempEmotion.length;i++){
                const emo = tempEmotion[i]

                const tokens = await tokenizeNum(emo[0])
                const modifier = 20 - ((tempEmotion.length - (i + 1)) * (20/4))

                for(const token of tokens){
                    emobias[token] -= modifier
                    if(emobias[token] < -100){
                        emobias[token] = -100
                    }
                }
            }        

            const promptbody:OpenAIChat[] = [
                {
                    role:'system',
                    content: `${DBState.db.emotionPrompt2 || "From the list below, choose a word that best represents a character's outfit description, action, or emotion in their dialogue. Prioritize selecting words related to outfit first, then action, and lastly emotion. Print out the chosen word."}\n\n list: ${shuffleArray(emotionList).join(', ')} \noutput only one word.`
                },
                {
                    role: 'user',
                    content: `"Good morning, Master! Is there anything I can do for you today?"`
                },
                {
                    role: 'assistant',
                    content: 'happy'
                },
                {
                    role: 'user',
                    content: result
                },
            ]

            const rq = await requestChatData({
                formated: promptbody,
                bias: emobias,
                currentChar: currentChar,
                maxTokens: 30,
                subject,
            }, 'emotion', abortSignal)

            if(rq.type === 'fail'){
                if(abortSignal.aborted){
                    return true
                }
                throwError(rq.result)
                return true
            }
            if(rq.type === 'streaming' || rq.type === 'multiline'){
                if(abortSignal.aborted){
                    return true
                }
                throwError('Unexpected response type')
                return true
            }
            else{
                emotionList = currentEmotion.map((a) => {
                    return a[0]
                })
                try {
                    const emotion:string = rq.result.replace(/ |\n/g,'').trim().toLocaleLowerCase()
                    let emotionSelected = false
                    for(const emo of currentEmotion){
                        if(emo[0] === emotion){
                            const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                            tempEmotion.push(emos)
                            charemotions[currentChar.chaId] = tempEmotion
                            CharEmotion.set(charemotions)
                            emotionSelected = true
                            break
                        }
                    }
                    if(!emotionSelected){
                        for(const emo of currentEmotion){
                            if(emotion.includes(emo[0])){
                                const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                                tempEmotion.push(emos)
                                charemotions[currentChar.chaId] = tempEmotion
                                CharEmotion.set(charemotions)
                                emotionSelected = true
                                break
                            }
                        }
                    }
                    if(!emotionSelected && emotionList.includes('neutral')){
                        const emo = currentEmotion[emotionList.indexOf('neutral')]
                        const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                        tempEmotion.push(emos)
                        charemotions[currentChar.chaId] = tempEmotion
                        CharEmotion.set(charemotions)
                        emotionSelected = true
                    }
                } catch (error) {
                    throwError(language.errors.httpError + `${error}`)
                    return true
                }
            }
            
            return true


        }
        else if(currentChar.viewScreen === 'imggen'){
            if(chatProcessIndex !== -1){
                throwError("Stable diffusion in group chat is not supported")
            }

            const imggenCtx = subject.resolve()
            if(!imggenCtx){
                return endGone()
            }
            const msgs = imggenCtx.chat.message
            let msgStr = ''
            for(let i = (msgs.length - 1);i>=0;i--){
                if(msgs[i].role === 'char'){
                    msgStr = `character: ${msgs[i].data.replace(/\n/g, ' ')} \n` + msgStr
                }
                else{
                    msgStr = `user: ${msgs[i].data.replace(/\n/g, ' ')} \n` + msgStr
                    break
                }
            }


            await stableDiff(currentChar, msgStr, subject)
        }
    }

    stageTimings.stage4Duration = Date.now() - stageTimings.stage4Start
    
    if(generationInfo.stageTiming) {
        generationInfo.stageTiming.stage1 = stageTimings.stage1Duration
        generationInfo.stageTiming.stage2 = stageTimings.stage2Duration
        generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
        generationInfo.stageTiming.stage4 = stageTimings.stage4Duration
    }
    
    if(!writeReplyGenerationInfo()){
        return endGone()
    }

    return true
}

function systemizeChat(chat:OpenAIChat[]){
    for(let i=0;i<chat.length;i++){
        if(chat[i].role === 'user' || chat[i].role === 'assistant'){
            const attr = chat[i].attr ?? []
            if(chat[i].name?.startsWith('example_')){
                chat[i].content = chat[i].name + ': ' + chat[i].content
            }
            else if(!attr.includes('nameAdded')){
                chat[i].content = chat[i].role + ': ' + chat[i].content
            }
            chat[i].role = 'system'
            delete chat[i].memo
            delete chat[i].name
        }
    }
    return chat
}
