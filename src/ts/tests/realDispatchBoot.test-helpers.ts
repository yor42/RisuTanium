/**
 * Registers the real store2 boot dispatch for a `loadData()` test, as `main.ts` registers it before `loadData()` runs.
 * The page keeps whatever store the test injected; the dispatch gets that store kind, a memory store2 backend in place
 * of the one the kind would build, a UI double that records every question, the test key environment and the fake list
 * derivation. A legacy main file in the page store is converted to a store2 profile (the double confirms), an empty
 * store seeds one, and a store the dispatch cannot write boots read-only through the dispatch's own answer.
 *
 * It holds no `vi.mock`: mocks are hoisted per test file, so each file keeps its own header. Every dynamic import
 * resolves in the caller's current module graph, so call it after `vi.resetModules()` and before importing `loadData`.
 */
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import type { Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import type { Store2Backend, Store2WriteResult } from 'src/ts/storage/store2/backend/types'
import type { ListDerivation } from 'src/ts/storage/store2/codec'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import type { SkippedLegacyEntry } from 'src/ts/storage/store2/legacy/lenient'
import { fakeLists } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, createPeerDouble, testEnv } from 'src/ts/storage/tests/store2SaveKit'

/** The boot UI port, recording what the dispatch showed and asked. */
export interface RealDispatchUi extends Store2BootUi {
    notices: Store2BootNotice[]
    blockedWith: { reason: string, detail: string, mayHaveWritten: boolean }[]
    offered: (readonly number[])[]
    flaggedAsked: (readonly FlaggedItem[])[]
    convertAsked: number
    declinedAsked: number
    fromBackupAsked: number
    incompleteAsked: number
    /** The entries each "convert without these" question named. */
    skippedAsked: (readonly SkippedLegacyEntry[])[]
    recoveries: number
}

export interface RealDispatchOptions {
    /** The store kind the dispatch is told; it must be the kind the test injected into the app store. */
    kind: AppStoreKind
    /** Run first inside the registered dispatch function, before the dispatch is entered. */
    onEnter?: () => void
    /** The memory backend the dispatch opens; absent, an empty one. */
    backend?: MemoryBackend
    /** False leaves the backend to the store kind, so the dispatch's own capability facts decide (a read-only page); true by default. */
    injectBackend?: boolean
    /** Dismiss every `normal` alert that is still on screen one microtask after it was written, so a notice the boot awaits does not stall it; the mocked `alertStore` of the caller's graph is used. */
    acknowledgeAlerts?: boolean
    /** The answer to the conversion confirmation; true by default. */
    convertAnswer?: boolean
    /** The answer to the question that names the legacy entries a lenient conversion would leave out; `decline` by default. */
    convertWithoutAnswer?: 'convert' | 'decline'
    /** The answer to a flagged-leaf question; `continue` by default. */
    flaggedAnswer?: 'continue' | 'decline' | 'earlier'
    lists?: ListDerivation
}

export interface RealDispatchHandle {
    backend: MemoryBackend
    ui: RealDispatchUi
    /**
     * The `normal` alerts this acknowledger dismissed, in order, recorded when it dismissed them (not when they were
     * written); filled only when `acknowledgeAlerts` is true. A notice a cover replaced before the dismissal is not in
     * it, so it cannot prove that no notice was written: read a write-time record of the alert store for that.
     */
    shownAlerts: string[]
}

function recordingUi(options: RealDispatchOptions): RealDispatchUi {
    const ui: RealDispatchUi = {
        notices: [],
        blockedWith: [],
        offered: [],
        flaggedAsked: [],
        convertAsked: 0,
        declinedAsked: 0,
        fromBackupAsked: 0,
        incompleteAsked: 0,
        skippedAsked: [],
        recoveries: 0,
        peer: createPeerDouble(),
        notice(notice) { ui.notices.push(notice) },
        async blocked(blocked) { ui.blockedWith.push(blocked) },
        async offerRestoreOrImport(backups) { ui.offered.push(backups); return 'import' },
        async confirmConvert() {
            ui.convertAsked += 1
            return options.convertAnswer ?? true
        },
        async declined() {
            ui.declinedAsked += 1
            return 'import'
        },
        async confirmConvertWithout(skipped) {
            ui.skippedAsked.push(skipped)
            return options.convertWithoutAnswer ?? 'decline'
        },
        async confirmFromBackup() {
            ui.fromBackupAsked += 1
            return 'convert'
        },
        async confirmIncomplete() {
            ui.incompleteAsked += 1
            return true
        },
        async confirmFlaggedOpen(items) {
            ui.flaggedAsked.push(items)
            return options.flaggedAnswer ?? 'continue'
        },
        async foreignMarker() { return 'wait' },
        async recovery() { ui.recoveries += 1 },
    }
    return ui
}

/**
 * The memory backend reports no flush, so a Tauri page's boot would raise `flush-unconfirmed` for every write. The
 * native Tauri backend reports a confirmed flush for a durable write; this wrapper does the same, so a test that is not
 * about the flush sees the notices a healthy native page sees. Reads and the stored bytes are the memory backend's own.
 */
function confirmingFlush(backend: Store2Backend): Store2Backend {
    const confirmed = async (written: Promise<Store2WriteResult>): Promise<Store2WriteResult> => ({ ...await written, flushed: true })
    return {
        ...backend,
        casCommit: (expected, next) => confirmed(backend.casCommit(expected, next)),
        casFence: (expected, next) => confirmed(backend.casFence(expected, next)),
        commitOrdinary: (expectedCommit, units, nextCommit) => confirmed(backend.commitOrdinary(expectedCommit, units, nextCommit)),
        putUnit: (key, bytes) => confirmed(backend.putUnit(key, bytes)),
        removeBatch: (keys, expectedCommit, expectedFence) => confirmed(backend.removeBatch(keys, expectedCommit, expectedFence)),
    }
}

let stopAcknowledging: (() => void) | null = null

/**
 * Ends the acknowledgement of the last registration. A test file whose mocked `stores.svelte` outlives `vi.resetModules()`
 * calls it after each test, so a later test does not have its own notices dismissed.
 */
export function stopAcknowledgingAlerts(): void {
    stopAcknowledging?.()
    stopAcknowledging = null
}

/** Registers the real dispatch with `registerStore2Boot` in the caller's module graph. */
export async function registerRealDispatch(options: RealDispatchOptions): Promise<RealDispatchHandle> {
    const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
    const { dispatchStore2Boot } = await import('src/ts/storage/store2/bootDispatch')
    const backend = options.backend ?? createMemoryBackend()
    const ui = recordingUi(options)
    const shownAlerts: string[] = []
    stopAcknowledgingAlerts()
    if (options.acknowledgeAlerts === true) {
        // The boot awaits some notices it posts (the storage-fallback notice) and queues others; this stands in for
        // the person pressing OK. It presses OK only on a notice still on screen at the microtask, so a notice a
        // consent or another alert has covered since is not acknowledged, and it records the text at that moment.
        const { alertStore } = await import('src/ts/stores.svelte')
        let onScreen: object | null = null
        stopAcknowledging = alertStore.subscribe((value) => {
            onScreen = value
            if (value.type === 'normal') {
                queueMicrotask(() => {
                    if (onScreen !== value) {
                        return
                    }
                    shownAlerts.push(value.msg)
                    alertStore.set({ type: 'none', msg: '' })
                })
            }
        })
    }
    registerStore2Boot((env) => {
        options.onEnter?.()
        return dispatchStore2Boot(env, {
            ui,
            kind: options.kind,
            backend: options.injectBackend === false ? undefined : async () => (options.kind === 'tauri' ? confirmingFlush(backend) : backend),
            keyEnv: testEnv(createClock(), 9001),
            lists: options.lists ?? fakeLists,
        })
    })
    return { backend, ui, shownAlerts }
}
