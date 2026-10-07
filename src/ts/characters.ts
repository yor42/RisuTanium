import { get, writable } from "svelte/store";
import { saveImage, type character, type Chat, type groupChat, defaultSdDataFunc, type loreBook, getDatabase, getCharacterByIndex, setCharacterByIndex } from "./storage/database.svelte";
import { alertAddCharacter, alertConfirm, alertError, alertNormal, alertSelect, alertStore, alertWait } from "./alert";
import { language } from "../lang";
import { checkNullish, findCharacterbyId, findCharacterIndexbyId, getUserName, selectMultipleFile, selectSingleFile } from "./util";
import { v4 as uuidv4, v4 } from 'uuid';
import { getImageType } from "./media";
import { CharEmotion, DBState, MobileGUIStack, OpenRealmStore, selectedCharID } from "./stores.svelte";
import { AppendableBuffer, changeChatTo, checkCharOrder, downloadFile, getFileSrc, requiresFullEncoderReload } from "./globalApi.svelte";
import { updateInlayScreen } from "./process/inlayScreen";
import { parseMarkdownSafe, sanitizeMarkdownSafe } from "./parser/parser.svelte";
import { translateHTML } from "./translator/translator";
import { doingChat } from "./process/index.svelte";
import { importCharacter } from "./characterCards";
import { PngChunk } from "./pngChunk";
import { findChaIdHolders, restoreColdCharacter } from "./process/coldCharacterRestore";
import { getAvatarThumbSrc, isThumbEligible } from "./media/avatarThumb";
import { markCharacterForSave } from "./storage/characterSaveMarks";
import { hasWorkIn, stopWorkIn } from "./process/chatOrigin";
import { beginBusy } from "./process/memory/busyActions";
import { queueInlayCleanupForChat, queueInlayCleanupForCharacters } from "./process/files/inlayCleanup";
import { escapeHtmlText } from "./htmlEscape";

export function createNewCharacter() {
    DBState.db.characters.push(createBlankChar())
    checkCharOrder()
    return DBState.db.characters.length - 1
}

export function createNewGroup(){
    DBState.db.characters.push({
        type: 'group',
        name: "",
        firstMessage: "",
        chats: [{
            id: v4(),
            message: [],
            note: '',
            name: 'Chat 1',
            localLore: []
        }],
        chatFolders: [],
        chatPage: 0,
        viewScreen: 'none',
        globalLore: [],
        characters: [],
        autoMode: false,
        useCharacterLore: true,
        emotionImages: [],
        customscript: [],
        chaId: uuidv4(),
        firstMsgIndex: -1,
        characterTalks: [],
        characterActive: [],
        realmId: ''
    })
    checkCharOrder()
    return DBState.db.characters.length - 1
}

/**
 * Creates the New Chat button's chat: unshifts a chat literal onto
 * `cha.chats` at index 0, then, for a group, pushes each member's greeting
 * into that new chat. The new chat always has an id from the moment it
 * enters `cha.chats`, and no other chat is touched. A member that is still
 * archived (a placeholder in `DBState.db.characters`) gets no greeting.
 * Returns 0, the index of the new chat.
 */
export function createNewChat(cha: character | groupChat): number {
    const newChat: Chat = {
        id: v4(),
        message: [], note: '', name: `New Chat ${cha.chats.length + 1}`, localLore: [], fmIndex: -1
    }
    const chats = cha.chats
    chats.unshift(newChat)
    if(cha.type === 'group'){
        cha.characters.map((c) => {
            const member = findCharacterbyId(c)
            if(member.coldstorage){
                // An archived member's `firstMessage` is not data, and a new
                // chat is created synchronously: it gets no greeting.
                return
            }
            chats[0].message.push({
                saying: c,
                role: 'char',
                data: member.firstMessage
            })
        })
    }
    cha.chats = chats
    return 0
}

export async function getCharImage(loc:string, type:'plain'|'css'|'contain'|'lgcss'|'thumb'|'thumbcss') {
    const db = DBState.db

    // 'thumb'/'thumbcss' only change how the src is resolved below; every
    // existing branch (hideAllImages, empty loc, wrapping) compares against
    // the type it already knows, so behaviour stays identical to 'plain'/'css'.
    const thumb = type === 'thumb' || type === 'thumbcss'
    const wrapType = type === 'thumb' ? 'plain' : type === 'thumbcss' ? 'css' : type

    // Return placeholder when hideAllImages is enabled
    if(db.hideAllImages){
        if(wrapType === 'plain'){
            return '/none.webp'
        }
        return ''  // For CSS types, return empty to show default ? icon
    }

    if(!loc || loc === ''){
        if(wrapType ==='css'){
            return ''
        }
        return null
    }
    const filesrc = (thumb && isThumbEligible(loc) ? await getAvatarThumbSrc(loc) : null) ?? await getFileSrc(loc)
    if(wrapType === 'plain'){
        return filesrc
    }
    else if(wrapType ==='css'){
        return `background: url("${filesrc}");background-size: cover;`
    }
    else if(wrapType === 'lgcss'){
        return `background: url("${filesrc}");background-size: cover;height: 10.66rem;`

    }

    else{
        return `background: url("${filesrc}");background-size: contain;background-repeat: no-repeat;background-position: center;`
    }
}

export async function selectCharImg(charIndex:number) {
    const selected = await selectSingleFile(['png', 'webp', 'gif', 'jpg', 'jpeg'])
    if(!selected){
        return
    }
    const busy = beginBusy('charImage')
    try {
        const img = selected.data
        let db = DBState.db

        const type = getImageType(img)

        try {
            if(type === 'PNG' && db.characters[charIndex].type === 'character'){
                const gen = PngChunk.readGenerator(img)
                const allowedChunk = [
                    'parameters', 'Comment', 'Title', 'Description', 'Author', 'Software', 'Source', 'Disclaimer', 'Warning', 'Copyright',
                ]
                for await (const chunk of gen){
                    if(chunk instanceof AppendableBuffer){
                        continue
                    }
                    if(!chunk){
                        continue
                    }
                    if(chunk.value.length > 20_000){
                        continue
                    }
                    if(allowedChunk.includes(chunk.key)){
                        console.log(chunk.key, chunk.value)
                        db.characters[charIndex].extentions ??= {}
                        db.characters[charIndex].extentions.pngExif ??= {}
                        db.characters[charIndex].extentions.pngExif[chunk.key] = chunk.value
                    }
                }
                console.log(db.characters[charIndex].extentions)
            }
        } catch (error) {
            console.error(error)
        }



        const imgp = await saveImage(img)
        dumpCharImage(charIndex)
        DBState.db.characters[charIndex].image = imgp
        markCharacterForSave(DBState.db.characters[charIndex].chaId)
    } finally {
        busy.end()
    }
}

export function dumpCharImage(charIndex:number) {
    const char = DBState.db.characters[charIndex] as character
    if(!char.image || char.image === ''){
        return
    }
    char.ccAssets ??= []
    char.ccAssets.push({
        type: 'icon',
        name: 'iconx',
        uri: char.image,
        ext: 'png'
    })
    char.image = ''
    DBState.db.characters[charIndex] = char
}

export function changeCharImage(charIndex:number,changeIndex:number) {
    const char = DBState.db.characters[charIndex] as character
    const image = char.ccAssets[changeIndex].uri
    char.ccAssets.splice(changeIndex, 1)
    dumpCharImage(charIndex)
    char.image = image
    DBState.db.characters[charIndex] = char
}


export const addingEmotion = writable(false)

export async function addCharEmotion(charId:number) {
    addingEmotion.set(true)
    const selected = await selectMultipleFile(['png', 'webp', 'gif'])
    if(!selected){
        addingEmotion.set(false)
        return
    }
    const busy = beginBusy('charEmotion')
    try {
        let db = DBState.db
        for(const f of selected){
            const img = f.data
            const imgp = await saveImage(img)
            const name = f.name.replace('.png','').replace('.webp','')
            let dbChar = db.characters[charId]
            if(dbChar.type !== 'group'){
                dbChar.emotionImages.push([name,imgp])
                DBState.db.characters[charId] = dbChar
                markCharacterForSave(dbChar.chaId)
            }
        }
    } finally {
        busy.end()
    }
    addingEmotion.set(false)
}

export function rmCharEmotion(charId:number, emotionId:number) {
    let dbChar = DBState.db.characters[charId]
    if(dbChar.type !== 'group'){
        dbChar.emotionImages.splice(emotionId, 1)
        DBState.db.characters[charId] = dbChar
        // CharEmotion caches the *resolved path* of the last-triggered emotion, not
        // its name — removing an emotion image doesn't otherwise invalidate that
        // cache, so the emotion box could keep rendering the now-removed image until
        // the next @@emo trigger. Drop this character's cached entry so it falls back
        // to the default emotion instead.
        CharEmotion.update((charemotions) => {
            delete charemotions[dbChar.chaId]
            return charemotions
        })
    }
}


export async function exportChat(page:number){
    try {

        const mode = await alertSelect([language.alerts.exportAsJson, language.alerts.exportAsTxt, language.alerts.exportAsHtmlFile, language.alerts.exportAsHtmlEmbed])
        const doTranslate = (mode === '2' || mode === '3') ? (await alertSelect([language.translateContent, language.doNotTranslate])) === '0' : false
        const anonymous = (mode === '2' || mode === '3') ? ((await alertSelect([language.includePersonaName, language.hidePersonaName])) === '1') : false
        const selectedID = get(selectedCharID)
        const db = DBState.db
        const chat = db.characters[selectedID].chats[page]
        const char = db.characters[selectedID]
        const date = new Date().toJSON();
        const htmlChatParse = async (v:string) => {
            v = parseMarkdownSafe(v)

            if(doTranslate){
                // Translator, LLM and display-script output is not trusted markup:
                // the exported file must be exactly as strict as the untranslated one.
                v = sanitizeMarkdownSafe(await translateHTML(v, false, '', -1))
            }

            if(anonymous){
                //case insensitive match, replace all
                const excapedName = char.name.replace(/[-\/\\^$*+\?\.()|[\]{}]/g, '\\$&')

                v = v.replace(new RegExp(`${excapedName}`, 'gi'), '×××')
            }

            return v
        }

        if(mode === '0'){
            let folders = []
            if(chat.folderId) {
                folders = db.characters[selectedID].chatFolders?.filter(f => f.id === chat.folderId)
            }
            const stringl = Buffer.from(JSON.stringify({
                type: 'risuChat',
                ver: 2,
                data: chat,
                folders: folders
            }), 'utf-8')
    
            await downloadFile(`${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, "") + '.json', stringl)
    
        }
        else if(mode === '2'){

            let chatContentHTML = ''

            let i = 0
            for(const v of chat.message){
                alertWait(`${language.translating} ${i++}/${chat.message.length}`)
                const name = v.saying ? findCharacterbyId(v.saying).name : v.role === 'char' ? char.name : anonymous ? '×××' : getUserName()
                chatContentHTML += `<div class="chat">
                    <h2>${escapeHtmlText(name)}</h2>
                    <div>${await htmlChatParse(v.data)}</div>
                </div>`
            }

            const doc = `
                <!DOCTYPE html>
                <html>
                    <head>
                        <title>${escapeHtmlText(char.name)} Chat</title>
                        <style>
                            body{
                                font-family: Arial, sans-serif;
                                display: flex;
                                justify-content: center;
                            }
                            .container{
                                max-width: 800px;
                                padding: 1rem;
                                border-radius: 10px;
                                display: flex;
                                flex-direction: column;
                                gap: 1rem;
                            }
                            .chat{
                                background: #f0f0f0;
                                padding: 1rem;
                                border-radius: 10px;
                                display: flex;
                                flex-direction: column;
                            }
                            .idat{
                                display: none;
                            }
                            h2{
                                margin: 0;
                            }
                            .chat div{
                                margin-top: 0.5rem;
                                break-word: break-all;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <div class="chat">
                                <h2>${escapeHtmlText(char.name)}</h2>
                                <div>${await htmlChatParse(
                                    chat.fmIndex === -1 ? char.firstMessage : char.alternateGreetings?.[chat.fmIndex ?? 0]
                                )}</div>
                            </div>
                            ${chatContentHTML}
                        </div>
                        <div class="idat">${
                            JSON.stringify(chat).replace(/</g, '&lt;').replace(/>/g, '&gt;')
                        }</div>
                    </body>
            `


            await downloadFile(`${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, "") + '.html', Buffer.from(doc, 'utf-8'))
        }
        else if(mode === '3'){
            //create a html table
            let chatContentHTML = ''

            let i = 0
            for(const v of chat.message){
                alertWait(`${language.translating} ${i++}/${chat.message.length}`)
                const name = v.saying ? findCharacterbyId(v.saying).name : v.role === 'char' ? char.name : anonymous ? '×××' : getUserName()
                chatContentHTML += `<tr>
                    <td>${escapeHtmlText(name)}</td>
                    <td>${await htmlChatParse(v.data)}</td>
                </tr>`
            }

            const template = `
                <table>
                    <tr>
                        <th>Character</th>
                        <th>Message</th>
                    </tr>
                    <tr>
                        <td>${escapeHtmlText(char.name)}</td>
                        <td>${await htmlChatParse(char.firstMessage)}</td>
                    </tr>
                    ${chatContentHTML}
                </table>
                <p>Chat from Risuai</p>
            `

            //copy to clipboard

            const item = new ClipboardItem({
                'text/html': new Blob([template], { type: 'text/html' }),
                'text/plain': new Blob([template], { type: 'text/plain' })
            })
            await navigator.clipboard.write([item])

            alertNormal(language.clipboardSuccess)
            return

        }
        else{
            
            let stringl = chat.message.map((v) => {
                if(v.saying){
                    return `--${findCharacterbyId(v.saying).name}\n${v.data}`
                }
                else{
                    return `--${v.role === 'char' ? char.name : getUserName()}\n${v.data}`
                }
            }).join('\n\n')

            if(char.type !== 'group'){
                stringl = `--${char.name}\n${char.firstMessage}\n\n` + stringl
            }

            await downloadFile(`${char.name}_${date}_chat`.replace(/[<>:"/\\|?*\.\,]/g, "") + '.txt', Buffer.from(stringl, 'utf-8'))

        }
        alertNormal(language.successExport)
    } catch (error) {
        alertError(error)
    }
}

export async function importChat(){
    const dat =await selectSingleFile(['json','jsonl','html'])
    if(!dat){
        return
    }
    try {
        const selectedID = get(selectedCharID)
        const lowerName = dat.name.toLowerCase()

        if(lowerName.endsWith('jsonl')){
            const lines = Buffer.from(dat.data).toString('utf-8').split('\n')
            let newChat:Chat = {
                message: [],
                note: "",
                name: "Imported Chat",
                localLore: [],
                fmIndex: -1,
                id: v4()
            }

            let isFirst = true
            for(const line of lines){
                if(line.trim() === ''){
                    continue
                }

                const presedLine = JSON.parse(line)
                if(presedLine.name && presedLine.is_user, presedLine.mes){
                    if(!isFirst){
                        newChat.message.push({
                            role: presedLine.is_user ? "user" : 'char',
                            data: formatTavernChat(presedLine.mes, DBState.db.characters[selectedID].name)
                        })
                    }
                }

                isFirst = false
            }

            if(newChat.message.length === 0){
                alertError(language.errors.noData)
                return
            }

            if(DBState.db.characters[selectedID].chatFolders
                .filter(folder => folder.id === newChat.folderId).length === 0) {
                newChat.folderId = null
            }

            DBState.db.characters[selectedID].chats.unshift(newChat)
            changeChatTo(0)
            alertNormal(language.successImport)
        }
        else if(lowerName.endsWith('json')){
            const json = JSON.parse(Buffer.from(dat.data).toString('utf-8'))
            if((json.type === 'risuAllChats' || json.type === 'risuChat') && json.ver === 2){
                const folders = json.folders || []
                const chats = Array.isArray(json.data) ? json.data : [json.data]
                const selectedID = get(selectedCharID)
                let db = getDatabase()
                let folderIdMap = {}
                folders.forEach(folder => {
                    if(db.characters[selectedID].chatFolders?.some(f => f.id === folder.id)){
                        const newId = uuidv4()
                        folderIdMap[folder.id] = newId
                        folder.id = newId
                    } else {
                        folderIdMap[folder.id] = folder.id
                    }
                })
                if(db.characters[selectedID].chatFolders === undefined){
                    db.characters[selectedID].chatFolders = []
                }
                db.characters[selectedID].chatFolders.push(...folders)
                chats.forEach(chat => {
                    if(chat.folderId && folderIdMap[chat.folderId]){
                        chat.folderId = folderIdMap[chat.folderId]
                    }
                    chat.id = v4()
                })
                DBState.db.characters[selectedID].chats.unshift(...chats)
                alertNormal(language.successImport)
                return
            }
            if(json.type === 'risuAllChats' && json.ver === 1){
                const chats = json.data
                if(Array.isArray(chats) && chats.length > 0){
                    DBState.db.characters[selectedID].chats.unshift(...(chats.map((v) => {
                        v.id = uuidv4()
                        if(!v.localLore){
                            v.localLore = []
                        }
                        v.fmIndex ??= -1
                        return v
                    })))
                    alertNormal(language.successImport)
                    return
                } else {
                    alertError(language.errors.noData)
                    return
                }
            }
            if(json.type === 'risuChat' && json.ver === 1){
                const das:Chat = json.data
                if(!(checkNullish(das.message) || checkNullish(das.note) || checkNullish(das.name) || checkNullish(das.localLore))){
                    das.fmIndex ??= -1
                    das.id = v4()
                    DBState.db.characters[selectedID].chats.unshift(das)
                    alertNormal(language.successImport)
                    return
                }
                else{
                    alertError(language.errors.noData)
                    return   
                }
            }
            else{
                alertError(language.errors.noData)
                return
            }
        }
        else if(lowerName.endsWith('html')){
            const doc = new DOMParser().parseFromString(Buffer.from(dat.data).toString('utf-8'), 'text/html')
            const chat = doc.querySelector('.idat').textContent
            const json = JSON.parse(chat)
            if(json.message && json.note && json.name && json.localLore){
                json.id = v4()
                DBState.db.characters[selectedID].chats.unshift(json)
                alertNormal(language.successImport)
            }
            else{
                alertError(language.errors.noData)
            }
        }
        else{
            alertError(language.errors.noData)
        }
    } catch (error) {
        alertError(error)
    }
}

export async function exportAllChats() {
    try {
        const selectedID = get(selectedCharID)
        const db = getDatabase()
        const char = db.characters[selectedID]
        const date = new Date().toISOString().replace(/[:.]/g, "-")
        const allChats = char.chats
        const allFolders = char.chatFolders
        const stringl = Buffer.from(JSON.stringify({
            type: 'risuAllChats',
            ver: 2,
            data: allChats,
            folders: allFolders
        }), 'utf-8')
        await downloadFile(`${char.name}_all_chats_${date}`.replace(/[<>:"/\\|?*.,]/g, "") + '.json', stringl)
        alertNormal(language.successExport)
    } catch (error) {
        alertError(error)
    }
}

function formatTavernChat(chat:string, charName:string){
    const db = getDatabase()
    return chat.replace(/<([Uu]ser)>|\{\{([Uu]ser)\}\}/g, getUserName()).replace(/((\{\{)|<)([Cc]har)(=.+)?((\}\})|>)/g, charName)
}

export function characterFormatUpdate(indexOrCharacter:number|character, arg:{
    updateInteraction?:boolean,
} = {}){
    let cha = typeof(indexOrCharacter) === 'number' ? getCharacterByIndex(indexOrCharacter) : indexOrCharacter
    if(cha.chats.length === 0){
        cha.chats = [{
            id: uuidv4(),
            message: [],
            note: '',
            name: 'Chat 1',
            localLore: []
        }]
    }
    if(!cha.chats[cha.chatPage]){
        cha.chatPage = 0
    }
    if(!cha.chats[cha.chatPage].message){
        cha.chats[cha.chatPage].message = []
    }
    if(!cha.type){
        cha.type = 'character'
    }
    if(!cha.chaId){
        cha.chaId = uuidv4()
    }
    if(cha.type !== 'group'){
        if(checkNullish(cha.sdData)){
            cha.sdData = defaultSdDataFunc()
        }
        if(checkNullish(cha.utilityBot)){
            cha.utilityBot = false
        }
        cha.triggerscript = cha.triggerscript ?? []
        cha.alternateGreetings = cha.alternateGreetings ?? []
        cha.exampleMessage = cha.exampleMessage ?? ''
        cha.creatorNotes = cha.creatorNotes ?? ''
        cha.systemPrompt = cha.systemPrompt ?? ''
        cha.tags = cha.tags ?? []
        cha.creator = cha.creator ?? ''
        cha.characterVersion = cha.characterVersion ?? ''
        cha.personality = cha.personality ?? ''
        cha.scenario = cha.scenario ?? ''
        cha.firstMsgIndex = cha.firstMsgIndex ?? -1
        cha.additionalData = cha.additionalData ?? {
            tag: [],
            creator: '',
            character_version: ''
        }
        cha.voicevoxConfig = cha.voicevoxConfig ?? {
            SPEED_SCALE: 1,
            PITCH_SCALE: 0,
            INTONATION_SCALE: 1,
            VOLUME_SCALE: 1
        }
        if(cha.postHistoryInstructions){
            cha.chats[cha.chatPage].note += "\n" + cha.postHistoryInstructions
            cha.chats[cha.chatPage].note = cha.chats[cha.chatPage].note.trim()
            cha.postHistoryInstructions = null
        }
        cha.additionalText ??= ''
        cha.depth_prompt ??= {
            depth: 0,
            prompt: ''
        }
        cha.hfTTS ??= {
            model: '',
            language: 'en'
        }
        cha.backgroundHTML ??= ''
        cha.backgroundCSS ??= ''
        cha.creation_date ??= Date.now()
        cha.globalLore = updateLorebooks(cha.globalLore)
        if(!cha.newGenData){
            cha = updateInlayScreen(cha)
        }
        // Migrate legacy 'none' value to '' for UI dropdown compatibility
        // Using '' because it's falsy, so `if (ttsMode)` correctly detects enabled TTS
        if (cha.ttsMode === 'none') {
            cha.ttsMode = ''
        }
        cha.ttsMode ??= ''
    }
    else{
        if((!cha.characterTalks) || cha.characterTalks.length !== cha.characters.length){
            cha.characterTalks = []
            for(let i=0;i<cha.characters.length;i++){
                cha.characterTalks.push(1 / 6 * 4)
            }
        }
        if((!cha.characterActive) || cha.characterActive.length !== cha.characters.length){
            cha.characterActive = []
            for(let i=0;i<cha.characters.length;i++){
                cha.characterActive.push(true)
            }
        }
    }
    if(checkNullish(cha.customscript)){
        cha.customscript = []
    }
    if(arg.updateInteraction){
        cha.lastInteraction = Date.now()
    }
    if(typeof(indexOrCharacter) === 'number'){
        setCharacterByIndex(indexOrCharacter, cha)
    }
    for(let i = 0; i < cha.chats.length; i++){
        const chat = cha.chats[i]
        chat.fmIndex ??= cha.firstMsgIndex ?? -1
        if(!chat.id){
            chat.id = uuidv4()
        }
        if(!chat.localLore){
            chat.localLore = []
        }
    }
    return cha
}

export function updateLorebooks(book:loreBook[]){
    return book.map((v) => {
        v.bookVersion ??= 1
        if(v.bookVersion >= 2){
            return v
        }
        if(v.activationPercent){
            const perc = v.activationPercent
            v.activationPercent = null

            v.content = `@@probability ${perc}\n${v.content}`
        }
        v.content = v.content.replace(/@@@?end/g, '@@depth 0').replace(/\<(char|bot)\>/g, '{{char}}').replace(/\<(user)\>/g, '{{user}}')
        v.bookVersion = 2
        return v
    })

}

export function createBlankChar():character{
    return {
        name: '',
        firstMessage: '',
        desc: '',
        notes: '',
        chats: [{
            id: uuidv4(),
            message: [],
            note: '',
            name: 'Chat 1',
            localLore: []
        }],
        chatFolders: [],
        chatPage: 0,
        emotionImages: [],
        bias: [],
        viewScreen: 'none',
        globalLore: [],
        chaId: uuidv4(),
        type: 'character',
        sdData: defaultSdDataFunc(),
        utilityBot: false,
        customscript: [],
        exampleMessage: '',
        creatorNotes:'',
        systemPrompt:'',
        postHistoryInstructions:'',
        alternateGreetings:[],
        tags:[],
        creator:"",
        characterVersion: '',
        personality:"",
        scenario:"",
        firstMsgIndex: -1,
        replaceGlobalNote: "",
        triggerscript: [{
            comment: "",
            type: "manual",
            conditions: [],
            effect: [{
                type: "v2Header",
                code: "",
                indent: 0
            }]
        }, {
            comment: "New Event",
            type: 'manual',
            conditions: [],
            effect: []
        }],
        additionalText: ''
    }
}


export async function makeGroupImage() {
    const busy = beginBusy('groupImage')
    try {
        alertStore.set({
            type: 'wait',
            msg: language.loadingEllipsis
        })
        const db = getDatabase()
        const charID = get(selectedCharID)
        const group = db.characters[charID]
        if(group.type !== 'group'){
            return
        }
    
        const imageUrls = await Promise.all(group.characters.map((v) => {
            return getCharImage(findCharacterbyId(v).image, 'plain')
        }))
    
        
    
        const canvas = document.createElement("canvas");
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext("2d");
      
        // Load the images
        const images = [];
        let loadedImages = 0;
      
        await Promise.all(
            imageUrls.map(
            (url) =>
                new Promise<void>((resolve) => {
                    const img = new Image();
                    img.crossOrigin="anonymous"
                    img.onload = () => {
                        images.push(img);
                        resolve();
                    };
                    img.src = url;
                })
            )
        );
      
        // Calculate dimensions and draw the grid
        const numImages = images.length;
        const numCols = Math.ceil(Math.sqrt(images.length));
        const numRows = Math.ceil(images.length / numCols);
        const cellWidth = canvas.width / numCols;
        const cellHeight = canvas.height / numRows;
      
        for (let row = 0; row < numRows; row++) {
          for (let col = 0; col < numCols; col++) {
            const index = row * numCols + col;
            if (index >= numImages) break;
            ctx.drawImage(
              images[index],
              col * cellWidth,
              row * cellHeight,
              cellWidth,
              cellHeight
            );
          }
        }
      
        // Return the image URI
    
        const uri = canvas.toDataURL()
        canvas.remove()
        db.characters[charID].image = await saveImage(dataURLtoBuffer(uri));
        markCharacterForSave(db.characters[charID].chaId)
        alertStore.set({
            type: 'none',
            msg: ''
        })
    } catch (error) {
        alertError(error)
    } finally {
        busy.end()
    }
}

function dataURLtoBuffer(string:string){
    const regex = /^data:.+\/(.+);base64,(.*)$/;

    const matches = string.match(regex);
    const ext = matches[1];
    const data = matches[2];
    return Buffer.from(data, 'base64');
}

export async function removeChar(identifier:string|number|character|groupChat,name:string, type:'normal'|'permanent'|'permanentForce' = 'normal'){
    const db = getDatabase()
    let askedWhileTrashed = false
    if(type !== 'permanentForce'){
        // Advisory only: what is stopped is decided at the removal below. Work
        // registered for a group's turn belongs to the group, so deleting a
        // member of a busy group shows no warning.
        const listed = db.characters
        const asked = typeof identifier === 'string'
            ? listed[findCharacterIndexbyId(identifier)]
            : typeof identifier === 'number'
            ? listed[identifier]
            : identifier
        askedWhileTrashed = !!asked?.trashTime
        const busy = !!asked?.chaId && hasWorkIn({ chaId: asked.chaId })
        const conf = await alertConfirm(language.removeConfirm + name + (busy ? '\n' + language.removeCharacterWhileWorking : ''))
        if(!conf){
            return
        }
        const conf2 = await alertConfirm(language.removeConfirm2 + name)
        if(!conf2){
            return
        }
    }
    let chars = db.characters
    // Resolve identifier to actual index at the time of deletion to avoid
    // race conditions when concurrent deletions shift the array. A character
    // object identifier is resolved by reference, so it still finds the
    // right entry even if another entry shares its chaId, or its index moved
    // while the confirms above were awaited.
    const index = typeof identifier === 'string'
        ? findCharacterIndexbyId(identifier)
        : typeof identifier === 'number'
        ? identifier
        : chars.indexOf(identifier)
    if (index === -1 || index >= chars.length) {
        return
    }
    // A permanent delete asked for a trashed character is dropped if the user
    // restored it while the confirms were open.
    if (type === 'permanent' && askedWhileTrashed && !chars[index].trashTime) {
        return
    }
    // Every unit of work owned by the character actually removed is stopped in
    // this same synchronous stretch, whether or not the confirmation warned.
    // A trashed character stays where it is, so a write that still lands goes
    // into it; a removed one drops the write silently.
    const removedChaId = chars[index].chaId
    if (removedChaId) {
        stopWorkIn({ chaId: removedChaId })
    }
    let removed: (character | groupChat)[] = []
    if(type === 'normal'){
        chars[index].trashTime = Date.now()
    }
    else{
        removed = chars.splice(index, 1)
    }
    checkCharOrder()
    DBState.db.characters = chars
    requiresFullEncoderReload.state = true
    // The reload flag alone schedules nothing. A save is otherwise requested only
    // through `characterOrder` (edited by `checkCharOrder` when the character was
    // listed) or the selected-character effects, so removing a character that is
    // not listed (an already-trashed one) with nothing selected needs this mark.
    markCharacterForSave(removedChaId)
    queueInlayCleanupForCharacters(removed)
    selectedCharID.set(-1)
}

/**
 * Permanently removes the given trashed characters after one confirmation.
 * `refs` are the character objects of the rows the trash list showed when the
 * button was clicked; `matching` says that list was narrowed by a search, which
 * the confirmation then states. A character is removed only if, once the
 * confirmation is answered, it is still in the list and still carries the
 * `trashTime` it had at the click, so one the user restored (even if it was
 * trashed again) while the dialog was open stays. The count in the dialog is
 * therefore an upper bound.
 *
 * Removal is by reference in one synchronous stretch: work owned by each
 * removed character is stopped before the list changes, the reload flag is set
 * (without it the removed blocks stay in the store), and each removed id is
 * marked for saving. A removed character takes only its own list entry; assets,
 * cold-storage units and numbered backups are not touched. The open chat stays
 * open unless its character was removed.
 */
export async function removeTrashedCharacters(refs: (character | groupChat)[], options: { matching: boolean }){
    const asked = new Map<character | groupChat, number | undefined>()
    for(const ref of refs){
        asked.set(ref, ref.trashTime)
    }
    if(asked.size === 0){
        return
    }
    let busy = false
    for(const ref of asked.keys()){
        if(ref.chaId && hasWorkIn({ chaId: ref.chaId })){
            busy = true
            break
        }
    }
    const headline = options.matching
        ? language.emptyTrashConfirmMatching(asked.size)
        : language.emptyTrashConfirmAll(asked.size)
    const conf = await alertConfirm(
        headline + '\n' + language.emptyTrashCannotUndo + (busy ? '\n' + language.removeCharacterWhileWorking : '')
    )
    if(!conf){
        return
    }

    const present = new Set(DBState.db.characters)
    const doomed = new Set<character | groupChat>()
    for(const [ref, askedTrashTime] of asked){
        if(present.has(ref) && !!askedTrashTime && ref.trashTime === askedTrashTime){
            doomed.add(ref)
        }
    }
    if(doomed.size === 0){
        return
    }

    const selectedBefore = get(selectedCharID)
    const selectedRef = selectedBefore >= 0 ? DBState.db.characters[selectedBefore] : undefined
    for(const ref of doomed){
        if(ref.chaId){
            stopWorkIn({ chaId: ref.chaId })
        }
    }
    const chars = DBState.db.characters.filter((c) => !doomed.has(c))
    DBState.db.characters = chars
    checkCharOrder()
    requiresFullEncoderReload.state = true
    for(const ref of doomed){
        markCharacterForSave(ref.chaId)
    }
    queueInlayCleanupForCharacters([...doomed])
    if(selectedRef){
        selectedCharID.set(doomed.has(selectedRef) ? -1 : DBState.db.characters.indexOf(selectedRef))
    }
}

/**
 * A chat list's delete button. Asks for confirmation -- with a warning line
 * when something is writing into the chat -- and then deletes the chat the
 * user confirmed: it is found again in `owner.chats` by reference after the
 * confirmation, so a list that shifted meanwhile never costs a neighbour its
 * place. A chat that is gone, or has become the owner's only chat, is left
 * alone and nothing is stopped. Otherwise the work owned by that chat is
 * stopped in the same synchronous stretch as the removal, whether or not the
 * warning was shown. Returns whether the chat was removed.
 */
export async function removeChatConfirmed(owner: character | groupChat, chat: Chat): Promise<boolean> {
    if(owner.chats.length === 1){
        alertError(language.errors.onlyOneChat)
        return false
    }
    // Advisory only: what is stopped is decided at the removal below.
    const busy = !!owner.chaId && !!chat.id && hasWorkIn({ chaId: owner.chaId, chatId: chat.id })
    const conf = await alertConfirm(language.removeConfirm + chat.name + (busy ? '\n' + language.removeChatWhileWorking : ''))
    if(!conf || owner.chats.length <= 1 || owner.chats.indexOf(chat) === -1){
        return false
    }
    changeChatTo(0)
    const index = owner.chats.indexOf(chat)
    if(index === -1){
        return false
    }
    if(owner.chaId && chat.id){
        stopWorkIn({ chaId: owner.chaId, chatId: chat.id })
    }
    const chats = owner.chats
    chats.splice(index, 1)
    owner.chats = chats
    // The removal reaches the save only through this mark when the owner is not the selected character.
    markCharacterForSave(owner.chaId)
    queueInlayCleanupForChat(chat)
    return true
}

/**
 * Extracted from GridCatalog.svelte's trash-restore button for testability
 * (Report 17 Stage 1 §3.3): restoring a non-selected character is an in-place
 * field write (`trashTime = undefined`), invisible to both the
 * selected-character tracker and the identity tracker (element/whole-array
 * replacement only), so it does not persist without the explicit mark below.
 */
export function restoreCharacterFromTrash(identifier: string | character | groupChat): void {
    const chars = DBState.db.characters
    // A character object identifier is resolved by reference, so it still
    // finds the right entry even if another entry shares its chaId.
    const restoreIdx = typeof identifier === 'string'
        ? findCharacterIndexbyId(identifier)
        : chars.indexOf(identifier)
    if (restoreIdx === -1) {
        return
    }
    const restored = chars[restoreIdx]
    restored.trashTime = undefined
    checkCharOrder()
    markCharacterForSave(restored.chaId)
}

export async function addCharacter(arg:{
    reseter?:()=>any,
} = {}){
    MobileGUIStack.set(100)
    const reseter = arg.reseter ?? (() => {})
    const r = await alertAddCharacter()
    if(r === 'importFromRealm'){
        selectedCharID.set(-1)
        OpenRealmStore.set(true)
        MobileGUIStack.set(0)
        return
    }
    reseter();
    switch(r){
        case 'createfromScratch':
            createNewCharacter()
            break
        case 'createGroup':
            createNewGroup()
            break
        case 'importCharacter':
            await importCharacter()
            break
        default:
            MobileGUIStack.set(1)
            return
    }
    let db = getDatabase()
    if(db.characters[db.characters.length-1]){
        changeChar(db.characters.length-1)
    }
    MobileGUIStack.set(1)
}

/**
 * The `chaId`s in `group.characters`, each once, that have a placeholder among
 * their holders. A `chaId` no character holds is not one of them.
 */
function archivedMemberIds(group: groupChat): string[] {
    const found: string[] = []
    for(const chaId of new Set(group.characters)){
        if(findChaIdHolders(chaId).some((i) => DBState.db.characters[i].coldstorage)){
            found.push(chaId)
        }
    }
    return found
}

/**
 * Restores the archived members of `group` into their slots, one at a time,
 * and returns the names of those that could not be loaded, which stay exactly
 * as they were. A restored member is format-updated but its `lastInteraction`
 * is not changed: the user opened the group, not the member. A member whose
 * `chaId` is held by several characters, one of them archived, counts as not
 * loaded.
 */
async function restoreGroupMembers(group: groupChat): Promise<string[]> {
    const failed: string[] = []
    for(const chaId of archivedMemberIds(group)){
        // Looked up again for each member: the list may change while an
        // earlier member was being restored.
        const holders = findChaIdHolders(chaId)
        const archivedIndex = holders.find((i) => DBState.db.characters[i].coldstorage)
        if(archivedIndex === undefined){
            continue
        }
        const stub = DBState.db.characters[archivedIndex]
        const name = stub.name || language.errors.coldStorageUnknownCharacterName
        if(holders.length > 1){
            failed.push(name)
            continue
        }
        const outcome = await restoreColdCharacter(stub, { byChaId: true, quiet: true })
        if(outcome.status === 'refused'){
            failed.push(name)
        }
        else if(outcome.status === 'restored' && outcome.installedHere){
            const restoredIndex = DBState.db.characters.indexOf(outcome.character)
            if(restoredIndex !== -1){
                characterFormatUpdate(restoredIndex)
            }
        }
    }
    return failed
}

/** One notice naming every member `restoreGroupMembers` could not load; nothing for none. */
function alertGroupMembersNotLoaded(names: string[]){
    if(names.length > 0){
        alertError(language.errors.coldStorageGroupMembersNotLoaded(names.join(', ')))
    }
}

/**
 * Counts the `changeChar` calls that got past the `doingChat` guard. Only the
 * most recent one may select a character, so a slow restore of an archived
 * character cannot override a later choice.
 */
let latestChangeChar = 0

export async function changeChar(index: number, arg:{
    reseter?:()=>any,
    /** Selects without changing the character's last interaction time. */
    keepInteraction?: boolean,
} = {}) {
    const reseter = arg.reseter ?? (() => {})
    const updateInteraction = !arg.keepInteraction
    if(get(doingChat)){
      return
    }
    const callId = ++latestChangeChar
    reseter();
    const clicked = DBState.db.characters?.[index]
    if(clicked?.coldstorage){
        // The restore finds the clicked placeholder again after its read, so
        // the character list may have changed meanwhile; it tells the user
        // when it fails. Selecting is skipped when a later call has started
        // or a chat began generating during the read.
        const outcome = await restoreColdCharacter(clicked)
        if(outcome.status !== 'restored'){
            return
        }
        const restoredIndex = DBState.db.characters.indexOf(outcome.character)
        if(restoredIndex === -1){
            return
        }
        if(outcome.installedHere){
            characterFormatUpdate(restoredIndex, {
              updateInteraction,
            });
        }
        let failedMembers: string[] = []
        if(outcome.character.type === 'group'){
            failedMembers = await restoreGroupMembers(outcome.character)
        }
        if(callId !== latestChangeChar || get(doingChat)){
            return
        }
        const selectedIndex = DBState.db.characters.indexOf(outcome.character)
        if(selectedIndex === -1){
            return
        }
        alertGroupMembersNotLoaded(failedMembers)
        selectedCharID.set(selectedIndex);
        return
    }
    if(clicked?.type === 'group' && archivedMemberIds(clicked).length > 0){
        // Members are restored before the group is selected; the group is
        // formatted and its interaction bumped once they are in memory.
        const failedMembers = await restoreGroupMembers(clicked)
        if(callId !== latestChangeChar || get(doingChat)){
            return
        }
        const groupIndex = DBState.db.characters.indexOf(clicked)
        if(groupIndex === -1){
            return
        }
        alertGroupMembersNotLoaded(failedMembers)
        characterFormatUpdate(groupIndex, {
          updateInteraction,
        });
        selectedCharID.set(groupIndex);
        return
    }
    characterFormatUpdate(index, {
      updateInteraction,
    });
    selectedCharID.set(index);
}

/**
 * Selects the one character that holds `chaId`, through the same steps as
 * `changeChar` and without changing its last interaction time. Selects nothing
 * when no character holds the id or several do. Returns whether the character
 * is the selected one when the call settles.
 */
export async function selectCharacterByChaId(chaId: string): Promise<boolean> {
    const holders = findChaIdHolders(chaId)
    if(holders.length !== 1){
        return false
    }
    await changeChar(holders[0], { keepInteraction: true })
    return DBState.db.characters[get(selectedCharID)]?.chaId === chaId
}
