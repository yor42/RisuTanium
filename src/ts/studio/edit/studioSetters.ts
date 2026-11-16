// The per-field half of a Studio write: which live target an owner key addresses (and why it may be
// refused), the live reader the history model plans against, the op builders for an edit, and the
// functions that `applyStudioWrite` hands to `writeLiveCharacter` / `writeLiveChat`. Nothing here
// marks a character or touches a history record; only the service calls these.

import { clearCharEmotionCache, DBState } from '../../stores.svelte'
import type { RisuModule } from '../../process/modules'
import { toAssetList, type AssetTuple } from '../../storage/assetList'
import { isModuleStub } from '../../storage/moduleStub'
import { firstMessageIndexOf } from '../../process/firstMessage'
import type { Chat, character, groupChat } from '../../storage/database.svelte'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from '../assets/assetOwnerKeys'
import { parseTargetPath, rewritableTextAt } from '../assets/referenceTargets'
import { selectedStudioCharacterId, studioScreen } from '../studioScreen.svelte'
import { TEXT_FIELD_PATHS, fmAfterRemove, type FieldValue, type FmValue, type LiveReader, type Op, type RestoreContext, type SetPath, type StepLabel, type WriteOp } from '../history/historyModel'
import { parseOwnerKey, type OwnerKey } from '../history/ownerPhase'
import { moduleSlotsWithId, orderAssetWrites, type RetainedResult } from './assetSetters'

export type SetterRefusal =
    | 'not-selected'
    | 'duplicate-id'
    | 'duplicate-module-id'
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

// The one live slot of a module owner: found by id, never a stub and never an id two slots share.
export interface ModuleTarget {
    module: RisuModule
    index: number
}

export type OwnerTarget = LiveTarget | ModuleTarget

export function isModuleTarget(target: OwnerTarget): target is ModuleTarget {
    return 'module' in target
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

// A module owner is selected only while the open module is its own: the owner is refused as `not-selected`
// otherwise. A shared id (stubs count, so an unloaded module sharing it counts) refuses `duplicate-module-id`, and a
// stub holding the id alone is `gone`; no body key of a stub is read.
function resolveModuleTarget(moduleId: string, openModuleId: () => string | null): { ok: true; target: ModuleTarget } | { ok: false; reason: SetterRefusal } {
    if (openModuleId() !== moduleId) {
        return { ok: false, reason: 'not-selected' }
    }
    const slots = moduleSlotsWithId(DBState.db.modules, moduleId)
    if (slots.length === 0) {
        return { ok: false, reason: 'gone' }
    }
    if (slots.length > 1) {
        return { ok: false, reason: 'duplicate-module-id' }
    }
    const [slot] = slots
    if (isModuleStub(slot.module)) {
        return { ok: false, reason: 'gone' }
    }
    return { ok: true, target: { module: slot.module as RisuModule, index: slot.index } }
}

// The guards of every Studio write, in their fixed order. A failed guard writes and marks nothing. A module owner
// resolves only with `openModuleId`; without it a module owner is `gone`, as for a caller that has no module panel.
export function resolveLiveTarget(owner: OwnerKey): { ok: true; target: LiveTarget } | { ok: false; reason: SetterRefusal }
export function resolveLiveTarget(owner: OwnerKey, openModuleId: () => string | null): { ok: true; target: OwnerTarget } | { ok: false; reason: SetterRefusal }
export function resolveLiveTarget(owner: OwnerKey, openModuleId?: () => string | null): { ok: true; target: OwnerTarget } | { ok: false; reason: SetterRefusal } {
    const parsed = parseOwnerKey(owner)
    if (!parsed) {
        return { ok: false, reason: 'gone' }
    }
    if (parsed.kind === 'module') {
        return openModuleId ? resolveModuleTarget(parsed.moduleId, openModuleId) : { ok: false, reason: 'gone' }
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

export function fmValueOf(chat: Chat): FmValue {
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
            if (path === 'firstMessage') {
                return typeof live.firstMessage === 'string' ? { had: true, value: live.firstMessage } : { had: false }
            }
            if (path === 'exampleMessage') {
                return typeof live.exampleMessage === 'string' ? { had: true, value: live.exampleMessage } : { had: false }
            }
            if (path === 'customModuleToggle') {
                return typeof live.customModuleToggle === 'string' ? { had: true, value: live.customModuleToggle } : { had: false }
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
        text(target) {
            return rewritableTextAt({ kind: 'character', source: live }, target)
        },
        assetRows(array) {
            return array === 'assets' ? null : rowsOfList(live[array])
        },
        folderValue() {
            return live.extentions?.[ASSET_FOLDER_KEY]
        },
    }
}

// The rows of an asset list when it is an array of string arrays, else null (an unreadable list is never edited).
function rowsOfList(value: unknown): readonly (readonly string[])[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    return value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string')) ? (value as string[][]) : null
}

// The reader of a module owner: asset rows of `assets`, the folder document under its prefixed key, and the module's
// own registry texts. A module has no fields, first messages or chats.
export function createModuleLiveReader(module: RisuModule): LiveReader {
    return {
        field: () => ({ had: false }),
        greetings: () => null,
        fmIndex: () => null,
        text(target) {
            return rewritableTextAt({ kind: 'module', source: module }, target)
        },
        assetRows(array) {
            return array === 'assets' ? rowsOfList(module.assets) : null
        },
        folderValue() {
            return module[ASSET_FOLDER_KEY]
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
    // A list edit that moves the context chat's first message, on a chat without a unique id, also sets `fmIndex` to
    // this value on `chats[chatPage]` (a delete passes the index the chat follows its text to). Null: no page write.
    pageFm: number | null
}

export type EditBuildResult = EditBuild | { ok: false; reason: 'precondition' | 'unchanged' }

// `coalesce: false` gives a step that never joins, and is never joined by, a neighbouring typing step.
export function buildFieldEdit(path: SetPath, value: string | boolean, live: LiveReader, coalesce = true): EditBuildResult {
    if (typeof value !== (path === 'hideChatIcon' ? 'boolean' : 'string')) {
        return { ok: false, reason: 'precondition' }
    }
    const before = live.field(path)
    // An absent required key cannot be put back by an undo (setCharacterField never deletes it), so the edit is refused
    // before anything is written, marked or recorded.
    if (!before.had && (path === 'firstMessage' || path === 'exampleMessage')) {
        return { ok: false, reason: 'precondition' }
    }
    if (before.had && before.value === value) {
        return { ok: false, reason: 'unchanged' }
    }
    const after: FieldValue = { had: true, value }
    return {
        ok: true,
        label: { kind: 'field', field: path },
        ops: [{ op: 'set', path, before, after }],
        writes: [{ op: 'set', path, value: after }],
        coalesceKey: coalesce ? path : null,
        pageFm: null,
    }
}

// The step part that moves the context chat (`chats[chatPage]`) to `after`: its `chatFm` op, the write when the chat
// has a unique id, and the page write when it has none (the op then records `chatId: null`, which an undo cannot
// replay). Null when the character has no context chat.
export function chatFmFollow(target: LiveTarget, after: number): { op: Op; write: WriteOp | null; pageFm: number | null } | null {
    const context = target.character.chats?.[target.character.chatPage]
    if (!context) {
        return null
    }
    const chatId = uniqueContextChatId(target, context)
    const next: FmValue = { had: true, value: after }
    return {
        op: { op: 'chatFm', chatId, before: fmValueOf(context), after: next },
        write: chatId === null ? null : { op: 'chatFm', chatId, value: next },
        pageFm: chatId === null ? after : null,
    }
}

// The id by which the context chat can be addressed: its own id when no other chat shares it, else null.
function uniqueContextChatId(target: LiveTarget, context: Chat): string | null {
    return context.id && uniqueChatById(target.character.chats, context.id) === context ? context.id : null
}

// The open chat a restore follows: by its unique id, or, without one, by the stored value (the commit then writes it by
// page index). Null when the character has no context chat.
export function restoreContextOf(target: LiveTarget): RestoreContext | null {
    const context = target.character.chats?.[target.character.chatPage]
    if (!context) {
        return null
    }
    const chatId = uniqueContextChatId(target, context)
    return chatId === null ? { chatId: null, fm: fmValueOf(context) } : { chatId }
}

// An append may make the stored index of a chat that reads as the default (an integer at or past the old length) name
// an appended entry. The step pins every such chat to -1, so the appended text never becomes its first message silently.
export function staleFmPin(target: LiveTarget | undefined, oldLength: number): { op: Op; write: WriteOp | null; pageFm: number | null } | null {
    if (!target) {
        return null
    }
    const context = target.character.chats?.[target.character.chatPage]
    if (!context || typeof context.fmIndex !== 'number' || !Number.isInteger(context.fmIndex) || context.fmIndex < oldLength) {
        return null
    }
    return chatFmFollow(target, -1)
}

// `target` is optional so that a caller with no chat context builds the bare insert; the service always passes it.
export function buildGreetingAdd(live: LiveReader, target?: LiveTarget): EditBuildResult {
    const list = live.greetings()
    if (list === null) {
        return { ok: false, reason: 'precondition' }
    }
    const index = list.length
    const ops: Op[] = [{ op: 'listInsert', index, value: '' }]
    const writes: WriteOp[] = [{ op: 'listInsert', index, value: '' }]
    const pin = staleFmPin(target, index)
    if (pin) {
        ops.push(pin.op)
        if (pin.write) {
            writes.push(pin.write)
        }
    }
    return { ok: true, label: { kind: 'greetingAdd' }, ops, writes, coalesceKey: null, pageFm: pin?.pageFm ?? null }
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
        pageFm: null,
    }
}

// One step with the removal and the follow of the context chat (`chats[chatPage]`) to the text it shows: an earlier
// entry moves it down one, its own entry sends it to the default first message, a later entry or a chat that already
// shows the default leaves it. Other chats are not adjusted. A context chat without a unique id is followed by index,
// and its op records `chatId: null`, which an undo cannot replay.
export function buildGreetingDelete(index: number, deletedId: string, target: LiveTarget, live: LiveReader): EditBuildResult {
    const list = live.greetings()
    const value = list?.[index]
    if (value === undefined) {
        return { ok: false, reason: 'precondition' }
    }
    const ops: Op[] = [{ op: 'listRemove', index, value, deletedId }]
    const writes: WriteOp[] = [{ op: 'listRemove', index }]
    let pageFm: number | null = null
    // The effective index is read before the removal; a stale stored value shows the default and gets no op.
    const context = target.character.chats?.[target.character.chatPage]
    const shown = context ? firstMessageIndexOf(target.character, context) : -1
    const nextShown = fmAfterRemove(shown, index)
    const follow = nextShown === shown ? null : chatFmFollow(target, nextShown)
    if (follow) {
        ops.push(follow.op)
        if (follow.write) {
            writes.push(follow.write)
        }
        pageFm = follow.pageFm
    }
    return { ok: true, label: { kind: 'greetingRemove' }, ops, writes, coalesceKey: null, pageFm }
}

// ---------------------------------------------------------------- write functions for writeLive*

function setCharacterField(live: character, path: SetPath, value: FieldValue): void {
    if (path === 'desc') {
        if (value.had && typeof value.value === 'string') {
            live.desc = value.value
        }
    } else if (path === 'firstMessage') {
        if (value.had && typeof value.value === 'string') {
            live.firstMessage = value.value
        }
    } else if (path === 'exampleMessage') {
        if (value.had && typeof value.value === 'string') {
            live.exampleMessage = value.value
        }
    } else if (path === 'customModuleToggle') {
        if (!value.had) {
            delete live.customModuleToggle
        } else if (typeof value.value === 'string') {
            live.customModuleToggle = value.value
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

// What an asset write adds to the owner write, beside the planned writes. The folder document is the result of
// applying the plan's folder ops to the value stored now (computed before anything is written); the retained
// recompute reads the field's present value inside the write and decides what the field becomes.
export interface AssetWriteExtras {
    folder: { kind: 'keep' } | { kind: 'set'; doc: unknown } | { kind: 'remove' }
    retained: ((existing: unknown) => RetainedResult) | null
}

// A string-keyed view of a holder, for assigning a registry text by its parsed field name. The holder is a character,
// a module or one of their entries; a write goes through it only where the slot holds a string now.
function fieldsView(holder: object): Record<string, unknown> {
    return holder as Record<string, unknown>
}

function assignIfString(holder: object | null | undefined, field: string, value: string): void {
    if (holder) {
        const fields = fieldsView(holder)
        if (typeof fields[field] === 'string') {
            fields[field] = value
        }
    }
}

// A `textSet` on a registry text of the live character: the whole value the plan computed, assigned in place where
// the slot holds a string. It creates no container. The text fields (a `set`) and the first message entries (a `listSet`)
// are never written here.
function writeCharacterText(live: character, target: string, value: string): void {
    const parsed = parseTargetPath('character', target)
    if (parsed === null || 'greeting' in parsed) {
        return
    }
    if ('trigger' in parsed) {
        assignIfString(live.triggerscript?.[parsed.trigger]?.[parsed.section]?.[parsed.entry], parsed.field, value)
    } else if ('entry' in parsed) {
        assignIfString((parsed.entry === 'lore' ? live.globalLore : live.customscript)?.[parsed.index], parsed.field, value)
    } else if ('nested' in parsed) {
        assignIfString(live[parsed.nested], parsed.field, value)
    } else if (!(TEXT_FIELD_PATHS as readonly string[]).includes(parsed.field)) {
        assignIfString(live, parsed.field, value)
    }
}

// Rows of a character's asset lists, in place: the character is marked by the write call that wraps this.
function editCharacterRows(live: character, write: Extract<WriteOp, { op: 'assetRowRemove' | 'assetRowInsert' | 'assetRowSet' }>): void {
    if (write.array === 'assets') {
        return
    }
    // The list holds rows of strings; a row that came from a plan has exactly the cells the list's rows have.
    const rows: unknown[] | undefined = live[write.array]
    if (!Array.isArray(rows)) {
        return
    }
    if (write.op === 'assetRowRemove') {
        rows.splice(write.index, 1)
    } else if (write.op === 'assetRowInsert') {
        rows.splice(write.index, 0, [...write.tuple])
    } else {
        rows[write.index] = [...write.after]
    }
}

function writeCharacterFolder(live: character, folder: AssetWriteExtras['folder']): void {
    if (folder.kind === 'set') {
        // `extentions` is created only when a document must be written and none exists.
        live.extentions ??= {}
        live.extentions[ASSET_FOLDER_KEY] = folder.doc
    } else if (folder.kind === 'remove' && live.extentions) {
        delete live.extentions[ASSET_FOLDER_KEY]
    }
}

// The body of the one `writeLiveCharacter` call of a character owner's action.
export function applyCharacterWrites(live: character | groupChat, writes: readonly WriteOp[], pageFm: number | null, extras?: AssetWriteExtras): void {
    if (live.type === 'group') {
        return
    }
    let emotionRemoved = false
    let folderWritten = false
    // Rows first, then the folder document, then the rest; the folder document is written once, from its result.
    for (const write of extras ? orderAssetWrites(writes) : writes) {
        if (extras && !folderWritten && write.op !== 'assetRowRemove' && write.op !== 'assetRowInsert' && write.op !== 'assetRowSet') {
            writeCharacterFolder(live, extras.folder)
            folderWritten = true
        }
        switch (write.op) {
            case 'assetRowRemove':
            case 'assetRowInsert':
            case 'assetRowSet':
                editCharacterRows(live, write)
                // A removed or re-pointed emotion row invalidates the cached resolved path.
                if (write.array === 'emotionImages' && (write.op === 'assetRowRemove' || (write.op === 'assetRowSet' && write.before[1] !== write.after[1]))) {
                    emotionRemoved = true
                }
                break
            case 'textSet':
                writeCharacterText(live, write.target, write.value)
                break
            case 'assetFolderSet':
            case 'assetFolderOrder':
                break
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
    if (extras) {
        // A plan with only row writes reaches the folder document here.
        if (!folderWritten) {
            writeCharacterFolder(live, extras.folder)
        }
        if (extras.retained) {
            writeRetained(live, extras.retained(live[ASSET_RETAINED_KEY]))
        }
    }
    if (emotionRemoved) {
        clearCharEmotionCache(live.chaId)
    }
    if (pageFm !== null) {
        const page = live.chats?.[live.chatPage]
        if (page) {
            page.fmIndex = pageFm
        }
    }
}

// Sets the retained field as a new value, removes it, or leaves it; never writes `undefined` under the key.
function writeRetained(owner: { [ASSET_RETAINED_KEY]?: unknown }, result: RetainedResult): void {
    if (result.kind === 'set') {
        owner[ASSET_RETAINED_KEY] = result.value
    } else if (result.kind === 'remove') {
        delete owner[ASSET_RETAINED_KEY]
    }
}

// The one assignment of a module owner's asset write: a new module object with the rows (a new array), the folder
// document and the retained field set from this write, and the texts the plan edits. The live module is not touched.
export function buildWrittenModule(live: RisuModule, writes: readonly WriteOp[], extras: AssetWriteExtras): RisuModule {
    const next: RisuModule = { ...live }
    let rows: string[][] | null = null
    for (const write of orderAssetWrites(writes)) {
        if (write.op === 'assetRowRemove' || write.op === 'assetRowInsert' || write.op === 'assetRowSet') {
            if (write.array !== 'assets') {
                continue
            }
            rows ??= (live.assets ?? []).map((row) => [...row])
            if (write.op === 'assetRowRemove') {
                rows.splice(write.index, 1)
            } else if (write.op === 'assetRowInsert') {
                rows.splice(write.index, 0, [...write.tuple])
            } else {
                rows[write.index] = [...write.after]
            }
        } else if (write.op === 'textSet') {
            writeModuleText(next, write.target, write.value)
        }
    }
    if (rows) {
        // The rows are fresh copies, so the list can hold them as they are; a plain array here would put the whole
        // list into the reactive graph.
        next.assets = toAssetList(rows as AssetTuple[])
    }
    if (extras.folder.kind === 'set') {
        next[ASSET_FOLDER_KEY] = extras.folder.doc
    } else if (extras.folder.kind === 'remove') {
        delete next[ASSET_FOLDER_KEY]
    }
    if (extras.retained) {
        writeRetained(next, extras.retained(live[ASSET_RETAINED_KEY]))
    }
    return next
}

function replaceAt<T>(list: readonly T[], at: number, item: T): T[] {
    return list.map((current, index) => (index === at ? item : current))
}

function withField<T extends object>(source: T, field: string, value: unknown): T {
    const copy = { ...source }
    fieldsView(copy)[field] = value
    return copy
}

function holdsString(holder: object, field: string): boolean {
    return typeof fieldsView(holder)[field] === 'string'
}

// A `textSet` on a registry text of the module under construction. Every container on the path (the list, the entry,
// the trigger's section array and leaf) is replaced by a copy taken from `next`, never from the live module, so
// several writes into one list compose; the live module is not touched. A slot that holds no string is left alone,
// and so is `cjs` (flag-only).
function writeModuleText(next: RisuModule, target: string, value: string): void {
    const parsed = parseTargetPath('module', target)
    if (parsed === null) {
        return
    }
    if ('trigger' in parsed) {
        const list = next.trigger
        const entry = list?.[parsed.trigger]
        const group = entry?.[parsed.section]
        const leaf = group?.[parsed.entry]
        if (list && entry && group && leaf && holdsString(leaf, parsed.field)) {
            const leafCopy = withField(leaf, parsed.field, value)
            next.trigger = replaceAt(list, parsed.trigger, withField(entry, parsed.section, replaceAt(group, parsed.entry, leafCopy)))
        }
    } else if ('entry' in parsed) {
        if (parsed.entry === 'lore') {
            const list = next.lorebook
            const entry = list?.[parsed.index]
            if (list && entry && holdsString(entry, parsed.field)) {
                next.lorebook = replaceAt(list, parsed.index, withField(entry, parsed.field, value))
            }
        } else {
            const list = next.regex
            const entry = list?.[parsed.index]
            if (list && entry && holdsString(entry, parsed.field)) {
                next.regex = replaceAt(list, parsed.index, withField(entry, parsed.field, value))
            }
        }
    } else if ('field' in parsed && !('nested' in parsed) && parsed.field === 'backgroundEmbedding' && typeof next.backgroundEmbedding === 'string') {
        next.backgroundEmbedding = value
    }
}

// Called once after a module slot is replaced. The production port resets the `getModules` memo and tells module
// screens, as the module loader does; it is injected because `process/modules` cannot be imported from here without a
// cycle.
export type ModuleSlotReplaced = () => void

// Replaces a module slot: one assignment, then the port. Every Studio module write goes through it.
function replaceModuleSlot(index: number, next: RisuModule, replaced: ModuleSlotReplaced | undefined): void {
    DBState.db.modules[index] = next
    replaced?.()
}

// Assigns the module's slot in the database once, found again by id at write time. Refuses (writes nothing) when the
// id no longer names exactly one resident module.
export function writeLiveModule(moduleId: string, build: (live: RisuModule) => RisuModule, replaced?: ModuleSlotReplaced): boolean {
    const slots = moduleSlotsWithId(DBState.db.modules, moduleId)
    if (slots.length !== 1 || isModuleStub(slots[0].module)) {
        return false
    }
    replaceModuleSlot(slots[0].index, build(slots[0].module as RisuModule), replaced)
    return true
}

// The body of the one `writeLiveChat` call of a chat owner's action; a chat owner has only `note`.
export function applyChatWrites(live: Chat, writes: readonly WriteOp[]): void {
    for (const write of writes) {
        if (write.op === 'set' && write.path === 'note' && write.value.had && typeof write.value.value === 'string') {
            live.note = write.value.value
        }
    }
}
