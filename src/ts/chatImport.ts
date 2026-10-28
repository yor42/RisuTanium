export type TavernLine = {
    isUser: boolean
    mes: string
}

export type TavernJsonlResult = {
    messages: TavernLine[]
    skipped: number
}

const tavernHeaderKeys = ['user_name', 'character_name', 'chat_metadata', 'create_date']

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Only the first non-blank line can be the header, and a line carrying `mes`
// is a message even when it also has header keys.
function isTavernHeader(line: Record<string, unknown>): boolean {
    if('mes' in line){
        return false
    }
    return tavernHeaderKeys.some((key) => key in line)
}

/**
 * Reads a SillyTavern `.jsonl` chat. Every line holding a string `mes` becomes
 * a message in file order; a line that cannot be read is counted in `skipped`
 * instead of failing the file. Blank lines and an empty `mes` are ignored
 * without being counted, and a leading header line is dropped uncounted.
 */
export function readTavernJsonl(text: string): TavernJsonlResult {
    const messages: TavernLine[] = []
    let skipped = 0
    let isFirst = true

    const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
    for(const rawLine of source.split('\n')){
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
        if(line.trim() === ''){
            continue
        }
        const wasFirst = isFirst
        isFirst = false

        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            skipped++
            continue
        }
        if(!isPlainObject(parsed)){
            skipped++
            continue
        }
        if(wasFirst && isTavernHeader(parsed)){
            continue
        }
        if(typeof parsed.mes !== 'string'){
            skipped++
            continue
        }
        if(parsed.mes === ''){
            continue
        }
        messages.push({ isUser: Boolean(parsed.is_user), mes: parsed.mes })
    }

    return { messages, skipped }
}
