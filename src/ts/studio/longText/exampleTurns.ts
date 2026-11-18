/**
 * Which lines of an example text open a speaker turn, and which part of each
 * the engine ignores. A local copy of the rule in `exampleMessages.ts`,
 * pinned to the engine by `exampleTurns.engineDiff.test.ts`.
 */

export type TurnLine = {
    speaker: 'assistant' | 'user'
    /** Offset of the trimmed line's first character. */
    start: number
    /** Offset just past the first colon. */
    speakerEnd: number
    /** Offset just past the trimmed line's last character. */
    end: number
    /** Offset of the second colon, or null when the line has none. */
    notUsedStart: number | null
    /** The text the engine keeps from this line: between the first two colons, leading blanks dropped. */
    used: string
}

export type TurnNote = { start: number; end: number; note: 'speaker' | 'notUsed' }

/** The engine's speaker test on the trimmed, lower-cased line; the character name is compared as written. */
export function exampleTurnSpeaker(lowered: string, charName: string): 'assistant' | 'user' | null {
    if (lowered.startsWith('{{char}}:') || lowered.startsWith('<bot>:') || lowered.startsWith(`${charName}:`)) {
        return 'assistant'
    }
    if (lowered.startsWith('{{user}}:') || lowered.startsWith('<user>:')) {
        return 'user'
    }
    return null
}

/** Speaker lines of `text`, in order; offsets are in `text`, which splits on `\n` as the engine does. */
export function turnLines(text: string, charName: string): TurnLine[] {
    const turns: TurnLine[] = []
    let offset = 0
    for (const line of text.split('\n')) {
        const trimmed = line.trim()
        const lowered = trimmed.toLocaleLowerCase()
        const speaker = lowered === '<start>' ? null : exampleTurnSpeaker(lowered, charName)
        if (speaker !== null) {
            const start = offset + (line.length - line.trimStart().length)
            const first = trimmed.indexOf(':')
            const second = trimmed.indexOf(':', first + 1)
            turns.push({
                speaker,
                start,
                speakerEnd: start + first + 1,
                end: start + trimmed.length,
                notUsedStart: second < 0 ? null : start + second,
                used: trimmed.split(':', 2)[1].trimStart(),
            })
        }
        offset += line.length + 1
    }
    return turns
}

/** The display notes of `turnLines`: the speaker prefix and the unused tail, in text order. */
export function turnMarks(text: string, charName: string): TurnNote[] {
    const notes: TurnNote[] = []
    for (const turn of turnLines(text, charName)) {
        notes.push({ start: turn.start, end: turn.speakerEnd, note: 'speaker' })
        if (turn.notUsedStart !== null) {
            notes.push({ start: turn.notUsedStart, end: turn.end, note: 'notUsed' })
        }
    }
    return notes
}
