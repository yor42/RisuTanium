// The driver of the active theme pack: one effect observes the active id and Safe Mode, derives the key of what should be
// applied, and starts the apply core only when that key differs from the applied one. An unchanged pack is never re-applied,
// whatever the surface gate, the database object or any other setting does; a superseded run is cancelled and can never commit.
// The driver never writes the database: the status below is its own state, read by the settings row.
import { untrack } from 'svelte'
import { DBState, SafeModeStore } from '../stores.svelte'
import { commitPackSheet, preparePackSheet, resetPackSheetForTests, type ApplySource, type BrokenReason } from './apply'
import { builtinPackById } from './builtins'
import type { IntakeRefusal } from './intake'
import { createJudgeClient } from './judgeClient'
import { listThemePacks } from './packRecord'

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
let applied: { key: ApplyKey; skippedAreas: readonly string[]; empty: boolean } | null = null
let inflight: { key: ApplyKey; generation: number } | null = null
let generation = 0
let started = false
let disposeRoot: (() => void) | null = null
let unsubscribeSafeMode: (() => void) | null = null
const judge = createJudgeClient()

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
 * Prepares one key and commits it. Everything after the single await is one synchronous block: the owner-checked in-flight
 * clear, the currency re-check and the commit, with nothing between them that could let a newer request run first.
 */
async function run(key: ApplyKey, mine: number): Promise<void> {
    const isCurrent = (): boolean => generation === mine
    const source = sourceOf(key)
    let prepared: Prepared
    try {
        prepared = source === null
            ? COULD_NOT_CHECK
            : await preparePackSheet(source, judge, isCurrent)
    } catch {
        prepared = COULD_NOT_CHECK
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
        commitPackSheet(null)
        applied = null
        setStatus({ phase: 'broken', reason: prepared.reason, refusals: prepared.refusals })
        return
    }
    const result = commitPackSheet(prepared.text === null ? null : { text: prepared.text, blobs: prepared.blobs })
    if (!result.ok) {
        commitPackSheet(null)
        applied = null
        setStatus({ phase: 'broken', reason: 'couldNotCheck' })
        return
    }
    applied = { key, skippedAreas: prepared.skippedAreas, empty: prepared.text === null }
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
        generation += 1
        inflight = null
    }
    if (applied !== null && key === applied.key) {
        setStatus({ phase: 'applied', skippedAreas: applied.skippedAreas, empty: applied.empty })
        return
    }
    generation += 1
    if (key === 'none' || key.startsWith('unreadable:')) {
        if (applied !== null) {
            commitPackSheet(null)
        }
        applied = null
        setStatus(key === 'none' ? { phase: 'none' } : { phase: 'broken', reason: 'unreadable' })
        return
    }
    inflight = { key, generation }
    setStatus({ phase: 'pending' })
    void run(key, generation)
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
    disposeRoot = $effect.root(() => {
        $effect(() => {
            const id = DBState.db?.activeThemePack
            const safeMode = safe
            untrack(() => request(id, safeMode))
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
    started = false
    resetPackSheetForTests()
    generation += 1
    inflight = null
    applied = null
    safe = false
    status.activeId = undefined
    setStatus({ phase: 'none' })
}
