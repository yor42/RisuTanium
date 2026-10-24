import type { OpenAIChat } from "./index.svelte";
import type { character, groupChat } from "../storage/database.svelte";
import type { RunSubject } from "./chatOrigin";
import type { PromptView } from "../cbs";
import { risuChatParser } from "./scripts";

/**
 * Which speaker an example-dialogue line opens, from the trimmed, lower-cased
 * line; null when it opens no turn. The one prefix test `exampleMessage` and
 * `hasExampleTurns` share.
 */
function exampleTurnSpeaker(lowered:string, charName:string):'assistant'|'user'|null{
    if(lowered.startsWith('{{char}}:')  || lowered.startsWith('<bot>:') || lowered.startsWith(`${charName}:`)){
        return 'assistant'
    }
    if(lowered.startsWith('{{user}}:') || lowered.startsWith('<user>:')){
        return 'user'
    }
    return null
}

/**
 * Whether `exampleMessage` yields at least one speaker turn (the memo-less
 * example entries). Does not parse the text; a group has none.
 */
export function hasExampleTurns(char:character|groupChat):boolean{
    if(char.type === 'group' || !char.exampleMessage){
        return false
    }
    return char.exampleMessage.split('\n').some((mes) => {
        return exampleTurnSpeaker(mes.trim().toLocaleLowerCase(), char.name) !== null
    })
}

/**
 * Parses the character's example dialogue as the chat `subject` stands for; with no subject, as the selected chat.
 * With a `promptView` every line is parsed as part of the prompt.
 */
export function exampleMessage(char:character, subject?:RunSubject, promptView?:PromptView):OpenAIChat[]{
    if(char.exampleMessage === ''){
        return []
    }

    const messages = char.exampleMessage.split('\n')
    let result:OpenAIChat[] = []
    let currentMessage:OpenAIChat

    function add(){
        if(currentMessage){
            result.push(currentMessage)
        }
    }

    for(const mes of messages){
        const trimed = mes.trim()
        const lowered = trimed.toLocaleLowerCase()


        if(lowered === '<start>'){
            add()
            result.push({
                role: "system",
                content: '[Start a new chat]',
                memo: "NewChatExample",
            })
            currentMessage = null
        }
        else if(exampleTurnSpeaker(lowered, char.name) === 'assistant'){
            add()
            currentMessage = {
                role: "assistant",
                content: trimed.split(':', 2)[1].trimStart(),
                name: 'example_assistant' 
            }
        }
        else if(exampleTurnSpeaker(lowered, char.name) === 'user'){
            add()
            currentMessage = {
                role: "user",
                content: trimed.split(':', 2)[1].trimStart(),
                name: 'example_user'
            }
        }
        else{
            if(currentMessage){
                currentMessage.content += "\n" + trimed
            }
        }
    }
    add()
    
    result = result.map((r) => {
        return {
            role: r.role,
            content: risuChatParser(r.content, promptView ? {chara: char, subject, promptView} : {chara: char, subject}),
            name: r.name,
            memo: r.memo
        }
    })

    return result
}