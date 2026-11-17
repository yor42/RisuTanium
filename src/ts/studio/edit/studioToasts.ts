// The only place Studio talks to the toast host: one Undo toast per deleted first message, whose action
// goes through the history service's marked write path, and the dismissal of that toast when the delete
// is undone another way. Text comes from the locale at call time; the host is injected so tests run it
// on a fake clock.

import { language } from '../../../lang'
import { toastHost, type ToastHost, type ToastId, type UndoOutcome } from '../../toast/toastHost.svelte'
import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../history/ownerHistory.svelte'
import type { OwnerKey } from '../history/ownerPhase'

export function refusalText(reason: StudioRefusal): string {
    switch (reason) {
        case 'loading': return language.studioRefusalLoading
        case 'not-selected': return language.studioRefusalNotSelected
        case 'duplicate-id': return language.studioRefusalDuplicateId
        case 'duplicate-module-id': return language.studioAssetModuleSharedId
        case 'group':
        case 'restricted': return language.studioRefusalRestricted
        case 'gone': return language.studioRefusalGone
        case 'no-unique-chat': return language.studioRefusalNoUniqueChat
        case 'precondition': return language.studioRefusalPrecondition
        case 'pairSplit': return language.studioRefusalPairSplit
        case 'asset-no-undo': return language.studioAssetRefusalNoUndo
        case 'asset-other-tab-character': return language.studioAssetRefusalOtherTabCharacter
        case 'asset-other-tab-module': return language.studioAssetRefusalOtherTabModule
        // Without the row's name; `refusalTextOf` has it.
        case 'asset-file-unchecked':
        case 'empty':
        case 'unknown': return language.studioRefusalUnknown
    }
}

// The text of a refused result: the refusal's own, and for an unchecked file the line that names the row.
export function refusalTextOf(result: { reason: StudioRefusal; name?: string }): string {
    return result.reason === 'asset-file-unchecked' && result.name !== undefined ? language.studioAssetFileUnchecked(result.name) : refusalText(result.reason)
}

/**
 * Runs a history action on an owner. When it lands, the Undo toast of every deleted item the action consumed
 * ends: a Ctrl+Z, a revert or a History restore that put the item back leaves the toast with nothing to undo.
 * A refused action consumes nothing, so no toast is touched.
 */
export function runDismissingConsumed(
    service: Pick<OwnerHistoryService, 'view'>,
    toasts: Pick<StudioToasts, 'dismissDeleted'>,
    owner: OwnerKey,
    action: () => StudioResult,
): StudioResult {
    const before = service.view(owner).deleted.map((item) => item.id)
    const result = action()
    if (result.ok) {
        const remaining = new Set(service.view(owner).deleted.map((item) => item.id))
        for (const id of before) {
            if (!remaining.has(id)) {
                toasts.dismissDeleted(id)
            }
        }
    }
    return result
}

export interface StudioToastDeps {
    // Read when an Undo runs, so the toast outlives whichever service instance posted it. Null while no
    // service is built; an Undo then reports that history is still loading.
    service: () => Pick<OwnerHistoryService, 'restoreDeleted' | 'view' | 'replay'> | null
    host?: ToastHost
}

export interface StudioToasts {
    // One Undo toast for one deleted item; `deletedId` is the id of the History entry and of the toast action.
    postDeleted(owner: OwnerKey, deletedId: string): ToastId
    // The delete was undone another way (Ctrl+Z or a History restore): its toast no longer offers Undo.
    dismissDeleted(deletedId: string): void
    // One Undo toast for one landed asset step. Its Undo runs only while that step is still on top of the owner's
    // history, and the toast ends as soon as another step lands.
    postAssetAction(owner: OwnerKey, stepId: string, text: string, sub?: string): ToastId
    // Wire this to the service's `onLanded`: ends the asset toasts of `owner` whose step is no longer on top.
    retireAssetToasts(owner: OwnerKey, topStepId: string | null): void
    // One Undo toast whose action is the caller's own `run`; it replays no history, so it needs no service and
    // outlives the component that posted it.
    postUndoAction(text: string, run: () => UndoOutcome | Promise<UndoOutcome>): ToastId
    // Holds the toast stack back until the calling component is destroyed. Call during component initialisation.
    suspendWhileMounted(): void
}

interface AssetToastRecord {
    owner: OwnerKey
    stepId: string
    // The host that shows it, so a landing seen by another instance still ends it.
    host: ToastHost
    // Its own Undo is running: the landing it causes must not end the entry that is showing the outcome.
    running: boolean
}

// Every asset toast on the page, whichever instance posted it: the service's `onLanded` is one function for the page,
// so the registry it retires from is too.
const assetRecords = new Map<string, AssetToastRecord>()

/** Ends the asset toasts of `owner` whose step is no longer on top (`topStepId`); an Undo that is running is left alone. */
export function retireAssetToasts(owner: OwnerKey, topStepId: string | null): void {
    for (const [actionId, record] of [...assetRecords]) {
        if (record.owner === owner && !record.running && record.stepId !== topStepId) {
            assetRecords.delete(actionId)
            record.host.dismissUndo(actionId)
        }
    }
}

// Ids of the caller-run Undo toasts; a counter keeps two toasts of one page from sharing an action id.
let undoActionCounter = 0

export function resetStudioToastsForTests(): void {
    assetRecords.clear()
}

export function createStudioToasts(deps: StudioToastDeps): StudioToasts {
    const host = deps.host ?? toastHost
    return {
        postAssetAction(owner, stepId, text, sub) {
            const actionId = 'asset:' + owner + '\0' + stepId
            const record: AssetToastRecord = { owner, stepId, host, running: false }
            assetRecords.set(actionId, record)
            return host.postUndo({
                text,
                ...(sub === undefined ? {} : { sub }),
                actionLabel: language.studioToastUndo,
                action: {
                    id: actionId,
                    failedText: language.studioAssetUndoFailed,
                    async run(): Promise<UndoOutcome> {
                        const service = deps.service()
                        if (!service) {
                            assetRecords.delete(actionId)
                            return { ok: false, text: refusalText('loading') }
                        }
                        record.running = true
                        let result: StudioResult
                        try {
                            // Undo undoes whatever is on top, so it applies only while this toast's own step is.
                            result = await service.replay(owner, { kind: 'undo', expectTop: stepId })
                        } finally {
                            assetRecords.delete(actionId)
                        }
                        if (result.ok === false) {
                            if (result.targetChanged) {
                                return { ok: false, text: language.studioAssetToastUseHistory, after: 'close' }
                            }
                            return { ok: false, text: refusalTextOf(result) }
                        }
                        if (result.goneRows !== undefined && result.goneRows.length > 0) {
                            return { ok: true, text: language.studioAssetFileGone(result.goneName ?? result.goneRows[0]) }
                        }
                        if (result.already !== undefined) {
                            return { ok: true, text: language.studioHistoryAlreadyUndone }
                        }
                        return { ok: true, text: language.studioAssetUndone }
                    },
                },
            })
        },
        retireAssetToasts,
        postUndoAction(text, run) {
            undoActionCounter += 1
            return host.postUndo({
                text,
                actionLabel: language.studioToastUndo,
                action: { id: 'undo-action:' + undoActionCounter, failedText: language.studioToastRestoreFailed, run },
            })
        },
        postDeleted(owner, deletedId) {
            return host.postUndo({
                text: language.studioToastGreetingDeleted,
                actionLabel: language.studioToastUndo,
                action: {
                    id: deletedId,
                    failedText: language.studioToastRestoreFailed,
                    run(): UndoOutcome {
                        const service = deps.service()
                        const result = service ? service.restoreDeleted(owner, deletedId) : ({ ok: false, reason: 'loading' } as const)
                        if (result.ok === false) {
                            // `after` stays absent: a refused Undo removes the action, and the record stays in History.
                            return { ok: false, text: refusalText(result.reason) }
                        }
                        return {
                            ok: true,
                            text: result.fmNotRestored ? language.studioToastRestoredFmNotice : language.studioToastRestored,
                        }
                    },
                },
            })
        },
        dismissDeleted(deletedId) {
            host.dismissUndo(deletedId)
        },
        suspendWhileMounted() {
            host.suspendWhile(() => true)
        },
    }
}
