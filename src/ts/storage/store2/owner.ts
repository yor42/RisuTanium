import { defaultKeyEnv, randomId26, type CommitKey, type KeyEnv } from './format'

/**
 * The owner id a bulk marker carries (`staging.owner`) and the decision on
 * whether a standing marker may be cleared without asking. Nothing here touches
 * a backend: where the id is persisted and how the foreign-clear question is put
 * to the user are injected.
 */

export type Staging = NonNullable<CommitKey['staging']>

const OWNER_ID = /^[0-9a-v]{26}$/

export function isOwnerId(value: string): boolean {
    return OWNER_ID.test(value)
}

/** A fresh random id for one page load. It is never stored on the web: a reloaded or duplicated tab is a foreign owner. */
export function freshOwnerId(env: Pick<KeyEnv, 'random'> = defaultKeyEnv): string {
    return randomId26({ ...defaultKeyEnv, ...env })
}

/** Where the Tauri build keeps its one owner id (app data); the web build has none. */
export interface OwnerIdStore {
    read(): Promise<string | null>
    write(id: string): Promise<void>
}

/**
 * The persisted owner id of a device that keeps one: the stored id when it is
 * well formed, otherwise a fresh id written before it is returned. A failed
 * write rejects, so no marker is ever started under an id a restart would not
 * know.
 */
export async function persistedOwnerId(store: OwnerIdStore, env: Pick<KeyEnv, 'random'> = defaultKeyEnv): Promise<string> {
    const stored = await store.read()
    if (stored !== null && isOwnerId(stored)) {
        return stored
    }
    const id = freshOwnerId(env)
    await store.write(id)
    return id
}

/** Whether `staging` was started by `ownerId`. */
export function isOwnMarker(ownerId: string, staging: Staging): boolean {
    return staging.owner === ownerId
}

/**
 * The Q3 question for a marker of another owner: the user's yes clears it, a no
 * leaves it. The prompt itself is UI and is supplied by the caller.
 */
export type ForeignClearHook = (marker: Staging) => Promise<boolean>

export type ClearDecision =
    /** No marker stands. */
    | { decision: 'none' }
    /** The marker is this owner's: it is cleared without a question (a Tauri start-up clear, an abandoned own bulk). */
    | { decision: 'clear', marker: Staging, own: true }
    /** A foreign marker the user agreed to clear. */
    | { decision: 'clear', marker: Staging, own: false }
    /** A foreign marker left standing: the user declined, or no hook is present. */
    | { decision: 'leave', marker: Staging }

/**
 * Whether the marker on a parsed commit key may be cleared by `ownerId`. A
 * foreign marker is cleared only when the hook says yes; a missing hook is a no.
 */
export async function decideClear(ownerId: string, staging: Staging | null, hook: ForeignClearHook | null): Promise<ClearDecision> {
    if (staging === null) {
        return { decision: 'none' }
    }
    if (isOwnMarker(ownerId, staging)) {
        return { decision: 'clear', marker: staging, own: true }
    }
    if (hook !== null && await hook(staging)) {
        return { decision: 'clear', marker: staging, own: false }
    }
    return { decision: 'leave', marker: staging }
}
