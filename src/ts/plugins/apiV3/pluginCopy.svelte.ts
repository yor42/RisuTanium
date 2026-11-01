/**
 * The copy a plugin receives from `getDatabase`, and the mark that lets the
 * bridge skip its transfer walk for it.
 */

type Position = 'list' | 'character' | 'chats' | 'chat' | null

const plainResults = new WeakSet<object>()

/**
 * Marks `value` as a result made only of structured-clone data (the copy of
 * persisted keys): it holds no stream, port or transferable buffer, so the
 * bridge need not walk it for transferables.
 */
export function markPlainResult<T extends object>(value: T): T {
    plainResults.add(value)
    return value
}

export function isPlainResult(value: unknown): boolean {
    return typeof value === 'object' && value !== null && plainResults.has(value)
}

/**
 * A copy of the character list that equals `$state.snapshot(list)`: the same
 * walk as Svelte's `clone` (one aliasing map per call, `toJSON` instances
 * cached under both the instance and its JSON, holes kept, key order kept),
 * with one difference. A fresh copy of a chat (`list[i].chats[j]`) is built
 * without its `alt` key, so the alternatives are never read.
 *
 * A chat reached a second time is returned from the aliasing map as the copy
 * made first, and one made at another position can still hold `alt`; the
 * caller's `withoutAltIn` pass over the result removes those, so the output
 * equals the snapshot followed by that pass, alias structure included.
 */
export function copyCharactersWithoutAlt(list: unknown): unknown {
    return copyNode(list, new Map(), 'list', null)
}

function copyNode(value: unknown, cloned: Map<unknown, unknown>, position: Position, original: unknown): unknown {
    if (typeof value === 'object' && value !== null) {
        const known = cloned.get(value)
        if (known !== undefined) {
            return known
        }

        if (value instanceof Map) {
            return new Map(value)
        }
        if (value instanceof Set) {
            return new Set(value)
        }

        if (Array.isArray(value)) {
            const copy: unknown[] = Array(value.length)
            cloned.set(value, copy)
            if (original !== null) {
                cloned.set(original, copy)
            }
            const elementPosition: Position = position === 'list' ? 'character' : position === 'chats' ? 'chat' : null
            for (let i = 0; i < value.length; i += 1) {
                const element: unknown = value[i]
                if (i in value) {
                    copy[i] = copyNode(element, cloned, elementPosition, null)
                }
            }
            return copy
        }

        if (Object.getPrototypeOf(value) === Object.prototype) {
            const source = value as Record<string, unknown>
            const copy: Record<string, unknown> = {}
            cloned.set(value, copy)
            if (original !== null) {
                cloned.set(original, copy)
            }
            for (const key of Object.keys(source)) {
                if (position === 'chat' && key === 'alt') {
                    continue
                }
                copy[key] = copyNode(source[key], cloned, position === 'character' && key === 'chats' ? 'chats' : null, null)
            }
            return copy
        }

        if (value instanceof Date) {
            return structuredClone(value)
        }

        const toJSON = (value as { toJSON?: unknown }).toJSON
        if (typeof toJSON === 'function') {
            return copyNode(toJSON.call(value), cloned, null, value)
        }
    }

    if (value instanceof EventTarget) {
        return value
    }

    try {
        return structuredClone(value)
    }
    catch {
        return value
    }
}
