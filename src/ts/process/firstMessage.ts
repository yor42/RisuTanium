import type { Chat, character, groupChat } from '../storage/database.svelte'

type FirstMessageOwner = Pick<character | groupChat, 'firstMessage' | 'alternateGreetings'>

// A chat whose `fmIndex` does not name an existing alternate greeting reads as the default
// first message (-1); nothing repairs the stored value.
export function firstMessageIndexOf(owner: FirstMessageOwner | undefined, chat: Pick<Chat, 'fmIndex'>): number {
    const index = chat.fmIndex
    const length = owner?.alternateGreetings?.length ?? 0
    if(typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < length){
        return index
    }
    return -1
}

export function firstMessageOf(owner: FirstMessageOwner, chat: Pick<Chat, 'fmIndex'>): string {
    const index = firstMessageIndexOf(owner, chat)
    return index === -1 ? owner.firstMessage : owner.alternateGreetings[index]
}

// The reroll arrow's next stored index, computed from the effective index so a stale value
// starts from the default message.
export function nextFirstMessageIndex(owner: FirstMessageOwner, chat: Pick<Chat, 'fmIndex'>, step: 1 | -1): number {
    const current = firstMessageIndexOf(owner, chat)
    const length = owner.alternateGreetings?.length ?? 0
    if(step === 1){
        return current >= length - 1 ? -1 : current + 1
    }
    return current === -1 ? length - 1 : current - 1
}
