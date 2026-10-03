import type { risuChatParser } from "../parser/parser.svelte";
import type { RunSubject } from "./chatOrigin";

export type DisplayParseOptions = NonNullable<Parameters<typeof risuChatParser>[1]>

/**
 * The `risuChatParser` options a chat message is displayed with. Every input is
 * explicit so the display and any other reader of the same message (auto-TTS)
 * parse it identically. `chara` is the name string the message list passes
 * (the user name for a user message, otherwise the chat owner's name, which is
 * the group's name in a group chat), never an owner object. `rmVar` keeps the
 * parse from writing chat variables.
 */
export function buildDisplayParseOptions(input: {
    chara: string
    chatID: number
    firstmsg: boolean
    chatRole: string | null
    subject?: RunSubject
}): DisplayParseOptions {
    const options: DisplayParseOptions = {
        chara: input.chara,
        chatID: input.chatID,
        rmVar: true,
        visualize: true,
        cbsConditions: { firstmsg: input.firstmsg, chatRole: input.chatRole },
    }
    if (input.subject) {
        options.subject = input.subject
    }
    return options
}
