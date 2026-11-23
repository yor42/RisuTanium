import { type Message, type character, type Chat } from "../storage/database.svelte";
import { runTrigger } from "./triggers";
import { processScript } from "./scripts";
import { raceAbort } from "./abortRace";
import { createSendSubject, originStatus, writeAt, type WorkHandle } from "./chatOrigin";
import { markCharacterForSave } from "../storage/characterSaveMarks";

/**
 * Runs a character's input trigger, then its `editinput` script, and
 * appends the resulting user message to the chat the send started from.
 * `runTrigger` reads `char` and `startChat` directly, as given. The
 * `editinput` script reads the chat the message is appended to, through a
 * subject that prefers `startChat` when the chat's id has two holders, and
 * its Lua follows the same rule as a send's: it sees an empty chat and writes
 * nothing when the id has two holders. The append itself is resolved through
 * the origin, after every await this function makes, never through the live
 * `chatPage` -- a switch during either await must not move where the message
 * lands, and must never make two chats share one message array.
 *
 * The input trigger runs with `signal`, so a cancel stops its command lines,
 * and owns the composer's window: a `/multisend` in its command lines, or in a
 * trigger it runs, answers each segment.
 *
 * `workHandle` is acquired, and ended, by the caller: this function neither
 * calls `beginWork` nor calls `workHandle.end()`, so one work handle covers
 * every branch a caller's own send takes, not just the character branch.
 *
 * `onAppended` runs synchronously, in the same stretch as the push -- before
 * this function's own `await` returns control to its caller -- on both the
 * ok-status and the ambiguous path, so a caller can settle anything that
 * must stop looking cancelable the moment the append happens, rather than
 * after the caller's `await` resumes.
 *
 * The input trigger and the `editinput` pass are raced on `signal`: a hook that never settles does not hold the composer after a cancel, and the pass is told when it was abandoned.
 *
 * Returns false, appending nothing, when `signal` is already aborted by the
 * time the append would run, or when that chat is gone by then. An
 * ambiguous origin still appends, to `startChat`, read at the moment of the
 * append.
 */
export async function sendCharacterMessage(workHandle: WorkHandle, char: character, startChat: Chat, messageInput: string, signal: AbortSignal, onAppended: () => void): Promise<boolean> {
    const triggerRaced = await raceAbort(signal, () => runTrigger(char, 'input', { chat: startChat, origin: workHandle.origin, signal, ownsWindow: true }), { label: 'The input trigger' })
    if (!triggerRaced.settled) {
        return false
    }

    const subject = createSendSubject(workHandle.origin, { owner: char, chat: startChat })
    const dataRaced = await raceAbort(signal, (abandoned) => processScript(char, messageInput, 'editinput', {}, undefined, subject, undefined, abandoned), { label: 'The edit-input script pass' })
    if (!dataRaced.settled) {
        return false
    }
    const data = dataRaced.value

    if (signal.aborted) {
        return false
    }

    const status = originStatus(workHandle.origin)
    if (status === 'gone') {
        return false
    }

    const message: Message = {
        role: 'user',
        data,
        time: Date.now(),
    }

    if (status === 'ambiguous') {
        // The chat object held since the start of the send, read at the
        // moment of the append -- never an id resolved now, which a
        // duplicate could resolve to the wrong holder of, and never a
        // message array captured before a cut that ran during either
        // await above.
        startChat.message.push(message)
        markCharacterForSave(char.chaId)
    } else {
        writeAt(workHandle.origin, (ctx) => {
            ctx.chat.message.push(message)
        })
    }
    onAppended()
    return true
}
