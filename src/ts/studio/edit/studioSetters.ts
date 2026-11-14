// The per-field half of a Studio write: which live target an owner key addresses (and why it may be
// refused), the live reader the history model plans against, the op builders for an edit, and the
// functions that `applyStudioWrite` hands to `writeLiveCharacter` / `writeLiveChat`. Nothing here
// marks a character or touches a history record; only the service calls these.

import { clearCharEmotionCache, DBState } from '../../stores.svelte'
import type { RisuModule } from '../../process/modules'
import { toAssetList, type AssetTuple } from '../../storage/assetList'
import { isModuleStub } from '../../storage/moduleStub'
import type { Chat, character, groupChat } from '../../storage/database.svelte'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from '../assets/assetOwnerKeys'
import { selectedStudioCharacterId, studioScreen } from '../studioScreen.svelte'
import type { FieldValue, FmValue, LiveReader, Op, SetPath, StepLabel, TextEditOp, WriteOp } from '../history/historyModel'
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
        text(target) {
            return readTextAt('character', live, target)
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
            return readTextAt('module', module, target)
        },
        assetRows(array) {
            return array === 'assets' ? rowsOfList(module.assets) : null
        },
        folderValue() {
            return module[ASSET_FOLDER_KEY]
        },
    }
}

// ---------------------------------------------------------------- text targets of a registry path

export type TextOwnerKind = 'character' | 'module'

export interface TextSlot {
    list: 'globalLore' | 'customscript' | 'lorebook' | 'regex'
    index: number
    field: 'content' | 'out'
}

const TEXT_PATH = /^(lore|regex)\/(0|[1-9][0-9]*)\/(content|out)$/

// The list and field that hold the text a registry path names, by owner kind: a character keeps its lorebook in
// `globalLore` and its scripts in `customscript`, a module in `lorebook` and `regex`. Any other path, including
// `desc` and the greeting entries, is refused: the owner write handles those itself.
export function textSlotOf(kind: TextOwnerKind, path: string): TextSlot | null {
    const match = TEXT_PATH.exec(path)
    if (!match) {
        return null
    }
    const index = Number(match[2])
    if (match[1] === 'lore' && match[3] === 'content') {
        return { list: kind === 'character' ? 'globalLore' : 'lorebook', index, field: 'content' }
    }
    if (match[1] === 'regex' && match[3] === 'out') {
        return { list: kind === 'character' ? 'customscript' : 'regex', index, field: 'out' }
    }
    return null
}

// The lists an owner of either kind may hold; a character or a module is assignable to it.
export interface TextHolder {
    readonly globalLore?: readonly { readonly content?: string }[]
    readonly customscript?: readonly { readonly out?: string }[]
    readonly lorebook?: readonly { readonly content?: string }[]
    readonly regex?: readonly { readonly out?: string }[]
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null
}

// The text at `path` in the owner's own lists; null when the path is refused or the entry holds no string.
export function readTextAt(kind: TextOwnerKind, holder: TextHolder, path: string): string | null {
    const slot = textSlotOf(kind, path)
    if (!slot) {
        return null
    }
    switch (slot.list) {
        case 'globalLore':
            return stringOrNull(holder.globalLore?.[slot.index]?.content)
        case 'lorebook':
            return stringOrNull(holder.lorebook?.[slot.index]?.content)
        case 'customscript':
            return stringOrNull(holder.customscript?.[slot.index]?.out)
        case 'regex':
            return stringOrNull(holder.regex?.[slot.index]?.out)
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

// What an asset write adds to the owner write, beside the planned writes. The folder document is the result of
// applying the plan's folder ops to the value stored now (computed before anything is written); the retained
// recompute reads the field's present value inside the write and decides what the field becomes.
export interface AssetWriteExtras {
    folder: { kind: 'keep' } | { kind: 'set'; doc: unknown } | { kind: 'remove' }
    retained: ((existing: unknown) => RetainedResult) | null
}

function spliceInto(text: string, edit: TextEditOp): string {
    return text.slice(0, edit.offset) + edit.to + text.slice(edit.offset + edit.from.length)
}

const GREETING_TEXT_TARGET = /^alternateGreetings\/(\d+)$/

// A `textEdit` on a greeting entry or a registry text of the live character. `desc` is a field write, never here.
function editCharacterText(live: character, edit: TextEditOp): void {
    const greeting = GREETING_TEXT_TARGET.exec(edit.target)
    if (greeting) {
        const index = Number(greeting[1])
        const current = live.alternateGreetings?.[index]
        if (typeof current === 'string') {
            live.alternateGreetings[index] = spliceInto(current, edit)
        }
        return
    }
    const slot = textSlotOf('character', edit.target)
    if (slot?.list === 'globalLore') {
        const entry = live.globalLore?.[slot.index]
        if (entry && typeof entry.content === 'string') {
            entry.content = spliceInto(entry.content, edit)
        }
    } else if (slot?.list === 'customscript') {
        const entry = live.customscript?.[slot.index]
        if (entry && typeof entry.out === 'string') {
            entry.out = spliceInto(entry.out, edit)
        }
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
export function applyCharacterWrites(live: character | groupChat, writes: readonly WriteOp[], pageFm: boolean, extras?: AssetWriteExtras): void {
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
            case 'textEdit':
                editCharacterText(live, write)
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
    if (pageFm) {
        const page = live.chats?.[live.chatPage]
        if (page) {
            page.fmIndex = -1
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
        } else if (write.op === 'textEdit') {
            editModuleText(next, write)
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

// A `textEdit` on a module's lorebook or regex entry: the list and the entry are replaced by copies.
function editModuleText(next: RisuModule, edit: TextEditOp): void {
    const slot = textSlotOf('module', edit.target)
    if (slot?.list === 'lorebook') {
        const list = next.lorebook
        const entry = list?.[slot.index]
        if (list && entry && typeof entry.content === 'string') {
            const content = spliceInto(entry.content, edit)
            next.lorebook = list.map((item, index) => (index === slot.index ? { ...item, content } : item))
        }
    } else if (slot?.list === 'regex') {
        const list = next.regex
        const entry = list?.[slot.index]
        if (list && entry && typeof entry.out === 'string') {
            const out = spliceInto(entry.out, edit)
            next.regex = list.map((item, index) => (index === slot.index ? { ...item, out } : item))
        }
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
