import type { ReplyTarget } from 'src/ts/process/chatOrigin'

/** The slice of a character slot the Tasks dialog reads: a name and its chats' ids and names. */
export interface HomeTaskCharacter {
    chaId?: string
    name?: string
    chats?: readonly { id?: string, name?: string }[]
}

export interface TaskRow {
    /** The (chaId, chatId) pair; unique among the rows and stable while the reply runs. */
    key: string
    chaId: string
    chatId: string
    /** The character's or group's name; never an id. */
    name: string
    /** The chat's name; never an id. */
    chatName: string
}

/** The pair that identifies one chat; the same key `replyTargets` deduplicates by. */
export function taskKey(chaId: string, chatId: string): string {
    return `${chaId}\u0000${chatId}`
}

/**
 * One row per reply target, in the targets' order. A missing, empty or unresolved name reads as
 * `unnamed`, so an id never becomes visible text. With no targets the characters are not read.
 */
export function taskRows(targets: readonly ReplyTarget[], characters: readonly HomeTaskCharacter[], unnamed: string): TaskRow[] {
    if (targets.length === 0) return []
    const byId = new Map<string, HomeTaskCharacter>()
    for (const character of characters) {
        if (typeof character?.chaId === 'string') byId.set(character.chaId, character)
    }
    return targets.map((target) => {
        const character = byId.get(target.chaId)
        const chat = character?.chats?.find((candidate) => candidate?.id === target.chatId)
        return {
            key: taskKey(target.chaId, target.chatId),
            chaId: target.chaId,
            chatId: target.chatId,
            name: character?.name || unnamed,
            chatName: chat?.name || unnamed,
        }
    })
}
