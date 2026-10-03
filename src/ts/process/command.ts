import { get } from "svelte/store";
import { alertInput, alertMd, alertNormal, alertSelect } from "../alert";
import { sayTTS } from "./tts";
import { stripThoughtsForCopy } from "../chatCopy";
import { risuChatParser } from "../parser/parser.svelte";
import { doingChat, sendChat } from "./index.svelte";
import { loadLoreBookV3Prompt } from "./lorebook.svelte";
import { runTrigger } from "./triggers";
import { createRunSubject, createSendSubject, registerWork, type Origin, type OriginHint, type RunSubject } from "./chatOrigin";
import { isComposerWindowOpen } from "./generationOwnership.svelte";
import { LOW_LEVEL_NESTED_TRIGGER_LIMIT, NORMAL_NESTED_TRIGGER_LIMIT } from "./triggerLimits";

/**
 * What a command line runs against. Every field is fixed when the line
 * starts; the chat itself is found again by id at each command, segment or
 * write, never through the selection and never through an object held across
 * an `await`.
 */
export interface CommandContext {
    /** The chat the line acts on. */
    origin: Origin
    /**
     * The objects `origin` was read through: with them a chat whose id has
     * more than one holder resolves to the one the line started from, and
     * without them it does not resolve and the line stops.
     */
    hint?: OriginHint
    /** When aborted, the line stops before its next command or `/multisend` segment. */
    signal?: AbortSignal
    /**
     * True when the line is the work that opened the composer's window, or is
     * nested under it, so its `/multisend` answers each segment while that
     * window is open.
     */
    ownsWindow?: boolean
    /**
     * The invoking run's `recursiveCount`: the count it was started with, plus
     * one for every run it has since started through `runtrigger`,
     * `v2RunTrigger` or `/trigger`.
     * Shared by reference, so every nested run started from the same run
     * draws from one budget. A line with none starts from a count of 0 that
     * its own `/trigger`s share.
     */
    recursion?: { count: number }
    /**
     * Whether the trigger that runs the line nests up to the low-level limit
     * instead of the normal one. `runtrigger` and `v2RunTrigger` apply the same
     * two limits (`./triggerLimits`).
     */
    lowLevelAccess?: boolean
    /**
     * Called at the start of every command that can change chat state, before
     * anything is awaited, whether or not that command then changes anything.
     */
    noteWrite?: () => void
}

// Every command outside this set changes no chat state: `/speak`, `/echo`,
// `/popup`, `/pass`, `/input`, `/buttons`, `/len`, `/getvar`, `/setinput`,
// `/?` and an unknown command.
const WRITING_COMMANDS = new Set([
    'send', 'sendas', 'comment', 'cut', 'del', 'setvar', 'addvar', 'multisend', 'trigger', 'test_lorebook',
])

export async function processMultiCommand(command:string, ctx:CommandContext) {
    let pipe = ''
    const splited:string[] = []
    let lastIndex = 0
    let quoteDepth = false
    for(let i = 0; i<command.length; i++){
        const char = command[i]
        if(char === '"'){
            quoteDepth = !quoteDepth
        }
        else if(char === '|' && quoteDepth === false){
            // An unquoted run of three or more stays in the command's text
            // (`/multisend` splits its segments on it); one or two separate
            // commands, and two leave an empty command between them.
            let run = 1
            while(command[i + run] === '|'){
                run++
            }
            if(run >= 3){
                i += run - 1
                continue
            }
            splited.push(command.slice(lastIndex, i))
            lastIndex = i+1
        }
    }
    splited.push(command.slice(lastIndex))
    console.log(splited)
    const subject = ctx.hint ? createSendSubject(ctx.origin, ctx.hint) : createRunSubject(ctx.origin)
    const recursion = ctx.recursion ?? { count: 0 }
    for(let i = 0; i<splited.length; i++){
        const result = await processCommand(splited[i].trim(), pipe, ctx, subject, recursion)
        console.log(pipe)
        if(result === false){
            return false
        }
        else{
            pipe = result
        }
    }
    return pipe
}


async function processCommand(command:string, pipe:string, ctx:CommandContext, subject:RunSubject, recursion:{ count: number }):Promise<false | string>{
    // A cancelled line, or one whose chat is gone (or ambiguous with no hint
    // to tell the holders apart), runs nothing more.
    if(ctx.signal?.aborted){
        return false
    }
    const resolved = subject.resolve()
    if(!resolved){
        return false
    }
    const currentChar = resolved.owner
    let {commandName, arg, namedArg} = commandParser(command, pipe)

    if(WRITING_COMMANDS.has(commandName)){
        ctx.noteWrite?.()
    }

    if(!arg){
        arg = pipe
    }

    arg = risuChatParser(arg, {
        chara: currentChar.type === 'character' ? currentChar : null,
        subject
    })

    const namedArgKeys = Object.keys(namedArg)
    for(const key of namedArgKeys){
        namedArg[key] = risuChatParser(namedArg[key], {
            chara: currentChar.type === 'character' ? currentChar : null,
            subject
        })
    }

    switch(commandName){
        //STScript compatibility commands
        case 'input':{
            pipe = await alertInput(arg)
            return pipe
        }
        case 'echo':
        case 'popup':{
            alertNormal(arg)
            return pipe
        }
        case 'pass':{
            pipe = arg
            return pipe
        }
        case 'buttons': {
            if(namedArg.labels){
                try {
                    const JSONLabels = JSON.parse(namedArg.labels)
                    if(Array.isArray(JSONLabels)){
                        pipe = await alertSelect(JSONLabels)
                    }
                } catch (error) {}
            }
            return pipe
        }
        case 'setinput': {
            //NOT IMPLEMENTED
            return false
        }
        case 'speak': {
            if(currentChar.type === 'character'){
                await sayTTS(currentChar, stripThoughtsForCopy(arg))
                return pipe
            }
            if(currentChar.type === 'group'){
                //NOT IMPLEMENTED
                return pipe
            }
            return pipe
        }
        case 'send': {
            resolved.chat.message.push({
                role: "user",
                data: arg
            })
            subject.mark()
            return pipe
        }
        case 'sendas': {
            //name not implemented
            resolved.chat.message.push({
                role: "char",
                data: arg
            })
            subject.mark()
            return pipe
        }
        case 'comment': {
            //works differently, but its close enough
            const addition = `<Comment>\n${arg}\n</Comment>`
            const last = resolved.chat.message.at(-1)
            if(last){
                last.data += addition
                subject.mark()
            }
            return pipe
        }
        case 'cut':{
            const chat = resolved.chat
            const spec = arg.trim()
            if(/^-?\d+$/.test(spec)){
                let index = parseInt(spec, 10)
                if(index < 0){
                    index += chat.message.length
                }
                if(index >= 0 && index < chat.message.length){
                    chat.message = chat.message.filter((_, i) => i !== index)
                    subject.mark()
                }
            }
            else if(/^\d+\s*-\s*\d+$/.test(spec)){
                const [start, end] = spec.split('-').map((part) => parseInt(part.trim(), 10))
                if(start < end){
                    chat.message = chat.message.filter((_, i) => i < start || i >= end)
                    subject.mark()
                }
            }
            else{ //For risu, doesn'ts work for STScript
                const id = spec
                const kept = chat.message.filter((e)=>e.chatId !== id)
                if(kept.length !== chat.message.length){
                    chat.message = kept
                    subject.mark()
                }
            }
            return pipe
        }
        case 'del': {
            const chat = resolved.chat
            const spec = arg.trim()
            if(/^\d+$/.test(spec)){
                const size = parseInt(spec, 10)
                if(size > 0){
                    chat.message = chat.message.slice(0, Math.max(0, chat.message.length - size))
                    subject.mark()
                }
            }
            return pipe
        }
        case 'len':{
            try {
                const parsed = JSON.parse(arg)
                if(Array.isArray(parsed)){
                    pipe = parsed.length.toString()
                }
            } catch (error) {}
            return pipe
        }
        case 'multisend':{
            const splited = arg.split('|||')
            let clearMode = false
            if(splited[0] && splited[0].trim() === 'clear'){
                clearMode = true
                splited.shift()
            }
            // Read once, before the first push. Replies are generated only
            // when no send holds the flag and none is starting, unless this
            // line is the work that opened the composer's window. While it
            // runs, either an enclosing send holds the flag throughout, or
            // nothing can take it: no task runs between one segment's
            // settling and the next push.
            const generates = !get(doingChat) && (ctx.ownsWindow === true || !isComposerWindowOpen())
            for(const e of splited){
                if(ctx.signal?.aborted){
                    break
                }
                const target = subject.resolve()
                if(!target){
                    break
                }
                if(clearMode){
                    target.chat.message = []
                }
                target.chat.message.push({
                    role: 'user',
                    data: e
                })
                subject.mark()
                if(generates && !(await sendChat(-1, { origin: subject.origin, originHint: ctx.hint, signal: ctx.signal }))){
                    break
                }
            }
            return ''
        }
        case 'setvar':{
            console.log(namedArg, arg)
            const chat = resolved.chat
            chat.scriptstate = chat.scriptstate ?? {}
            chat.scriptstate['$' + namedArg['key']] = arg
            console.log(chat.scriptstate)

            subject.mark()
            return ''
        }
        case 'addvar':{
            const chat = resolved.chat
            chat.scriptstate = chat.scriptstate ?? {}
            const current = chat.scriptstate['$' + namedArg['key']]
            const base = current === undefined || current === null ? 0 : Number(current)
            chat.scriptstate['$' + namedArg['key']] = (base + Number(arg)).toString()

            subject.mark()
            return ''
        }
        case 'getvar':{
            const value = resolved.chat.scriptstate?.['$' + namedArg['key']]
            pipe = value === undefined || value === null ? 'null' : value.toString()
            return pipe
        }
        case 'test_lorebook':{
            const p = await loadLoreBookV3Prompt(subject)
            console.log(p)
            alertNormal(p.actives.map((e)=>e.prompt).join('§'))
            return JSON.stringify(p)
        }
        case 'trigger':{
            if(currentChar.type === 'group'){
                return pipe
            }
            if(recursion.count >= (ctx.lowLevelAccess ? LOW_LEVEL_NESTED_TRIGGER_LIMIT : NORMAL_NESTED_TRIGGER_LIMIT)){
                return pipe
            }
            recursion.count++
            const workHandle = registerWork(subject.origin)
            try {
                await runTrigger(currentChar, 'manual', {
                    chat: resolved.chat,
                    manualName: arg,
                    origin: subject.origin,
                    recursiveCount: recursion.count,
                    signal: ctx.signal,
                    ownsWindow: ctx.ownsWindow,
                });
            } finally {
                workHandle.end()
            }
            return pipe
        }
        case '?':{
            alertMd(`
            # /input [text]
            - Show input dialog
            - Return input text
            - Example: /input Hello World
            # /echo [text]
            - Show alert dialog
            - Return input text
            - Example: /echo Hello World
            # /popup [text]
            - Show alert dialog
            - Return input text
            - Example: /popup Hello World
            # /pass [text]
            - Return input text
            - Example: /pass Hello World
            # /buttons [labels]
            - Show select dialog
            - Return selected label
            - Example: /buttons Yes§No
            # /speak [text]
            - Speak text
            - Example: /speak Hello World
            # /send [text]
            - Send text to chat
            - Example: /send Hello World
            # /sendas [text]
            - Send text to chat as character
            - Example: /sendas Hello World
            # /comment [text]
            - Add comment to chat
            - Example: /comment Hello World
            # /cut [index]
            - Cut chat message
            - Example: /cut 1
            # /del [size]
            - Delete chat message
            - Example: /del 1
            # /len [array]
            - Return length of array
            - Example: /len Hello§World
            # /setvar key=[key] [value]
            - Set variable
            - Example: /setvar key=hello world
            # /addvar key=[key] [value]
            - Add value to variable
            - Example: /addvar key=damage 10
            # /getvar key=[key]
            - Get variable
            - Example: /getvar key=damage
            # /trigger [name]
            - Run trigger
            # /?
            - Show help
            `)
            return 'help'
        }


    }
    return false
}


function commandParser(command:string, pipe:string){
    if(command.startsWith('/')){
        command = command.slice(1)
    }
    const sliced = command.split(' ').filter((e)=>e!='')
    const commandName = sliced[0]
    let argArray:string[] = []
    let namedArg:{[key:string]:string} = {}
    for(let i = 1; i<sliced.length; i++){
        if(sliced[i].includes('=')){
            const [key, value] = sliced[i].split('=')
            namedArg[key] = value
        }
        else{
            argArray.push(sliced[i])
        }
    }
    const arg = argArray.join(' ')
        .replace('{{pipe}}', pipe) //STScript compatibility
        .replace('{{slot}}', pipe) //Risu default
    return {commandName, arg, namedArg}

}