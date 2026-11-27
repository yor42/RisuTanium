/** The four optional step 2 answers of the guided persona builder, in the order they are composed. */
export interface PersonaBuilderAnswers {
    appearance: string
    personality: string
    background: string
    other: string
}

export interface PersonaBuilderLabels {
    appearance: string
    personality: string
    background: string
}

export const EMPTY_ANSWERS: Readonly<PersonaBuilderAnswers> = { appearance: '', personality: '', background: '', other: '' }

/**
 * One line per filled answer, empty answers left out. "Anything else" carries no label line. The person's
 * own words are kept as typed apart from the trim at both ends.
 */
export function composePersonaText(answers: PersonaBuilderAnswers, labels: PersonaBuilderLabels): string {
    const lines: string[] = []
    const labelled: Array<[string, string]> = [
        [labels.appearance, answers.appearance],
        [labels.personality, answers.personality],
        [labels.background, answers.background],
    ]
    for (const [label, text] of labelled) {
        const value = text.trim()
        if (value !== '') lines.push(`${label}: ${value}`)
    }
    const other = answers.other.trim()
    if (other !== '') lines.push(other)
    return lines.join('\n')
}

/** A persona the person has not yet filled in: still the default name, no picture and no description. */
export function isUntouchedPersona(persona: { name: string, icon: string, personaPrompt: string, note?: string }, defaultName: string): boolean {
    return persona.name === defaultName && persona.icon === '' && persona.personaPrompt === '' && (persona.note ?? '') === ''
}

export type RecomposeDecision = 'unchanged' | 'write' | 'ask'

/**
 * What leaving step 2 does to the step 3 text. `base` is the last composed text the person was offered; a
 * text that still equals it was never hand-edited and is replaced silently, anything else asks first.
 */
export function recomposeDecision(composed: string, base: string | null, current: string): RecomposeDecision {
    if (base === null) return composed === current ? 'unchanged' : 'write'
    if (composed === base) return 'unchanged'
    return current === base ? 'write' : 'ask'
}
