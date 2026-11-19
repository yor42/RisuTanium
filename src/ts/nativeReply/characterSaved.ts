/**
 * The passive waiter that decides when a reply the page pushed is safely in the store. It never drives saving: it
 * listens to the commits the page makes anyway and asks for one extra pass at most once per key.
 *
 * A reply may be consumed (its record deleted) only in the callback of a commit that covers the mark counted after the
 * reply's push, and that either encoded the character or did not list it (it is gone for good). A commit that kept the
 * character's saved copy (`skipped`) or left it out (`absent`: a stub, or a character the pass did not name) says
 * nothing about the reply, so the record stays until the next launch re-applies or consumes it.
 */

export type CharacterVerdict = 'saved' | 'skipped' | 'gone' | 'absent'

export interface CharacterSavedDeps {
    /** The mark count the latest commit covered. */
    committedMarkCount(): number
    /** The mark count now. */
    markCount(): number
    /** What the commit being reported did with the character. */
    verdict(chaId: string): CharacterVerdict
    /** Calls `callback` once, when the next commit lands. Adding the same callback again before it fires changes nothing. */
    afterNextCommit(callback: () => void): void
    markCharacter(chaId: string): void
    requestSaveNow(): void
}

export interface CharacterSavedWaiter {
    /** Starts waiting for `key`: `target` is the mark count that must be covered, read after the push's mark. */
    watch(key: string, chaId: string | number, target: number, onSaved: (key: string) => void): void
    /** The keys still waiting. */
    pending(): number
}

interface Watched {
    chaId: string
    target: number
    selfRequested: boolean
    onSaved: (key: string) => void
    callback: () => void
}

export function createCharacterSavedWaiter(deps: CharacterSavedDeps): CharacterSavedWaiter {
    const watched = new Map<string, Watched>()

    function check(key: string): void {
        const entry = watched.get(key)
        if (!entry) {
            return
        }
        if (deps.committedMarkCount() >= entry.target) {
            const verdict = deps.verdict(entry.chaId)
            if (verdict === 'saved' || verdict === 'gone') {
                watched.delete(key)
                entry.onSaved(key)
                return
            }
            if (verdict === 'absent' && !entry.selfRequested) {
                // The one request this key makes: the commit did not name the character, so name it and ask for a pass.
                // The target is read after both, so it covers the mark the request counts.
                deps.markCharacter(entry.chaId)
                deps.requestSaveNow()
                entry.target = deps.markCount()
                entry.selfRequested = true
            }
        }
        // Listening only: a commit callback that asked for another pass would latch the next one, and so on.
        deps.afterNextCommit(entry.callback)
    }

    return {
        watch(key, chaId, target, onSaved) {
            const entry: Watched = {
                chaId: String(chaId),
                target,
                selfRequested: false,
                onSaved,
                callback: () => check(key),
            }
            watched.set(key, entry)
            deps.afterNextCommit(entry.callback)
        },
        pending: () => watched.size,
    }
}
