import type { ConnectionHolder, Connection } from './connections'
import { providerLabel, proxyName, storedConnections } from './connections'

const DISMISSED_KEY = 'risuConnections.renameNoticeDismissed'

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when the name is what migration or a first key gave the connection: its provider label (or
 * the proxy host), optionally followed by " <n>". A custom connection carries its model's name and
 * never matches.
 */
export function isDefaultNamed(conn: Connection): boolean {
    if (conn.provider === 'custom') {
        return false
    }
    const base = conn.provider === 'reverse_proxy' ? proxyName(conn.url ?? '') : providerLabel(conn.provider)
    return new RegExp(`^${escapeRegExp(base)}( \\d+)?$`).test(conn.name)
}

export function renameNoticeList(db: ConnectionHolder): Connection[] {
    return storedConnections(db).filter(isDefaultNamed)
}

/** An unreadable store reads as not dismissed. */
export function readNoticeDismissed(): boolean {
    try {
        return localStorage.getItem(DISMISSED_KEY) === '1'
    } catch {
        return false
    }
}

/** A failed write is ignored: the notice then shows again, which is harmless. */
export function dismissNotice(): void {
    try {
        localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
        // Nothing to keep the dismissal in.
    }
}
