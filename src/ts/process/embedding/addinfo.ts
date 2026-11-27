import { getDatabase, type Chat, type character, type groupChat } from "src/ts/storage/database.svelte";
import { memberName } from "../groupMembers";
import { HypaProcesser } from '../memory/hypamemory'
import { getUserName } from "src/ts/util";
import type { PromptView } from "src/ts/cbs";

/** With a `promptView`, the query is built from the first four messages the prompt sends. */
export async function additionalInformations(char: character,chats:Chat,promptView?:PromptView,owner?:character|groupChat){
    const processer = new HypaProcesser()
    const db = getDatabase()

    const info = char.additionalText
    if(info){
        const infos = info.split('\n\n')

        await processer.addText(infos)
        const messages = chats.message
        const queried: Chat['message'] = []
        for(let i = 0; i < messages.length && queried.length < 4; i++){
            if(!promptView?.hidden(messages[i])){
                queried.push(messages[i])
            }
        }
        const filteredChat = queried.map((chat) => {
            let name = chat.saying ? memberName(db.characters, owner, chat.saying) : ''

            if(!name){
                if(chat.role === 'user'){
                    name = getUserName(chats)
                }
                else{
                    name = char.name
                }
            }

            return `${name}: ${chat.data}`
        }).join("\n\n")
        const searched = await processer.similaritySearch(filteredChat)
        const result = searched.slice(0,3).join("\n\n")
        return result
    }

    return ''

}