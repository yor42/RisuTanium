/**
 * Key rotation for fields that hold several API keys, one per line.
 *
 * A request leases one line of a field. When the provider answers 429 or 402 the attempt marks that
 * line as tried and the same request is resent with the next untried line, so each line is sent at
 * most once per attempt of one fallback model. Tried lines and the cursor are kept per field, and a
 * limit is judged only for the field the request sent. The cursor (the line that last worked or was last
 * leased) lives in memory only and is never persisted, logged or sent anywhere.
 */

/** The only line splitter: the lease, the import blanking and the key list input share it. */
export function splitKeys(value: string): string[]
export function splitKeys<T>(value: T): T[]
export function splitKeys(value: unknown): unknown[] {
    if (typeof value !== 'string') {
        return [value]
    }
    if (!/[\r\n]/.test(value)) {
        return [value]
    }
    const lines = value.split(/\r\n|\r|\n/).map((line) => line.trim()).filter((line) => line !== '')
    return lines.length > 0 ? lines : ['']
}

/** A status that means this key is limited, as opposed to the provider being unavailable. */
export function isKeyLimitStatus(status: number | undefined): boolean {
    return status === 429 || status === 402
}

type Ring = { value: string, index: number }

const rings = new Map<string, Ring>()

function ringFor(field: string, value: string): Ring {
    let ring = rings.get(field)
    if (!ring || ring.value !== value) {
        ring = { value, index: 0 }
        rings.set(field, ring)
    }
    return ring
}

/** Forgets every cursor. Test seam. */
export function resetKeyRings() {
    rings.clear()
}

/** One per attempt of one fallback model: the lines found limited, and the lines leased by the attempt now running. */
export type KeyRotation = {
    tried: Map<string, Set<string>>
    lease: Map<string, string>
}

export function newKeyRotation(): KeyRotation {
    return { tried: new Map(), lease: new Map() }
}

/**
 * The line of `field` to send. Under two lines the value is returned as it is and nothing is leased.
 * Without a rotation the cursor line is returned and the cursor stays. With a rotation the first
 * line not yet found limited, counted from the cursor and wrapping, is leased and becomes the cursor.
 * When an edit made during the request leaves nothing untried, the cursor line is returned.
 */
export function pickLine(rotation: KeyRotation | undefined, field: string, value: string): string {
    const lines = splitKeys(value)
    if (lines.length < 2) {
        return lines[0]
    }
    const ring = ringFor(field, value)
    const start = ring.index < lines.length ? ring.index : 0
    if (!rotation) {
        return lines[start]
    }
    const leased = rotation.lease.get(field)
    if (leased !== undefined) {
        return leased
    }
    const tried = rotation.tried.get(field)
    for (let offset = 0; offset < lines.length; offset++) {
        const index = (start + offset) % lines.length
        if (!tried?.has(lines[index])) {
            ring.index = index
            rotation.lease.set(field, lines[index])
            return lines[index]
        }
    }
    return lines[start]
}

export type AfterLimit = 'single' | 'next' | 'exhausted'

/**
 * Called when the line of `field`, the field the request actually sent, was answered with a key
 * limit. Only that field is marked and judged; a field leased but not sent is left alone. `freshValue`
 * is the field as it is now, so a line added or removed during the request is honoured. 'single'
 * means the field is not a rotating one and the failure takes the ordinary path.
 */
export function afterLimit(rotation: KeyRotation, field: string, freshValue: string): AfterLimit {
    const line = rotation.lease.get(field)
    if (line === undefined) {
        return 'single'
    }
    let tried = rotation.tried.get(field)
    if (!tried) {
        tried = new Set()
        rotation.tried.set(field, tried)
    }
    tried.add(line)
    const lines = splitKeys(freshValue)
    if (lines.length < 2) {
        return 'single'
    }
    return lines.some((candidate) => !tried.has(candidate)) ? 'next' : 'exhausted'
}

/** Starts the next attempt: a lease belongs to one send. */
export function clearLease(rotation: KeyRotation) {
    rotation.lease.clear()
}
