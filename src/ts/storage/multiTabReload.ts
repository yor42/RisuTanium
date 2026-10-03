export const AUTO_RELOAD_MIN_INTERVAL_MS = 15000
export const AUTO_RELOAD_BURST_WINDOW_MS = 60000
export const AUTO_RELOAD_MAX_BURST = 2
export const PROMPT_RENOTIFY_MS = 60000
export const AUTO_RELOAD_HISTORY_KEY = 'risu-auto-reload-history'

export type MultiTabAction = 'auto-reload' | 'prompt' | 'stay'
export type MultiTabPromptChoice = 'flush' | 'reload' | 'stay'
export type RevisionAwarePromptChoice = 'reload' | 'stay'

export interface AutoReloadHistory {
    lastAt: number | null
    burst: number
}

const defaultHistory: AutoReloadHistory = { lastAt: null, burst: 0 }

// `now - history.lastAt` is used everywhere below as a plain `<` comparison, never
// `Math.abs`. That is deliberate: if the system clock moves backwards (or a stored
// timestamp is in the future), the difference goes negative, and a negative number is
// still `< windowMs` — so a skewed clock is treated the same as "this just happened",
// i.e. still inside every window. That keeps the burst cap and the min-interval both
// enforced (never bypassed by winding the clock back), while a dirty tab that was just
// prompted still counts as recently prompted instead of re-prompting immediately.
export function getMultiTabAction(arg: {
    dirty: boolean
    now: number
    history: AutoReloadHistory
    lastPromptAt: number | null
    hasLocalDraft: boolean
}): MultiTabAction {
    const { dirty, now, history, lastPromptAt, hasLocalDraft } = arg
    if (dirty) {
        if (lastPromptAt === null || now - lastPromptAt >= PROMPT_RENOTIFY_MS) {
            return 'prompt'
        }
        return 'stay'
    }
    // Must stay AFTER the `if (dirty)` block above: `dirty && hasLocalDraft` must
    // still fall into the branch above and return 'prompt'/'stay' from there, never
    // from here -- letting a draft suppress the conflict prompt on a revision-aware
    // backend would be a severe regression. This branch is only ever reached when
    // `!dirty`, and it must win over auto-reload regardless of burst/interval state:
    // an unsaved draft living in component-local `$state` (not yet committed to
    // `DBState.db`, so `dirty` never saw it) would otherwise be silently destroyed by
    // `location.reload()`.
    if (hasLocalDraft) {
        return 'stay'
    }
    if (
        history.lastAt !== null &&
        history.burst >= AUTO_RELOAD_MAX_BURST &&
        now - history.lastAt < AUTO_RELOAD_BURST_WINDOW_MS
    ) {
        // Bounds the reload loop: once a tab has auto-reloaded the max number of
        // times within one burst window, it stops auto-reloading no matter how many
        // more save notifications arrive, until the burst window has actually elapsed.
        return 'stay'
    }
    if (history.lastAt !== null && now - history.lastAt < AUTO_RELOAD_MIN_INTERVAL_MS) {
        return 'stay'
    }
    return 'auto-reload'
}

// `saveDb()` consumes the peer-save signal unconditionally before calling
// `getMultiTabAction` (`otherTabSaved = false`, then re-armed only by a fresh
// broadcast). That is correct for every existing 'stay' reason -- but not for a
// 'stay' caused by a local draft: the draft can later be committed with no new
// peer broadcast ever arriving, and `saveDb()`'s `if (otherTabSaved)` guard would
// then simply be skipped forever, letting the loop write the whole (now-dirty) DB
// straight past the conflict prompt at `:741`, silently clobbering the peer's
// committed save.
//
// This function tells the caller whether to put the signal back for the next
// iteration instead of leaving it consumed. It must only do that for the specific
// case that motivates it -- `!dirty && hasLocalDraft` producing 'stay' -- not for
// every 'stay'. In particular the dirty-but-recently-prompted 'stay' (the
// renotify window in the `if (dirty)` branch above) is deliberately left alone: by
// design it only re-prompts on a fresh peer broadcast ("Consumed, never latched",
// see the comment on `getMultiTabAction`'s dirty branch), and widening retention to
// that case here would change that intentional behaviour.
//
// Re-evaluating every ~500ms iteration while retained is cheap and side-effect
// free, since the action stays 'stay' for as long as the draft (or lack of a
// commit) persists.
export function shouldRetainOtherTabSavedSignal(arg: {
    action: MultiTabAction
    dirty: boolean
    hasLocalDraft: boolean
}): boolean {
    return !arg.dirty && arg.hasLocalDraft && arg.action === 'stay'
}

export function nextAutoReloadHistory(history: AutoReloadHistory, now: number): AutoReloadHistory {
    const withinBurstWindow = history.lastAt !== null && now - history.lastAt < AUTO_RELOAD_BURST_WINDOW_MS
    return {
        lastAt: now,
        burst: withinBurstWindow ? history.burst + 1 : 1,
    }
}

export function resolvePromptChoice(raw: string): MultiTabPromptChoice {
    // Anything other than the two recognised answers defaults to 'stay', never to a
    // write or a reload — an unexpected prompt response must not risk data loss.
    if (raw === '0') {
        return 'flush'
    }
    if (raw === '1') {
        return 'reload'
    }
    return 'stay'
}

// On a revision-aware backend (the self-hosted Node server), a peer tab's save
// is exactly what makes THIS tab's known revision stale — the main file's version
// is held by the cell in appStore.ts and is never refreshed from a refused write, so a
// "save mine" choice here is guaranteed to 409 again on write, pre-commit, every
// single time. Offering it would promise something the optimistic-concurrency guard
// exists to prevent. So this predicate exists to gate which prompt shape the caller
// shows: a revision-aware backend only ever gets reload/stay, never a save-mine option.
export function isRevisionAwareBackend(arg: { isNodeServer: boolean }): boolean {
    return arg.isNodeServer
}

export function resolveRevisionAwarePromptChoice(raw: string): RevisionAwarePromptChoice {
    // Only one real action is ever safe here: reload. Anything else -- including an
    // unrecognised answer -- must fall back to 'stay', never to a write, since there
    // is no "save mine" option on this path (see isRevisionAwareBackend above).
    if (raw === '0') {
        return 'reload'
    }
    return 'stay'
}

function isValidHistoryShape(value: unknown): value is AutoReloadHistory {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const record = value as { lastAt?: unknown, burst?: unknown }
    const lastAtValid =
        record.lastAt === null ||
        (typeof record.lastAt === 'number' && Number.isFinite(record.lastAt) && record.lastAt >= 0)
    // `burst` is a counter, so a fractional value is as corrupt as a negative one — it
    // would survive `+ 1` and compare strangely against the cap. Bound it too, so a
    // tampered or truncated value can't park the tab on 'stay' forever.
    const burstValid =
        typeof record.burst === 'number' &&
        Number.isInteger(record.burst) &&
        record.burst >= 0 &&
        record.burst <= AUTO_RELOAD_MAX_BURST * 4
    return lastAtValid && burstValid
}

export function readAutoReloadHistory(storage: Storage | null | undefined): AutoReloadHistory {
    if (!storage) {
        return { ...defaultHistory }
    }
    try {
        const raw = storage.getItem(AUTO_RELOAD_HISTORY_KEY)
        if (!raw) {
            return { ...defaultHistory }
        }
        const parsed: unknown = JSON.parse(raw)
        if (!isValidHistoryShape(parsed)) {
            return { ...defaultHistory }
        }
        return { lastAt: parsed.lastAt, burst: parsed.burst }
    }
    catch {
        // Safari private mode (and a malformed stored value) can throw on access or
        // parse — either way, fall back to the safe default rather than propagate.
        return { ...defaultHistory }
    }
}

// Returns whether the history was actually persisted. That matters: every guard in
// `getMultiTabAction` keys off `history.lastAt`, so if the history cannot survive a
// reload, each fresh page reads `{lastAt: null, burst: 0}` and auto-reloads again —
// an unbounded reload loop, precisely in the environments (Safari private mode,
// sandboxed or storage-disabled contexts) where storage throws. Callers must only
// auto-reload when this returns true; a tab that cannot record that it reloaded must
// not reload at all. Staying on slightly stale data is lossless, since the auto-reload
// branch is only reachable when the tab is clean.
export function writeAutoReloadHistory(storage: Storage | null | undefined, history: AutoReloadHistory): boolean {
    if (!storage) {
        return false
    }
    try {
        const serialized = JSON.stringify(history)
        storage.setItem(AUTO_RELOAD_HISTORY_KEY, serialized)
        // `setItem` not throwing only means the storage accepted the write, not that
        // it will still be there after the reload that's about to happen — e.g. a
        // sandboxed iframe without `allow-same-origin` gets a fresh opaque origin on
        // every navigation, so sessionStorage silently resets instead of persisting.
        // Reading back and comparing closes that gap: a write that doesn't actually
        // stick is treated the same as one that threw, instead of the caller
        // reloading into a reset-to-default history and looping forever.
        return storage.getItem(AUTO_RELOAD_HISTORY_KEY) === serialized
    }
    catch {
        return false
    }
}
