import shuffle from "lodash/shuffle";
import { findCharacterbyId } from "../util";
import { alertConfirm, alertError, alertSelectChar } from "../alert";
import { language } from "src/lang";
import { get } from "svelte/store";
import { getDatabase, setDatabase } from "../storage/database.svelte";
import { DBState, selectedCharID } from "../stores.svelte";
import { restoreArchivedForWrite } from "./coldCharacterAccess";
import { joinRecord } from "./groupMembers";

export async function addGroupChar(){
    let selectedId = get(selectedCharID)
    let group = DBState.db.characters[selectedId]
    if(group.type === 'group'){
        const res = await alertSelectChar()
        if(res){
            if(group.characters.includes(res)){
                alertError(language.errors.alreadyCharInGroup)
            }
            else{
                // An archived character's own `firstMessage` is not data until
                // its unit is restored. One that cannot be restored is still
                // added, without a greeting; the user is told its name.
                let greetingAvailable = true
                if(findCharacterbyId(res).coldstorage){
                    // Loaded on demand: `characters.ts` imports `doingChat` from
                    // `index.svelte.ts`, which imports this module. Loaded
                    // before the restore so no further await sits between the
                    // restore and the format update that uses its index.
                    const { characterFormatUpdate } = await import('../characters')
                    const target = await restoreArchivedForWrite(res)
                    if(target.status === 'gone'){
                        return
                    }
                    if(target.status === 'ready'){
                        characterFormatUpdate(target.index)
                    }
                    else{
                        greetingAvailable = false
                    }
                }
                if(greetingAvailable && await alertConfirm(language.askLoadFirstMsg)){
                    group.chats[group.chatPage].message.push({
                        role:'char',
                        data: findCharacterbyId(res).firstMessage,
                        saying: res,
                    })
                }

                group.characters.push(res)
                group.characterTalks.push(1 / 6 * 4)
                group.characterActive.push(true)
                joinRecord(group, res, findCharacterbyId(res).name)
            }
        }
    }
}


export function rmCharFromGroup(index:number){
    let selectedId = get(selectedCharID)
    let group = DBState.db.characters[selectedId]
    if(group.type === 'group'){
        group.characters.splice(index, 1)
        group.characterTalks.splice(index, 1)
        group.characterActive.splice(index, 1)
    }
}

export type GroupOrder = {
    id: string,
    talkness: number,
    index: number
}

export function groupOrder(chars:GroupOrder[], input:string):GroupOrder[] {
    if (chars.length === 0) {
        return []
    }

    let order:GroupOrder[] = [];
    let ids:string[] = []
    if (input) {
        const words = getWords(input)

        for (const word of words) {
            for (let char of chars) {
                const charNameChunks = getWords(findCharacterbyId(char.id).name)

                if (charNameChunks.includes(word)) {
                    order.push(char);
                    ids.push(char.id)
                    break;
                }
            }
        }
    }

    const shuffled = shuffle(chars)
    for (const char of shuffled) {
        if(ids.includes(char.id)){
            continue
        }

        const chance = char.talkness ?? 0.5

        if (chance >= Math.random()) {
            order.push(char);
            ids.push(char.id)
        }
    }

    while (order.length === 0) {
        order.push(chars[Math.floor(Math.random() * chars.length)]);
    }

    return order;
}

function getWords(data:string){
    const matches =  data.split(/\n| /g)
    let words:string[] = []
    if(!matches){
        return [data]
    }
    for(const match of matches){
        words.push(match.toLocaleLowerCase())
    }
    return words
}