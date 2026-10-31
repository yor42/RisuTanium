import { askPrompt } from './alertPrompts'
import { decodeChoice, decodeText } from './patternPromptAnswer'

/** Asks the user to pick one of `choices`. Resolves the index, or `null` when the prompt was cancelled. */
export async function askChoice(heading: string, choices: string[]): Promise<number | null> {
    const answer = await askPrompt({ type: 'patternSelect', msg: heading, choices })
    return decodeChoice(answer, choices.length)
}

/** Asks the user for text. Resolves the text (possibly empty), or `null` when the prompt was cancelled. */
export async function askText(heading: string, options: { defaultValue?: string, datalist?: [string, string][] } = {}): Promise<string | null> {
    const answer = await askPrompt({
        type: 'patternInput',
        msg: heading,
        defaultValue: options.defaultValue ?? '',
        datalist: options.datalist ?? [],
    })
    return decodeText(answer)
}
