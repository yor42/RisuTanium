import { v4 as uuidv4 } from 'uuid'
import type { Chat, ChatAlt, ChatAltMemory } from '../storage/database.svelte'
import { writeAt } from './chatOrigin'
import { isChatAltReadable, stampMissingIds } from './chatTree'

interface ChatAddress {
    chaId: string
    chatId: string
}

/**
 * Stores the other candidates one generation produced for its reply as sibling
 * records of that reply: `values[0]` is the reply on screen, each later value
 * becomes a record that follows the reply's parent, so the reply arrows walk
 * through them. `origin` is the chat the generation wrote into; a group
 * member's id is not part of it. All candidates of one generation share one
 * departure stamp and are appended in generation order, with times above the
 * shown reply's, so the shown reply comes first among them.
 *
 * `startState` is the chat's branch state when the request started. Every
 * candidate carries its own copy as `mem`, with all six keys: a record without
 * one would remove the live script state on arrival.
 *
 * Nothing is written when the reply cannot be found exactly once, or when the
 * chat's `alt` cannot be read.
 */
export function addRerolls(genId:string, values:string[], origin:ChatAddress, startState?:ChatAltMemory){
    if(values.length < 2){
        return
    }
    writeAt(origin, (ctx) => {
        const chat = ctx.chat
        if(!isChatAltReadable(chat)){
            console.warn('addRerolls: the chat\'s alternatives cannot be read; the candidates were not stored.')
            return
        }
        let at = -1
        let found = 0
        for(let i = 0; i < chat.message.length; i++){
            if(chat.message[i].chatId === genId){
                at = i
                found++
            }
        }
        if(found !== 1){
            console.warn(`addRerolls: the reply of generation ${genId} was found ${found} times; the candidates were not stored.`)
            return
        }
        stampMissingIds(chat)
        const shown = chat.message[at]
        const parent = at > 0 ? chat.message[at - 1].chatId ?? null : null
        const alt = chat.alt ??= []
        let stamp = 0
        for(const record of alt){
            if(record.a > stamp){
                stamp = record.a
            }
        }
        stamp += 1
        for(let k = 1; k < values.length; k++){
            const m = safeStructuredClone(shown)
            m.data = values[k]
            m.chatId = uuidv4()
            m.time = (shown.time ?? 0) + k
            delete m.interrupted
            const record: ChatAlt = { m, p: parent, a: stamp }
            if(startState !== undefined){
                record.mem = safeStructuredClone(startState)
            }
            alt.push(record)
        }
    })
}

/**
 * After a Continue replaced a message under a new id, makes everything that
 * named the old id name the new one: the records that followed the message,
 * and the plain SupaMemory pair parked on a record. It is the same message, so
 * the rename is exact. A chat whose `alt` cannot be read is left alone.
 */
export function renameContinuedMessage(chat: Chat, oldId: string, newId: string): void {
    if(oldId === newId || chat.alt === undefined){
        return
    }
    if(!isChatAltReadable(chat)){
        console.warn('renameContinuedMessage: the chat\'s alternatives cannot be read; they were left as they are.')
        return
    }
    for(const record of chat.alt){
        if(record.p === oldId){
            record.p = newId
        }
        const mem = record.mem
        if(!mem || typeof mem !== 'object'){
            continue
        }
        const data = mem.supaMemoryData
        if(typeof data === 'string' && !data.startsWith('hypa:')){
            const lineEnd = data.indexOf('\n')
            const first = lineEnd === -1 ? data : data.slice(0, lineEnd)
            if(first === oldId){
                mem.supaMemoryData = newId + data.slice(first.length)
            }
        }
        if(mem.supaMemoryCoveredId === oldId){
            mem.supaMemoryCoveredId = newId
        }
    }
}
