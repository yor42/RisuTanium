import type { OpenAIChat } from './index.svelte'

export interface RecheckResult {
    fits: boolean
    inputTokens: number
    formated: OpenAIChat[]
    /** True when the last resort emptied this send's memory entries. */
    droppedMemory: boolean
}

/**
 * The prompt's last token check. Counts every entry; while the total is over
 * the limit, empties removable entries oldest first (in place, as the send
 * reads them afterwards) and, only when the first total was over, filters the
 * emptied entries out. `fits` is false when nothing removable is left and the
 * total is still over; `inputTokens` is then the total at that point.
 *
 * `memoryLastResort` is set only for a send that placed a ChroMemory block;
 * then that block never fails the send. The `supaMemory` entries are emptied
 * first when what cannot be removed already exceeds the limit, so history
 * survives as engine-off would keep it, and once more as a last resort when
 * the total is still over after every removable entry is emptied. Each
 * occurrence of an entry is subtracted once. With the flag false this is the
 * plain loop exactly.
 */
export async function recheckToContext(args: {
    formated: OpenAIChat[]
    maxContextTokens: number
    count: (chat: OpenAIChat) => Promise<number>
    memoryLastResort: boolean
}): Promise<RecheckResult> {
    const { maxContextTokens, count, memoryLastResort } = args
    let formated = args.formated
    const counts: number[] = []
    let inputTokens = 0
    for (const chat of formated) {
        const tokens = await count(chat)
        counts.push(tokens)
        inputTokens += tokens
    }
    let droppedMemory = false
    // Collects before emptying: an object placed twice is one object, counted twice.
    const clearMemory = (): void => {
        const at: number[] = []
        formated.forEach((chat, i) => {
            if (chat.memo === 'supaMemory' && (chat.content !== '' || (chat.multimodals && chat.multimodals.length > 0))) at.push(i)
        })
        for (const i of at) inputTokens -= counts[i]
        for (const i of at) formated[i].content = ''
        if (at.length > 0) droppedMemory = true
    }

    if (inputTokens > maxContextTokens) {
        if (memoryLastResort) {
            let fixed = inputTokens
            formated.forEach((chat, i) => {
                if (chat.removable) fixed -= counts[i]
            })
            if (fixed > maxContextTokens) clearMemory()
        }
        let pointer = 0
        while (inputTokens > maxContextTokens) {
            if (pointer >= formated.length) {
                if (memoryLastResort && !droppedMemory) {
                    clearMemory()
                    if (!(inputTokens > maxContextTokens)) break
                }
                return { fits: false, inputTokens, formated, droppedMemory }
            }
            if (formated[pointer].removable) {
                inputTokens -= await count(formated[pointer])
                formated[pointer].content = ''
            }
            pointer++
        }
        formated = formated.filter((v) => {
            return v.content !== '' || (v.multimodals && v.multimodals.length > 0)
        })
    }
    return { fits: true, inputTokens, formated, droppedMemory }
}
