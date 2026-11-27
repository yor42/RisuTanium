// The import job of Studio's Add for character assets and emotion images: pick, store each file, then one history step for
// the files that stored. It lives in a module, not in the list, so its outcome reaches the user when the list is gone.
//
// A batch belongs to the Studio visit it started in. `closeStudio` keeps the selected character and the visit id, so the
// history service's own guard would still accept a step after Studio closed; the job therefore asks `alive()` after every
// await and never inserts a row, or stores a file it has not started, for a visit that ended. `alive()` is the only
// decision. The watcher below only drops the failed entries that wait for a retry and reports a batch with nothing in flight.

import { untrack } from 'svelte'
import { language } from '../../../lang'
import { toastHost, type PlainToastInit } from '../../toast/toastHost.svelte'
import type { FolderAwarePicker, ImportLanding } from '../../../lib/Studio/assets/StudioAssetList.svelte'
import { addRefusalNotice, badTypeNotice, emotionNameOf } from '../edit/studioToasts'
import type { OwnerHistoryService, StudioRefusal, StudioResult } from '../history/ownerHistory.svelte'
import type { OwnerKey } from '../history/ownerPhase'
import { getStudioHistoryService } from '../history/studioHistoryService.svelte'
import { studioScreen } from '../studioScreen.svelte'
import type { PickKind, PickOutcome } from './filePicker'

export type ImportArray = 'additionalAssets' | 'emotionImages'

export interface ImportEntry {
    readonly id: string
    readonly batchId: string
    readonly owner: OwnerKey
    readonly array: ImportArray
    readonly name: string
    state: 'storing' | 'failed'
}

export interface ImportDeps {
    pickFiles(kind: PickKind): Promise<PickOutcome>
    storeAsset(file: File, ext: string): Promise<string>
    storeEmotion(file: File): Promise<string>
    service(): Pick<OwnerHistoryService, 'assetInsert' | 'view'> | null
    toastHost: { post(init: PlainToastInit): unknown }
    beginBusy(kind: PickKind): { end(): void }
}

// The chooser and the store layer are loaded when an Add starts, so a form that only shows the lists does not pull them in.
// Once loaded, the module is kept so the busy entry of the store phase can begin synchronously.
let pickerModule: Promise<typeof import('./filePicker')> | undefined
let pickerLoaded: typeof import('./filePicker') | undefined

function loadPicker(): Promise<typeof import('./filePicker')> {
    pickerModule ??= import('./filePicker').then((loaded) => {
        pickerLoaded = loaded
        return loaded
    })
    // A failed import is not kept: the next Add asks again.
    pickerModule.catch(() => { pickerModule = undefined })
    return pickerModule
}

const defaultDeps: ImportDeps = {
    async pickFiles(kind) {
        return (await loadPicker()).pickFiles(kind)
    },
    async storeAsset(file, ext) {
        const { saveAssetFromBlob } = await import('../../globalApi.svelte')
        return saveAssetFromBlob(file, ext)
    },
    async storeEmotion(file) {
        const [{ readPickedFileBytes }, { saveAsset }] = await Promise.all([loadPicker(), import('../../globalApi.svelte')])
        return saveAsset(await readPickedFileBytes(file))
    },
    service: getStudioHistoryService,
    toastHost,
    beginBusy(kind) {
        // `pickFiles` ran first and loaded the chooser; a caller that never picked has no busy entry to begin.
        return pickerLoaded?.beginPickBusy(kind) ?? { end: () => {} }
    },
}

interface Batch {
    id: string
    owner: OwnerKey
    array: ImportArray
    kind: PickKind
    visit: string
    // The files that were accepted and neither landed nor were removed by the person.
    accepted: number
    landed: number
    entries: ImportEntry[]
    files: Map<string, File>
    landing: ImportLanding | undefined
    // The store passes running: the first loop and each retry. A batch finishes only when none is left.
    inFlight: number
    finalized: boolean
    stopWatch: () => void
    deps: ImportDeps
}

let counter = 0
const batches = new Map<string, Batch>()
// What the lists show; each entry is reactive. The files and the counters stay in the batch.
const views = $state<ImportEntry[]>([])

export function resetStudioImportsForTests(): void {
    for (const batch of [...batches.values()]) {
        batch.stopWatch()
    }
    batches.clear()
    views.splice(0, views.length)
    counter = 0
}

export function importEntriesOf(owner: OwnerKey, array: ImportArray): ImportEntry[] {
    return views.filter((entry) => entry.owner === owner && entry.array === array)
}

function alive(batch: Batch): boolean {
    return studioScreen.open && studioScreen.visitId === batch.visit
}

// The accepted files that neither landed nor were removed by the person: unstarted, stored but not inserted, retrying, or
// a failed entry that waited. Every not-added and refused count of the batch is this number.
function remaining(batch: Batch): number {
    return batch.accepted - batch.landed
}

function removeEntry(batch: Batch, entry: ImportEntry): void {
    const at = views.indexOf(entry)
    if (at >= 0) {
        views.splice(at, 1)
    }
    const own = batch.entries.indexOf(entry)
    if (own >= 0) {
        batch.entries.splice(own, 1)
    }
    batch.files.delete(entry.id)
}

function dispose(batch: Batch): void {
    batch.stopWatch()
    for (const entry of [...batch.entries]) {
        removeEntry(batch, entry)
    }
    batches.delete(batch.id)
}

// The one notice of a batch that ended with files not added because the visit ended.
function finalizeNotAdded(batch: Batch): void {
    if (batch.finalized) {
        return
    }
    batch.finalized = true
    const n = remaining(batch)
    if (n > 0) {
        batch.deps.toastHost.post({ kind: 'warning', text: language.studioImportNotAdded(n) })
    }
    dispose(batch)
}

function settle(batch: Batch): void {
    if (!alive(batch) && batch.inFlight === 0) {
        finalizeNotAdded(batch)
    }
}

// A batch with no entry and nothing in flight has nothing left to show.
function disposeIfEmpty(batch: Batch): void {
    if (batches.has(batch.id) && batch.entries.length === 0 && batch.inFlight === 0) {
        dispose(batch)
    }
}

function refuse(batch: Batch, result: { reason: StudioRefusal }): void {
    const notice = addRefusalNotice(alive(batch), result)
    if (notice.kind === 'not-added') {
        finalizeNotAdded(batch)
        return
    }
    // A refusal while Studio is open states its own cause. The failed entries go with the batch, and a retry in flight
    // sees `finalized` and inserts nothing.
    batch.finalized = true
    batch.deps.toastHost.post({ kind: 'warning', text: language.studioImportRefused(remaining(batch)), sub: notice.text })
    dispose(batch)
}

async function storeOne(batch: Batch, entry: ImportEntry): Promise<string[]> {
    const file = batch.files.get(entry.id)
    if (file === undefined) {
        throw new Error('The file of an import entry is gone')
    }
    if (batch.array === 'additionalAssets') {
        // As the classic panel takes it: the text after the last dot, in lower case.
        const ext = (file.name.split('.').pop() ?? '').toLowerCase()
        return [file.name, await batch.deps.storeAsset(file, ext), ext]
    }
    return [emotionNameOf(file.name), await batch.deps.storeEmotion(file)]
}

// Inserts the tuples as one step. Null: the step landed. Otherwise the refusal was reported and the batch is over.
function insertStored(batch: Batch, tuples: readonly string[][]): { sub: string | undefined } | null {
    const service = batch.deps.service()
    const result: StudioResult = service === null ? { ok: false, reason: 'loading' } : service.assetInsert(batch.owner, batch.array, tuples)
    if (result.ok === false) {
        refuse(batch, result)
        return null
    }
    let sub: string | undefined
    if (batch.landing !== undefined && batch.array === 'additionalAssets') {
        const landed = batch.landing.land(tuples.map((tuple) => tuple[0]))
        const lines = landed.refusal === null ? landed.notes : [...landed.notes, landed.refusal]
        sub = lines.length > 0 ? lines.join(' ') : undefined
    }
    return { sub }
}

function postResult(batch: Batch, n: number, failed: number, sub: string | undefined): void {
    batch.deps.toastHost.post({
        kind: failed === 0 ? 'success' : 'warning',
        text: language.studioPickResult(n, failed),
        ...(sub === undefined ? {} : { sub }),
    })
}

async function runLoop(batch: Batch): Promise<void> {
    const busy = batch.deps.beginBusy(batch.kind)
    const stored: { entry: ImportEntry; tuple: string[] }[] = []
    try {
        for (const entry of [...batch.entries]) {
            // A file not started is never stored once the visit ended or the batch is over.
            if (!alive(batch) || batch.finalized) {
                break
            }
            try {
                stored.push({ entry, tuple: await storeOne(batch, entry) })
            } catch (error) {
                console.error(error)
                entry.state = 'failed'
            }
        }
    } finally {
        busy.end()
    }
    try {
        if (!alive(batch) || batch.finalized) {
            return
        }
        const failedNow = batch.entries.filter((entry) => entry.state === 'failed').length
        if (stored.length > 0) {
            const landed = insertStored(batch, stored.map((item) => item.tuple))
            if (landed === null) {
                return
            }
            for (const item of stored) {
                removeEntry(batch, item.entry)
            }
            batch.landed += stored.length
            postResult(batch, stored.length, failedNow, landed.sub)
        } else if (failedNow > 0) {
            postResult(batch, 0, failedNow, undefined)
        }
    } finally {
        batch.inFlight -= 1
        settle(batch)
        disposeIfEmpty(batch)
    }
}

function watch(batch: Batch): void {
    batch.stopWatch = $effect.root(() => {
        $effect(() => {
            // Both are read on every run, so the effect follows the visit.
            const open = studioScreen.open
            const visit = studioScreen.visitId
            if (open && visit === batch.visit) {
                return
            }
            untrack(() => {
                for (const entry of [...batch.entries]) {
                    if (entry.state === 'failed') {
                        removeEntry(batch, entry)
                    }
                }
                settle(batch)
            })
        })
    })
}

export async function startImport(owner: OwnerKey, array: ImportArray, landing?: ImportLanding, deps: ImportDeps = defaultDeps): Promise<void> {
    // A list that is still loading has nothing to add to; it shows its own loading line.
    if (deps.service()?.view(owner).editable !== true) {
        return
    }
    const kind: PickKind = array === 'additionalAssets' ? 'asset' : 'emotion'
    const visit = studioScreen.visitId
    const picked = await deps.pickFiles(kind)
    if (picked.kind === 'cancelled') {
        return
    }
    const notice = badTypeNotice(picked.badType)
    if (notice !== null) {
        deps.toastHost.post(notice)
    }
    const files = picked.files
    if (files.length === 0) {
        return
    }
    if (!(studioScreen.open && studioScreen.visitId === visit)) {
        deps.toastHost.post({ kind: 'warning', text: language.studioImportNotAdded(files.length) })
        return
    }
    counter += 1
    const batch: Batch = {
        id: `import:${counter}`,
        owner,
        array,
        kind,
        visit,
        accepted: files.length,
        landed: 0,
        entries: [],
        files: new Map(),
        landing,
        inFlight: 1,
        finalized: false,
        stopWatch: () => {},
        deps,
    }
    files.forEach((file, index) => {
        const id = `${batch.id}:${index}`
        views.push({ id, batchId: batch.id, owner, array, name: file.name, state: 'storing' })
        // Read back the reactive entry, so a change of its state shows.
        batch.entries.push(views[views.length - 1])
        batch.files.set(id, file)
    })
    batches.set(batch.id, batch)
    watch(batch)
    await runLoop(batch)
}

export async function retryImportEntry(batchId: string, entryId: string): Promise<void> {
    const batch = batches.get(batchId)
    if (batch === undefined || batch.finalized || !alive(batch)) {
        return
    }
    const entry = batch.entries.find((candidate) => candidate.id === entryId)
    if (entry === undefined || entry.state !== 'failed') {
        return
    }
    // Set before any await, so a second press finds the entry already being stored.
    entry.state = 'storing'
    batch.inFlight += 1
    const busy = batch.deps.beginBusy(batch.kind)
    let tuple: string[] | null = null
    try {
        tuple = await storeOne(batch, entry)
    } catch (error) {
        console.error(error)
        entry.state = 'failed'
    } finally {
        busy.end()
    }
    try {
        if (tuple !== null && alive(batch) && !batch.finalized) {
            const landed = insertStored(batch, [tuple])
            if (landed !== null) {
                removeEntry(batch, entry)
                batch.landed += 1
                postResult(batch, 1, 0, landed.sub)
            }
        }
    } finally {
        batch.inFlight -= 1
        settle(batch)
        disposeIfEmpty(batch)
    }
}

// The person removes a failed entry from the list; the file is not added and no longer counts as not added.
export function dropImportEntry(batchId: string, entryId: string): void {
    const batch = batches.get(batchId)
    const entry = batch?.entries.find((candidate) => candidate.id === entryId)
    if (batch === undefined || entry === undefined || entry.state !== 'failed') {
        return
    }
    removeEntry(batch, entry)
    batch.accepted -= 1
    disposeIfEmpty(batch)
}

// The picker of one list: Add opens the chooser and runs the job for `owner`'s `array`.
export function createImportPicker(owner: OwnerKey, array: ImportArray, deps?: ImportDeps): FolderAwarePicker {
    return {
        open(landing) {
            void startImport(owner, array, landing, deps)
        },
    }
}
