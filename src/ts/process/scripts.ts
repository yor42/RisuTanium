import { get } from "svelte/store";
import { CharEmotion, selectedCharID } from "../stores.svelte";
import { type character, type customscript, type groupChat, getDatabase, getCurrentCharacter, getCurrentChat, type Chat, type Message } from "../storage/database.svelte";
import { downloadFile } from "../globalApi.svelte";
import { alertError, alertNormal } from "../alert";
import { language } from "src/lang";
import { selectSingleFile } from "../util";
import { assetRegex, type CbsConditions, risuChatParser as risuChatParserOrg, type simpleCharacterArgument } from "../parser/parser.svelte";
import type { PromptView } from "../cbs";
import { getModuleAssets, getModuleRegexScripts } from "./modules";
import { HypaProcesser } from "./memory/hypamemory";
import { runLuaEditTrigger } from "./scriptings";
import { pluginV2 } from "../plugins/plugins.svelte";
import { runTrigger } from "./triggers";
import { createRunSubject, type Origin, type RunSubject } from "./chatOrigin";

const dreg = /{{data}}/g
const randomness = /\|\|\|/g

export type ScriptMode = 'editinput'|'editoutput'|'editprocess'|'editdisplay'

type pScript = {
    script: customscript,
    order: number
    actions: string[]
}

export async function processScript(char:character|groupChat, data:string, mode:ScriptMode, cbsConditions:CbsConditions = {}, origin?:Origin, subject?:RunSubject, promptView?:PromptView){
    return (await processScriptFull(char, data, mode, -1, cbsConditions, origin, subject, undefined, promptView)).data
}

export function exportRegex(s?:customscript[]){
    let db = getDatabase()
    const script = s ?? db.globalscript
    const data = Buffer.from(JSON.stringify({
        type: 'regex',
        data: script
    }), 'utf-8')
    downloadFile(`regexscript_export.json`,data)
    alertNormal(language.successExport)
}

export async function importRegex(o?:customscript[]):Promise<customscript[]>{
    o = o ?? []
    const filedata = (await selectSingleFile(['json'])).data
    if(!filedata){
        return o
    }
    let db = getDatabase()
    try {
        const imported= JSON.parse(Buffer.from(filedata).toString('utf-8'))
        if(imported.type === 'regex' && imported.data){
            const datas:customscript[] = imported.data
            const script = o
            for(const data of datas){
                script.push(data)
            }
            return o
        }
        else{
            alertError(language.errors.fileInvalidOrCorrupted)
        }

    } catch (error) {
        alertError(error)
    }
    return o
}

let bestMatchCache = new Map<string, string>()
let processScriptCache = new Map<string, string>()

const scriptPassCounters = { cacheHits: 0, scans: 0 }

/**
 * Test-only counts of script-cache hits and of the linear scans that find a
 * referenced message when its reference carries no locator.
 */
export function scriptPassCountersForTests(): { cacheHits: number, scans: number } {
    return { ...scriptPassCounters }
}

export function resetScriptPassCountersForTests(): void {
    scriptPassCounters.cacheHits = 0
    scriptPassCounters.scans = 0
}

/**
 * Finds a message in a chat's message array by identity when the index it was
 * recorded at does not hold it. `-1`: not found where the pass last mapped it,
 * and the message is treated as gone.
 */
export interface MessageLocator {
    find(messages: Message[], message: Message): number
}

/**
 * The message `@@inject` and `@@repeat_back` act on: the message object and
 * the index it had when the call started. The branches find it again by
 * identity in the subject's chat, so an edit to the chat during the call
 * cannot redirect them to another message.
 */
export interface MessageRef {
    message: Message
    index: number
    /** Shared by every call of one pass over a chat, so that a shifted chat costs one map build rather than one scan per call. Without one, a scan finds the message. */
    locator?: MessageLocator
}

function locateMessage(messages: Message[], ref: MessageRef): number {
    if(messages[ref.index] === ref.message){
        return ref.index
    }
    if(ref.locator){
        return ref.locator.find(messages, ref.message)
    }
    scriptPassCounters.scans++
    for(let i = 0; i < messages.length; i++){
        if(messages[i] === ref.message){
            return i
        }
    }
    return -1
}

function generateScriptCacheKey(scripts: customscript[], data: string, mode: ScriptMode, chatID = -1, cbsConditions: CbsConditions = {}, subject?: RunSubject, promptView?: PromptView) {
    let hash = data + '|||' + mode + '|||';
    for (const script of scripts) {
        if(script.type !== mode){
            continue
        }
        hash += `${script.flag?.includes('<cbs>') ? risuChatParser(script.in, { chatID: chatID, cbsConditions, subject, promptView }) : script.in}|||${script.out}${chatID}|||${script.flag ?? ''}|||${script.ableFlag ? 1 : 0}`;
    }
    return hash;
}

const flagActionRegex = /<(.+?)>/g

/**
 * Whether running the scripts of `mode` over `data` gives a result the cache
 * key determines, with no side effect a hit would skip. The test reads the key's
 * own inputs only, so an entry under the key holds the same text whichever
 * caller stored it. A script `out` or the text itself holding `{` or `<` may
 * carry a tag or a legacy `<char>` form, which reads chat, variables, owner or
 * persona; the actions and `@@` outs below read other messages or write. A
 * script whose `out` or `flag` is not a string comes from malformed imported
 * data; it is not key-determined, and its own run decides what it does.
 */
function isKeyDeterminedPass(scripts: customscript[], mode: ScriptMode, data: string): boolean {
    if(data.includes('{') || data.includes('<')){
        return false
    }
    for(const script of scripts){
        if(script.type !== mode){
            continue
        }
        const out = script.out
        if(typeof out !== 'string'){
            return false
        }
        if(out.includes('{') || out.includes('<')){
            return false
        }
        if(out.startsWith('@@') && !out.startsWith('@@move_top') && !out.startsWith('@@move_bottom')){
            return false
        }
        const flag = script.flag
        if(flag !== undefined && typeof flag !== 'string'){
            return false
        }
        if(flag && flag.includes('<')){
            for(const match of flag.matchAll(flagActionRegex)){
                for(const meta of match[1].split(',')){
                    const action = meta.trim()
                    if(action === 'cbs' || action === 'repeat_back' || action === 'inject'){
                        return false
                    }
                }
            }
        }
    }
    return true
}

function cacheScript(hash:string, result:string){
    processScriptCache.set(hash, result)

    if(processScriptCache.size > 1000){
        processScriptCache.delete(processScriptCache.keys().next().value)
    }

}

function getScriptCache(hash:string){
    return processScriptCache.get(hash)
}

export function resetScriptCache(){
    processScriptCache = new Map()
}

/**
 * `sendSubject` is the caller's own address into the database. With it, the
 * module regex list, the parses and the dynamic assets read the owner and chat
 * it resolves, never the selection, and the Lua edit triggers choose their
 * scripts through it. It supersedes `origin`, which on its own only builds a
 * subject for the same reads. With neither, the selection is read.
 *
 * `messageRef` is honoured only together with a subject, and decides what
 * `@@inject` and `@@repeat_back` act on:
 * - `undefined`: the branches address `chatID` in the selection's chat, as
 *   they do with no subject.
 * - `null`: the call has no such message yet (a reply that is not in the
 *   chat), so `@@inject` does nothing and `@@repeat_back` reads as it does
 *   for a message that does not exist.
 * - a reference: the message is found by identity in the subject's chat. With
 *   a locator, one the pass's map no longer places is treated as gone, as for
 *   `null`; without one, it is searched for wherever it now sits, and is gone
 *   only when it is no longer in the chat.
 *
 * `promptView` marks a call that builds the prompt. Its parses and
 * `@@repeat_back` then skip the messages the prompt does not send, and the
 * script cache serves and stores it only when `isKeyDeterminedPass` holds.
 * Without one the call reads and caches as any other.
 */
export async function processScriptFull(char:character|groupChat|simpleCharacterArgument, data:string, mode:ScriptMode, chatID = -1, cbsConditions:CbsConditions = {}, origin?:Origin, sendSubject?:RunSubject, messageRef?:MessageRef|null, promptView?:PromptView){
    let db = getDatabase()
    let emoChanged = false
    const subject = sendSubject ?? (origin ? createRunSubject(origin) : undefined)
    const refPass = subject && messageRef !== undefined ? { subject, ref: messageRef } : undefined
    data = await runLuaEditTrigger(char, mode, data, { index:chatID }, origin, sendSubject)

    if(mode === 'editdisplay'){
        const currentChar = getCurrentCharacter()
        if(currentChar.type !== 'group'){
            try{
                const perf = performance.now()
                const d = await runTrigger(currentChar, 'display', {
                    chat: getCurrentChat(),
                    displayMode: true,
                    displayData: data
                })
    
                data = d?.displayData ?? data
                console.log('Trigger time', performance.now() - perf)
            }
            catch(e){
                console.error(e)
            }
        }
    }

    if(pluginV2[mode].size > 0){
        for(const plugin of pluginV2[mode]){
            const res = await plugin(data)
            if(res !== null && res !== undefined){
                data = res
            }
        }
    }

    data = risuChatParser(data, { chatID: chatID, cbsConditions, subject, promptView })
    const scripts = (db.presetRegex ?? []).concat(char.customscript).concat(getModuleRegexScripts(subject))
    const useCache = !promptView || isKeyDeterminedPass(scripts, mode, data)
    const hash = useCache ? generateScriptCacheKey(scripts, data, mode, chatID, cbsConditions, subject, promptView) : ''
    const cached = useCache ? getScriptCache(hash) : undefined
    if(cached){
        scriptPassCounters.cacheHits++
        return {data: cached, emoChanged: false}
    }
    
    if(scripts.length === 0){
        if(useCache){
            cacheScript(hash, data)
        }
        return {data, emoChanged}
    }
    function executeScript(pscript:pScript){
        const script = pscript.script
        
        if(script.in === ''){
            return
        }

        if(script.type === mode){

            let outScript2 = script.out.replaceAll("$n", "\n")
            let outScript = outScript2.replace(dreg, "$&")
            let flag = 'g'
            if(script.ableFlag){
                flag = script.flag || 'g'
            }
            if(outScript.endsWith('>') && !pscript.actions.includes('no_end_nl')){
                outScript += '\n'
            }
            //remove unsupported flag
            flag = flag.trim().replace(/[^dgimsuvy]/g, '')

            //remove repeated flags
            flag = flag.split('').filter((v, i, a) => a.indexOf(v) === i).join('')
            
            if(flag.length === 0){
                flag = 'u'
            }

            let input = script.in
            if(pscript.actions.includes('cbs')){
                input = risuChatParser(input, { chatID: chatID, cbsConditions, subject, promptView })
            }

            const reg = new RegExp(input, flag)
            if(outScript.startsWith('@@') || pscript.actions.length > 0){
                if(reg.test(data)){
                    if(outScript.startsWith('@@emo ')){
                        const emoName = script.out.substring(6).trim()
                        let charemotions = get(CharEmotion)
                        let tempEmotion = charemotions[char.chaId]
                        if(!tempEmotion){
                            tempEmotion = []
                        }
                        if(tempEmotion.length > 4){
                            tempEmotion.splice(0, 1)
                        }
                        if(char.type !== 'simple'){
                            for(const emo of char.emotionImages){
                                if(emo[0] === emoName){
                                    const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                                    tempEmotion.push(emos)
                                    charemotions[char.chaId] = tempEmotion
                                    CharEmotion.set(charemotions)
                                    emoChanged = true
                                    break
                                }
                            }
                        }
                    }
                    else if((outScript.startsWith('@@inject') || pscript.actions.includes('inject')) && chatID !== -1){
                        if(refPass){
                            // The write and its mark are one synchronous stretch; a message
                            // that is not in the chat leaves the data as it is.
                            const ctx = refPass.subject.resolve()
                            const at = ctx && refPass.ref ? locateMessage(ctx.chat.message, refPass.ref) : -1
                            if(ctx && at !== -1){
                                ctx.chat.message[at].data = data
                                refPass.subject.mark()
                                data = data.replace(reg, "")
                            }
                        }
                        else{
                            const selchar = db.characters[get(selectedCharID)]
                            selchar.chats[selchar.chatPage].message[chatID].data = data
                            data = data.replace(reg, "")
                        }
                    }
                    else if(
                        outScript.startsWith('@@move_top') || outScript.startsWith('@@move_bottom') ||
                        pscript.actions.includes('move_top') || pscript.actions.includes('move_bottom')
                    ){
                        // The test above advances lastIndex of a global or sticky regex; every
                        // match the replace below removes must also be found here.
                        reg.lastIndex = 0
                        const isGlobal = flag.includes('g')
                        const matchAll = isGlobal ? data.matchAll(reg) : [data.match(reg)]
                        data = data.replace(reg, "")
                        const template = outScript.replace('@@move_top ', '').replace('@@move_bottom ', '')
                        const moved:string[] = []
                        for(const matched of matchAll){
                            if(matched){
                                const inData = matched[0]
                                moved.push(template
                                    .replace(/(?<!\$)\$[0-9]+/g, (v)=>{
                                        const index = parseInt(v.substring(1))
                                        if(index < matched.length){
                                            return matched[index]
                                        }
                                        return v
                                    })
                                    .replace(/\$\&/g, inData)
                                    .replace(/(?<!\$)\$<([^>]+)>/g, (v, groupName:string) => {
                                        // Like String.replace: without named groups the text stays literal,
                                        // with them a group that did not participate is empty.
                                        if(matched.groups){
                                            return matched.groups[groupName] ?? ''
                                        }
                                        return v
                                    }))
                            }
                        }
                        // Built once: moved[0] is the first match; move_top ends with the last match on top.
                        if(outScript.startsWith('@@move_top') || pscript.actions.includes('move_top')){
                            data = moved.reverse().map((out) => out + '\n').join('') + data
                        }
                        else{
                            data = data + moved.map((out) => '\n' + out).join('')
                        }
                    }
                    else{
                        data = risuChatParser(data.replace(reg, outScript), { chatID: chatID, cbsConditions, subject, promptView })
                    }
                }
                else{
                    if((outScript.startsWith('@@repeat_back') || pscript.actions.includes('repeat_back'))  && chatID !== -1){
                        const v = outScript.split(' ', 2)[1]
                        let owner:character|groupChat
                        let chat:Chat
                        let at = chatID
                        if(refPass){
                            const ctx = refPass.subject.resolve()
                            if(!ctx){
                                return
                            }
                            owner = ctx.owner
                            chat = ctx.chat
                            at = refPass.ref ? locateMessage(chat.message, refPass.ref) : -1
                            // Without such a message the read at `chatID` is what remains:
                            // with `chatID > 0` it finds nothing and appends nothing, at 0
                            // there is nothing to walk back over.
                            if(at === -1){
                                if(chatID > 0){
                                    return
                                }
                                at = chatID
                            }
                        }
                        else{
                            owner = db.characters[get(selectedCharID)]
                            chat = owner.chats[owner.chatPage]
                        }
                        let lastChat = chat.fmIndex === -1 ? owner.firstMessage : owner.alternateGreetings[chat.fmIndex]
                        let pointer = at - 1
                        let earlierFound = false
                        while(pointer >= 0){
                            if(chat.message[pointer].role === chat.message[at].role && !promptView?.hidden(chat.message[pointer])){
                                lastChat = chat.message[pointer].data
                                earlierFound = true
                                break
                            }
                            pointer--
                        }
                        // With no earlier sent message of the role, the first message is the
                        // fallback only when it was sent.
                        if(!earlierFound && promptView && !promptView.firstSent){
                            return
                        }

                        const r = lastChat.match(reg)
                        if(!v){
                            data = data + r[0]
                        }
                        else if(r[0]){
                            switch(v){
                                case 'end':
                                    data = data + r[0]
                                    break
                                case 'start':
                                    data = r[0] + data
                                    break
                                case 'end_nl':
                                    data = data + "\n" + r[0]
                                    break
                                case 'start_nl':
                                    data = r[0] + "\n" + data
                                    break
                            }

                        }                        
                    }
                }
            }
            else{
                data = risuChatParser(data.replace(reg, outScript), { chatID: chatID, cbsConditions, subject, promptView })
            }
        }
    }

    let parsedScripts:pScript[] = []
    let orderChanged = false
    for (const script of scripts){
        if(script.ableFlag && script.flag?.includes('<')){
            const rregex = /<(.+?)>/g
            const scriptData = safeStructuredClone(script)
            let order = 0
            const actions:string[] = []
            scriptData.flag = scriptData.flag?.replace(rregex, (v:string, p1:string) => {
                const meta = p1.split(',').map((v) => v.trim())
                for(const m of meta){
                    if(m.startsWith('order ')){
                        order = parseInt(m.substring(6))
                        orderChanged = true
                    }
                    else{
                        actions.push(m)
                    }
                }

                return ''
            })
            parsedScripts.push({
                script: scriptData,
                order,
                actions
            })
            continue
        }
        parsedScripts.push({
            script,
            order: 0,
            actions: []
        })
    }

    if(orderChanged){
        parsedScripts.sort((a, b) => b.order - a.order) //sort by order
    }
    for (const script of parsedScripts){
        try {
            executeScript(script)            
        } catch (error) {
            console.error(error)
        }
    }

    

    if(db.dynamicAssets && (char.type === 'simple' || char.type === 'character') && char.additionalAssets && char.additionalAssets.length > 0){
        if((!db.dynamicAssetsEditDisplay && mode === 'editdisplay')
            || mode === 'editinput' || mode === 'editprocess'){
            if(useCache){
                cacheScript(hash, data)
            }
            return {data, emoChanged}
        }
        const assetNames = char.additionalAssets.map((v) => v[0])

        const moduleAssets = getModuleAssets(subject)
        if(moduleAssets.length > 0){
            for(const asset of moduleAssets){
                assetNames.push(asset[0])
            }
        }

        const processer = new HypaProcesser()
        await processer.addText(assetNames)
        const matches = data.matchAll(assetRegex)

        for(const match of matches){
            const type = match[1]
            const assetName = match[2]
            const cacheKey = char.chaId + '::' + assetName
            if(type !== 'emotion' && type !== 'source'){
                if(bestMatchCache.has(cacheKey)){
                    data = data.replaceAll(match[0], `{{${type}::${bestMatchCache.get(cacheKey)}}}`)
                }
                else if(!assetNames.includes(assetName)){
                    const searched = await processer.similaritySearch(assetName)
                    const bestMatch = searched[0]
                    if(bestMatch){
                        data = data.replaceAll(match[0], `{{${type}::${bestMatch}}}`)
                        bestMatchCache.set(cacheKey, bestMatch)
                    }
                }
            }
        }
    }

    if(useCache){
        cacheScript(hash, data)
    }

    return {data, emoChanged}
}


const rgx = /(?:{{|<)(.+?)(?:}}|>)/gm
export const risuChatParser = risuChatParserOrg