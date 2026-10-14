import { assetRefKey, hexStemToBase64url, splitHashStems, type AssetList } from '../format'
import { isHashStemKey } from '../lists'

/**
 * The comparison of a stored asset name with the derived lists. One function
 * classifies a name and every sweep decision goes through it, so the set a name
 * is looked up in always matches the set `AssetRefCollector` filed it under.
 */

export type AssetKey =
    /** `stem` is the 43-character base64url form held in an `h` string. */
    | { kind: 'hash', stem: string }
    /** `key` is the lower-cased basename held in an `l` array. */
    | { kind: 'literal', key: string }

/**
 * In order: backslashes read as separators, `assetRefKey`, an empty key holds no
 * reference (null), `isHashStemKey`; a hash key becomes its base64url stem, any
 * other key stays a literal.
 */
export function assetKeyOf(name: string): AssetKey | null {
    const key = assetRefKey(name.replace(/\\/g, '/'))
    if (key === '') {
        return null
    }
    return isHashStemKey(key) ? { kind: 'hash', stem: hexStemToBase64url(key) } : { kind: 'literal', key }
}

/** A growing union of asset lists, queried by stored asset name. */
export class AssetKeySet {
    private readonly stems = new Set<string>()
    private readonly literals = new Set<string>()

    /** Throws RangeError when `list.h` is not a run of stems: the caller reports the list unusable. */
    addList(list: Pick<AssetList, 'h' | 'l'>): void {
        const stems = splitHashStems(list.h)
        for (const stem of stems) {
            this.stems.add(stem)
        }
        for (const literal of list.l) {
            this.literals.add(literal.toLowerCase())
        }
    }

    /** Adds a stored name the way a list holds it; a name with no usable key adds nothing. */
    addName(name: string): void {
        const key = assetKeyOf(name)
        if (key === null) {
            return
        }
        if (key.kind === 'hash') {
            this.stems.add(key.stem)
        } else {
            this.literals.add(key.key)
        }
    }

    /**
     * Whether the union protects `name`. A name that cannot be classified (empty
     * key) is reported as held: a name this build cannot compare is never deleted.
     */
    holds(name: string): boolean {
        const key = assetKeyOf(name)
        if (key === null) {
            return true
        }
        return key.kind === 'hash' ? this.stems.has(key.stem) : this.literals.has(key.key)
    }

    get size(): number {
        return this.stems.size + this.literals.size
    }
}
