// The driver of the active theme pack: one effect observes the active id and Safe Mode, derives the key of what should be
// applied, and starts the apply core only when that key differs from the applied one. An unchanged pack is never re-applied,
// whatever the surface gate, the database object or any other setting does; a superseded run is cancelled and can never commit.
// The driver writes the database only through `dropPackSchemeCopy`, `enterPackScheme` and `leavePackScheme`: when the
// user's turn-on, install or update is requested, for that request's outcome, or for a tile click. Boot, the live lookup and
// every repaint write nothing. The status below is its own state, read by the settings row.
import { untrack } from 'svelte'
import { isLite } from '../lite'
import { DBState, SafeModeStore } from '../stores.svelte'
import {
    dropPackSchemeCopy, enterPackScheme, leavePackScheme, PACK_SCHEME_NAME, setPackSchemeProvider, updateColorScheme, updateTextThemeAndCSS,
    type ColorScheme,
} from '../gui/colorscheme'
import { commitPackSheet, preparePackSheet, resetPackSheetForTests, setPackSheetColours, type ApplySource, type BrokenReason } from './apply'
import { builtinPackById } from './builtins'
import type { IntakeRefusal } from './intake'
import { openJudgeSession, type JudgeSession } from './judgeClient'
import { sameScheme } from './packColours'
import { listThemePacks } from './packRecord'
import { ownColours } from './ownColours.svelte'
import { packSafe } from './packSafeFlag.svelte'
import { registerPackRequestCanceller } from './turnOff'

export interface ThemePackApplyState {
    activeId: string | undefined
    phase: 'none' | 'pending' | 'applied' | 'broken'
    reason?: BrokenReason
    refusals?: readonly IntakeRefusal[]
    skippedAreas?: readonly string[]
    empty?: boolean
}

export type ApplyKey = 'none' | `builtin:${string}` | `archive:${string}` | `unreadable:${string}`

type Prepared = Awaited<ReturnType<typeof preparePackSheet>>
const COULD_NOT_CHECK: Prepared = { ok: false, reason: 'couldNotCheck' }

const ARCHIVE_KEY_PREFIX = 'archive:'

const status: ThemePackApplyState = $state({ activeId: undefined, phase: 'none' })
let safe = $state(false)
let lite = $state(false)
// The applied pack's default scheme: set on a successful commit, null on none, broken, unreadable and reset. The live
// lookup in `effectiveColorScheme` and the picker tile read it.
let appliedDefault = $state.raw<ColorScheme | null>(null)
let applied: { key: ApplyKey; skippedAreas: readonly string[]; empty: boolean; defaultScheme: ColorScheme | null } | null = null
// A user turn-on or update waiting for the apply outcome. `name` and `scheme` are what the scheme was when it was made, so
// a pick or edit in between wins. `displaced` is the stored copy the request dropped (null in pack safe mode). In memory only.
let schemeRequest: { id: string; kind: 'turnOn' | 'update'; name: unknown; scheme: ColorScheme | null; displaced: ColorScheme | null } | null = null
let unsubscribeLite: (() => void) | null = null
let inflight: { key: ApplyKey; generation: number; session: JudgeSession } | null = null
let generation = 0
let started = false
let disposeRoot: (() => void) | null = null
let unsubscribeSafeMode: (() => void) | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The key the driver compares: what should be applied now, from the active id, Safe Mode and the stored record list. */
export function applyKeyOf(activeId: unknown, safeMode: boolean, themePacks: unknown): ApplyKey {
    if (safeMode || typeof activeId !== 'string' || activeId === '') {
        return 'none'
    }
    if (activeId.startsWith('builtin:')) {
        const pack = builtinPackById(activeId)
        return pack === null ? 'none' : `builtin:${pack.slug}`
    }
    let unreadable = false
    for (const { entry, read } of listThemePacks(themePacks)) {
        if (!isRecord(entry) || entry.id !== activeId) {
            continue
        }
        if (read.ok) {
            return `${ARCHIVE_KEY_PREFIX}${read.record.archive}`
        }
        unreadable = true
    }
    return unreadable ? `unreadable:${activeId}` : 'none'
}

function sourceOf(key: ApplyKey): ApplySource | null {
    if (key.startsWith('builtin:')) {
        const pack = builtinPackById(key)
        return pack === null ? null : { kind: 'builtin', pack }
    }
    if (key.startsWith(ARCHIVE_KEY_PREFIX)) {
        return { kind: 'archive', key: key.slice(ARCHIVE_KEY_PREFIX.length) }
    }
    return null
}

/** Every call writes every status field except `activeId`, so no path leaves an older reason, refusal list or skipped list behind. */
function setStatus(next: Pick<ThemePackApplyState, 'phase' | 'reason' | 'refusals' | 'skippedAreas' | 'empty'>): void {
    status.phase = next.phase
    status.reason = next.reason
    status.refusals = next.refusals
    status.skippedAreas = next.skippedAreas
    status.empty = next.empty
}

function revoke(urls: readonly string[]): void {
    for (const url of urls) {
        URL.revokeObjectURL(url)
    }
}

/**
 * Records that the user turned the pack `id` on (`turnOn`) or replaced it by an update (`update`); a later call replaces it.
 * The stored copy is dropped before the capture. Outside pack safe mode the request keeps the dropped colours in memory: they
 * paint only while it waits and no pack is live, and return to storage only when an update fails.
 */
export function requestPackScheme(id: string, kind: 'turnOn' | 'update'): void {
    const dropped = dropPackSchemeCopy()
    const stored = DBState.db?.colorScheme
    schemeRequest = {
        id,
        kind,
        name: DBState.db?.colorSchemeName,
        scheme: stored ? safeStructuredClone(stored) : null,
        displaced: packSafe.on ? null : dropped,
    }
}

export function cancelPackSchemeRequest(): void {
    schemeRequest = null
}

/** Test seam. */
export function pendingPackSchemeRequestForTests(): Readonly<NonNullable<typeof schemeRequest>> | null {
    return schemeRequest
}

/** Colour mode: the pack has a default, lite is off and the user follows the pack scheme. */
function coloursOn(): boolean {
    return appliedDefault !== null && !lite && DBState.db?.colorSchemeName === PACK_SCHEME_NAME
}

/** Repaints the live default (or the stored copy) when the pack scheme is the name. Writes no database field. */
function repaintPackScheme(): void {
    if (DBState.db?.colorSchemeName !== PACK_SCHEME_NAME) {
        return
    }
    try {
        updateColorScheme()
        updateTextThemeAndCSS()
    } catch { }
}

/**
 * Honours the pending request for `activeId`, if any. `outcome` is the pack's default scheme, null for a pack without one,
 * or `broken`. The capture check comes first: a pick or edit made while the turn-on was pending wins, whatever the outcome.
 * A request for another id is left alone.
 */
function consumeSchemeRequest(activeId: string | undefined, outcome: ColorScheme | null | 'broken'): boolean {
    const pending = schemeRequest
    if (pending === null || pending.id !== activeId) {
        return false
    }
    schemeRequest = null
    const db = DBState.db
    const sameCaptured = pending.scheme === null ? !db.colorScheme : sameScheme(db.colorScheme, pending.scheme)
    if (db.colorSchemeName !== pending.name || !sameCaptured) {
        return false
    }
    try {
        if (outcome === 'broken') {
            if (pending.kind === 'turnOn') {
                leavePackScheme()
            } else if (pending.displaced !== null) {
                enterPackScheme(pending.displaced)
            }
            return false
        }
        if (pending.kind === 'update' && db.colorSchemeName !== PACK_SCHEME_NAME) {
            return false
        }
        if (outcome !== null) {
            enterPackScheme(outcome)
            return pending.kind === 'turnOn'
        }
        leavePackScheme()
    } catch { }
    return false
}

/** The tile's palette source: the applied pack's default scheme, or null. */
export function activePackDefaultScheme(): ColorScheme | null {
    return appliedDefault
}

/**
 * The tile click: enters the applied pack's scheme. Nothing happens when no pack with a default is applied. While a switch is
 * pending the applied pack is the one being left, so its colours are painted but not stored.
 */
export function adoptActivePackScheme(): void {
    const scheme = appliedDefault
    if (scheme !== null) {
        enterPackScheme(scheme)
        if (status.phase === 'pending') {
            dropPackSchemeCopy()
        }
    }
}

/**
 * Prepares one key and commits it. One judge session serves the whole preparation and is closed when it settles; a newer
 * request closes it earlier. Everything after the single await is one synchronous block: the owner-checked in-flight
 * clear, the currency re-check and the commit, with nothing between them that could let a newer request run first.
 */
async function run(key: ApplyKey, mine: number, session: JudgeSession): Promise<void> {
    const isCurrent = (): boolean => generation === mine
    const source = sourceOf(key)
    let prepared: Prepared
    try {
        prepared = source === null
            ? COULD_NOT_CHECK
            : await preparePackSheet(source, session, isCurrent)
    } catch {
        prepared = COULD_NOT_CHECK
    } finally {
        session.close()
    }
    if (inflight?.generation === mine) {
        inflight = null
    }
    if (!isCurrent()) {
        if (prepared.ok) {
            revoke(prepared.blobs)
        }
        return
    }
    if ('stale' in prepared) {
        return
    }
    if (prepared.ok === false) {
        ownColours.verdict = false
        consumeSchemeRequest(status.activeId, 'broken')
        appliedDefault = null
        commitPackSheet(null)
        applied = null
        setStatus({ phase: 'broken', reason: prepared.reason, refusals: prepared.refusals })
        repaintPackScheme()
        return
    }
    // Written before any repaint of this block, so the paint that follows sees this pack's verdict.
    ownColours.verdict = prepared.ownColourTrigger === true
    const enteredByTurnOn = consumeSchemeRequest(status.activeId, prepared.defaultScheme)
    appliedDefault = prepared.defaultScheme
    const result = commitPackSheet({ elements: prepared.elements, popups: prepared.popups, blobs: prepared.blobs, colours: coloursOn() })
    if (!result.ok) {
        // A turn-on whose sheet could not be committed is a broken turn-on: the scheme it just entered is left again.
        if (enteredByTurnOn) {
            try {
                leavePackScheme()
            } catch { }
        }
        ownColours.verdict = false
        appliedDefault = null
        commitPackSheet(null)
        applied = null
        setStatus({ phase: 'broken', reason: 'couldNotCheck' })
        repaintPackScheme()
        return
    }
    applied = { key, skippedAreas: prepared.skippedAreas, empty: prepared.elements.every((element) => element.text === null), defaultScheme: prepared.defaultScheme }
    repaintPackScheme()
    setStatus({ phase: 'applied', skippedAreas: applied.skippedAreas, empty: applied.empty })
}

/** A request for any key but the in-flight one cancels the in-flight run first; the applied key then needs no work. */
function request(id: unknown, safeMode: boolean): void {
    status.activeId = typeof id === 'string' ? id : undefined
    const key = applyKeyOf(id, safeMode, DBState.db?.themePacks)
    if (inflight !== null && key === inflight.key) {
        return
    }
    if (inflight !== null) {
        inflight.session.close()
        generation += 1
        inflight = null
    }
    if (applied !== null && key === applied.key) {
        consumeSchemeRequest(status.activeId, applied.defaultScheme)
        setPackSheetColours(coloursOn())
        setStatus({ phase: 'applied', skippedAreas: applied.skippedAreas, empty: applied.empty })
        repaintPackScheme()
        return
    }
    generation += 1
    if (key === 'none' || key.startsWith('unreadable:')) {
        ownColours.verdict = false
        if (key === 'none') {
            // Safe Mode, or an id that names no record, is never a user turn-off.
            schemeRequest = null
        } else {
            consumeSchemeRequest(status.activeId, 'broken')
        }
        if (applied !== null) {
            commitPackSheet(null)
        }
        applied = null
        appliedDefault = null
        setStatus(key === 'none' ? { phase: 'none' } : { phase: 'broken', reason: 'unreadable' })
        repaintPackScheme()
        return
    }
    const session = openJudgeSession()
    inflight = { key, generation, session }
    setStatus({ phase: 'pending' })
    void run(key, generation, session)
}

/** Installs the driver once per page; later calls do nothing. */
export function startThemePackApply(): void {
    if (started) {
        return
    }
    started = true
    unsubscribeSafeMode = SafeModeStore.subscribe((value) => {
        safe = value
    })
    unsubscribeLite = isLite.subscribe((value) => {
        lite = value
    })
    setPackSchemeProvider(() => appliedDefault ?? schemeRequest?.displaced ?? null)
    registerPackRequestCanceller(cancelPackSchemeRequest)
    disposeRoot = $effect.root(() => {
        $effect(() => {
            const id = DBState.db?.activeThemePack
            const safeMode = safe
            // Read outside `untrack`: entering or leaving pack safe mode while a sheet is committed must re-run the driver.
            const packSafeOn = packSafe.on
            untrack(() => request(id, safeMode || packSafeOn))
        })
        // The user's later pick, a tile click or lite decides the mode live. This writes nothing.
        $effect(() => {
            void DBState.db?.colorSchemeName
            void lite
            untrack(() => {
                if (applied !== null) {
                    setPackSheetColours(coloursOn())
                }
            })
        })
    })
}

/** The live status. Nothing outside this module writes it. */
export function themePackApplyState(): Readonly<ThemePackApplyState> {
    return status
}

/** Test seam. The generation is bumped, never zeroed, so a run left from an earlier test stays stale for good. */
export function resetThemePackApplyForTests(): void {
    disposeRoot?.()
    disposeRoot = null
    unsubscribeSafeMode?.()
    unsubscribeSafeMode = null
    unsubscribeLite?.()
    unsubscribeLite = null
    setPackSchemeProvider(null)
    registerPackRequestCanceller(null)
    started = false
    resetPackSheetForTests()
    generation += 1
    inflight?.session.close()
    inflight = null
    applied = null
    appliedDefault = null
    schemeRequest = null
    ownColours.verdict = false
    safe = false
    lite = false
    status.activeId = undefined
    setStatus({ phase: 'none' })
}
