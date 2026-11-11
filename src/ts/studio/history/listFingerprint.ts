// Fingerprint of a whole greeting list. A step stores the fingerprints of the two lists its list
// ops sit between, so a replay can tell whether the live list is the one the step was built from.
// The functions are part of the stored format: a different result for the same list would make
// every stored fingerprint read as a foreign list. A change needs a new stored field name.
//
// Pure, with no imports. `fingerprintElement` and `mixElementHashes` are total; `listFingerprintOf`
// is total when its `elementHash` is, and the default is.

// cyrb53 over the UTF-16 units of `text`, seeded with `seed`. The result is an integer in [0, 2^53).
function cyrb53(text: string, seed: number): number {
    let h1 = 0xdeadbeef ^ seed
    let h2 = 0x41c6ce57 ^ seed
    for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i)
        h1 = Math.imul(h1 ^ unit, 2654435761)
        h2 = Math.imul(h2 ^ unit, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

// A string hashes by its units, seeded with its length. Any other value hashes as the sentinel
// string of its type, so no property of the value is read. Values of one non-string type share a
// hash; `undefined` (an array hole) differs from `null`. The sentinel takes the string path, so the
// string "\u0000undefined" hashes like a hole; a string[] greeting list never holds a hole.
export function fingerprintElement(value: unknown): number {
    if (typeof value === 'string') {
        return cyrb53(value, value.length)
    }
    const sentinel = '\u0000' + typeof value
    return cyrb53(sentinel, sentinel.length)
}

// The second stage: element boundaries survive because every element enters as a fixed-width pair.
export function mixElementHashes(hashes: readonly number[]): number {
    let h1 = 0xdeadbeef ^ hashes.length
    let h2 = 0x41c6ce57 ^ hashes.length
    for (let i = 0; i < hashes.length; i++) {
        const element = hashes[i]
        const low = element >>> 0
        const high = Math.floor(element / 2 ** 32)
        h1 = Math.imul(h1 ^ low, 2654435761)
        h2 = Math.imul(h2 ^ low, 1597334677)
        h1 = Math.imul(h1 ^ high, 2654435761)
        h2 = Math.imul(h2 ^ high, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

// A source of element hashes. It must return `fingerprintElement(value)` for every value (a cache of
// it); any other function changes the stored format.
export type ElementHash = (value: unknown) => number

// Chooses the element hash for one pass over `list`. Every function it returns is bound by the
// `ElementHash` contract above; the choice may depend on the list, never the values.
export type ListElementHash = (list: readonly unknown[]) => ElementHash

// The mix of the element hashes by index; holes read as `undefined`. Total when `elementHash` is.
export function listFingerprintOf(list: readonly unknown[], elementHash: ElementHash = fingerprintElement): number {
    const hashes: number[] = new Array<number>(list.length)
    for (let i = 0; i < list.length; i++) {
        hashes[i] = elementHash(list[i])
    }
    return mixElementHashes(hashes)
}
