import { hexStemToBase64url } from '../format'

/**
 * Shared scanning helpers of the list derivations. Everything here is a pure
 * function of the values it is given.
 */

export type PlainRecord = Record<string, unknown>

export function isPlainRecord(value: unknown): value is PlainRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Code-unit order: the order every sorted list body uses, independent of locale. */
export function compareCodeUnits(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0
}

export function sortedUnique(values: Iterable<string>): string[] {
    return [...new Set(values)].sort(compareCodeUnits)
}

export function isBinaryValue(value: object): boolean {
    return ArrayBuffer.isView(value) || value instanceof ArrayBuffer || (typeof Blob !== 'undefined' && value instanceof Blob)
}

/**
 * Calls `visit` for every string and every object key under `root`. Arrays and
 * plain objects are followed to any depth (the walk is iterative, so depth never
 * hides a string); binary values hold no text and are skipped.
 */
export function forEachString(root: unknown, visit: (text: string) => void): void {
    const pending: unknown[] = [root]
    while (pending.length > 0) {
        const value = pending.pop()
        if (typeof value === 'string') {
            visit(value)
            continue
        }
        if (typeof value !== 'object' || value === null || isBinaryValue(value)) {
            continue
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                pending.push(item)
            }
            continue
        }
        const record = value as PlainRecord
        for (const key of Object.keys(record)) {
            visit(key)
            pending.push(record[key])
        }
    }
}

/** Every uuid-shaped substring, overlapping ones included. */
const UUID_AT = /(?=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))/gi
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ASSET_ID = /^assets\/[0-9a-f]{64}\.[A-Za-z0-9]+$/
const ASSET_HASH_AT = /assets\/([0-9a-f]{64})/gi
/** The inlay token of chat text; the id is any non-empty run on one line. */
const INLAY_TOKEN_SOURCE = '{{(inlay|inlayed|inlayeddata)::(.+?)}}'

/**
 * The ids an owner's text can hold that the inlay cleanup's matcher would keep:
 * uuid occurrences anywhere in the text, asset hashes of `assets/<hash>` paths,
 * and token ids of any other shape. Nothing is capped.
 */
export class InlayIdCollector {
    readonly uuids = new Set<string>()
    /** 64-digit lower-case hex hashes. */
    readonly hashes = new Set<string>()
    readonly others = new Set<string>()

    add(text: string): void {
        if (text.length >= 36) {
            for (const match of text.matchAll(UUID_AT)) {
                this.uuids.add(match[1].toLowerCase())
            }
        }
        if (text.includes('assets/')) {
            for (const match of text.matchAll(ASSET_HASH_AT)) {
                this.hashes.add(match[1].toLowerCase())
            }
        }
        if (text.includes('{{')) {
            for (const match of text.matchAll(new RegExp(INLAY_TOKEN_SOURCE, 'g'))) {
                const id = match[2]
                if (!UUID_EXACT.test(id) && !ASSET_ID.test(id)) {
                    this.others.add(id)
                }
            }
        }
    }

    addAll(root: unknown): void {
        forEachString(root, text => this.add(text))
    }

    /** The collected hashes as sorted 43-character stems. */
    stems(): string[] {
        return sortedUnique([...this.hashes].map(hexStemToBase64url))
    }
}
