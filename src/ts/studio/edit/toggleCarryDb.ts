// The database side of the carry applier: which places a carry reaches, and the port that reads and writes stored
// toggle values in them. Everything is synchronous and resolves chats by id at call time, never by a remembered slot.
import { markCharacterForSave, markDbWrite } from '../../storage/characterSaveMarks'
import type { Chat, Database } from '../../storage/database.svelte'
import { isModuleStub } from '../../storage/moduleStub'
import { COLD_POINTER_HEADER, isColdStub } from '../../storage/store2/codec/stub'
import { DBState } from '../../stores.svelte'
import { workingPresetsOf } from '../itemText'
import type { ToggleTarget } from '../toggleBuilder.svelte'
import type { CarryReach, CarryValuePort, OtherSource, PlaceEntries, PlaceRef } from '../toggleCarryApply'

type CharacterSlot = Database['characters'][number]

/** A loaded character a carry may write: an object, not a stub, and not in the trash. */
function isEligibleCharacter(slot: CharacterSlot | null | undefined): slot is CharacterSlot {
    return typeof slot === 'object' && slot !== null && !isColdStub(slot) && typeof slot.trashTime !== 'number'
}

/** A chat whose first message is still the cold-storage pointer holds no values of its own. */
function isPointerChat(chat: Chat): boolean {
    const first: unknown = Array.isArray(chat.message) ? chat.message[0] : undefined
    const data = typeof first === 'object' && first !== null && 'data' in first ? first.data : undefined
    return typeof data === 'string' && data.startsWith(COLD_POINTER_HEADER)
}

/** The character a `chaId` names: the first slot holding it, and only while that slot is eligible. */
function liveCharacter(chaId: string): CharacterSlot | undefined {
    const first = DBState.db.characters.find((slot) => slot?.chaId === chaId)
    return isEligibleCharacter(first) ? first : undefined
}

/** The chat with this id, only while exactly one chat of the character has it and it is not a pointer. */
function liveChat(chaId: string, chatId: string): Chat | undefined {
    const chats = liveCharacter(chaId)?.chats
    if (!Array.isArray(chats)) {
        return undefined
    }
    const sharing = chats.filter((chat) => chat?.id === chatId)
    return sharing.length === 1 && !isPointerChat(sharing[0]) ? sharing[0] : undefined
}

function chatPlaces(slot: CharacterSlot): PlaceEntries[] {
    const chats: readonly Chat[] = Array.isArray(slot.chats) ? slot.chats : []
    const places: PlaceEntries[] = []
    for (const chat of chats) {
        if (!chat || typeof chat.id !== 'string' || chat.id === '' || isPointerChat(chat)) {
            continue
        }
        if (chats.filter((other) => other?.id === chat.id).length !== 1) {
            continue
        }
        places.push({ ref: { kind: 'chat', chaId: slot.chaId, chatId: chat.id }, entries: chat.GLGlobalVariables })
    }
    return places
}

/**
 * Where a carry for this owner reaches. A character owner reaches the global value and its own chats; a module owner
 * reaches the global value and the chats of every loaded character. Stubs, trashed characters, pointer chats and chats
 * without a unique id are outside. `others` names every other readable source of toggle text, so a written key another
 * source reads is named before the answer: presets, modules and characters (trashed ones too, they read the global
 * value once restored), never the owner's own source.
 */
export function readCarryReach(target: ToggleTarget): CarryReach {
    const places: PlaceEntries[] = [{ ref: { kind: 'global' }, entries: DBState.db.globalChatVariables }]
    const seen = new Set<string>()
    for (const slot of DBState.db.characters) {
        if (!slot || typeof slot.chaId !== 'string' || slot.chaId === '' || seen.has(slot.chaId)) {
            continue
        }
        seen.add(slot.chaId)
        if (!isEligibleCharacter(slot) || (target.kind === 'character' && slot.chaId !== target.chaId)) {
            continue
        }
        places.push(...chatPlaces(slot))
    }

    const others: OtherSource[] = []
    workingPresetsOf(DBState.db).forEach((preset, index) => {
        if (target.kind === 'preset' && DBState.db.botPresets?.[index]?.id === target.presetId) {
            return
        }
        if (typeof preset.toggles === 'string' && preset.toggles !== '') {
            others.push({
                id: index === DBState.db.botPresetsId ? 'prompt' : `preset:${index}`,
                name: DBState.db.botPresets?.[index]?.name ?? '',
                text: preset.toggles,
            })
        }
    })
    for (const module of DBState.db.modules ?? []) {
        if (module && !isModuleStub(module) && !(target.kind === 'module' && module.id === target.moduleId)
            && typeof module.customModuleToggle === 'string' && module.customModuleToggle !== '') {
            others.push({ id: `module:${module.id}`, name: module.name, text: module.customModuleToggle })
        }
    }
    for (const slot of DBState.db.characters) {
        if (slot && slot.type !== 'group' && !isColdStub(slot) && !(target.kind === 'character' && slot.chaId === target.chaId)
            && typeof slot.customModuleToggle === 'string' && slot.customModuleToggle !== '') {
            others.push({ id: `character:${slot.chaId}`, name: slot.name, text: slot.customModuleToggle })
        }
    }
    return { places, others }
}

function recordOf(ref: PlaceRef, create: boolean): Record<string, string> | undefined | 'gone' {
    if (ref.kind === 'global') {
        if (create) {
            DBState.db.globalChatVariables ??= {}
        }
        return DBState.db.globalChatVariables
    }
    const chat = liveChat(ref.chaId, ref.chatId)
    if (!chat) {
        return 'gone'
    }
    if (create) {
        chat.GLGlobalVariables ??= {}
    }
    return chat.GLGlobalVariables
}

/**
 * The port over the live database. Writes go through the reactive proxy, so the write hook marks them as well; `mark`
 * names each touched character once and the global value once, which also holds where the hook is not live.
 */
export function createCarryDbPort(): CarryValuePort {
    return {
        read(ref, varKey) {
            const record = recordOf(ref, false)
            return record === 'gone' ? 'gone' : record?.[varKey]
        },
        write(ref, varKey, value) {
            const record = recordOf(ref, value !== undefined)
            if (record === 'gone') {
                throw new Error('The place for a carried toggle value is gone.')
            }
            if (value === undefined) {
                if (record) {
                    delete record[varKey]
                }
            } else if (record) {
                record[varKey] = value
            }
        },
        mark(refs) {
            const chaIds = new Set<string>()
            let global = false
            for (const ref of refs) {
                if (ref.kind === 'global') {
                    global = true
                } else {
                    chaIds.add(ref.chaId)
                }
            }
            for (const chaId of chaIds) {
                markCharacterForSave(chaId)
            }
            if (global) {
                markDbWrite({ kind: 'setting', key: 'globalChatVariables' })
            }
        },
    }
}
