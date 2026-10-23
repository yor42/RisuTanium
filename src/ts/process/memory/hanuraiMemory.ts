import { alertError } from "src/ts/alert";
import type { OpenAIChat } from "../index.svelte";
import { HypaProcesser } from "./hypamemory";
import { language } from "src/lang";
import type { ChatTokenizer } from "src/ts/tokenizer";
import { getDatabase } from "src/ts/storage/database.svelte";

const maxRecentChatQuery = 4;
const documentPrefix = 'search_document: '

export async function hanuraiMemory(chats:OpenAIChat[],arg:{
    currentTokens:number,
    maxContextTokens:number,
    tokenizer:ChatTokenizer
}){
    const db = getDatabase()
    const tokenizer = arg.tokenizer
    const processer = new HypaProcesser()
    let addTexts:string[] = []
    const queryStartIndex=chats.length-maxRecentChatQuery
    console.log(chats.length,maxRecentChatQuery,queryStartIndex)
    chats.map((chat, index) => {
        if(queryStartIndex < index){
            return
        }
        if(!chat?.content?.trim()){
            return
        }
        if(db.hanuraiSplit){
            const splited = chat.content.split('\n\n')
            for(const split of splited){
                if(!split.trim()){
                    continue
                }
                addTexts.push(`${documentPrefix}${split.trim()}`)
            }
        }
        else{
            addTexts.push(`${documentPrefix}${chat.content?.trim()}`)
        }
    })
    await processer.addText(addTexts)

    let scoredResults:{[key:string]:number} = {}
    for(let i=1;i<maxRecentChatQuery;i++){
        const chat = chats[chats.length-i]
        if(!chat?.content){
            continue
        }
        const scoredArray = (await processer.similaritySearchScored('search_query: ' + chat.content)).map((result) => {
            return [result[0],result[1]/i] as [string,number]
        })
        for(const scored of scoredArray){
            if(scoredResults[scored[0]]){
                scoredResults[scored[0]] += scored[1]
            }else{
                scoredResults[scored[0]] = scored[1]
            }
        }
    }
    const vectorResult = Object.entries(scoredResults).sort((a,b)=>b[1]-a[1])

    let tokens = arg.currentTokens + db.hanuraiTokens

    while(tokens > arg.maxContextTokens){
        const poped = chats.shift()
        if(!poped){
            alertError(language.errors.toomuchtoken + "\n\nRequired Tokens: " + tokens)
            return false
        }
        tokens -= await tokenizer.tokenizeChat(poped)
    }

    tokens -= db.hanuraiTokens

    const promptTexts = new Set<string>()
    for(const chat of chats){
        const content = chat.content?.trim()
        if(!content){
            continue
        }
        promptTexts.add(content)
        if(db.hanuraiSplit){
            for(const split of chat.content.split('\n\n')){
                if(split.trim()){
                    promptTexts.add(split.trim())
                }
            }
        }
    }

    let resultTexts:string[] = []
    let blockTokens = 0
    for(const vector of vectorResult){
        const resultText = vector[0].substring(documentPrefix.length)
        if(promptTexts.has(resultText)){
            continue
        }
        const tokenized = await tokenizer.tokenizeChat({
            role: 'system',
            memo: 'supaMemory',
            content: resultText
        }) + 2
        if(blockTokens + tokenized > db.hanuraiTokens){
            continue
        }
        tokens += tokenized
        if(tokens >= arg.maxContextTokens){
            tokens -= tokenized
            break
        }
        blockTokens += tokenized
        resultTexts.push(resultText)
    }
    chats.unshift({
        role: "system",
        memo: "supaMemory",
        content: resultTexts.join('\n\n'),
    })
    return {
        tokens,
        chats
    }


}