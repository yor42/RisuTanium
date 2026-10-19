/**
 * The key rules the page applies to an Android asset write (the addressable
 * rules of a posix page, then the creatable rules of the desktop file system),
 * against the table that the Rust test of `asset_batch.rs` reads too
 * (`assetKeyParity.json`). A batched write is decided only by Rust, so a key
 * the page would refuse but Rust takes, or the other way round, would land an
 * asset the page cannot address again or refuse one the batch takes. Both sides
 * must give the table's answer.
 */
import { describe, test, expect } from 'vitest'
import table from './assetKeyParity.json'
import { tauriAddressableViolation, tauriCreatableViolation } from '../store/keyRules'

interface ParityCase {
    key: string
    accept: boolean
    why: string
    fill?: string
    times?: number
}

/** The key a case names: `{fill}` in `key` stands for `fill` repeated `times` times. */
function keyOf(item: ParityCase): string {
    return item.fill === undefined ? item.key : item.key.replace('{fill}', item.fill.repeat(item.times ?? 0))
}

/** What the page's store refuses for a write on Android, as `checkCreatable` of the files store decides it. */
function pageRefusal(key: string): string | null {
    return tauriAddressableViolation(key, 'posix') ?? tauriCreatableViolation(key)
}

describe('the key rules shared with the Rust batch write', () => {
    const cases = table as ParityCase[]

    test('the table covers every class of key the rules decide', () => {
        expect(cases.length).toBeGreaterThanOrEqual(30)
        expect(cases.some((item) => item.accept)).toBe(true)
        expect(cases.some((item) => !item.accept)).toBe(true)
    })

    test.each(cases.map((item) => [item.why, item] as const))('%s', (_why, item) => {
        const key = keyOf(item)

        expect(pageRefusal(key) === null, `${JSON.stringify(key)}: ${pageRefusal(key)}`).toBe(item.accept)
    })
})
