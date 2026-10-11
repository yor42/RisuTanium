import { alertError } from "./alert"
import { language } from "src/lang"
import type { character } from "./storage/database.svelte"
import { ModuleRefusal } from "./process/moduleRefusal"
import { withBusy } from "./process/memory/busyActions"

/**
 * How the attempt to import one file ended. The import code decides it; nothing reads alert text.
 * - imported: a character, preset or module was added (`index` is the new character's position, `null` for a preset, a
 *   module, or a character handed back instead of added). `notes` are extra lines for the end message.
 * - declined: the user chose not to go on (the low-level-access prompt or the card password prompt). Nothing is shown
 *   unless the batch names a reason for it.
 * - skipped: the user chose to leave this file out (a duplicate). It is counted, never listed.
 * - refused: the file is not usable; `reason` is shown as text. `summaryOnly` marks a reason that has no message of its
 *   own. `normal` marks a refusal a single-file caller shows at the normal alert level instead of as an error.
 * - failed: an unexpected error; it is shown with its details.
 */
export type ImportOutcome =
    | {kind: 'imported', index: number|null, character?: character, notes?: string[]}
    | {kind: 'declined'}
    | {kind: 'skipped'}
    | {kind: 'refused', reason: string, summaryOnly?: true, normal?: true}
    | {kind: 'failed', error: Error|string}

export type ImportItem = {name: string, run: () => Promise<ImportOutcome>}

export type ImportSummary = {
    imported: number
    skipped: number
    declined: number
    //Files named in the message: refused, failed, and declined when the batch gives a reason for it.
    notImported: number
    notes: string[]
    //The one file's own outcome, when the action had a single file with a message of its own.
    own: ImportOutcome|null
    //The error to show; null when nothing is to be listed.
    message: string|null
}

//The leaf that throws a stop (`ModuleImportStopped`) lives apart from the heavy modules, so it is recognised by name and reason instead of by class.
function stopReasonOf(error:unknown):'declined'|'skipped'|null {
    if(!(error instanceof Error) || error.name !== 'ModuleImportStopped'){
        return null
    }
    const reason = (error as Error & {reason?:unknown}).reason
    return reason === 'declined' || reason === 'skipped' ? reason : null
}

//A refused module is a refusal whichever import it came out of, a stop the user chose is not an error; any other error is a failure.
export function outcomeOfError(error:unknown):ImportOutcome {
    if(error instanceof ModuleRefusal){
        return {kind: 'refused', reason: error.message}
    }
    const stop = stopReasonOf(error)
    if(stop){
        return {kind: stop}
    }
    return {kind: 'failed', error: error instanceof Error ? error : String(error)}
}

export function outcomeReason(outcome:ImportOutcome):string {
    if(outcome.kind === 'refused'){
        return outcome.reason
    }
    if(outcome.kind === 'failed'){
        return outcome.error instanceof Error ? outcome.error.message : outcome.error
    }
    return ''
}

//One file's own message: a refusal as text, a failure with its details.
export function showOutcome(outcome:ImportOutcome) {
    if(outcome.kind === 'refused'){
        alertError(outcome.reason)
    }
    else if(outcome.kind === 'failed'){
        alertError(outcome.error)
    }
}

/**
 * Composes what a finished action shows. Refused and failed files are listed with their reasons; a declined file is
 * listed only when `declinedReason` is given and is silent otherwise; a skipped file is counted and never listed. The
 * notes of imported files follow the list. A single file with a message of its own is shown as that message.
 */
export function summariseImport(items:ImportItem[], outcomes:ImportOutcome[], opts:{declinedReason?:string} = {}):ImportSummary {
    const notes:string[] = []
    const listed:{item:ImportItem, outcome:ImportOutcome}[] = []
    let imported = 0
    let skipped = 0
    let declined = 0
    items.forEach((item, i) => {
        const outcome = outcomes[i]
        if(outcome.kind === 'imported'){
            imported++
            notes.push(...(outcome.notes ?? []))
        }
        else if(outcome.kind === 'skipped'){
            skipped++
        }
        else if(outcome.kind === 'declined'){
            declined++
            if(opts.declinedReason){
                listed.push({item, outcome})
            }
        }
        else{
            listed.push({item, outcome})
        }
    })
    const base = {imported, skipped, declined, notImported: listed.length, notes}
    if(listed.length === 0){
        return {...base, own: null, message: null}
    }
    const only = listed[0].outcome
    if(items.length === 1 && (only.kind === 'failed' || (only.kind === 'refused' && !only.summaryOnly))){
        return {...base, own: only, message: null}
    }
    const details = listed.map(({item, outcome}) =>
        `${item.name}: ${outcome.kind === 'declined' ? opts.declinedReason : outcomeReason(outcome)}`
    ).join('\n')
    const message = language.importFilesNotImported(listed.length, items.length, details)
    return {...base, own: null, message: notes.length > 0 ? `${message}\n${notes.join('\n')}` : message}
}

/**
 * Attempts every item in order, whatever an earlier item's outcome, inside one busy scope, then shows what did not
 * import. It never rejects. When something is to be reported, the last message of the action is one error: the file's
 * own message or the summary. Nothing is shown after it. When nothing is, the alerts of the last file stay as they are.
 * `afterImported` runs after each imported item; its throw is logged and does not stop the batch.
 */
export function runImportBatch(items:ImportItem[], opts:{afterImported?:(outcome:ImportOutcome) => void, declinedReason?:string} = {}):Promise<ImportSummary> {
    return withBusy('import', async () => {
        const outcomes:ImportOutcome[] = []
        for(const item of items){
            let outcome:ImportOutcome
            try {
                outcome = await item.run()
            } catch (error) {
                console.error(error)
                outcome = outcomeOfError(error)
            }
            if(outcome.kind === 'imported' && opts.afterImported){
                try {
                    opts.afterImported(outcome)
                } catch (error) {
                    console.error(error)
                }
            }
            outcomes.push(outcome)
        }
        const summary = summariseImport(items, outcomes, {declinedReason: opts.declinedReason})
        if(summary.own){
            showOutcome(summary.own)
        }
        else if(summary.message){
            alertError(summary.message)
        }
        return summary
    })
}
