// Pure lifecycle of one Studio history owner: the phase table, owner keys and the store
// expectation type. Nothing here reads a clock, a port or the database.

// One deadline per owner, armed at first use and never restarted. It covers claim, open and load
// together, so a hung or rejecting port can keep a form read-only for at most this long.
export const READY_DEADLINE_MS = 5000
// A save request restarts the debounce timer; the first unsaved request also starts the max-wait
// timer, which is not restarted. Either one enqueues the single waiting save job.
export const SAVE_DEBOUNCE_MS = 1000
export const SAVE_MAX_WAIT_MS = 5000

export type OwnerKey = `character:${string}` | `chat:${string}/${string}`

export type ParsedOwnerKey =
    | { kind: 'character'; chaId: string }
    | { kind: 'chat'; chaId: string; chatId: string }

// Owner keys are built from ids only. A chat without an id has no owner key (it never uses chatPage).
export function characterOwnerKey(chaId: string): OwnerKey {
    return `character:${chaId}`
}

export function chatOwnerKey(chaId: string, chatId: string): OwnerKey {
    return `chat:${chaId}/${chatId}`
}

export function parseOwnerKey(key: string): ParsedOwnerKey | null {
    if (key.startsWith('character:')) {
        const chaId = key.slice('character:'.length)
        return chaId === '' ? null : { kind: 'character', chaId }
    }
    if (key.startsWith('chat:')) {
        const rest = key.slice('chat:'.length)
        const slash = rest.indexOf('/')
        if (slash <= 0 || slash === rest.length - 1) {
            return null
        }
        return { kind: 'chat', chaId: rest.slice(0, slash), chatId: rest.slice(slash + 1) }
    }
    return null
}

export function isOwnerKey(key: string): key is OwnerKey {
    return parseOwnerKey(key) !== null
}

// What the store adapter believes it last saw for an owner: nothing stored, an intact pair with
// that write id, or something it could not read. A save without an expectation is a contract breach.
export type Expectation =
    | { kind: 'none' }
    | { kind: 'wid'; wid: string }
    | { kind: 'foreign' }

export type MemoryOnlyReason = 'otherTab' | 'noLocks' | 'failed' | 'unavailable' | 'keptUnreadable'

// Notes carried by `ready`: a failed write that the next save retries, the one-time notice that
// unreadable bytes were copied aside, and the note that the stored copy was trimmed.
export type ReadyReason = 'unreadable' | 'trimmed' | 'unwritable'

export type OwnerPhase =
    | { kind: 'claiming' }
    | { kind: 'opening' }
    | { kind: 'loading' }
    | { kind: 'ready'; reason: ReadyReason | null }
    | { kind: 'memoryOnly'; reason: MemoryOnlyReason }
    | { kind: 'excluded' }

export type OwnerEvent =
    | { type: 'firstUse'; restricted: boolean }
    | { type: 'claim:granted' }
    | { type: 'claim:held' }
    | { type: 'claim:unsupported'; tauri: boolean }
    | { type: 'claim:failed' }
    | { type: 'deadline' }
    | { type: 'open:ok' }
    | { type: 'open:unavailable' }
    | { type: 'load:absent' }
    | { type: 'load:ok' }
    | { type: 'load:unreadable' }
    | { type: 'load:keptUnreadable' }
    | { type: 'load:failed' }
    | { type: 'save:ok'; asided: boolean; trimmed: boolean }
    | { type: 'save:unwritable' }
    | { type: 'save:kept' }
    | { type: 'save:notLoaded' }
    | { type: 'closed' }

function memoryOnly(reason: MemoryOnlyReason): OwnerPhase {
    return { kind: 'memoryOnly', reason }
}

// `null` stands for "not used yet": only `firstUse` leaves it. An event without a row for the
// current phase returns the phase it was given, unchanged and by reference, so a caller can
// tell an ignored event from a transition. `memoryOnly` and `excluded` accept nothing.
export function nextPhase(phase: OwnerPhase | null, event: OwnerEvent): OwnerPhase | null {
    if (phase === null) {
        if (event.type !== 'firstUse') {
            return phase
        }
        return event.restricted ? { kind: 'excluded' } : { kind: 'claiming' }
    }
    switch (phase.kind) {
        case 'claiming':
            switch (event.type) {
                case 'claim:granted':
                    return { kind: 'opening' }
                case 'claim:unsupported':
                    return event.tauri ? { kind: 'opening' } : memoryOnly('noLocks')
                case 'claim:held':
                    return memoryOnly('otherTab')
                case 'claim:failed':
                case 'deadline':
                    return memoryOnly('failed')
                default:
                    return phase
            }
        case 'opening':
            switch (event.type) {
                case 'open:ok':
                    return { kind: 'loading' }
                case 'open:unavailable':
                case 'deadline':
                    return memoryOnly('unavailable')
                default:
                    return phase
            }
        case 'loading':
            switch (event.type) {
                case 'load:absent':
                case 'load:ok':
                    return { kind: 'ready', reason: null }
                case 'load:unreadable':
                    return { kind: 'ready', reason: 'unreadable' }
                case 'load:keptUnreadable':
                    return memoryOnly('keptUnreadable')
                case 'load:failed':
                case 'deadline':
                    return memoryOnly('failed')
                case 'closed':
                    return memoryOnly('unavailable')
                default:
                    return phase
            }
        case 'ready':
            switch (event.type) {
                case 'save:ok':
                    return {
                        kind: 'ready',
                        reason: event.asided ? 'unreadable' : event.trimmed ? 'trimmed' : null,
                    }
                case 'save:unwritable':
                    return { kind: 'ready', reason: 'unwritable' }
                case 'save:kept':
                    return memoryOnly('keptUnreadable')
                case 'save:notLoaded':
                    return memoryOnly('failed')
                case 'closed':
                    return memoryOnly('unavailable')
                default:
                    return phase
            }
        case 'memoryOnly':
        case 'excluded':
            return phase
    }
}

// Only `ready` ever writes the store; `claiming`, `opening` and `loading` refuse history actions.
export function isWaitingPhase(phase: OwnerPhase): boolean {
    return phase.kind === 'claiming' || phase.kind === 'opening' || phase.kind === 'loading'
}
