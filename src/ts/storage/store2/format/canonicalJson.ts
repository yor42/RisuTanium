/**
 * The one deterministic JSON encoder behind every store2 unit body. Equal values
 * give equal bytes on every build, because a unit's Ref carries its CRC and a
 * re-derived list is compared byte for byte with the stored one.
 *
 * Rules: object keys sorted by UTF-16 code unit order at every level, no
 * whitespace, `JSON.stringify` formatting for strings and numbers (so lone
 * surrogates are escaped and the output is always well-formed UTF-8). Values
 * `JSON.stringify` would silently drop or rewrite are refused instead:
 * `undefined`, functions, symbols, bigints, `NaN`, infinities, sparse arrays,
 * cycles, and any object that is not a plain object or array.
 */

export class CanonicalJsonError extends TypeError {
    constructor(message: string) {
        super(message)
        this.name = 'CanonicalJsonError'
    }
}

/**
 * The parameter is `unknown` because the encoder is the boundary that proves a
 * value is plain JSON; typed interfaces with optional fields are not assignable
 * to `JsonValue`.
 *
 * `prewritten` maps a container (by identity) to the exact string this encoder
 * wrote for it earlier. The string is pushed in place of the container, so the
 * caller must hold a string equal to `canonicalJson` of that container as it
 * is now; the container is not walked and not checked.
 */
export function canonicalJson(value: unknown, prewritten?: ReadonlyMap<object, string>): string {
    const parts: string[] = []
    writeValue(value, parts, [], prewritten)
    return parts.join('')
}

export function encodeCanonicalJson(value: unknown, prewritten?: ReadonlyMap<object, string>): Uint8Array {
    return new TextEncoder().encode(canonicalJson(value, prewritten))
}

function writeValue(value: unknown, out: string[], ancestors: object[], prewritten?: ReadonlyMap<object, string>): void {
    if (value === null) {
        out.push('null')
        return
    }
    switch (typeof value) {
        case 'boolean':
            out.push(value ? 'true' : 'false')
            return
        case 'string':
            out.push(JSON.stringify(value))
            return
        case 'number':
            if (!Number.isFinite(value)) {
                throw new CanonicalJsonError('A number must be finite.')
            }
            out.push(JSON.stringify(value))
            return
        case 'object': {
            const stored = prewritten?.get(value)
            if (stored !== undefined) {
                out.push(stored)
                return
            }
            writeContainer(value, out, ancestors, prewritten)
            return
        }
        default:
            throw new CanonicalJsonError(`A ${typeof value} is not JSON.`)
    }
}

function writeContainer(value: object, out: string[], ancestors: object[], prewritten?: ReadonlyMap<object, string>): void {
    if (ancestors.includes(value)) {
        throw new CanonicalJsonError('A cycle is not JSON.')
    }
    ancestors.push(value)
    if (Array.isArray(value)) {
        out.push('[')
        for (let i = 0; i < value.length; i++) {
            if (!(i in value)) {
                throw new CanonicalJsonError('A sparse array is not JSON.')
            }
            if (i > 0) {
                out.push(',')
            }
            writeValue(value[i], out, ancestors, prewritten)
        }
        out.push(']')
    } else {
        const proto = Object.getPrototypeOf(value)
        if (proto !== Object.prototype && proto !== null) {
            throw new CanonicalJsonError('Only plain objects and arrays are JSON.')
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
            throw new CanonicalJsonError('A symbol key is not JSON.')
        }
        const keys = Object.keys(value).sort()
        out.push('{')
        keys.forEach((key, index) => {
            if (index > 0) {
                out.push(',')
            }
            out.push(JSON.stringify(key), ':')
            writeValue((value as Record<string, unknown>)[key], out, ancestors, prewritten)
        })
        out.push('}')
    }
    ancestors.pop()
}
