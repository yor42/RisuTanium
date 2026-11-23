import { get, type Readable } from "svelte/store";
import { type character, type groupChat, type ChatAltMemory, type MessageGenerationInfo, type Chat, type MessagePresetInfo, changeToPreset, type Message, type StreamingDisplayOptimizationMode } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { CharEmotion, selectedCharID } from "../stores.svelte";
import { ChatTokenizer, tokenize, tokenizeNum } from "../tokenizer";
import { language } from "../../lang";
import { fillLang } from "../../lang/fill";
import { alertError, alertToast } from "../alert";
import { parseChatML } from "../parser/chatML";
import { promptViewAt, promptViewOf, splitSentMessages, type PromptView, type SentMessages } from "../cbs";
import { loadLoreBookV3Prompt } from "./lorebook.svelte";
import { noteLoreUse, renameLoreUseReply } from "./loreUse";
import { findCharacterbyId, getUserName, getAuthorNoteDefaultText, getPersonaPrompt, isLastCharPunctuation, trimUntilPunctuation, parseToggleSyntax, prebuiltAssetCommand, pickHashRand } from "../util";
import { requestChatData } from "./request/request";
import { stableDiff } from "./stableDiff";
import { processScript, processScriptFull, risuChatParser, type MessageLocator, type MessageRef, type PromptModuleScripts } from "./scripts";
import { exampleMessage } from "./exampleMessages";
import { firstMessageOf } from "./firstMessage";
import { readLatest, yieldTask } from "./latestSnapshot";
import { sayTTS } from "./tts";
import { beginInFlight } from "./inFlightWork";
import { isTTSVoiceMode } from "./ttsModes";
import { ttsAddition } from "./ttsAddition";
import { currentTTSSignal } from "./ttsPlayback";
import { providerTranslatesItself } from "./ttsSpeechText";
import { translateForSpeech } from "./ttsTranslate";
import { buildDisplayParseOptions } from "./displayParseOptions";
import { supaMemory } from "./memory/supaMemory";
import { writeSupaMemoryData } from "./memory/supaResume";
import { v4 } from "uuid";
import { groupOrder } from "./group";
import { placeReverseDepth, type ReverseDepthEntry } from "./depthPlacement";
import { runTrigger } from "./triggers";
import { HypaProcesser } from "./memory/hypamemory";
import { additionalInformations } from "./embedding/addinfo";
import { getInlayAsset, getInlaySummary, saveInlayedSignature } from "./files/inlays";
import { INLAY_SEND_LIMIT_BYTES, inlayImageWithheld, inlaySendVerdict } from "./files/inlaySendGate";
import { ANDROID_WHOLE_READ_URL_LIMIT_BYTES } from "../storage/assetUrlGate";
import { isAndroidTransport } from "../storage/tauriByteTransport";
import { getGenerationModelString } from "./models/modelString";
import { runInlayScreen } from "./inlayScreen";
import { addRerolls, renameContinuedMessage } from "./prereroll";
import { branchStateOf } from "./chatTree";
import { effectiveJailbreak, effectiveMemory } from "../parser/chatToggleScope";
import { getGlobalChatVar } from "../parser/chatVar.svelte";
import { runImageEmbedding } from "./transformers";
import { hanuraiMemory } from "./memory/hanuraiMemory";
import { hypaMemoryV2 } from "./memory/hypav2";
import { openMemorySettings } from "./memory/memorySettingsLink";
import { chroMemoryModeOf, memoryTakesChatsOf } from "./memory/memoryEngine";
import { createSendCapture, type FirstMessageSource } from "./memory/chroMemory/records";
import { HISTORY_FLOOR, markChroMemoryDroppedAtRecheck, runChroMemorySafely } from "./memory/chroMemory/shadow";
import { readLtmSettings } from "./memory/chroMemory/settings";
import { createLoreIndexStore, defaultLoreIndexScheduler } from "./memory/chroMemory/loreIndex";
import { clearLoreRecallTrace, createLoreRecallStep, loreQueryOf, markLoreRecallTrimmed, type LoreRecallTap } from "./memory/chroMemory/loreRecall";
import { recheckToContext } from "./recheck";
import { runLuaEditTrigger } from "./scriptings";
import { getModelInfo, LLMFlags } from "../model/modellist";
import { LLMTokenizer } from "../model/types";
import { hypaMemoryV3 } from "./memory/hypav3";
import { totalInSendOrder, trimChatsToContext } from "./contextTrim";
import { getModuleAssets, getModuleToggles } from "./modules";
import { ensureModulesOrAlert } from "./moduleEnsure";
import { hasModuleStubs } from "./moduleRefList";
import { getSaveMarkCount, readImage } from "../globalApi.svelte";
import { issueNativeReplyGrant, nativeReplyEligible } from "../nativeReply/grant";
import { holdRecoveredReply, noteReplyPushed, ownsPushedReply, requestReconcile, settleNativeReplyInflight, takeAnnounced } from "../nativeReply/pageState";
import { noteWaitingForUnit } from "../nativeReply/runningReplies.svelte";
import { endOwnedRead, forgetOwnedStream, settleOwnedStreamEnd } from "../nativeReply/ownedStream";
import type { ApplyOutcome, RecoveredReplyInput, RecoveredStreamInput } from "../nativeReply/reconcile";
import { settleRecoveredUsage } from "../usage/usageCapture";
import { pluginV2 } from "../plugins/plugins.svelte";
import { isColdChat } from "./coldstorageData";
import { markCharacterForSave } from "../storage/characterSaveMarks";
import { flushPageReplyEndWhenHidden } from "./saveOnHide";
import { MEASURE } from "./memory/measureFlag";
import { noteReplyArrived } from "../storage/saveRequestProbe";
import { activeUnits, type ActiveUnitKey } from "./activeUnits";
import { selectedChatKey, sendRefusalIn } from "./sendAdmission";
import { beginWork, createSendSubject, isShownChat, registerWork, resolveOriginWithHint, type Origin, type OriginContext, type SendSubject, type WorkHandle, type WorkKind, type WorkStop } from "./chatOrigin";
import { noteTurnReached, publishUnit, releaseUnit, setProcessStage } from "./generationOwnership.svelte";
import { addActiveStream, addReplySpeaker, noteStreamReceived, noteStreamText } from "./activeStreams";
import { splitAtOpenCbsSpan } from "../chatShell/streamSpans";
import { isChatOnScreen } from "./chatOnScreen.svelte";
import { classifyReplyOutcome, noteUnitAlerted, noteUnitFailure, recordReplyOutcome, setReplyMark, type ReplyAnnouncement, type ReplyOutcome } from "./replyMarks";
import { announceReply, nativeNoticeArmOf, noteReplySound } from "./replyNotice";

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
    width?:number,
    name?:string
}

/**
 * True exactly while a unit is held: an outermost `sendChat` call, from its
 * acceptance until it settles, or a recovered apply. Only the registry writes
 * it, through the unit's own take and release.
 */
export const doingChat: Readable<boolean> = activeUnits.active

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

// One lore index slot for the app; sends share it and never wait for a build.
const loreIndexStore = createLoreIndexStore({
    hash: (content) => pickHashRand(5555, content),
    schedule: defaultLoreIndexScheduler,
    now: () => performance.now(),
})
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
    /** Ends the call's registration as the speaker of its group turn; a call with no member registered none. */
    releaseSpeaker: () => void
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
    // A prompt preview writes no reply; the recursion inherits the kind from its own arg.
    const kind: WorkKind = (arg.preview || arg.previewPrompt) ? 'preview' : 'reply'

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
        handle = beginWork(selected, selectedChat, undefined, stop, kind)
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
    handle ??= registerWork(origin, stop, kind)

    const subject = createSendSubject(origin, hint)

    // The speaker lives exactly as long as the call's work registration, streaming or not, so a turn that
    // streams nothing still names its member on the keep-alive card (MC-1502). A prompt preview registers
    // one too: it holds the same in-flight work and shows the same card, and releases it when it settles.
    const releaseSpeaker = origin.memberChaId
        ? addReplySpeaker({ chaId: origin.chaId, chatId: origin.chatId, memberChaId: origin.memberChaId })
        : () => {}

    return { context: { origin, hint, subject }, handle, releaseSpeaker }
}

/**
 * Ends a call's registration and marks its origin's owner and member for save,
 * whatever the selection has moved to since: a write made mid-generation to a
 * character other than the selected one (hotkeys, Playground and Home buttons
 * all change selection without checking `doingChat`) would otherwise never be
 * saved.
 */
function settleSendChatCall(entry: SendChatEntry): void {
    entry.releaseSpeaker()
    entry.handle.end()
    markCharacterForSave(entry.context.origin.chaId)
    markCharacterForSave(entry.context.origin.memberChaId)
}

/**
 * The chat a send called with `arg` will write to, as far as it is known before
 * the call enters: the explicit origin, else the selected character and chat
 * ids, else null (nothing selected, or a character or chat without an id yet).
 * Pure: it fills no id, warns nowhere and marks nothing. The key is the
 * owner's chat, never the member.
 */
export function sendTargetOf(arg: Pick<SendChatArg, 'origin'>): ActiveUnitKey | null {
    if(arg.origin){
        return { chaId: arg.origin.chaId, chatId: arg.origin.chatId }
    }
    return selectedChatKey()
}

/**
 * The admission gate for an outermost send, per chat: refused while a unit holds the chat it will write to or a native
 * reply targets it; a unit or a reply elsewhere does not refuse. The reads are untracked. The take that follows
 * `enterSendChat` decides again, so nothing between the two may await.
 */
function sendAdmissible(arg: SendChatArg): boolean {
    return sendRefusalIn(sendTargetOf(arg)) === null
}

/**
 * Outer wrapper (CHORE-01). An outermost call is a unit: it holds a unit of
 * `activeUnits` (which `doingChat` reports) and its abort controller's signal
 * published as a tag for the native chat Stop, from the moment it is accepted
 * until it settles. The unit's stop is its work registration's. It
 * is refused while a unit holds the chat it writes to or a native reply
 * targets that chat (a unit in another chat does not refuse it), when its
 * caller's signal is already aborted, and by the refusals that depend on the
 * chat it writes to (a cold chat still loading, nothing selected, an origin
 * that is gone). A call refused before it enters changes neither the registry
 * nor the published tags and registers nothing.
 *
 * The admission check, the registration and the take happen in one synchronous
 * stretch: nothing between them may await, or two units could be accepted into
 * one chat. The take decides, so a call that a synchronous callback of its own
 * entry raced to the chat ends its registration and speaker and is refused.
 *
 * The call writes into a chat fixed at entry and is registered as writing to
 * it until it settles. The recursion inside `sendChatBody` (group turns,
 * auto-continue, resend) goes through `sendChatRecursion`, so it registers
 * and marks for itself but neither checks, takes nor releases a unit.
 *
 * Reports `true` only when the body did and the unit was not aborted, by its
 * caller's signal or by the busy button.
 */
export async function sendChat(chatProcessIndex = -1, arg: SendChatArg = {}): Promise<boolean> {
    if(!sendAdmissible(arg) || arg.signal?.aborted){
        return false
    }
    // The registration carries this unit's abort, so a delete of the chat it
    // writes to stops this send alone, whatever else is running elsewhere.
    const unit = new AbortController()
    const entry = enterSendChat(chatProcessIndex, arg, () => unit.abort())
    if(!entry){
        return false
    }
    // Inert until taken; the release below affects this handle only.
    const active = activeUnits.unit(entry.context.origin)
    // The take is the exclusion: a synchronous callback of the entry can have started another send into this chat, and
    // the gate before the entry could not see it. A take that threw after adding is still released.
    let admitted = false
    try {
        admitted = active.take()
    } finally {
        if(!admitted){
            active.release()
            entry.releaseSpeaker()
            entry.handle.end()
        }
    }
    if(!admitted){
        console.error(`A send into chat ${entry.context.origin.chatId} was refused: another send holds it`)
        return false
    }
    const callerSignal = arg.signal
    const relayAbort = () => unit.abort()
    // Held from the moment the unit takes its place until it releases it, so the
    // page is not cut off while a reply is being produced. Refused sends and the
    // recursion never begin one.
    let endInFlight: (outcome?: ReplyOutcome) => void = () => {}
    // How the unit ended, for the reply mark (`recordReplyOutcome`).
    let completed = false
    let threw = false
    let modulesFailed = false
    let announcement: ReplyAnnouncement | null = null
    // The native side already told the person of this send's reply: the page posts no notice and no chime of its own.
    let nativeAnnounced = false
    // The same classification, for the keep-alive notification's Stopped and Failed lingers. A preview send has none.
    let replyOutcome: ReplyOutcome | undefined
    try {
        // Reset after admission, for the chat this unit writes to, so a refused call never clears the running send's
        // progress.
        setProcessStage(entry.context.origin, 0)
        callerSignal?.addEventListener('abort', relayAbort)
        publishUnit(unit, entry.context.origin)
        // The target is the owner's chat (a group's own id for a group chat), so a notification can open it.
        endInFlight = beginInFlight('chat', { target: entry.context.origin })
        // Awaited only after the unit is taken, so the check and the take stay one synchronous stretch. The busy
        // button aborts the wait through the unit's signal; a failure alerts once and the finally releases the unit.
        if(hasModuleStubs() && !(await ensureModulesOrAlert(entry.context.origin, unit.signal, entry.context.hint))){
            modulesFailed = true
            return false
        }
        completed = await sendChatBody(chatProcessIndex, { ...arg, signal: unit.signal }, entry.context)
        return completed && !unit.signal.aborted
    } catch (error) {
        threw = true
        throw error
    } finally {
        try {
            try {
                // First, before the hidden-page flush and while the registration is live: the mark it writes is then saved by
                // that flush, and a put-back that waits on the registration cannot race it. Never throws.
                if(!(arg.preview || arg.previewPrompt)){
                    const facts = { completed, signal: unit.signal, threw, modulesFailed }
                    announcement = recordReplyOutcome(entry.context, facts, isChatOnScreen)
                    // On screen or off: a failed or stopped reply plays no sound, so the composer's chime must know. Never throws.
                    try {
                        replyOutcome = classifyReplyOutcome(entry.context.subject.resolve() !== null, facts)
                        noteReplySound(callerSignal, replyOutcome)
                    } catch (error) {
                        console.error('The reply sound could not be recorded', error)
                    }
                }
                flushPageReplyEndWhenHidden(entry.context.origin)
                // Read before the keys are settled and from outside `held`, so a save that consumed the reply cannot lose it.
                try {
                    nativeAnnounced = takeAnnounced(replyKeysOfUnit.get(unit.signal) ?? [])
                } catch (error) {
                    console.error('The native notice fact could not be read', error)
                }
                // Never throws: a key the send never pushed is consumed, dropped or left to the reconcile.
                settleReplyKeys(unit.signal)
                endInFlight(replyOutcome)
                callerSignal?.removeEventListener('abort', relayAbort)
                releaseUnit(unit)
            } finally {
                // The innermost step: nothing above can skip the release, and the wake-up follows it. Unit first,
                // registration second.
                try {
                    active.release()
                } finally {
                    rerunDeferredApply(entry.context.origin)
                }
            }
        } finally {
            try {
                settleSendChatCall(entry)
            } finally {
                // After the registration has ended, so the chat no longer reads as writing when the chip appears. Its own
                // try: a failing notice must not turn a finished send into a failed one.
                try {
                    announceReply(announcement, callerSignal, nativeAnnounced)
                } catch (error) {
                    console.error('The reply notice could not be posted', error)
                }
            }
        }
    }
}

/**
 * A send's own recursion (a group's turns, an auto-continue, a resend): it
 * runs on its unit and signal, so it neither checks, takes nor releases a
 * unit.
 */
async function sendChatRecursion(chatProcessIndex: number, arg: SendChatArg): Promise<boolean> {
    const entry = enterSendChat(chatProcessIndex, arg)
    if(!entry){
        return false
    }
    setProcessStage(entry.context.origin, 0)
    try {
        return await sendChatBody(chatProcessIndex, arg, entry.context)
    } finally {
        settleSendChatCall(entry)
    }
}

/**
 * Expands the variables of every message of `ctx.chat` at its own chat index, hidden ones included, and writes the
 * result back to the message itself. The array object is kept: a replaced array would rebuild the dirty tracking of
 * every message of the chat. `firstMessageDecision` is the decision a send already took; without one the first message
 * counts as sent when the chat has not been reset and the owner is not a group. `onView` receives the prompt view
 * before any message is written.
 */
function expandChatVariables(ctx: OriginContext, subject: SendSubject, currentChar: character, firstMessageDecision: boolean | undefined, onView?: (view: PromptView) => void): void {
    const split = splitSentMessages(ctx.chat.message)
    const view = promptViewOf(split, firstMessageDecision ?? (ctx.owner.type !== 'group' && split.resetAt === -1))
    onView?.(view)
    ctx.chat.message.forEach((v, i) => {
        v.data = risuChatParser(v.data, {chara: currentChar, runVar: true, subject, promptView: promptViewAt(view, i)})
    })
}

/** The keys of the replies each running unit was granted, by the unit's signal; the outermost call settles them. */
const replyKeysOfUnit = new WeakMap<AbortSignal, string[]>()

/**
 * The chats (`chaId` and `chatId` joined) a recovered reply was deferred for because a unit held them: the release of that
 * chat asks the reconcile to run again, and the release of another chat does not.
 */
const deferredApplyChats = new Set<string>()

/** Settles the grants of a finished unit: a key that was never pushed is consumed or left to the reconcile. */
function settleReplyKeys(signal: AbortSignal): void {
    const keys = replyKeysOfUnit.get(signal)
    if(!keys){
        return
    }
    replyKeysOfUnit.delete(signal)
    for(const key of keys){
        forgetOwnedStream(key)
        settleNativeReplyInflight(key).catch((error) => console.error(error))
    }
}

function deferredApplyKeyOf(origin: Origin): string {
    return JSON.stringify([origin.chaId, origin.chatId])
}

/** Records that a recovered reply waited for the unit that holds its chat: that chat's release asks the reconcile to run again. */
function deferRecoveredApply(origin: Origin, key: string): 'deferred' {
    deferredApplyChats.add(deferredApplyKeyOf(origin))
    noteWaitingForUnit(key)
    return 'deferred'
}

/**
 * After a unit of this chat is released: a recovered reply that waited for the chat is placed by a new reconcile pass. The
 * release of a chat nothing waited for requests nothing.
 */
function rerunDeferredApply(origin: Origin): void {
    if(deferredApplyChats.delete(deferredApplyKeyOf(origin))){
        requestReconcile()
    }
}

/**
 * Places a reply the native side received while this page could not (the reconcile's append). It is written like the
 * reply of a send, once, and then waited for like one: the record is consumed after the commit that saves it. It is not
 * a send: it plays no sound, speaks nothing, continues nothing, generates no image and rolls no candidate (MC-1459), and
 * a `sendAIprompt` of the output trigger is ignored. An imggen tag is stored as it came (MC-2359). A reply for a chat
 * that is not on screen sets the unseen mark (MC-2358).
 *
 * It runs only while no unit holds its chat: the take is its first act and its only exclusion check, so a send into the
 * chat is refused meanwhile, a unit in another chat does not defer it, and a stop-all, a delete or a trashed chat stops it
 * through its work registration, which defers it before its write. A throw before the write fails it (the record is kept
 * and a later pass places it).
 */
export async function applyRecoveredReply(input: RecoveredReplyInput): Promise<ApplyOutcome> {
    const { key, blob, text } = input
    const origin: Origin = { chaId: blob.target.chaId, chatId: blob.target.chatId }
    const active = activeUnits.unit(origin)
    // The wake-up runs only for a take that succeeded: a refused apply must not clear its own new deferral.
    let held = false
    let handle: WorkHandle | null = null
    let pushed = false
    try {
        held = active.take()
        if(!held){
            return deferRecoveredApply(origin, key)
        }
        const subject = createSendSubject(origin)
        const entryCtx = subject.resolve()
        if(!entryCtx || entryCtx.owner.type !== 'character'){
            return 'failed'
        }
        if(entryCtx.chat.message.some((message) => message.chatId === key)){
            // Another write placed it first: it is awaited like one this page pushed.
            pushed = true
            return 'applied'
        }
        const currentChar = entryCtx.owner
        const unit = new AbortController()
        let stopped = false
        handle = registerWork(origin, () => {
            stopped = true
            unit.abort()
        }, 'reply')
        let result = (await processScriptFull(currentChar, text.trim(), 'editoutput', entryCtx.chat.message.length, {}, undefined, subject, null)).data
        if(DBState.db.removeIncompleteResponse){
            result = trimUntilPunctuation(result)
        }
        // Only the emotion rewrite applies: an image generation tag is left as it came.
        if(currentChar.inlayViewScreen && currentChar.viewScreen === 'emotion'){
            result = runInlayScreen(currentChar, result).text
        }
        // The target may have gone or changed during the awaits: resolve and check again in the stretch that writes.
        const pushCtx = subject.resolve()
        if(stopped || !pushCtx){
            return 'deferred'
        }
        if(pushCtx.chat.message.some((message) => message.chatId === key)){
            pushed = true
            return 'applied'
        }
        pushCtx.chat.message.push({
            role: 'char',
            data: result,
            saying: blob.saying,
            time: Date.now(),
            generationInfo: blob.generationInfo,
            promptInfo: blob.promptInfo,
            chatId: key,
        })
        pushCtx.owner.reloadKeys += 1
        markCharacterForSave(origin.chaId)
        pushed = true

        const parsedCtx = subject.resolve()
        if(parsedCtx){
            expandChatVariables(parsedCtx, subject, currentChar, undefined)
            // The result of the output trigger is read for nothing: a recovered reply never asks for another request.
            await runTrigger(currentChar, 'output', { chat: parsedCtx.chat, origin, signal: unit.signal })
        }
        const listenerCtx = subject.resolve()
        if(listenerCtx){
            const messageIndex = listenerCtx.chat.message.findIndex((message) => message.chatId === key)
            await runChatOutputListeners(currentChar, listenerCtx.chat, listenerCtx.ownerIndex, listenerCtx.chatIndex, messageIndex)
        }
        const markCtx = subject.resolve()
        if(markCtx && !isChatOnScreen(origin)){
            setReplyMark(origin, markCtx.chat, 'reply')
        }
        return 'applied'
    } catch(error){
        console.error(error)
        return pushed ? 'applied' : 'failed'
    } finally {
        try {
            // After the push the reply is saved like any other: its mark and the waiter come first, whatever failed above.
            try {
                if(pushed){
                    markCharacterForSave(origin.chaId)
                    holdRecoveredReply(key, origin.chaId, getSaveMarkCount())
                }
            } finally {
                handle?.end()
            }
        } finally {
            // The innermost step: nothing above can skip the release, and the wake-up follows it.
            try {
                active.release()
            } finally {
                if(held){
                    rerunDeferredApply(origin)
                }
            }
        }
    }
}

/**
 * Places a stream reply the native side received while this page could not see it (the reconcile's stream path), read
 * from the recorded bytes. A whole body (`complete`) is written like the stream branch writes its own reply: the text is
 * trimmed before the output scripts, with no escape and no replacers, and the same post-write chain as `applyRecoveredReply`
 * follows. A prefix of a body (a partial) gets the output scripts and the unseen mark only, and its message keeps
 * `interrupted`.
 *
 * Three cases, decided inside the unit exclusion (a running send or Continue in this chat is never written into; one in
 * another chat does not defer it):
 * - the message is absent: it is appended once, with the key as its id;
 * - it is present and still `interrupted` (the page's own partial): the text and the flag are upgraded in place, after the
 *   flag is checked again in the stretch that writes, so an edit made during the awaits is never overwritten;
 * - it is present and not interrupted: nothing is written; it is marked and held for the save like a written one, and the
 *   outcome is `present`.
 * The usage of the record is settled once, by the stretch that writes.
 */
export async function applyRecoveredStreamReply(input: RecoveredStreamInput): Promise<ApplyOutcome> {
    const { key, blob, modelText, complete, meter, how, signatures } = input
    const origin: Origin = { chaId: blob.target.chaId, chatId: blob.target.chatId }
    const active = activeUnits.unit(origin)
    // The wake-up runs only for a take that succeeded: a refused apply must not clear its own new deferral.
    let held = false
    let handle: WorkHandle | null = null
    let written = false
    // The signature inlays the written text references; the record is held for the save only after they settle.
    const signatureWrites: Promise<unknown>[] = []
    try {
        held = active.take()
        if(!held){
            return deferRecoveredApply(origin, key)
        }
        const subject = createSendSubject(origin)
        const entryCtx = subject.resolve()
        if(!entryCtx || entryCtx.owner.type !== 'character'){
            return 'failed'
        }
        // The message exists: it is awaited for its save like one this page pushed, and consumed only after that commit.
        const holdPresent = (): ApplyOutcome => {
            markCharacterForSave(origin.chaId)
            holdRecoveredReply(key, origin.chaId, getSaveMarkCount())
            return 'present'
        }
        const entryIndex = entryCtx.chat.message.findIndex((message) => message.chatId === key)
        if(entryIndex !== -1 && entryCtx.chat.message[entryIndex].interrupted !== true){
            return holdPresent()
        }
        const upgrade = entryIndex !== -1
        const currentChar = entryCtx.owner
        const unit = new AbortController()
        let stopped = false
        handle = registerWork(origin, () => {
            stopped = true
            unit.abort()
        }, 'reply')
        let head = modelText
        if(DBState.db.removeIncompleteResponse){
            head = trimUntilPunctuation(head)
        }
        const scriptIndex = upgrade ? entryIndex : entryCtx.chat.message.length
        const scriptRef: MessageRef | null = upgrade ? { message: entryCtx.chat.message[entryIndex], index: entryIndex } : null
        const processed = await processScriptFull(currentChar, head.trim(), 'editoutput', scriptIndex, {}, undefined, subject, scriptRef, undefined, 'bypass')
        // The target may have gone or changed during the awaits: resolve and check again in the stretch that writes.
        const writeCtx = subject.resolve()
        if(stopped || !writeCtx){
            return 'deferred'
        }
        const writeIndex = writeCtx.chat.message.findIndex((message) => message.chatId === key)
        if(upgrade){
            if(writeIndex === -1){
                return 'deferred'
            }
            if(writeCtx.chat.message[writeIndex].interrupted !== true){
                return holdPresent()
            }
            writeCtx.chat.message[writeIndex].data = processed.data
            if(complete){
                delete writeCtx.chat.message[writeIndex].interrupted
            }
        }
        else{
            if(writeIndex !== -1){
                return holdPresent()
            }
            writeCtx.chat.message.push({
                role: 'char',
                data: processed.data,
                saying: blob.saying,
                time: Date.now(),
                generationInfo: blob.generationInfo,
                promptInfo: blob.promptInfo,
                chatId: key,
                ...(complete ? {} : { interrupted: true as const }),
            })
        }
        writeCtx.owner.reloadKeys += 1
        markCharacterForSave(origin.chaId)
        written = true
        // Only a token in the written text (after the trim and the output scripts) gets its inlay, as a live stream saves
        // the signature of what it shows; a failed write is logged and the text stays.
        for(const record of signatures){
            if(processed.data.includes('{{inlayeddata::' + record.id + '}}')){
                signatureWrites.push(saveInlayedSignature(record.id, record.signature).catch((error) => {
                    console.error('The Gemini signature could not be saved:', error)
                }))
            }
        }
        settleRecoveredUsage(blob.usage, meter, how, modelText)

        if(complete){
            const parsedCtx = subject.resolve()
            if(parsedCtx){
                expandChatVariables(parsedCtx, subject, currentChar, undefined)
                // The result of the output trigger is read for nothing: a recovered reply never asks for another request.
                await runTrigger(currentChar, 'output', { chat: parsedCtx.chat, origin, signal: unit.signal })
            }
            // Only the emotion rewrite applies: an image generation tag is left as it came.
            const inlayCtx = subject.resolve()
            if(inlayCtx && currentChar.inlayViewScreen && currentChar.viewScreen === 'emotion'){
                const inlayMessage = inlayCtx.chat.message.find((message) => message.chatId === key)
                if(inlayMessage){
                    inlayMessage.data = runInlayScreen(currentChar, inlayMessage.data).text
                }
            }
            const listenerCtx = subject.resolve()
            if(listenerCtx){
                const messageIndex = listenerCtx.chat.message.findIndex((message) => message.chatId === key)
                await runChatOutputListeners(currentChar, listenerCtx.chat, listenerCtx.ownerIndex, listenerCtx.chatIndex, messageIndex)
            }
        }
        const markCtx = subject.resolve()
        if(markCtx && !isChatOnScreen(origin)){
            setReplyMark(origin, markCtx.chat, 'reply')
        }
        return 'applied'
    } catch(error){
        console.error(error)
        return written ? 'applied' : 'failed'
    } finally {
        try {
            // After the write the reply is saved like any other: its mark and the waiter come first, whatever failed above.
            // The target is read after the mark.
            try {
                if(written){
                    await Promise.allSettled(signatureWrites)
                    markCharacterForSave(origin.chaId)
                    holdRecoveredReply(key, origin.chaId, getSaveMarkCount())
                }
            } finally {
                handle?.end()
            }
        } finally {
            // The innermost step: nothing above can skip the release, and the wake-up follows it.
            try {
                active.release()
            } finally {
                if(held){
                    rerunDeferredApply(origin)
                }
            }
        }
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
        const last = chat.message.length - 1
        // A continue writes only into a character reply; any other last
        // message counts as gone.
        return chat.message[last]?.role === 'char' ? last : -1
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
    // the result is written back to the message itself. The array object is kept:
    // a replaced array would rebuild the dirty tracking of every message of the
    // chat.
    function runCurrentChatFunction():Chat|null{
        const ctx = subject.resolve()
        if(!ctx){
            return null
        }
        expandChatVariables(ctx, subject, currentChar, firstMessageDecision, (view) => { promptView = view })
        return ctx.chat
    }

    function reformatContent(data:string){
        if(chatProcessIndex === -1){
            return data.trim()
        }
        return data.trim()
    }

    function throwError(error:string, link?:{label:string, open:() => void}){
        noteUnitFailure(abortSignal)
        // An error with a place to fix it is always the alert, so its link stays reachable.
        if(link){
            noteUnitAlerted(abortSignal)
            alertError(error, {link})
            return
        }
        if(!DBState?.db?.inlayErrorResponse){
            noteUnitAlerted(abortSignal)
            alertError(error)
            return
        }

        try{
            const ctx = subject.resolve()
            if(!ctx || !Array.isArray(ctx.chat.message)){
                noteUnitAlerted(abortSignal)
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
            noteUnitAlerted(abortSignal)
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
            alertToast(fillLang(language.alerts.presetNotFound, { name: ele }))
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
    entryCtx.chat.message.forEach((v) => {
        v.chatId = v.chatId ?? v4()
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
                const raw = getGlobalChatVar(`toggle_${toggle.key}`, subject)
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
            // A continue extends the last reply as the member who said it: no
            // order walk, and talkness and the last-speaker filter do not
            // apply. With no such member nothing is generated.
            if(arg.continue){
                const speaker = lastMessage?.saying
                const speakerIndex = speaker ? nowChatroom.characters.indexOf(speaker) : -1
                if(!speaker || speakerIndex === -1){
                    return true
                }
                return await sendChatRecursion(speakerIndex, {
                    chatAdditonalTokens: caculatedChatTokens,
                    signal: abortSignal,
                    continue: true,
                    continueMessageId: lastMessage.chatId,
                    usedContinueTokens: arg.usedContinueTokens,
                    origin: { ...origin, memberChaId: speaker },
                    originHint: hint,
                })
            }
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
                throwError(fillLang(language.errors.characterNotFound, { id: `${origin.memberChaId}` }))
                return false
            }
            currentChar = member
        }
    }
    else{
        currentChar = nowChatroom
    }
    noteTurnReached(origin)

    let chatAdditonalTokens = arg.chatAdditonalTokens ?? caculatedChatTokens
    const tokenizer = new ChatTokenizer(chatAdditonalTokens, DBState.db.aiModel.startsWith('gpt') ? 'noName' : 'name')
    const parsedEntryChat = runCurrentChatFunction()
    if(!parsedEntryChat){
        return endGone()
    }
    let currentChat:Chat = parsedEntryChat
    // The jailbreak switch is decided once for this send and from this send's chat, so the count of the cards and the
    // text pushed for them agree and a selection move changes nothing.
    const jailbreakOn = effectiveJailbreak(currentChat)
    let maxContextTokens = DBState.db.maxContext

    setProcessStage(origin, 1)
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
    
        if(jailbreakOn){
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

    // Lore recall is optional: any failure while building its step leaves the literal scan call of an engine-off send.
    let loreTap: LoreRecallTap | undefined
    const loreChatKey = `${nowChatroom.chaId}:${currentChat.id ?? ''}`
    try{
        const loreMode = chroMemoryModeOf(DBState.db, effectiveMemory(nowChatroom, currentChat), DBState.db.ltmSettings)
        const loreSettings = readLtmSettings(DBState.db.ltmSettings, maxContextTokens)
        if(loreMode !== 'off' && loreSettings.searchLore){
            loreTap = createLoreRecallStep({
                mode: loreMode,
                settings: loreSettings,
                query: loreQueryOf(currentChat.message, splitSentMessages),
                ownerKey: nowChatroom.chaId,
                chatKey: loreChatKey,
                deps: { store: loreIndexStore, hash: (content) => pickHashRand(5555, content), now: () => performance.now() },
            })
        }
    }
    catch{
        loreTap = undefined
    }
    if(!loreTap){
        clearLoreRecallTrace(loreChatKey)
    }
    const lorepmt = loreTap ? await loadLoreBookV3Prompt(subject, promptView, undefined, loreTap) : await loadLoreBookV3Prompt(subject, promptView)

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

    // The lore chat made for each recalled entry, and what each cost where the send counted it. A recalled chat that no
    // count site counted was never part of `tokensBeforeMessages` and is never sent, so it counts 0.
    const recalledLore = lorepmt.recalled ?? []
    const recalledActives = new Set(recalledLore.map((r) => r.active))
    const chatOfRecalled = new Map<(typeof recalledLore)[number]['active'], OpenAIChat>()
    const recalledChats = new Set<OpenAIChat>()
    const loreCounts = new Map<OpenAIChat, number>()

    for(const lorebook of normalActives){
        const loreChat: OpenAIChat = {
            role: lorebook.role,
            content: risuChatParser(resolvePosition(lorebook.prompt), {chara: currentChar, subject, promptView})
        }
        unformated.lorebook.push(loreChat)
        if(recalledActives.has(lorebook)){
            chatOfRecalled.set(lorebook, loreChat)
            recalledChats.add(loreChat)
        }
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
                if(recalledChats.has(chat)){
                    loreCounts.set(chat, (loreCounts.get(chat) ?? 0) + tokens)
                }
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
                    if((!jailbreakOn) && (card.type === 'jailbreak')){
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
                const tokens = await tokenizer.tokenizeChat(chat)
                currentTokens += tokens
                if(recalledChats.has(chat)){
                    loreCounts.set(chat, (loreCounts.get(chat) ?? 0) + tokens)
                }
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

    let chroFirst:FirstMessageSource|null = null
    if(firstMessageSent){
        const firstMsg = firstMessageOf(nowChatroom, currentChat)

        const chat:OpenAIChat = {
            role: 'assistant',
            content: await (processScript(nowChatroom,
                risuChatParser(firstMsg, {chara: currentChar, subject, promptView}),
            'editprocess', {}, undefined, subject, promptView))
        }
        chroFirst = { chat, preWrap: chat.content, raw: firstMsg }

        if(usingPromptTemplate && DBState.db.promptSettings.sendName){
            chat.content = `${currentChar.name}: ${chat.content}`
            chat.attr = ['nameAdded']
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
    }
    
    if(import.meta.env.DEV){
        console.log('Prepared messages for token calculation:', ms)
    }

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

    // The memory systems take every message's count; the context trim needs
    // only the newest messages', so without a memory system the message chats
    // are counted by the trim, as far as its decisions need. A count that may
    // differ between calls or be no whole number (a plugin's tokenizer or a
    // counting request) is taken here as before. The
    // prompt is the same either way while the tokenizer settings stay unchanged
    // during the send. A message the trim drops without counting can no longer
    // fail the send through its count (tiktoken refuses special-token text).
    // ChroMemory is never taken here, so a true result implies it is off and the
    // dispatcher's four legacy branches below are the only ones reachable.
    const memoryTakesChats = () => memoryTakesChatsOf(DBState.db, effectiveMemory(nowChatroom, currentChat))
    const countTokenizer = getModelInfo(DBState.db.aiModel)?.tokenizer
    const countVaries = (DBState.db.aiModel === 'custom' && pluginV2.providerOptions?.get(DBState.db.currentPluginProvider)?.tokenizer === 'custom')
        || countTokenizer === LLMTokenizer.GoogleCloud
    const countMessagesInTrim = !memoryTakesChats() && !countVaries
    // Capture only keeps references; every ChroMemory computation runs later in runChroMemorySafely.
    const chroMode = chroMemoryModeOf(DBState.db, effectiveMemory(nowChatroom, currentChat), DBState.db.ltmSettings)
    const chroCapture = chroMode !== 'off' ? createSendCapture() : null
    // True only when this send placed a ChroMemory block; the legacy branch never sets it.
    let chroPlaced = false
    const firstMessageChat = chats.length
    const tokensBeforeMessages = currentTokens
    // What step 1 took back from `tokensBeforeMessages` by removing recalled lore, and how many entries that was.
    let loreRemovedTokens = 0
    let loreRemoved = 0
    const tokensAfterMessages:number[] = []
    const countedMessages = new Map<OpenAIChat, number>()

    let index = 0
    // `index` is the position among the sent messages; it counts them for the
    // `<Thoughts>` depth. Every parse of a message reads its index in the chat,
    // and the `@@` branches find the message again by identity should the chat
    // shift.
    const messageLocator = createMessageLocator()
    // The module regex list is fixed at the first pass of this build: a change to
    // the module selection during the loop applies from the next send.
    const moduleScripts: PromptModuleScripts = {}
    // Attachments left out for their size, by id, with the limit each was held to. The one toast per
    // send lists each name once, since the same file attached in two messages has two ids.
    const tooLarge = new Map<string, { name: string, limitBytes: number }>()
    for(const msg of ms){
        const chatIndex = msChatIndexes[index]
        let formatedChat = (await processScriptFull(nowChatroom,risuChatParser(msg.data, {chara: currentChar, role: msg.role, subject, promptView: promptViewAt(promptView, chatIndex)}), 'editprocess', chatIndex, {
            chatRole: msg.role,
        }, undefined, subject, {message: msg, index: chatIndex, locator: messageLocator}, promptView, 'use', moduleScripts)).data
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
        if(inlays.length > 0){
            const modelinfo = getModelInfo(DBState.db.aiModel)
            for(const inlay of inlays){
                const inlayName = inlay.replace('{{inlayed::', '').replace('{{inlay::', '').replace('}}', '').replace('{{inlayeddata::', '')
                // The summary holds no body: a video or an audio the model cannot take, the message
                // cannot hold or the limit rules out is never read, and does not take the message's slot.
                const summary = await getInlaySummary(inlayName)
                // An image the platform does not load is refused whatever the model takes.
                const withheldImage = summary !== null && inlayImageWithheld(summary.type, summary.size, isAndroidTransport())
                const verdict = summary === null ? 'not-sent' : withheldImage ? 'too-large' : inlaySendVerdict(summary, modelinfo.flags, multimodal.length > 0)
                if(summary !== null && verdict === 'too-large'){
                    tooLarge.set(inlayName, {
                        name: summary.name || inlayName,
                        limitBytes: withheldImage ? ANDROID_WHOLE_READ_URL_LIMIT_BYTES : INLAY_SEND_LIMIT_BYTES,
                    })
                }
                const inlayData = verdict === 'read' ? await getInlayAsset(inlayName) : null
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
                            base64: inlayData.data,
                            name: summary?.name || inlayName
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

        const chroPreWrap = formatedChat
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
        formatedChat = formatedChat.replace(/<Thoughts>(.+?)<\/Thoughts>/gms, (match, p1) => {
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
        if(chroCapture){
            chroCapture.add(chat, { msg, chatIndex, name, preWrap: chroPreWrap, data: msg.data })
        }
        chats.push(chat)
        if(!countMessagesInTrim){
            const chatTokens = await tokenizer.tokenizeChat(chat)
            currentTokens += chatTokens
            if(chroMode === 'inject'){
                // The injecting trim takes this count instead of recounting the chat.
                countedMessages.set(chat, chatTokens)
            }
        }
        else if(chat.multimodals){
            // A multimodal count is arithmetic on the stored image size and can
            // be NaN, infinite, negative or huge; the trim must see every such
            // count, so it is taken here.
            countedMessages.set(chat, await tokenizer.tokenizeChat(chat))
        }
        index++
    }
    if(tooLarge.size > 0){
        // One notice: a sentence per limit, the smaller limit first, joined by a line break.
        const namesByLimit = new Map<number, string[]>()
        for(const entry of tooLarge.values()){
            const names = namesByLimit.get(entry.limitBytes) ?? []
            names.push(entry.name)
            namesByLimit.set(entry.limitBytes, names)
        }
        alertToast([...namesByLimit.entries()].sort((a, b) => a[0] - b[0]).map(([limitBytes, names]) => fillLang(language.inlaySendTooLarge, {
            names: [...new Set(names)].join(', '),
            size: limitBytes / (1024 * 1024)
        })).join('\n'))
    }
    if(import.meta.env.DEV){
        console.log(JSON.stringify(chats, null, 2))
    }

    const depthPrompts = lorepmt.actives.filter(v => {
        return (v.pos === 'depth' && v.depth > 0) || v.pos === 'reverse_depth'
    })

    for(const depthPrompt of depthPrompts){
        const chat:OpenAIChat = {
            role: depthPrompt.role,
            content: risuChatParser(resolvePosition(depthPrompt.prompt), {chara: currentChar, subject, promptView})
        }
        const depthTokens = await tokenizer.tokenizeChat(chat)
        tokensAfterMessages.push(depthTokens)
        currentTokens += depthTokens
    }
    
    if(abortSignal.aborted){
        return false
    }

    const countArgs = {
        chats,
        firstMessageChat,
        tokensBeforeMessages,
        tokensAfterMessages,
        countedMessages,
        count: (chat:OpenAIChat) => tokenizer.tokenizeChat(chat),
    }
    if(memoryTakesChats()){
        if(countMessagesInTrim){
            currentTokens = await totalInSendOrder(countArgs)
        }
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        setProcessStage(origin, 2)
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
                throwError(sp.error, sp.errorSetting === 'summaryModel'
                    ? {label: language.errors.openMemorySettings, open: openMemorySettings}
                    : undefined)
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
            writeSupaMemoryData(memoryCtx.chat, sp.memory)
            console.log(memoryCtx.chat.supaMemoryData)
            memoryCtx.chat.lastMemory = sp.lastId ?? memoryCtx.chat.lastMemory;
        }
        stageTimings.stage2Duration = Date.now() - stageTimings.stage2Start
        setProcessStage(origin, 1)
    }
    else{
        stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
        // Both trim forms drop only a prefix, so this copy is the chats the trim started from.
        const chroBefore = chroCapture ? chats.slice() : null
        let step1: Awaited<ReturnType<typeof trimChatsToContext>> | null = null
        let chroPlacedBlock: { block: string } | null = null
        // Recalled lore is the first thing step 1 gives up: one entry at a time, lowest-ranked first, until the trim fits
        // with the history floor held. With none left this is the engine-off trim.
        const recalledLeft = recalledLore.slice()
        if(countMessagesInTrim || chroMode === 'inject' || recalledLeft.length > 0){
            const floorKeep = Math.max(1, Math.min(HISTORY_FLOOR, chats.length - firstMessageChat))
            let trimCounts: ReadonlyMap<OpenAIChat, number> = countedMessages
            let trimmed = await trimChatsToContext({
                ...countArgs,
                tokensBeforeMessages: tokensBeforeMessages - loreRemovedTokens,
                countedMessages: trimCounts,
                keepAtLeast: recalledLeft.length > 0 ? floorKeep : 1,
                maxContextTokens,
            })
            while(!trimmed.fits && recalledLeft.length > 0){
                trimCounts = trimmed.counts
                const gone = recalledLeft.pop()
                const goneChat = chatOfRecalled.get(gone.active)
                // Every splice is guarded: an entry another path already removed is skipped, never a neighbour.
                const chatAt = goneChat ? unformated.lorebook.indexOf(goneChat) : -1
                if(chatAt >= 0){
                    unformated.lorebook.splice(chatAt, 1)
                }
                const activeAt = lorepmt.actives.indexOf(gone.active)
                if(activeAt >= 0){
                    lorepmt.actives.splice(activeAt, 1)
                }
                const usedAt = gone.used ? lorepmt.used.indexOf(gone.used) : -1
                if(usedAt >= 0){
                    lorepmt.used.splice(usedAt, 1)
                }
                loreRemovedTokens += (goneChat ? loreCounts.get(goneChat) : 0) ?? 0
                loreRemoved++
                trimmed = await trimChatsToContext({
                    ...countArgs,
                    tokensBeforeMessages: tokensBeforeMessages - loreRemovedTokens,
                    countedMessages: trimCounts,
                    keepAtLeast: recalledLeft.length > 0 ? floorKeep : 1,
                    maxContextTokens,
                })
            }
            if(loreRemoved > 0){
                markLoreRecallTrimmed(loreChatKey, loreRemoved)
            }
            step1 = trimmed
            currentTokens = trimmed.currentTokens
            if(!trimmed.fits){
                throwError(language.errors.toomuchtoken + "\n\n" + fillLang(language.errors.requiredTokens, { tokens: `${currentTokens}` }))

                return false
            }
        }
        else{
            while(currentTokens > maxContextTokens){
                if(chats.length <= 1){
                    throwError(language.errors.toomuchtoken + "\n\n" + fillLang(language.errors.requiredTokens, { tokens: `${currentTokens}` }))

                    return false
                }

                currentTokens -= await tokenizer.tokenizeChat(chats[0])
                chats.splice(0, 1)
            }
        }
        if(chroCapture && chroBefore){
            // The memory message as the assembly will send it: the wrapped text, or one
            // entry per memory card with its parsed innerFormat. The role does not change a count.
            const memoryCards = supaMemoryCardUsed && promptTemplate ? promptTemplate.flatMap((card) => card.type === 'memory' ? [card] : []) : []
            const parsedInner = new Map<object, string>()
            const innerOf = (card: (typeof memoryCards)[number]): string => {
                let parsed = parsedInner.get(card)
                if(parsed === undefined){
                    parsed = risuChatParser(card.innerFormat ?? '', {chara: currentChar, subject, promptView})
                    parsedInner.set(card, parsed)
                }
                return parsed
            }
            const countMemoryShape = async (block: string): Promise<number> => {
                const shapes = supaMemoryCardUsed
                    ? memoryCards.map((card) => card.innerFormat ? innerOf(card).replace('{{slot}}', block) : block)
                    : [`<Previous Conversation>${block}</Previous Conversation>`]
                const counted = new Map<string, number>()
                let total = 0
                for(const shape of shapes){
                    let tokens = counted.get(shape)
                    if(tokens === undefined){
                        tokens = (await tokenize(shape.trim())) + chatAdditonalTokens
                        counted.set(shape, tokens)
                    }
                    total += tokens
                }
                return total
            }
            // The character depth prompt is added after the trim and never trimmed, so
            // make-room keeps its tokens out of the history's room.
            let reserveTokens = 0
            const depthPromptText = currentChar.depth_prompt?.prompt
            if(chroMode === 'inject' && depthPromptText){
                try{
                    reserveTokens = await tokenizer.tokenizeChat({
                        role: 'system',
                        content: risuChatParser(depthPromptText, {chara: currentChar, subject, promptView})
                    })
                }
                catch{
                    reserveTokens = 0
                }
            }
            chroPlacedBlock = await runChroMemorySafely({
                capture: chroCapture, first: chroFirst, charName: currentChar.name,
                userName: () => getUserName(currentChat),
                before: chroBefore, kept: chats,
                ownerId: nowChatroom.chaId, chatId: currentChat.id,
                ltmSettings: DBState.db.ltmSettings, maxContextTokens, countVaries,
                tokenizerKey: () => [DBState.db.aiModel, DBState.db.customTokenizer, DBState.db.currentPluginProvider, pluginV2.providerOptions?.get(DBState.db.currentPluginProvider)?.tokenizer ?? 'none', DBState.db.googleClaudeTokenizing ? '1' : '0', chatAdditonalTokens].join('|'),
                inject: chroMode === 'inject' && step1 ? {
                    chats, step1, firstMessageChat, tokensBeforeMessages: tokensBeforeMessages - loreRemovedTokens, tokensAfterMessages,
                    reserveTokens, floor: HISTORY_FLOOR,
                    count: (chat) => tokenizer.tokenizeChat(chat),
                } : null,
            }, {
                countText: (t) => tokenize(t),
                countBlock: countMemoryShape,
                now: () => performance.now(),
            })
        }
        // The stamp names the first chat make-room kept; the memory message is added after it,
        // with no await between the two.
        const lastMemoryCtx = subject.resolve()
        if(lastMemoryCtx){
            lastMemoryCtx.chat.lastMemory = chats[0].memo
        }
        if(chroPlacedBlock){
            chats.unshift({ role: 'system', content: chroPlacedBlock.block, memo: 'supaMemory' })
            chroPlaced = true
        }
    }

    if(abortSignal.aborted){
        return false
    }

    let biases:[string,number][] = DBState.db.bias.concat(currentChar.bias).map((v) => {
        return [risuChatParser(v[0].replaceAll("\\n","\n").replaceAll("\\r","\r").replaceAll("\\\\","\\"), {chara: currentChar, subject, promptView}),v[1]]
    })

    let memories:OpenAIChat[] = []



    let splitLastChat:OpenAIChat|undefined
    if(!promptTemplate){
        splitLastChat = chats[chats.length - 1]
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

    // The split last message is one of the entries after a reverse depth
    // prompt only when it is sent: not blank, and the format order has lastChat.
    const lastChatIsSent = !promptTemplate && !!splitLastChat
        && !!DBState.db.formatingOrder?.includes('lastChat')
        && (splitLastChat.content.trim() !== '' || (splitLastChat.multimodals && splitLastChat.multimodals.length > 0))
    const reverseDepthEntries:ReverseDepthEntry<OpenAIChat>[] = []
    const forwardDepthEntries:ReverseDepthEntry<OpenAIChat>[] = []
    for(const depthPrompt of depthPrompts){
        const chat:OpenAIChat = {
            role: depthPrompt.role,
            content: risuChatParser(resolvePosition(depthPrompt.prompt), {chara: currentChar, subject, promptView})
        }
        if(depthPrompt.pos === 'depth'){
            forwardDepthEntries.push({depth: depthPrompt.depth, chat})
        }
        else{
            reverseDepthEntries.push({depth: depthPrompt.depth, chat})
        }
    }

    const reversePlaced = placeReverseDepth(unformated.chats, reverseDepthEntries, {tail: lastChatIsSent ? 1 : 0})
    unformated.chats = reversePlaced.chats
    unformated.lastChat.push(...reversePlaced.lastChatAppend)

    for(const entry of forwardDepthEntries){
        unformated.chats.splice(entry.depth,0,entry.chat)
    }

    // A template send places these around the first and last chat cards;
    // the non-template send reads them back out of lastChat.
    const historyStart:OpenAIChat[] = []
    const historyEnd:OpenAIChat[] = []
    if(triggerResult){
        if(triggerResult.additonalSysPrompt.promptend){
            unformated.postEverything.push({
                role: 'system',
                content: triggerResult.additonalSysPrompt.promptend
            })
        }
        if(triggerResult.additonalSysPrompt.historyend){
            const historyEndChat:OpenAIChat = {
                role: 'system',
                content: triggerResult.additonalSysPrompt.historyend
            }
            historyEnd.push(historyEndChat)
            unformated.lastChat.push(historyEndChat)
        }
        if(triggerResult.additonalSysPrompt.start){
            const historyStartChat:OpenAIChat = {
                role: 'system',
                content: triggerResult.additonalSysPrompt.start
            }
            historyStart.push(historyStartChat)
            unformated.lastChat.unshift(historyStartChat)
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

        // Trigger start/historyend text brackets the chat cards, whether or not
        // their ranges select anything. A template without a chat card sends neither.
        const chatCards = template.filter((c) => c.type === 'chat')
        const firstChatCard = chatCards[0]
        const lastChatCard = chatCards[chatCards.length - 1]

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
                    if((!jailbreakOn) && (card.type === 'jailbreak')){
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
                    if(card === firstChatCard){
                        pushPrompts(historyStart)
                    }
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
                        if(card === lastChatCard){
                            pushPrompts(historyEnd)
                        }
                        break
                    }

                    let chats = unformated.chats.slice(start, end)
                    if(usingPromptTemplate && DBState.db.promptSettings.sendChatAsSystem && (!card.chatAsOriginalOnSystem)){
                        chats = systemizeChat(chats)
                    }
                    pushPrompts(chats)
                    if(card === lastChatCard){
                        pushPrompts(historyEnd)
                    }

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
    const rechecked = await recheckToContext({
        formated,
        maxContextTokens,
        count: (chat) => tokenizer.tokenizeChat(chat),
        memoryLastResort: chroPlaced,
    })
    const inputTokens = rechecked.inputTokens
    formated = rechecked.formated
    if(rechecked.droppedMemory && rechecked.fits){
        markChroMemoryDroppedAtRecheck(`${nowChatroom.chaId}:${currentChat.id ?? ''}`)
    }
    if(!rechecked.fits){
        throwError(language.errors.toomuchtoken + "\n\n" + fillLang(language.errors.requiredTokensRecheck, { tokens: `${inputTokens}` }))
        return false
    }

    //estimate tokens
    let outputTokens = DBState.db.maxResponse
    if(inputTokens + outputTokens > maxContextTokens){
        outputTokens = maxContextTokens - inputTokens
    }
    const generationId = v4()
    // Every path that writes a new reply gives it `generationId` as its `chatId`. A preview writes no reply and a
    // continue extends an existing one, so neither replaces the list of the latest reply.
    if(!arg.continue && !arg.preview && !arg.previewPrompt){
        noteLoreUse(generationId, lorepmt.used ?? [])
    }
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

    setProcessStage(origin, 3)
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

    const requestCtx = subject.resolve()
    if(!requestCtx){
        return endGone()
    }
    // The branch state of the chat as the request starts, with this send's own
    // memory already written: a candidate of this reply is a sibling that, once
    // arrived at, restores it whole (every branch field, an absent one as null). A scope flip while the request runs
    // is not seen here: the candidates keep the value the request started with.
    const candidateStartState: ChatAltMemory = branchStateOf(requestCtx.chat)

    // An eligible send offers its first request the right to keep this reply's record (see `nativeReply/grant`). The
    // unit's outermost call settles the key when the send ends.
    let nativeReplyGrant: ReturnType<typeof issueNativeReplyGrant> | undefined = undefined
    if(nativeReplyEligible({
        androidTransport: isAndroidTransport(),
        singleCharacter: nowChatroom.type === 'character',
        isContinue: arg.continue === true,
        isPreview: arg.preview === true,
        isPromptPreview: arg.previewPrompt === true,
    })){
        nativeReplyGrant = issueNativeReplyGrant(generationId, {
            target: { chaId: origin.chaId, chatId: origin.chatId },
            targetName: nowChatroom.name,
            saying: currentChar.chaId,
            generationInfo,
            promptInfo,
            escape: nowChatroom.type === 'character' && nowChatroom.escapeOutput === true,
            requestedMs: Date.now(),
        }, nativeNoticeArmOf(origin))
        const unitKeys = replyKeysOfUnit.get(abortSignal)
        if(unitKeys){
            unitKeys.push(generationId)
        }
        else{
            replyKeysOfUnit.set(abortSignal, [generationId])
        }
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
        mainSend: true,
        usageInputEstimate: inputTokens,
        nativeReplyGrant,
    }, 'model', abortSignal)
    if (MEASURE) {
        // A measurement build notes the reply's first turn after the response; nothing reads it back.
        noteReplyArrived(req?.type)
    }

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
    // This request's own model text (the addition only, for a continue), before
    // output scripts and inlay processing; the last message's text for a
    // multiline answer.
    let modelText = ''
    let emoChanged = false
    let resendChat = false
    // The reply's stored text when this run began writing to it, for auto-TTS.
    let ttsBefore = ''

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
            // The reader's cancel never reaches the native request, so it is ended here.
            if(nativeReplyGrant){
                endOwnedRead(generationId)
            }
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
                streamCtx.chat.message[continuedIndex].interrupted = true
                prefix = streamCtx.chat.message[continuedIndex].data
                ttsBefore = prefix
            }
        }
        else{
            // `interrupted` stays on the reply until the stream ends in this
            // page, so a saved copy of a page that died mid-stream carries it.
            streamCtx.chat.message.push({
                role: 'char',
                data: "",
                saying: currentChar.chaId,
                time: Date.now(),
                generationInfo,
                promptInfo,
                chatId: generationId,
                interrupted: true,
            })
            trackReply(streamCtx.chat, streamCtx.chat.message.length - 1)
        }
        // Added in the same synchronous block as the `isStreaming` writes: the
        // chat view re-runs on those writes and reads this registry then.
        // A stream that started with its reply already gone set no flag and
        // must not clear one at its end.
        const streamedReplyId = replyGone ? undefined : replyId
        const streamsIntoReply = streamedReplyId !== undefined
        const removeActiveStream = streamedReplyId !== undefined
            ? addActiveStream({ chaId: origin.chaId, chatId: origin.chatId, memberChaId: origin.memberChaId, replyChatId: streamedReplyId })
            : () => {}
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
            noteStreamText(target.replyId, data)
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
        // The whole text of the last write that held an open CBS block raw, or null when the last write processed all of its
        // text. The stream end processes it once, so the stored reply is the pass over the whole text.
        let settleText: string | null = null
        // With `holdOpenSpan` the text from the opener of a CBS block that is still open stays raw, so the chat view can hide
        // it until the block closes; only the text before it is processed.
        const processAndWriteReply = async (text:string, holdOpenSpan:boolean, bumpKeys = true):Promise<boolean> => {
            const before = resolveReply()
            if(!before){
                return false
            }
            const { head, held } = holdOpenSpan ? splitAtOpenCbsSpan(text) : { head: text, held: '' }
            // Every text here is a partial or deferred reply that is never looked up again; caching it would only evict entries that are.
            const processed = await processScriptFull(nowChatroom, head, 'editoutput', before.index, {}, undefined, subject, replyMessageRef(before), undefined, 'bypass')
            emoChanged = processed.emoChanged
            const written = writeReplyData(processed.data + held, bumpKeys)
            // A pass that threw never reaches here, so the settle text stays the last one that was written.
            if(written){
                settleText = held === '' ? null : text
            }
            return written
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
                    replyGone = !(await processAndWriteReply(reformatContent(prefix + nextResult), true))
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
                        void snapshots.cancel()
                    })
                })
            }, streamingDisplayFlushDelay)
        }
        const snapshots = readLatest(reader, (value) => !!value)
        const abortReader = () => {
            streamAborted = true
            void snapshots.cancel()
        }
        abortSignal.addEventListener('abort', abortReader, { once: true })
        try {
            while(streamAborted === false && replyGone === false){
                let readed: Awaited<ReturnType<typeof snapshots.next>>
                try {
                    readed = await snapshots.next()
                }
                catch(error){
                    if(abortSignal.aborted || streamAborted){
                        streamAborted = true
                        break
                    }
                    throw error
                }
                if('value' in readed){
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
                    modelText = result
                    if(coalesceStreamingDisplay){
                        pendingStreamingResult = result
                        // The display write waits for a frame a hidden page never runs: the received length lets the
                        // keep-alive count keep rising meanwhile. It is approximate because it precedes formatting and
                        // the output scripts; the 'off' mode notes the exact processed length at each write (MC-1499, MC-1466).
                        if(streamedReplyId !== undefined){
                            noteStreamReceived(streamedReplyId, (prefix + result).length)
                        }
                        scheduleStreamingDisplayFlush()
                    }
                    else if(!(await processAndWriteReply(reformatContent(prefix + result), true))){
                        replyGone = true
                        break
                    }
                    else if(!streamAborted){
                        // One posted-message task, never a timer, frame or scheduler.yield: a hidden page must still finish
                        // the reply, and native events queued during the pass must reach the snapshot reader first so the
                        // next pass takes the newest snapshot. Superseded snapshots skip the scripts; unless Stop or a gone
                        // reply ends the loop, the last snapshot is always written (MC-1451, MC-2990, MC-2991).
                        await yieldTask()
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
                    replyGone = !(await processAndWriteReply(reformatContent(prefix + result), false, false))
                }
                // The last write held an open block raw: the stored reply is the pass over its whole text, as when no
                // block was held. Done, Stop and a reader error all end here; a flush error has already thrown above.
                if(!replyGone && settleText !== null && !deferStreamingPostProcessing){
                    replyGone = !(await processAndWriteReply(settleText, false, false))
                }
            }
            finally {
                removeActiveStream()
                const endedReply = streamsIntoReply ? resolveReply() : null
                if(endedReply){
                    delete endedReply.ctx.chat.message[endedReply.index].interrupted
                }
                // After `delete interrupted`: the mark and the waiter's target follow it, so the commit that covers the
                // target holds the settled reply. Before the hidden flush below, whose save then covers the mark.
                if(nativeReplyGrant){
                    settleOwnedStreamEnd(generationId, endedReply ? { chaId: origin.chaId, saveMarkCount: getSaveMarkCount } : null)
                }
                const streamEndCtx = subject.resolve()
                if(streamEndCtx){
                    streamEndCtx.chat.isStreaming = false
                    streamEndCtx.chat.activeStreamingDisplayOptimizationMode = undefined
                    streamEndCtx.owner.reloadKeys += 1
                }
                void snapshots.cancel()
                // The reply text is settled here, and the post-reply steps below may wait on
                // timers a hidden page does not run.
                flushPageReplyEndWhenHidden(origin)
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
            addRerolls(generationId, Object.values(lastResponseChunk), { chaId: origin.chaId, chatId: origin.chatId }, candidateStartState)

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
                    ttsBefore = beforeData
                    result2 = await processScriptFull(nowChatroom, reformatContent(beforeData + mess), 'editoutput', continuedTarget.index, {}, undefined, subject, replyMessageRef(continuedTarget))
                }
            }
            modelText = DBState.db.removeIncompleteResponse ? trimUntilPunctuation(mess) : mess
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
                    const continuedOldId = replaceTarget.ctx.chat.message[replaceTarget.index].chatId
                    replaceTarget.ctx.chat.message[replaceTarget.index] = {
                        role: 'char',
                        data: result,
                        saying: currentChar.chaId,
                        time: Date.now(),
                        generationInfo,
                        promptInfo,
                        chatId: generationId,
                    }
                    // The message has a new id: what named the old one follows it, in
                    // the same synchronous run as the swap.
                    if(continuedOldId){
                        renameContinuedMessage(replaceTarget.ctx.chat, continuedOldId, generationId)
                        renameLoreUseReply(continuedOldId, generationId)
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
                // The mark comes first, so the count read for the waiter covers it. No save is requested: the hidden
                // flush at the reply's end and the visible debounce are the page's own save requests.
                if(nativeReplyGrant && ownsPushedReply(generationId)){
                    markCharacterForSave(origin.chaId)
                    noteReplyPushed(generationId, origin.chaId, getSaveMarkCount())
                }
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
        }

        // The reply is written; the output trigger below may wait on timers a hidden page does not run.
        flushPageReplyEndWhenHidden(origin)

        if(mrerolls.length >1){
            addRerolls(generationId, mrerolls, { chaId: origin.chaId, chatId: origin.chatId }, candidateStartState)
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

    // Only a speaker whose mode produces speech is parsed and spoken: the parse
    // of an unvoiced speaker would feed text to nothing, and `sayTTS` would run
    // TTS preprocess hooks for it. A chat that is not on screen is not spoken.
    if(!abortSignal.aborted && DBState.db.ttsAutoSpeech && isTTSVoiceMode(currentChar.ttsMode) && isShownChat(origin)){
        const ttsTarget = resolveReply()
        if(ttsTarget){
            const storedReply = ttsTarget.ctx.chat.message[ttsTarget.index]
            const ttsChara = storedReply.role === 'user' ? getUserName(ttsTarget.ctx.chat) : ttsTarget.ctx.owner.name
            const spoken = ttsAddition(ttsBefore, storedReply.data, (stored) => risuChatParser(stored, buildDisplayParseOptions({
                chara: ttsChara,
                chatID: ttsTarget.index,
                firstmsg: false,
                chatRole: storedReply.role,
                subject,
            })), !!currentChar.ttsReadOnlyQuoted)
            if(spoken.trim()){
                // The spoken run is translated into the shown language, after the MC-204 diff, unless the display would
                // not translate it either or the provider translates by itself.
                const wantsTranslation = DBState.db.autoTranslate
                    && !(DBState.db.translatorType === 'llm' && DBState.db.autoTranslateCachedOnly)
                    && !providerTranslatesItself(currentChar)
                let text: string | null = spoken
                if(wantsTranslation){
                    const note = ttsTarget.ctx.owner.type === 'character' ? ttsTarget.ctx.owner.translatorNote : undefined
                    text = await translateForSpeech(spoken, [abortSignal, currentTTSSignal()], note)
                }
                // The reply can be deleted while the translation is pending; a Stop or a deleted chat ends the wait.
                // The chat can also be left meanwhile, and a chat that is not on screen is not spoken.
                if(text !== null && !abortSignal.aborted && resolveReply() && isShownChat(origin)){
                    await sayTTS(currentChar, text, { skipTextFilter: true })
                }
            }
        }
    }

    let needsAutoContinue = false
    // The decision reads the text this request produced, as the model returned
    // it, so it does not depend on how the reply was delivered or on output
    // scripts. A request that produced nothing never continues, so an empty
    // reply cannot chain paid requests.
    const resultTokens = await tokenize(modelText) + (arg.usedContinueTokens || 0)
    if(modelText.trim() !== '' && DBState.db.autoContinueMinTokens > 0 && resultTokens < DBState.db.autoContinueMinTokens){
        needsAutoContinue = true
    }

    if(modelText.trim() !== '' && DBState.db.autoContinueChat && (!isLastCharPunctuation(modelText))){
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
    setProcessStage(origin, 4)
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
                throwError(language.errors.unexpectedResponseType)
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
                throwError(language.errors.stableDiffusionGroupUnsupported)
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
