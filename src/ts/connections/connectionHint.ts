import { isSecretRef } from 'src/ts/secretRefPattern'
import { splitKeys } from 'src/ts/process/request/keyRing'
import type { Connection, ConnectionProvider } from './connections'
import { connectionKeyForUi } from './keyAccess'

/**
 * What a page may show of a key: nothing, a whole `${NAME}` reference, or at most the last four
 * characters of a long enough first line. The raw value never leaves this module.
 */
export type KeyHint =
    | { kind: 'none' }
    | { kind: 'ref', text: string, count?: number }
    | { kind: 'masked', tail: string, count?: number }

const MIN_TAIL_SOURCE = 8
const TAIL_LENGTH = 4

export function maskKeyHint(plain: string, provider: ConnectionProvider): KeyHint {
    if (plain.trim() === '') {
        return { kind: 'none' }
    }
    // A PEM is one key spread over lines, not a rotation list.
    if (provider === 'vertex') {
        return { kind: 'masked', tail: '', count: 1 }
    }
    const lines = splitKeys(plain).filter((line) => line !== '')
    const first = (lines[0] ?? '').trim()
    const count = lines.length > 1 ? lines.length : undefined
    // `isSecretRef` is a type guard, which would narrow the `string` operands to `never` on a miss.
    const wholeIsRef: boolean = isSecretRef(plain)
    const firstIsRef: boolean = isSecretRef(first)
    if (wholeIsRef || firstIsRef) {
        const text = wholeIsRef ? plain.trim() : first
        return count === undefined ? { kind: 'ref', text } : { kind: 'ref', text, count }
    }
    const tail = first.length < MIN_TAIL_SOURCE ? '' : first.slice(-TAIL_LENGTH)
    return count === undefined ? { kind: 'masked', tail } : { kind: 'masked', tail, count }
}

/** The hint of a stored connection; the only display read of its key. */
export function connectionKeyHint(conn: Connection): KeyHint {
    return maskKeyHint(connectionKeyForUi(conn), conn.provider)
}
