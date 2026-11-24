import { language } from "src/lang"
import { downloadNotice } from "src/ts/exportNotice"
import { fillLang } from "src/lang/fill"
import { alertClear, alertConfirm, alertError, alertModuleSelect, alertNormal, alertStore, alertWait } from "../alert"
import { getCurrentCharacter, getDatabase, setCurrentCharacter, setDatabase, type customscript, type loreBook, type triggerscript } from "../storage/database.svelte"
import type { RunSubject } from "./chatOrigin"
import { ASSET_PIECE_SAVE_MIN_BYTES } from "../assetHash"
import { AppendableBuffer, AssetSourceChangedError, forageStorage, LocalWriter, readImage, saveAsset, saveAssetFromPieces, VirtualWriter } from "../globalApi.svelte"
import { checkPersonaBinded, selectFileByDom, sleep } from "../util"
import { v4 } from "uuid"
import { convertExternalLorebook } from "./lorebook.svelte"
import { compressImage } from '../media'
import { decodeRPack, encodeRPack } from "../rpack/rpack_js"
import { DBState, HideIconStore, moduleBackgroundEmbedding, ReloadGUIPointer } from "../stores.svelte"
import {get} from "svelte/store"
import { untrack } from "svelte"
import { moduleChangeNeedsReload, type ModuleReloadBase } from "./moduleReloadNeed"
import { convertCharacterToModule, convertModuleToCharacter } from "../interchangeability"
import { exportCharacterCard, exportOffersCancel, importCharacterFile, preflightCardExport } from "../characterCards"
import { appStoreOrNull, listModuleAssets, preflightExport, refuseExport, type ExportAssetEntry } from "../drive/exportPreflight"
import { ExportCancelToken } from "../exportCancel"
import { createExportTask } from "../exportTask"
import { isTauri } from "../platform"
import { ASSET_RETAINED_KEY } from "../studio/assets/assetOwnerKeys"
import { withdrawOpenModuleId } from "../studio/assets/openModuleForm.svelte"
import { risumFileName, streamRisum } from "../risumStream"
import { moduleListOf, moduleRefIdsOf } from "./moduleRefList"
import { bumpModuleGui } from "./moduleGuiBump"
import { ModuleRefusal } from "./moduleRefusal"
import { ModuleImportStopped, confirmRisumLowLevel } from "./moduleImportStop"
import { outcomeOfError, runImportBatch, type ImportOutcome } from "../importBatch"
import { IMPORT_STEPS, ImportCancelled, NO_IMPORT_PROGRESS, sourceWithProgress, type ImportProgress } from "../importProgress"
import { markBootWrite } from "../bootWindow"
import { useModuleById } from "./moduleUse"
import { hasModuleStubKey, isModuleStub } from "../storage/moduleStub"
import { DuplicateSession, applyModulePlacement, describeReplace, type DuplicateDecision } from "./moduleDuplicates"
import { withBusy, type BusyHandle } from "./memory/busyActions"
import { openOutsideBusy } from "../drive/exportDialogBusy"
import { assetByteLimit, charxLimits } from "./processzip"
import { IMPORT_PIECE_BYTES, WindowedReader, importSourceOfBytes, importSourceOfFile, isImportSource, type ImportSource, type ImportSourceStat } from "../importSource"

export interface MCPModule{
    url: string
}

export interface RisuModule{
    name: string
    description: string
    lorebook?: loreBook[]
    regex?: customscript[]
    cjs?: string
    trigger?: triggerscript[]
    id: string
    lowLevelAccess?: boolean
    hideIcon?: boolean
    backgroundEmbedding?:string
    assets?:[string,string,string][]
    namespace?:string
    customModuleToggle?:string
    mcp?:MCPModule
    icon?:string
    /** The asset folder document, copied verbatim by the CharX converters; the typed reader narrows it. */
    risutanium_asset_folders?:unknown
    /**
     * Device state: the `[name, path]` pairs this module's history retains. Carried by `.bin` and the store, never by a
     * module file. Typed `unknown` because a stored value may have another shape; the readers narrow it.
     */
    risutanium_asset_retained?:unknown
}

export function exportModule(module:RisuModule, arg:{
    alertEnd?:boolean
} = {}){
    return withBusy('export', (busy) => writeModuleCard(module, arg, busy))
}

async function writeModuleCard(module:RisuModule, arg:{
    alertEnd?:boolean
}, busy:BusyHandle){
    const alertEnd = arg.alertEnd ?? true
    // Created first and shared with the card export, so every ending of this run, a throw before the card included, goes through it.
    const task = createExportTask({title: language.exportTaskModuleTitle, subtitle: module.name})
    let writer: LocalWriter | undefined
    try{
        const char = convertModuleToCharacter(module)
        // Before the save dialog and before the stand-in icon is saved; the card export is told so and does not check again.
        const checked = await preflightCardExport(char, 'charx', 'v3')
        if(checked.kind !== 'ok'){
            await refuseExport(checked)
            return
        }
        if(!char.image){
            const res = await fetch('/none.webp')
            const data = new Uint8Array(await res.arrayBuffer())
            char.image = await saveAsset(data)
            char.extentions ??= {}
            char.extentions['moduleNoneImage'] = true
        }
        const cancel = exportOffersCancel({writer: undefined, type: 'charx', tauri: isTauri, largeAssetCount: checked.large.size})
            ? new ExportCancelToken()
            : null
        task.useToken(cancel)
        // On web the card opens here, with a Cancel, before the writer's open can stall; on desktop and Android after the save dialog.
        if(!isTauri){
            task.open()
        }
        const opened = new LocalWriter()
        writer = opened
        if(!(await openOutsideBusy(busy, () => opened.init(module.name + '.module', ['charx'], undefined, cancel ?? undefined)))){
            //the person cancelled the save dialog
            task.close()
            return
        }
        task.open()
        const exported = await exportCharacterCard(char, 'charx', {
            spec: 'v3',
            writer: opened,
            checked,
            progress: task
        })
        if(!exported){
            //the export already ended the card with its error; a success notice would hide it
            return
        }
        if(alertEnd){
            task.done(downloadNotice(language.successExport))
        }
        else{
            task.close()
        }
    }
    catch(e){
        task.endOnError(e, writer)
    }
    finally{
        task.close()
    }
}

export async function exportModuleLegacy(module:RisuModule, arg:{
    alertEnd?:boolean
    saveData?:boolean
} = {}){
    // An MCP module never leaves the device in a module file: its URL may carry a token or name a private host, and it
    // is copied into the description too, so no field of the module may be written. Full backups carry it instead.
    if(module.mcp){
        alertError(language.errors.mcpModuleConversionUnsupported)
        return null
    }
    const alertEnd = arg.alertEnd ?? true
    const saveData = arg.saveData ?? true

    // The asset list and the module copy come from one snapshot, taken before any await, so an edit made while the
    // size check or the save dialog is open cannot leave the records and the main block describing different assets.
    const entries = listModuleAssets(module)
    const snapshot = snapshotModuleForRisum(module)
    if(entries.length > 0 && await refuseExport(await preflightExport(entries, 'risum', appStoreOrNull))){
        return null
    }

    if(!saveData){
        // The bytes for a CharX `module.risum`: no writer, no Cancel and no busy entry.
        const apb = new AppendableBuffer()
        await streamRisum(
            await encodeRisumMainBlock(snapshot),
            entries.length,
            (index) => encodeRisumRecordBody(entries[index].key, () => showRisumAssetWait(entries[index].index, entries.length)),
            (chunk) => { apb.append(chunk) },
        )
        if(alertEnd){
            alertNormal(downloadNotice(language.successExport))
        }
        return apb.buffer
    }
    // The value is never the file: it is not kept alive, and the caller (`ModuleSettings`) ignores it.
    return withBusy('export', (busy) => writeRisumFile(snapshot, entries, alertEnd, busy))
}

/**
 * Removes the device-only asset state from a module object, whatever shape the value has. A module file never carries
 * the retained paths: they name this device's files, and a file from outside cannot be trusted to name them. Call it on
 * a copy or on an object that is not yet installed, never on a live slot.
 */
export function dropDeviceAssetState<T extends object>(module:T):T{
    Reflect.deleteProperty(module, ASSET_RETAINED_KEY)
    return module
}

/** The module as the main block describes it: a copy whose asset keys are blanked, because the records carry the bytes. */
function snapshotModuleForRisum(module:RisuModule):RisuModule{
    const copy = dropDeviceAssetState(safeStructuredClone(module))
    copy.assets = (copy.assets ?? []).map((asset) => {
        return [asset[0], '', asset[2]] as [string,string,string]
    })
    return copy
}

function encodeRisumMainBlock(snapshot:RisuModule){
    return encodeRPack(Buffer.from(JSON.stringify({
        module: snapshot,
        type: 'risuModule'
    }, null, 2), 'utf-8'))
}

function showRisumAssetWait(completed:number, total:number){
    alertStore.set({
        type: 'wait',
        msg: fillLang(language.alerts.addingAssets, { completed, total })
    })
}

/** One record body: the asset read, compressed and RPack-encoded. An asset that cannot be read becomes a blank record. */
async function encodeRisumRecordBody(key:string, showWait:() => void):Promise<Uint8Array>{
    showWait()
    const rData = await readImage(key)
    return await encodeRPack(await compressImage(rData || new Uint8Array(0)))
}

/**
 * Writes the .risum to a file the person picks, record by record. Resolves `null` in every outcome, and never rejects:
 * a cancel, a dismissed dialog and a failure are each handled here, because the caller has no catch.
 *
 * Order, after the size check: the save dialog (before any asset is read and before the main block is built), the main
 * block, the records, the terminator, `close()`, then the success notice. A failed or cancelled run writes nothing more
 * and does not close the file, so a truncated file lacks its terminator and this fork's `scanRisum` refuses it.
 *
 * On plain-HTTP self-hosted web the streaming save helper opens a popup that needs a fresh user gesture. Nothing is
 * awaited between the end of the size check and the writer's `init`, to keep the gesture alive; if it has lapsed the
 * writer falls back to a whole-file in-memory Blob, so that route does not bound memory.
 */
async function writeRisumFile(snapshot:RisuModule, entries:ExportAssetEntry[], alertEnd:boolean, busy:BusyHandle):Promise<null>{
    // Created first: every ending of this run goes through it, a throw before the card opened included.
    const task = createExportTask({title: language.exportTaskModuleTitle, subtitle: snapshot.name})
    let localWriter: LocalWriter | undefined
    try{
        const cancel = exportOffersCancel({writer: undefined, type: 'risum', tauri: isTauri, largeAssetCount: 0, assetCount: entries.length})
            ? new ExportCancelToken()
            : undefined
        task.useToken(cancel ?? null)
        // On web the card opens here, with a Cancel, before the writer's open can stall; on desktop and Android after the save dialog.
        if(!isTauri){
            task.open()
        }
        const writer = new LocalWriter()
        localWriter = writer
        if(!(await openOutsideBusy(busy, () => writer.init('RisuM File', ['risum'], risumFileName(snapshot.name), cancel)))){
            //the person dismissed the save dialog: nothing was exported, so nothing is said
            task.close()
            return null
        }
        task.open()
        if(entries.length > 0){
            task.step('assets')
            task.count(0, entries.length)
        }
        await streamRisum(
            await encodeRisumMainBlock(snapshot),
            entries.length,
            async (index) => {
                const body = await encodeRisumRecordBody(entries[index].key, () => task.throwIfCancelled())
                task.count(index + 1, entries.length)
                return body
            },
            (chunk) => writer.write(chunk),
        )
        task.step('write')
        await writer.close()
        if(alertEnd){
            // A Tauri build writes to the location the person picked, so the default "download directory" text would be false.
            task.done(isTauri ? language.successExportChosenLocation : downloadNotice(language.successExport))
        }
        else{
            task.close()
        }
        return null
    }
    catch(e){
        // The ending is posted before this resolves so the caller's next dialog waits for it.
        task.endOnError(e, localWriter)
        return null
    }
    finally{
        task.close()
    }
}

const RISUM_MAGIC = 111
const RISUM_HEADER_BYTES = 6
const RISUM_RECORD_HEADER_BYTES = 5

// The longest string a 64-bit V8 builds. The main block is decoded as one string, so a longer block is refused up front;
// an engine with a lower ceiling raises a RangeError at the decode, which is turned into the same refusal.
const MAX_MAIN_BLOCK_BYTES = 0x1FFFFFE8

// A module this size or larger shows that it is being read before any asset is saved.
const SHOW_READING_ABOVE_BYTES = 8 * 1024 * 1024

const MAX_CONCURRENT_ASSET_SAVES = 10
const ASSET_SAVE_RETRY_DELAY_MS = 5000
const MAX_ASSET_SAVE_RETRIES = 3

/** One asset record of a `.risum`: where its mark byte is and how long its body is. */
type RisumRecord = {
    start: number
    length: number
}

type RisumScan = {
    module: RisuModule
    records: RisumRecord[]
    /** The source as the first pass saw it; the second pass reads only while the source still matches. */
    stat: ImportSourceStat
}

const readU32 = (bytes: Uint8Array, at: number) => bytes[at] + bytes[at + 1] * 0x100 + bytes[at + 2] * 0x10000 + bytes[at + 3] * 0x1000000

/**
 * First pass of a `.risum` read: validates the whole structure without reading an asset body, so a file that will be
 * refused is refused before anything is saved. The magic byte, version, module type, record marks and the record count
 * against the module's asset list are checked, no record runs past the end, none is over the asset limit, and the
 * terminator is present. Bytes after the terminator are ignored.
 */
async function scanRisum(source: ImportSource): Promise<RisumScan> {
    const stat = await source.stat()
    const size = stat.size
    const reader = new WindowedReader(source, size)
    const incomplete = () => new ModuleRefusal(language.moduleFileIncomplete)

    const head = await reader.read(0, RISUM_HEADER_BYTES)
    if(head.length === 0 || head[0] !== RISUM_MAGIC){
        console.error("Invalid magic number")
        throw new ModuleRefusal(language.errors.noData)
    }
    if(head.length < 2){
        throw incomplete()
    }
    if(head[1] !== 0){ //Version check
        console.error("Invalid version")
        throw new ModuleRefusal(language.errors.noData)
    }
    if(head.length < RISUM_HEADER_BYTES){
        throw incomplete()
    }
    const mainLength = readU32(head, 2)
    const mainEnd = RISUM_HEADER_BYTES + mainLength
    if(mainEnd > size){
        throw incomplete()
    }
    if(mainLength > MAX_MAIN_BLOCK_BYTES){
        console.error("The module block is too large to read")
        throw new ModuleRefusal(language.errors.noData)
    }
    const mainData = await reader.read(RISUM_HEADER_BYTES, mainEnd)
    if(mainData.length < mainLength){
        throw incomplete()
    }
    const decoded = await decodeRPack(mainData)
    let mainText: string
    try {
        mainText = Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength).toString()
    } catch (error) {
        if(error instanceof RangeError){
            console.error("The module block is too large to read", error)
            throw new ModuleRefusal(language.errors.noData)
        }
        throw error
    }
    const main:{
        type:'risuModule'
        module:RisuModule
    } = JSON.parse(mainText)

    if(!main || main.type !== 'risuModule'){
        console.error("Invalid module type")
        throw new ModuleRefusal(language.errors.noData)
    }
    const module = main.module
    if(!module || typeof module !== 'object' || (module.assets != null && !Array.isArray(module.assets))){
        console.error("Invalid module")
        throw new ModuleRefusal(language.errors.noData)
    }
    //A file that carries the stub marker is refused whole, before any asset is written: it would be taken for a stand-in whose body is stored elsewhere.
    if(hasModuleStubKey(module)){
        console.error("Module carries the stub marker")
        throw new ModuleRefusal(language.errors.noData)
    }
    dropDeviceAssetState(module)

    const totalAssets = module.assets?.length ?? 0
    const limit = assetByteLimit()
    const records: RisumRecord[] = []
    let pos = mainEnd
    while(true){
        const header = await reader.read(pos, pos + RISUM_RECORD_HEADER_BYTES)
        if(header.length === 0){
            throw incomplete()
        }
        if(header[0] === 0){
            break
        }
        if(header[0] !== 1){
            throw new ModuleRefusal(language.errors.noData)
        }
        if(header.length < RISUM_RECORD_HEADER_BYTES){
            throw incomplete()
        }
        if(records.length >= totalAssets){
            throw new ModuleRefusal(language.errors.noData)
        }
        const length = readU32(header, 1)
        if(length > limit){
            const name = module.assets?.[records.length]?.[0] || `#${records.length + 1}`
            throw new ModuleRefusal(language.moduleAssetTooLarge(name, Math.round(limit / (1024 * 1024))))
        }
        const end = pos + RISUM_RECORD_HEADER_BYTES + length
        if(end > size){
            throw incomplete()
        }
        records.push({ start: pos, length })
        pos = end
    }
    if(records.length !== totalAssets){
        throw new ModuleRefusal(language.errors.noData)
    }
    return { module, records, stat }
}

/** The body of one record, read from the source and checked against what the first pass saw. */
async function readRisumRecord(source: ImportSource, record: RisumRecord): Promise<Uint8Array> {
    const end = record.start + RISUM_RECORD_HEADER_BYTES + record.length
    const bytes = await source.read(record.start, end)
    if(bytes.length !== end - record.start || bytes[0] !== 1 || readU32(bytes, 1) !== record.length){
        throw new Error('the module file does not match its first read')
    }
    return bytes.subarray(RISUM_RECORD_HEADER_BYTES)
}

/**
 * The decoded body of one record in pieces of at most IMPORT_PIECE_BYTES, each read from the source and checked against
 * what the first pass saw (the header first, then the length of every read). Every piece is an array of its own that
 * the source and the pieces before it do not share, so the one that consumes it may keep it until it asks for the next.
 * The source is read one piece at a time, only when the consumer asks, so no read overlaps another reader.
 */
async function* readRisumRecordPieces(source: ImportSource, record: RisumRecord, onPiece?: (bytes: number) => void): AsyncGenerator<Uint8Array, void, undefined> {
    const bodyStart = record.start + RISUM_RECORD_HEADER_BYTES
    const end = bodyStart + record.length
    const header = await source.read(record.start, bodyStart)
    if(header.length !== RISUM_RECORD_HEADER_BYTES || header[0] !== 1 || readU32(header, 1) !== record.length){
        throw new Error('the module file does not match its first read')
    }
    for(let at = bodyStart; at < end; at += IMPORT_PIECE_BYTES){
        const to = Math.min(at + IMPORT_PIECE_BYTES, end)
        const bytes = await source.read(at, to)
        if(bytes.length !== to - at){
            throw new Error('the module file does not match its first read')
        }
        onPiece?.(bytes.length)
        //decodeRPack returns a new array and leaves `bytes` alone, which may be a view of memory the source does not give away.
        yield await decodeRPack(bytes)
    }
}

/** A hook for the caller to stop the read once the scanned module is known (the low-level-access and duplicate questions). */
export type ReadModuleOptions = {beforeAssets?: (module:RisuModule) => Promise<void>, progress?: ImportProgress}

/**
 * Reads a `.risum` module and saves its assets. The source is read in two passes and never as a whole: the first
 * validates the structure (see scanRisum), the second reads one record at a time, in file order, and saves it. A record
 * below ASSET_PIECE_SAVE_MIN_BYTES is read whole; decoded records waiting to be saved are bounded by count and, beyond
 * the first one, by charxLimits.backlogBytes. A record at or above it is read, decoded and saved in pieces while the
 * next record waits and is not counted against the backlog: in the desktop and Android app it holds a few pieces, and on
 * a store without a piece writer it collects the record whole.
 *
 * The magic byte, version, module type and block mark checks, a file cut short, a record count that does not match the
 * module's asset list, and an asset over the limit throw a ModuleRefusal before any asset is saved. A source that
 * changes between the passes or cannot be read throws a ModuleRefusal too, and is not retried. Any other error (corrupt
 * JSON, "Failed to save n assets" after the save retries) passes through as it is; a record whose save failed is read
 * from the source again for each retry.
 * It shows progress and clears it before it returns or throws, and never shows an error itself: the caller shows it.
 * It never returns without a module. It does not close the source: the caller that opened it does.
 * `opts.beforeAssets` runs once with the scanned module, after the file is known to be complete and before the first asset is saved. If it throws, the throw leaves as it is, no asset is saved and the progress is cleared.
 * With a tasked `opts.progress` the card shows the scan and the asset saves by bytes at every size and no legacy wait is
 * posted. The write gate (`beforeWrite`) is called once the module has records, after `beforeAssets` and before the first
 * asset is stored, whether or not a card is shown; a Cancel pressed before it ends the read with nothing saved.
 */
export async function readModule(input:Uint8Array|ImportSource, opts?:ReadModuleOptions):Promise<RisuModule> {
    const source = isImportSource(input) ? input : importSourceOfBytes('module.risum', input)
    const progress = opts?.progress ?? NO_IMPORT_PROGRESS
    const tasked = progress.tasked
    let progressShown = false
    let scan: RisumScan
    try {
        if(tasked){
            progress.step('read')
        }
        else if(source.size > SHOW_READING_ABOVE_BYTES){
            progressShown = true
            alertWait(language.alerts.readingCard)
        }
        scan = await scanRisum(tasked ? sourceWithProgress(source, progress.bytes, progress.signal) : source)
    } catch (error) {
        if(progressShown){
            alertClear()
        }
        throw error
    }
    progress.throwIfCancelled()
    progress.step('check')
    const module = scan.module
    const totalAssets = scan.records.length
    const totalBytes = scan.records.reduce((sum, record) => sum + record.length, 0)
    let completed = 0
    //Bytes of records saved so far, and the encoded bytes of the piece-saved record being read now.
    let savedBytes = 0
    let pieceBytes = 0
    const reportBytes = () => {
        if(tasked){
            progress.bytes(savedBytes + pieceBytes, totalBytes)
        }
    }

    const changed = (cause: unknown) => {
        console.error(cause)
        return new ModuleRefusal(language.moduleFileChanged)
    }

    const assertSourceUnchanged = async () => {
        const now = await source.stat()
        if(now.size !== scan.stat.size || now.modified !== scan.stat.modified){
            throw new Error('the module file changed')
        }
    }

    //A save failure is retried; a read that does not match the first pass is not, so it throws out of here.
    const runRecords = async (indices: number[]): Promise<number[]> => {
        if(indices.length === 0){
            return []
        }
        try {
            await assertSourceUnchanged()
        } catch (error) {
            throw changed(error)
        }
        const inFlight = new Set<Promise<void>>()
        const failed: number[] = []
        let inFlightBytes = 0
        let readFailure: { cause: unknown } | null = null

        for(const index of indices){
            const record = scan.records[index]
            if(record.length >= ASSET_PIECE_SAVE_MIN_BYTES){
                //Saved here, not in the background: its pieces are read from the source one after another, and no other record is read meanwhile.
                try {
                    if (!module.assets?.[index]) {
                        throw new Error(`Missing asset metadata for index ${index}`)
                    }
                    module.assets[index][1] = await saveAssetFromPieces(readRisumRecordPieces(source, record, (bytes) => {
                        pieceBytes += bytes
                        reportBytes()
                    }), {
                        sizeBound: record.length,
                        beforeFinish: assertSourceUnchanged,
                    })
                    completed += 1
                    savedBytes += record.length
                } catch (error) {
                    if(error instanceof AssetSourceChangedError){
                        readFailure = { cause: error }
                        break
                    }
                    failed.push(index)
                } finally {
                    pieceBytes = 0
                    if(tasked){
                        reportBytes()
                    }
                    else{
                        alertWait(fillLang(language.alerts.addingAssets, { completed, total: totalAssets }))
                    }
                }
                continue
            }
            while(inFlight.size >= MAX_CONCURRENT_ASSET_SAVES || (inFlightBytes > 0 && inFlightBytes + record.length > charxLimits.backlogBytes)){
                await Promise.race(inFlight)
            }
            let body: Uint8Array
            try {
                body = await readRisumRecord(source, record)
            } catch (error) {
                readFailure = { cause: error }
                break
            }
            inFlightBytes += record.length
            const promise = (async () => {
                try {
                    const decoded = await decodeRPack(body)
                    if (!module.assets?.[index]) {
                        throw new Error(`Missing asset metadata for index ${index}`)
                    }
                    module.assets[index][1] = await saveAsset(decoded)
                    completed += 1
                    savedBytes += record.length
                } catch (error) {
                    failed.push(index)
                } finally {
                    inFlightBytes -= record.length
                    if(tasked){
                        reportBytes()
                    }
                    else{
                        alertWait(fillLang(language.alerts.addingAssets, { completed, total: totalAssets }))
                    }
                }
            })()
            inFlight.add(promise)
            promise.finally(() => inFlight.delete(promise))
        }

        await Promise.all(inFlight)
        if(readFailure){
            throw changed(readFailure.cause)
        }
        return failed.sort((a, b) => a - b)
    }

    try {
        progress.throwIfCancelled()
        await opts?.beforeAssets?.(module)
        if(totalAssets > 0){
            progress.step('assets')
            //The first stored byte of the round; one call dominates both save sites below.
            progress.beforeWrite()
        }
        let failed = await runRecords(scan.records.map((_, index) => index))
        let retryCount = 0
        while (failed.length > 0 && retryCount < MAX_ASSET_SAVE_RETRIES) {
            await sleep(ASSET_SAVE_RETRY_DELAY_MS)
            retryCount += 1
            failed = await runRecords(failed)
        }
        if (failed.length > 0) {
            throw new Error(fillLang(language.errors.moduleAssetsSaveFailed, { count: `${failed.length}` }))
        }
    } finally {
        if(!tasked){
            alertClear()
        }
    }

    module.id = v4()
    return module
}

type ModuleFileKind = 'risum' | 'charx' | 'json'

const MODULE_FILE_SUFFIXES: {suffix: string, kind: ModuleFileKind}[] = [
    {suffix: '.risum', kind: 'risum'},
    {suffix: '.charx', kind: 'charx'},
    {suffix: '.json', kind: 'json'},
    {suffix: '.lorebook', kind: 'json'},
]

//A file is routed by its suffix in lower case, whatever case the file name has. A file with any other suffix is not a module file.
function moduleFileRoute(name:string):{suffix: string, kind: ModuleFileKind}|null {
    const lower = name.toLowerCase()
    return MODULE_FILE_SUFFIXES.find((route) => lower.endsWith(route.suffix)) ?? null
}

/**
 * The one write of a module that was read in full, and the notes it leaves for the end message. The boot-window mark,
 * the write and, for a replace, the cache reset stay in one synchronous block, so the change effects see the module at
 * once and `getModules` never hands out the replaced one.
 */
function commitModule(module:RisuModule, decision:DuplicateDecision, session:DuplicateSession, progress:ImportProgress):string[] {
    markBootWrite()
    const placement = applyModulePlacement(DBState.db.modules, module, decision)
    //Marked before anything that can throw, so a later failure never hides this write from Retry. An added module is recorded
    //as the slot now in the list, read in this synchronous block; a replaced one cannot be undone.
    if(placement.kind === 'added'){
        progress.committed({kind: 'module', slot: DBState.db.modules[DBState.db.modules.length - 1]})
        return []
    }
    //The replaced module keeps its id, so a Studio form that shows it stays mounted over the new content. Taking the id away
    //here, in the same synchronous block as the write, refuses every later write of that form, held text included.
    withdrawOpenModuleId(placement.previous.id)
    progress.committed({kind: 'notUndoable', why: 'replace'})
    refreshModules()
    session.replaced = true
    return describeReplace(placement.previous, module)
}

/**
 * A replace keeps the retained paths and folders of the module it replaces, and a stub holds neither. So when the
 * installed target is a stub, its body is loaded before the write; a body that cannot be loaded ends the import through a
 * refusal and nothing is written. A target that is not installed makes the import an add, as before.
 */
async function loadReplaceTarget(decision:DuplicateDecision):Promise<void> {
    if(decision.choice !== 'replace'){
        return
    }
    const targetOf = () => DBState.db.modules.find((installed) => installed.id === decision.targetId)
    const stub = targetOf()
    if(!isModuleStub(stub)){
        return
    }
    const { loadModuleStubsOf } = await import('./moduleLoader')
    await loadModuleStubsOf(decision.targetId)
    const loaded = targetOf()
    if(!loaded || isModuleStub(loaded)){
        throw new ModuleRefusal(language.moduleLoadFailed(typeof stub?.name === 'string' ? stub.name : ''))
    }
}

/** Decides the duplicate question of a module that was read in full, then writes it. A skip writes nothing. */
async function placeModule(module:RisuModule, file:File, session:DuplicateSession, laterFiles:boolean, progress:ImportProgress):Promise<ImportOutcome> {
    progress.throwIfCancelled()
    const decision = await session.decide(DBState.db.modules, module.name, file.name, laterFiles)
    if(decision.choice === 'skip'){
        return {kind: 'skipped'}
    }
    reportDecision(progress, decision)
    progress.step('add')
    //The first write of a module that has no assets: the stub load below and the placement.
    progress.beforeWrite()
    await loadReplaceTarget(decision)
    return importedOutcome(commitModule(module, decision, session, progress))
}

//Tells the card that the file goes on, before its first write: a Replace keeps the background offer away for the round.
function reportDecision(progress:ImportProgress, decision:DuplicateDecision):void {
    progress.decided(decision.choice === 'replace')
}

function importedOutcome(notes:string[]):ImportOutcome {
    return notes.length > 0 ? {kind: 'imported', index: null, notes} : {kind: 'imported', index: null}
}

/** The module screens read ids, which a replace keeps, so they are told once that the content changed. Held by moduleGuiBump while a load loop runs. */
export { bumpModuleGui }

/**
 * Imports one picked file as a module and reports how it ended. It never rejects and shows nothing itself. `batch` is
 * true when the pick had several files: the prompts then name the file, and an unsupported file gets the short reason
 * that the batch summary lists next to its name.
 */
async function importModuleFile(file:File, batch:boolean, session:DuplicateSession, laterFiles:boolean, progress:ImportProgress):Promise<ImportOutcome> {
    const route = moduleFileRoute(file.name)
    if(!route){
        return {kind: 'refused', reason: batch ? language.importUnsupportedFile : language.moduleUnsupportedFile(file.name), normal: true}
    }
    const batchFile = batch ? file.name : undefined
    try {
        if(route.kind === 'charx'){
            //The card importer takes the progress: its own asset saves, the embedded module's and the card-spec saves pass the round's write gate, so Cancel stays offered while the archive is read.
            //The archive is handed over as the picked File, which is read in pieces, never as one buffer. The importer tests the suffix in lower case.
            const outcome = await importCharacterFile({
                name: file.name.slice(0, -route.suffix.length) + route.suffix,
                data: file,
                returnCharacter: true,
                lowLevelLabel: (cardName) => language.moduleLowLevelNamed(cardName, batchFile)
            }, progress)
            if(outcome.kind !== 'imported'){
                return outcome
            }
            if(!outcome.character){
                return {kind: 'refused', reason: language.errors.noData}
            }
            return await placeModule(convertCharacterToModule(outcome.character), file, session, laterFiles, progress)
        }
        if(route.kind === 'risum'){
            const source = importSourceOfFile(file)
            try {
                //The duplicate answer is taken before any asset is saved; a skip saves nothing. Only the write happens after the read.
                let decision:DuplicateDecision = {choice: 'add'}
                const module = await readModule(source, {progress, beforeAssets: async (scanned) => {
                    await confirmRisumLowLevel(scanned, batchFile)
                    decision = await session.decide(DBState.db.modules, scanned.name, file.name, laterFiles)
                    if(decision.choice === 'skip'){
                        throw new ModuleImportStopped('skipped')
                    }
                    reportDecision(progress, decision)
                }})
                progress.step('add')
                //Dominates the stub load and the placement; for a module with assets the gate in readModule has already fired.
                progress.beforeWrite()
                await loadReplaceTarget(decision)
                return importedOutcome(commitModule(module, decision, session, progress))
            } finally {
                await source.close()
            }
        }
        return await importModuleJson(file, batchFile, session, laterFiles, progress)
    } catch (error) {
        if(!(error instanceof ModuleImportStopped)){
            console.error(error)
        }
        return outcomeOfError(error)
    }
}

//A `.json` or `.lorebook` file: a module, a risu lorebook, an external lorebook or a regex list. What none of these fits is refused at the normal alert level, like a file that does not parse.
async function importModuleJson(file:File, batchFile:string|undefined, session:DuplicateSession, laterFiles:boolean, progress:ImportProgress):Promise<ImportOutcome> {
    progress.step('read')
    const fileData = new Uint8Array(await file.arrayBuffer())
    progress.throwIfCancelled()
    progress.step('check')
    //Once placement starts, a throw is a failure whose data state the runner reads from the commit marker, never "no data".
    let placing = false
    const place = (module:RisuModule) => {
        placing = true
        return placeModule(module, file, session, laterFiles, progress)
    }
    try {
        const importData = JSON.parse(Buffer.from(fileData).toString())
        if(importData.type === 'risuModule'){
            if(hasModuleStubKey(importData)){
                return {kind: 'refused', reason: language.errors.noData}
            }
            if(
                (!importData.name)
                || (!importData.id)
            ){
                return {kind: 'refused', reason: language.errors.noData}
            }
            importData.id = v4()
            dropDeviceAssetState(importData)

            if(importData.lowLevelAccess){
                const prompt = batchFile ? `${language.moduleLowLevelNamed(importData.name, batchFile)}\n${language.lowLevelAccessConfirm}` : language.lowLevelAccessConfirm
                const conf = await alertConfirm(prompt)
                if(!conf){
                    return {kind: 'declined'}
                }
            }
            return await place(importData)
        }
        // importData.type === 'risu' in conflict with HypaV3 preset exports
        // difference: record vs. array
        if(importData.type === 'risu' && importData.data && Array.isArray(importData.data)){
            const lores:loreBook[] = importData.data
            return await place({
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from risu lorebook',
                lorebook: lores,
                id: v4()
            })
        }
        if(importData.entries){
            const lores:loreBook[] = convertExternalLorebook(importData.entries)
            return await place({
                name: importData.name || 'Imported Lorebook',
                description: importData.description || 'Converted from external lorebook',
                lorebook: lores,
                id: v4()
            })
        }
        if(importData.type === 'regex'  && importData.data){
            const regexs:customscript[] = importData.data
            return await place({
                name: importData.name || 'Imported Regex',
                description: importData.description || 'Converted from risu regex',
                regex: regexs,
                id: v4()
            })
        }
    } catch (error) {
        //A refusal that names its own reason (a replace target that could not be loaded) is not "no data"; a Cancel is not either.
        if(placing || error instanceof ModuleRefusal || error instanceof ImportCancelled){
            throw error
        }
        console.error(error)
    }
    return {kind: 'refused', reason: language.errors.noData, normal: true}
}

/**
 * Imports the files picked in Settings > Modules, in order, one at a time, on one task card for one file or several: the
 * card carries the steps, a Cancel until the round's first write, the result (the files that were not imported with their
 * reasons, or a count) and a Retry for the files that failed. A module that is imported stays imported when a later file
 * fails. Each round (the first, then each Retry) asks its duplicate questions afresh, so an "all remaining" answer of one
 * round never decides a file of the next.
 */
export async function importModule(){
    const files = await selectFileByDom(['*'], 'multiple')
    if(!files || files.length === 0){
        return
    }
    const sessions = new Map<number, DuplicateSession>()
    const sessionOf = (round:number) => {
        let session = sessions.get(round)
        if(!session){
            session = new DuplicateSession()
            sessions.set(round, session)
        }
        return session
    }
    await runImportBatch(
        files.map((file) => ({name: file.name, size: file.size, run: (progress:ImportProgress) => importModuleFile(
            file,
            progress.round.count > 1,
            sessionOf(progress.round.number),
            progress.round.index < progress.round.count - 1,
            progress,
        )})),
        {
            declinedReason: language.importDeclinedLowLevel,
            task: {title: language.importTaskModulesTitle, steps: IMPORT_STEPS, background: true, backgroundHeld: true},
            preflight: true,
            mayReplace: true,
            //The module screens learn of a replace when its round ends, not when the result is answered: a backgrounded result can wait.
            afterRound: (round) => {
                if(sessions.get(round)?.replaced){
                    bumpModuleGui()
                }
            },
        }
    )
}

function getModuleById(id:string){
    const db = getDatabase()
    for(let i=0;i<db.modules.length;i++){
        if(db.modules[i].id === id){
            return db.modules[i]
        }
    }

    if(id === '$embedded'){
        const persona = checkPersonaBinded()
        if(persona && persona.embeddedModule){
            return persona.embeddedModule
        }
    }
    return null
}

// The memo is keyed on the id list and on the list object that held the rows: a whole-list replacement with the same
// ids (a plugin write) must not return rows of the replaced list.
let lastModules = ''
let lastModuleList:RisuModule[] | undefined = undefined
let lastModuleData:RisuModule[] = []
export function getModules(subject?: RunSubject){
    const ids = moduleRefIdsOf(subject)
    const idsJoined = ids.join('-')
    const list = getDatabase().modules
    if(lastModules === idsJoined && lastModuleList === list){
        return lastModuleData
    }

    let modules:RisuModule[] = moduleListOf(ids)
    lastModules = idsJoined
    lastModuleList = list
    lastModuleData = modules
    return modules

}


// The body getters below skip a slot that is marked as a module stub even when it carries body keys (an edited or
// malformed stub): a stub's body is never read until the loader has replaced the slot. getModules itself still
// returns stubs, because callers read their id, namespace and icon flags.
/** With `owners`, one module id is pushed per returned entry, in the same order. */
/**
 * `owners` and `starts` are filled per element of the returned list: the id of the module that element came from, and
 * the list position where that module's elements begin (so `index - starts[index]` is the position inside its module).
 * A lorebook that is not an array joins as one element whatever its shape.
 */
export function getModuleLorebooks(subject?: RunSubject, owners?: string[], starts?: number[]) {
    const modules = getModules(subject)
    let lorebooks: loreBook[] = []
    for (const module of modules) {
        if(!module || isModuleStub(module)){
            continue
        }
        if (module.lorebook) {
            const before = lorebooks.length
            lorebooks = lorebooks.concat(module.lorebook)
            const added = lorebooks.length - before
            for(let i = 0; i < added; i++){
                owners?.push(module.id)
                starts?.push(before)
            }
        }
    }
    return lorebooks
}

export function getModuleAssets(subject?: RunSubject) {
    const modules = getModules(subject)
    let assets: [string,string,string][] = []
    for (const module of modules) {
        if(!module || isModuleStub(module)){
            continue
        }
        if (module.assets) {
            assets = assets.concat(module.assets)
        }
    }
    return assets
}


export function getModuleTriggers(subject?: RunSubject) {
    const modules = getModules(subject)
    let triggers: triggerscript[] = []
    for (const module of modules) {
        if(!module || isModuleStub(module)){
            continue
        }
        if (module.trigger) {
            triggers = triggers.concat(module.trigger.map((t) => {
                return { ...t, lowLevelAccess: module.lowLevelAccess }
            }))
        }
    }
    return triggers
}

export function getModuleRegexScripts(subject?: RunSubject) {
    const modules = getModules(subject)
    let customscripts: customscript[] = []
    for (const module of modules) {
        if(!module || isModuleStub(module)){
            continue
        }
        if (module.regex) {
            customscripts = customscripts.concat(module.regex)
        }
    }
    return customscripts
}

export function getModuleToggles(subject?: RunSubject) {
    const modules = getModules(subject)
    let costomModuleToggles: string = ''
    for (const module of modules) {
        if(!module || isModuleStub(module)){
            continue
        }
        if (module.customModuleToggle) {
            costomModuleToggles += '\n' + module.customModuleToggle + '\n'
        }
    }
    return costomModuleToggles
}

/** The MCP URL of each referenced non-stub module, with the module that names it. */
export function getModuleMcpEntries(subject?: RunSubject) {
    const modules = getModules(subject)

    const entries: { moduleId: string, moduleName: string, url: string }[] = []
    for (const module of modules) {
        if (isModuleStub(module) || !module.mcp?.url) {
            continue
        }
        entries.push({ moduleId: module.id, moduleName: module.name, url: module.mcp.url })
    }
    return entries
}

export function getModuleMcps(subject?: RunSubject) {
    return getModuleMcpEntries(subject).map((v) => v.url)
}

export async function applyModule() {
    const sel = await alertModuleSelect()
    if (!sel) {
        return
    }

    // A module in the database is acquired by id (its body is loaded when it is a stub) and released once the copy is
    // taken; the embedded persona module is read as it is.
    const row = getDatabase().modules.find((v) => v.id === sel)
    const acquired = row ? await useModuleById(sel, row.name) : null
    if (row && !acquired) {
        return
    }
    let module: RisuModule | null
    try {
        module = safeStructuredClone(acquired ? acquired.module : getModuleById(sel))
    }
    finally {
        acquired?.release()
    }
    if (!module) {
        return
    }

    const currentChar = getCurrentCharacter()
    if (!currentChar) {
        return
    }
    if(currentChar.type === 'group'){
        return
    }

    if (module.lorebook) {
        for (const lore of module.lorebook) {
            currentChar.globalLore.push(lore)
        }
    }
    if (module.regex) {
        for (const regex of module.regex) {
            currentChar.customscript.push(regex)
        }
    }
    if (module.trigger) {
        for (const trigger of module.trigger) {
            currentChar.triggerscript.push(trigger)
        }
    }

    setCurrentCharacter(currentChar)

    alertNormal(language.successApplyModule)
}

let lastModuleIds:string = ''
let lastBase:ModuleReloadBase | null = null

export function moduleUpdate(){


    const m = getModules()

    const idList = m.map((m) => m.id)
    const ids = idList.join('-')
    
    let moduleHideIcon = false
    let backgroundEmbedding = ''
    m.forEach((module) => {
        if(!module){
            return
        }

        if(module.hideIcon){
            moduleHideIcon = true
        }
        if(module.backgroundEmbedding){
            backgroundEmbedding += '\n' + module.backgroundEmbedding + '\n'
        }
    })

    // Always set, so a chat without an embedding module clears the previous chat's embedding.
    moduleBackgroundEmbedding.set(backgroundEmbedding)
    HideIconStore.set(getCurrentCharacter()?.hideChatIcon || moduleHideIcon)

    // Fork-specific: a set change that only adds or removes display-inert modules under the same selection skips the
    // bump. The predicate's reads (module fields, the current character) are deliberately untracked, so the effect
    // gains no dependency. The base is recorded on every call, so a switch with equal ids still refreshes the
    // selection the next toggle is compared against.
    const idsChanged = lastModuleIds !== ids
    const { selection, need } = untrack(() => {
        const char = getCurrentCharacter()
        const selection = `${char?.chaId ?? ''}|${char?.chatPage ?? ''}`
        const need = idsChanged && moduleChangeNeedsReload(lastBase, m, selection,
            (id) => getDatabase().modules.filter((row) => row?.id === id))
        return { selection, need }
    })
    lastBase = { ids: idList, selection }
    if(idsChanged){
        lastModuleIds = ids
        if(need){
            ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
        }
    }
}

// The reactive dependency list for the above lives in ./moduleUpdateDeps.ts.
// If moduleUpdate() starts reading another module field that selects modules or feeds the stores set above, update it
// there too. The reload predicate's untracked reads are exempt: do not add them to moduleUpdateDeps, because tracking
// them brings back the re-runs that file removed.

export function refreshModules(){
    lastModules = ''
    lastModuleList = undefined
    lastModuleData = []
}
