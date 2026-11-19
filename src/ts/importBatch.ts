import { get } from "svelte/store"
import { alertClear, alertError } from "./alert"
import { language } from "src/lang"
import type { character } from "./storage/database.svelte"
import { ModuleRefusal } from "./process/moduleRefusal"
import { ModuleImportStopped } from "./process/moduleImportStop"
import { withBusy, type BusyHandle } from "./process/memory/busyActions"
import { alertTask, type TaskCloseAnswer, type TaskHandle } from "./alertTask.svelte"
import type { TaskFailure, TaskResult, TaskSkip, TaskStepDef } from "../lib/Nexus/pattern/taskProgress"
import { ImportCancelled, NO_IMPORT_PROGRESS, makeImportProgress, type ImportProgress, type ImportStep } from "./importProgress"
import { restoreInProgress } from "./drive/restoreInProgress"

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

/** `run` receives the file's progress; an item that reports nothing ignores it. */
export type ImportItem = {name: string, run: (progress: ImportProgress) => Promise<ImportOutcome>}

/** The card a batch opens: its title, the steps its files go through, and an optional subtitle (a single file's name by default). */
export type ImportTaskSpec = {title: string, steps: readonly ImportStep[], subtitle?: string}

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
    //True when the last round ended on a Cancel before its first write: nothing of that round was changed.
    cancelled?: true
}

//A refused module is a refusal whichever import it came out of, a stop the user chose is not an error; any other error is a failure.
export function outcomeOfError(error:unknown):ImportOutcome {
    if(error instanceof ModuleRefusal){
        return {kind: 'refused', reason: error.message}
    }
    if(error instanceof ModuleImportStopped){
        return {kind: error.reason}
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

type TaskComposition =
    | {kind: 'finish', result: TaskResult}
    | {kind: 'fail', failure: TaskFailure}
    | {kind: 'close'}

/**
 * What the result card of one round shows. `markers[i]` is true when item i reached its library write: such a file is
 * never offered Retry and its failure leaves the data state unknown. A single declined or skipped file closes the card
 * silently. In a batch, refused and failed files are listed with their reasons (a declined file only when
 * `declinedReason` is given, a skipped one is counted); done-with-skips when something imported, a failure otherwise.
 * Retry covers exactly the failed items without a marker.
 */
export function composeImportResult(items:ImportItem[], outcomes:ImportOutcome[], markers:boolean[], opts:{declinedReason?:string} = {}):TaskComposition {
    const retryable = outcomes.filter((outcome, i) => outcome.kind === 'failed' && !markers[i]).length
    const actions = retryable > 0 ? [{id: 'retry', label: language.importTaskRetryFailed(retryable)}] : undefined
    const unknown = outcomes.some((outcome, i) => outcome.kind === 'failed' && markers[i])
    const notes:string[] = []
    const listed:TaskSkip[] = []
    let imported = 0
    let skipped = 0
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
            if(opts.declinedReason){
                listed.push({name: item.name, reason: opts.declinedReason})
            }
        }
        else{
            listed.push({name: item.name, reason: outcomeReason(outcome)})
        }
    })
    if(items.length === 1){
        const outcome = outcomes[0]
        if(outcome.kind === 'imported'){
            return {kind: 'finish', result: {headline: language.importTaskImported(1), ...(notes.length > 0 ? {summary: notes} : {})}}
        }
        if(outcome.kind === 'declined' || outcome.kind === 'skipped'){
            return {kind: 'close'}
        }
        return {kind: 'fail', failure: {
            headline: language.importTaskFailedOne(items[0].name),
            dataState: unknown ? 'unknown' : 'same',
            detail: outcomeReason(outcome),
            ...(actions ? {actions} : {}),
        }}
    }
    if(listed.length === 0){
        const summary = [...(skipped > 0 ? [language.importTaskDuplicatesLeftOut(skipped)] : []), ...notes]
        return {kind: 'finish', result: {headline: language.importTaskImported(imported), ...(summary.length > 0 ? {summary} : {})}}
    }
    if(imported > 0){
        const summary = [...(skipped > 0 ? [language.importTaskDuplicatesLeftOut(skipped)] : []), ...notes]
        return {kind: 'finish', result: {
            headline: language.importTaskImported(imported),
            ...(summary.length > 0 ? {summary} : {}),
            skipped: listed,
            ...(actions ? {actions} : {}),
        }}
    }
    return {kind: 'fail', failure: {
        headline: language.importTaskNothingImported,
        dataState: unknown ? 'unknown' : 'same',
        skipped: listed,
        ...(actions ? {actions} : {}),
    }}
}

const STEP_MARK = {read: 'scanning', check: 'scanning', assets: 'transfer_in', add: 'transfer_in'} as const

function stepLabel(step:ImportStep):string {
    switch(step){
        case 'read': return language.importStepRead
        case 'check': return language.importStepCheck
        case 'assets': return language.importStepAssets
        case 'add': return language.importStepAdd
    }
}

function stepDefs(steps:readonly ImportStep[]):TaskStepDef[] {
    return steps.map((step) => ({label: stepLabel(step), mark: STEP_MARK[step]}))
}

/**
 * A migrated flow leaves no legacy wait or progress behind, but a callee that is not migrated yet may. Left on screen it
 * would keep the result card yielded, so it is cleared before the result is posted. Anything else (a notice) stays. The
 * probe never throws: a failing probe must not keep the result from posting.
 */
async function clearStaleLegacyProgress():Promise<void> {
    try {
        const {alertStore} = await import("./stores.svelte")
        const type = get(alertStore).type
        if(type === 'wait' || type === 'progress'){
            alertClear()
        }
    } catch (error) {
        console.error(error)
    }
}

type RoundEntry = {item:ImportItem}

type RoundEnd = {
    summary:ImportSummary
    closed:Promise<TaskCloseAnswer>
    retry:RoundEntry[]
}

/**
 * One round: opens the card, runs the entries in order and posts the result inside the caller's busy scope. It returns
 * the promise of the answer, not the answer, so the wait for it stays outside that scope.
 */
async function runRound(entries:RoundEntry[], number:number, task:ImportTaskSpec, opts:ImportBatchOptions):Promise<RoundEnd> {
    const count = entries.length
    const abort = new AbortController()
    const handle:TaskHandle = alertTask({
        title: task.title,
        subtitle: task.subtitle ?? (count === 1 ? entries[0].item.name : undefined),
        steps: stepDefs(task.steps),
        onCancel: () => abort.abort(),
    })
    const gate = {locked: false}
    const items:ImportItem[] = []
    const outcomes:ImportOutcome[] = []
    const markers:boolean[] = []
    let anyCommitted = false
    let cancelled = false
    for(let i = 0; i < count; i++){
        //A cancel that was accepted means no write passed the gate, so a marker here is a flow that lacks its gate.
        if(handle.cancelRequested && !anyCommitted){
            cancelled = true
            break
        }
        const {item} = entries[i]
        if(count > 1){
            handle.setFile(i, count, item.name)
        }
        let marker = false
        const notices:string[] = []
        const progress = makeImportProgress({
            signal: abort.signal,
            steps: task.steps,
            gate,
            round: {number, index: i, count},
            lock: () => handle.lockCancel(),
            setStep: (index) => handle.setStep(index),
            bytes: handle.setBytes,
            count: handle.setCount,
            found: () => { },
            onCommitted: () => {
                marker = true
                anyCommitted = true
            },
            onNotice: (text) => { notices.push(text) },
        })
        let outcome:ImportOutcome
        try {
            outcome = await item.run(progress)
        } catch (error) {
            if(!(error instanceof ImportCancelled)){
                console.error(error)
            }
            outcome = outcomeOfError(error)
        }
        if(handle.cancelRequested){
            if(!anyCommitted){
                cancelled = true
                break
            }
            console.error('A cancel was accepted in a round that already wrote; the true result is shown.')
        }
        if(outcome.kind === 'imported'){
            if(notices.length > 0){
                outcome = {...outcome, notes: [...(outcome.notes ?? []), ...notices]}
            }
            if(opts.afterImported){
                try {
                    opts.afterImported(outcome)
                } catch (error) {
                    console.error(error)
                }
            }
        }
        items.push(item)
        outcomes.push(outcome)
        markers.push(marker)
    }
    await clearStaleLegacyProgress()
    const summary = summariseImport(items, outcomes, {declinedReason: opts.declinedReason})
    if(cancelled){
        return {summary: {...summary, cancelled: true}, closed: handle.settleCancel(), retry: []}
    }
    const retry = items.filter((_, i) => outcomes[i].kind === 'failed' && !markers[i]).map((item) => ({item}))
    const composed = composeImportResult(items, outcomes, markers, {declinedReason: opts.declinedReason})
    let closed:Promise<TaskCloseAnswer>
    if(composed.kind === 'finish'){
        closed = handle.finish(composed.result)
    }
    else if(composed.kind === 'fail'){
        closed = handle.fail(composed.failure)
    }
    else{
        handle.close()
        closed = Promise.resolve({kind: 'closed'})
    }
    return {summary, closed, retry}
}

type ImportBatchOptions = {afterImported?:(outcome:ImportOutcome) => void, declinedReason?:string, task?:ImportTaskSpec, outerBusy?:BusyHandle}

/**
 * The batch on a task card: each round runs inside its own busy scope and ends with its result posted; the answer is
 * awaited after the scope has ended, so an unanswered card never holds the busy entry (and with it the Android
 * keep-alive). Retry starts a new round over the failed files that never reached their write. A replaced or closed card
 * ends the action silently.
 */
async function runTaskBatch(items:ImportItem[], opts:ImportBatchOptions, task:ImportTaskSpec):Promise<ImportSummary> {
    let entries:RoundEntry[] = items.map((item) => ({item}))
    let number = 0
    for(;;){
        const current = entries
        let round:RoundEnd
        try {
            round = await withBusy('import', () => runRound(current, number, task, opts))
        } finally {
            //The caller's own scope for work before the card ends with the first result.
            opts.outerBusy?.end()
        }
        const answer = await round.closed
        //A restore that began while the result waited ends the action: no import round follows it.
        if(answer.kind === 'action' && answer.id === 'retry' && round.retry.length > 0 && !restoreInProgress()){
            entries = round.retry
            number++
            continue
        }
        return round.summary
    }
}

/**
 * Attempts every item in order, whatever an earlier item's outcome, inside one busy scope, then shows what did not
 * import. It never rejects. When something is to be reported, the last message of the action is one error: the file's
 * own message or the summary. Nothing is shown after it. When nothing is, the alerts of the last file stay as they are.
 * `afterImported` runs after each imported item; its throw is logged and does not stop the batch.
 *
 * With `task`, the action runs on a task card instead (see `runTaskBatch`): Cancel before the round's first write,
 * Retry for the failed files, and one result card; the legacy end message is not shown.
 */
export function runImportBatch(items:ImportItem[], opts:ImportBatchOptions = {}):Promise<ImportSummary> {
    if(opts.task){
        return runTaskBatch(items, opts, opts.task)
    }
    return withBusy('import', async () => {
        const outcomes:ImportOutcome[] = []
        for(const item of items){
            let outcome:ImportOutcome
            try {
                outcome = await item.run(NO_IMPORT_PROGRESS)
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
