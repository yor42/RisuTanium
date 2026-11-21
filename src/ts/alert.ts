import { get, writable } from "svelte/store"
import { untrack } from "svelte"
import { language } from "../lang"
import { isTauri, isNodeServer } from "src/ts/platform"
import { getDatabase, type MessageGenerationInfo } from "./storage/database.svelte"
import { alertStore as alertStoreImported } from "./stores.svelte"
import { askPrompt, noticeShowing, promptShowing, promptWaiting } from "./alertPrompts"
import type { PromptCancel } from "./alertCancel"
import { taskActionSettled, taskResultRead, taskResultShowing, taskShown } from "./alertTask.svelte"
import { postToast, toastHost } from "./toast/toastHost.svelte"

/** What the per-record conflict dialog shows for one record: text already in the person's language, and the choices offered. */
export interface PeerConflictRowView {
    id: string
    label: string
    choices: Array<'mine' | 'theirs' | 'both'>
    preselect: 'mine' | 'theirs' | 'both'
    /** The sentence that says what keep both does for this record; null for a record without that choice. */
    note: string | null
}

/** What an update offer shows. Every field is untrusted remote text. */
export interface UpdateOffer {
    currentVersion: string
    version: string
    notes: string
}

export interface alertData{
    type: 'error'|'normal'|'none'|'ask'|'wait'|'selectChar'
            |'input'|'toast'|'wait2'|'markdown'|'select'
            |'tos'|'cardexport'|'requestdata'|'addchar'|'hypaV2'|'selectModule'
            |'chatOptions'|'pukmakkurit'|'branches'|'progress'|'pluginconfirm'|'requestlogs'
            |'staleAccountNotice'|'patternSelect'|'patternInput'|'peerConflicts'|'parkedReply'|'updateOffer'|'presetBundle',
    msg: string,
    submsg?: string
    datalist?: [string, string][],
    /** Options of a `patternSelect` prompt, carried structured rather than joined into `msg`. */
    choices?: string[],
    /** The rows of a `peerConflicts` prompt; its answer is the JSON of `{ [row id]: choice }`. */
    peerConflicts?: PeerConflictRowView[],
    /** The reply of a `parkedReply` prompt: the character's name and the reply text, both shown as text. Its answer is `discard` or `later`. */
    parkedReply?: { name: string, text: string },
    /** The update of an `updateOffer` prompt: the installed version, the offered version and the release notes. All three come from a remote file and render as text only. Its answer is `install` or `later`. */
    updateOffer?: UpdateOffer,
    /** The rows of a `presetBundle` prompt and the preset names already in the list. Every string comes from a file and renders as text only. Its answer is `cancel` or the JSON of the ticked row indices. */
    presetBundle?: { rows: { name: string, folder: string | null, aiModel: string }[], existingNames: string[] },
    stackTrace?: string;
    defaultValue?: string
    /** Set on a wait alert that can be cancelled: the action that ends the wait early. */
    onCancel?: () => void
    /** Set on a select or input prompt whose caller offered a cancel, and always on an `updateOffer` prompt: the answer its Cancel button, Back and Escape write. */
    cancelAnswer?: string
    /** Set on an error alert that has a place to fix it: a button that closes the alert, then runs `open`. */
    link?: { label: string, open: () => void }
}

type AlertGenerationInfoStoreData = {
    genInfo: MessageGenerationInfo,
    idx: number
}
export const alertGenerationInfoStore = writable<AlertGenerationInfoStoreData>(null)
export const alertStore = {
    set: (d:alertData) => {
        // Code never closes a prompt that is on screen, or a boot notice from the queue; only the user's answer does.
        if(d.type === 'none' && (promptShowing() || noticeShowing())){
            return
        }
        alertStoreImported.set(d)
    }
}

export function alertError(msg: string | Error, opts?: { link?: alertData['link'] }) {
    console.error(msg)
    const db = getDatabase()

    let stackTrace: string | undefined = undefined; 

    if (typeof(msg) !== 'string') {
        try{
            if (msg instanceof Error) {
                stackTrace = msg.stack
                msg = msg.message
            } else {
                msg = JSON.stringify(msg)
            }
        } catch {
            msg = `${msg}`
        }
    }

    msg = msg.trim()

    const ignoredErrors = [
        '{}'
    ]

    if(ignoredErrors.includes(msg)){
        return
    }

    let submsg = ''

    //check if it's a known error
    if(msg.includes('Failed to fetch') || msg.includes("NetworkError when attempting to fetch resource.")){
        submsg =    (!isTauri && !isNodeServer) ? language.errors.networkFetchWeb : language.errors.networkFetch
    }

    alertStoreImported.set({
        'type': 'error',
        'msg': msg,
        'submsg': submsg,
        'stackTrace': stackTrace,
        ...(opts?.link ? { 'link': opts.link } : {})
    })
}

/**
 * Resolves with the `msg` of the first `none` value the alert store takes, or
 * already holds. The answer comes from the value that ended the alert, as the
 * subscriber receives it, never from a later read of the store: whatever is put
 * in the store after the answer cannot replace it. Only the waiters of a notice
 * (`waitAlert`) use this, so they resolve when the notice closes. A prompt does
 * not: the first `none` may be the close of a notice that covered it, so a
 * prompt takes its answer through `askPrompt` in `alertPrompts.ts`.
 */
function alertEndMessage(): Promise<string> {
    return new Promise<string>((resolve) => {
        let settled = false
        let unsubscribe: (() => void) | undefined
        unsubscribe = alertStoreImported.subscribe((v) => {
            if (settled || v.type !== 'none') {
                return
            }
            settled = true
            resolve(v.msg)
            // On the synchronous first call `unsubscribe` is not assigned yet;
            // the check below `subscribe()` covers it.
            unsubscribe?.()
        })
        if (settled) {
            unsubscribe()
        }
    })
}

/** Waits until the alert store is `none`. */
export async function waitAlert(): Promise<void> {
    await alertEndMessage()
}

/** Alerts that are not a notice to read: nothing, a toast that closes itself, and a job's own wait or progress. */
const NOT_A_NOTICE: ReadonlySet<alertData['type']> = new Set(['none', 'toast', 'wait', 'progress'])

/**
 * When the alert on screen is a notice to read, waits until the store next takes `none`. A task result that waits for its
 * answer is a notice too, whether it is on screen or yielded under a legacy notice, so the wait ends only once it is read.
 * A running task is not a notice. Otherwise returns at once.
 */
export async function waitUnreadNotice(): Promise<void> {
    if(!NOT_A_NOTICE.has(get(alertStoreImported).type)){
        await alertEndMessage()
    }
    if(taskResultShowing()){
        await taskResultRead()
        //A Retry on the result starts another round under the same action: the notice is read only at its final answer.
        await taskActionSettled()
    }
}

export function alertNormal(msg:string){
    alertStoreImported.set({
        'type': 'normal',
        'msg': msg
    })
}

export async function alertNormalWait(msg:string){
    alertStoreImported.set({
        'type': 'normal',
        'msg': msg
    })
    await waitAlert()
}

export async function alertAddCharacter() {
    return await askPrompt({
        'type': 'addchar',
        'msg': language.addCharacter
    })
}

export async function alertChatOptions() {
    return parseInt(await askPrompt({
        'type': 'chatOptions',
        'msg': language.chatOptions
    }))
}

/**
 * The `msg` written by the stale-account notice's own OK button
 * (`AlertComp.svelte`) once the user acknowledges it -- the only value that
 * resolves `alertStaleAccountNotice()`'s wait.
 */
export const STALE_ACCOUNT_NOTICE_ACK = 'stale-account-notice-acknowledged'

/**
 * Posts the stale-RisuAccount-profile notice (I6) and keeps it in front of
 * any other alert until the user's own OK acknowledges it: whatever the
 * store holds while waiting -- an unrelated alert, a toast, a generic
 * 'yes', or anything else -- re-posts the notice instead of resolving. Once
 * the ack is seen, `settled` makes every later store write a no-op for this
 * subscription, including one delivered synchronously inside the same
 * `subscribe()` call that observes the ack as the store's already-current
 * value: nothing after the ack can re-post the notice or resolve twice.
 */
export function alertStaleAccountNotice(): Promise<void> {
    return new Promise<void>((resolve) => {
        const post = () => alertStoreImported.set({
            'type': 'staleAccountNotice',
            'msg': language.staleAccountProfileNotice
        })
        let settled = false
        let unsubscribe: () => void
        unsubscribe = alertStoreImported.subscribe((v) => {
            if (settled) {
                return
            }
            if (v.type === 'none' && v.msg === STALE_ACCOUNT_NOTICE_ACK) {
                settled = true
                resolve()
                // `subscribe()` calls this callback synchronously with the
                // store's current value before assigning its own return
                // value to `unsubscribe`, so on that first call this is a
                // no-op; the check below `subscribe()` covers it instead.
                unsubscribe?.()
            } else if (v.type !== 'staleAccountNotice') {
                post()
            }
        })
        // Covers the case the comment above describes: if the store already
        // held the ack when this subscription was created, `settled` is
        // already true here even though the in-callback `unsubscribe?.()`
        // had nothing to call yet.
        if (settled) {
            unsubscribe()
        }
    })
}

export async function alertSelect(msg:string[], display?:string, options?:PromptCancel){
    const message = display !== undefined ? `__DISPLAY__${display}||${msg.join('||')}` : msg.join('||')
    const data: alertData = {
        'type': 'select',
        'msg': message
    }
    if(options?.cancel !== undefined){
        data.cancelAnswer = options.cancel
    }
    return await askPrompt(data)
}

/**
 * Asks whether to install an update. Any answer other than `install`, including Escape and Back,
 * is `later`; nothing here installs.
 */
export async function alertUpdateOffer(offer: UpdateOffer): Promise<'install' | 'later'>{
    const answer = await askPrompt({
        type: 'updateOffer',
        msg: '',
        updateOffer: offer,
        cancelAnswer: 'later',
    })
    return answer === 'install' ? 'install' : 'later'
}

export async function alertErrorWait(msg:string){
    alertStoreImported.set({
        'type': 'wait2',
        'msg': msg
    })
    await waitAlert()
}

export function alertMd(msg:string){
    alertStoreImported.set({
        'type': 'markdown',
        'msg': msg
    })
}

export function doingAlert(){
    return taskShown() || promptWaiting() || (get(alertStoreImported).type !== 'none' && get(alertStoreImported).type !== 'toast' && get(alertStoreImported).type !== 'wait')
}

/**
 * Posts an `info` toast to the app's toast host; it never touches the alert store, so an alert that is open stays as it is.
 * A text an `info` toast already shows, held covered or paused included, is not posted again: a producer that repeats the
 * same text keeps one entry and one announcement. The read is untracked so a calling effect never subscribes to the list.
 */
export function alertToast(msg:string){
    if (untrack(() => toastHost.visible).some((toast) => toast.kind === 'info' && toast.text === msg)) {
        return
    }
    postToast({ kind: 'info', text: msg })
}

/**
 * Shows a wait notice and returns the exact object it put in the store, so a
 * caller can tell later whether the store still holds its notice. With
 * `onCancel` the notice offers a Cancel button and Escape runs it.
 */
export function alertWait(msg:string, onCancel?: () => void): alertData {
    const data: alertData = {
        'type': 'wait',
        'msg': msg
    }
    if (onCancel) {
        data.onCancel = onCancel
    }
    alertStoreImported.set(data)
    return data
}

/**
 * The text an alert shows. A wait or progress alert also shows `line` (a busy
 * refusal) under its message. The stored alert is never changed, so a caller that
 * compares the store with the object it posted still finds its own.
 */
export function displayAlertText(value: alertData, line: string | null): string {
    if(line && (value.type === 'wait' || value.type === 'progress')){
        return value.msg + '\n' + line
    }
    return value.msg
}


/** Closes the alert on screen. A prompt or a boot notice from the queue that is on screen is left alone: only the person's answer closes it. */
export function alertClear(){
    if(promptShowing() || noticeShowing()){
        return
    }
    alertStoreImported.set({
        'type': 'none',
        'msg': ''
    })
}

export async function alertSelectChar(){
    return await askPrompt({
        'type': 'selectChar',
        'msg': ''
    })
}

export async function alertConfirm(msg:string){

    return (await askPrompt({
        'type': 'ask',
        'msg': msg
    })) === 'yes'
}

export async function alertCardExport(type:string = ''){

    return JSON.parse(await askPrompt({
        'type': 'cardexport',
        'msg': '',
        'submsg': type
    })) as {
        type: string,
        type2: string,
    }
}

export async function alertInput(msg:string, datalist?:[string, string][], defaultValue?:string, options?:PromptCancel) {

    const data: alertData = {
        'type': 'input',
        'msg': msg,
        'datalist': datalist ?? [],
        'defaultValue': defaultValue ?? ''
    }
    if(options?.cancel !== undefined){
        data.cancelAnswer = options.cancel
    }
    return await askPrompt(data)
}

export async function alertModuleSelect(){

    return await askPrompt({
        'type': 'selectModule',
        'msg': ''
    })
}

export function alertRequestData(info:AlertGenerationInfoStoreData){
    alertGenerationInfoStore.set(info)
    alertStoreImported.set({
        'type': 'requestdata',
        'msg': info.genInfo.generationId ?? 'none'
    })
}

export function showHypaV2Alert(){
    alertStoreImported.set({
        'type': 'hypaV2',
        'msg': ""
    })
}

export function alertRequestLogs(){
    alertStoreImported.set({
        'type': 'requestlogs',
        'msg': ''
    })
}
