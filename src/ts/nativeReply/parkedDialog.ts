/**
 * The seam between the reconcile and the dialog of a parked reply: a finished reply whose chat was deleted or moved to
 * Trash. The reconcile hands the parked records here in turn; the dialog itself (Copy, Save as .txt, Discard, Later)
 * installs the asker. With no asker nothing is shown and every record stays parked for a later launch.
 */

export interface ParkedReply {
    key: string
    /** The character's name as the blob recorded it. */
    name: string
    text: string
    createdMs: number
}

/** `discard` removes the record; `later` keeps it for the next launch. Back and every other way out answer `later`. */
export type ParkedAnswer = 'discard' | 'later'

export type ParkedReplyAsker = (reply: ParkedReply) => Promise<ParkedAnswer>

let asker: ParkedReplyAsker | null = null

/** Installs the dialog; null removes it. */
export function setParkedReplyAsker(next: ParkedReplyAsker | null): void {
    asker = next
}

export interface ParkedReplyEffects {
    /** Removes the record, a parked one included. */
    discard(key: string): Promise<unknown>
    /** A discard failed: the record is kept and the person is told. */
    discardFailed(reply: ParkedReply, error: unknown): void
}

/** Shows `items` one at a time in the order they were created; a failed discard keeps its record. */
export async function showParkedReplies(items: readonly ParkedReply[], effects: ParkedReplyEffects): Promise<void> {
    if (asker === null) {
        return
    }
    const ordered = [...items].sort((a, b) => a.createdMs - b.createdMs)
    for (const reply of ordered) {
        let answer: ParkedAnswer
        try {
            answer = await asker(reply)
        } catch (error) {
            console.error(error)
            answer = 'later'
        }
        if (answer !== 'discard') {
            continue
        }
        try {
            await effects.discard(reply.key)
        } catch (error) {
            console.error(error)
            effects.discardFailed(reply, error)
        }
    }
}
