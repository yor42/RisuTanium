import { DBState } from '../stores.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import type { Chat, Database } from '../storage/database.svelte'
import { writeLiveChat } from '../liveCharacterWrite'
import { getModuleToggles } from '../process/modules'
import { isChatAltReadable } from '../process/chatTree'
import { parseToggleSyntax } from '../util'

/**
 * The chat-only toggle scope (`Chat.useLocallySetGlobalVariables` with `Chat.GLGlobalVariables`).
 *
 * Meaning of the pair, read by `getGlobalChatVar`: a chat-local value that is non-empty and not 'null' wins over the
 * shared value, whatever the flag says; the flag decides where a toggle edit is written. So an empty or 'null' local
 * value inherits the shared one, and a cleared chat-only text goes back to the shared value.
 *
 * Turning the scope on copies the current shared values of the listed toggles into the chat, as a new map each time.
 * Turning it off discards the chat's own values; the snapshot that `disableChatScope` returns is the only way back and
 * lives in the caller's memory, never in the saved chat. Script state (`scriptstate`) is not touched.
 *
 * The scope also carries two switches of its own, `Chat.scopedJailbreak` and `Chat.scopedMemory`. They act only while the
 * flag is `true` and the value is a boolean (`effectiveJailbreak`, `effectiveMemory`); turning the scope on copies the
 * values in force, turning it off leaves no live value and no parked one (`scopedMemory` is parked per branch on
 * `alt[].mem`), and the Undo restores both.
 *
 * Immediate click-time writes act on the chat object the user acted on and mark the owner themselves. A write that
 * runs after user time has passed (the Undo) goes through `writeLiveChat`, which finds the live owner and chat again.
 */

/** The address of a chat for an engine write: its owner's `chaId` and the chat object. */
export type ScopeTarget = { chaId: string, chat: Chat }

/** What the toggle text of a character contributes; any character or group satisfies it. */
export type ScopeOwner = { chaId: string, customModuleToggle?: string }

/**
 * The shape of the chat's active path when the scope was discarded. An Undo is only valid while the chat is still
 * on the same path: the values were meant for that conversation state.
 */
type PathSignature = { messageCount: number, lastChatId: string | undefined, altCount: number }

/** The chat's own switches as they were when the scope was discarded; a key is absent when the chat held none. */
type ScopeSwitches = { scopedJailbreak?: boolean, scopedMemory?: boolean }

/**
 * The `scopedMemory` an alternative's `mem` parked, found again by the `chatId` of the record's message. The position in
 * `alt` is no key: a branch switch reorders the list while the path signature stays the same.
 */
type ParkedSwitch = { chatId: string, value: boolean | null }

export type ChatScopeSnapshot = {
    values: { [key: string]: string } | undefined
    path: PathSignature
    switches: ScopeSwitches
    parked: ParkedSwitch[]
}

/** The switch values in force for a chat whose scope is being turned on. */
export type EffectiveSwitches = { jailbreak: boolean, memory: boolean }

/** `toggle_<key>` of every value row of the toggle text, once each; groups are flattened, markers and captions skipped. */
export function toggleScopeKeys(text: string): string[] {
    const keys = new Set<string>()
    for (const row of parseToggleSyntax(text)) {
        if (row.type === 'group' || row.type === 'groupEnd' || row.type === 'caption' || row.type === 'divider') {
            continue
        }
        if (row.key) {
            keys.add(`toggle_${row.key}`)
        }
    }
    return Array.from(keys)
}

/**
 * The single key source for the scope: the toggle text of the prompt template, of the modules in use and of the
 * owner. The module part follows the current selection, as the sidebar's list does.
 */
export function currentScopeKeys(owner: ScopeOwner): string[] {
    return toggleScopeKeys(
        DBState.db.customPromptTemplateToggle + '\n' +
        getModuleToggles() + '\n' +
        owner.customModuleToggle
    )
}

function pathOf(chat: Chat): PathSignature {
    return {
        messageCount: chat.message.length,
        lastChatId: chat.message.at(-1)?.chatId,
        altCount: chat.alt?.length ?? 0,
    }
}

function samePath(a: PathSignature, b: PathSignature): boolean {
    return a.messageCount === b.messageCount && a.lastChatId === b.lastChatId && a.altCount === b.altCount
}

/** The `scopedMemory` of each alternative record that parked one, with the `mem` holding it. None for an alt the tree cannot read. */
function parkedSwitchesOf(chat: Chat): { entry: ParkedSwitch, mem: { scopedMemory?: boolean | null } }[] {
    const found: { entry: ParkedSwitch, mem: { scopedMemory?: boolean | null } }[] = []
    if (chat.alt === undefined || !isChatAltReadable(chat)) {
        return found
    }
    for (const record of chat.alt) {
        const mem = record.mem
        if (typeof mem === 'object' && mem !== null && 'scopedMemory' in mem) {
            found.push({ entry: { chatId: record.m.chatId ?? '', value: mem.scopedMemory ?? null }, mem })
        }
    }
    return found
}

/**
 * Removes the parked `scopedMemory` from every readable alternative and returns what it removed. The key is deleted and
 * not set to `null`: a record without the key carries the live value on arrival, while a parked `null` would delete the
 * value the scope just copied or discarded.
 */
function takeParkedSwitches(chat: Chat): ParkedSwitch[] {
    const parked = parkedSwitchesOf(chat)
    for (const { mem } of parked) {
        delete mem.scopedMemory
    }
    return parked.map(({ entry }) => entry)
}

/**
 * Turns the scope on: the chat gets a new map holding the value of each of `keys` that `shared` defines, and, with
 * `effective`, the jailbreak and memory values in force now; without it the chat keeps no switch of its own. Any
 * parked memory switch is removed from the alternatives so that an arrival carries the live value. Does nothing and
 * returns false when the scope is already on, so an existing chat-only copy is never replaced.
 */
export function enableChatScope(target: ScopeTarget, keys: string[], shared: { [key: string]: string }, effective?: EffectiveSwitches): boolean {
    const { chat } = target
    if (chat.useLocallySetGlobalVariables === true) {
        return false
    }
    const copy: { [key: string]: string } = {}
    for (const key of keys) {
        const value = shared[key]
        if (value !== undefined) {
            copy[key] = value
        }
    }
    chat.GLGlobalVariables = copy
    chat.useLocallySetGlobalVariables = true
    if (effective) {
        chat.scopedJailbreak = effective.jailbreak
        chat.scopedMemory = effective.memory
    } else {
        delete chat.scopedJailbreak
        delete chat.scopedMemory
    }
    takeParkedSwitches(chat)
    markCharacterForSave(target.chaId)
    return true
}

/**
 * Turns the scope off and discards the chat's own values, its own jailbreak and memory switches and the memory
 * switches parked on its alternatives. Returns the snapshot for `restoreChatScope`, or null (and changes nothing) when
 * the scope is already off.
 */
export function disableChatScope(target: ScopeTarget): ChatScopeSnapshot | null {
    const { chat } = target
    if (chat.useLocallySetGlobalVariables !== true) {
        return null
    }
    const switches: ScopeSwitches = {}
    if (chat.scopedJailbreak !== undefined) {
        switches.scopedJailbreak = chat.scopedJailbreak
    }
    if (chat.scopedMemory !== undefined) {
        switches.scopedMemory = chat.scopedMemory
    }
    const snapshot: ChatScopeSnapshot = {
        values: chat.GLGlobalVariables ? { ...chat.GLGlobalVariables } : undefined,
        path: pathOf(chat),
        switches,
        parked: takeParkedSwitches(chat),
    }
    chat.useLocallySetGlobalVariables = false
    chat.GLGlobalVariables = {}
    delete chat.scopedJailbreak
    delete chat.scopedMemory
    markCharacterForSave(target.chaId)
    return snapshot
}

/**
 * Undoes `disableChatScope` on the live owner and chat. Refused, with nothing written or marked, when the owner or
 * the chat is gone or archived, the scope is on again, or the chat's path changed since the discard. Returns whether
 * the values were restored; the caller tells the user about a refusal and never reports success for it.
 */
export function restoreChatScope(target: ScopeTarget, snapshot: ChatScopeSnapshot): boolean {
    return writeLiveChat(target.chaId, target.chat, (live) => {
        if (live.useLocallySetGlobalVariables === true || !samePath(pathOf(live), snapshot.path)) {
            return false
        }
        if (snapshot.values) {
            live.GLGlobalVariables = { ...snapshot.values }
        } else {
            delete live.GLGlobalVariables
        }
        live.useLocallySetGlobalVariables = true
        if (snapshot.switches.scopedJailbreak !== undefined) {
            live.scopedJailbreak = snapshot.switches.scopedJailbreak
        } else {
            delete live.scopedJailbreak
        }
        if (snapshot.switches.scopedMemory !== undefined) {
            live.scopedMemory = snapshot.switches.scopedMemory
        } else {
            delete live.scopedMemory
        }
        // The live chat may be another object than the one discarded, and a branch switch since the discard may have
        // reordered `alt`: the records are found by the `chatId` of their message. A value whose record has no id or is
        // gone is not restored.
        if (live.alt !== undefined && isChatAltReadable(live)) {
            for (const { chatId, value } of snapshot.parked) {
                if (chatId === '') {
                    continue
                }
                const mem = live.alt.find((record) => record.m.chatId === chatId)?.mem
                if (typeof mem === 'object' && mem !== null) {
                    mem.scopedMemory = value
                }
            }
        }
    })
}

/**
 * The jailbreak switch in force for `chat`: its own boolean value while its scope flag is on, else the global one. A
 * missing chat (a subject that is gone) reads the global value. `db` is the database whose global value is read.
 */
export function effectiveJailbreak(chat: Chat | undefined, db: Pick<Database, 'jailbreakToggle'> = DBState.db): boolean {
    if (chat?.useLocallySetGlobalVariables === true && typeof chat.scopedJailbreak === 'boolean') {
        return chat.scopedJailbreak
    }
    return !!db.jailbreakToggle
}

/**
 * The memory switch in force for `chat` of `owner`: the chat's own boolean value while its scope flag is on, else the
 * owner's `supaMemory`.
 */
export function effectiveMemory(owner: { supaMemory?: boolean }, chat: Chat | undefined): boolean {
    if (chat?.useLocallySetGlobalVariables === true && typeof chat.scopedMemory === 'boolean') {
        return chat.scopedMemory
    }
    return !!owner.supaMemory
}

/**
 * Writes the jailbreak switch for `chat` by the rule of its scope: into the chat while its scope is on, else into the
 * global value. Acts on the given chat, never the selection, and marks the owner.
 */
export function writeChatJailbreak(owner: { chaId: string }, chat: Chat, value: boolean): void {
    if (chat.useLocallySetGlobalVariables === true) {
        chat.scopedJailbreak = value
    } else {
        DBState.db.jailbreakToggle = value
    }
    markCharacterForSave(owner.chaId)
}

/**
 * Writes the memory switch for `chat`: into the chat while its scope is on, else onto the owner. Acts on the given
 * owner and chat, never the selection, and marks the owner.
 */
export function writeChatMemory(owner: { chaId: string, supaMemory?: boolean }, chat: Chat, value: boolean): void {
    if (chat.useLocallySetGlobalVariables === true) {
        chat.scopedMemory = value
    } else {
        owner.supaMemory = value
    }
    markCharacterForSave(owner.chaId)
}

/** Removes the chat's own jailbreak switch, so the global one shows again. Marks the owner only when it removed one. */
export function revertChatJailbreak(owner: { chaId: string }, chat: Chat): void {
    if (chat.scopedJailbreak !== undefined) {
        delete chat.scopedJailbreak
        markCharacterForSave(owner.chaId)
    }
}

/** Removes the chat's own memory switch, so the owner's shows again. Marks the owner only when it removed one. */
export function revertChatMemory(owner: { chaId: string }, chat: Chat): void {
    if (chat.scopedMemory !== undefined) {
        delete chat.scopedMemory
        markCharacterForSave(owner.chaId)
    }
}

/** The value `getGlobalChatVar` gives for `chat`: the chat's own non-empty value, else the shared one, else 'null'. */
export function chatToggleValue(chat: Chat, key: string): string {
    const local = chat.GLGlobalVariables?.[key]
    if (local !== 'null' && local) {
        return local
    }
    return DBState.db.globalChatVariables[key] ?? 'null'
}

/**
 * Writes a toggle value for `chat` by the rule of `setGlobalChatVar`: into the chat while its scope is on, else into
 * the shared map with the chat's own key removed. Acts on the given chat, never the selection, and marks the owner.
 */
export function writeChatToggle(owner: { chaId: string }, chat: Chat, key: string, value: string): void {
    if (chat.useLocallySetGlobalVariables) {
        chat.GLGlobalVariables ??= {}
        chat.GLGlobalVariables[key] = value
    } else {
        if (chat.GLGlobalVariables?.[key] !== undefined) {
            delete chat.GLGlobalVariables[key]
        }
        DBState.db.globalChatVariables[key] = value
    }
    markCharacterForSave(owner.chaId)
}

/** Removes the chat's own value of `key`, so the shared value shows again (the old 📌 button). */
export function useSharedToggleValue(owner: { chaId: string }, chat: Chat, key: string): void {
    if (chat.GLGlobalVariables?.[key] !== undefined) {
        delete chat.GLGlobalVariables[key]
        markCharacterForSave(owner.chaId)
    }
}
