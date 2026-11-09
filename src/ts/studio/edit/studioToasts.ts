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
        case 'group':
        case 'restricted': return language.studioRefusalRestricted
        case 'gone': return language.studioRefusalGone
        case 'no-unique-chat': return language.studioRefusalNoUniqueChat
        case 'precondition': return language.studioRefusalPrecondition
        case 'empty':
        case 'unknown': return language.studioRefusalUnknown
    }
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
    service: () => Pick<OwnerHistoryService, 'restoreDeleted'> | null
    host?: ToastHost
}

export interface StudioToasts {
    // One Undo toast for one deleted item; `deletedId` is the id of the History entry and of the toast action.
    postDeleted(owner: OwnerKey, deletedId: string): ToastId
    // The delete was undone another way (Ctrl+Z or a History restore): its toast no longer offers Undo.
    dismissDeleted(deletedId: string): void
    // Holds the toast stack back until the calling component is destroyed. Call during component initialisation.
    suspendWhileMounted(): void
}

export function createStudioToasts(deps: StudioToastDeps): StudioToasts {
    const host = deps.host ?? toastHost
    return {
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
