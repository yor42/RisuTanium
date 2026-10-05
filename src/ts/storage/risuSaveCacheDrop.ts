import localforage from 'localforage'

/**
 * Deletes the legacy block cache database (`risuSaveCache`) once the page's
 * profile is a block profile: nothing writes it, and the only reader
 * is the legacy decoder, which a block profile never runs in its default mode.
 *
 * Best effort and never awaited: a boot must not wait for it or fail on it. A
 * delete that is blocked (another connection to the database is still open)
 * stays queued and finishes when the connection closes; it changes nothing
 * about the connection that is open, so the page keeps working either way.
 * `dropInstance` is given a bare `{ name }`, the shape that deletes the whole
 * database in localforage 1.10.0.
 */
export function dropRisuSaveCache(): void {
    try {
        void localforage.createInstance({ name: 'risuSaveCache' }).dropInstance({ name: 'risuSaveCache' }).catch(() => { })
    } catch {
        // Nothing depends on the cache being gone.
    }
}
