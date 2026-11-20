import { get } from "svelte/store"
import { alertClear, alertError } from "./alert"
import { language } from "src/lang"
import type { character } from "./storage/database.svelte"
import { ModuleRefusal } from "./process/moduleRefusal"
import { ModuleImportStopped } from "./process/moduleImportStop"
import { withBusy, type BusyHandle } from "./process/memory/busyActions"
import { alertTask, registerDetachedModulesRound, trackTaskAction, type TaskCloseAnswer, type TaskHandle } from "./alertTask.svelte"
import { taskMiB, type TaskConfirm, type TaskFailure, type TaskResult, type TaskResultAction, type TaskSkip, type TaskStepDef } from "../lib/Nexus/pattern/taskProgress"
import { ImportCancelled, makeImportProgress, type ImportProgress, type ImportStep } from "./importProgress"
import { restoreInProgress } from "./drive/restoreInProgress"
import { createUndoRecord, recordCreated, reportUndo, undoImport, undoOffered, type ImportUndoRecord } from "./importUndo"

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

/**
 * `run` receives the file's progress; an item that reports nothing ignores it. `size` is the bytes known without reading
 * the item (a picked file's size); an item whose size is not known leaves it unset.
 */
export type ImportItem = {name: string, run: (progress: ImportProgress) => Promise<ImportOutcome>, size?: number}

/**
 * The card a batch opens: its title, the steps its files go through, and an optional subtitle (a single file's name by
 * default). `background` lets the running card offer "Keep going in the background"; `backgroundHeld` withholds that offer
 * until a file reports its last duplicate decision (see `ImportBatchOptions.mayReplace`).
 */
export type ImportTaskSpec = {title: string, steps: readonly ImportStep[], subtitle?: string, background?: true, backgroundHeld?: true}

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
    //True when the preflight ended without a confirm (declined, replaced, closed or a restore began): nothing was run.
    notStarted?: true
    //True when any round of the action was sent to the background; a caller then does not move the user when it ends.
    backgrounded?: true
    //True when the action's Undo was pressed and removed what the action created; a caller then has nothing to open.
    undone?: true
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
    const noteSet = new Set<string>()
    const listed:TaskSkip[] = []
    let imported = 0
    let skipped = 0
    items.forEach((item, i) => {
        const outcome = outcomes[i]
        if(outcome.kind === 'imported'){
            imported++
            for(const note of outcome.notes ?? []){
                noteSet.add(note)
            }
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
    //A note shared by several items, such as the generic success line, is shown once; distinct notes keep their order.
    const notes = [...noteSet]
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

//A preflight asks only before a batch: one file is its own confirmation.
const PREFLIGHT_MIN_FILES = 2

/**
 * What the preflight sheet says before anything runs: the file count and, when every item's size is known, the exact
 * total. A missing or invalid size drops the size line; it is never counted as zero. Null when no sheet is due.
 */
export function composeImportPreflight(items:ImportItem[]):TaskConfirm|null {
    if(items.length < PREFLIGHT_MIN_FILES){
        return null
    }
    const consequences:string[] = []
    const sizes = items.map((item) => item.size)
    if(sizes.every((size) => size !== undefined && Number.isFinite(size) && size >= 0)){
        const total = sizes.reduce((sum:number, size) => sum + (size ?? 0), 0)
        consequences.push(language.importPreflightSize(taskMiB(total)))
    }
    consequences.push(language.importPreflightAdds)
    return {
        headline: language.importPreflightHeadline(items.length),
        consequences,
        cancelLabel: language.cancel,
        primaryLabel: language.importPreflightStart,
    }
}

const STEP_MARK = {download: 'transfer_in', read: 'scanning', check: 'scanning', assets: 'transfer_in', add: 'transfer_in'} as const

function stepLabel(step:ImportStep):string {
    switch(step){
        case 'download': return language.importStepDownload
        case 'read': return language.importStepRead
        case 'check': return language.importStepCheck
        case 'assets': return language.importStepAssets
        case 'add': return language.importStepAdd
    }
}

function stepDefs(steps:readonly ImportStep[]):TaskStepDef[] {
    return steps.map((step) => ({label: stepLabel(step), mark: STEP_MARK[step], ...(step === 'assets' || step === 'read' ? {noun: language.importNounAssets} : {})}))
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

//A card the preflight opened and the user confirmed, with the abort its Cancel drives.
type OpenedCard = {handle:TaskHandle, abort:AbortController}

function openCard(entries:RoundEntry[], task:ImportTaskSpec, abort:AbortController, confirm?:TaskConfirm):TaskHandle {
    return alertTask({
        title: task.title,
        subtitle: task.subtitle ?? (entries.length === 1 ? entries[0].item.name : undefined),
        steps: stepDefs(task.steps),
        onCancel: () => abort.abort(),
        ...(task.background ? {background: true as const} : {}),
        ...(task.backgroundHeld ? {backgroundHeld: true as const} : {}),
        ...(confirm ? {confirm} : {}),
    })
}

type RoundEnd = {
    summary:ImportSummary
    closed:Promise<TaskCloseAnswer>
    retry:RoundEntry[]
    handle:TaskHandle
    //True when this round's card lists the Undo action; only then is an `undo` answer honoured.
    offered:boolean
}

//A round that may still answer Replace holds the guard that keeps every other card from offering the background, until its
//last decision shows that no Replace can follow or the round ends.
type RoundGuard = {release:() => void}

function holdRoundGuard(enabled:boolean):RoundGuard {
    let end:(() => void)|null = enabled ? registerDetachedModulesRound() : null
    return {release: () => {
        end?.()
        end = null
    }}
}

/**
 * One round: opens the card (unless the preflight already did), runs the entries in order and posts the result inside the
 * caller's busy scope. It returns the promise of the answer, not the answer, so the wait for it stays outside that scope.
 */
async function runRound(entries:RoundEntry[], number:number, task:ImportTaskSpec, opts:ImportBatchOptions, record:ImportUndoRecord, opened?:OpenedCard):Promise<RoundEnd> {
    const guard = holdRoundGuard(opts.mayReplace === true)
    try {
        return await runRoundWithGuard(entries, number, task, opts, guard, record, opened)
    } finally {
        guard.release()
    }
}

async function runRoundWithGuard(entries:RoundEntry[], number:number, task:ImportTaskSpec, opts:ImportBatchOptions, guard:RoundGuard, record:ImportUndoRecord, opened?:OpenedCard):Promise<RoundEnd> {
    const count = entries.length
    const abort = opened?.abort ?? new AbortController()
    const handle:TaskHandle = opened?.handle ?? openCard(entries, task, abort)
    const gate = {locked: false}
    const round = {replaced: false}
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
            found: handle.setFound,
            onCommitted: (created) => {
                marker = true
                anyCommitted = true
                recordCreated(record, created)
            },
            onDecided: (replace) => {
                if(replace){
                    round.replaced = true
                    return
                }
                //The last file's decision with no Replace in the round: nothing can replace a module from here on.
                if(i === count - 1 && !round.replaced && !handle.detached){
                    guard.release()
                    handle.offerBackground()
                }
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
    guard.release()
    if(opts.afterRound){
        try {
            opts.afterRound(number)
        } catch (error) {
            console.error(error)
        }
    }
    //A card in the background, or one that a newer task replaced, has no claim on the screen: a wait on it belongs to someone else.
    if(!handle.detached && !handle.inBackground){
        await clearStaleLegacyProgress()
    }
    //The last moment the card can be sent to the background is the round's final await above: the flag is read after it and
    //before the call that ends the card, with no await between.
    record.backgrounded ||= handle.backgrounded
    const undo:TaskResultAction[] = undoOffered(record) ? [{id: 'undo', label: language.importTaskUndo, guarded: true}] : []
    const offered = undo.length > 0
    const summary = summariseImport(items, outcomes, {declinedReason: opts.declinedReason})
    if(cancelled){
        return {summary: {...summary, cancelled: true}, closed: handle.settleCancel(undefined, offered ? undo : undefined), retry: [], handle, offered}
    }
    const retry = items.filter((_, i) => outcomes[i].kind === 'failed' && !markers[i]).map((item) => ({item}))
    const composed = composeImportResult(items, outcomes, markers, {declinedReason: opts.declinedReason})
    let closed:Promise<TaskCloseAnswer>
    if(composed.kind === 'finish'){
        closed = handle.finish(offered ? {...composed.result, actions: [...undo, ...(composed.result.actions ?? [])]} : composed.result)
    }
    else if(composed.kind === 'fail'){
        closed = handle.fail(offered ? {...composed.failure, actions: [...undo, ...(composed.failure.actions ?? [])]} : composed.failure)
    }
    else{
        handle.close()
        closed = Promise.resolve({kind: 'closed'})
        return {summary, closed, retry, handle, offered: false}
    }
    return {summary, closed, retry, handle, offered}
}

/**
 * `preflight` asks once, before anything runs, when the batch has two or more files; Retry rounds never ask.
 * `afterRound(number)` runs inside each round's busy scope, after its files and before its result is posted; a throw is
 * logged. `mayReplace` marks a batch whose files can answer Replace to a duplicate question: while one of its rounds can
 * still do so, no card offers the background (see `registerDetachedModulesRound`).
 */
type ImportBatchOptions = {afterImported?:(outcome:ImportOutcome) => void, afterRound?:(number:number) => void, declinedReason?:string, task:ImportTaskSpec, outerBusy?:BusyHandle, preflight?:true, mayReplace?:true}

function notStartedSummary():ImportSummary {
    return {imported: 0, skipped: 0, declined: 0, notImported: 0, notes: [], own: null, message: null, notStarted: true}
}

/**
 * The preflight: opens the card in its confirm state and waits for the answer outside every busy scope (the caller's own
 * scope ends first, so an unanswered sheet holds neither busy nor the keep-alive). Returns the confirmed card, or null when
 * the action must not start: declined, replaced by a newer task, closed, or a restore began during the wait. Nothing was
 * run and no result card is posted; a replacement or close is logged only, as a replaced import ends silently.
 */
async function askPreflight(items:ImportItem[], opts:ImportBatchOptions, task:ImportTaskSpec):Promise<OpenedCard|null|undefined> {
    const confirm = opts.preflight ? composeImportPreflight(items) : null
    if(!confirm){
        return undefined
    }
    opts.outerBusy?.end()
    const abort = new AbortController()
    const handle = openCard(items.map((item) => ({item})), task, abort, confirm)
    const answer = await handle.confirmation
    if(answer !== 'confirm'){
        if(answer === 'replaced' || answer === 'closed'){
            console.info(`The import preflight ended without a confirm (${answer}).`)
        }
        return null
    }
    //A restore that began during the wait ends the action silently: the restore's own UI is on screen.
    if(restoreInProgress()){
        handle.close()
        return null
    }
    return {handle, abort}
}

/** Runs the Undo and tells the user how it went; true when something was removed. It never rejects. */
async function runUndo(record:ImportUndoRecord):Promise<boolean> {
    try {
        const result = await undoImport(record)
        reportUndo(result)
        return !('refused' in result) && result.trashed + result.removed > 0
    } catch (error) {
        console.error(error)
        reportUndo({refused: true})
        return false
    }
}

/**
 * The batch on a task card: each round runs inside its own busy scope and ends with its result posted; the answer is
 * awaited after the scope has ended, so an unanswered card never holds the busy entry (and with it the Android
 * keep-alive). Retry starts a new round over the failed files that never reached their write. A replaced or closed card
 * ends the action silently.
 */
async function runTaskBatch(items:ImportItem[], opts:ImportBatchOptions, task:ImportTaskSpec):Promise<ImportSummary> {
    let entries:RoundEntry[] = items.map((item) => ({item}))
    let number = 0
    let backgrounded = false
    //Everything the action's rounds created, for one Undo; it lives as long as the action.
    const record = createUndoRecord()
    let opened = await askPreflight(items, opts, task)
    if(opened === null){
        return notStartedSummary()
    }
    for(;;){
        const current = entries
        const preOpened = opened
        opened = undefined
        let round:RoundEnd
        try {
            round = await withBusy('import', () => runRound(current, number, task, opts, record, preOpened))
        } finally {
            //The caller's own scope for work before the card ends with the first result.
            opts.outerBusy?.end()
        }
        const answer = await round.closed
        backgrounded = backgrounded || round.handle.backgrounded
        record.backgrounded ||= round.handle.backgrounded
        //The Undo runs before this action settles, so a reader of the unread-notice wait sees the undone state.
        if(answer.kind === 'action' && answer.id === 'undo' && round.offered){
            const undone = await runUndo(record)
            const ended = undone ? {...round.summary, undone: true as const} : round.summary
            return backgrounded ? {...ended, backgrounded: true} : ended
        }
        //A restore that began while the result waited ends the action: no import round follows it.
        if(answer.kind === 'action' && answer.id === 'retry' && round.retry.length > 0 && !restoreInProgress()){
            entries = round.retry
            number++
            continue
        }
        return backgrounded ? {...round.summary, backgrounded: true} : round.summary
    }
}

/**
 * Attempts every item in order, whatever an earlier item's outcome, on one task card (see `runTaskBatch`): Cancel before
 * the round's first write, Retry for the failed files, and one result card. `afterImported` runs after each imported
 * item; its throw is logged and does not stop the batch. The whole action, every Retry round included, is tracked until
 * it settles, so a reader of the unread-notice wait does not take a Retry for the final answer.
 */
export function runImportBatch(items:ImportItem[], opts:ImportBatchOptions):Promise<ImportSummary> {
    return trackTaskAction(runTaskBatch(items, opts, opts.task))
}
