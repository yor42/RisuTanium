import { getModelInfo } from '../model/modellist'
import { regenerateNewest, sendMain, type ComposerActionsSource, type GenerationAction, type GenerationRequest } from '../process/composerActions.svelte'
import type { Origin } from '../process/chatOrigin'
import { checkSendPrerequisites, type SendRefusal } from '../process/sendPrerequisites'
import { DBState } from '../stores.svelte'

/** A refused generation: why, where the fix is, and the action Try again runs again. */
export interface SendFailure extends SendRefusal {
    action: GenerationAction
}

// Session-only, in module memory: nothing here reaches a chat, web storage or a backup, so a reload shows no card.
const failures: Record<string, SendFailure> = $state({})

function keyOf(chaId: string, chatId: string): string {
    return `${chaId}::${chatId}`
}

/** The recorded refusal for that chat, or null. Reactive: the card follows it. */
export function failureOf(chaId: string, chatId: string | undefined): SendFailure | null {
    return chatId ? failures[keyOf(chaId, chatId)] ?? null : null
}

/**
 * The composer source of the new chat shell: it refuses a generation that cannot work (no main model, or no key for
 * a provider that needs one) and records why for that chat; a pass clears the chat's entry. The old shell's source
 * does not set `refuseGeneration`, so it keeps throwError, alertError and risuerror.
 */
export function shellGenerationSource(closeMenu: () => void): ComposerActionsSource {
    return {
        closeMenu,
        refuseGeneration: (request: GenerationRequest) => {
            const key = keyOf(request.origin.chaId, request.origin.chatId)
            const refusal = checkSendPrerequisites(DBState.db, getModelInfo)
            if (refusal === null) {
                delete failures[key]
                return false
            }
            failures[key] = { ...refusal, action: request.action }
            return true
        },
    }
}

/** Runs the recorded action again, through the same gate; a pass clears the card. Nothing is sent from the card itself. */
export async function retrySendFailure(origin: Origin): Promise<void> {
    const failure = failureOf(origin.chaId, origin.chatId)
    if (!failure) {
        return
    }
    const source = shellGenerationSource(() => {})
    if (failure.action === 'regenerate') {
        return regenerateNewest(source)
    }
    return sendMain(source, failure.action === 'continue')
}

/** Test-only: forgets every recorded refusal. */
export function resetSendFailuresForTests(): void {
    for (const key of Object.keys(failures)) {
        delete failures[key]
    }
}
