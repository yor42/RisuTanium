// The pure rules of a regex script's `flag` text. The runtime strips every `<...>` group (meta names separated by commas)
// before it reads the remaining characters as RegExp flags, so an edit here changes only the token it names and keeps
// every other character of the text as it was.

/** The letters of a classic flag that the runtime keeps; every other loose character is dropped by the runtime. */
export const FLAG_LETTERS = 'dgimsuvy'

/** The action names the Studio offers as chips. Other names inside a group (`inject`, ...) are kept untouched. */
export const FLAG_ACTIONS = ['move_top', 'move_bottom', 'repeat_back', 'cbs', 'no_end_nl'] as const
export type FlagAction = typeof FLAG_ACTIONS[number]

const ORDER_PREFIX = 'order '

export type FlagToken =
    | { kind: 'group', text: string, inner: string }
    | { kind: 'char', text: string }

/**
 * The flag as the runtime reads it: a group is exactly what `/<(.+?)>/g` matches (no newline inside, never `<>`), every
 * other character is a token of its own. The tokens joined in order give the flag back.
 */
export function flagTokens(flag: string): FlagToken[] {
    const out: FlagToken[] = []
    const groupRegex = /<(.+?)>/g
    let at = 0
    let m: RegExpExecArray | null
    while ((m = groupRegex.exec(flag)) !== null) {
        for (const ch of flag.slice(at, m.index)) {
            out.push({ kind: 'char', text: ch })
        }
        out.push({ kind: 'group', text: m[0], inner: m[1] })
        at = m.index + m[0].length
    }
    for (const ch of flag.slice(at)) {
        out.push({ kind: 'char', text: ch })
    }
    return out
}

function metasOf(inner: string): string[] {
    return inner.split(',').map((v) => v.trim())
}

function isOrderMeta(meta: string): boolean {
    return meta.startsWith(ORDER_PREFIX)
}

/** Removes the metas `drop` names from every group. A group that loses a meta is rejoined with ", " and dropped when empty. */
function removeMetas(flag: string, drop: (meta: string) => boolean): string {
    let out = ''
    for (const token of flagTokens(flag)) {
        if (token.kind === 'char') {
            out += token.text
            continue
        }
        const metas = metasOf(token.inner)
        if (!metas.some(drop)) {
            out += token.text
            continue
        }
        const kept = metas.filter((m) => !drop(m) && m !== '')
        if (kept.length > 0) {
            out += `<${kept.join(', ')}>`
        }
    }
    return out
}

/** The known flag letters set outside every group. */
export function lettersOn(flag: string): string[] {
    const on: string[] = []
    for (const token of flagTokens(flag)) {
        if (token.kind === 'char' && FLAG_LETTERS.includes(token.text) && !on.includes(token.text)) {
            on.push(token.text)
        }
    }
    return on
}

/** Off removes every occurrence of the letter outside the groups; on appends it when absent. Group text is never touched. */
export function toggleLetter(flag: string, letter: string, on: boolean): string {
    if (on) {
        return lettersOn(flag).includes(letter) ? flag : flag + letter
    }
    let out = ''
    for (const token of flagTokens(flag)) {
        if (token.kind === 'char' && token.text === letter) {
            continue
        }
        out += token.text
    }
    return out
}

/** The known actions named in any group. */
export function actionsOn(flag: string): FlagAction[] {
    const on: FlagAction[] = []
    for (const token of flagTokens(flag)) {
        if (token.kind !== 'group') {
            continue
        }
        for (const meta of metasOf(token.inner)) {
            const known = FLAG_ACTIONS.find((a) => a === meta)
            if (known && !on.includes(known)) {
                on.push(known)
            }
        }
    }
    return on
}

/** Off removes the name from every group that holds it; on appends `<name>` when the name is in no group. */
export function toggleAction(flag: string, action: FlagAction, on: boolean): string {
    if (on) {
        return actionsOn(flag).includes(action) ? flag : `${flag}<${action}>`
    }
    return removeMetas(flag, (meta) => meta === action)
}

/** The order the runtime honours: the last `order N` meta in the text, or null when there is none or N is not a number. */
export function orderOf(flag: string): number | null {
    let order: number | null = null
    for (const token of flagTokens(flag)) {
        if (token.kind !== 'group') {
            continue
        }
        for (const meta of metasOf(token.inner)) {
            if (isOrderMeta(meta)) {
                const n = parseInt(meta.substring(ORDER_PREFIX.length))
                order = Number.isFinite(n) ? n : null
            }
        }
    }
    return order
}

/**
 * A number rewrites the last order meta in place, or puts `<order n>` first when there is none. Null removes every order
 * meta and nothing else, so no earlier meta becomes the effective one.
 */
export function setOrder(flag: string, n: number | null): string {
    if (n === null) {
        return removeMetas(flag, isOrderMeta)
    }
    const meta = `${ORDER_PREFIX}${Math.trunc(n)}`
    const tokens = flagTokens(flag)
    let lastGroup = -1
    let lastMeta = -1
    tokens.forEach((token, ti) => {
        if (token.kind !== 'group') {
            return
        }
        metasOf(token.inner).forEach((m, mi) => {
            if (isOrderMeta(m)) {
                lastGroup = ti
                lastMeta = mi
            }
        })
    })
    if (lastGroup === -1) {
        return `<${meta}>${flag}`
    }
    let out = ''
    tokens.forEach((token, ti) => {
        if (ti !== lastGroup || token.kind !== 'group') {
            out += token.text
            return
        }
        const metas = metasOf(token.inner)
        metas[lastMeta] = meta
        out += `<${metas.join(', ')}>`
    })
    return out
}

/** The tokens the chips do not show: unknown group names and unknown loose characters (order metas have their own control). */
export function keptTokens(flag: string): string[] {
    const kept: string[] = []
    for (const token of flagTokens(flag)) {
        if (token.kind === 'char') {
            if (!FLAG_LETTERS.includes(token.text) && token.text.trim() !== '') {
                kept.push(token.text)
            }
            continue
        }
        for (const meta of metasOf(token.inner)) {
            if (meta === '' || isOrderMeta(meta) || FLAG_ACTIONS.some((a) => a === meta)) {
                continue
            }
            kept.push(meta)
        }
    }
    return kept
}
