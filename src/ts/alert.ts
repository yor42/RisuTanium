import { get, writable } from "svelte/store"
import { language } from "../lang"
import { isTauri, isNodeServer } from "src/ts/platform"
import { getDatabase, type MessageGenerationInfo } from "./storage/database.svelte"
import { alertStore as alertStoreImported } from "./stores.svelte"
import { askPrompt, promptShowing, promptWaiting } from "./alertPrompts"

export interface alertData{
    type: 'error'|'normal'|'none'|'ask'|'wait'|'selectChar'
            |'input'|'toast'|'wait2'|'markdown'|'select'
            |'tos'|'cardexport'|'requestdata'|'addchar'|'hypaV2'|'selectModule'
            |'chatOptions'|'pukmakkurit'|'branches'|'progress'|'pluginconfirm'|'requestlogs'
            |'staleAccountNotice',
    msg: string,
    submsg?: string
    datalist?: [string, string][],
    stackTrace?: string;
    defaultValue?: string
    /** Set on a wait alert that can be cancelled: the action that ends the wait early. */
    onCancel?: () => void
}

type AlertGenerationInfoStoreData = {
    genInfo: MessageGenerationInfo,
    idx: number
}
export const alertGenerationInfoStore = writable<AlertGenerationInfoStoreData>(null)
export const alertStore = {
    set: (d:alertData) => {
        // Code never closes a prompt that is on screen; only the user's answer does.
        if(d.type === 'none' && promptShowing()){
            return
        }
        alertStoreImported.set(d)
    }
}

export function alertError(msg: string | Error) {
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
        submsg =    db.usePlainFetch ? language.errors.networkFetchPlain :
                    (!isTauri && !isNodeServer) ? language.errors.networkFetchWeb : language.errors.networkFetch
    }

    alertStoreImported.set({
        'type': 'error',
        'msg': msg,
        'submsg': submsg,
        'stackTrace': stackTrace
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

export async function alertSelect(msg:string[], display?:string){
    const message = display !== undefined ? `__DISPLAY__${display}||${msg.join('||')}` : msg.join('||')
    return await askPrompt({
        'type': 'select',
        'msg': message
    })
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
    return promptWaiting() || (get(alertStoreImported).type !== 'none' && get(alertStoreImported).type !== 'toast' && get(alertStoreImported).type !== 'wait')
}

export function alertToast(msg:string){
    alertStoreImported.set({
        'type': 'toast',
        'msg': msg
    })
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


/** Closes the alert on screen. A prompt that is on screen is left alone: only its answer closes it. */
export function alertClear(){
    if(promptShowing()){
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

export async function alertPluginConfirm(msg:string){

    return (await askPrompt({
        'type': 'pluginconfirm',
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

export async function alertInput(msg:string, datalist?:[string, string][], defaultValue?:string) {

    return await askPrompt({
        'type': 'input',
        'msg': msg,
        'datalist': datalist ?? [],
        'defaultValue': defaultValue ?? ''
    })
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
