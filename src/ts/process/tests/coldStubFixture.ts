import { v4 as uuidv4 } from "uuid"
import type { Chat, character, groupChat } from "../../storage/database.svelte"
import { COLD_STUB_VERSION, characterCreator, stubDescription, stubTags } from "../coldCharacter"

/**
 * Fixture helper: builds a stub in the shape of the archived-character
 * placeholder, for tests that need one. It is test support, not a producer. It
 * is pinned to the real producers by `archiveCapture.fixtures.test.ts` (the
 * stubs the archive writer captured) and by `codecStub.test.ts` (store2's
 * `stubFromEntry`), so a drift in the stub's field set fails there.
 */

type Slot = character | groupChat

/**
 * Exactly the fields a stub carries. It is deliberately not a full
 * `character` or `groupChat`; it is cast to one at the single place that
 * builds it, because every list reader and the save code only read these.
 */
interface ColdStubFields {
    type: 'character' | 'group'
    name: string
    image?: string
    chaId: string
    lastInteraction?: number
    trashTime?: number
    characters?: string[]
    creatorNotes: string
    coldstorage: string
    coldStoragedChats: string[]
    chats: Chat[]
    chatPage: number
    firstMsgIndex: number
    coldVersion: number
    coldChatCount: number
    tags?: string[]
    creator?: string
}

/**
 * The stub for `source`, which stands for the unit `unitKey`.
 * `coldStoragedChats` lists the chat units `source` already points at. Returns
 * a new object; `source` is not modified.
 *
 * Besides the pointer fields (`coldstorage`, `coldStoragedChats` and the one
 * dummy chat, whose first message must stay empty) the stub carries what the
 * character lists show: the real `type` (and a group's member list), name,
 * image, `lastInteraction`, `trashTime`, the chat count and the description,
 * and for a character its tags and resolved creator (`characterCreator`), whole
 * and untruncated. It carries no message content. `trashTime` and
 * `lastInteraction` are left off when unset, so a saved stub has no such key.
 * It never throws on odd saved data: a group without a member list gets an
 * empty one, and a description that is not a string gives an empty description.
 */
export function buildColdStub(source: character, unitKey: string, coldStoragedChats: string[]): character
export function buildColdStub(source: groupChat, unitKey: string, coldStoragedChats: string[]): groupChat
export function buildColdStub(source: Slot, unitKey: string, coldStoragedChats: string[]): Slot
export function buildColdStub(source: Slot, unitKey: string, coldStoragedChats: string[]): Slot {
    const stub: ColdStubFields = {
        type: source.type === 'group' ? 'group' : 'character',
        name: source.name,
        image: source.image,
        chaId: source.chaId,
        creatorNotes: stubDescription(source.creatorNotes),
        coldstorage: unitKey,
        coldStoragedChats: [...coldStoragedChats],
        chats: [{
            id: uuidv4(),
            message: [{
                time: Date.now(),
                data: '',
                role: 'char'
            }],
            note: "",
            name: "",
            localLore: []
        }],
        chatPage: 0,
        firstMsgIndex: 0,
        coldVersion: COLD_STUB_VERSION,
        coldChatCount: Array.isArray(source.chats) ? source.chats.length : 0,
    }
    if (typeof source.lastInteraction === 'number') {
        stub.lastInteraction = source.lastInteraction
    }
    if (source.trashTime) {
        stub.trashTime = source.trashTime
    }
    if (source.type === 'group') {
        stub.characters = Array.isArray(source.characters) ? [...source.characters] : []
    } else {
        stub.tags = stubTags(source)
        stub.creator = characterCreator(source)
    }
    return stub as unknown as Slot
}
