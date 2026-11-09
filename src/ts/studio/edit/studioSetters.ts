// The per-field half of a Studio write: which live target an owner key addresses (and why it may be
// refused), the live reader the history model plans against, the op builders for an edit, and the
// functions that `applyStudioWrite` hands to `writeLiveCharacter` / `writeLiveChat`. Nothing here
// marks a character or touches a history record; only the service calls these.

import { DBState } from '../../stores.svelte'
import type { Chat, character, groupChat } from '../../storage/database.svelte'
import { selectedStudioCharacterId, studioScreen } from '../studioScreen.svelte'
import type { FieldValue, FmValue, LiveReader, Op, SetPath, StepLabel, WriteOp } from '../history/historyModel'
import { parseOwnerKey, type OwnerKey } from '../history/ownerPhase'

export type SetterRefusal =
    | 'not-selected'
    | 'duplicate-id'
    | 'group'
    | 'restricted'
    | 'gone'
    | 'no-unique-chat'
    | 'precondition'

type LiveCharacter = character | groupChat

export interface LiveTarget {
    character: character
    // The chat a chat owner addresses; null for a character owner.
    chat: Chat | null
}

function holdersOf(chaId: string): LiveCharacter[] {
    return (DBState.db.characters ?? []).filter((candidate) => candidate?.chaId === chaId)
}

// Groups and private characters get no forms, no records and no stored history (L5).
export function isRestrictedCharacter(candidate: LiveCharacter): boolean {
    return candidate.type === 'group' || candidate.license === 'private'
}

// True when the character with this id exists and is a group or private; false for a missing one.
export function isRestrictedChaId(chaId: string): boolean {
    const first = holdersOf(chaId)[0]
    return first !== undefined && isRestrictedCharacter(first)
}

export function uniqueChatById(chats: readonly Chat[] | undefined, chatId: string): Chat | null {
    if (!Array.isArray(chats) || chatId === '') {
        return null
    }
    const matches = chats.filter((chat) => chat?.id === chatId)
    return matches.length === 1 ? matches[0] : null
}

// The guards of every Studio write, in their fixed order. A failed guard writes and marks nothing.
export function resolveLiveTarget(owner: OwnerKey): { ok: true; target: LiveTarget } | { ok: false; reason: SetterRefusal } {
    const parsed = parseOwnerKey(owner)
    if (!parsed) {
        return { ok: false, reason: 'gone' }
    }
    const chaId = parsed.chaId
    if (chaId !== selectedStudioCharacterId() || chaId !== studioScreen.chaId) {
        return { ok: false, reason: 'not-selected' }
    }
    const holders = holdersOf(chaId)
    // writeLiveCharacter writes the FIRST holder of a chaId, which may not be the selected one.
    if (holders.length > 1) {
        return { ok: false, reason: 'duplicate-id' }
    }
    const live = holders[0]
    if (!live) {
        return { ok: false, reason: 'gone' }
    }
    if (live.type === 'group') {
        return { ok: false, reason: 'group' }
    }
    if (live.license === 'private') {
        return { ok: false, reason: 'restricted' }
    }
    if (live.coldstorage) {
        return { ok: false, reason: 'gone' }
    }
    if (parsed.kind === 'character') {
        return { ok: true, target: { character: live, chat: null } }
    }
    const chat = uniqueChatById(live.chats, parsed.chatId)
    return chat ? { ok: true, target: { character: live, chat } } : { ok: false, reason: 'no-unique-chat' }
}

function fmValueOf(chat: Chat): FmValue {
    return typeof chat.fmIndex === 'number' ? { had: true, value: chat.fmIndex } : { had: false }
}

export function createLiveReader(target: LiveTarget): LiveReader {
    const { character: live, chat } = target
    return {
        field(path): FieldValue {
            if (path === 'note') {
                return chat && typeof chat.note === 'string' ? { had: true, value: chat.note } : { had: false }
            }
            if (path === 'desc') {
                return typeof live.desc === 'string' ? { had: true, value: live.desc } : { had: false }
            }
            return typeof live.hideChatIcon === 'boolean' ? { had: true, value: live.hideChatIcon } : { had: false }
        },
        greetings() {
            return Array.isArray(live.alternateGreetings) ? live.alternateGreetings : null
        },
        fmIndex(chatId) {
            const found = uniqueChatById(live.chats, chatId)
            return found ? fmValueOf(found) : null
        },
    }
}

// ---------------------------------------------------------------- op builders (edits)

export interface EditBuild {
    ok: true
    label: StepLabel
    ops: Op[]
    writes: WriteOp[]
    // Identifies a coalescible edit; null for add and delete.
    coalesceKey: string | null
    // A greeting delete on a chat without a unique id also sets `fmIndex = -1` on `chats[chatPage]`.
    pageFm: boolean
}

export type EditBuildResult = EditBuild | { ok: false; reason: 'precondition' | 'unchanged' }

export function buildFieldEdit(path: SetPath, value: string | boolean, live: LiveReader): EditBuildResult {
    if (typeof value !== (path === 'hideChatIcon' ? 'boolean' : 'string')) {
        return { ok: false, reason: 'precondition' }
    }
    const before = live.field(path)
    if (before.had && before.value === value) {
        return { ok: false, reason: 'unchanged' }
    }
    const after: FieldValue = { had: true, value }
    return {
        ok: true,
        label: { kind: 'field', field: path },
        ops: [{ op: 'set', path, before, after }],
        writes: [{ op: 'set', path, value: after }],
        coalesceKey: path,
        pageFm: false,
    }
}

export function buildGreetingAdd(live: LiveReader): EditBuildResult {
    const list = live.greetings()
    if (list === null) {
        return { ok: false, reason: 'precondition' }
    }
    const index = list.length
    return {
        ok: true,
        label: { kind: 'greetingAdd' },
        ops: [{ op: 'listInsert', index, value: '' }],
        writes: [{ op: 'listInsert', index, value: '' }],
        coalesceKey: null,
        pageFm: false,
    }
}

export function buildGreetingEdit(index: number, value: string, live: LiveReader): EditBuildResult {
    const list = live.greetings()
    const before = list?.[index]
    if (before === undefined) {
        return { ok: false, reason: 'precondition' }
    }
    if (before === value) {
        return { ok: false, reason: 'unchanged' }
    }
    return {
        ok: true,
        label: { kind: 'greetingEdit' },
        ops: [{ op: 'listSet', index, before, after: value }],
        writes: [{ op: 'listSet', index, value }],
        coalesceKey: `alternateGreetings:${index}`,
        pageFm: false,
    }
}

// One step with the removal and the classic side effect `fmIndex = -1` on the context chat
// (`chats[chatPage]`). A context chat without a unique id still gets the side effect, by index, and
// its op records `chatId: null`, which an undo cannot replay.
export function buildGreetingDelete(index: number, deletedId: string, target: LiveTarget, live: LiveReader): EditBuildResult {
    const list = live.greetings()
    const value = list?.[index]
    if (value === undefined) {
        return { ok: false, reason: 'precondition' }
    }
    const ops: Op[] = [{ op: 'listRemove', index, value, deletedId }]
    const writes: WriteOp[] = [{ op: 'listRemove', index }]
    let pageFm = false
    const context = target.character.chats?.[target.character.chatPage]
    if (context) {
        const chatId = context.id && uniqueChatById(target.character.chats, context.id) === context ? context.id : null
        const after: FmValue = { had: true, value: -1 }
        ops.push({ op: 'chatFm', chatId, before: fmValueOf(context), after })
        if (chatId === null) {
            pageFm = true
        } else {
            writes.push({ op: 'chatFm', chatId, value: after })
        }
    }
    return { ok: true, label: { kind: 'greetingRemove' }, ops, writes, coalesceKey: null, pageFm }
}

// ---------------------------------------------------------------- write functions for writeLive*

function setCharacterField(live: character, path: SetPath, value: FieldValue): void {
    if (path === 'desc') {
        if (value.had && typeof value.value === 'string') {
            live.desc = value.value
        }
    } else if (path === 'hideChatIcon') {
        if (!value.had) {
            delete live.hideChatIcon
        } else if (typeof value.value === 'boolean') {
            live.hideChatIcon = value.value
        }
    }
}

function setFm(chat: Chat, value: FmValue): void {
    if (value.had) {
        chat.fmIndex = value.value
    } else {
        delete chat.fmIndex
    }
}

// The body of the one `writeLiveCharacter` call of a character owner's action.
export function applyCharacterWrites(live: character | groupChat, writes: readonly WriteOp[], pageFm: boolean): void {
    if (live.type === 'group') {
        return
    }
    for (const write of writes) {
        switch (write.op) {
            case 'set':
                setCharacterField(live, write.path, write.value)
                break
            case 'listSet':
                live.alternateGreetings[write.index] = write.value
                break
            case 'listInsert':
                live.alternateGreetings.splice(write.index, 0, write.value)
                break
            case 'listRemove':
                live.alternateGreetings.splice(write.index, 1)
                break
            case 'chatFm': {
                const chat = uniqueChatById(live.chats, write.chatId)
                if (chat) {
                    setFm(chat, write.value)
                }
                break
            }
        }
    }
    if (pageFm) {
        const page = live.chats?.[live.chatPage]
        if (page) {
            page.fmIndex = -1
        }
    }
}

// The body of the one `writeLiveChat` call of a chat owner's action; a chat owner has only `note`.
export function applyChatWrites(live: Chat, writes: readonly WriteOp[]): void {
    for (const write of writes) {
        if (write.op === 'set' && write.path === 'note' && write.value.had && typeof write.value.value === 'string') {
            live.note = write.value.value
        }
    }
}
