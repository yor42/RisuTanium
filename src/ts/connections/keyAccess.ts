import type { Connection } from './connections'

/*
 * The read and write seam for a connection's key. V1 stores the plain string; a later vault
 * replaces only these bodies, so every caller already awaits the read.
 */

/** The plaintext key of a connection: the whole multi-line string, never split or resolved. */
export async function connectionKey(conn: Connection): Promise<string> {
    return conn.key
}

/** Whether the connection holds a non-blank key. */
export function connectionHasKey(conn: Connection): boolean {
    return conn.key.trim() !== ''
}

/** Stores `plain` as the key. V1 sets it synchronously, so callers need not await. */
export function setConnectionKey(conn: Connection, plain: string): Promise<void> {
    conn.key = plain
    return Promise.resolve()
}

/** A sync read for editors and value sites; the only raw read outside the async seam. */
export function connectionKeyForUi(conn: Connection): string {
    return conn.key
}
