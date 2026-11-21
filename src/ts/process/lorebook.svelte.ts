import { get } from "svelte/store";
import { getChatVar, setChatVar } from '../parser/chatVar.svelte';
import {selectedCharID} from '../stores.svelte'
import { type Chat, type character, type groupChat, type Message, type loreBook } from "../storage/database.svelte";
import { DBState } from '../stores.svelte';
import { tokenize } from "../tokenizer";
import { risuChatParser } from "../parser/parser.svelte";
import { findCharacterbyId, pickHashRand, selectSingleFile } from "../util";
import { alertError, alertNormal } from "../alert";
import { language } from "../../lang";
import { downloadNotice } from "../exportNotice";
import { downloadFile } from "../globalApi.svelte";
import { getModuleLorebooks } from "./modules";
import { CCardLib } from "@risuai/ccardlib";
import { v4 } from "uuid";
import type { OriginContext, RunSubject } from "./chatOrigin";
import { markCharacterForSave } from "../storage/characterSaveMarks";
import type { PromptView } from "../cbs";
import { beginBusy } from "./memory/busyActions";
import { openOutsideBusy } from "../drive/exportDialogBusy";
import { splitLoreKeys } from "./loreKeys";
import { externalEntryDecorators, externalInsertOrder, placeDisabledMarker } from "./lorebookImportDecorators";
import { NoLorebookInPng, readLorebookFileJson } from "./lorebookFile";
import { firstMessageIndexOf } from "./firstMessage";
import { ASCII_WORD, createWordStartIncludes, defaultWordBoundaries, fullWordIncludes, UNICODE_WORD } from "./lorebookWordMatch";

/**
 * A fixed stand-in for `RunSubject` that always resolves to `ctx`, captured
 * once, rather than re-resolving the live database -- the lorebook scan's
 * own reads, flag writes and parses all share this one snapshot for the
 * whole call, however many entries and `tokenize` awaits it crosses. A gone
 * or ambiguous target's `ctx` is `null`: reads see an empty chat and writes
 * are skipped, exactly as an unresolved `RunSubject` would, but with no
 * further live lookups. `mark()` marks the snapshot's own owner (and member,
 * when present) directly, never through a fresh resolution.
 */
export function snapshotSubject(ctx: OriginContext | null): RunSubject {
    return {
        origin: ctx ? { chaId: ctx.owner.chaId, chatId: ctx.chat.id } : { chaId: '', chatId: '' },
        resolve: () => ctx,
        status: () => ctx ? 'ok' : 'gone',
        memberStatus: () => ctx?.member ? 'ok' : null,
        mark: () => {
            if(!ctx){
                return
            }
            markCharacterForSave(ctx.owner.chaId)
            if(ctx.member){
                markCharacterForSave(ctx.member.chaId)
            }
        },
    }
}

/** Where a key was found: an index into the scanned messages, or the lore entry (a `fullLore` index) whose text was recursed into. */
export type LoreHitAt = { message: number } | { entry: number }

export interface LoreQueryRecord {
    kind: 'key' | 'secondkey' | 'additional' | 'exclude' | 'excludeAll'
    result: boolean
    /** The first key of this query that is not a valid regular expression; the whole query then fails. */
    invalidRegex?: string
    hits: { key: string, at: LoreHitAt }[]
}

export type LoreForcedBy = 'activate' | 'dont_activate' | 'keep_activate_after_match' | 'dont_activate_after_match'

/** What the scan found out about one `fullLore` entry in its latest evaluation. */
export interface LoreEntryRecord {
    index: number
    skipped?: 'noKey'
    child: 'linked' | 'originalActive' | 'noOriginal' | null
    alwaysActive: boolean
    /** Names of the decorators that switched the entry off before any key was searched. */
    blockedBy: string[]
    forcedBy: LoreForcedBy | null
    probability: number[]
    queries: LoreQueryRecord[]
    activated: boolean
    tokens?: number
}

export interface LoreScanBegin {
    total: number
    characterCount: number
    chatCount: number
    budget: number
    scanDepth: number
}

/** Every number is a `fullLore` index; `kept` is in the order of the returned `actives`. */
export interface LoreScanFinal {
    kept: number[]
    cut: number[]
    deadInjectors: number[]
    merged: { index: number, into: number }[]
}

/**
 * Passed to `loadLoreBookV3Prompt` to make a scan a dry run that reports what it
 * decided. A probe never changes a decision except through `roll`, which stands
 * in for `Math.random` in `@@probability`, and it makes the scan's flag writes
 * skip the save mark. It needs a subject, so the scan never reads the selection.
 */
export interface LoreScanProbe {
    roll(): number
    begin(info: LoreScanBegin): void
    entry(record: LoreEntryRecord): void
    final(info: LoreScanFinal): void
}

export function addLorebook(type:number) {
    const selectedID = get(selectedCharID)
    if(type === 0){
        DBState.db.characters[selectedID].globalLore.push({
            key: '',
            comment: `New Lore ${DBState.db.characters[selectedID].globalLore.length + 1}`,
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false
        })
    }
    else{
        const page = DBState.db.characters[selectedID].chatPage
        DBState.db.characters[selectedID].chats[page].localLore.push({
            key: '',
            comment: `New Lore ${DBState.db.characters[selectedID].chats[page].localLore.length + 1}`,
            content: '',
            mode: 'normal',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false
        })
    }
}

export function addLorebookFolder(type:number) {
    const selectedID = get(selectedCharID)
    const id = v4()
    if(type === 0){
        DBState.db.characters[selectedID].globalLore.push({
            key: '\uf000folder:' + id,
            comment: `New Folder`,
            content: '',
            mode: 'folder',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false,
        })
    }
    else{
        const page = DBState.db.characters[selectedID].chatPage
        DBState.db.characters[selectedID].chats[page].localLore.push({
            key: '\uf000folder:' + id,
            comment: `New Folder`,
            content: '',
            mode: 'folder',
            insertorder: 100,
            alwaysActive: false,
            secondkey: "",
            selective: false,
        })
    }
}

/**
 * With a `promptView`, the send is running the scan: keywords and scan depth
 * count only the messages the prompt sends, and an entry's token budget is
 * measured on its text parsed as part of the prompt. The decorators that count
 * turns keep counting the whole chat.
 */
export async function loadLoreBookV3Prompt(subject?: RunSubject, promptView?: PromptView, probe?: LoreScanProbe){
    if(probe && !subject){
        throw new Error('A lorebook scan probe needs a subject: the scan would otherwise run against the live selection.')
    }
    // Resolved once, here, for the whole call -- every read below, the flag
    // writes further down, and this call's own CBS parses all share this one
    // snapshot, never a fresh resolution after one of this loop's own
    // `tokenize` awaits. A gone or ambiguous target leaves `char`/`chat`
    // undefined: the scan then has no character or chat lore, only whatever
    // `getModuleLorebooks` still returns from the database's own
    // `enabledModules`/`moduleIntergration` (not chat- or character-scoped),
    // and makes no per-chat reads or writes at all.
    let char: character | groupChat | undefined
    let chat: Chat | undefined
    let flagSubject: RunSubject | undefined
    if(subject){
        const ctx = subject.resolve()
        char = ctx?.owner
        chat = ctx?.chat
        flagSubject = probe ? { ...snapshotSubject(ctx), mark: () => {} } : snapshotSubject(ctx)
    }
    else{
        const selectedID = get(selectedCharID)
        char = DBState.db.characters[selectedID]
        chat = char?.chats?.[char.chatPage]
    }
    const characterLore = char?.globalLore ?? []
    const chatLore = chat?.localLore ?? []
    const moduleLorebook = getModuleLorebooks(subject)
    const fullLore = safeStructuredClone(characterLore.concat(chatLore).concat(moduleLorebook))
    // Only the probe reads these: entry records and the final classification, never returned.
    const probeIndexOf = probe ? new Map<object, number>() : null
    const currentChat = chat?.message ?? []
    let scannedMessages: Message[] | undefined
    const messagesToScan = (): Message[] => {
        if(!promptView){
            return currentChat
        }
        scannedMessages ??= currentChat.filter((message) => !promptView.hidden(message))
        return scannedMessages
    }
    const loreDepth = char?.loreSettings?.scanDepth ?? DBState.db.loreBookDepth
    const loreToken = char?.loreSettings?.tokenBudget ?? DBState.db.loreBookToken
    probe?.begin({
        total: fullLore.length,
        characterCount: characterLore.length,
        chatCount: chatLore.length,
        budget: loreToken,
        scanDepth: loreDepth,
    })
    const fullWordMatchingSetting = char?.loreSettings?.fullWordMatching ?? false
    //module and chat entries follow the character's option; no per-entry or per-module field exists
    const fullWordWordChar = char?.loreSettings?.fullWordAsciiBoundary ? ASCII_WORD : UNICODE_WORD
    //partial-word matching only; module and chat entries follow the character's option, and the matcher's text cache lives for this call
    const wordStartIncludes = char?.loreSettings?.cjkWordStart === true ? createWordStartIncludes(defaultWordBoundaries) : null
    const chatLength = currentChat.length + 1 //includes first message
    const recursiveScanning = char?.loreSettings?.recursiveScanning ?? true
    // `index` is the `fullLore` index the text came from; it is read only to name a hit's entry and is never copied into the scanned texts.
    let recursivePrompt:{
        prompt: string,
        source: string,
        data: string,
        index: number
    }[] = []
    let matchLog:{
        prompt: string,
        source: string
        activated: string
    }[] = []

    const searchMatch = (messages:Message[],arg:{
        keys:string[],
        searchDepth:number,
        regex:boolean
        caseSensitive:boolean
        fullWordMatching:boolean
        all?:boolean
        dontSearchWhenRecursive: boolean
    }, capture?: { hits: LoreQueryRecord['hits'], invalidRegex?: string }) => {
        //a depth beyond the message count must scan every message, not wrap around from the end
        const sliced = messages.slice(Math.max(0, messages.length - arg.searchDepth),messages.length)
        const newKeys = []
        for (const key of arg.keys) {
            const trimmed = key.trim()
            if (trimmed.length > 0) {
                newKeys.push(trimmed)
            }
        }
        arg.keys = newKeys
        let mList:{
            source:string
            prompt:string
            data:string
        }[] = sliced.map((msg, i) => {
            if(msg.role === 'user'){
                return {
                    source: `message ${i} by user`,
                    prompt: `\x01{{${DBState.db.username}}}:` + msg.data + '\x01',
                    data: msg.data
                }
            }
            else{
                return {
                    source: `message ${i} by char`,
                    prompt: `\x01{{${msg.name ?? (msg.saying ? findCharacterbyId(msg.saying)?.name : null) ?? char?.name}}}:` + msg.data + '\x01',
                    data: msg.data
                }
            }
        }).concat(
            arg.dontSearchWhenRecursive ? [] : recursivePrompt.map((msg) => {
                return {
                    source: 'lorebook ' + msg.source,
                    prompt: msg.prompt,
                    data: msg.data
                }
            }))    

        // Plain keys (every key outside regex mode, a non-/pattern/ key inside it) match
        // against comment-stripped text, in lower case unless the entry is case-sensitive.
        const buildPlainMList = () => mList.map((m) => {
            const strip = (text:string) => (arg.caseSensitive ? text : text.toLocaleLowerCase())
                .replace(/\{\{\/\/(.+?)\}\}/gi,'').replace(/\{\{comment:(.+?)\}\}/gi,'')
            return {
                source: m.source,
                prompt: strip(m.prompt),
                data: strip(m.data)
            }
        })
        const plainKey = (key:string) => arg.caseSensitive ? key : key.toLocaleLowerCase()
        // Only a probe's capture calls this. `k` indexes `mList`: the sliced messages first, then the recursed entries.
        const hitAt = (k:number): LoreHitAt => k < sliced.length
            ? { message: Math.max(0, messages.length - arg.searchDepth) + k }
            : { entry: recursivePrompt[k - sliced.length].index }

        if(arg.regex){
            const regexKeys: { key: string, regex: RegExp|null }[] = []
            for(const key of arg.keys){
                const parsed = key.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/)
                if(!parsed){
                    regexKeys.push({ key, regex: null })
                    continue
                }
                const [, pattern, flags] = parsed

                try {
                    regexKeys.push({ key, regex: new RegExp(pattern, flags) })
                } catch (error) {
                    if(capture){
                        capture.invalidRegex = key
                    }
                    return false
                }
            }
            const plainMList = regexKeys.some((k) => !k.regex) ? buildPlainMList() : []
            for(let i = 0; i < mList.length; i++){
                const mText = mList[i]
                const plainText = plainMList[i]?.data.replace(/ /g,'') ?? ''
                for(const {key, regex} of regexKeys){
                    if(regex){
                        regex.lastIndex = 0
                        if(regex.test(mText.data)){
                            matchLog.push({
                                prompt: mText.prompt,
                                source: mText.source,
                                activated: key
                            })
                            capture?.hits.push({ key, at: hitAt(i) })
                            return true
                        }
                    }
                    else if(wordStartIncludes ? wordStartIncludes(plainMList[i].data, plainKey(key)) : plainText.includes(plainKey(key).replace(/ /g,''))){
                        matchLog.push({
                            prompt: plainMList[i].prompt,
                            source: mText.source,
                            activated: key
                        })
                        capture?.hits.push({ key, at: hitAt(i) })
                        return true
                    }
                }
            }
            return false
        }

        mList = buildPlainMList()

        let allMode = arg.all ?? false
        let allModeMatched = true

        let mIndex = -1
        for(const m of mList){
            mIndex++
            let mText = m.data
            if(arg.fullWordMatching){
                for(const key of arg.keys){
                    if(fullWordIncludes(mText, plainKey(key), fullWordWordChar)){
                        matchLog.push({
                            prompt: m.prompt,
                            source: m.source,
                            activated: key
                        })
                        capture?.hits.push({ key, at: hitAt(mIndex) })
                        if(!allMode){
                            return true
                        }
                    }
                    else if(allMode){
                        allModeMatched = false
                    }
                }
            }
            else{
                mText = mText.replace(/ /g,'')
                for(const key of arg.keys){
                    const realKey = plainKey(key).replace(/ /g,'')
                    if(wordStartIncludes ? wordStartIncludes(m.data, plainKey(key)) : mText.includes(realKey)){
                        matchLog.push({
                            prompt: m.prompt,
                            source: m.source,
                            activated: key
                        })
                        capture?.hits.push({ key, at: hitAt(mIndex) })
                        if(!allMode){
                            return true
                        }
                    }
                    else if(allMode){
                        allModeMatched = false
                    }
                }
            }
        }
        if(allMode && allModeMatched){
            return true
        }
        return false
    
    }

    let matching = true
    let actives:{
        depth:number,
        pos:string,
        prompt:string
        role:'system'|'user'|'assistant'
        order:number
        tokens:number
        priority:number
        source:string
        inject:{
            operation:'append'|'prepend'|'replace',
            location:string,
            param:string
            lore:boolean
        }|null
    }[] = []
    let activatedIndexes:number[] = []
    let disabledUIPrompts:string[] = []
    let matchTimes = 0
    while(matching){
        matching = false
        for(let i=0;i<fullLore.length;i++){
            if(activatedIndexes.includes(i)){
                continue
            }
            if(!fullLore[i].alwaysActive && !fullLore[i].key){
                probe?.entry({
                    index: i,
                    skipped: 'noKey',
                    child: null,
                    alwaysActive: false,
                    blockedBy: [],
                    forcedBy: null,
                    probability: [],
                    queries: [],
                    activated: false,
                })
                continue
            }
            const record: LoreEntryRecord | null = probe ? {
                index: i,
                child: null,
                alwaysActive: false,
                blockedBy: [],
                forcedBy: null,
                probability: [],
                queries: [],
                activated: false,
            } : null
            let activated = true
            let pos = ''
            let inject:{
                operation:'append'|'prepend'|'replace',
                location:string,
                param:string
                lore:boolean
            } = null
            let depth = 0
            let scanDepth = loreDepth
            let order = fullLore[i].insertorder
            let priority = fullLore[i].insertorder
            let forceState:string = 'none'
            let role:'system'|'user'|'assistant' = 'system'
            let searchQueries:{
                keys:string[],
                negative:boolean,
                all?:boolean
                kind:LoreQueryRecord['kind']
            }[] = []
            let fullWordMatching = fullWordMatchingSetting
            let dontSearchWhenRecursive = false
            let keepActivateAfterMatch = false
            let dontActivateAfterMatch = false
            
            if(fullLore[i].mode === 'child'){
                activated = false
                if(record){
                    record.child = 'noOriginal'
                }
                for(let j=0;j<i;j++){
                    if(fullLore[j].id === fullLore[i].id){
                        if(!activatedIndexes.includes(j)){
                            fullLore[i].comment = fullLore[j].comment
                            fullLore[i].content = fullLore[j].content
                            fullLore[i].alwaysActive = true
                            activated = true
                            if(record){
                                record.child = 'linked'
                            }
                        }
                        else if(record){
                            record.child = 'originalActive'
                        }
                        break
                    }
                }
            }
            if(record){
                record.alwaysActive = fullLore[i].alwaysActive === true
            }
            let itemRecursive:'global'|true|false = 'global'
            const content = CCardLib.decorator.parse(fullLore[i].content, (name, arg) => {
                switch(name){
                    case 'end':{
                        pos = 'depth'
                        depth = 0
                        return
                    }
                    case 'activate_only_after':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        if(chatLength < int){
                            activated = false
                            record?.blockedBy.push(name)
                        }
                        return
                    }
                    case 'activate_only_every': {
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        if(chatLength % int !== 0){
                            activated = false
                            record?.blockedBy.push(name)
                        }
                        return
                    }
                    case 'keep_activate_after_match':{
                        const vara = getChatVar('__internal_ka_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()), flagSubject)
                        if(vara === 'true'){
                            forceState = 'activate'
                            if(record){
                                record.forcedBy = 'keep_activate_after_match'
                            }
                        }
                        else{
                            keepActivateAfterMatch = true
                        }
                        return false
                    }
                    case 'dont_activate_after_match': {
                        const vara = getChatVar('__internal_da_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()), flagSubject)
                        if(vara === 'true'){
                            forceState = 'deactivate'
                            if(record){
                                record.forcedBy = 'dont_activate_after_match'
                            }
                        }
                        else{
                            dontActivateAfterMatch = true
                        }
                        return false
                    }
                    case 'depth':
                    case 'reverse_depth':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        depth = int
                        pos = name === 'depth' ? 'depth' : 'reverse_depth'
                        return
                    }
                    case 'instruct_depth':
                    case 'reverse_instruct_depth':
                    case 'instruct_scan_depth':{
                        //the instruct mode does not exists in risu
                        return false
                    }
                    case 'role':{
                        if(arg[0] === 'user' || arg[0] === 'assistant' || arg[0] === 'system'){
                            role = arg[0]
                            return
                        }
                        return false
                    }
                    case 'scan_depth':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int) || int < 0){
                            return false
                        }
                        scanDepth = int
                        return
                    }
                    case 'is_greeting':{
                        const int = parseInt(arg[0])
                        if(Number.isNaN(int)){
                            return false
                        }
                        if((chat ? firstMessageIndexOf(char, chat) : -1) + 1 !== int){
                            activated = false
                            record?.blockedBy.push(name)
                        }
                        return
                    }
                    case 'position':{
                        if(arg[0].startsWith('pt_') || ["after_desc", "before_desc", "personality", "scenario"].includes(arg[0])){
                            pos = arg[0]
                            return
                        }
                        return false
                    }
                    case 'inject_lore':{
                        inject ??= {
                            operation: 'append',
                            location: '',
                            param: '',
                            lore: true
                        }
                        inject.location = arg.join(' ')
                        inject.lore = true
                        return
                    }
                    case 'inject_at':{
                        inject??= {
                            operation: 'append',
                            location: '',
                            param: '',
                            lore: false
                        }
                        inject.location = arg.join(' ')
                        inject.lore = false
                        return
                    }
                    case 'inject_replace':{
                        inject??= {
                            operation: 'replace',
                            location: '',
                            param: '',
                            lore: false
                        }
                        inject.operation = 'replace'
                        inject.param = arg.join(' ')
                        return
                    }
                    case 'inject_prepend':{
                        inject??= {
                            operation: 'prepend',
                            location: '',
                            param: '',
                            lore: false
                        }
                        inject.operation = 'prepend'
                        inject.param = arg.join(' ')
                        return
                    }
                    case 'ignore_on_max_context':{
                        priority = -1000
                        return
                    }
                    case 'additional_keys':{
                        searchQueries.push({
                            keys: arg,
                            negative: false,
                            kind: 'additional'
                        })
                        return
                    }
                    case 'exclude_keys':{
                        searchQueries.push({
                            keys: arg,
                            negative: true,
                            kind: 'exclude'
                        })
                        return
                    }
                    case 'exclude_keys_all':{
                        searchQueries.push({
                            keys: arg,
                            negative: true,
                            all: true,
                            kind: 'excludeAll'
                        })
                        return
                    }
                    case 'match_full_word':{
                        fullWordMatching = true
                        return
                    }
                    case 'match_partial_word':{
                        fullWordMatching = false
                        return
                    }
                    case 'is_user_icon':{
                        //TODO
                        return false
                    }
                    case 'activate':{
                        forceState = 'activate'
                        if(record){
                            record.forcedBy = 'activate'
                        }
                        return
                    }
                    case 'dont_activate':{
                        forceState = 'deactivate'
                        if(record){
                            record.forcedBy = 'dont_activate'
                        }
                        return
                    }
                    case 'disable_ui_prompt':{
                        if(['post_history_instructions','system_prompt'].includes(arg[0])){
                            disabledUIPrompts.push(arg[0])
                            return
                        }
                        return false
                    }
                    case 'probability':{
                        record?.probability.push(parseInt(arg[0]))
                        if((probe ? probe.roll() : Math.random()) * 100 > parseInt(arg[0])){
                            activated = false
                            record?.blockedBy.push(name)
                        }
                        return
                    }
                    case 'priority':{
                        priority = parseInt(arg[0])
                        return
                    }
                    //We can already do it with search depth, but its more readable and performant this way
                    case 'unrecursive':{
                        itemRecursive = false
                        return
                    }
                    case 'recursive':{
                        itemRecursive = true
                        return
                    }
                    case 'no_recursive_search':{
                        dontSearchWhenRecursive = true
                        return
                    }
                    default:{
                        return false
                    }
                }
            })
            

            if(!activated || forceState !== 'none' || fullLore[i].alwaysActive){
                //if the lore is not activated or force activated, skip the search
            }
            else{
                searchQueries.push({
                    keys: splitLoreKeys(fullLore[i].key, fullLore[i].useRegex),
                    negative: false,
                    kind: 'key'
                })

                if(fullLore[i].secondkey && fullLore[i].selective){
                    searchQueries.push({
                        keys: splitLoreKeys(fullLore[i].secondkey, fullLore[i].useRegex),
                        negative: false,
                        kind: 'secondkey'
                    })
                }

                for(const query of searchQueries){
                    const capture: { hits: LoreQueryRecord['hits'], invalidRegex?: string } | undefined = record ? { hits: [] } : undefined
                    const result = searchMatch(messagesToScan(), {
                        keys: query.keys,
                        searchDepth: scanDepth,
                        regex: fullLore[i].useRegex,
                        caseSensitive: fullLore[i].extentions?.risu_case_sensitive === true,
                        fullWordMatching: fullWordMatching,
                        all: query.all,
                        dontSearchWhenRecursive: dontSearchWhenRecursive
                    }, capture)
                    if(record && capture){
                        const queryRecord: LoreQueryRecord = { kind: query.kind, result, hits: capture.hits }
                        if(capture.invalidRegex !== undefined){
                            queryRecord.invalidRegex = capture.invalidRegex
                        }
                        record.queries.push(queryRecord)
                    }
                    if(query.negative){
                        if(result){
                            activated = false
                            break
                        }
                    }
                    else{
                        if(!result){
                            activated = false
                            break
                        }
                    }
                }
            }

            if(forceState === 'activate'){
                activated = true
            }
            else if(forceState === 'deactivate'){
                activated = false
            }

            if(activated){
                const active = {
                    depth: depth,
                    pos: pos,
                    prompt: content,
                    role: role,
                    order: order,
                    // Count tokens against the CBS-evaluated text (e.g. {{#if}}, {{getglobalvar}})
                    // so cutoff reflects what actually reaches the context, not the unevaluated source.
                    // runVar is left false (matching the output path in index.svelte.ts), so this
                    // evaluation has no side effects like setvar.
                    tokens: await tokenize(risuChatParser(content, promptView ? {chara: char, subject: flagSubject, promptView} : {chara: char, subject: flagSubject})),
                    priority: priority,
                    source: fullLore[i].comment || `lorebook ${i}`,
                    inject: inject ?? null
                }
                actives.push(active)
                probeIndexOf?.set(active, i)
                activatedIndexes.push(i)

                if(keepActivateAfterMatch){
                    setChatVar('__internal_ka_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()), 'true', flagSubject)
                }
                if(dontActivateAfterMatch){
                    setChatVar('__internal_da_' + (fullLore[i].id ?? pickHashRand(5555,fullLore[i].content).toString()), 'true', flagSubject)
                }


                let recursive = recursiveScanning
                if(itemRecursive !== 'global'){
                    recursive = itemRecursive
                }

                if(recursive){
                    matching = true
                    recursivePrompt.push({
                        prompt: content,
                        data: content,
                        source: fullLore[i].comment || `lorebook ${i}`,
                        index: i,
                    })
                }
            }

            if(record){
                record.activated = activated
                if(activated){
                    record.tokens = actives[actives.length - 1].tokens
                }
                probe?.entry(record)
            }
        }
    }

    const activesSorted = actives.sort((a,b) => {
        return b.priority - a.priority
    })

    // An injector that survives the cut but whose target is not among the survivors
    // (cut, or never activated) merges nothing, so it is dropped and its tokens go
    // back to the entries after it in priority order. Refunds can admit another
    // injector, so the cut repeats until no injector is left without its target.
    // A target cut in the latest run stays cut, even when the refund would fit it.
    const deadInjectors = new Set<typeof actives[number]>()
    const pinnedCut = new Set<typeof actives[number]>()
    let activesFiltered: typeof actives
    while(true){
        let usedTokens = 0
        const cutInRun: typeof actives = []
        activesFiltered = activesSorted.filter((act) => {
            if(deadInjectors.has(act) || pinnedCut.has(act)){
                return false
            }
            if(usedTokens + act.tokens <= loreToken){
                usedTokens += act.tokens
                return true
            }
            cutInRun.push(act)
            return false
        })
        const targetless = activesFiltered.filter((act) => {
            return act.inject?.lore && !activesFiltered.some((l) => !l.inject?.lore && l.source === act.inject.location)
        })
        if(targetless.length === 0){
            break
        }
        for(const act of targetless){
            deadInjectors.add(act)
            for(const cut of cutInRun){
                if(!cut.inject?.lore && cut.source === act.inject.location){
                    pinnedCut.add(cut)
                }
            }
        }
    }

    let activesResorted = activesFiltered.sort((a,b) => {
        return b.order - a.order
    })


    const loreinjectionLores = activesResorted.filter((act) => {
        return act?.inject?.lore
    })

    activesResorted = activesResorted.filter((act) => {
        return !act?.inject?.lore
    })

    //I know this will make token count wrong, but performance is more important here

    const probeMerged: LoreScanFinal['merged'] = []
    console.log('loreinjectionLores', loreinjectionLores)
    for(const lore of loreinjectionLores){
        const foundLoreIndex = activesResorted.findIndex((l) => {
            return l.source === lore.inject.location
        })
        if(foundLoreIndex !== -1){
            const foundLore = activesResorted[foundLoreIndex]
            if(probeIndexOf){
                probeMerged.push({ index: probeIndexOf.get(lore), into: probeIndexOf.get(foundLore) })
            }
            switch(lore.inject.operation){
                case 'append':{
                    foundLore.prompt += ' ' + lore.prompt
                    break
                }
                case 'prepend':{
                    foundLore.prompt = lore.prompt + ' ' + foundLore.prompt
                    break
                }
                case 'replace':{
                    foundLore.prompt = foundLore.prompt.replace(lore.inject.param, lore.prompt)
                    break
                }
            }
        }
    }

    const result = {
        actives: activesResorted.reverse(),
        matchLog: matchLog,
    }
    if(probe && probeIndexOf){
        const survivors = new Set<typeof actives[number]>(activesFiltered)
        probe.final({
            kept: result.actives.map((act) => probeIndexOf.get(act)),
            cut: activesSorted.filter((act) => !survivors.has(act) && !deadInjectors.has(act)).map((act) => probeIndexOf.get(act)),
            deadInjectors: [...deadInjectors].map((act) => probeIndexOf.get(act)),
            merged: probeMerged,
        })
    }
    return result

}

export async function importLoreBook(mode:'global'|'local'){
    const selectedID = get(selectedCharID)
    const page = DBState.db.characters[selectedID].chatPage
    let lore = 
        mode === 'global' ? DBState.db.characters[selectedID].globalLore : 
        DBState.db.characters[selectedID].chats[page].localLore
    const file = await selectSingleFile(['json', 'lorebook', 'png'])
    const lorebook = file?.data
    if(!lorebook){
        return
    }



    try {
        const importedlore = readLorebookFileJson(lorebook) as ImportedLorebookFile
        if(importedlore.type === 'risu' && importedlore.data){
            const datas:loreBook[] = importedlore.data
            for(const data of datas){
                lore.push(data)
            }
        }
        else if(importedlore.entries){
            const entries:{[key:string]:CCLorebook} = importedlore.entries
            lore.push(...convertExternalLorebook(entries))
        }
        if(mode === 'global'){
            DBState.db.characters[selectedID].globalLore = lore
        }
        else{
            DBState.db.characters[selectedID].chats[page].localLore = lore
        }
    } catch (error) {
        alertError(error instanceof NoLorebookInPng ? language.errors.noData : error)
    }
}

/** The top-level shapes of a picked lorebook file: RisuAI's own export, or an external book with `entries`. */
export interface ImportedLorebookFile{
    type?:string
    data?:loreBook[]
    entries?:{[key:string]:CCLorebook}
}

export interface CCLorebook{
    key:string[]
    comment:string
    content:string
    order:number
    constant:boolean,
    name:string,
    keywords:string[],
    priority:number
    entry:string
    secondary_keys:string[]
    selective:boolean
    forceActivation:boolean
    keys:string[]
    displayName:string
    text:string
    disable?:boolean
    enabled?:boolean
    useProbability?:boolean
    probability?:number|null
    position?:number|string|null
    depth?:number|null
    role?:number|null
    selectiveLogic?:number
    keysecondary?:string[]
    weight?:number|null
    contextConfig?: {
        budgetPriority:number
        prefix:string
        suffix:string
    }
}

export function convertExternalLorebook(entries:{[key:string]:CCLorebook}){
    let lore:loreBook[] = []
    for(const key in entries){
        const currentLore = entries[key]
        const decorators = externalEntryDecorators(currentLore)
        let content = currentLore.content || currentLore.entry || currentLore.text || ''
        if(decorators.lines.length > 0){
            content = decorators.lines.join('\n') + '\n' + content
        }
        if(decorators.disabled){
            content = placeDisabledMarker(content)
        }
        lore.push({
            key: currentLore.key ? currentLore.key.join(', ') :
                currentLore.keys ? currentLore.keys.join(', ') :
                currentLore.keywords ? currentLore.keywords.join(', ') : '',
            insertorder: externalInsertOrder(currentLore),
            comment: currentLore.comment || currentLore.name || currentLore.displayName || '',
            content: content,
            mode: "normal",
            alwaysActive: currentLore.constant ?? currentLore.forceActivation ?? false,
            secondkey: (currentLore.secondary_keys ?? currentLore.keysecondary)?.join(', ') ?? "",
            selective: decorators.selective
        })
    }
    return lore
}

export async function exportLoreBook(mode:'global'|'local'){
    const busy = beginBusy('export')
    try {
        const selectedID = get(selectedCharID)
        const page = DBState.db.characters[selectedID].chatPage
        const lore = 
            mode === 'global' ? DBState.db.characters[selectedID].globalLore : 
            DBState.db.characters[selectedID].chats[page].localLore        
        const stringl = Buffer.from(JSON.stringify({
            type: 'risu',
            ver: 1,
            data: lore
        }), 'utf-8')

        const saved = await downloadFile(`lorebook_export.json`, stringl, { aroundPicker: (open) => openOutsideBusy(busy, open) })
        if(!saved){
            return
        }

        alertNormal(downloadNotice(language.successExport))
    } catch (error) {
        alertError(error)
    } finally {
        busy.end()
    }
}
