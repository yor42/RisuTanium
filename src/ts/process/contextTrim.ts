import type { OpenAIChat } from "./index.svelte"

/** The token count of one chat; pure for the chats and settings of one send. */
export type CountChat = (chat: OpenAIChat) => Promise<number>

/**
 * The send's token total with the message chats counted: in the order the
 * message loop would have added them, then the counts added after the loop.
 * The order is kept so that a fractional total rounds as it would have.
 */
export async function totalInSendOrder(args: {
    chats: readonly OpenAIChat[]
    firstMessageChat: number
    tokensBeforeMessages: number
    tokensAfterMessages: readonly number[]
    countedMessages: ReadonlyMap<OpenAIChat, number>
    count: CountChat
}): Promise<number> {
    let total = args.tokensBeforeMessages
    for(let i = args.firstMessageChat; i < args.chats.length; i++){
        const chat = args.chats[i]
        total += args.countedMessages.get(chat) ?? await args.count(chat)
    }
    for(const tokens of args.tokensAfterMessages){
        total += tokens
    }
    return total
}

/** The largest count the lazy walk works with; a text chat's count is far below it. */
export const LAZY_COUNT_LIMIT = 2 ** 32
/** The lazy walk works with fewer chats plus counts after the messages than this. */
export const LAZY_ENTRY_LIMIT = 2 ** 18
/** The largest `tokensBeforeMessages`, in magnitude, the lazy walk works with. */
export const LAZY_BEFORE_LIMIT = 2 ** 51

/**
 * The context trim with the message chats counted only as far as its
 * decisions need. `chats[firstMessageChat..]` are the message chats, in no
 * total yet; `countedMessages` holds those already counted. Everything else
 * the send counted is in `tokensBeforeMessages` and `tokensAfterMessages`.
 *
 * The outcome is the eager trim's: while the total is over `maxContextTokens`,
 * fail if at most one chat is left, else subtract the oldest chat's count and
 * drop it. Same chats dropped (spliced in place), same failure and same total.
 *
 * The lazy walk runs only while every count either trim adds or subtracts is
 * an integer from 0 to `LAZY_COUNT_LIMIT`, there are fewer than
 * `LAZY_ENTRY_LIMIT` of them and `tokensBeforeMessages` is an integer within
 * `LAZY_BEFORE_LIMIT`. Every sum either trim forms then stays below 2^53, so
 * it is exact in any order, and the total only grows as chats are counted. A
 * value outside those bounds, among the inputs or the counts the walk takes,
 * makes it fall back to the eager trim over the same counts. A message the
 * walk never counts must be within them too: that is the caller's to
 * guarantee, by counting up front any chat whose count is not a text count.
 * The decisions are written as "not over the limit", the eager trim's own test
 * negated, so a limit that is not a number decides as it does there. Each chat
 * is counted at most once.
 */
export async function trimChatsToContext(args: {
    chats: OpenAIChat[]
    firstMessageChat: number
    tokensBeforeMessages: number
    tokensAfterMessages: readonly number[]
    countedMessages: ReadonlyMap<OpenAIChat, number>
    maxContextTokens: number
    count: CountChat
}): Promise<{ fits: boolean, currentTokens: number }> {
    const { chats, firstMessageChat, maxContextTokens } = args
    const counts = new Map<OpenAIChat, number>(args.countedMessages)
    const countOf = async (chat: OpenAIChat) => {
        let tokens = counts.get(chat)
        if(tokens === undefined){
            tokens = await args.count(chat)
            counts.set(chat, tokens)
        }
        return tokens
    }
    const inBounds = (tokens: number) => Number.isInteger(tokens) && tokens >= 0 && tokens <= LAZY_COUNT_LIMIT

    const eager = async () => {
        let currentTokens = await totalInSendOrder({ ...args, count: countOf })
        let dropped = 0
        while(currentTokens > maxContextTokens){
            if(chats.length - dropped <= 1){
                return { fits: false, currentTokens }
            }
            currentTokens -= await countOf(chats[dropped])
            dropped++
        }
        chats.splice(0, dropped)
        return { fits: true, currentTokens }
    }

    if(
        !Number.isInteger(args.tokensBeforeMessages) || Math.abs(args.tokensBeforeMessages) > LAZY_BEFORE_LIMIT ||
        chats.length + args.tokensAfterMessages.length >= LAZY_ENTRY_LIMIT ||
        !args.tokensAfterMessages.every(inBounds) || ![...args.countedMessages.values()].every(inBounds)
    ){
        return await eager()
    }
    // The total is `fixed` plus the counts of the message chats still kept.
    // `known` sums the counts of `chats[counted..]`, taken from the newest.
    let fixed = args.tokensBeforeMessages
    for(const tokens of args.tokensAfterMessages){
        fixed += tokens
    }
    let known = 0
    let counted = chats.length
    let dropped = 0
    while(true){
        const oldestKept = Math.max(dropped, firstMessageChat)
        // Counts only add, so once the counted part is over the limit, the
        // whole is too; otherwise count one more, newest first.
        while(!(fixed + known > maxContextTokens) && counted > oldestKept){
            counted--
            const tokens = await countOf(chats[counted])
            if(!inBounds(tokens)){
                return await eager()
            }
            known += tokens
        }
        if(!(fixed + known > maxContextTokens)){
            break
        }
        if(chats.length - dropped <= 1){
            // At most one chat is left; its count makes the total exact.
            while(counted > oldestKept){
                counted--
                const tokens = await countOf(chats[counted])
                if(!inBounds(tokens)){
                    return await eager()
                }
                known += tokens
            }
            return { fits: false, currentTokens: fixed + known }
        }
        if(dropped < firstMessageChat){
            const tokens = await countOf(chats[dropped])
            if(!inBounds(tokens)){
                return await eager()
            }
            fixed -= tokens
        }
        else if(dropped >= counted){
            known -= await countOf(chats[dropped])
            counted = dropped + 1
        }
        dropped++
    }
    chats.splice(0, dropped)
    return { fits: true, currentTokens: fixed + known }
}
