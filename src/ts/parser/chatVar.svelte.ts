import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../stores.svelte'
import { parseKeyValue } from '../util'
import { getCurrentCharacter, getCurrentChat } from '../storage/database.svelte'
import type { RunSubject } from '../process/chatOrigin'

// Every read/write below takes an optional `subject`. With none, the
// selection (`selectedCharID`/`getCurrentChat()`) is read or written. With
// one, the subject's own owner and chat are read or written instead --
// never the selection, even when the subject is gone or ambiguous. What
// `subject.resolve()` returns depends on the subject itself: a run's own
// subject re-resolves through its per-stretch memo, while a lorebook scan's
// subject is a fixed snapshot that returns the same context for the whole
// call. A write through a subject marks its owner for save, since a subject
// may not be the selected character, and nothing else would notice its edit.

export function getChatVar(key:string, subject?: RunSubject): string {
    if(subject){
        const ctx = subject.resolve()
        if(!ctx){
            // No owner to take character-level defaults from -- only the
            // database's own template defaults apply.
            const defaultVariables = parseKeyValue(DBState.db.templateDefaultVariables)
            const findResult = defaultVariables.find((f) => f[0] === key)
            return findResult ? findResult[1] : 'null'
        }
        const chat = ctx.chat
        chat.scriptstate ??= {}
        const state = chat.scriptstate['$' + key]
        if(state === undefined || state === null){
            const defaultVariables = parseKeyValue(ctx.owner.defaultVariables).concat(parseKeyValue(DBState.db.templateDefaultVariables))
            const findResult = defaultVariables.find((f) => f[0] === key)
            if(findResult){
                return findResult[1]
            }
            return 'null'
        }
        return state.toString()
    }
    const selectedChar = get(selectedCharID)
    const char = DBState.db.characters[selectedChar]
    if(!char){
        return 'null'
    }
    const chat = char.chats[char.chatPage]
    chat.scriptstate ??= {}
    const state = (chat.scriptstate['$' + key])
    if(state === undefined || state === null){
        const defaultVariables = parseKeyValue(char.defaultVariables).concat(parseKeyValue(DBState.db.templateDefaultVariables))
        const findResult = defaultVariables.find((f) => {
            return f[0] === key
        })
        if(findResult){
            return findResult[1]
        }
        return 'null'
    }
    return state.toString()
}

export function setChatVar(key:string, value:string, subject?: RunSubject): boolean {
    if(subject){
        const ctx = subject.resolve()
        if(!ctx){
            return false
        }
        const chat = ctx.chat
        chat.scriptstate ??= {}
        const stateKey = '$' + key
        if(chat.scriptstate[stateKey] === value){
            return false
        }
        chat.scriptstate[stateKey] = value
        subject.mark()
        return true
    }
    const selectedChar = get(selectedCharID)
    const chat = DBState.db.characters[selectedChar].chats[DBState.db.characters[selectedChar].chatPage]
    chat.scriptstate ??= {}

    const stateKey = '$' + key
    if(chat.scriptstate[stateKey] === value){
        return false
    }

    chat.scriptstate[stateKey] = value
    return true
}

export function getGLChatVar(key:string, subject?: RunSubject): string {
    console.log('getGLChatVar', key)
    const chat = subject ? subject.resolve()?.chat : getCurrentChat()
    return chat?.GLGlobalVariables?.[key]
}

export function setGLChatVar(key:string, value:string, subject?: RunSubject) {
    console.log('setGLChatVar', key, value)
    const chat = subject ? subject.resolve()?.chat : getCurrentChat()
    if(chat){
        console.log('setGLChatVar', key, value, chat.GLGlobalVariables)
        chat.GLGlobalVariables ??= {}
        chat.GLGlobalVariables[key] = value
        subject?.mark()
    }
}

// A chat-local value that is empty or 'null' means "inherit": the shared value is read instead, whatever the chat's
// useLocallySetGlobalVariables flag says. The chat-only toggle scope (parser/chatToggleScope.ts) relies on this, so
// a cleared chat-only text shows the shared value again; do not treat an empty local value as a deliberate override.
export function getGlobalChatVar(key:string, subject?: RunSubject): string {
    const vt = getGLChatVar(key, subject)
    if(vt !== 'null' && vt){
        return vt
    }
    return DBState.db.globalChatVariables[key] ?? 'null'
}

export function setGlobalChatVar(key:string, value:string, subject?: RunSubject) {
    const chat = subject ? subject.resolve()?.chat : getCurrentChat()
    if(chat?.useLocallySetGlobalVariables){
        setGLChatVar(key, value, subject)
        return
    }
    else if(getGLChatVar(key, subject) !== undefined){
        delete chat.GLGlobalVariables[key]
        subject?.mark()
    }
    DBState.db.globalChatVariables[key] = value
}

export function isLocallyHandledGlobalChatVar(key:string, subject?: RunSubject): boolean {
    return !!getGLChatVar(key, subject)
}

export function removeLocallyHandledGlobalChatVar(key:string, subject?: RunSubject): boolean {
    if(getGLChatVar(key, subject) !== undefined){
        const chat = subject ? subject.resolve()?.chat : getCurrentChat()
        delete chat.GLGlobalVariables[key]
        subject?.mark()
        return true
    }
    return false
}
